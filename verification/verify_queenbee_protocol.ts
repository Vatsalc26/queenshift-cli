import fs from "node:fs"
import path from "node:path"

export type QueenBeeProtocolHarnessResult = {
	engineBoundaryAligned: boolean
	protocolVersionAligned: boolean
	beeRosterAligned: boolean
	taskFamilyOrderAligned: boolean
	coreProtocolDocsPresent: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function readText(rootDir: string, relativePath: string): string {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8")
}

function extractSection(text: string, heading: string): string {
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const headingPattern = new RegExp(`^## ${escaped}\\b.*$`, "m")
	const headingMatch = headingPattern.exec(text)
	if (!headingMatch || typeof headingMatch.index !== "number") return ""

	const sectionStart = headingMatch.index
	const afterHeading = text.slice(sectionStart)
	const remainder = afterHeading.slice(headingMatch[0].length)
	const nextHeadingIndex = remainder.search(/\n##\s/u)
	if (nextHeadingIndex === -1) return afterHeading.trimEnd()
	return afterHeading.slice(0, headingMatch[0].length + nextHeadingIndex).trimEnd()
}

function normalizeBeeName(value: string): string {
	return value
		.replace(/[`*]/g, "")
		.replace(/^queenbee\./, "")
		.replace(/\.001$/, "")
		.replace(/_/g, "")
		.replace(/\s+/g, "")
		.toLowerCase()
}

function extractBacktickedItems(section: string): string[] {
	return Array.from(section.matchAll(/`([^`]+)`/g), (match) => match[1] ?? "").filter((item) => item.length > 0)
}

function extractStandaloneBeeNames(section: string): string[] {
	return Array.from(section.matchAll(/`([A-Za-z]+Bee)`/g), (match) => match[1] ?? "")
		.filter((item) => item.length > 0)
		.map(normalizeBeeName)
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

function sameOrderedList(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

export async function runQueenBeeProtocolHarness(rootDir = resolveRootDir()): Promise<QueenBeeProtocolHarnessResult> {
	const details: string[] = []

	const readmeText = readText(rootDir, "Readme.md")
	const candidateText = readText(rootDir, "QUEENBEE_PROTOCOL_ARCHITECTURE_CANDIDATE.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const stateMachineText = readText(rootDir, "QUEENBEE_STATE_MACHINE.md")
	const registryText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const toolGrantsText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const failureRulesText = readText(rootDir, "QUEENBEE_FAILURE_AND_QUARANTINE_RULES.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")

	const readmeEngineSection = extractSection(readmeText, "Engine Names And Experimental Direction")
	const candidateRelationshipSection = extractSection(candidateText, "Relationship To SwarmEngine")
	const firstSliceEngineFlagSection = extractSection(firstSliceText, "Engine Flag")
	const candidateBeeSection = extractSection(candidateText, "Frozen Candidate Bee Set")
	const firstSliceBeeSection = extractSection(firstSliceText, "Frozen Bee Set For The Slice")
	const candidateTaskSection = extractSection(candidateText, "First Real Slice")
	const firstSliceTaskSection = extractSection(firstSliceText, "First Supported Task Families")

	const engineBoundaryAligned =
		includesAll(readmeEngineSection, ["`swarmengine`", "`queenbee`", "not part of the current public product claim"]) &&
		includesAll(candidateRelationshipSection, ["`--engine swarmengine`", "`--engine queenbee`", "`swarmengine` remains the shipped default"]) &&
		includesAll(firstSliceEngineFlagSection, ["`--engine swarmengine`", "`--engine queenbee`", "`swarmengine` stays the default"]) &&
		includesAll(registryText, ["1. `swarmengine`", "2. `queenbee`"])

	const protocolVersionAligned =
		candidateText.includes("`qb-v1`") &&
		firstSliceText.includes("`qb-v1`") &&
		messageSchemaText.includes('"protocolVersion": "qb-v1"')

	const candidateBeeNames = extractStandaloneBeeNames(candidateBeeSection)
	const firstSliceBeeNames = extractStandaloneBeeNames(firstSliceBeeSection)
	const registryBeeNames = extractBacktickedItems(registryText)
		.filter((item) => item.startsWith("queenbee."))
		.map(normalizeBeeName)
	const expectedBeeOrder = [
		"queenbee",
		"routerbee",
		"registrybee",
		"safetybee",
		"scoutbee",
		"plannerbee",
		"jstscoderbee",
		"jstsreviewerbee",
		"verifierbee",
		"mergebee",
		"archivistbee",
		"recoverybee",
	]
	const expectedBeeLabels = [
		"QueenBee",
		"RouterBee",
		"RegistryBee",
		"SafetyBee",
		"ScoutBee",
		"PlannerBee",
		"JSTSCoderBee",
		"JSTSReviewerBee",
		"VerifierBee",
		"MergeBee",
		"ArchivistBee",
		"RecoveryBee",
	]

	const beeRosterAligned =
		sameOrderedList(candidateBeeNames, expectedBeeOrder) &&
		sameOrderedList(firstSliceBeeNames, expectedBeeOrder) &&
		sameOrderedList(registryBeeNames, [
			"queen",
			"router",
			"registry",
			"safety",
			"scout",
			"planner",
			"jstscoder",
			"jstsreviewer",
			"verifier",
			"merge",
			"archivist",
			"recovery",
		]) &&
		expectedBeeLabels.every((bee) => protocolMapText.includes(bee))

	const candidateTaskFamilies = extractBacktickedItems(candidateTaskSection).filter((item) =>
		["comment_file", "update_named_file", "bounded_two_file_update"].includes(item),
	)
	const firstSliceTaskFamilies = extractBacktickedItems(firstSliceTaskSection).filter((item) =>
		["comment_file", "update_named_file", "bounded_two_file_update"].includes(item),
	)
	const taskFamilyOrderAligned =
		sameOrderedList(candidateTaskFamilies, ["update_named_file", "comment_file", "bounded_two_file_update"]) &&
		sameOrderedList(firstSliceTaskFamilies, ["comment_file", "update_named_file", "bounded_two_file_update"]) &&
		firstSliceText.includes("`bounded_two_file_update` only after the one-file path is green enough for direct comparison")

	const coreProtocolDocsPresent =
		includesAll(stateMachineText, ["`Idle`", "`Reserved`", "`Assigned`", "`Executing`", "`Completed`", "`Quarantined`"]) &&
		includesAll(messageSchemaText, ["`protocolVersion`", "`engine`", "`messageType`", "`scopeToken`", "`toolGrantToken`"]) &&
		includesAll(toolGrantsText, ["`repo_edit`", "`verify_exec`", "`git_merge`", "`artifact_write`"]) &&
		includesAll(failureRulesText, ["`protocol_violation`", "`scope_violation`", "`verification_failure`", "`merge_failure`", "`provider_failure`"])

	details.push(
		`candidateBeeNames=${candidateBeeNames.join(",") || "missing"}`,
		`firstSliceBeeNames=${firstSliceBeeNames.join(",") || "missing"}`,
		`registryBeeNames=${registryBeeNames.join(",") || "missing"}`,
		`protocolBeeCoverage=${expectedBeeLabels.filter((bee) => protocolMapText.includes(bee)).join(",") || "missing"}`,
		`candidateTaskFamilies=${candidateTaskFamilies.join(",") || "missing"}`,
		`firstSliceTaskFamilies=${firstSliceTaskFamilies.join(",") || "missing"}`,
	)

	return {
		engineBoundaryAligned,
		protocolVersionAligned,
		beeRosterAligned,
		taskFamilyOrderAligned,
		coreProtocolDocsPresent,
		details,
	}
}

export function formatQueenBeeProtocolHarnessResult(result: QueenBeeProtocolHarnessResult): string {
	return [
		`Engine boundary aligned: ${result.engineBoundaryAligned ? "PASS" : "FAIL"}`,
		`Protocol version aligned: ${result.protocolVersionAligned ? "PASS" : "FAIL"}`,
		`Bee roster aligned: ${result.beeRosterAligned ? "PASS" : "FAIL"}`,
		`Task-family order aligned: ${result.taskFamilyOrderAligned ? "PASS" : "FAIL"}`,
		`Core protocol docs present: ${result.coreProtocolDocsPresent ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeProtocolHarness()
	console.log(formatQueenBeeProtocolHarnessResult(result))
	process.exit(
		result.engineBoundaryAligned &&
			result.protocolVersionAligned &&
			result.beeRosterAligned &&
			result.taskFamilyOrderAligned &&
			result.coreProtocolDocsPresent
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:protocol] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
