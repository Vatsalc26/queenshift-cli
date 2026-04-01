import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import * as vscode from "vscode"

import { ensureReviewPack, formatReviewPack, listPendingReviewItems, type ReviewQueueItem } from "../run/ReviewQueue"
import { evaluateTaskAdmission } from "../run/AdmissionGate"
import {
	buildShellAdmissionSpec,
	buildShellIncidentCommandSpec,
	buildShellLaunchSpec,
	buildShellReviewCommandSpec,
	readShellSnapshot,
	resolveShellRepoRoot,
	type ShellLaunchSpec,
} from "../shell/ThinShell"
import { resolveOwnerProviderSelection } from "../owner/ProviderResolution"
import { buildOwnerShellStatusText } from "../owner/OwnerStatus"
import { rememberOwnerCache, resolveOwnerShellCachedDefaults } from "../owner/OwnerCache"
import { ensureCanonicalOwnerGuidedDemoManifest } from "../owner/OwnerProfileManifest"
import { buildTaskComposerDraft, formatTaskComposerPreview } from "../owner/TaskComposer"
import {
	DEFAULT_GUIDED_TASK_TEMPLATE_ID,
	GUIDED_TASK_TEMPLATES,
	formatGuidedTaskLibrary,
	formatTaskContractPreview,
	type GuidedTaskTemplateId,
} from "../shell/GuidedTaskTemplates"
import { runThinShellSmoke } from "./SmokeHarness"
import { chooseInitialShellWorkspace, SHELL_WORKSPACE_SELECTION_PROMPT } from "./WorkspaceDefaults"

type ReviewListEntry = {
	runId: string
	label: string
}

type ComposerMode = "guided" | "free_form"

type PanelState = {
	task: string
	workspace: string
	composerMode: ComposerMode
	guidedTemplateId: GuidedTaskTemplateId
	guidedPrimaryTarget: string
	guidedSecondaryValue: string
	guidedExpectedOutcome: string
	generatedTaskText: string
	taskPreviewText: string
	taskContractPreviewText: string
	running: boolean
	output: string
	commandPreview: string
	statusText: string
	admissionText: string
	runtimeText: string
	summaryText: string
	forensicsText: string
	latestRunId: string
	reviewItems: ReviewListEntry[]
	selectedReviewId: string
	selectedReviewText: string
}

type ShellOpenOptions = {
	smokeResultPath?: string
}

type ShellSmokeRequest = {
	resultPath?: string
}

const OPEN_SHELL_COMMAND = "swarmCoderV2Shell.open"
const MAX_OUTPUT_CHARS = 120_000
const scheduledSmokeResultPaths = new Set<string>()

function trimOutput(value: string): string {
	return value.length <= MAX_OUTPUT_CHARS ? value : value.slice(value.length - MAX_OUTPUT_CHARS)
}

async function getDefaultWorkspace(): Promise<string> {
	const candidates =
		vscode.workspace.workspaceFolders?.map((folder: { uri: { fsPath: string } }) => folder.uri.fsPath) ?? []
	return chooseInitialShellWorkspace(candidates)
}

function persistShellDefaults(repoRoot: string, state: PanelState): void {
	try {
		const providerSelection = resolveOwnerProviderSelection(process.env as Record<string, string | undefined>)
		const manifest = ensureCanonicalOwnerGuidedDemoManifest(repoRoot).manifest
		rememberOwnerCache(repoRoot, {
			workspace: state.workspace,
			provider: providerSelection.provider,
			authMode: providerSelection.authMode,
			model: providerSelection.model,
			composerMode: state.composerMode,
			guidedTemplateId: state.guidedTemplateId,
			starterSurface: getRunSurface(state.composerMode),
			profileId: manifest.profileId,
			manifestHash: manifest.manifestHash,
		})
	} catch {
		// Cache is advisory only; never break shell state updates on persistence errors.
	}
}

function getRunSurface(composerMode: ComposerMode): string {
	return composerMode === "guided" ? "thin_shell_guided" : "thin_shell_free_form"
}

function runIdFromSummaryPath(summaryPath: string | null): string {
	if (!summaryPath) return ""
	const normalized = summaryPath.replace(/[\\/]+/g, "/")
	const parts = normalized.split("/")
	const summaryIndex = parts.lastIndexOf("summary.json")
	if (summaryIndex <= 0) return ""
	return parts[summaryIndex - 1] ?? ""
}

