import fs from "node:fs"
import path from "node:path"

export type QueenBeeCanonicalTasksHarnessResult = {
	packageScriptPresent: boolean
	canonicalTaskSetPresent: boolean
	sideBySideExamplesPresent: boolean
	progressVisibilityPresent: boolean
	taskCorpusAligned: boolean
	dailyProgramAligned: boolean
	publicTaskFamiliesAligned: boolean
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

export async function runQueenBeeCanonicalTasksHarness(rootDir = resolveRootDir()): Promise<QueenBeeCanonicalTasksHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const canonicalTaskSetText = readText(rootDir, "QUEENBEE_CANONICAL_TASK_SET.md")
	const sideBySideExamplesText = readText(rootDir, "QUEENBEE_SIDE_BY_SIDE_EXAMPLES.md")
	const progressVisibilityText = readText(rootDir, "QUEENBEE_PROGRESS_VISIBILITY_CONTRACT.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const dailyProgramText = readText(rootDir, "QUEENBEE_DAILY_JSTS_PROGRAM.md")
	const publicTaskFamiliesText = readText(rootDir, "public_pack/docs/task-families.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:canonical-tasks"] === "npm run build && node dist/verification/verify_queenbee_canonical_tasks.js"

	const canonicalTaskSetPresent = includesAll(canonicalTaskSetText, [
		"# QueenBee Canonical Task Set",
		"`QB-CAN-01`",
		"`QB-CAN-02`",
		"`QB-CAN-07`",
		"`comment_file`",
		"`create_tiny_file`",
		"`bounded_node_cli_task`",
		"`SUPPORTED`",
		"`DEFER`",
		"Session 223: `QB-CAN-01`, `QB-CAN-02`, and `QB-CAN-03`",
		"## Session 271 Daily JS/TS Corpus Answer",
		"`QB-CAN-01`, `QB-CAN-03`, `QB-CAN-04`, `QB-CAN-05`, `QB-CAN-06`, and `QB-CAN-07` now define the current daily JS/TS six-family corpus",
		"`QB-CAN-02` remains supported as one internal create-safe row",
		"`verify:queenbee:live:canonical`",
	])

	const sideBySideExamplesPresent = includesAll(sideBySideExamplesText, [
		"# QueenBee Side By Side Examples",
		"`QB-EX-01`",
		"`QB-EX-03`",
		"`QB-EX-07`",
		"`swarmengine` visible as the shipped bounded engine",
		"`expertOutcome`",
		"`reproOutcome`",
		"`budgetFit`",
		"`acceptanceFixtureBundle`",
		"examples do not widen public claims by themselves",
		"## Session 271 Daily Corpus And Acceptance Fixture Reading",
		"`QB-EX-01` through `QB-EX-06` now define the fixed daily JS/TS comparison corpus",
		"`QB-EX-07` stays outside that six-family daily comparison corpus",
	])

	const progressVisibilityPresent = includesAll(progressVisibilityText, [
		"# QueenBee Progress Visibility Contract",
		"`mission_ingress_queue`",
		"`service_queue`",
		"`specialist_queue`",
		"`completion_queue`",
		"`missionId`",
		"`assignmentId`",
		"`admission`",
		"`merge_and_archive`",
		"`bounded_stop`",
	])

	const taskCorpusAligned = includesAll(taskCorpusText, [
		"## Session 222 QueenBee Canonical Task Surface Note",
		"`QUEENBEE_CANONICAL_TASK_SET.md`",
		"`create_tiny_file` is now explicit as a canonical bounded row",
		"`QUEENBEE_SIDE_BY_SIDE_EXAMPLES.md` and `QUEENBEE_PROGRESS_VISIBILITY_CONTRACT.md`",
	])

	const dailyProgramAligned = includesAll(dailyProgramText, [
		"## Session 271 Daily Corpus And Fixture Update",
		"`QB-BM-01` through `QB-BM-06` and `QB-EX-01` through `QB-EX-06` now form the recurring comparison surface",
		"`QB-LIVE-03` remains the explicit daily-corpus hold row",
		"`QB-CAN-02` still stays outside the public daily six-family comparison corpus",
	])

	const publicTaskFamiliesAligned = includesAll(publicTaskFamiliesText, [
		"## Example And Progress Expectations",
		"the bounded task family",
		"the named target files",
		"the progress steps or stop reason while the run is happening",
		"Experimental candidate paths should stay explicitly labeled",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 222 records canonical QueenBee task rows, side-by-side examples, and visible progress expectations before runtime reverse engineering",
		"**Session:** 222",
		"`QUEENBEE_CANONICAL_TASK_SET.md`",
		"`npm.cmd run verify:queenbee:canonical-tasks`",
		"## Decision: Session 271 fixes one six-row QueenBee daily JS/TS corpus and acceptance-fixture surface without widening the public beta boundary",
		"**Session:** 271",
		"`QB-CAN-02`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B28 |",
		"`QUEENBEE_CANONICAL_TASK_SET.md`",
		"`QUEENBEE_SIDE_BY_SIDE_EXAMPLES.md`",
		"`QUEENBEE_PROGRESS_VISIBILITY_CONTRACT.md`",
		"`npm.cmd run verify:queenbee:canonical-tasks`",
		"| B61 |",
		"Does QueenBee now have one fixed six-row daily JS/TS corpus with explicit acceptance-fixture evidence, live anchors where proven, and hold anchors where not? | YES |",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:canonical-tasks`",
		"canonical task set",
		"side-by-side example",
		"progress visibility",
		"the Session 271 daily JS/TS corpus now records `QB-BM-01` through `QB-BM-06`",
	])

	details.push(
		`canonicalTaskSetPresent=${canonicalTaskSetPresent ? "yes" : "no"}`,
		`sideBySideExamplesPresent=${sideBySideExamplesPresent ? "yes" : "no"}`,
		`progressVisibilityPresent=${progressVisibilityPresent ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		canonicalTaskSetPresent,
		sideBySideExamplesPresent,
		progressVisibilityPresent,
		taskCorpusAligned,
		dailyProgramAligned,
		publicTaskFamiliesAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeCanonicalTasksHarnessResult(result: QueenBeeCanonicalTasksHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Canonical task set present: ${result.canonicalTaskSetPresent ? "PASS" : "FAIL"}`,
		`Side-by-side examples present: ${result.sideBySideExamplesPresent ? "PASS" : "FAIL"}`,
		`Progress visibility present: ${result.progressVisibilityPresent ? "PASS" : "FAIL"}`,
		`Task corpus aligned: ${result.taskCorpusAligned ? "PASS" : "FAIL"}`,
		`Daily program aligned: ${result.dailyProgramAligned ? "PASS" : "FAIL"}`,
		`Public task docs aligned: ${result.publicTaskFamiliesAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeCanonicalTasksHarness()
	console.log(formatQueenBeeCanonicalTasksHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.canonicalTaskSetPresent &&
			result.sideBySideExamplesPresent &&
			result.progressVisibilityPresent &&
			result.taskCorpusAligned &&
			result.dailyProgramAligned &&
			result.publicTaskFamiliesAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:canonical-tasks] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
