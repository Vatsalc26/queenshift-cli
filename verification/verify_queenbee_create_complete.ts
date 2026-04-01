import fs from "node:fs"
import path from "node:path"

import { runQueenBeeFileCreationHarness } from "./verify_queenbee_file_creation"

export type QueenBeeCreateCompleteHarnessResult = {
	packageScriptPresent: boolean
	createCompleteDocsPresent: boolean
	fileCreationLaneGreen: boolean
	confidenceAndProgressAligned: boolean
	toolGrantAligned: boolean
	capabilityChecklistAligned: boolean
	verificationCatalogAligned: boolean
	publicBetaBoundaryPreserved: boolean
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

export async function runQueenBeeCreateCompleteHarness(rootDir = resolveRootDir()): Promise<QueenBeeCreateCompleteHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const canonicalTaskText = readText(rootDir, "QUEENBEE_CANONICAL_TASK_SET.md")
	const reverseEngineeringMapText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const traceabilityText = readText(rootDir, "QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
	const confidenceText = readText(rootDir, "QUEENBEE_OPERATOR_CONFIDENCE_CONTRACT.md")
	const progressText = readText(rootDir, "QUEENBEE_PROGRESS_VISIBILITY_CONTRACT.md")
	const toolGrantText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const conopsText = readText(rootDir, "QUEENBEE_CONOPS.md")
	const betaGateText = readText(rootDir, "QUEENBEE_BETA_GATE.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:create-complete"] === "npm run build && node dist/verification/verify_queenbee_create_complete.js"

	const createCompleteDocsPresent =
		includesAll(canonicalTaskText, [
			"`QB-CAN-02`",
			"`create_tiny_file`",
			"`SUPPORTED`",
			"`verify:queenbee:create-complete`",
		]) &&
		includesAll(reverseEngineeringMapText, [
			"`QB-CAN-02`",
			"`SUPPORTED`",
			"create-safe merge",
			"archived",
		]) &&
		includesAll(traceabilityText, [
			"`QB-TR-07`",
			"`SUPPORTED`",
			"`verify:queenbee:create-complete`",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 232 closes the bounded create_tiny_file lane with create-safe merge and archive proof",
			"**Session:** 232",
		])

	const confidenceAndProgressAligned =
		includesAll(confidenceText, ["create-safe closeout", "`create_tiny_file`", "`bounded_pass`", "`merge_blocked`"]) &&
		includesAll(progressText, ["create-safe closeout", "`create_tiny_file`", "`merge_and_archive`", "`completion_queue`"])

	const toolGrantAligned = includesAll(toolGrantText, [
		"## Session 232 Create-Safe Completion Grant Rule",
		"`create_tiny_file`",
		"`verify:queenbee:create-complete`",
		"`git_merge`",
		"`artifact_write`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B38 |",
		"`npm.cmd run verify:queenbee:create-complete`",
		"create-safe merge and archive completion",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:create-complete`",
		"create-safe merge and archive completion lane",
	])

	const publicBetaBoundaryPreserved =
		includesAll(betaGateText, [
			"Current gate answer: `EXPERIMENTAL_BETA_OK`",
			"`swarmengine` remains the shipped bounded engine",
			"`queenbee` remains experimental",
		]) &&
		includesAll(conopsText, ["public beta family set", "public beta boundary stays frozen"])

	const fileCreationLane = await runQueenBeeFileCreationHarness(rootDir)
	const fileCreationLaneGreen =
		fileCreationLane.fileCreationDocsPresent &&
		fileCreationLane.packageScriptPresent &&
		fileCreationLane.protocolFamilyAligned &&
		fileCreationLane.plannerSupportsFamily &&
		fileCreationLane.coreSelectedForFileCreation &&
		fileCreationLane.assignmentDelivered &&
		fileCreationLane.reviewAndProofDelivered &&
		fileCreationLane.assignmentPacketExplicit &&
		fileCreationLane.completionRouteExplicit &&
		fileCreationLane.invalidRoutesStayClosed &&
		fileCreationLane.publicBetaBoundaryPreserved

	details.push(
		`fileCreationLaneGreen=${fileCreationLaneGreen ? "yes" : "no"}`,
		...fileCreationLane.details.map((detail) => `fileCreation:${detail}`),
	)

	return {
		packageScriptPresent,
		createCompleteDocsPresent,
		fileCreationLaneGreen,
		confidenceAndProgressAligned,
		toolGrantAligned,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		publicBetaBoundaryPreserved,
		details,
	}
}

export function formatQueenBeeCreateCompleteHarnessResult(result: QueenBeeCreateCompleteHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Create-complete docs present: ${result.createCompleteDocsPresent ? "PASS" : "FAIL"}`,
		`File-creation lane green: ${result.fileCreationLaneGreen ? "PASS" : "FAIL"}`,
		`Confidence and progress aligned: ${result.confidenceAndProgressAligned ? "PASS" : "FAIL"}`,
		`Tool grant aligned: ${result.toolGrantAligned ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Public beta boundary preserved: ${result.publicBetaBoundaryPreserved ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeCreateCompleteHarness()
	console.log(formatQueenBeeCreateCompleteHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.createCompleteDocsPresent &&
			result.fileCreationLaneGreen &&
			result.confidenceAndProgressAligned &&
			result.toolGrantAligned &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned &&
			result.publicBetaBoundaryPreserved
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:create-complete] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
