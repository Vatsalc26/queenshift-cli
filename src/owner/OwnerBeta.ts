import { resolveRc1RootDir } from "../release/Rc1Ops"
import { readOwnerRc1Snapshot, type OwnerRc1Snapshot } from "./OwnerStatus"
import { formatOwnerSmokeResult, runOwnerSmoke, type OwnerSmokeResult } from "./OwnerSmoke"
import { runIncidentHarness, type IncidentHarnessResult } from "../../verification/verify_incident"
import { runReviewQueueHarness, type ReviewQueueHarnessResult } from "../../verification/verify_review_queue"

export type OwnerBetaEvidence = {
	smoke: OwnerSmokeResult
	reviewQueuePassed: boolean
	incidentPassed: boolean
	rc1Snapshot: OwnerRc1Snapshot
}

export type OwnerBetaResult = {
	ready: boolean
	smoke: OwnerSmokeResult
	reviewQueuePassed: boolean
	incidentPassed: boolean
	latestCreditedOwnerRunId: string | null
	blockers: string[]
	details: string[]
}

function reviewQueuePassed(result: ReviewQueueHarnessResult): boolean {
	return (
		result.listingWorks &&
		result.showWorks &&
		result.mergeNegotiationVisible &&
		result.approveWorks &&
		result.blockedMergeNegotiationRefusesApproval &&
		result.discardWorks
	)
}

function incidentHarnessPassed(result: IncidentHarnessResult): boolean {
	return (
		result.incidentPackGenerated &&
		result.incidentPackContents &&
		result.safeDiscardCleanup &&
		result.ambiguousRollbackRefused &&
		result.mergeNegotiationVisible &&
		result.nextActionHint &&
		result.failureNarrativeVisible
	)
}

export function evaluateOwnerBeta(evidence: OwnerBetaEvidence): OwnerBetaResult {
	const blockers: string[] = []
	const details: string[] = []

	if (!evidence.smoke.passed) blockers.push(`Owner smoke is red: ${evidence.smoke.error ?? evidence.smoke.rc1Reason}`)
	details.push(`smoke=${evidence.smoke.passed ? "PASS" : "FAIL"}`)

	if (!evidence.reviewQueuePassed) blockers.push("Review queue deterministic proof is red.")
	details.push(`reviewQueue=${evidence.reviewQueuePassed ? "PASS" : "FAIL"}`)

	if (!evidence.incidentPassed) blockers.push("Incident deterministic proof is red.")
	details.push(`incident=${evidence.incidentPassed ? "PASS" : "FAIL"}`)

	if (evidence.rc1Snapshot.parseError) blockers.push(evidence.rc1Snapshot.parseError)
	if (!evidence.rc1Snapshot.latestRealCreditedRun) {
		blockers.push("No real credited owner run is recorded yet.")
	}
	details.push(
		`rc1Progress=${evidence.rc1Snapshot.status.creditedCount}/${evidence.rc1Snapshot.status.requiredCreditedRuns} runs ${evidence.rc1Snapshot.status.distinctDateCount}/${evidence.rc1Snapshot.status.requiredDistinctDates} dates`,
	)

	return {
		ready: blockers.length === 0,
		smoke: evidence.smoke,
		reviewQueuePassed: evidence.reviewQueuePassed,
		incidentPassed: evidence.incidentPassed,
		latestCreditedOwnerRunId: evidence.rc1Snapshot.latestRealCreditedRun?.runId ?? null,
		blockers,
		details,
	}
}

export async function runOwnerBeta(
	rootDir = resolveRc1RootDir(),
	env: Record<string, string | undefined> = process.env,
): Promise<OwnerBetaResult> {
	const smoke = await runOwnerSmoke(rootDir, env)
	const reviewHarness = await runReviewQueueHarness(rootDir)
	const reviewPassed = reviewQueuePassed(reviewHarness)
	const incidentHarness = await runIncidentHarness(rootDir)
	const incidentPassed = incidentHarnessPassed(incidentHarness)
	const rc1Snapshot = readOwnerRc1Snapshot(rootDir)
	return evaluateOwnerBeta({
		smoke,
		reviewQueuePassed: reviewPassed,
		incidentPassed,
		rc1Snapshot,
	})
}

export function formatOwnerBetaResult(result: OwnerBetaResult): string {
	return [
		`Owner Beta: ${result.ready ? "BETA READY" : "NO-BETA"}`,
		`Owner smoke: ${result.smoke.passed ? "PASS" : "FAIL"}`,
		`Review queue: ${result.reviewQueuePassed ? "PASS" : "FAIL"}`,
		`Incident flow: ${result.incidentPassed ? "PASS" : "FAIL"}`,
		`Latest credited owner run: ${result.latestCreditedOwnerRunId ?? "(none)"}`,
		...(result.blockers.length > 0 ? ["Blockers:", ...result.blockers.map((blocker) => `- ${blocker}`)] : ["Blockers:", "- none"]),
		"Smoke detail:",
		formatOwnerSmokeResult(result.smoke),
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}