function buildOwnerRunSpec(
	repoRoot: string,
	task: string,
	workspace: string,
	composerMode: ComposerMode,
): ShellLaunchSpec {
	const selection = resolveOwnerProviderSelection(process.env as Record<string, string | undefined>)
	if (!selection.ready || !selection.provider) {
		throw new Error(selection.reason)
	}
	const manifest = ensureCanonicalOwnerGuidedDemoManifest(repoRoot).manifest

	const launchArgs = ["--provider", selection.provider, ...(selection.model ? ["--model", selection.model] : [])]
	return buildShellLaunchSpec(repoRoot, task, workspace, {
		extraArgs: launchArgs,
		extraDisplayArgs: launchArgs,
		envOverrides: {
			...selection.envOverrides,
			SWARM_RUN_SURFACE: getRunSurface(composerMode),
			SWARM_OWNER_PROFILE_ID: manifest.profileId,
			SWARM_OWNER_PROFILE_MANIFEST_HASH: manifest.manifestHash,
		},
	})
}

function writeSmokeResult(resultPath: string, result: Record<string, unknown>): void {
	fs.mkdirSync(path.dirname(resultPath), { recursive: true })
	fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
}

function appendSmokeTrace(tracePath: string, message: string): void {
	fs.mkdirSync(path.dirname(tracePath), { recursive: true })
	fs.appendFileSync(tracePath, `[${new Date().toISOString()}] ${message}\n`, "utf8")
}

function readSmokeRequest(requestPath: string): ShellSmokeRequest | null {
	if (!fs.existsSync(requestPath)) return null
	try {
		return JSON.parse(fs.readFileSync(requestPath, "utf8")) as ShellSmokeRequest
	} catch {
		return null
	}
}

function formatReviewItemLabel(item: ReviewQueueItem): string {
	return `${item.runId} | ${item.stopReason} | ${item.task}`
}

function formatDecisionLabel(decision: "allow" | "allow_with_review_bias" | "refuse"): string {
	switch (decision) {
		case "allow":
			return "ALLOW"
		case "allow_with_review_bias":
			return "ALLOW WITH REVIEW BIAS"
		case "refuse":
			return "REFUSE"
	}
}

function buildFreeFormPreview(task: string, workspace: string): {
	generatedTaskText: string
	taskPreviewText: string
	taskContractPreviewText: string
} {
	const normalizedTask = task.trim()
	if (!normalizedTask) {
		return {
			generatedTaskText: "",
			taskPreviewText: "Guided mode is the safer default. Free-form stays available when you already know the exact task text.",
			taskContractPreviewText: "Enter a free-form task and select a workspace to preview the derived task contract.",
		}
	}

	if (!workspace.trim() || !fs.existsSync(workspace)) {
		return {
			generatedTaskText: normalizedTask,
			taskPreviewText: ["Mode: Free-form", "Generated task:", normalizedTask, "Select a real workspace to preview admission and bounded scope."].join("\n"),
			taskContractPreviewText: "Select a real workspace to preview the derived task contract.",
		}
	}

	const admission = evaluateTaskAdmission(normalizedTask, workspace)
	const scopePreview = admission.derivedTaskContract?.scope?.allowedFiles ?? admission.derivedTaskContract?.scope?.requiredTargetFiles ?? []
	const previewLines = ["Mode: Free-form", "Generated task:", normalizedTask, `Admission preview: ${formatDecisionLabel(admission.decision)}`]

	if (scopePreview.length > 0) {
		previewLines.push("Expected file scope:")
		previewLines.push(...scopePreview.map((file) => `- ${file}`))
	}
	if (admission.verificationProfile) {
		previewLines.push(`Verification profile: ${admission.verificationProfile}`)
	}
	if (admission.reasonCodes.length > 0) {
		previewLines.push(`Reason codes: ${admission.reasonCodes.join(", ")}`)
	}
	if (admission.details.length > 0) {
		previewLines.push(...admission.details.map((detail) => `- ${detail}`))
	}

	return {
		generatedTaskText: normalizedTask,
		taskPreviewText: previewLines.join("\n"),
		taskContractPreviewText: formatTaskContractPreview(
			admission.derivedTaskContract,
			"No derived task contract was available for this free-form task.",
		),
	}
}

