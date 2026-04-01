import fs from "node:fs"
import path from "node:path"

export type QueenBeeBenchmarkPlanHarnessResult = {
	packageScriptPresent: boolean
	benchmarkPlanPresent: boolean
	existingBenchmarkSurfacesAligned: boolean
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

export async function runQueenBeeBenchmarkPlanHarness(rootDir = resolveRootDir()): Promise<QueenBeeBenchmarkPlanHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const benchmarkPlanText = readText(rootDir, "QUEENBEE_BENCHMARK_PLAN.md")
	const headToHeadText = readText(rootDir, "HEAD_TO_HEAD_BENCHMARK.md")
	const comparativeReportText = readText(rootDir, "COMPARATIVE_BENCHMARK_REPORT.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:benchmark-plan"] === "npm run build && node dist/verification/verify_queenbee_benchmark_plan.js"

	const benchmarkPlanPresent = includesAll(benchmarkPlanText, [
		"# QueenBee Benchmark Plan",
		"`swarmengine` visible as the shipped bounded baseline",
		"`QB-BM-01`",
		"`QB-BM-02`",
		"`QB-BM-03`",
		"`QB-BM-04`",
		"`QB-BM-05`",
		"`QB-BM-06`",
		"`QB-BM-07`",
		"`expertOutcome`",
		"`reproOutcome`",
		"`budgetFit`",
		"`acceptanceFixtureBundle`",
		"`benchmark:queenbee:small`",
		"`benchmark:queenbee:two-file`",
		"## Session 271 Daily Corpus And Acceptance Fixture Reading",
		"`QB-BM-01` through `QB-BM-06` now define the fixed daily JS/TS candidate comparison corpus",
		"`QB-BM-07` stays outside that daily six-family comparison corpus",
	])

	const existingBenchmarkSurfacesAligned =
		includesAll(headToHeadText, [
			"# Head-To-Head Benchmark Matrix",
			"`not_run`",
			"Do not change V2 runtime behavior just to improve benchmark outcomes.",
		]) &&
		includesAll(comparativeReportText, [
			"# Comparative Benchmark Report",
			"`queenbee` remains an experimental engine candidate",
			"no public claim widens from this decision",
			"## Session 242 Live Execution Gate Reading",
			"`QB-LIVE-01` and `QB-LIVE-GW-01` now provide two real provider-backed QueenBee live anchors",
			"## Session 271 Daily Corpus And Acceptance Fixture Reading",
			"`QB-BM-01` through `QB-BM-06` now define one fixed daily JS/TS candidate comparison corpus",
			"does not change the fixed cross-tool scoreboard",
		])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 221 records bounded budgets, stronger tool-grant discipline, and a benchmark plan before canonical tasks",
		"**Session:** 221",
		"`QUEENBEE_BENCHMARK_PLAN.md`",
		"`npm.cmd run verify:queenbee:benchmark-plan`",
		"## Decision: Session 271 fixes one six-row QueenBee daily JS/TS corpus and acceptance-fixture surface without widening the public beta boundary",
		"**Session:** 271",
		"`QB-BM-01` through `QB-BM-06`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B27 |",
		"`QUEENBEE_BENCHMARK_PLAN.md`",
		"`npm.cmd run verify:queenbee:benchmark-plan`",
		"| B61 |",
		"Does QueenBee now have one fixed six-row daily JS/TS corpus with explicit acceptance-fixture evidence, live anchors where proven, and hold anchors where not? | YES |",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:benchmark-plan`",
		"benchmark plan",
		"benchmark-ready",
		"future reverse-engineered tasks",
		"the Session 271 daily JS/TS corpus now records `QB-BM-01` through `QB-BM-06`",
	])

	details.push(
		`benchmarkPlanPresent=${benchmarkPlanPresent ? "yes" : "no"}`,
		`existingBenchmarkSurfacesAligned=${existingBenchmarkSurfacesAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		benchmarkPlanPresent,
		existingBenchmarkSurfacesAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeBenchmarkPlanHarnessResult(result: QueenBeeBenchmarkPlanHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Benchmark plan present: ${result.benchmarkPlanPresent ? "PASS" : "FAIL"}`,
		`Existing benchmark surfaces aligned: ${result.existingBenchmarkSurfacesAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeBenchmarkPlanHarness()
	console.log(formatQueenBeeBenchmarkPlanHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.benchmarkPlanPresent &&
			result.existingBenchmarkSurfacesAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:benchmark-plan] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
