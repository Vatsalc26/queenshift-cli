import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, isQueenBeeTaskFamily, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeJstsSmallHarnessResult = {
	coderDocsPresent: boolean
	reverseEngineeringDocsPresent: boolean
	packageScriptPresent: boolean
	coderEdgesImplemented: boolean
	assignmentDelivered: boolean
	tinyFileTruthLocked: boolean
	smallRowsStaySingleWorker: boolean
	proposalStayedScoped: boolean
	diskStayedUnchanged: boolean
	taskText: string
	candidateBeeIds: string[]
	assignmentPacketSender: string | null
	proposalPaths: string[]
	tooWideReason: string | null
	details: string[]
}

export const QUEENBEE_JSTS_SMALL_TASK = 'add the exact comment "// queenbee: small hello" to hello.ts'
export const QUEENBEE_JSTS_SMALL_NAMED_TASK = 'update utils.ts so it includes the exact text "// queenbee: named utils"'

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

function readCandidateBeeIds(envelope: QueenBeeEnvelope | null): string[] {
	const payload = asRecord(envelope?.payload)
	return Array.isArray(payload?.["candidateBeeIds"]) ? (payload["candidateBeeIds"] as string[]) : []
}

export async function runQueenBeeJstsSmallHarness(rootDir = resolveRootDir()): Promise<QueenBeeJstsSmallHarnessResult> {
	const details: string[] = []
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const toolGrantText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const reverseEngineeringMapText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const canonicalTaskText = readText(rootDir, "QUEENBEE_CANONICAL_TASK_SET.md")
	const traceabilityText = readText(rootDir, "QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}

	const coderDocsPresent =
		includesAll(messageSchemaText, [
			"## Session 193 One-File Coder Shell",
			"`work_result`",
			"`proposalCount`",
			"`proposals`",
		]) &&
		includesAll(protocolMapText, [
			"## Session 193 Runtime Coder",
			"`RouterBee -> JSTSCoderBee`",
			"`JSTSCoderBee -> RouterBee`",
			"`assignment_packet`",
			"`work_result`",
		]) &&
		includesAll(firstSliceText, [
			"## Session 193 One-File Coder Rule",
			"`verify:queenbee:jsts:small`",
			"one-file",
		]) &&
		includesAll(toolGrantText, [
			"## Session 193 One-File Coder Grant Rule",
			"`JSTSCoderBee`",
			"`repo_edit`",
			"`work_result`",
		]) &&
		includesAll(architectureText, [
			"## Decision: QueenBee one-file JSTSCoderBee stays assignment-scoped and proposal-first",
			"**Session:** 193",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:jsts:small`", "proposal-first"])
	const reverseEngineeringDocsPresent =
		includesAll(reverseEngineeringMapText, [
			"`QB-CAN-02`",
			"`SUPPORTED`",
			"create-safe merge",
		]) &&
		includesAll(gapRegisterText, [
			"`QB-GAP-223-01`",
			"`CLOSED_SESSION_232`",
			"`create_tiny_file`",
		]) &&
		includesAll(canonicalTaskText, [
			"`QB-CAN-02`",
			"`SUPPORTED`",
			"`verify:queenbee:file-creation`",
			"`verify:queenbee:create-complete`",
		]) &&
		includesAll(traceabilityText, [
			"`QB-TR-07`",
			"`SUPPORTED`",
			"QB-PRIM-11",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 231 QueenBee File-Creation Candidate Note",
			"public beta target remains frozen",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 232 closes the bounded create_tiny_file lane with create-safe merge and archive proof",
			"**Session:** 232",
		]) &&
		includesAll(verificationCatalogText, [
			"`npm.cmd run verify:queenbee:create-complete`",
			"create-safe merge and archive completion lane",
		])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:jsts:small"] === "npm run build && node dist/verification/verify_queenbee_jsts_small.js"

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-jsts-small")
	try {
		const helloPath = path.join(fixture.repoPath, "hello.ts")
		const utilsPath = path.join(fixture.repoPath, "utils.ts")
		const beforeHelloDisk = fs.readFileSync(helloPath, "utf8")
		const beforeUtilsDisk = fs.readFileSync(utilsPath, "utf8")
		const commentShell = createQueenBeeShell({ workspaceRoot: fixture.repoPath })
		const namedShell = createQueenBeeShell({ workspaceRoot: fixture.repoPath })

		const coderEdgesImplemented =
			commentShell.router.listImplementedEdges().includes("RouterBee->JSTSCoderBee") &&
			commentShell.router.listImplementedEdges().includes("JSTSCoderBee->RouterBee")

		const commentLookupResult = commentShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-small-lookup",
				missionId: "mission-jsts-small-1",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.registry.001",
				messageType: "registry_lookup_request",
				timestamp: "2026-03-28T01:10:00Z",
				payload: {
					desiredRoleFamily: "coder",
					desiredLanguagePack: "js_ts",
					requiredToolFamilies: ["repo_edit"],
				},
			}),
		)
		const commentCandidateBeeIds = readCandidateBeeIds(commentLookupResult.responseEnvelope)
		const commentReservedBeeId = commentCandidateBeeIds[0] ?? ""

		const commentReserveResult = commentShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-small-reserve",
				missionId: "mission-jsts-small-1",
				assignmentId: "assign-jsts-small-1",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.registry.001",
				messageType: "bee_reserve_request",
				timestamp: "2026-03-28T01:11:00Z",
				payload: {
					targetBeeId: commentReservedBeeId,
					assignmentId: "assign-jsts-small-1",
				},
			}),
		)
		const commentReserved = asRecord(commentReserveResult.responseEnvelope?.payload)?.["reserved"] === true

		const commentPlanResult = commentShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-small-plan",
				missionId: "mission-jsts-small-1",
				assignmentId: "assign-jsts-small-1",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.planner.001",
				messageType: "plan_request",
				timestamp: "2026-03-28T01:12:00Z",
				payload: {
					task: QUEENBEE_JSTS_SMALL_TASK,
					taskFamily: "comment_file",
					targetFiles: ["hello.ts"],
					languagePack: "js_ts",
					protectedFiles: ["package.json"],
					reservedBeeId: commentReservedBeeId,
				},
			}),
		)
		const commentAssignmentPacket = readFirstAssignmentPacket(commentPlanResult.responseEnvelope)
		const commentCoderResult = commentAssignmentPacket ? commentShell.router.relayPlannedAssignment(commentAssignmentPacket) : null
		const commentCoderPayload = asRecord(commentCoderResult?.responseEnvelope?.payload)
		const commentProposals = Array.isArray(commentCoderPayload?.["proposals"])
			? (commentCoderPayload["proposals"] as Array<Record<string, unknown>>)
			: []
		const commentFirstProposal = asRecord(commentProposals[0])
		const commentDelivered =
			commentLookupResult.status === "delivered" &&
			commentReserved &&
			commentPlanResult.status === "delivered" &&
			commentCoderResult?.status === "delivered" &&
			commentCoderResult.responseEnvelope?.messageType === "work_result" &&
			commentCoderPayload?.["accepted"] === true &&
			commentFirstProposal?.["path"] === "hello.ts"

		const namedLookupResult = namedShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-small-named-lookup",
				missionId: "mission-jsts-small-2",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.registry.001",
				messageType: "registry_lookup_request",
				timestamp: "2026-03-28T01:20:00Z",
				payload: {
					desiredRoleFamily: "coder",
					desiredLanguagePack: "js_ts",
					requiredToolFamilies: ["repo_edit"],
				},
			}),
		)
		const namedCandidateBeeIds = readCandidateBeeIds(namedLookupResult.responseEnvelope)
		const namedReservedBeeId = namedCandidateBeeIds[0] ?? ""

		const namedReserveResult = namedShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-small-named-reserve",
				missionId: "mission-jsts-small-2",
				assignmentId: "assign-jsts-small-2",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.registry.001",
				messageType: "bee_reserve_request",
				timestamp: "2026-03-28T01:21:00Z",
				payload: {
					targetBeeId: namedReservedBeeId,
					assignmentId: "assign-jsts-small-2",
				},
			}),
		)
		const namedReserved = asRecord(namedReserveResult.responseEnvelope?.payload)?.["reserved"] === true

		const namedPlanResult = namedShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-small-named-plan",
				missionId: "mission-jsts-small-2",
				assignmentId: "assign-jsts-small-2",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.planner.001",
				messageType: "plan_request",
				timestamp: "2026-03-28T01:22:00Z",
				payload: {
					task: QUEENBEE_JSTS_SMALL_NAMED_TASK,
					taskFamily: "update_named_file",
					targetFiles: ["utils.ts"],
					languagePack: "js_ts",
					protectedFiles: ["package.json"],
					reservedBeeId: namedReservedBeeId,
				},
			}),
		)
		const namedAssignmentPacket = readFirstAssignmentPacket(namedPlanResult.responseEnvelope)
		const namedCoderResult = namedAssignmentPacket ? namedShell.router.relayPlannedAssignment(namedAssignmentPacket) : null
		const namedCoderPayload = asRecord(namedCoderResult?.responseEnvelope?.payload)
		const namedProposals = Array.isArray(namedCoderPayload?.["proposals"])
			? (namedCoderPayload["proposals"] as Array<Record<string, unknown>>)
			: []
		const namedFirstProposal = asRecord(namedProposals[0])
		const namedDelivered =
			namedLookupResult.status === "delivered" &&
			namedReserved &&
			namedPlanResult.status === "delivered" &&
			namedCoderResult?.status === "delivered" &&
			namedCoderResult.responseEnvelope?.messageType === "work_result" &&
			namedCoderPayload?.["accepted"] === true &&
			namedFirstProposal?.["path"] === "utils.ts"

		const tooWideResult = commentShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-small-too-wide",
				missionId: "mission-jsts-small-3",
				assignmentId: "assign-jsts-small-3",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.jsts_coder.001",
				messageType: "assignment_packet",
				timestamp: "2026-03-28T01:23:00Z",
				payload: {
					task: "update hello.ts and utils.ts together",
					taskFamily: "update_named_file",
					languagePack: "js_ts",
					allowedFiles: ["hello.ts", "utils.ts"],
					forbiddenFiles: ["package.json"],
					expectedResult: "single_named_file_update",
					plannerSummary: "PlannerBee emitted 1 assignment packet for update_named_file over hello.ts, utils.ts.",
					requiresReview: true,
					requiresVerification: true,
				},
			}),
		)
		const tooWidePayload = asRecord(tooWideResult.responseEnvelope?.payload)

		const assignmentDelivered = commentDelivered && namedDelivered
		const proposalStayedScoped =
			(commentCoderPayload?.["proposalCount"] as number) === 1 &&
			Array.isArray(commentCoderPayload?.["changedFiles"]) &&
			(commentCoderPayload?.["changedFiles"] as string[]).join(",") === "hello.ts" &&
			typeof commentFirstProposal?.["beforeContent"] === "string" &&
			typeof commentFirstProposal?.["afterContent"] === "string" &&
			String(commentFirstProposal?.["afterContent"]).includes("// queenbee: small hello") &&
			(namedCoderPayload?.["proposalCount"] as number) === 1 &&
			Array.isArray(namedCoderPayload?.["changedFiles"]) &&
			(namedCoderPayload?.["changedFiles"] as string[]).join(",") === "utils.ts" &&
			typeof namedFirstProposal?.["afterContent"] === "string" &&
			String(namedFirstProposal?.["afterContent"]).includes("// queenbee: named utils") &&
			tooWideResult.status === "delivered" &&
			tooWideResult.responseEnvelope?.messageType === "work_result" &&
			tooWidePayload?.["accepted"] === false &&
			tooWidePayload?.["reason"] === "coder_target_count_out_of_bounds"

		const tinyFileTruthLocked =
			reverseEngineeringDocsPresent &&
			isQueenBeeTaskFamily("create_tiny_file") &&
			commentShell.planner.listSupportedTaskFamilies().map((taskFamily) => String(taskFamily)).includes("create_tiny_file") &&
			includesAll(reverseEngineeringMapText, ["`QB-CAN-02`", "`SUPPORTED`"]) &&
			includesAll(gapRegisterText, ["`QB-GAP-223-01`", "`CLOSED_SESSION_232`"])

		const smallRowsStaySingleWorker =
			includesAll(reverseEngineeringMapText, ["`queenbee.jsts_coder.001`", "`specialist_queue`", "no clone-worker"]) &&
			commentReservedBeeId === "queenbee.jsts_coder.001" &&
			namedReservedBeeId === "queenbee.jsts_coder.001" &&
			commentAssignmentPacket?.recipientBeeId === "queenbee.jsts_coder.001" &&
			namedAssignmentPacket?.recipientBeeId === "queenbee.jsts_coder.001"

		const afterHelloDisk = fs.readFileSync(helloPath, "utf8")
		const afterUtilsDisk = fs.readFileSync(utilsPath, "utf8")
		const diskStayedUnchanged = beforeHelloDisk === afterHelloDisk && beforeUtilsDisk === afterUtilsDisk

		const proposalPaths = [
			...commentProposals.map((proposal) => String(asRecord(proposal)?.["path"] ?? "")),
			...namedProposals.map((proposal) => String(asRecord(proposal)?.["path"] ?? "")),
		].filter((proposalPath) => proposalPath.length > 0)
		const candidateBeeIds = Array.from(new Set([...commentCandidateBeeIds, ...namedCandidateBeeIds]))

		details.push(
			`implementedEdges=${commentShell.router.listImplementedEdges().join(",")}`,
			`commentCandidates=${commentCandidateBeeIds.join(",") || "missing"}`,
			`namedCandidates=${namedCandidateBeeIds.join(",") || "missing"}`,
			`commentAssignmentPacketSender=${commentAssignmentPacket?.senderBeeId ?? "missing"}`,
			`namedAssignmentPacketSender=${namedAssignmentPacket?.senderBeeId ?? "missing"}`,
			`proposalPaths=${proposalPaths.join(",") || "missing"}`,
			`tooWideReason=${String(tooWidePayload?.["reason"] ?? "missing")}`,
		)

		return {
			coderDocsPresent,
			reverseEngineeringDocsPresent,
			packageScriptPresent,
			coderEdgesImplemented,
			assignmentDelivered,
			tinyFileTruthLocked,
			smallRowsStaySingleWorker,
			proposalStayedScoped,
			diskStayedUnchanged,
			taskText: QUEENBEE_JSTS_SMALL_TASK,
			candidateBeeIds,
			assignmentPacketSender: commentAssignmentPacket?.senderBeeId ?? null,
			proposalPaths,
			tooWideReason: typeof tooWidePayload?.["reason"] === "string" ? tooWidePayload["reason"] : null,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeJstsSmallHarnessResult(result: QueenBeeJstsSmallHarnessResult): string {
	return [
		`Coder docs present: ${result.coderDocsPresent ? "PASS" : "FAIL"}`,
		`Reverse-engineering docs present: ${result.reverseEngineeringDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Coder edges implemented: ${result.coderEdgesImplemented ? "PASS" : "FAIL"}`,
		`Assignment delivered: ${result.assignmentDelivered ? "PASS" : "FAIL"}`,
		`Tiny-file truth locked: ${result.tinyFileTruthLocked ? "PASS" : "FAIL"}`,
		`Small rows stay single-worker: ${result.smallRowsStaySingleWorker ? "PASS" : "FAIL"}`,
		`Proposal stayed scoped: ${result.proposalStayedScoped ? "PASS" : "FAIL"}`,
		`Disk stayed unchanged before merge: ${result.diskStayedUnchanged ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeJstsSmallHarness()
	console.log(formatQueenBeeJstsSmallHarnessResult(result))
	process.exit(
		result.coderDocsPresent &&
			result.reverseEngineeringDocsPresent &&
			result.packageScriptPresent &&
			result.coderEdgesImplemented &&
			result.assignmentDelivered &&
			result.tinyFileTruthLocked &&
			result.smallRowsStaySingleWorker &&
			result.proposalStayedScoped &&
			result.diskStayedUnchanged
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:jsts:small] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
