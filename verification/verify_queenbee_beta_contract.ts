import fs from "node:fs"
import path from "node:path"

export type QueenBeeBetaContractHarnessResult = {
	packageScriptPresent: boolean
	readmeRoadmapAligned: boolean
	candidateBetaContractPresent: boolean
	firstSliceBetaTargetPresent: boolean
	specialistSelectionStoryExplicit: boolean
	taskCorpusAligned: boolean
	verificationCatalogAligned: boolean
	architectureDecisionRecorded: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function readText(rootDir: string, relativePath: string): string {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8")
}

function extractSection(text: string, heading: string): string {
	const headingPattern = new RegExp(`^## ${escapeRegExp(heading)}\\b.*$`, "m")
	const headingMatch = headingPattern.exec(text)
	if (!headingMatch || typeof headingMatch.index !== "number") return ""

	const sectionStart = headingMatch.index
	const afterHeading = text.slice(sectionStart)
	const remainder = afterHeading.slice(headingMatch[0].length)
	const nextHeadingIndex = remainder.search(/\n##\s/u)
	if (nextHeadingIndex === -1) return afterHeading.trimEnd()
	return afterHeading.slice(0, headingMatch[0].length + nextHeadingIndex).trimEnd()
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

export async function runQueenBeeBetaContractHarness(rootDir = resolveRootDir()): Promise<QueenBeeBetaContractHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const readmeText = readText(rootDir, "Readme.md")
	const candidateText = readText(rootDir, "QUEENBEE_PROTOCOL_ARCHITECTURE_CANDIDATE.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const registryText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")

	const expectedFamilies = [
		"`comment_file`",
		"`update_named_file`",
		"`bounded_two_file_update`",
		"`update_file_and_test`",
		"`rename_export`",
		"`bounded_node_cli_task`",
	]

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:beta-contract"] === "npm run build && node dist/verification/verify_queenbee_beta_contract.js"
	const readmeRoadmapAligned = includesAll(readmeText, [
		"Roadmap_Sessions203-214.md",
		"Session 207 widening:",
		"npm.cmd run verify:queenbee:beta-contract",
		"`bounded_node_cli_task`",
		"`swarmengine` stays the shipped bounded engine and `queenbee` stays experimental",
	])
	const candidateSection = extractSection(candidateText, "Session 207 Bounded Beta Widening Contract")
	const candidateBetaContractPresent = includesAll(candidateSection, [
		"Roadmap_Sessions203-214.md",
		"`CONTAINED_HOLD`",
		...expectedFamilies,
		"candidate-only",
		"`verify:queenbee:beta-contract`",
	])
	const firstSliceTargetSection = extractSection(firstSliceText, "Session 207 Widened Beta Target")
	const specialistSection = extractSection(firstSliceText, "Session 207 Specialist Coder Selection Story")
	const firstSliceBetaTargetPresent =
		includesAll(firstSliceTargetSection, [
			"Session 207 froze this wider target before the later runtime and proof sessions landed",
			...expectedFamilies,
			"lane-specific runtime and proof sessions",
			"`verify:queenbee:beta-contract`",
		]) &&
		includesAll(firstSliceTargetSection, [
			"`update_file_and_test`",
			"`rename_export`",
			"`bounded_node_cli_task`",
			"the current live candidate shell now includes all six families",
		])
	const specialistSelectionStoryExplicit =
		includesAll(specialistSection, [
			"`JSTSCoderBee` remains the routed coder endpoint",
			"Session 208 activates `JSTSCoreBee`",
			"`JSTSCoreBee`",
			"`JSTSAsyncBee`",
			"`JSTSNodeBee`",
			"fail closed",
		]) &&
		includesAll(registryText, [
			"## Session 207 Specialist Selection Hints",
			"`JSTSCoreBee`",
			"`JSTSAsyncBee`",
			"`JSTSNodeBee`",
			"`rename_export` stays symbol-scoped",
		])
	const taskCorpusAligned = includesAll(taskCorpusText, [
		"## Session 207 QueenBee Beta Widening Note",
		"`comment_file`",
		"`update_named_file`",
		"`bounded_two_file_update`",
		"`update_file_and_test`",
		"`rename_export`",
		"`bounded_node_cli_task`",
		"does not widen the public claim",
	])
	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:beta-contract`",
		"six-family bounded beta target",
		"first specialist-coder selection story",
		"candidate-only",
	])
	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 207 freezes a widened bounded QueenBee beta contract before specialist runtime widening",
		"**Session:** 207",
		"`comment_file`",
		"`bounded_node_cli_task`",
		"`swarmengine` remains the shipped bounded engine and `queenbee` remains experimental",
	])

	details.push(
		`candidateSection=${candidateSection ? "present" : "missing"}`,
		`firstSliceTargetSection=${firstSliceTargetSection ? "present" : "missing"}`,
		`specialistSection=${specialistSection ? "present" : "missing"}`,
		`expectedFamilies=${expectedFamilies.join(",")}`,
	)

	return {
		packageScriptPresent,
		readmeRoadmapAligned,
		candidateBetaContractPresent,
		firstSliceBetaTargetPresent,
		specialistSelectionStoryExplicit,
		taskCorpusAligned,
		verificationCatalogAligned,
		architectureDecisionRecorded,
		details,
	}
}

export function formatQueenBeeBetaContractHarnessResult(result: QueenBeeBetaContractHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Readme roadmap aligned: ${result.readmeRoadmapAligned ? "PASS" : "FAIL"}`,
		`Candidate beta contract present: ${result.candidateBetaContractPresent ? "PASS" : "FAIL"}`,
		`First-slice beta target present: ${result.firstSliceBetaTargetPresent ? "PASS" : "FAIL"}`,
		`Specialist selection story explicit: ${result.specialistSelectionStoryExplicit ? "PASS" : "FAIL"}`,
		`Task corpus aligned: ${result.taskCorpusAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeBetaContractHarness()
	console.log(formatQueenBeeBetaContractHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.readmeRoadmapAligned &&
			result.candidateBetaContractPresent &&
			result.firstSliceBetaTargetPresent &&
			result.specialistSelectionStoryExplicit &&
			result.taskCorpusAligned &&
			result.verificationCatalogAligned &&
			result.architectureDecisionRecorded
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:beta-contract] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
