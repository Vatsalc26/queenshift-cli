import { evaluateOwnerBeta, formatOwnerBetaResult, type OwnerBetaEvidence } from "../src/owner/OwnerBeta"
import type { OwnerRc1Snapshot } from "../src/owner/OwnerStatus"
import type { OwnerSmokeResult } from "../src/owner/OwnerSmoke"
import type { DailyDriverEntry } from "../src/release/Rc1Ops"

export type OwnerBetaFixturesHarnessResult = {
	requiredEvidencePasses: boolean
	smokeFailureBlocksBeta: boolean
	missingCreditedRunBlocksBeta: boolean
	betaCanBeReadyWhileRc1StillRed: boolean
	details: string[]
}

function makeSmoke(
	passed: boolean,
	overrides: Partial<OwnerSmokeResult> = {},
): OwnerSmokeResult {
	return {
		passed,
		workspace: "C:\\OwnerRepo",
		task: "add a brief comment to hello.ts",
		provider: "gemini",
		model: "gemini-2.5-flash",
		providerSource: "detected_gemini_cli_oauth",
		providerReady: true,
		providerTransport: "gemini_cli_subprocess",
		providerTransportNote: "Using Gemini CLI subprocess transport via C:\\Tools\\gemini.cmd.",
		providerRetryCount: "1",
		providerRetryBackoffMs: "1500",
		providerCallTimeoutMs: "300000",
		summaryPath: "C:\\OwnerRepo\\.swarm\\runs\\run-owner-smoke\\summary.json",
		status: "done",
		stopReason: "success",
		reviewerVerdict: "PASS",
		acceptancePassed: true,
		verificationProfile: "not_applicable",
		rc1Decision: "skipped",
		rc1Reason: "Owner smoke surface is non-credit by design.",
		output: "",
		details: [],
		error: passed ? null : "Owner smoke is red.",
		...overrides,
	}
}

function makeCreditedEntry(overrides: Partial<DailyDriverEntry> = {}): DailyDriverEntry {
	return {
		date: "2026-03-21",
		workspace: "C:\\OwnerRepo",
		task: "add a brief comment to hello.ts",
		runId: "run-credited-1",
		surface: "thin_shell_guided",
		terminalStatus: "done",
		reviewerVerdict: "PASS",
		acceptanceGate: "passed",
		verificationProfile: "not_applicable",
		manualRepair: false,
		credited: true,
		notes: "Credited owner run.",
		endedAt: "2026-03-21T09:00:00.000Z",
		recordedAt: "2026-03-21T09:01:00.000Z",
		summaryPath: "C:\\OwnerRepo\\.swarm\\runs\\run-credited-1\\summary.json",
		...overrides,
	}
}

function makeRc1Snapshot(overrides: Partial<OwnerRc1Snapshot> = {}): OwnerRc1Snapshot {
	const latestRealCreditedRun = overrides.latestRealCreditedRun ?? makeCreditedEntry()
	return {
		parseError: null,
		status: {
			currentDate: "2026-03-21",
			creditedCount: latestRealCreditedRun ? 1 : 0,
			requiredCreditedRuns: 10,
			distinctDateCount: latestRealCreditedRun ? 1 : 0,
			requiredDistinctDates: 3,
			currentDateCreditedCount: latestRealCreditedRun ? 1 : 0,
			maxCreditedRunsPerDay: 4,
			latestCredited: latestRealCreditedRun,
			latestRejected: null,
		},
		latestRealCreditedRun,
		...overrides,
	}
}

function makeEvidence(overrides: Partial<OwnerBetaEvidence> = {}): OwnerBetaEvidence {
	return {
		smoke: makeSmoke(true),
		reviewQueuePassed: true,
		incidentPassed: true,
		rc1Snapshot: makeRc1Snapshot(),
		...overrides,
	}
}

export async function runOwnerBetaFixturesHarness(): Promise<OwnerBetaFixturesHarnessResult> {
	const details: string[] = []

	const green = evaluateOwnerBeta(
		makeEvidence({
			rc1Snapshot: makeRc1Snapshot({
				status: {
					currentDate: "2026-03-21",
					creditedCount: 1,
					requiredCreditedRuns: 10,
					distinctDateCount: 1,
					requiredDistinctDates: 3,
					currentDateCreditedCount: 1,
					maxCreditedRunsPerDay: 4,
					latestCredited: makeCreditedEntry(),
					latestRejected: null,
				},
				latestRealCreditedRun: makeCreditedEntry(),
			}),
		}),
	)
	const greenText = formatOwnerBetaResult(green)
	const requiredEvidencePasses =
		green.ready === true &&
		green.latestCreditedOwnerRunId === "run-credited-1" &&
		greenText.includes("Owner Beta: BETA READY")
	const betaCanBeReadyWhileRc1StillRed =
		green.ready === true &&
		green.details.some((detail) => detail.includes("1/10 runs 1/3 dates"))

	const smokeRed = evaluateOwnerBeta(
		makeEvidence({
			smoke: makeSmoke(false, { error: "Owner smoke command failed." }),
		}),
	)
	const smokeFailureBlocksBeta =
		smokeRed.ready === false &&
		smokeRed.blockers.some((blocker) => blocker.includes("Owner smoke is red"))

	const missingCreditedRun = evaluateOwnerBeta(
		makeEvidence({
			rc1Snapshot: makeRc1Snapshot({
				status: {
					currentDate: "2026-03-21",
					creditedCount: 0,
					requiredCreditedRuns: 10,
					distinctDateCount: 0,
					requiredDistinctDates: 3,
					currentDateCreditedCount: 0,
					maxCreditedRunsPerDay: 4,
					latestCredited: null,
					latestRejected: null,
				},
				latestRealCreditedRun: null,
			}),
		}),
	)
	const missingCreditedRunBlocksBeta =
		missingCreditedRun.ready === false &&
		missingCreditedRun.blockers.includes("No real credited owner run is recorded yet.")

	details.push(
		`green=${green.ready ? "ready" : "blocked"}`,
		`smokeRed=${smokeRed.blockers.join(" | ")}`,
		`missingRun=${missingCreditedRun.blockers.join(" | ")}`,
	)

	return {
		requiredEvidencePasses,
		smokeFailureBlocksBeta,
		missingCreditedRunBlocksBeta,
		betaCanBeReadyWhileRc1StillRed,
		details,
	}
}

export function formatOwnerBetaFixturesHarnessResult(result: OwnerBetaFixturesHarnessResult): string {
	return [
		`Required evidence passes: ${result.requiredEvidencePasses ? "PASS" : "FAIL"}`,
		`Smoke failure blocks beta: ${result.smokeFailureBlocksBeta ? "PASS" : "FAIL"}`,
		`Missing credited run blocks beta: ${result.missingCreditedRunBlocksBeta ? "PASS" : "FAIL"}`,
		`Beta can be ready while RC1 is still red: ${result.betaCanBeReadyWhileRc1StillRed ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runOwnerBetaFixturesHarness()
	console.log(formatOwnerBetaFixturesHarnessResult(result))
	process.exit(
		result.requiredEvidencePasses &&
			result.smokeFailureBlocksBeta &&
			result.missingCreditedRunBlocksBeta &&
			result.betaCanBeReadyWhileRc1StillRed
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:owner:beta:fixtures] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
