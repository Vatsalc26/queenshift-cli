import fs from "node:fs"
import path from "node:path"

import { formatQueenshiftCommand } from "../cli/CommandSurface"
import { ensureIncidentPack } from "../run/IncidentPack"
import { runCapturedChildProcess } from "../run/ChildProcessCapture"
import { findLatestRunSummary, readRunSummary } from "../run/RunArtifacts"
import { describeRc1NonCreditReason, resolveRc1RootDir } from "../release/Rc1Ops"
import { buildShellLaunchSpec, type ShellLaunchSpec } from "../shell/ThinShell"
import { detectGeminiCliOauthPath } from "./ProviderResolution"
import { rememberOwnerCache } from "./OwnerCache"
import {
	OWNER_GUIDED_DEMO_AUTH_MODE,
	OWNER_GUIDED_DEMO_MODEL,
	OWNER_GUIDED_DEMO_NON_CREDIT_REASON,
	OWNER_GUIDED_DEMO_PROFILE_ID,
	OWNER_GUIDED_DEMO_PROVIDER,
	OWNER_GUIDED_DEMO_SURFACE,
	OWNER_GUIDED_DEMO_TASK,
	OWNER_GUIDED_DEMO_TIMEOUT_MS,
	OWNER_GUIDED_DEMO_WORKSPACE_RELATIVE_PATH,
	ensureCanonicalOwnerGuidedDemoManifest,
} from "./OwnerProfileManifest"

type GuidedDemoSummaryLike = {
	taskId?: unknown
	status?: unknown
	stopReason?: unknown
	reviewerVerdict?: unknown
	acceptanceGate?: unknown
}

type GuidedDemoArtifact = {
	summaryPath: string | null
	summary: GuidedDemoSummaryLike | null
}

type GuidedDemoIncident = {
	incidentPackPath: string | null
	nextAction: string
	nextActionRationale: string
}

type GuidedDemoLaunchResult = {
	code: number | null
	stdout: string
	stderr: string
}

export type OwnerGuidedDemoProviderSelection = {
	provider: string
	authMode: string
	model: string
	timeoutMs: number
	oauthPath: string | null
	ready: boolean
	reason: string
	envOverrides: Record<string, string>
}

export type OwnerGuidedDemoResult = {
	passed: boolean
	failingStep: "provider_defaults" | "profile_manifest" | "workspace_prepare" | "launch" | "artifact_summary" | "run_result" | null
	workspace: string
	task: string
	provider: string
	authMode: string
	model: string
	timeoutMs: number
	profileId: string
	manifestPath: string
	manifestHash: string
	displayCommand: string | null
	summaryPath: string | null
	incidentPackPath: string | null
	status: string
	stopReason: string
	reviewerVerdict: string
	acceptancePassed: boolean
	creditEligible: boolean
	creditReason: string
	nextAction: string
	nextActionRationale: string
	error: string | null
	rawOutput: string
}

type OwnerGuidedDemoDependencies = {
	prepareWorkspace?: (workspace: string) => Promise<void>
	executeLaunch?: (spec: ShellLaunchSpec, timeoutMs: number) => Promise<GuidedDemoLaunchResult>
	readLatestArtifact?: (workspace: string, startedAtMs: number) => GuidedDemoArtifact
	buildIncident?: (workspace: string, runId: string) => Promise<GuidedDemoIncident>
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

async function runGitCapture(workspace: string, args: string[], timeoutMs = 20_000): Promise<string> {
	const result = await runCapturedChildProcess({
		command: "git",
		args: ["-c", `safe.directory=${workspace}`, ...args],
		cwd: workspace,
		timeoutMs,
		captureRoot: path.join(path.dirname(workspace), ".owner_guided_demo_git_tmp"),
		label: "owner-guided-demo-git",
	})
	if (result.code === 0) return result.stdout
	throw new Error(`git ${args.join(" ")} failed (exit ${result.code ?? "null"})\n${result.stderr || result.stdout}`.trim())
}

async function prepareOwnerGuidedDemoWorkspace(workspace: string): Promise<void> {
	if (!fs.existsSync(workspace)) {
		throw new Error(`Canonical demo workspace is missing: ${workspace}`)
	}
	if (!fs.existsSync(path.join(workspace, ".git"))) {
		throw new Error(`Canonical demo workspace is not a git repo: ${workspace}`)
	}

	const logOutput = await runGitCapture(workspace, ["log", "--format=%H%x09%s"])
	const baselineLine = logOutput
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.find((line) => line.includes("\t") && line.split("\t")[1]?.startsWith("dogfood:"))
	if (!baselineLine) {
		throw new Error(`Canonical demo workspace is missing a dogfood baseline commit in ${workspace}`)
	}
	const [baselineCommit] = baselineLine.split("\t")
	if (!baselineCommit) {
		throw new Error(`Canonical demo workspace baseline commit could not be parsed from ${workspace}`)
	}
	await runGitCapture(workspace, ["reset", "--hard", baselineCommit])
	await runGitCapture(workspace, ["clean", "-fdx"])
	const status = await runGitCapture(workspace, ["status", "--short", "--untracked-files=all"])
	if (status.trim()) {
		throw new Error(`Canonical demo workspace stayed dirty after reset: ${status.trim()}`)
	}
}

async function executeOwnerGuidedDemoLaunch(spec: ShellLaunchSpec, timeoutMs: number): Promise<GuidedDemoLaunchResult> {
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
		label: "owner-guided-demo-launch",
	})
}

