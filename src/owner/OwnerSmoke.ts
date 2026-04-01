import fs from "node:fs"
import path from "node:path"

import { DatabaseService } from "../db/DatabaseService"
import { Orchestrator } from "../Orchestrator"
import { recordDailyDriverFromSummaryPath, resolveRc1RootDir } from "../release/Rc1Ops"
import { readRunSummary } from "../run/RunArtifacts"
import { evaluateAdmission, formatAdmissionReport } from "../run/AdmissionGate"
import { buildShellLaunchSpec } from "../shell/ThinShell"
import { WorkspaceLock } from "../safety/WorkspaceLock"
import { resolveOwnerProviderSelection, type OwnerProviderSelection } from "./ProviderResolution"

type OwnerSmokeSummaryDetails = {
	reviewerVerdict: string
	acceptancePassed: boolean
	verificationProfile: string
}

export type OwnerSmokeResult = {
	passed: boolean
	workspace: string
	task: string
	provider: string | null
	model: string | null
	providerSource: string
	providerReady: boolean
	providerTransport: string
	providerTransportNote: string
	providerRetryCount: string
	providerRetryBackoffMs: string
	providerCallTimeoutMs: string
	summaryPath: string | null
	status: string
	stopReason: string
	reviewerVerdict: string
	acceptancePassed: boolean
	verificationProfile: string
	rc1Decision: string
	rc1Reason: string
	output: string
	details: string[]
	error: string | null
}

function resolveRootDir(startDir = __dirname): string {
	return resolveRc1RootDir(startDir)
}

function removePreviousSmokeWorkspaces(rootDir: string): void {
	for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		if (!entry.name.startsWith(".tmp-owner-smoke-")) continue
		try {
			fs.rmSync(path.join(rootDir, entry.name), { recursive: true, force: true })
		} catch {
			// ignore best-effort cleanup failures
		}
	}
}

