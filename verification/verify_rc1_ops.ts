import fs from "node:fs"
import path from "node:path"

import { formatRc1VerificationResult, runRc1Verification } from "../src/release/Rc1Gate"
import {
	defaultDailyDriverLog,
	evaluateDailyDriverLog,
	formatDailyDriverStatus,
	recordDailyDriverFromSummaryPath,
	summarizeDailyDriverProgress,
	type DailyDriverEntry,
	type DailyDriverLog,
} from "../src/release/Rc1Ops"
import { ensureRunDir, writeRunSummary } from "../src/run/RunArtifacts"

export type Rc1OpsHarnessResult = {
	autoCreditSuccess: boolean
	passiveRecoveryStillCredited: boolean
	explicitManualRepairRejected: boolean
	duplicateProtection: boolean
	invalidRunRejected: boolean
	perDayCapEnforced: boolean
	threeDateRuleEnforced: boolean
	statusOutputClear: boolean
	verifyRc1FailCloses: boolean
	details: string[]
}

type SummaryFixtureOptions = {
	runId: string
	task: string
	workspace: string
	endedAt: string
	status?: string
	reviewerVerdict?: string
	acceptancePassed?: boolean
	verificationStatus?: "passed" | "failed" | "not_applicable" | "missing"
	dryRun?: boolean
	recovery?: Record<string, unknown> | null
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function createHarnessRoot(rootDir: string, suffix: string): string {
	const tempRoot = path.join(rootDir, "verification", `.tmp-rc1-ops-${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.mkdirSync(tempRoot, { recursive: true })
	fs.writeFileSync(path.join(tempRoot, "package.json"), `${JSON.stringify({ name: "rc1-ops-harness" }, null, 2)}\n`, "utf8")
	fs.writeFileSync(path.join(tempRoot, "Readme.md"), `${buildFreshRecordedProofReadme()}\n`, "utf8")
	return tempRoot
}

function buildFreshRecordedProofReadme(): string {
	return [
		"- Current semi-open verification: PASS (`npm.cmd run verify:semiopen` on 2026-03-21)",
		"- Current VS Code thin-shell smoke: PASS (`npm.cmd run verify:vscode:shell` on 2026-03-21)",
		"- Current matrix verification: PASS (`npm.cmd run verify:live:matrix` on 2026-03-21)",
		"- Current beta verification: PASS (`npm.cmd run verify:live:beta` on 2026-03-21)",
		"- Manual owner confirmation: PASS (Owner shell walkthrough on 2026-03-21)",
	].join("\n")
}

function writeSummaryFixture(options: SummaryFixtureOptions): string {
	const runDir = ensureRunDir(options.workspace, options.runId)
	const verificationProfile =
		options.verificationStatus === "not_applicable"
			? null
			: options.verificationStatus === "missing"
				? {}
				: {
						status: options.verificationStatus ?? "passed",
						profileName: "local-npm-test",
					}

	return writeRunSummary(runDir, {
		taskId: options.runId,
		task: options.task,
		workspace: options.workspace,
		dryRun: options.dryRun === true,
		startedAt: options.endedAt,
		endedAt: options.endedAt,
		status: options.status ?? "done",
		reviewerVerdict: options.reviewerVerdict ?? "PASS",
		acceptanceGate: {
			passed: options.acceptancePassed !== false,
		},
		verificationProfile,
		review: {
			decision: "pending",
		},
		recovery: options.recovery ?? null,
	})
}

function makeCreditedEntry(date: string, runId: string, task: string): DailyDriverEntry {
	return {
		date,
		workspace: "D:\\OwnerRepo",
		task,
		runId,
		surface: "cli_artifact",
		terminalStatus: "done",
		reviewerVerdict: "PASS",
		acceptanceGate: "passed",
		verificationProfile: "passed",
		manualRepair: false,
		credited: true,
		notes: "Auto-credited from summary.json.",
		endedAt: `${date}T12:00:00.000Z`,
		recordedAt: `${date}T12:00:05.000Z`,
	}
}

function writeDailyDriverLog(rootDir: string, log: DailyDriverLog): void {
	fs.writeFileSync(path.join(rootDir, "RC1_DAILY_DRIVER_LOG.json"), `${JSON.stringify(log, null, 2)}\n`, "utf8")
}

export async function runRc1OpsHarness(rootDir = resolveRootDir()): Promise<Rc1OpsHarnessResult> {
	const details: string[] = []
	const autoRoot = createHarnessRoot(rootDir, "auto")
	const verifyRoot = createHarnessRoot(rootDir, "verify")

	try {
		const ownerWorkspace = path.join(autoRoot, "workspaces", "owner-repo")
		fs.mkdirSync(ownerWorkspace, { recursive: true })

		const validSummary = writeSummaryFixture({
			runId: "run-1",
			task: "add a brief comment",
			workspace: ownerWorkspace,
			endedAt: "2026-03-18T09:00:00.000Z",
			verificationStatus: "passed",
		})
		const credited = recordDailyDriverFromSummaryPath(autoRoot, validSummary, new Date("2026-03-21T12:00:00.000Z"))
		const autoCreditSuccess =
			credited.decision === "credited" && credited.runId === "run-1" && credited.status.creditedCount === 1

		const passiveRecoverySummary = writeSummaryFixture({
			runId: "run-2",
			task: "passive recovery metadata stays creditable",
			workspace: ownerWorkspace,
			endedAt: "2026-03-18T09:30:00.000Z",
			verificationStatus: "passed",
			recovery: {
				orphanedWorktrees: [],
				orphanedSwarmBranches: [],
				staleTmpEntries: [],
				incompleteRunArtifacts: [],
				warnings: ["startup reconciliation inventory only"],
			},
		})
		const passiveRecovery = recordDailyDriverFromSummaryPath(
			autoRoot,
			passiveRecoverySummary,
			new Date("2026-03-21T12:00:01.000Z"),
		)
		const passiveRecoveryStillCredited =
			passiveRecovery.decision === "credited" &&
			passiveRecovery.entry?.manualRepair === false &&
			passiveRecovery.status.creditedCount === 2

		const explicitManualRepairSummary = writeSummaryFixture({
			runId: "run-manual",
			task: "manual repair should reject credit",
			workspace: ownerWorkspace,
			endedAt: "2026-03-18T09:45:00.000Z",
			verificationStatus: "passed",
			recovery: {
				manualRepair: true,
				repair: {
					manualIntervention: true,
				},
				notes: ["owner had to intervene manually before the run was acceptable"],
			},
		})
		const explicitManualRepair = recordDailyDriverFromSummaryPath(
			autoRoot,
			explicitManualRepairSummary,
			new Date("2026-03-21T12:00:02.000Z"),
		)
		const explicitManualRepairRejected =
			explicitManualRepair.decision === "rejected" &&
			explicitManualRepair.entry?.manualRepair === true &&
			explicitManualRepair.reason.includes("manualRepair=true")

		const duplicate = recordDailyDriverFromSummaryPath(autoRoot, validSummary, new Date("2026-03-21T12:00:03.000Z"))
		const duplicateProtection = duplicate.decision === "duplicate" && duplicate.status.creditedCount === 2

		const invalidSummary = writeSummaryFixture({
			runId: "run-invalid",
			task: "dry-run smoke",
			workspace: ownerWorkspace,
			endedAt: "2026-03-18T10:00:00.000Z",
			status: "review_required",
			acceptancePassed: false,
			verificationStatus: "not_applicable",
			dryRun: true,
		})
		const rejected = recordDailyDriverFromSummaryPath(autoRoot, invalidSummary, new Date("2026-03-21T12:00:04.000Z"))
		const invalidRunRejected =
			rejected.decision === "rejected" &&
			rejected.status.latestRejected?.runId === "run-invalid" &&
			rejected.reason.includes("status=review_required")

		for (const runId of ["run-3", "run-4"]) {
			const summaryPath = writeSummaryFixture({
				runId,
				task: `task ${runId}`,
				workspace: ownerWorkspace,
				endedAt: "2026-03-18T11:00:00.000Z",
				verificationStatus: "passed",
			})
			recordDailyDriverFromSummaryPath(autoRoot, summaryPath, new Date("2026-03-21T12:00:05.000Z"))
		}

		const cappedSummary = writeSummaryFixture({
			runId: "run-5",
			task: "task run-5",
			workspace: ownerWorkspace,
			endedAt: "2026-03-18T12:00:00.000Z",
			verificationStatus: "passed",
		})
		const capped = recordDailyDriverFromSummaryPath(autoRoot, cappedSummary, new Date("2026-03-21T12:00:06.000Z"))
		const perDayCapEnforced =
			capped.decision === "rejected" &&
			capped.reason.includes("already has 4/4 credited runs") &&
			capped.status.creditedCount === 4

		const statusOutput = formatDailyDriverStatus(capped.status, { blockedOnlyByRealStreak: true })
		const statusOutputClear =
			statusOutput.includes("RC1 daily-driver progress: 4/10 runs, 1/3 dates") &&
			statusOutput.includes("Remaining for RC1 closeout: 6 run(s), 2 distinct date(s)") &&
			statusOutput.includes("Current date usage (") &&
			statusOutput.includes("next eligible credited date:") &&
			statusOutput.includes("Latest credited run:") &&
			statusOutput.includes("Latest rejected run: run-5") &&
			statusOutput.includes("Blocked only by real credited dates/runs: YES")

		const incompleteLog = defaultDailyDriverLog()
		incompleteLog.entries = [
			makeCreditedEntry("2026-03-18", "two-day-1", "task 1"),
			makeCreditedEntry("2026-03-18", "two-day-2", "task 2"),
			makeCreditedEntry("2026-03-18", "two-day-3", "task 3"),
			makeCreditedEntry("2026-03-18", "two-day-4", "task 4"),
			makeCreditedEntry("2026-03-19", "two-day-5", "task 5"),
			makeCreditedEntry("2026-03-19", "two-day-6", "task 6"),
			makeCreditedEntry("2026-03-19", "two-day-7", "task 7"),
			makeCreditedEntry("2026-03-19", "two-day-8", "task 8"),
			makeCreditedEntry("2026-03-19", "two-day-9", "task 9"),
			makeCreditedEntry("2026-03-19", "two-day-10", "task 10"),
		]
		writeDailyDriverLog(verifyRoot, incompleteLog)

		const threeDateEvaluation = evaluateDailyDriverLog(incompleteLog)
		const threeDateRuleEnforced = !threeDateEvaluation.passed && threeDateEvaluation.distinctDateCount === 2

		const verification = await runRc1Verification(
			verifyRoot,
			new Date("2026-03-21T12:00:00.000Z"),
			async () => ({ code: 0, stdout: "PASS\n", stderr: "" }),
		)
		const verificationOutput = formatRc1VerificationResult(verification)
		const verifyRc1FailCloses =
			verification.shipDecision === "NO_SHIP" &&
			verification.automationPassed &&
			verification.recordedProofsPassed &&
			verification.blockedOnlyByRealStreak &&
			verificationOutput.includes("Blocked only by real credited dates/runs: YES")

		details.push(
			`credited=${credited.decision}`,
			`passiveRecovery=${passiveRecovery.decision}`,
			`manualRepair=${explicitManualRepair.decision}`,
			`duplicate=${duplicate.decision}`,
			`rejected=${rejected.decision}`,
			`cap=${capped.decision}`,
			`verify=${verification.shipDecision}`,
		)

		return {
			autoCreditSuccess,
			passiveRecoveryStillCredited,
			explicitManualRepairRejected,
			duplicateProtection,
			invalidRunRejected,
			perDayCapEnforced,
			threeDateRuleEnforced,
			statusOutputClear,
			verifyRc1FailCloses,
			details,
		}
	} finally {
		if (fs.existsSync(autoRoot)) fs.rmSync(autoRoot, { recursive: true, force: true })
		if (fs.existsSync(verifyRoot)) fs.rmSync(verifyRoot, { recursive: true, force: true })
	}
}

export function formatRc1OpsHarnessResult(result: Rc1OpsHarnessResult): string {
	return [
		`Auto-credit success: ${result.autoCreditSuccess ? "PASS" : "FAIL"}`,
		`Passive recovery metadata still credits: ${result.passiveRecoveryStillCredited ? "PASS" : "FAIL"}`,
		`Explicit manual repair rejected: ${result.explicitManualRepairRejected ? "PASS" : "FAIL"}`,
		`Duplicate protection: ${result.duplicateProtection ? "PASS" : "FAIL"}`,
		`Invalid run rejected: ${result.invalidRunRejected ? "PASS" : "FAIL"}`,
		`Per-day cap enforced: ${result.perDayCapEnforced ? "PASS" : "FAIL"}`,
		`Three-date rule enforced: ${result.threeDateRuleEnforced ? "PASS" : "FAIL"}`,
		`Status output clear: ${result.statusOutputClear ? "PASS" : "FAIL"}`,
		`verify:rc1 fail-closes incomplete streak: ${result.verifyRc1FailCloses ? "PASS" : "FAIL"}`,
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runRc1OpsHarness()
	console.log(formatRc1OpsHarnessResult(result))
	process.exit(
		result.autoCreditSuccess &&
			result.passiveRecoveryStillCredited &&
			result.explicitManualRepairRejected &&
			result.duplicateProtection &&
			result.invalidRunRejected &&
			result.perDayCapEnforced &&
			result.threeDateRuleEnforced &&
			result.statusOutputClear &&
			result.verifyRc1FailCloses
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:rc1:ops] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