function readLatestRunArtifactAfter(workspace: string, startedAtMs: number): GuidedDemoArtifact {
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
		summary: readRunSummary(path.dirname(summaryPath)) as GuidedDemoSummaryLike | null,
	}
}

async function buildGuidedDemoIncident(workspace: string, runId: string): Promise<GuidedDemoIncident> {
	const pack = await ensureIncidentPack(workspace, runId)
	return {
		incidentPackPath: pack.artifacts.incidentPackPath,
		nextAction: pack.nextAction.label,
		nextActionRationale: pack.nextAction.rationale,
	}
}

function acceptancePassed(summary: GuidedDemoSummaryLike | null): boolean {
	const acceptanceGate = asRecord(summary?.acceptanceGate)
	return acceptanceGate?.["passed"] === true
}

function summarizeCredit(rootDir: string, workspace: string): { eligible: boolean; reason: string } {
	const nonCreditReason = describeRc1NonCreditReason(rootDir, workspace, OWNER_GUIDED_DEMO_SURFACE) ?? OWNER_GUIDED_DEMO_NON_CREDIT_REASON
	return {
		eligible: false,
		reason: nonCreditReason,
	}
}

function baseResult(rootDir: string, workspace: string, manifestPath: string, manifestHash: string): OwnerGuidedDemoResult {
	const credit = summarizeCredit(rootDir, workspace)
	return {
		passed: false,
		failingStep: null,
		workspace,
		task: OWNER_GUIDED_DEMO_TASK,
		provider: OWNER_GUIDED_DEMO_PROVIDER,
		authMode: OWNER_GUIDED_DEMO_AUTH_MODE,
		model: OWNER_GUIDED_DEMO_MODEL,
		timeoutMs: OWNER_GUIDED_DEMO_TIMEOUT_MS,
		profileId: OWNER_GUIDED_DEMO_PROFILE_ID,
		manifestPath,
		manifestHash,
		displayCommand: null,
		summaryPath: null,
		incidentPackPath: null,
		status: "not_started",
		stopReason: "not_started",
		reviewerVerdict: "missing",
		acceptancePassed: false,
		creditEligible: credit.eligible,
		creditReason: credit.reason,
		nextAction: "Run the deterministic launcher checks before retrying.",
		nextActionRationale: "The guided demo did not start yet.",
		error: null,
		rawOutput: "",
	}
}

export function resolveOwnerGuidedDemoProviderSelection(
	env: Record<string, string | undefined> = process.env,
): OwnerGuidedDemoProviderSelection {
	const oauthPath = detectGeminiCliOauthPath(env)
	if (!oauthPath) {
		return {
			provider: OWNER_GUIDED_DEMO_PROVIDER,
			authMode: OWNER_GUIDED_DEMO_AUTH_MODE,
			model: OWNER_GUIDED_DEMO_MODEL,
			timeoutMs: OWNER_GUIDED_DEMO_TIMEOUT_MS,
			oauthPath: null,
			ready: false,
			reason:
				"owner:guided:demo requires Gemini CLI OAuth credentials. Sign in once with Gemini CLI, or point GEMINI_CLI_OAUTH_PATH at a valid oauth_creds.json file.",
			envOverrides: {},
		}
	}

	return {
		provider: OWNER_GUIDED_DEMO_PROVIDER,
		authMode: OWNER_GUIDED_DEMO_AUTH_MODE,
		model: OWNER_GUIDED_DEMO_MODEL,
		timeoutMs: OWNER_GUIDED_DEMO_TIMEOUT_MS,
		oauthPath,
		ready: true,
		reason: `Using canonical Gemini CLI OAuth profile at ${oauthPath}.`,
		envOverrides: {
			SWARM_PROVIDER: OWNER_GUIDED_DEMO_PROVIDER,
			SWARM_GEMINI_AUTH: OWNER_GUIDED_DEMO_AUTH_MODE,
			SWARM_MODEL: OWNER_GUIDED_DEMO_MODEL,
			GEMINI_CLI_TIMEOUT_MS: String(OWNER_GUIDED_DEMO_TIMEOUT_MS),
			GEMINI_CLI_OAUTH_PATH: oauthPath,
			SWARM_RUN_SURFACE: OWNER_GUIDED_DEMO_SURFACE,
		},
	}
}