function refreshComposerPreview(repoRoot: string, state: PanelState): PanelState {
	const isGuided = state.composerMode === "guided"
	const showStarterLibrary =
		isGuided &&
		state.guidedPrimaryTarget.trim().length === 0 &&
		state.guidedExpectedOutcome.trim().length === 0 &&
		state.guidedSecondaryValue.trim().length === 0
	const guidedDraft = isGuided
		? buildTaskComposerDraft({
				goalType: state.guidedTemplateId,
				primaryTarget: state.guidedPrimaryTarget,
				secondaryValue: state.guidedSecondaryValue,
				expectedOutcome: state.guidedExpectedOutcome,
				workspace: state.workspace,
		  })
		: null
	const freeFormPreview = isGuided ? null : buildFreeFormPreview(state.task, state.workspace)
	const generatedTaskText = guidedDraft?.finalTaskText ?? freeFormPreview?.generatedTaskText ?? ""
	const taskPreviewText = showStarterLibrary
		? formatGuidedTaskLibrary()
		: guidedDraft
			? formatTaskComposerPreview(guidedDraft)
		: (freeFormPreview?.taskPreviewText ?? "Choose a task path to see the preview.")
	const taskContractPreviewText = showStarterLibrary
		? "Choose a starter task and name the first target file to preview the task contract."
		: guidedDraft
			? formatTaskContractPreview(guidedDraft.taskContract, "Complete the guided fields to preview the task contract.")
		: (freeFormPreview?.taskContractPreviewText ?? "Enter a task to preview the task contract.")

	const providerSelection = resolveOwnerProviderSelection(process.env as Record<string, string | undefined>)
	let commandPreview = isGuided
		? "Complete the guided fields and workspace to preview the exact Queenshift CLI invocation."
		: "Enter a task and workspace to preview the exact Queenshift CLI invocation."
	if (generatedTaskText.trim().length > 0) {
		try {
			commandPreview = buildOwnerRunSpec(repoRoot, generatedTaskText, state.workspace, state.composerMode).displayCommand
		} catch (err) {
			commandPreview = err instanceof Error ? err.message : String(err)
		}
	}

	const statusText = buildOwnerShellStatusText({
		rootDir: repoRoot,
		workspace: state.workspace,
		surface: getRunSurface(state.composerMode),
		providerSelection,
		admissionText: state.admissionText,
		latestRunId: state.latestRunId,
	})

	return {
		...state,
		generatedTaskText,
		taskPreviewText,
		taskContractPreviewText,
		commandPreview,
		statusText,
	}
}

async function loadReviewState(
	workspace: string,
	preferredRunId: string,
): Promise<Pick<PanelState, "reviewItems" | "selectedReviewId" | "selectedReviewText">> {
	if (!workspace.trim()) {
		return {
			reviewItems: [],
			selectedReviewId: "",
			selectedReviewText: "Select a workspace to load pending review items.",
		}
	}

	const pending = listPendingReviewItems(workspace)
	const reviewItems = pending.map((item) => ({
		runId: item.runId,
		label: formatReviewItemLabel(item),
	}))
	const selectedReviewId =
		(preferredRunId && reviewItems.some((item) => item.runId === preferredRunId) ? preferredRunId : reviewItems[0]?.runId) ?? ""

	if (!selectedReviewId) {
		return {
			reviewItems,
			selectedReviewId: "",
			selectedReviewText: "No pending review items found for this workspace.",
		}
	}

	try {
		const pack = await ensureReviewPack(workspace, selectedReviewId)
		return {
			reviewItems,
			selectedReviewId,
			selectedReviewText: formatReviewPack(pack),
		}
	} catch (err) {
		return {
			reviewItems,
			selectedReviewId,
			selectedReviewText: `Failed to load review pack: ${err instanceof Error ? err.message : String(err)}`,
		}
	}
}

async function buildInitialState(repoRoot: string): Promise<PanelState> {
	const candidates =
		vscode.workspace.workspaceFolders?.map((folder: { uri: { fsPath: string } }) => folder.uri.fsPath) ?? []
	const cachedDefaults = await resolveOwnerShellCachedDefaults(repoRoot, candidates)
	const workspace = cachedDefaults.workspace
	const snapshot = readShellSnapshot(workspace)
	return refreshComposerPreview(repoRoot, {
		task: "",
		workspace,
		composerMode: cachedDefaults.composerMode,
		guidedTemplateId: cachedDefaults.guidedTemplateId ?? DEFAULT_GUIDED_TASK_TEMPLATE_ID,
		guidedPrimaryTarget: "",
		guidedSecondaryValue: "",
		guidedExpectedOutcome: "",
		generatedTaskText: "",
		taskPreviewText: "Guided mode is the default. Pick a task shape, name the target file, and the shell will generate the bounded task for you.",
		taskContractPreviewText: "Complete the guided fields to preview the task contract.",
		running: false,
		output: "",
		commandPreview: "",
		statusText: "",
		admissionText: workspace
			? "Use Check Admission to see repo readiness and task admission before launching a run."
			: SHELL_WORKSPACE_SELECTION_PROMPT,
		runtimeText: snapshot.runtimeText,
		summaryText: snapshot.summaryText,
		forensicsText: snapshot.forensicsText,
		latestRunId: runIdFromSummaryPath(snapshot.summaryPath),
		reviewItems: [],
		selectedReviewId: "",
		selectedReviewText: workspace ? "Loading review inbox..." : SHELL_WORKSPACE_SELECTION_PROMPT,
	})
}