function createSmokeWorkspace(rootDir: string): { workspace: string } {
	removePreviousSmokeWorkspaces(rootDir)
	const workspace = path.join(rootDir, `.tmp-owner-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.cpSync(path.join(rootDir, "verification", "test_workspace"), workspace, { recursive: true, force: true })
	const swarmDir = path.join(workspace, ".swarm")
	if (fs.existsSync(swarmDir)) fs.rmSync(swarmDir, { recursive: true, force: true })
	return { workspace }
}

function parseSmokeSummaryDetails(summaryPath: string | null): OwnerSmokeSummaryDetails {
	if (!summaryPath) {
		return {
			reviewerVerdict: "missing",
			acceptancePassed: false,
			verificationProfile: "missing",
		}
	}

	const summary = readRunSummary(path.dirname(summaryPath))
	const acceptanceGate =
		summary && typeof summary === "object" && summary["acceptanceGate"] && typeof summary["acceptanceGate"] === "object"
			? (summary["acceptanceGate"] as Record<string, unknown>)
			: null
	const verificationProfile =
		summary && typeof summary === "object" && summary["verificationProfile"] && typeof summary["verificationProfile"] === "object"
			? (summary["verificationProfile"] as Record<string, unknown>)
			: null
	return {
		reviewerVerdict:
			summary && typeof summary["reviewerVerdict"] === "string" && summary["reviewerVerdict"].trim().length > 0
				? summary["reviewerVerdict"]
				: "missing",
		acceptancePassed: acceptanceGate?.["passed"] === true,
		verificationProfile:
			verificationProfile && typeof verificationProfile["status"] === "string" && verificationProfile["status"].trim().length > 0
				? verificationProfile["status"]
				: "not_applicable",
	}
}

function evaluateOwnerSmokePass(input: {
	status: string
	reviewerVerdict: string
	acceptancePassed: boolean
	rc1Decision: string
	rc1Reason: string
}): boolean {
	return (
		input.status === "done" &&
		input.reviewerVerdict === "PASS" &&
		input.acceptancePassed &&
		input.rc1Decision === "skipped" &&
		input.rc1Reason.includes("Owner smoke surface")
	)
}

function summarizeSelection(selection: OwnerProviderSelection): string[] {
	return [
		`provider=${selection.provider ?? "none"}`,
		`model=${selection.model ?? "(none)"}`,
		`source=${selection.source}`,
		`transport=${selection.transport}`,
		`retries=${selection.envOverrides["SWARM_PROVIDER_MAX_RETRIES"] ?? "1"}`,
		`backoffMs=${selection.envOverrides["SWARM_PROVIDER_RETRY_BACKOFF_MS"] ?? "1500"}`,
		`timeoutMs=${selection.envOverrides["SWARM_PROVIDER_CALL_TIMEOUT_MS"] ?? "300000"}`,
		`ready=${selection.ready ? "yes" : "no"}`,
	]
}

export async function runOwnerSmoke(
	rootDir = resolveRootDir(),
	env: Record<string, string | undefined> = process.env,
): Promise<OwnerSmokeResult> {
	const selection = resolveOwnerProviderSelection(env)
	const task = "add a brief comment to hello.ts"
	const details = summarizeSelection(selection)

	if (!selection.ready || !selection.provider) {
		return {
			passed: false,
			workspace: "",
			task,
			provider: selection.provider,
			model: selection.model,
			providerSource: selection.source,
			providerReady: selection.ready,
			providerTransport: selection.transport,
			providerTransportNote: selection.transportNote,
			providerRetryCount: selection.envOverrides["SWARM_PROVIDER_MAX_RETRIES"] ?? "1",
			providerRetryBackoffMs: selection.envOverrides["SWARM_PROVIDER_RETRY_BACKOFF_MS"] ?? "1500",
			providerCallTimeoutMs: selection.envOverrides["SWARM_PROVIDER_CALL_TIMEOUT_MS"] ?? "300000",
			summaryPath: null,
			status: "not_started",
			stopReason: "provider_not_ready",
			reviewerVerdict: "missing",
			acceptancePassed: false,
			verificationProfile: "missing",
			rc1Decision: "not_run",
			rc1Reason: selection.reason,
			output: "",
			details,
			error: selection.reason,
		}
	}

	const smokeWorkspace = createSmokeWorkspace(rootDir)
	try {
		const launchArgs = ["--provider", selection.provider, ...(selection.model ? ["--model", selection.model] : [])]
		const spec = buildShellLaunchSpec(rootDir, task, smokeWorkspace.workspace, {
			extraArgs: launchArgs,
			extraDisplayArgs: launchArgs,
			envOverrides: {
				...selection.envOverrides,
				SWARM_RUN_SURFACE: "owner_smoke",
			},
		})
		details.push(`command=${spec.displayCommand}`)
		const admission = await evaluateAdmission({
			workspace: smokeWorkspace.workspace,
			task,
			allowDirty: false,
		})
		if (admission.decision === "refuse") {
			return {
				passed: false,
				workspace: smokeWorkspace.workspace,
				task,
				provider: selection.provider,
				model: selection.model,
				providerSource: selection.source,
				providerReady: selection.ready,
				providerTransport: selection.transport,
				providerTransportNote: selection.transportNote,
				providerRetryCount: selection.envOverrides["SWARM_PROVIDER_MAX_RETRIES"] ?? "1",
				providerRetryBackoffMs: selection.envOverrides["SWARM_PROVIDER_RETRY_BACKOFF_MS"] ?? "1500",
				providerCallTimeoutMs: selection.envOverrides["SWARM_PROVIDER_CALL_TIMEOUT_MS"] ?? "300000",
				summaryPath: null,
				status: "not_started",
				stopReason: "admission_refused",
				reviewerVerdict: "missing",
				acceptancePassed: false,
				verificationProfile: "missing",
				rc1Decision: "not_run",
				rc1Reason: "Owner smoke admission refused the workspace or task.",
				output: formatAdmissionReport(admission),
				details,
				error: formatAdmissionReport(admission),
			}
		}

		const previousEnv = new Map<string, string | undefined>()
		for (const [key, value] of Object.entries(spec.envOverrides ?? {})) {
			previousEnv.set(key, process.env[key])
			process.env[key] = value
		}

		let summaryPath: string | null = null
		let status = "missing_summary"
		let stopReason = "missing_summary"
		let reviewerVerdict = "missing"
		let acceptancePassed = false
		let verificationProfile = "missing"
		let output = ""
		try {
			WorkspaceLock.setRoot(smokeWorkspace.workspace)
			const dbPath = path.join(smokeWorkspace.workspace, ".swarm", "swarmcoder.db")
			DatabaseService.reset()
			const db = DatabaseService.getInstance(dbPath)
			try {
				const orchestrator = new Orchestrator(smokeWorkspace.workspace, db, false)
				const result = await orchestrator.run(task, { taskContract: admission.task.derivedTaskContract })
				summaryPath = result.summaryPath
				status = result.status
				stopReason = result.stopReason
				output = `[owner-smoke] ${result.status} (${result.stopReason})`
				const summaryDetails = parseSmokeSummaryDetails(summaryPath)
				reviewerVerdict = summaryDetails.reviewerVerdict
				acceptancePassed = summaryDetails.acceptancePassed
				verificationProfile = summaryDetails.verificationProfile
			} finally {
				db.close()
				DatabaseService.reset()
			}
		} finally {
			for (const [key, value] of previousEnv.entries()) {
				if (typeof value === "string") process.env[key] = value
				else delete process.env[key]
			}
		}

		const rc1Result = summaryPath
			? recordDailyDriverFromSummaryPath(rootDir, summaryPath, new Date())
			: { decision: "not_run", reason: "No summary artifact was produced." }
		const passed = Boolean(summaryPath) &&
			typeof rc1Result.reason === "string" &&
			evaluateOwnerSmokePass({
				status,
				reviewerVerdict,
				acceptancePassed,
				rc1Decision: String(rc1Result.decision),
				rc1Reason: rc1Result.reason,
			})

		details.push(
			`status=${status}`,
			`stopReason=${stopReason}`,
			`reviewer=${reviewerVerdict}`,
			`acceptance=${acceptancePassed ? "passed" : "failed"}`,
			`verificationProfile=${verificationProfile}`,
			`rc1=${String(rc1Result.decision)}`,
		)

		return {
			passed,
			workspace: smokeWorkspace.workspace,
			task,
			provider: selection.provider,
			model: selection.model,
			providerSource: selection.source,
			providerReady: selection.ready,
			providerTransport: selection.transport,
			providerTransportNote: selection.transportNote,
			providerRetryCount: selection.envOverrides["SWARM_PROVIDER_MAX_RETRIES"] ?? "1",
			providerRetryBackoffMs: selection.envOverrides["SWARM_PROVIDER_RETRY_BACKOFF_MS"] ?? "1500",
			providerCallTimeoutMs: selection.envOverrides["SWARM_PROVIDER_CALL_TIMEOUT_MS"] ?? "300000",
			summaryPath,
			status,
			stopReason,
			reviewerVerdict,
			acceptancePassed,
			verificationProfile,
			rc1Decision: String(rc1Result.decision),
			rc1Reason: String(rc1Result.reason),
			output,
			details,
			error: passed ? null : output || String(rc1Result.reason),
		}
	} catch (err) {
		return {
			passed: false,
			workspace: smokeWorkspace.workspace,
			task,
			provider: selection.provider,
			model: selection.model,
			providerSource: selection.source,
			providerReady: selection.ready,
			providerTransport: selection.transport,
			providerTransportNote: selection.transportNote,
			providerRetryCount: selection.envOverrides["SWARM_PROVIDER_MAX_RETRIES"] ?? "1",
			providerRetryBackoffMs: selection.envOverrides["SWARM_PROVIDER_RETRY_BACKOFF_MS"] ?? "1500",
			providerCallTimeoutMs: selection.envOverrides["SWARM_PROVIDER_CALL_TIMEOUT_MS"] ?? "300000",
			summaryPath: null,
			status: "failed",
			stopReason: "owner_smoke_error",
			reviewerVerdict: "missing",
			acceptancePassed: false,
			verificationProfile: "missing",
			rc1Decision: "not_run",
			rc1Reason: "Owner smoke did not complete.",
			output: "",
			details,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

export function formatOwnerSmokeResult(result: OwnerSmokeResult): string {
	return [
		`Owner smoke: ${result.passed ? "PASS" : "FAIL"}`,
		`Workspace: ${result.workspace || "(not created)"}`,
		`Provider: ${result.provider ?? "not ready"}`,
		`Model: ${result.model ?? "(none)"}`,
		`Provider source: ${result.providerSource}`,
		`Provider transport: ${result.providerTransport}`,
		`Provider retry policy: ${result.providerRetryCount} retry attempt(s), ${result.providerRetryBackoffMs}ms base backoff, ${result.providerCallTimeoutMs}ms timeout`,
		`Provider transport note: ${result.providerTransportNote}`,
		`Task: ${result.task}`,
		`Summary: ${result.summaryPath ?? "(missing)"}`,
		`Terminal status: ${result.status}`,
		`Stop reason: ${result.stopReason}`,
		`Reviewer verdict: ${result.reviewerVerdict}`,
		`Acceptance gate: ${result.acceptancePassed ? "passed" : "failed"}`,
		`Verification profile: ${result.verificationProfile}`,
		`RC1 credit decision: ${result.rc1Decision}`,
		`RC1 credit note: ${result.rc1Reason}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
		...(result.error ? [`Error: ${result.error}`] : []),
	].join("\n")
}
