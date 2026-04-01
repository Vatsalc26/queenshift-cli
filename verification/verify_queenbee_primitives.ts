import fs from "node:fs"
import path from "node:path"

export type QueenBeePrimitivesHarnessResult = {
	packageScriptPresent: boolean
	primitiveAtlasPresent: boolean
	taskFamilyCoveragePresent: boolean
	beeClassificationPresent: boolean
	taskCorpusAligned: boolean
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

export async function runQueenBeePrimitivesHarness(rootDir = resolveRootDir()): Promise<QueenBeePrimitivesHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const primitiveAtlasText = readText(rootDir, "QUEENBEE_TASK_PRIMITIVE_ATLAS.md")
	const taskFamilyCoverageText = readText(rootDir, "QUEENBEE_TASK_FAMILY_COVERAGE.md")
	const beeClassificationText = readText(rootDir, "QUEENBEE_BEE_CLASSIFICATION.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:primitives"] === "npm run build && node dist/verification/verify_queenbee_primitives.js"

	const primitiveAtlasPresent = includesAll(primitiveAtlasText, [
		"# QueenBee Task Primitive Atlas",
		"`comment_file`",
		"`create_tiny_file`",
		"`bounded_node_cli_task`",
		"`QB-PRIM-01`",
		"`QB-PRIM-04`",
		"`QB-PRIM-07`",
		"`QB-PRIM-10`",
		"`QB-PRIM-11`",
		"`proposal_first_file_creation`",
		"specialist-bee additions must be justified by repeated primitive clusters",
		"only specialist worker families may become cloneable later",
		"`JSTSCoreBee`",
		"`JSTSAsyncBee`",
		"`JSTSNodeBee`",
	])

	const taskFamilyCoveragePresent = includesAll(taskFamilyCoverageText, [
		"# QueenBee Task Family Coverage",
		"`comment_file`",
		"`update_named_file`",
		"`bounded_two_file_update`",
		"`update_file_and_test`",
		"`rename_export`",
		"`bounded_node_cli_task`",
		"`create_tiny_file`",
		"`sync_docs_with_source`",
		"`sync_docs_bundle`",
		"`medium_multi_file_update`",
		"`cross_language_sync`",
		"internal supported file_creation row",
		"QueenBee-Only Candidate Family",
		"`bounded_node_cli_task` is intentionally a QueenBee candidate family",
	])

	const beeClassificationPresent = includesAll(beeClassificationText, [
		"# QueenBee Bee Classification",
		"`reasoning_class`",
		"`control_class`",
		"`clone_class`",
		"`mobility_class`",
		"`visibility_class`",
		"`thinking`",
		"`deterministic`",
		"`fixed_control`",
		"`specialist_worker`",
		"`fixed_singleton`",
		"`clone_candidate_later`",
		"`stationary`",
		"`movable_assignment`",
		"`user_visible`",
		"`trace_visible`",
		"`QueenBee`",
		"`RouterBee`",
		"`JSTSCoderBee`",
		"`JSTSReviewerBee`",
		"`VerifierBee`",
		"`JSTSCoreBee`",
		"`JSTSAsyncBee`",
		"`JSTSNodeBee`",
		"only specialist worker families may become cloneable later",
	])

	const taskCorpusAligned = includesAll(taskCorpusText, [
		"## Session 216 QueenBee Primitive Bridge Note",
		"`QUEENBEE_TASK_FAMILY_COVERAGE.md` is now the source of truth",
		"`bounded_node_cli_task` remains a QueenBee candidate family",
		"`create_tiny_file` stays outside the current public beta family set",
		"## Session 231 QueenBee File-Creation Candidate Note",
		"internal QueenBee file-creation row",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 216 maps QueenBee capability through primitives and keeps cloneability specialist-only",
		"**Session:** 216",
		"`QUEENBEE_TASK_PRIMITIVE_ATLAS.md`",
		"`QUEENBEE_TASK_FAMILY_COVERAGE.md`",
		"`QUEENBEE_BEE_CLASSIFICATION.md`",
		"`npm.cmd run verify:queenbee:primitives`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B22 |",
		"`QUEENBEE_TASK_PRIMITIVE_ATLAS.md`",
		"`QUEENBEE_TASK_FAMILY_COVERAGE.md`",
		"`QUEENBEE_BEE_CLASSIFICATION.md`",
		"`npm.cmd run verify:queenbee:primitives`",
		"fixed-control versus specialist clone-candidates",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:primitives`",
		"primitive atlas",
		"family-coverage crosswalk",
		"bee-class matrix",
		"specialist growth, cloneability, and refusal boundaries",
	])

	details.push(
		`primitiveAtlasPresent=${primitiveAtlasPresent ? "yes" : "no"}`,
		`taskFamilyCoveragePresent=${taskFamilyCoveragePresent ? "yes" : "no"}`,
		`beeClassificationPresent=${beeClassificationPresent ? "yes" : "no"}`,
		`taskCorpusAligned=${taskCorpusAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		primitiveAtlasPresent,
		taskFamilyCoveragePresent,
		beeClassificationPresent,
		taskCorpusAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeePrimitivesHarnessResult(result: QueenBeePrimitivesHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Primitive atlas present: ${result.primitiveAtlasPresent ? "PASS" : "FAIL"}`,
		`Task-family coverage present: ${result.taskFamilyCoveragePresent ? "PASS" : "FAIL"}`,
		`Bee classification present: ${result.beeClassificationPresent ? "PASS" : "FAIL"}`,
		`Task corpus aligned: ${result.taskCorpusAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeePrimitivesHarness()
	console.log(formatQueenBeePrimitivesHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.primitiveAtlasPresent &&
			result.taskFamilyCoveragePresent &&
			result.beeClassificationPresent &&
			result.taskCorpusAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:primitives] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