function getNonce(): string {
	return `${Date.now()}${Math.random().toString(16).slice(2)}`
}

function renderHtml(webview: any, state: PanelState, extensionUri: any): string {
	const nonce = getNonce()
	const bootState = JSON.stringify(state).replace(/</g, "\\u003c")
	const templateCatalog = JSON.stringify(GUIDED_TASK_TEMPLATES).replace(/</g, "\\u003c")
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview.js"))

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Queenshift Thin Shell</title>
	<style>
		:root {
			color-scheme: light dark;
		}

		* {
			box-sizing: border-box;
		}

		body {
			margin: 0;
			padding: 20px;
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background:
				radial-gradient(circle at top left, color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent) 0%, transparent 42%),
				linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background) 12%) 0%, var(--vscode-editor-background) 100%);
		}

		.shell {
			display: grid;
			gap: 16px;
		}

		.hero,
		.controls,
		.inbox,
		.panel {
			border-radius: 14px;
			border: 1px solid var(--vscode-panel-border);
			background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-sideBar-background) 8%);
		}

		.hero {
			padding: 18px 20px;
			border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 22%, transparent);
			background: color-mix(in srgb, var(--vscode-editor-background) 80%, var(--vscode-textBlockQuote-background) 20%);
		}

		.hero h1 {
			margin: 0 0 8px;
			font-size: 20px;
		}

		.hero p {
			margin: 0;
			line-height: 1.5;
			color: var(--vscode-descriptionForeground);
		}

		.controls,
		.inbox {
			padding: 16px;
			display: grid;
			gap: 12px;
		}

		.layout {
			display: grid;
			gap: 16px;
			grid-template-columns: minmax(280px, 1.2fr) minmax(320px, 1fr);
		}

		@media (max-width: 960px) {
			.layout {
				grid-template-columns: 1fr;
			}
		}

		.field {
			display: grid;
			gap: 6px;
		}

		.field label {
			font-weight: 600;
		}

		textarea,
		input,
		select {
			width: 100%;
			padding: 10px 12px;
			border-radius: 10px;
			border: 1px solid var(--vscode-input-border);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			font: inherit;
		}

		textarea {
			min-height: 84px;
			resize: vertical;
		}

		.hidden {
			display: none !important;
		}

		select {
			min-height: 160px;
		}

		option {
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
		}

		.mode-row {
			display: flex;
			gap: 10px;
			flex-wrap: wrap;
		}

		.mode-chip {
			border: 1px solid var(--vscode-panel-border);
			background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background) 12%);
			color: var(--vscode-foreground);
		}

		.mode-chip.active {
			background: linear-gradient(135deg, var(--vscode-button-background) 0%, color-mix(in srgb, var(--vscode-button-background) 72%, var(--vscode-textLink-foreground) 28%) 100%);
			color: var(--vscode-button-foreground);
		}

		.workspace-row,
		.button-row {
			display: flex;
			gap: 10px;
			flex-wrap: wrap;
		}

		button {
			border: 0;
			border-radius: 999px;
			padding: 10px 14px;
			font: inherit;
			cursor: pointer;
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}

		button.primary {
			background: linear-gradient(135deg, var(--vscode-button-background) 0%, color-mix(in srgb, var(--vscode-button-background) 72%, var(--vscode-textLink-foreground) 28%) 100%);
			color: var(--vscode-button-foreground);
		}

		button.warn {
			background: color-mix(in srgb, var(--vscode-errorForeground) 22%, var(--vscode-button-secondaryBackground) 78%);
		}

		button:disabled {
			cursor: default;
			opacity: 0.6;
		}

		.command {
			margin: 0;
			padding: 10px 12px;
			border-radius: 10px;
			background: var(--vscode-textCodeBlock-background);
			color: var(--vscode-descriptionForeground);
			white-space: pre-wrap;
			word-break: break-word;
		}

		.panels {
			display: grid;
			gap: 16px;
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		}

		.panel {
			min-height: 240px;
			display: grid;
			grid-template-rows: auto 1fr;
			overflow: hidden;
		}

		.panel header {
			padding: 12px 14px;
			font-weight: 700;
			letter-spacing: 0.02em;
			background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent);
		}

		pre {
			margin: 0;
			padding: 14px;
			overflow: auto;
			white-space: pre-wrap;
			word-break: break-word;
			font-family: var(--vscode-editor-font-family);
			font-size: 12px;
			line-height: 1.45;
		}

		.hint {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			white-space: pre-wrap;
			line-height: 1.45;
		}

		.template-card {
			padding: 12px;
			border-radius: 12px;
			border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent);
			background: color-mix(in srgb, var(--vscode-editor-background) 86%, var(--vscode-textCodeBlock-background) 14%);
			line-height: 1.5;
		}
	</style>
