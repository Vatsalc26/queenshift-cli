import fs from "node:fs"
import path from "node:path"

export type QueenBeeEvalRubricHarnessResult = {
	packageScriptPresent: boolean
	evalRubricPresent: boolean
	beeClassificationAligned: boolean
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

export async function runQueenBeeEvalRubricHarness(rootDir = resolveRootDir()): Promise<QueenBeeEvalRubricHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const evalRubricText = readText(rootDir, "QUEENBEE_EXPERT_EVAL_RUBRIC.md")
	const beeClassificationText = readText(rootDir, "QUEENBEE_BEE_CLASSIFICATION.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:eval-rubric"] === "npm run build && node dist/verification/verify_queenbee_eval_rubric.js"

	const evalRubricPresent = includesAll(evalRubricText, [
		"# QueenBee Expert Eval Rubric",
		"`QB-EVAL-01`",
		"`QB-EVAL-04`",
		"`QB-EVAL-07`",
		"`PASS` means",
		"`MIXED` means",
		"`FAIL` means",
		"`EXPERT_GREEN`",
		"`MIXED_HOLD`",
		"`FAIL_CLOSED_REQUIRED`",
		"evaluate the bounded result, not the swarm theater around it",
	])

	const beeClassificationAligned = includesAll(beeClassificationText, [
		"## Session 220 Thinking-Bee Count And Call Expectation",
		"The current protocol-visible thinking bee count is `6`",
		"The current protocol-visible deterministic bee count is also `6`",
		"`QUEENBEE_MODEL_VARIANCE_AND_REPRODUCIBILITY.md`",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 220 records an expert eval rubric and a bounded reproducibility contract before budgets and benchmarks",
		"**Session:** 220",
		"`QUEENBEE_EXPERT_EVAL_RUBRIC.md`",
		"`npm.cmd run verify:queenbee:eval-rubric`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B26 |",
		"`QUEENBEE_EXPERT_EVAL_RUBRIC.md`",
		"`npm.cmd run verify:queenbee:eval-rubric`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:eval-rubric`",
		"expert eval rubric",
		"expert-expected JS/TS output",
		"rubric instead of vibes",
	])

	details.push(
		`evalRubricPresent=${evalRubricPresent ? "yes" : "no"}`,
		`beeClassificationAligned=${beeClassificationAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		evalRubricPresent,
		beeClassificationAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeEvalRubricHarnessResult(result: QueenBeeEvalRubricHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Eval rubric present: ${result.evalRubricPresent ? "PASS" : "FAIL"}`,
		`Bee classification aligned: ${result.beeClassificationAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeEvalRubricHarness()
	console.log(formatQueenBeeEvalRubricHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.evalRubricPresent &&
			result.beeClassificationAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:eval-rubric] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