export async function runOwnerGuidedDemo(
	rootDir = resolveRc1RootDir(__dirname),
	env: Record<string, string | undefined> = process.env,
	deps: OwnerGuidedDemoDependencies = {},
): Promise<OwnerGuidedDemoResult> {
	const workspace = path.join(rootDir, OWNER_GUIDED_DEMO_WORKSPACE_RELATIVE_PATH)
	const manifestCheck = ensureCanonicalOwnerGuidedDemoManifest(rootDir)
	const initial = baseResult(rootDir, workspace, manifestCheck.manifestPath, manifestCheck.manifest.manifestHash)

	if (manifestCheck.driftDetected) {
		return {
			...initial,
			failingStep: "profile_manifest",
			stopReason: "profile_manifest_drift",
			nextAction: "Restore the canonical owner profile manifest before retrying.",
			nextActionRationale: "The frozen owner profile drifted and the launcher fails closed on that boundary.",
			error: manifestCheck.driftReasons.join(" | "),
		}
	}

	const providerSelection = resolveOwnerGuidedDemoProviderSelection(env)
	if (!providerSelection.ready) {
		return {
			...initial,
			failingStep: "provider_defaults",
			stopReason: "provider_not_ready",
			nextAction: `Run ${formatQueenshiftCommand(["doctor"])}, sign in to Gemini CLI once if needed, and retry ${formatQueenshiftCommand(["owner:guided:demo"])}.`,
			nextActionRationale: "The frozen launcher profile uses one known-good provider path only.",
			error: providerSelection.reason,
		}
	}

	const launchSpec = buildShellLaunchSpec(rootDir, OWNER_GUIDED_DEMO_TASK, workspace, {
		extraArgs: ["--provider", OWNER_GUIDED_DEMO_PROVIDER, "--model", OWNER_GUIDED_DEMO_MODEL],
		extraDisplayArgs: ["--provider", OWNER_GUIDED_DEMO_PROVIDER, "--model", OWNER_GUIDED_DEMO_MODEL],
		envOverrides: {
			...providerSelection.envOverrides,
			SWARM_OWNER_PROFILE_ID: manifestCheck.manifest.profileId,
			SWARM_OWNER_PROFILE_MANIFEST_HASH: manifestCheck.manifest.manifestHash,
		},
	})

	try {
		await (deps.prepareWorkspace ?? prepareOwnerGuidedDemoWorkspace)(workspace)
	} catch (err) {
		return {
			...initial,
			displayCommand: launchSpec.displayCommand,
			failingStep: "workspace_prepare",
			stopReason: "workspace_prepare_failed",
			nextAction: "Repair the canonical demo workspace before retrying.",
			nextActionRationale: "The launcher could not reset the frozen demo repo to its known-good baseline.",
			error: err instanceof Error ? err.message : String(err),
		}
	}

	const startedAtMs = Date.now()
	let launchResult: GuidedDemoLaunchResult
	try {
		launchResult = await (deps.executeLaunch ?? executeOwnerGuidedDemoLaunch)(launchSpec, providerSelection.timeoutMs + 60_000)
	} catch (err) {
		return {
			...initial,
			displayCommand: launchSpec.displayCommand,
			failingStep: "launch",
			stopReason: "launcher_failed",
			nextAction: `Run ${formatQueenshiftCommand(["doctor"])} and retry ${formatQueenshiftCommand(["owner:guided:demo"])}.`,
			nextActionRationale: "The wrapper could not complete the handoff into the real CLI path cleanly.",
			error: err instanceof Error ? err.message : String(err),
		}
	}

	const artifact = (deps.readLatestArtifact ?? readLatestRunArtifactAfter)(workspace, startedAtMs)
	const rawOutput = [launchResult.stdout.trim(), launchResult.stderr.trim()].filter(Boolean).join("\n")
	if (!artifact.summaryPath || !artifact.summary) {
		return {
			...initial,
			displayCommand: launchSpec.displayCommand,
			failingStep: "artifact_summary",
			stopReason: "summary_missing",
			nextAction: "Inspect the canonical demo workspace for the missing run artifact.",
			nextActionRationale: "The CLI handoff returned, but no fresh summary.json was recorded for this run.",
			error: `CLI exit code ${launchResult.code ?? "null"} completed without a fresh summary artifact.`,
			rawOutput,
		}
	}

	const status = typeof artifact.summary.status === "string" ? artifact.summary.status : "unknown"
	const stopReason = typeof artifact.summary.stopReason === "string" ? artifact.summary.stopReason : "unknown"
	const reviewerVerdict = typeof artifact.summary.reviewerVerdict === "string" ? artifact.summary.reviewerVerdict : "missing"
	const passed = status === "done"

	let nextAction = "Open the summary artifact if you want the full run details."
	let nextActionRationale = "The launcher completed the frozen demo lane successfully."
	let incidentPackPath: string | null = null
	let error: string | null = null
	let failingStep: OwnerGuidedDemoResult["failingStep"] = null

	if (!passed) {
		failingStep = "run_result"
		error = `The canonical demo ended ${status} (${stopReason}).`
		const runId = typeof artifact.summary.taskId === "string" ? artifact.summary.taskId : ""
		if (runId) {
			try {
				const incident = await (deps.buildIncident ?? buildGuidedDemoIncident)(workspace, runId)
				incidentPackPath = incident.incidentPackPath
				nextAction = incident.nextAction
				nextActionRationale = incident.nextActionRationale
			} catch {
				nextAction = "Inspect the summary artifact before retrying."
				nextActionRationale = "The run did not finish cleanly, and no incident pack could be derived automatically."
			}
		}
	}

	const result: OwnerGuidedDemoResult = {
		...initial,
		passed,
		failingStep,
		displayCommand: launchSpec.displayCommand,
		summaryPath: artifact.summaryPath,
		incidentPackPath,
		status,
		stopReason,
		reviewerVerdict,
		acceptancePassed: acceptancePassed(artifact.summary),
		nextAction,
		nextActionRationale,
		error,
		rawOutput,
	}

	if (result.passed) {
		rememberOwnerCache(rootDir, {
			workspace,
			provider: providerSelection.provider,
			authMode: providerSelection.authMode,
			model: providerSelection.model,
			composerMode: "guided",
			guidedTemplateId: "comment_file",
			starterSurface: OWNER_GUIDED_DEMO_SURFACE,
			profileId: manifestCheck.manifest.profileId,
			manifestHash: manifestCheck.manifest.manifestHash,
		})
	}

	return result
}

