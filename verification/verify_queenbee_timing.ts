import fs from "node:fs"
import path from "node:path"

export type QueenBeeTimingHarnessResult = {
	packageScriptPresent: boolean
	eventTimingDocPresent: boolean
	timeoutMatrixPresent: boolean
	identityAligned: boolean
	queueAligned: boolean
	progressAligned: boolean
	confidenceAligned: boolean
	budgetsAligned: boolean
	messageSchemaAnchored: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	verificationCatalogAligned: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function readText(rootDir: string, relativePath: string): string {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8")
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

export async function runQueenBeeTimingHarness(rootDir = resolveRootDir()): Promise<QueenBeeTimingHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const eventTimingText = readText(rootDir, "QUEENBEE_EVENT_TIMING_MODEL.md")
	const timeoutMatrixText = readText(rootDir, "QUEENBEE_TIMEOUT_AND_TTL_MATRIX.md")
	const identityText = readText(rootDir, "QUEENBEE_IDENTITY_AND_TAGGING.md")
	const queueText = readText(rootDir, "QUEENBEE_QUEUE_AND_FANIN_RULES.md")
	const progressText = readText(rootDir, "QUEENBEE_PROGRESS_VISIBILITY_CONTRACT.md")
	const confidenceText = readText(rootDir, "QUEENBEE_OPERATOR_CONFIDENCE_CONTRACT.md")
	const budgetsText = readText(rootDir, "QUEENBEE_COST_LATENCY_BUDGETS.md")
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:timing"] === "npm run build && node dist/verification/verify_queenbee_timing.js"

	const eventTimingDocPresent = includesAll(eventTimingText, [
		"# QueenBee Event Timing Model",
		"`messageTimestamp`",
		"`missionAcceptedAt`",
		"`queuedAt`",
		"`startedAt`",
		"`resultAt`",
		"`lastEventAt`",
		"`nextTimeoutAt`",
		"`ttlExpiresAt`",
		"`deadlineMs`",
		"derived timing fields are control or artifact fields, not new `qb-v1` envelope keys",
		"same-assignment clone-worker runtime fan-out remains out of scope",
	])

	const timeoutMatrixPresent = includesAll(timeoutMatrixText, [
		"# QueenBee Timeout And TTL Matrix",
		"`mission_ingress_queue` admission",
		"`service_queue` wait visibility",
		"`specialist_queue` wait visibility",
		"`completion_queue` merge and archive",
		"`reservationTag` ownership",
		"`cooldown` reuse pause",
		"`quarantine` trust stop",
		"`ttlExpiresAt`",
		"hidden retries",
	])

	const identityAligned = includesAll(identityText, [
		"## Timestamp Companions",
		"`missionAcceptedAt`, `missionClosedAt`",
		"`queueItemId`",
		"`queuedAt`, `startedAt`, `lastEventAt`",
		"`reservationTag`",
		"`reservedAt`, `releasedAt`, `ttlExpiresAt`",
		"`progressTag`",
		"`lastEventAt`, `nextTimeoutAt`",
	])

	const queueAligned = includesAll(queueText, [
		"## Timing And Visibility Rules",
		"`queuedAt` and `lastEventAt`",
		"`startedAt`",
		"`QUEENBEE_TIMEOUT_AND_TTL_MATRIX.md`",
		"`timeoutAt` or `ttlExpiresAt`",
		"stale `lastEventAt`",
	])

	const progressAligned = includesAll(progressText, [
		"# QueenBee Progress Visibility Contract",
		"`lastEventAt`",
		"`nextTimeoutAt` or `ttlExpiresAt`",
		"`missionAcceptedAt`",
		"`assignmentPlannedAt`",
		"`missionClosedAt`",
	])

	const confidenceAligned = includesAll(confidenceText, [
		"# QueenBee Operator Confidence Contract",
		"`lastEventAt`",
		"`nextTimeoutAt` or `ttlExpiresAt`",
		"timeout or TTL expiry",
	])

	const budgetsAligned = includesAll(budgetsText, [
		"## Timing Budget Interpretation",
		"`QUEENBEE_TIMEOUT_AND_TTL_MATRIX.md`",
		"`short` rows should refresh `lastEventAt` within `60s`",
		"`medium` rows should refresh `lastEventAt` within `90s`",
		"`extended_bounded` rows should refresh `lastEventAt` within `120s`",
		"`reservationTag` TTL should not outlive the row budget by more than one handoff",
	])

	const messageSchemaAnchored =
		includesAll(messageSchemaText, ["`timestamp`", "`deadlineMs`"]) &&
		includesAll(eventTimingText, [
			"the frozen packet envelope still relies on `timestamp` plus optional `deadlineMs`; this session does not widen that contract",
		])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 227 makes event timing and timeout or TTL truth explicit before live-evidence widening",
		"**Session:** 227",
		"`QUEENBEE_EVENT_TIMING_MODEL.md`",
		"`QUEENBEE_TIMEOUT_AND_TTL_MATRIX.md`",
		"`verify:queenbee:timing`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B33 |",
		"`QUEENBEE_EVENT_TIMING_MODEL.md`",
		"`QUEENBEE_TIMEOUT_AND_TTL_MATRIX.md`",
		"`QUEENBEE_OPERATOR_CONFIDENCE_CONTRACT.md`",
		"`npm.cmd run verify:queenbee:timing`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"50. `npm.cmd run verify:queenbee:timing`",
		"52. the Session 227 event timing model and timeout or TTL matrix now record named event timestamps, queue-age and expiry clocks, visible progress freshness, and budget-linked timeout discipline without widening the public beta boundary or same-assignment clone-worker story",
	])

	details.push(
		`eventTimingDocPresent=${eventTimingDocPresent ? "yes" : "no"}`,
		`timeoutMatrixPresent=${timeoutMatrixPresent ? "yes" : "no"}`,
		`messageSchemaAnchored=${messageSchemaAnchored ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		eventTimingDocPresent,
		timeoutMatrixPresent,
		identityAligned,
		queueAligned,
		progressAligned,
		confidenceAligned,
		budgetsAligned,
		messageSchemaAnchored,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeTimingHarnessResult(result: QueenBeeTimingHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Event timing doc present: ${result.eventTimingDocPresent ? "PASS" : "FAIL"}`,
		`Timeout matrix present: ${result.timeoutMatrixPresent ? "PASS" : "FAIL"}`,
		`Identity aligned: ${result.identityAligned ? "PASS" : "FAIL"}`,
		`Queue aligned: ${result.queueAligned ? "PASS" : "FAIL"}`,
		`Progress aligned: ${result.progressAligned ? "PASS" : "FAIL"}`,
		`Confidence aligned: ${result.confidenceAligned ? "PASS" : "FAIL"}`,
		`Budgets aligned: ${result.budgetsAligned ? "PASS" : "FAIL"}`,
		`Message schema anchored: ${result.messageSchemaAnchored ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeTimingHarness()
	console.log(formatQueenBeeTimingHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.eventTimingDocPresent &&
			result.timeoutMatrixPresent &&
			result.identityAligned &&
			result.queueAligned &&
			result.progressAligned &&
			result.confidenceAligned &&
			result.budgetsAligned &&
			result.messageSchemaAnchored &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:timing] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
