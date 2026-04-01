import fs from "node:fs"
import path from "node:path"

import { formatQueenshiftCommand, formatQueenshiftWorkspaceCommand } from "../cli/CommandSurface"
import { describeRc1NonCreditReason, resolveRc1RootDir } from "../release/Rc1Ops"
import { runCapturedChildProcess } from "../run/ChildProcessCapture"
import { ensureIncidentPack } from "../run/IncidentPack"
import { findLatestRunSummary, readRunSummary } from "../run/RunArtifacts"
import { buildShellLaunchSpec, type ShellLaunchSpec } from "../shell/ThinShell"
import { formatLowSteeringOwnerLoop } from "./LowSteeringOwnerPath"
import { resolveOwnerGuidedDemoProviderSelection } from "./OwnerGuidedDemo"
import { rememberOwnerCache } from "./OwnerCache"
import {
	OWNER_GUIDED_DEMO_AUTH_MODE,
	OWNER_GUIDED_DEMO_MODEL,
	OWNER_GUIDED_DEMO_PROFILE_ID,
	OWNER_GUIDED_DEMO_PROVIDER,
	OWNER_GUIDED_DEMO_TASK,
	OWNER_GUIDED_DEMO_TIMEOUT_MS,
	ensureCanonicalOwnerGuidedDemoManifest,
} from "./OwnerProfileManifest"

export const DEMO_REPO_PACK_ID = "demo-repo-pack-v1"
export const DEMO_REPO_PACK_SURFACE = "demo_repo_pack"
export const DEMO_REPO_PACK_TEMPLATE_RELATIVE_PATH = path.join("verification", "demo_repo_pack")
export const DEMO_REPO_PACK_WORKSPACE_RELATIVE_PATH = path.join("verification", ".demo_repo_workspace")
export const DEMO_REPO_PACK_RUN_COMMAND = formatQueenshiftCommand(["demo:run"])
export const DEMO_REPO_PACK_RESET_COMMAND = formatQueenshiftCommand(["demo:reset"])
export const DEMO_REPO_PACK_NON_PRODUCTION_REASON = "Disposable demo repo pack is non-production and non-credit by design."

type DemoSummaryLike = {
	taskId?: unknown
	status?: unknown
	stopReason?: unknown
	reviewerVerdict?: unknown
	acceptanceGate?: unknown
	changedFiles?: unknown
	fastLane?: unknown
	replayOverview?: unknown
}

type DemoArtifact = {
	summaryPath: string | null
	summary: DemoSummaryLike | null
}

type DemoIncident = {
	incidentPackPath: string | null
	nextAction: string
	nextActionRationale: string
}

type DemoLaunchResult = {
	code: number | null
	stdout: string
	stderr: string
}

type DemoWorkspaceState = {
	templatePath: string
	workspace: string
	baselineCommit: string
	baselineSubject: string
}

type DemoGitState = {
	latestCommit: string | null
	diffCommand: string
}

export type DemoRepoPackResult = {
	passed: boolean
	failingStep: "profile_manifest" | "provider_defaults" | "workspace_prepare" | "launch" | "artifact_summary" | "run_result" | null
	workspace: string
	templatePath: string
	task: string
	provider: string
	authMode: string
	model: string
	timeoutMs: number
	profileId: string
	manifestPath: string
	manifestHash: string
	nonProduction: boolean
	resetCommand: string
	displayCommand: string | null
	summaryPath: string | null
	incidentPackPath: string | null
	status: string
	stopReason: string
	reviewerVerdict: string
	acceptancePassed: boolean
	changedFiles: string[]
	fastLaneSummary: string | null
	replayOverviewSummary: string | null
	replayHighlights: string[]
	latestCommit: string | null
	diffCommand: string
	creditEligible: boolean
	creditReason: string
	nextAction: string
	nextActionRationale: string
	error: string | null
	rawOutput: string
}

export type DemoRepoResetResult = {
	passed: boolean
	templatePath: string
	workspace: string
	baselineCommit: string | null
	baselineSubject: string | null
	resetCommand: string
	error: string | null
}

