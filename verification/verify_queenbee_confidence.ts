import fs from "node:fs"
import path from "node:path"

export type QueenBeeConfidenceHarnessResult = {
	packageScriptPresent: boolean
	confidenceContractPresent: boolean
	conopsAndUxAligned: boolean
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

export async function runQueenBeeConfidenceHarness(rootDir = resolveRootDir()): Promise<QueenBeeConfidenceHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const confidenceText = readText(rootDir, "QUEENBEE_OPERATOR_CONFIDENCE_CONTRACT.md")
	const conopsText = readText(rootDir, "QUEENBEE_CONOPS.md")
	const uxNotesText = readText(rootDir, "QUEENBEE_UX_REVIEW_NOTES.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:confidence"] === "npm run build && node dist/verification/verify_queenbee_confidence.js"

	const confidenceContractPresent = includesAll(confidenceText, [
		"# QueenBee Operator Confidence Contract",
		"`bounded_pass`",
		"`bounded_pass_after_rework`",
		"`bounded_refusal`",
		"`verification_fail`",
		"`merge_blocked`",
		"`red_lane_interruption`",
		"`swarmengine` remains the shipped bounded engine",
		"Minimum Visible Signals",
		"What the operator may not infer",
	])

	const conopsAndUxAligned =
		includesAll(conopsText, [
			"## Artifact And Confidence Model",
			"confidence comes from proof wrappers, examples, review packs, and explicit limits",
			"missing artifacts, stale gates, or red proofs mean the answer is not `PASS`",
		]) &&
		includesAll(uxNotesText, [
			"# QueenBee UX Review Notes",
			"user-confidence review notes",
			"confidence gain is real but not yet decisive",
		])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 219 makes failure behavior, queue truth, and operator confidence explicit before evaluation work",
		"**Session:** 219",
		"`QUEENBEE_OPERATOR_CONFIDENCE_CONTRACT.md`",
		"`npm.cmd run verify:queenbee:confidence`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B25 |",
		"`QUEENBEE_OPERATOR_CONFIDENCE_CONTRACT.md`",
		"`npm.cmd run verify:queenbee:confidence`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:confidence`",
		"operator confidence contract",
		"trust signals",
		"truthful PASS",
	])

	details.push(
		`confidenceContractPresent=${confidenceContractPresent ? "yes" : "no"}`,
		`conopsAndUxAligned=${conopsAndUxAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		confidenceContractPresent,
		conopsAndUxAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeConfidenceHarnessResult(result: QueenBeeConfidenceHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Confidence contract present: ${result.confidenceContractPresent ? "PASS" : "FAIL"}`,
		`ConOps and UX aligned: ${result.conopsAndUxAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeConfidenceHarness()
	console.log(formatQueenBeeConfidenceHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.confidenceContractPresent &&
			result.conopsAndUxAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:confidence] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
