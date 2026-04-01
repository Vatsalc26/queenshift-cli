import fs from "node:fs"
import path from "node:path"

export type QueenBeeReproHarnessResult = {
	packageScriptPresent: boolean
	reproDocPresent: boolean
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

export async function runQueenBeeReproHarness(rootDir = resolveRootDir()): Promise<QueenBeeReproHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const reproText = readText(rootDir, "QUEENBEE_MODEL_VARIANCE_AND_REPRODUCIBILITY.md")
	const beeClassificationText = readText(rootDir, "QUEENBEE_BEE_CLASSIFICATION.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:repro"] === "npm run build && node dist/verification/verify_queenbee_repro.js"

	const reproDocPresent = includesAll(reproText, [
		"# QueenBee Model Variance And Reproducibility",
		"token-identical output is the only meaningful form of reproducibility",
		"The current protocol-visible thinking bee count is `6`",
		"The current protocol-visible deterministic bee count is also `6`",
		"one primary reasoning turn per active thinking-bee role",
		"Stable Invariants",
		"Acceptable Variance",
		"Non-Acceptable Variance",
		"provider name",
		"model name",
	])

	const beeClassificationAligned = includesAll(beeClassificationText, [
		"## Session 220 Thinking-Bee Count And Call Expectation",
		"a nominal bounded success path should involve at most `5` thinking-bee roles",
		"an off-nominal path may add `RecoveryBee` as the sixth thinking role",
		"`QUEENBEE_MODEL_VARIANCE_AND_REPRODUCIBILITY.md`",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 220 records an expert eval rubric and a bounded reproducibility contract before budgets and benchmarks",
		"**Session:** 220",
		"`QUEENBEE_MODEL_VARIANCE_AND_REPRODUCIBILITY.md`",
		"`npm.cmd run verify:queenbee:repro`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B26 |",
		"`QUEENBEE_MODEL_VARIANCE_AND_REPRODUCIBILITY.md`",
		"`npm.cmd run verify:queenbee:repro`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:repro`",
		"model variance and reproducibility",
		"thinking-bee count",
		"nominal LLM-call expectation",
	])

	details.push(
		`reproDocPresent=${reproDocPresent ? "yes" : "no"}`,
		`beeClassificationAligned=${beeClassificationAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		reproDocPresent,
		beeClassificationAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeReproHarnessResult(result: QueenBeeReproHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Repro doc present: ${result.reproDocPresent ? "PASS" : "FAIL"}`,
		`Bee classification aligned: ${result.beeClassificationAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeReproHarness()
	console.log(formatQueenBeeReproHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.reproDocPresent &&
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
		console.error(`[verify:queenbee:repro] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