export function formatOwnerGuidedDemoResult(result: OwnerGuidedDemoResult, options: { debug?: boolean } = {}): string {
	return [
		`Owner guided demo: ${result.passed ? "PASS" : "FAIL"}`,
		...(result.failingStep ? [`Failing step: ${result.failingStep}`] : []),
		`Workspace: ${result.workspace}`,
		`Provider: ${result.provider} (${result.authMode})`,
		`Model: ${result.model}`,
		`Timeout envelope: ${result.timeoutMs}ms`,
		`Task: ${result.task}`,
		`Profile: ${result.profileId}`,
		`Manifest: ${result.manifestPath}`,
		`Manifest hash: ${result.manifestHash}`,
		`Credit lane: ${result.creditEligible ? "credit-eligible" : `non-credit -> ${result.creditReason}`}`,
		...(result.displayCommand ? [`Command: ${result.displayCommand}`] : []),
		`Summary: ${result.summaryPath ?? "(missing)"}`,
		...(result.incidentPackPath ? [`Incident: ${result.incidentPackPath}`] : []),
		`Terminal status: ${result.status}`,
		`Stop reason: ${result.stopReason}`,
		`Reviewer verdict: ${result.reviewerVerdict}`,
		`Acceptance gate: ${result.acceptancePassed ? "passed" : "not passed"}`,
		...(!result.passed ? [`Provider diagnose: ${formatQueenshiftCommand(["doctor"])}`] : []),
		`Next action: ${result.nextAction}`,
		`Why: ${result.nextActionRationale}`,
		...(result.error ? [`Error: ${result.error}`] : []),
		...(options.debug && result.rawOutput.trim().length > 0 ? ["", "Raw output:", result.rawOutput.trim()] : []),
	].join("\n")
}