type DemoRepoPackDependencies = {
	resetWorkspace?: (rootDir: string) => Promise<DemoWorkspaceState>
	executeLaunch?: (spec: ShellLaunchSpec, timeoutMs: number) => Promise<DemoLaunchResult>
	readLatestArtifact?: (workspace: string, startedAtMs: number) => DemoArtifact
	buildIncident?: (workspace: string, runId: string) => Promise<DemoIncident>
	readGitState?: (workspace: string) => Promise<DemoGitState>
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

async function runGitCapture(workspace: string, args: string[], timeoutMs = 20_000): Promise<string> {
	const result = await runCapturedChildProcess({
		command: "git",
		args: ["-c", `safe.directory=${workspace}`, ...args],
		cwd: workspace,
		timeoutMs,
		captureRoot: path.join(path.dirname(workspace), ".demo_git_tmp"),
		label: "demo-git",
	})
	if (result.code === 0) return result.stdout
	throw new Error(`git ${args.join(" ")} failed (exit ${result.code ?? "null"})\n${result.stderr || result.stdout}`.trim())
}

function parseCommitLine(raw: string): { hash: string; subject: string } {
	const line = raw
		.split(/\r?\n/g)
		.map((entry) => entry.trim())
		.find(Boolean)
	if (!line || !line.includes("\t")) {
		return { hash: "", subject: "" }
	}
	const [hash, subject] = line.split("\t")
	return {
		hash: hash?.trim() ?? "",
		subject: subject?.trim() ?? "",
	}
}

async function stageDemoWorkspace(rootDir: string): Promise<DemoWorkspaceState> {
	const templatePath = path.join(rootDir, DEMO_REPO_PACK_TEMPLATE_RELATIVE_PATH)
	const workspace = path.join(rootDir, DEMO_REPO_PACK_WORKSPACE_RELATIVE_PATH)

	if (!fs.existsSync(templatePath)) {
		throw new Error(`Demo repo template is missing: ${templatePath}`)
	}
	if (!fs.existsSync(path.join(templatePath, "hello.ts"))) {
		throw new Error(`Demo repo template must include hello.ts: ${templatePath}`)
	}
	if (!fs.existsSync(path.join(templatePath, "package.json"))) {
		throw new Error(`Demo repo template must include package.json: ${templatePath}`)
	}

	if (fs.existsSync(workspace)) {
		fs.rmSync(workspace, { recursive: true, force: true })
	}

	fs.mkdirSync(path.dirname(workspace), { recursive: true })
	fs.cpSync(templatePath, workspace, { recursive: true, force: true })

	await runGitCapture(workspace, ["init"])
	await runGitCapture(workspace, ["config", "user.name", "SwarmCoder Demo"])
	await runGitCapture(workspace, ["config", "user.email", "demo@local.invalid"])
	await runGitCapture(workspace, ["add", "-A"])
	await runGitCapture(workspace, ["commit", "-m", "demo: baseline"])

	const commit = parseCommitLine(await runGitCapture(workspace, ["log", "-1", "--format=%H%x09%s"]))
	if (!commit.hash || !commit.subject) {
		throw new Error(`Demo repo workspace did not produce a readable baseline commit: ${workspace}`)
	}

	const status = await runGitCapture(workspace, ["status", "--short", "--untracked-files=all"])
	if (status.trim()) {
		throw new Error(`Demo repo workspace stayed dirty after reset: ${status.trim()}`)
	}

	return {
		templatePath,
		workspace,
		baselineCommit: commit.hash,
		baselineSubject: commit.subject,
	}
}

async function executeDemoLaunch(spec: ShellLaunchSpec, timeoutMs: number): Promise<DemoLaunchResult> {
	return await runCapturedChildProcess({
		command: spec.command,
		args: spec.args,
		cwd: spec.cwd,
		env: {
			...process.env,
			...spec.envOverrides,
		},
		timeoutMs,
		captureRoot: path.join(spec.cwd, "verification", ".tmp-launch-capture"),
		label: "demo-launch",
	})
}

function readLatestRunArtifactAfter(workspace: string, startedAtMs: number): DemoArtifact {
	const summaryPath = findLatestRunSummary(workspace)
	if (!summaryPath || !fs.existsSync(summaryPath)) {
		return { summaryPath: null, summary: null }
	}

	const stat = fs.statSync(summaryPath)
	if (stat.mtimeMs + 2_000 < startedAtMs) {
		return { summaryPath: null, summary: null }
	}

	return {
		summaryPath,
		summary: readRunSummary(path.dirname(summaryPath)) as DemoSummaryLike | null,
	}
}

async function buildDemoIncident(workspace: string, runId: string): Promise<DemoIncident> {
	const pack = await ensureIncidentPack(workspace, runId)
	return {
		incidentPackPath: pack.artifacts.incidentPackPath,
		nextAction: pack.nextAction.label,
		nextActionRationale: pack.nextAction.rationale,
	}
}

async function readDemoGitState(workspace: string): Promise<DemoGitState> {
	const commit = parseCommitLine(await runGitCapture(workspace, ["log", "-1", "--format=%H%x09%s"]))
	const diffCommand = `git -C "${workspace}" show --stat HEAD`
	return {
		latestCommit: commit.hash && commit.subject ? `${commit.hash.slice(0, 7)} ${commit.subject}` : null,
		diffCommand,
	}
}

function acceptancePassed(summary: DemoSummaryLike | null): boolean {
	const acceptanceGate = asRecord(summary?.acceptanceGate)
	return acceptanceGate?.["passed"] === true
}

function summarizeReplayOverview(summary: DemoSummaryLike | null): { summary: string | null; highlights: string[] } {
	const replayOverview = asRecord(summary?.replayOverview)
	if (!replayOverview) {
		return {
			summary: null,
			highlights: [],
		}
	}
	const planning = asString(replayOverview["planningSummary"]) ?? "planning=not recorded"
	const coordination = asString(replayOverview["coordinationSummary"]) ?? "coordination=not recorded"
	const review = asString(replayOverview["reviewSummary"]) ?? "review=not recorded"
	return {
		summary: `${planning} | ${coordination} | ${review}`,
		highlights: asStringArray(replayOverview["highlights"]),
	}
}

function summarizeFastLane(summary: DemoSummaryLike | null): string | null {
	const fastLane = asRecord(summary?.fastLane)
	if (!fastLane) return null
	const laneId = asString(fastLane["laneId"]) ?? "unknown_fast_lane"
	const predictability = asString(fastLane["predictability"]) ?? "unknown"
	const workItems = typeof fastLane["expectedWorkItems"] === "number" ? fastLane["expectedWorkItems"] : "?"
	const builders = typeof fastLane["expectedBuilderCount"] === "number" ? fastLane["expectedBuilderCount"] : "?"
	return `${laneId} | predictability=${predictability} | workItems=${workItems} | builders=${builders}`
}

function summarizeCredit(rootDir: string, workspace: string): { eligible: boolean; reason: string } {
	const nonCreditReason = describeRc1NonCreditReason(rootDir, workspace, DEMO_REPO_PACK_SURFACE) ?? DEMO_REPO_PACK_NON_PRODUCTION_REASON
	return {
		eligible: false,
		reason: nonCreditReason,
	}
}

function baseResult(rootDir: string, workspace: string, templatePath: string, manifestPath: string, manifestHash: string): DemoRepoPackResult {
	const credit = summarizeCredit(rootDir, workspace)
	return {
		passed: false,
		failingStep: null,
		workspace,
		templatePath,
		task: OWNER_GUIDED_DEMO_TASK,
		provider: OWNER_GUIDED_DEMO_PROVIDER,
		authMode: OWNER_GUIDED_DEMO_AUTH_MODE,
		model: OWNER_GUIDED_DEMO_MODEL,
		timeoutMs: OWNER_GUIDED_DEMO_TIMEOUT_MS,
		profileId: OWNER_GUIDED_DEMO_PROFILE_ID,
		manifestPath,
		manifestHash,
		nonProduction: true,
		resetCommand: DEMO_REPO_PACK_RESET_COMMAND,
		displayCommand: null,
		summaryPath: null,
		incidentPackPath: null,
		status: "not_started",
		stopReason: "not_started",
		reviewerVerdict: "missing",
		acceptancePassed: false,
		changedFiles: [],
		fastLaneSummary: null,
		replayOverviewSummary: null,
		replayHighlights: [],
		latestCommit: null,
		diffCommand: `git -C "${workspace}" show --stat HEAD`,
		creditEligible: credit.eligible,
		creditReason: credit.reason,
		nextAction: "Run the disposable demo pack when the provider path is ready.",
		nextActionRationale: "The demo pack did not start yet.",
		error: null,
		rawOutput: "",
	}
}

export async function resetDemoRepoPack(rootDir = resolveRc1RootDir(__dirname)): Promise<DemoRepoResetResult> {
	const templatePath = path.join(rootDir, DEMO_REPO_PACK_TEMPLATE_RELATIVE_PATH)
	const workspace = path.join(rootDir, DEMO_REPO_PACK_WORKSPACE_RELATIVE_PATH)
	try {
		const staged = await stageDemoWorkspace(rootDir)
		return {
			passed: true,
			templatePath: staged.templatePath,
			workspace: staged.workspace,
			baselineCommit: staged.baselineCommit,
			baselineSubject: staged.baselineSubject,
			resetCommand: DEMO_REPO_PACK_RESET_COMMAND,
			error: null,
		}
	} catch (err) {
		return {
			passed: false,
			templatePath,
			workspace,
			baselineCommit: null,
			baselineSubject: null,
			resetCommand: DEMO_REPO_PACK_RESET_COMMAND,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

export async function runDemoRepoPack(
	rootDir = resolveRc1RootDir(__dirname),
	env: Record<string, string | undefined> = process.env,
	deps: DemoRepoPackDependencies = {},
): Promise<DemoRepoPackResult> {
	const templatePath = path.join(rootDir, DEMO_REPO_PACK_TEMPLATE_RELATIVE_PATH)
	const workspace = path.join(rootDir, DEMO_REPO_PACK_WORKSPACE_RELATIVE_PATH)
	const manifestCheck = ensureCanonicalOwnerGuidedDemoManifest(rootDir)
	const initial = baseResult(rootDir, workspace, templatePath, manifestCheck.manifestPath, manifestCheck.manifest.manifestHash)

	if (manifestCheck.driftDetected) {
		return {
			...initial,
			failingStep: "profile_manifest",
			stopReason: "profile_manifest_drift",
			nextAction: "Restore the canonical owner profile manifest before retrying the demo pack.",
			nextActionRationale: "The demo pack reuses the frozen guided-demo provider and task profile and fails closed on manifest drift.",
			error: manifestCheck.driftReasons.join(" | "),
		}
	}

	const providerSelection = resolveOwnerGuidedDemoProviderSelection(env)
	if (!providerSelection.ready) {
		return {
			...initial,
			failingStep: "provider_defaults",
			stopReason: "provider_not_ready",
			nextAction: `Run ${formatQueenshiftCommand(["doctor"])}, sign in to Gemini CLI once if needed, and retry ${DEMO_REPO_PACK_RUN_COMMAND}.`,
			nextActionRationale: "The disposable demo pack stays on the same known-good provider path as the frozen guided demo.",
			error: providerSelection.reason,
		}
	}

	let stagedWorkspace: DemoWorkspaceState
	try {
		stagedWorkspace = await (deps.resetWorkspace ?? stageDemoWorkspace)(rootDir)
	} catch (err) {
		return {
			...initial,
			failingStep: "workspace_prepare",
			stopReason: "workspace_prepare_failed",
			nextAction: "Repair the checked-in demo repo pack before retrying.",
			nextActionRationale: "The disposable demo workspace could not be recreated from the template pack.",
			error: err instanceof Error ? err.message : String(err),
		}
	}

	const launchSpec = buildShellLaunchSpec(rootDir, OWNER_GUIDED_DEMO_TASK, stagedWorkspace.workspace, {
		extraArgs: ["--provider", OWNER_GUIDED_DEMO_PROVIDER, "--model", OWNER_GUIDED_DEMO_MODEL],
		extraDisplayArgs: ["--provider", OWNER_GUIDED_DEMO_PROVIDER, "--model", OWNER_GUIDED_DEMO_MODEL],
		envOverrides: {
			...providerSelection.envOverrides,
			SWARM_RUN_SURFACE: DEMO_REPO_PACK_SURFACE,
			SWARM_OWNER_PROFILE_ID: manifestCheck.manifest.profileId,
			SWARM_OWNER_PROFILE_MANIFEST_HASH: manifestCheck.manifest.manifestHash,
		},
	})

	const startedAtMs = Date.now()
	let launchResult: DemoLaunchResult
	try {
		launchResult = await (deps.executeLaunch ?? executeDemoLaunch)(launchSpec, providerSelection.timeoutMs + 60_000)
	} catch (err) {
		return {
			...initial,
			workspace: stagedWorkspace.workspace,
			templatePath: stagedWorkspace.templatePath,
			displayCommand: launchSpec.displayCommand,
			failingStep: "launch",
			stopReason: "launcher_failed",
			nextAction: `Run ${DEMO_REPO_PACK_RESET_COMMAND}, then ${formatQueenshiftCommand(["doctor"])} if provider setup is unclear, and retry ${DEMO_REPO_PACK_RUN_COMMAND}.`,
			nextActionRationale: "The disposable demo workspace was staged, but the launcher could not hand off into the real CLI path cleanly.",
			error: err instanceof Error ? err.message : String(err),
		}
	}

	const artifact = (deps.readLatestArtifact ?? readLatestRunArtifactAfter)(stagedWorkspace.workspace, startedAtMs)
	const rawOutput = [launchResult.stdout.trim(), launchResult.stderr.trim()].filter(Boolean).join("\n")
	if (!artifact.summaryPath || !artifact.summary) {
		return {
			...initial,
			workspace: stagedWorkspace.workspace,
			templatePath: stagedWorkspace.templatePath,
			displayCommand: launchSpec.displayCommand,
			failingStep: "artifact_summary",
			stopReason: "summary_missing",
			nextAction: "Inspect the staged demo workspace for the missing summary artifact.",
			nextActionRationale: "The CLI handoff returned, but the staged demo workspace did not record a fresh summary.json.",
			error: `CLI exit code ${launchResult.code ?? "null"} completed without a fresh summary artifact.`,
			rawOutput,
		}
	}

	const status = typeof artifact.summary.status === "string" ? artifact.summary.status : "unknown"
	const stopReason = typeof artifact.summary.stopReason === "string" ? artifact.summary.stopReason : "unknown"
	const reviewerVerdict = typeof artifact.summary.reviewerVerdict === "string" ? artifact.summary.reviewerVerdict : "missing"
	const changedFiles = asStringArray(artifact.summary.changedFiles)
	const fastLaneSummary = summarizeFastLane(artifact.summary)
	const replayOverview = summarizeReplayOverview(artifact.summary)
	const gitState = await (deps.readGitState ?? readDemoGitState)(stagedWorkspace.workspace)
	const passed = status === "done"

	let nextAction = "Inspect the staged demo repo or rerun the reset command for a fresh copy."
	let nextActionRationale = "The disposable demo lane completed and left a small repo plus the normal run artifact behind."
	let incidentPackPath: string | null = null
	let error: string | null = null
	let failingStep: DemoRepoPackResult["failingStep"] = null

	if (!passed) {
		failingStep = "run_result"
		error = `The disposable demo ended ${status} (${stopReason}).`
		const runId = typeof artifact.summary.taskId === "string" ? artifact.summary.taskId : ""
		if (runId) {
			try {
				const incident = await (deps.buildIncident ?? buildDemoIncident)(stagedWorkspace.workspace, runId)
				incidentPackPath = incident.incidentPackPath
				nextAction = incident.nextAction
				nextActionRationale = incident.nextActionRationale
			} catch {
				nextAction = "Inspect the summary artifact before retrying."
				nextActionRationale = "The run did not finish cleanly, and no incident pack could be derived automatically."
			}
		}
	}

	const result: DemoRepoPackResult = {
		...initial,
		passed,
		failingStep,
		workspace: stagedWorkspace.workspace,
		templatePath: stagedWorkspace.templatePath,
		displayCommand: launchSpec.displayCommand,
		summaryPath: artifact.summaryPath,
		incidentPackPath,
		status,
		stopReason,
		reviewerVerdict,
		acceptancePassed: acceptancePassed(artifact.summary),
		changedFiles,
		fastLaneSummary,
		replayOverviewSummary: replayOverview.summary,
		replayHighlights: replayOverview.highlights,
		latestCommit: gitState.latestCommit,
		diffCommand: gitState.diffCommand,
		nextAction,
		nextActionRationale,
		error,
		rawOutput,
	}

	if (result.passed) {
		rememberOwnerCache(rootDir, {
			workspace: stagedWorkspace.workspace,
			provider: providerSelection.provider,
			authMode: providerSelection.authMode,
			model: providerSelection.model,
			composerMode: "guided",
			guidedTemplateId: "comment_file",
			starterSurface: DEMO_REPO_PACK_SURFACE,
			profileId: manifestCheck.manifest.profileId,
			manifestHash: manifestCheck.manifest.manifestHash,
		})
	}

	return result
}

export function formatDemoRepoResetResult(result: DemoRepoResetResult): string {
	return [
		`Demo workspace reset: ${result.passed ? "PASS" : "FAIL"}`,
		`Template: ${result.templatePath}`,
		`Workspace: ${result.workspace}`,
		`Reset command: ${result.resetCommand}`,
		...(result.baselineCommit ? [`Baseline commit: ${result.baselineCommit.slice(0, 7)} ${result.baselineSubject ?? ""}`.trim()] : []),
		...(result.error ? [`Error: ${result.error}`] : []),
	].join("\n")
}

export function formatDemoRepoPackResult(result: DemoRepoPackResult, options: { debug?: boolean } = {}): string {
	const replayCommand = formatQueenshiftWorkspaceCommand(["replay:latest"], result.workspace)
	const incidentCommand = formatQueenshiftWorkspaceCommand(["incident:latest"], result.workspace)
	return [
		`Disposable demo: ${result.passed ? "PASS" : "FAIL"}`,
		...(result.failingStep ? [`Failing step: ${result.failingStep}`] : []),
		`Template: ${result.templatePath}`,
		`Workspace: ${result.workspace}`,
		`Non-production: ${result.nonProduction ? "yes" : "no"}`,
		`Provider: ${result.provider} (${result.authMode})`,
		`Model: ${result.model}`,
		`Timeout envelope: ${result.timeoutMs}ms`,
		`Task: ${result.task}`,
		`Profile source: ${result.profileId}`,
		`Manifest: ${result.manifestPath}`,
		`Manifest hash: ${result.manifestHash}`,
		`Credit lane: ${result.creditEligible ? "credit-eligible" : `non-credit -> ${result.creditReason}`}`,
		`Reset command: ${result.resetCommand}`,
		...(result.displayCommand ? [`Command: ${result.displayCommand}`] : []),
		`Summary: ${result.summaryPath ?? "(missing)"}`,
		...(result.incidentPackPath ? [`Incident: ${result.incidentPackPath}`] : []),
		`Terminal status: ${result.status}`,
		`Stop reason: ${result.stopReason}`,
		`Reviewer verdict: ${result.reviewerVerdict}`,
		`Acceptance gate: ${result.acceptancePassed ? "passed" : "not passed"}`,
		`Changed files: ${result.changedFiles.join(", ") || "(none recorded)"}`,
		`Fast lane: ${result.fastLaneSummary ?? "not recorded"}`,
		`Replay overview: ${result.replayOverviewSummary ?? "not recorded"}`,
		...(result.replayHighlights.length > 0 ? [`Replay highlights: ${result.replayHighlights.join(" | ")}`] : []),
		`Latest commit: ${result.latestCommit ?? "(missing)"}`,
		`Diff command: ${result.diffCommand}`,
		`Replay command: ${replayCommand}`,
		formatLowSteeringOwnerLoop(result.workspace),
		`Next action: ${result.nextAction}`,
		`Why: ${result.nextActionRationale}`,
		...(!result.passed ? [`Incident command: ${incidentCommand}`, `Provider diagnose: ${formatQueenshiftCommand(["doctor"])}`] : []),
		...(result.error ? [`Error: ${result.error}`] : []),
		...(options.debug && result.rawOutput.trim().length > 0 ? ["", "Raw output:", result.rawOutput.trim()] : []),
	].join("\n")
}