</head>
<body>
	<div class="shell">
		<section class="hero">
			<h1>Queenshift Thin Shell</h1>
			<p>Use the guided path to stay inside the proven lane, preview the exact Queenshift command before launch, then follow the same CLI runtime summary and artifacts the shell wraps.</p>
		</section>

		<section class="layout">
			<div class="controls">
				<div class="field">
					<label>Task Capture</label>
					<div class="mode-row">
						<button id="guidedMode" class="mode-chip" type="button">Guided</button>
						<button id="freeMode" class="mode-chip" type="button">Free-form</button>
					</div>
					<div class="hint">Guided mode is the default for the owner. Free-form stays available when you already know the exact task wording.</div>
				</div>

				<div id="guidedSection" class="field">
					<div class="field">
						<label for="guidedTemplate">Guided Template</label>
						<select id="guidedTemplate" size="6"></select>
					</div>
					<div id="templateDescription" class="template-card"></div>

					<div class="field">
						<label id="guidedPrimaryLabel" for="guidedPrimary"></label>
						<input id="guidedPrimary" type="text" />
					</div>

					<div id="guidedSecondaryField" class="field hidden">
						<label id="guidedSecondaryLabel" for="guidedSecondaryInput"></label>
						<input id="guidedSecondaryInput" type="text" class="hidden" />
						<select id="guidedSecondarySelect" class="hidden"></select>
					</div>

					<div class="field">
						<label for="guidedOutcome">Expected Outcome (Optional)</label>
						<textarea id="guidedOutcome"></textarea>
					</div>
				</div>

				<div id="freeFormSection" class="field hidden">
					<label for="task">Task</label>
					<textarea id="task" placeholder="add a brief comment to hello.ts"></textarea>
				</div>

				<div class="field">
					<label>Generated Task</label>
					<pre id="generatedTask" class="command">Guided mode will generate the task text here.</pre>
				</div>

				<div class="field">
					<label for="workspace">Workspace</label>
					<div class="workspace-row">
						<input id="workspace" type="text" placeholder="C:\\path\\to\\workspace" />
						<button id="browse" type="button">Browse</button>
					</div>
				</div>

				<div class="button-row">
					<button id="admit" type="button">Check Admission</button>
					<button id="run" class="primary" type="button">Run CLI Task</button>
					<button id="showIncident" type="button">Latest Incident</button>
					<button id="incidentCleanup" type="button">Incident Cleanup</button>
					<button id="refresh" type="button">Refresh Panels</button>
				</div>

				<div class="field">
					<label>Queenshift Command Preview</label>
					<pre id="command" class="command">The shell will show the exact Queenshift CLI invocation here.</pre>
				</div>

				<div class="hint" id="status"></div>
			</div>

			<div class="inbox">
				<div class="field">
					<label for="reviewList">Review Inbox</label>
					<select id="reviewList" size="6"></select>
				</div>

				<div class="button-row">
					<button id="approve" class="primary" type="button">Approve</button>
					<button id="discard" class="warn" type="button">Discard</button>
				</div>

				<div class="field">
					<label>Selected Review Pack</label>
					<pre id="reviewPack"></pre>
				</div>
			</div>
		</section>

		<section class="panels">
			<article class="panel">
				<header>Task Preview</header>
				<pre id="taskPreview"></pre>
			</article>
			<article class="panel">
				<header>Task Contract</header>
				<pre id="taskContract"></pre>
			</article>
			<article class="panel">
				<header>Preflight Admission</header>
				<pre id="admission"></pre>
			</article>
			<article class="panel">
				<header>Live Output</header>
				<pre id="output"></pre>
			</article>
			<article class="panel">
				<header>CLI Runtime Summary</header>
				<pre id="runtime"></pre>
			</article>
			<article class="panel">
				<header>Latest Summary</header>
				<pre id="summary"></pre>
			</article>
			<article class="panel">
				<header>Latest Forensics</header>
				<pre id="forensics"></pre>
			</article>
		</section>
	</div>

	<script id="swarmBootState" type="application/json">${bootState}</script>
	<script id="swarmTemplateCatalog" type="application/json">${templateCatalog}</script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}

