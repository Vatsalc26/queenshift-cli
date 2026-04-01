import fs from "node:fs"
import path from "node:path"

export type QueenBeeQueuesHarnessResult = {
	packageScriptPresent: boolean
	queueRulesPresent: boolean
	parallelModelAligned: boolean
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

export async function runQueenBeeQueuesHarness(rootDir = resolveRootDir()): Promise<QueenBeeQueuesHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const queueRulesText = readText(rootDir, "QUEENBEE_QUEUE_AND_FANIN_RULES.md")
	const parallelModelText = readText(rootDir, "QUEENBEE_PARALLEL_EXECUTION_MODEL.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:queues"] === "npm run build && node dist/verification/verify_queenbee_queues.js"

	const queueRulesPresent = includesAll(queueRulesText, [
		"# QueenBee Queue And Fan-In Rules",
		"`queueItemId`",
		"`mission_ingress_queue`",
		"`service_queue`",
		"`specialist_queue`",
		"`completion_queue`",
		"`review_request`",
		"`verification_request`",
		"`merge_request`",
		"`archive_request`",
		"`sliceTag`",
		"`reservationTag`",
		"Starvation And Blocking Rules",
		"same-assignment parallel coding",
	])

	const parallelModelAligned = includesAll(parallelModelText, [
		"# QueenBee Parallel Execution Model",
		"`mission_ingress_queue`",
		"`service_queue`",
		"`specialist_queue`",
		"`completion_queue`",
		"`MergeBee` remains the single serialization point",
		"hidden background retries",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 219 makes failure behavior, queue truth, and operator confidence explicit before evaluation work",
		"**Session:** 219",
		"`QUEENBEE_QUEUE_AND_FANIN_RULES.md`",
		"`npm.cmd run verify:queenbee:queues`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B25 |",
		"`QUEENBEE_QUEUE_AND_FANIN_RULES.md`",
		"`npm.cmd run verify:queenbee:queues`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:queues`",
		"queue and fan-in rules",
		"merge serialization",
		"collision",
		"starvation",
	])

	details.push(
		`queueRulesPresent=${queueRulesPresent ? "yes" : "no"}`,
		`parallelModelAligned=${parallelModelAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		queueRulesPresent,
		parallelModelAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeQueuesHarnessResult(result: QueenBeeQueuesHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Queue rules present: ${result.queueRulesPresent ? "PASS" : "FAIL"}`,
		`Parallel model aligned: ${result.parallelModelAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeQueuesHarness()
	console.log(formatQueenBeeQueuesHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.queueRulesPresent &&
			result.parallelModelAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:queues] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
