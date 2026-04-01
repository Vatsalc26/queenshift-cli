import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import type { QueenBeeVerifierExecutor } from "../src/queenbee/VerifierBee"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeJstsFileAndTestHarnessResult = {
	fileAndTestDocsPresent: boolean
	reverseEngineeringDocsPresent: boolean
	publicDocsTruthful: boolean
	packageScriptPresent: boolean
	plannerSupportsFamily: boolean
	testSelectedForFileAndTest: boolean
	assignmentDelivered: boolean
	reviewAndProofDelivered: boolean
	assignmentPacketExplicit: boolean
	routeSlotStayedGeneric: boolean
	parallelNeedStayedSingleton: boolean
	laneStayedBounded: boolean
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

export async function runQueenBeeJstsFileAndTestHarness(rootDir = resolveRootDir()): Promise<QueenBeeJstsFileAndTestHarnessResult> {
	const details: string[] = []
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const registryText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const reverseEngineeringMapText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const traceabilityText = readText(rootDir, "QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
	const publicTaskFamiliesText = readText(rootDir, "public_pack/docs/task-families.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }

	const fileAndTestDocsPresent =
		includesAll(firstSliceText, [
			"## Session 212 Update File And Test Lane",
			"`update_file_and_test`",
			"one explicit source file and one explicit direct local JS/TS test file",
			"`verify:queenbee:jsts:file-and-test`",
		]) &&
		includesAll(protocolMapText, [
			"## Session 212 File-And-Test Lane",
			"`update_file_and_test`",
			"one explicit source file plus one explicit direct local test file",
			"`verify:queenbee:jsts:file-and-test`",
		]) &&
		includesAll(registryText, [
			"## Session 212 File-And-Test Lane",
			"`update_file_and_test`",
			"`queenbee.jsts_coder.001`",
			"`verify:queenbee:jsts:file-and-test`",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 212 QueenBee File-And-Test Lane Note",
			"`update_file_and_test`",
			"one explicit source file plus one explicit direct local test file",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 212 makes update_file_and_test live in the bounded coder slot and removes stale CLI scaffolding copy",
			"`update_file_and_test`",
			"bounded-family hint",
		]) &&
		includesAll(verificationCatalogText, [
			"`npm.cmd run verify:queenbee:jsts:file-and-test`",
			"one explicit source file plus one explicit direct local test file",
		])
	const reverseEngineeringDocsPresent =
		includesAll(reverseEngineeringMapText, [
			"## Session 224 Symbol And Source-Test Answer",
			"`QB-CAN-05`",
			"`SUPPORTED` after Session 224",
			"no bounded multi-slice fan-out need",
		]) &&
		includesAll(gapRegisterText, [
			"`QB-GAP-224-01`",
			"`QB-GAP-224-02`",
			"`CLOSED_SESSION_224`",
		]) &&
		includesAll(traceabilityText, [
			"`QB-TR-04`",
			"one review/proof chain",
			"no bounded multi-slice need",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 224 QueenBee Symbol And Source-Test Reverse-Engineering Note",
			"`update_file_and_test` is now explicitly mapped through the same review and verifier surfaces",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 224 records rename and source-plus-test rows as review-and-proof-backed singleton lanes",
			"**Session:** 224",
		]) &&
		includesAll(verificationCatalogText, [
			"the Session 224 symbol and source-plus-test reverse-engineering answer now records",
			"`rename_export` and `update_file_and_test` as review-and-proof-backed singleton rows",
		])
	const publicDocsTruthful = includesAll(publicTaskFamiliesText, [
		"`update_file_and_test`",
		"one source file and one direct local test file",
	])
	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:jsts:file-and-test"] === "npm run build && node dist/verification/verify_queenbee_jsts_file_and_test.js"
	const verifierExecutor: QueenBeeVerifierExecutor = ({ command }) => ({
		command,
		exitCode: command === "npm.cmd run verify:queenbee:jsts:file-and-test" ? 0 : 1,
		passed: command === "npm.cmd run verify:queenbee:jsts:file-and-test",
		outputSummary:
			command === "npm.cmd run verify:queenbee:jsts:file-and-test" ? "queenbee:jsts:file-and-test PASS" : "file-and-test stub failure",
	})

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-jsts-file-and-test")
	try {
		const sourcePath = path.join(fixture.repoPath, "src", "format.ts")
		const testPath = path.join(fixture.repoPath, "src", "format.test.ts")
		const helperPath = path.join(fixture.repoPath, "src", "helper.ts")
		fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
		fs.writeFileSync(
			sourcePath,
			`export function formatLine(input: string): string {\n\treturn input.trim().toUpperCase()\n}\n`,
			"utf8",
		)
		fs.writeFileSync(
			testPath,
			`import { formatLine } from "./format"\n\nexport function expectFormat(): string {\n\treturn formatLine(" hello ")\n}\n`,
			"utf8",
		)
		fs.writeFileSync(helperPath, `export const helperValue = "helper"\n`, "utf8")

		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath, verifierExecutor })
		const plannerSupportsFamily =
			shell.planner.listSupportedTaskFamilies().join(",") ===
			"comment_file,create_tiny_file,update_named_file,bounded_two_file_update,update_file_and_test,rename_export,bounded_node_cli_task"

		const lookupEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-file-test-lookup",
			missionId: "mission-file-test-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "registry_lookup_request",
			timestamp: "2026-03-27T13:10:00Z",
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
			messageId: "msg-file-test-reserve",
			missionId: "mission-file-test-1",
			assignmentId: "assign-file-test-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "bee_reserve_request",
			timestamp: "2026-03-27T13:11:00Z",
			payload: {
				targetBeeId: reservedBeeId,
				assignmentId: "assign-file-test-1",
			},
		})
		const reserveResult = shell.router.routeEnvelope(reserveEnvelope)
		const reserved = asRecord(reserveResult.responseEnvelope?.payload)?.["reserved"] === true

		const planEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-file-test-plan",
			missionId: "mission-file-test-1",
			assignmentId: "assign-file-test-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-27T13:12:00Z",
			payload: {
				task: 'update src/format.ts and keep its test aligned so both files include the exact comment "// queenbee: file and test".',
				taskFamily: "update_file_and_test",
				targetFiles: ["src/format.ts", "src/format.test.ts"],
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
		const testSelectedForFileAndTest =
			assignmentPacket !== null && shell.coder.selectSpecialistForEnvelope(assignmentPacket) === "JSTSTestBee"
		const coderResult = assignmentPacket ? shell.router.relayPlannedAssignment(assignmentPacket) : null
		const coderPayload = asRecord(coderResult?.responseEnvelope?.payload)
		const proposals = Array.isArray(coderPayload?.["proposals"]) ? (coderPayload["proposals"] as Array<Record<string, unknown>>) : []
		const sourceProposal = proposals.find((proposal) => proposal["path"] === "src/format.ts")
		const testProposal = proposals.find((proposal) => proposal["path"] === "src/format.test.ts")

		const assignmentDelivered =
			lookupResult.status === "delivered" &&
			reserved &&
			planResult.status === "delivered" &&
			planPayload?.["accepted"] === true &&
			coderResult?.status === "delivered" &&
			coderResult.responseEnvelope?.messageType === "work_result" &&
			coderPayload?.["accepted"] === true &&
			proposals.length === 2
		const reviewResult = coderResult?.responseEnvelope ? shell.router.relayCoderWorkResult(coderResult.responseEnvelope) : null
		const reviewPayload = asRecord(reviewResult?.responseEnvelope?.payload)
		const verificationResult =
			reviewResult?.responseEnvelope
				? shell.router.relayReviewVerdictToVerifier(
						reviewResult.responseEnvelope,
						["npm.cmd run verify:queenbee:jsts:file-and-test"],
						"daily_jsts_matrix_file_and_test_pack",
				  )
				: null
		const verificationPayload = asRecord(verificationResult?.responseEnvelope?.payload)
		const reviewAndProofDelivered =
			reviewResult?.status === "delivered" &&
			reviewResult.responseEnvelope?.messageType === "review_pass" &&
			reviewPayload?.["accepted"] === true &&
			verificationResult?.status === "delivered" &&
			verificationResult.responseEnvelope?.messageType === "verification_pass" &&
			verificationPayload?.["accepted"] === true &&
			Array.isArray(verificationPayload?.["results"]) &&
			(verificationPayload?.["results"] as Array<Record<string, unknown>>).length === 1 &&
			(verificationPayload?.["results"] as Array<Record<string, unknown>>)[0]?.["command"] === "npm.cmd run verify:queenbee:jsts:file-and-test" &&
			typeof verificationPayload?.["verifierSummary"] === "string" &&
			String(verificationPayload["verifierSummary"]).includes("daily_jsts_matrix_file_and_test_pack") &&
			String(verificationPayload["verifierSummary"]).includes("npm.cmd run verify:queenbee:jsts:file-and-test")
		const assignmentPacketExplicit =
			assignmentPacket?.messageType === "assignment_packet" &&
			assignmentPacket.senderBeeId === "queenbee.planner.001" &&
			assignmentPacket.recipientBeeId === "queenbee.jsts_coder.001" &&
			allowedFiles.join(",") === "src/format.ts,src/format.test.ts" &&
			assignmentPayload?.["expectedResult"] === "update_file_and_test"
		const routeSlotStayedGeneric =
			reservedBeeId === "queenbee.jsts_coder.001" &&
			assignmentPacket?.recipientBeeId === "queenbee.jsts_coder.001" &&
			shell.router.listImplementedEdges().includes("RouterBee->JSTSCoderBee") &&
			shell.router.listImplementedEdges().includes("JSTSCoderBee->RouterBee")
		const parallelNeedStayedSingleton =
			reverseEngineeringDocsPresent &&
			routeSlotStayedGeneric &&
			includesAll(reverseEngineeringMapText, ["`QB-CAN-05`", "one routed specialist slot", "no bounded multi-slice fan-out need"]) &&
			includesAll(gapRegisterText, ["`QB-GAP-224-02`", "`CLOSED_SESSION_224`"])

		const invalidPlanEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-file-test-invalid-plan",
			missionId: "mission-file-test-2",
			assignmentId: "assign-file-test-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-27T13:13:00Z",
			payload: {
				task: "update src/format.ts and keep its test aligned",
				taskFamily: "update_file_and_test",
				targetFiles: ["src/format.ts", "src/helper.ts"],
				languagePack: "js_ts",
				protectedFiles: [],
			},
		})
		const invalidPlanResult = shell.router.routeEnvelope(invalidPlanEnvelope)
		const invalidPlanPayload = asRecord(invalidPlanResult.responseEnvelope?.payload)

		const invalidAssignmentEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-file-test-invalid-assignment",
			missionId: "mission-file-test-3",
			assignmentId: "assign-file-test-3",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-27T13:14:00Z",
			payload: {
				task: "update src/format.ts and keep its test aligned",
				taskFamily: "update_file_and_test",
				languagePack: "js_ts",
				allowedFiles: ["src/format.ts", "src/helper.ts"],
				forbiddenFiles: [],
				expectedResult: "update_file_and_test",
				plannerSummary: "PlannerBee emitted 1 assignment packet for update_file_and_test over src/format.ts, src/helper.ts.",
				requiresReview: true,
				requiresVerification: true,
			},
		})
		const invalidAssignmentResult = shell.router.routeEnvelope(invalidAssignmentEnvelope)
		const invalidAssignmentPayload = asRecord(invalidAssignmentResult.responseEnvelope?.payload)
		const laneStayedBounded =
			invalidPlanResult.status === "delivered" &&
			invalidPlanPayload?.["accepted"] === false &&
			invalidPlanPayload?.["reason"] === "natural_language_task_family_scope_mismatch" &&
			invalidAssignmentResult.status === "delivered" &&
			invalidAssignmentPayload?.["accepted"] === false &&
			invalidAssignmentPayload?.["reason"] === "update_file_and_test_requires_one_source_and_one_test" &&
			typeof sourceProposal?.["afterContent"] === "string" &&
			String(sourceProposal["afterContent"]).includes("// queenbee: file and test") &&
			typeof testProposal?.["afterContent"] === "string" &&
			String(testProposal["afterContent"]).includes("// queenbee: file and test")

		details.push(
			`supportedFamilies=${shell.planner.listSupportedTaskFamilies().join(",")}`,
			`lookupCandidates=${candidateBeeIds.join(",") || "missing"}`,
			`assignmentAllowedFiles=${allowedFiles.join(",") || "missing"}`,
			`coderSummary=${String(coderPayload?.["coderSummary"] ?? "missing")}`,
			`reviewType=${reviewResult?.responseEnvelope?.messageType ?? "missing"}`,
			`verificationType=${verificationResult?.responseEnvelope?.messageType ?? "missing"}`,
			`invalidPlanReason=${String(invalidPlanPayload?.["reason"] ?? "missing")}`,
			`invalidAssignmentReason=${String(invalidAssignmentPayload?.["reason"] ?? "missing")}`,
		)

		return {
			fileAndTestDocsPresent,
			reverseEngineeringDocsPresent,
			publicDocsTruthful,
			packageScriptPresent,
			plannerSupportsFamily,
			testSelectedForFileAndTest,
			assignmentDelivered,
			reviewAndProofDelivered,
			assignmentPacketExplicit,
			routeSlotStayedGeneric,
			parallelNeedStayedSingleton,
			laneStayedBounded,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeJstsFileAndTestHarnessResult(result: QueenBeeJstsFileAndTestHarnessResult): string {
	return [
		`File-and-test docs present: ${result.fileAndTestDocsPresent ? "PASS" : "FAIL"}`,
		`Reverse-engineering docs present: ${result.reverseEngineeringDocsPresent ? "PASS" : "FAIL"}`,
		`Public docs truthful: ${result.publicDocsTruthful ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Planner supports file-and-test family: ${result.plannerSupportsFamily ? "PASS" : "FAIL"}`,
		`Test selected for file-and-test: ${result.testSelectedForFileAndTest ? "PASS" : "FAIL"}`,
		`Assignment delivered: ${result.assignmentDelivered ? "PASS" : "FAIL"}`,
		`Review and proof delivered: ${result.reviewAndProofDelivered ? "PASS" : "FAIL"}`,
		`Assignment packet explicit: ${result.assignmentPacketExplicit ? "PASS" : "FAIL"}`,
		`Route slot stayed generic: ${result.routeSlotStayedGeneric ? "PASS" : "FAIL"}`,
		`Parallel need stayed singleton: ${result.parallelNeedStayedSingleton ? "PASS" : "FAIL"}`,
		`Lane stayed bounded: ${result.laneStayedBounded ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeJstsFileAndTestHarness()
	console.log(formatQueenBeeJstsFileAndTestHarnessResult(result))
	process.exit(
		result.fileAndTestDocsPresent &&
			result.reverseEngineeringDocsPresent &&
			result.publicDocsTruthful &&
			result.packageScriptPresent &&
			result.plannerSupportsFamily &&
			result.testSelectedForFileAndTest &&
			result.assignmentDelivered &&
			result.reviewAndProofDelivered &&
			result.assignmentPacketExplicit &&
			result.routeSlotStayedGeneric &&
			result.parallelNeedStayedSingleton &&
			result.laneStayedBounded
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:jsts:file-and-test] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
