import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, isQueenBeeTaskFamily, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import type { QueenBeeVerifierExecutor } from "../src/queenbee/VerifierBee"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeFileCreationHarnessResult = {
	fileCreationDocsPresent: boolean
	packageScriptPresent: boolean
	protocolFamilyAligned: boolean
	plannerSupportsFamily: boolean
	coreSelectedForFileCreation: boolean
	assignmentDelivered: boolean
	reviewAndProofDelivered: boolean
	assignmentPacketExplicit: boolean
	completionRouteExplicit: boolean
	invalidRoutesStayClosed: boolean
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

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readFirstAssignmentPacket(envelope: QueenBeeEnvelope | null): QueenBeeEnvelope | null {
	const payload = asRecord(envelope?.payload)
	if (!payload || !Array.isArray(payload["assignmentPackets"])) return null
	const first = payload["assignmentPackets"][0]
	return first && typeof first === "object" && !Array.isArray(first) ? (first as QueenBeeEnvelope) : null
}

export async function runQueenBeeFileCreationHarness(rootDir = resolveRootDir()): Promise<QueenBeeFileCreationHarnessResult> {
	const details: string[] = []
	const primitiveAtlasText = readText(rootDir, "QUEENBEE_TASK_PRIMITIVE_ATLAS.md")
	const taskFamilyCoverageText = readText(rootDir, "QUEENBEE_TASK_FAMILY_COVERAGE.md")
	const allocationPolicyText = readText(rootDir, "QUEENBEE_ALLOCATION_POLICY.md")
	const canonicalTaskText = readText(rootDir, "QUEENBEE_CANONICAL_TASK_SET.md")
	const reverseEngineeringMapText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const traceabilityText = readText(rootDir, "QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const capabilityRegistryText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const conopsText = readText(rootDir, "QUEENBEE_CONOPS.md")
	const betaGateText = readText(rootDir, "QUEENBEE_BETA_GATE.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }

	const fileCreationDocsPresent =
		includesAll(primitiveAtlasText, [
			"# QueenBee Task Primitive Atlas",
			"`QB-PRIM-11`",
			"`proposal_first_file_creation`",
			"`create_tiny_file`",
			"create-safe completion",
		]) &&
		includesAll(taskFamilyCoverageText, [
			"`create_tiny_file`",
			"internal supported file_creation row",
			"create-safe merge and archive",
		]) &&
		includesAll(allocationPolicyText, [
			"`create_tiny_file`",
			"create-safe closeout",
		]) &&
		includesAll(canonicalTaskText, [
			"`QB-CAN-02`",
			"`verify:queenbee:file-creation`",
			"`verify:queenbee:create-complete`",
		]) &&
		includesAll(reverseEngineeringMapText, [
			"`QB-CAN-02`",
			"`file_creation`",
			"create-safe",
		]) &&
		includesAll(gapRegisterText, [
			"`QB-GAP-223-01`",
			"`create_tiny_file`",
			"create-safe merge",
		]) &&
		includesAll(traceabilityText, [
			"`QB-TR-07`",
			"QB-PRIM-11",
			"`verify:queenbee:create-complete`",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 231 QueenBee File-Creation Candidate Note",
			"internal QueenBee file-creation row",
			"public beta target remains frozen",
		]) &&
		includesAll(firstSliceText, [
			"## Session 231 File-Creation Candidate Lane",
			"`create_tiny_file`",
			"`verify:queenbee:file-creation`",
		]) &&
		includesAll(protocolMapText, [
			"## Session 231 File-Creation Candidate Lane",
			"`create_tiny_file`",
			"`file_creation`",
		]) &&
		includesAll(messageSchemaText, [
			"## Session 231 File-Creation Candidate Shell",
			"`create_tiny_file`",
			"`file_creation`",
			"create-safe closeout",
		]) &&
		includesAll(capabilityRegistryText, [
			"## Session 231 File-Creation Candidate Lane",
			"`create_tiny_file`",
			"`JSTSCoreBee`",
		]) &&
		includesAll(conopsText, [
			"one internal `create_tiny_file` file_creation lane is now supported through create-safe completion",
			"public beta boundary stays frozen",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 231 adds a proofable file-creation candidate lane without widening the public beta boundary",
			"**Session:** 231",
		]) &&
		includesAll(verificationCatalogText, [
			"`npm.cmd run verify:queenbee:file-creation`",
			"proposal-first `file_creation` candidate",
		])

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:file-creation"] === "npm run build && node dist/verification/verify_queenbee_file_creation.js"
	const protocolFamilyAligned = isQueenBeeTaskFamily("create_tiny_file")

	const verifierExecutor: QueenBeeVerifierExecutor = ({ command }) => ({
		command,
		exitCode: command === "npm.cmd run verify:guardrails" ? 0 : 1,
		passed: command === "npm.cmd run verify:guardrails",
		outputSummary: command === "npm.cmd run verify:guardrails" ? "guardrails PASS" : "file_creation stub failure",
	})

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-file-creation")
	try {
		const targetFile = "src/queenbeeTiny.ts"
		const targetPath = path.join(fixture.repoPath, targetFile)
		fs.mkdirSync(path.dirname(targetPath), { recursive: true })
		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath, verifierExecutor })
		const plannerSupportsFamily =
			shell.planner.listSupportedTaskFamilies().join(",") ===
			"comment_file,create_tiny_file,update_named_file,bounded_two_file_update,update_file_and_test,rename_export,bounded_node_cli_task"

		const lookupEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-file-create-lookup",
			missionId: "mission-file-create-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "registry_lookup_request",
			timestamp: "2026-03-28T14:10:00Z",
			payload: {
				desiredRoleFamily: "coder",
				desiredLanguagePack: "js_ts",
				requiredToolFamilies: ["repo_edit"],
			},
		})
		const lookupResult = shell.router.routeEnvelope(lookupEnvelope)
		const lookupPayload = asRecord(lookupResult.responseEnvelope?.payload)
		const candidateBeeIds = Array.isArray(lookupPayload?.["candidateBeeIds"]) ? (lookupPayload["candidateBeeIds"] as string[]) : []
		const reservedBeeId = candidateBeeIds[0] ?? ""

		const reserveEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-file-create-reserve",
			missionId: "mission-file-create-1",
			assignmentId: "assign-file-create-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "bee_reserve_request",
			timestamp: "2026-03-28T14:11:00Z",
			payload: {
				targetBeeId: reservedBeeId,
				assignmentId: "assign-file-create-1",
			},
		})
		const reserveResult = shell.router.routeEnvelope(reserveEnvelope)
		const reserved = asRecord(reserveResult.responseEnvelope?.payload)?.["reserved"] === true

		const planEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-file-create-plan",
			missionId: "mission-file-create-1",
			assignmentId: "assign-file-create-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-28T14:12:00Z",
			payload: {
				task: 'create src/queenbeeTiny.ts with the exact comment "// queenbee: file creation candidate"',
				taskFamily: "create_tiny_file",
				targetFiles: [targetFile],
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
				reservedBeeId,
			},
		})
		const planResult = shell.router.routeEnvelope(planEnvelope)
		const planPayload = asRecord(planResult.responseEnvelope?.payload)
		const assignmentPacket = readFirstAssignmentPacket(planResult.responseEnvelope)
		const assignmentPayload = asRecord(assignmentPacket?.payload)
		const allowedFiles = Array.isArray(assignmentPayload?.["allowedFiles"]) ? (assignmentPayload["allowedFiles"] as string[]) : []
		const coreSelectedForFileCreation =
			assignmentPacket !== null && shell.coder.selectSpecialistForEnvelope(assignmentPacket) === "JSTSCoreBee"
		const coderResult = assignmentPacket ? shell.router.relayPlannedAssignment(assignmentPacket) : null
		const coderPayload = asRecord(coderResult?.responseEnvelope?.payload)
		const proposals = Array.isArray(coderPayload?.["proposals"]) ? (coderPayload["proposals"] as Array<Record<string, unknown>>) : []
		const firstProposal = asRecord(proposals[0])

		const assignmentDelivered =
			lookupResult.status === "delivered" &&
			reserved &&
			planResult.status === "delivered" &&
			planPayload?.["accepted"] === true &&
			coderResult?.status === "delivered" &&
			coderResult.responseEnvelope?.messageType === "work_result" &&
			coderPayload?.["accepted"] === true &&
			proposals.length === 1 &&
			firstProposal?.["path"] === targetFile &&
			firstProposal?.["beforeContent"] === "" &&
			typeof firstProposal?.["afterContent"] === "string" &&
			String(firstProposal["afterContent"]).includes("// queenbee: file creation candidate") &&
			!fs.existsSync(targetPath)

		const reviewResult = coderResult?.responseEnvelope ? shell.router.relayCoderWorkResult(coderResult.responseEnvelope) : null
		const reviewPayload = asRecord(reviewResult?.responseEnvelope?.payload)
		const verificationResult =
			reviewResult?.responseEnvelope
				? shell.router.relayReviewVerdictToVerifier(
						reviewResult.responseEnvelope,
						["npm.cmd run verify:guardrails"],
						"file_creation_guardrail_pack",
				  )
				: null
		const verificationPayload = asRecord(verificationResult?.responseEnvelope?.payload)
		const reviewAndProofDelivered =
			reviewResult?.status === "delivered" &&
			reviewResult.responseEnvelope?.messageType === "review_pass" &&
			reviewPayload?.["accepted"] === true &&
			verificationResult?.status === "delivered" &&
			verificationResult.responseEnvelope?.messageType === "verification_pass" &&
			verificationPayload?.["accepted"] === true

		const assignmentPacketExplicit =
			assignmentPacket?.messageType === "assignment_packet" &&
			assignmentPacket.senderBeeId === "queenbee.planner.001" &&
			assignmentPacket.recipientBeeId === "queenbee.jsts_coder.001" &&
			allowedFiles.join(",") === targetFile &&
			assignmentPayload?.["expectedResult"] === "file_creation"

		const mergeResult =
			verificationResult?.responseEnvelope && coderResult?.responseEnvelope
				? shell.router.relayVerificationVerdictToMerge(verificationResult.responseEnvelope, coderResult.responseEnvelope)
				: null
		const mergePayload = asRecord(mergeResult?.responseEnvelope?.payload)
		const archiveResult = mergeResult?.responseEnvelope ? shell.router.relayMergeResultToArchivist(mergeResult.responseEnvelope) : null
		const archivePayload = asRecord(archiveResult?.responseEnvelope?.payload)

		const invalidPlanEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-file-create-invalid-plan",
			missionId: "mission-file-create-2",
			assignmentId: "assign-file-create-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-28T14:13:00Z",
			payload: {
				task: "create src/queenbeeTiny.ts and utils.ts together",
				taskFamily: "create_tiny_file",
				targetFiles: [targetFile, "utils.ts"],
				languagePack: "js_ts",
				protectedFiles: [],
			},
		})
		const invalidPlanResult = shell.router.routeEnvelope(invalidPlanEnvelope)
		const invalidPlanPayload = asRecord(invalidPlanResult.responseEnvelope?.payload)

		const invalidAssignmentEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-file-create-invalid-assignment",
			missionId: "mission-file-create-3",
			assignmentId: "assign-file-create-3",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-28T14:14:00Z",
			payload: {
				task: "create src/queenbeeTiny.ts and utils.ts together",
				taskFamily: "create_tiny_file",
				languagePack: "js_ts",
				allowedFiles: [targetFile, "utils.ts"],
				forbiddenFiles: [],
				expectedResult: "file_creation",
				plannerSummary: "PlannerBee emitted 1 assignment packet for create_tiny_file over src/queenbeeTiny.ts, utils.ts.",
				requiresReview: true,
				requiresVerification: true,
			},
		})
		const invalidAssignmentResult = shell.router.routeEnvelope(invalidAssignmentEnvelope)
		const invalidAssignmentPayload = asRecord(invalidAssignmentResult.responseEnvelope?.payload)

		const completionRouteExplicit =
			mergeResult?.status === "delivered" &&
			((mergeResult.responseEnvelope?.messageType === "merge_pass" &&
				mergePayload?.["accepted"] === true &&
				fs.existsSync(targetPath) &&
				archiveResult?.status === "delivered" &&
				archiveResult.responseEnvelope?.messageType === "archive_written" &&
				typeof archivePayload?.["archivePath"] === "string") ||
				(mergeResult.responseEnvelope?.messageType === "merge_blocked" &&
					mergePayload?.["accepted"] === false &&
					!fs.existsSync(targetPath)))

		const invalidRoutesStayClosed =
			invalidPlanResult.status === "delivered" &&
			invalidPlanPayload?.["accepted"] === false &&
			invalidPlanPayload?.["reason"] === "single_file_task_family_requires_one_target" &&
			invalidAssignmentResult.status === "delivered" &&
			invalidAssignmentResult.responseEnvelope?.messageType === "work_result" &&
			invalidAssignmentPayload?.["accepted"] === false &&
			invalidAssignmentPayload?.["reason"] === "coder_target_count_out_of_bounds"

		const publicBetaBoundaryPreserved =
			includesAll(betaGateText, [
				"Current gate answer: `EXPERIMENTAL_BETA_OK`",
				"`swarmengine` remains the shipped bounded engine",
				"`queenbee` remains experimental",
			]) &&
			includesAll(conopsText, ["public beta family set", "public beta boundary stays frozen"])

		details.push(
			`supportedFamilies=${shell.planner.listSupportedTaskFamilies().join(",")}`,
			`lookupCandidates=${candidateBeeIds.join(",") || "missing"}`,
			`assignmentAllowedFiles=${allowedFiles.join(",") || "missing"}`,
			`coderSummary=${String(coderPayload?.["coderSummary"] ?? "missing")}`,
			`reviewType=${reviewResult?.responseEnvelope?.messageType ?? "missing"}`,
			`verificationType=${verificationResult?.responseEnvelope?.messageType ?? "missing"}`,
			`mergeType=${mergeResult?.responseEnvelope?.messageType ?? "missing"}`,
			`mergeReason=${String(mergePayload?.["reason"] ?? "missing")}`,
			`archiveType=${archiveResult?.responseEnvelope?.messageType ?? "missing"}`,
			`archivePath=${String(archivePayload?.["archivePath"] ?? "missing")}`,
			`invalidPlanReason=${String(invalidPlanPayload?.["reason"] ?? "missing")}`,
			`invalidAssignmentReason=${String(invalidAssignmentPayload?.["reason"] ?? "missing")}`,
		)

		return {
			fileCreationDocsPresent,
			packageScriptPresent,
			protocolFamilyAligned,
			plannerSupportsFamily,
			coreSelectedForFileCreation,
			assignmentDelivered,
			reviewAndProofDelivered,
			assignmentPacketExplicit,
			completionRouteExplicit,
			invalidRoutesStayClosed,
			publicBetaBoundaryPreserved,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeFileCreationHarnessResult(result: QueenBeeFileCreationHarnessResult): string {
	return [
		`File-creation docs present: ${result.fileCreationDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Protocol family aligned: ${result.protocolFamilyAligned ? "PASS" : "FAIL"}`,
		`Planner supports file creation: ${result.plannerSupportsFamily ? "PASS" : "FAIL"}`,
		`Core selected for file creation: ${result.coreSelectedForFileCreation ? "PASS" : "FAIL"}`,
		`Assignment delivered: ${result.assignmentDelivered ? "PASS" : "FAIL"}`,
		`Review and proof delivered: ${result.reviewAndProofDelivered ? "PASS" : "FAIL"}`,
		`Assignment packet explicit: ${result.assignmentPacketExplicit ? "PASS" : "FAIL"}`,
		`Completion route explicit: ${result.completionRouteExplicit ? "PASS" : "FAIL"}`,
		`Invalid routes stay closed: ${result.invalidRoutesStayClosed ? "PASS" : "FAIL"}`,
		`Public beta boundary preserved: ${result.publicBetaBoundaryPreserved ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeFileCreationHarness()
	console.log(formatQueenBeeFileCreationHarnessResult(result))
	process.exit(
		result.fileCreationDocsPresent &&
			result.packageScriptPresent &&
			result.protocolFamilyAligned &&
			result.plannerSupportsFamily &&
			result.coreSelectedForFileCreation &&
			result.assignmentDelivered &&
			result.reviewAndProofDelivered &&
			result.assignmentPacketExplicit &&
			result.completionRouteExplicit &&
			result.invalidRoutesStayClosed &&
			result.publicBetaBoundaryPreserved
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:file-creation] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