export function activate(context: any): void {
	const shellRepoRoot = resolveShellRepoRoot(context.extensionPath)
	const smokeTracePath = path.join(shellRepoRoot, "verification", ".vscode-shell-smoke-trace.log")
	const webviewTracePath = path.join(shellRepoRoot, "verification", ".vscode-shell-webview-trace.log")
	const scheduleSmokeLaunch = (resultPath: string, source: "env" | "file") => {
		const normalizedResultPath = resultPath.trim()
		if (!normalizedResultPath) return
		if (scheduledSmokeResultPaths.has(normalizedResultPath)) {
			appendSmokeTrace(smokeTracePath, `${source} trigger ignored because smoke launch is already scheduled for ${normalizedResultPath}`)
			return
		}
		scheduledSmokeResultPaths.add(normalizedResultPath)
		appendSmokeTrace(smokeTracePath, `activate ${source} trigger detected for ${normalizedResultPath}`)
		setTimeout(() => {
			void vscode.commands.executeCommand(OPEN_SHELL_COMMAND, { smokeResultPath: normalizedResultPath })
		}, 250)
	}
	const command = vscode.commands.registerCommand(OPEN_SHELL_COMMAND, async (options?: ShellOpenOptions) => {
		if (options?.smokeResultPath) {
			appendSmokeTrace(smokeTracePath, `open command invoked for smoke result ${options.smokeResultPath}`)
		}
		const panel = vscode.window.createWebviewPanel("swarmCoderV2Shell", "Queenshift Thin Shell", vscode.ViewColumn.One, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [context.extensionUri],
		})

		const repoRoot = resolveShellRepoRoot(context.extensionPath)
		let state = await buildInitialState(repoRoot)
		let activeChild: ChildProcess | null = null
		let disposed = false

		const sync = () => {
			if (disposed) return
			void panel.webview.postMessage({ type: "hydrate", state })
		}

		const getState = () => state

		const setState = (partial: Partial<PanelState>, options: { refreshPreview?: boolean } = {}) => {
			state = options.refreshPreview
				? refreshComposerPreview(repoRoot, { ...state, ...partial } as PanelState)
				: { ...state, ...partial }
			persistShellDefaults(repoRoot, state)
			sync()
		}

		const getEffectiveTask = (): string => (state.composerMode === "guided" ? state.generatedTaskText : state.task).trim()

		const appendOutput = (chunk: string) => {
			if (!chunk) return
			state = { ...state, output: trimOutput(`${state.output}${chunk}`) }
			sync()
		}

		const refreshPanels = async (workspace: string, preferredRunId = state.selectedReviewId) => {
			const snapshot = readShellSnapshot(workspace)
			const reviewState = await loadReviewState(workspace, preferredRunId)
			setState(
				{
					workspace,
					runtimeText: snapshot.runtimeText,
					summaryText: snapshot.summaryText,
					forensicsText: snapshot.forensicsText,
					latestRunId: runIdFromSummaryPath(snapshot.summaryPath),
					reviewItems: reviewState.reviewItems,
					selectedReviewId: reviewState.selectedReviewId,
					selectedReviewText: reviewState.selectedReviewText,
				},
				{ refreshPreview: true },
			)
		}

		const launchCliSpec = async (
			spec: ShellLaunchSpec,
		): Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }> => {
			const launchHeader = `[Shell] Launching from ${spec.cwd}\n[Shell] ${spec.displayCommand}\n\n`
			state = {
				...state,
				workspace: spec.workspace,
				running: true,
				output: launchHeader,
				commandPreview: spec.displayCommand,
			}
			sync()

			const child = spawn(spec.command, spec.args, {
				cwd: spec.cwd,
				env: { ...process.env, ...(spec.envOverrides ?? {}) },
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			})
			activeChild = child
			let capturedOutput = launchHeader

			child.stdout?.on("data", (chunk) => {
				const text = String(chunk)
				capturedOutput += text
				appendOutput(text)
			})
			child.stderr?.on("data", (chunk) => {
				const text = String(chunk)
				capturedOutput += text
				appendOutput(text)
			})
			return await new Promise((resolve) => {
				child.once("error", async (err) => {
					const errorText = `\n[Shell] Failed to launch CLI: ${err instanceof Error ? err.message : String(err)}\n`
					capturedOutput += errorText
					appendOutput(errorText)
					activeChild = null
					state = { ...state, running: false }
					sync()
					await refreshPanels(spec.workspace)
					resolve({ code: 1, signal: null, output: capturedOutput })
				})
				child.once("close", async (code, signal) => {
					const closeText = `\n[Shell] CLI exited with ${signal ? `signal ${signal}` : `code ${String(code ?? "null")}`}.\n`
					capturedOutput += closeText
					appendOutput(closeText)
					activeChild = null
					state = { ...state, running: false }
					sync()
					await refreshPanels(spec.workspace)
					resolve({ code: typeof code === "number" ? code : null, signal, output: capturedOutput })
				})
			})
		}

		panel.webview.onDidReceiveMessage((message: { type?: string; acquireVsCodeApiPresent?: boolean; templateCount?: number; composerMode?: ComposerMode; message?: string; stack?: string }) => {
			switch (message.type) {
				case "webviewReady": {
					appendSmokeTrace(
						webviewTracePath,
						`webview ready api=${String(message.acquireVsCodeApiPresent)} templates=${String(message.templateCount)} mode=${String(message.composerMode ?? "")}`,
					)
					return
				}
				case "webviewError": {
					appendSmokeTrace(
						webviewTracePath,
						`webview error message=${String(message.message ?? "")} stack=${String(message.stack ?? "")}`,
					)
					void vscode.window.showErrorMessage(`Queenshift Thin Shell webview error: ${String(message.message ?? "unknown error")}`)
					return
				}
				default:
					return
			}
		})

		panel.webview.html = renderHtml(panel.webview, state, context.extensionUri)
		sync()
		void refreshPanels(state.workspace)

		panel.onDidDispose(() => {
			disposed = true
		})

		if (options?.smokeResultPath) {
			try {
				appendSmokeTrace(smokeTracePath, "thin shell smoke started")
				const result = await runThinShellSmoke({
					repoRoot,
					getState,
					refreshPanels,
					launchCliSpec,
				})
				writeSmokeResult(options.smokeResultPath, {
					...result,
					finishedAt: new Date().toISOString(),
				})
				appendSmokeTrace(smokeTracePath, `thin shell smoke completed passed=${String(result.passed)}`)
			} catch (err) {
				appendSmokeTrace(
					smokeTracePath,
					`thin shell smoke failed: ${err instanceof Error ? err.message : String(err)}`,
				)
				writeSmokeResult(options.smokeResultPath, {
					passed: false,
					error: err instanceof Error ? err.message : String(err),
					finishedAt: new Date().toISOString(),
				})
			} finally {
				try {
					panel.dispose()
				} catch {
					// ignore panel disposal failures during smoke cleanup
				}
				setTimeout(() => {
					void vscode.commands.executeCommand("workbench.action.closeWindow")
				}, 250)
			}
			return
		}

		panel.webview.onDidReceiveMessage(
			async (message: {
				type?: string
				task?: string
				workspace?: string
				composerMode?: ComposerMode
				guidedTemplateId?: GuidedTaskTemplateId
				guidedPrimaryTarget?: string
				guidedSecondaryValue?: string
				guidedExpectedOutcome?: string
				acquireVsCodeApiPresent?: boolean
				templateCount?: number
				message?: string
				stack?: string
				runId?: string
				action?: "review:approve" | "review:discard"
				incidentAction?: "incident:latest" | "incident:show" | "incident:rollback"
			}) => {
				switch (message.type) {
					case "browseWorkspace": {
						const selection = await vscode.window.showOpenDialog({
							canSelectFiles: false,
							canSelectFolders: true,
							canSelectMany: false,
							openLabel: "Use Workspace",
							defaultUri: state.workspace ? vscode.Uri.file(state.workspace) : undefined,
						})
						const selectedWorkspace = selection?.[0]?.fsPath
						if (!selectedWorkspace) return
						setState({ workspace: selectedWorkspace }, { refreshPreview: true })
						await refreshPanels(selectedWorkspace, "")
						return
					}
					case "syncComposer": {
						setState(
							{
								task: message.task ?? state.task,
								workspace: message.workspace ?? state.workspace,
								composerMode: message.composerMode ?? state.composerMode,
								guidedTemplateId: message.guidedTemplateId ?? state.guidedTemplateId,
								guidedPrimaryTarget: message.guidedPrimaryTarget ?? state.guidedPrimaryTarget,
								guidedSecondaryValue: message.guidedSecondaryValue ?? state.guidedSecondaryValue,
								guidedExpectedOutcome: message.guidedExpectedOutcome ?? state.guidedExpectedOutcome,
							},
							{ refreshPreview: true },
						)
						return
					}
					case "refreshPanels": {
						await refreshPanels(message.workspace ?? state.workspace)
						return
					}
					case "admit": {
						if (activeChild) {
							void vscode.window.showWarningMessage("A Queenshift thin shell command is already in progress.")
							return
						}

						try {
							const effectiveTask = getEffectiveTask()
							const spec = buildShellAdmissionSpec(repoRoot, effectiveTask, message.workspace ?? state.workspace)
							setState({ workspace: spec.workspace }, { refreshPreview: true })
							const result = await launchCliSpec(spec)
							setState({
								admissionText: result.output.trim() || "No admission output was returned by the CLI.",
							})
						} catch (err) {
							const messageText = err instanceof Error ? err.message : String(err)
							setState({
								running: false,
								admissionText: messageText,
								output: trimOutput(`${state.output}\n[Shell] ${messageText}\n`),
							})
							void vscode.window.showErrorMessage(messageText)
						}
						return
					}
					case "selectReviewItem": {
						await refreshPanels(message.workspace ?? state.workspace, message.runId ?? "")
						return
					}
					case "run": {
						if (activeChild) {
							void vscode.window.showWarningMessage("A Queenshift thin shell command is already in progress.")
							return
						}

						try {
							const effectiveTask = getEffectiveTask()
							const spec = buildOwnerRunSpec(repoRoot, effectiveTask, message.workspace ?? state.workspace, state.composerMode)
							setState({ workspace: spec.workspace }, { refreshPreview: true })
							await launchCliSpec(spec)
						} catch (err) {
							const messageText = err instanceof Error ? err.message : String(err)
							setState({
								running: false,
								output: trimOutput(`${state.output}\n[Shell] ${messageText}\n`),
							})
							void vscode.window.showErrorMessage(messageText)
						}
						return
					}
					case "reviewAction": {
						if (activeChild) {
							void vscode.window.showWarningMessage("A Queenshift thin shell command is already in progress.")
							return
						}

						try {
							const spec = buildShellReviewCommandSpec(
								repoRoot,
								message.action ?? "review:approve",
								message.workspace ?? state.workspace,
								message.runId ?? state.selectedReviewId,
							)
							await launchCliSpec(spec)
						} catch (err) {
							const messageText = err instanceof Error ? err.message : String(err)
							setState({
								running: false,
								output: trimOutput(`${state.output}\n[Shell] ${messageText}\n`),
							})
							void vscode.window.showErrorMessage(messageText)
						}
						return
					}
					case "incidentAction": {
						if (activeChild) {
							void vscode.window.showWarningMessage("A Queenshift thin shell command is already in progress.")
							return
						}

						try {
							const action = (message.action as "incident:latest" | "incident:show" | "incident:rollback") ?? "incident:latest"
							const spec = buildShellIncidentCommandSpec(
								repoRoot,
								action,
								message.workspace ?? state.workspace,
								action === "incident:latest" ? undefined : (message.runId ?? "latest"),
							)
							await launchCliSpec(spec)
						} catch (err) {
							const messageText = err instanceof Error ? err.message : String(err)
							setState({
								running: false,
								output: trimOutput(`${state.output}\n[Shell] ${messageText}\n`),
							})
							void vscode.window.showErrorMessage(messageText)
						}
						return
					}
					default:
						return
				}
			},
		)
	})

	context.subscriptions.push(command)

	const smokeResultPath = (process.env["SWARM_VSCODE_SHELL_SMOKE_RESULT"] ?? "").trim()
	if (process.env["SWARM_VSCODE_SHELL_SMOKE"] === "1" && smokeResultPath) {
		scheduleSmokeLaunch(smokeResultPath, "env")
	}

	const smokeRequestPath = path.join(shellRepoRoot, "verification", ".vscode-shell-smoke-request.json")
	const smokeRequest = readSmokeRequest(smokeRequestPath)
	if (smokeRequest?.resultPath) {
		scheduleSmokeLaunch(smokeRequest.resultPath, "file")
		try {
			fs.unlinkSync(smokeRequestPath)
		} catch {
			// ignore best-effort cleanup failures
		}
	}
}

export function deactivate(): void {
	// No persistent background work; the shell only owns child processes for the lifetime of a visible command.
}
