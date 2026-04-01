import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"

export type QueenBeeBoundedNodeHarnessResult = {
	nodeLaneDocsPresent: boolean
	packageScriptPresent: boolean
	plannerSupportsNodeFamily: boolean
	nodePlanDelivered: boolean
	assignmentPacketExplicit: boolean
	nodeLaneStayedBounded: boolean
	routeSlotStayedGeneric: boolean
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

export async function runQueenBeeBoundedNodeHarness(rootDir = resolveRootDir()): Promise<QueenBeeBoundedNodeHarnessResult> {
	const details: string[] = []
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const wiringMapText = readText(rootDir, "WIRING_MAP.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }

	const nodeLaneDocsPresent =
		includesAll(firstSliceText, [
			"## Session 210 Node/CLI Specialist Lane",
			"`bounded_node_cli_task`",
			"one or two explicit Node/CLI targets",
			"`verify:queenbee:bounded-node`",
		]) &&
		includesAll(protocolMapText, [
			"## Session 210 Node Specialist Selection",
			"`bounded_node_cli_task` lane stays limited to one or two explicit targets",
			"`verify:queenbee:bounded-node`",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 210 QueenBee Node/CLI Lane Note",
			"`bounded_node_cli_task` may now cover one or two explicit Node/CLI targets",
		]) &&
		includesAll(wiringMapText, [
			"Route audit reaffirmed through Session 269",
			"`JSTSCoderBee` route slot now delegates to `JSTSCoreBee`, `JSTSAsyncBee`, `JSTSNodeBee`, `JSTSTestBee`, or `JSTSRefactorBee`",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 210 lets JSTSNodeBee own the first bounded Node/CLI lane inside the existing coder slot",
			"one or two explicit targets",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:bounded-node`", "`bounded_node_cli_task` lane stays limited to one or two explicit targets"])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:bounded-node"] === "npm run build && node dist/verification/verify_queenbee_bounded_node.js"

	const shell = createQueenBeeShell({ workspaceRoot: path.join(rootDir, "verification", "test_workspace") })
	const plannerSupportsNodeFamily =
		shell.planner.listSupportedTaskFamilies().join(",") ===
		"comment_file,create_tiny_file,update_named_file,bounded_two_file_update,update_file_and_test,rename_export,bounded_node_cli_task"

	const lookupEnvelope = buildQueenBeeEnvelope({
		messageId: "msg-bounded-node-lookup",
		missionId: "mission-bounded-node-1",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.registry.001",
		messageType: "registry_lookup_request",
		timestamp: "2026-03-27T12:40:00Z",
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
		messageId: "msg-bounded-node-reserve",
		missionId: "mission-bounded-node-1",
		assignmentId: "assign-bounded-node-1",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.registry.001",
		messageType: "bee_reserve_request",
		timestamp: "2026-03-27T12:41:00Z",
		payload: {
			targetBeeId: reservedBeeId,
			assignmentId: "assign-bounded-node-1",
		},
	})
	const reserveResult = shell.router.routeEnvelope(reserveEnvelope)
	const reserved = asRecord(reserveResult.responseEnvelope?.payload)?.["reserved"] === true

	const planEnvelope = buildQueenBeeEnvelope({
		messageId: "msg-bounded-node-plan",
		missionId: "mission-bounded-node-1",
		assignmentId: "assign-bounded-node-1",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.planner.001",
		messageType: "plan_request",
		timestamp: "2026-03-27T12:42:00Z",
		payload: {
			task: "add a npm run cli entry for hello.ts",
			taskFamily: "bounded_node_cli_task",
			targetFiles: ["package.json", "hello.ts"],
			languagePack: "js_ts",
			protectedFiles: ["utils.ts"],
			reservedBeeId,
		},
	})
	const planResult = shell.router.routeEnvelope(planEnvelope)
	const planPayload = asRecord(planResult.responseEnvelope?.payload)
	const assignmentPacket = readFirstAssignmentPacket(planResult.responseEnvelope)
	const assignmentPayload = asRecord(assignmentPacket?.payload)
	const allowedFiles = Array.isArray(assignmentPayload?.["allowedFiles"]) ? (assignmentPayload["allowedFiles"] as string[]) : []
	const nodePlanDelivered =
		lookupResult.status === "delivered" &&
		reserved &&
		planResult.status === "delivered" &&
		planResult.edge === "RouterBee->PlannerBee" &&
		planResult.responseEnvelope?.messageType === "plan_result" &&
		planPayload?.["accepted"] === true &&
		planPayload?.["taskFamily"] === "bounded_node_cli_task"
	const assignmentPacketExplicit =
		assignmentPacket?.messageType === "assignment_packet" &&
		assignmentPacket.senderBeeId === "queenbee.planner.001" &&
		assignmentPacket.recipientBeeId === "queenbee.jsts_coder.001" &&
		allowedFiles.join(",") === "package.json,hello.ts" &&
		assignmentPayload?.["expectedResult"] === "bounded_node_cli_task"

	const invalidPlanEnvelope = buildQueenBeeEnvelope({
		messageId: "msg-bounded-node-invalid-plan",
		missionId: "mission-bounded-node-2",
		assignmentId: "assign-bounded-node-2",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.planner.001",
		messageType: "plan_request",
		timestamp: "2026-03-27T12:43:00Z",
		payload: {
			task: "update package.json, hello.ts, and utils.ts for one cli task",
			taskFamily: "bounded_node_cli_task",
			targetFiles: ["package.json", "hello.ts", "utils.ts"],
			languagePack: "js_ts",
			protectedFiles: [],
		},
	})
	const invalidPlanResult = shell.router.routeEnvelope(invalidPlanEnvelope)
	const invalidPlanPayload = asRecord(invalidPlanResult.responseEnvelope?.payload)

	const invalidAssignmentEnvelope = buildQueenBeeEnvelope({
		messageId: "msg-bounded-node-invalid-assignment",
		missionId: "mission-bounded-node-3",
		assignmentId: "assign-bounded-node-3",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.jsts_coder.001",
		messageType: "assignment_packet",
		timestamp: "2026-03-27T12:44:00Z",
		payload: {
			task: "update package.json, hello.ts, and utils.ts for one cli task",
			taskFamily: "bounded_node_cli_task",
			languagePack: "js_ts",
			allowedFiles: ["package.json", "hello.ts", "utils.ts"],
			forbiddenFiles: [],
			expectedResult: "bounded_node_cli_task",
			plannerSummary: "PlannerBee emitted 1 assignment packet for bounded_node_cli_task over package.json, hello.ts, utils.ts.",
			requiresReview: true,
			requiresVerification: true,
		},
	})
	const invalidAssignmentResult = shell.router.routeEnvelope(invalidAssignmentEnvelope)
	const invalidAssignmentPayload = asRecord(invalidAssignmentResult.responseEnvelope?.payload)
	const nodeLaneStayedBounded =
		invalidPlanResult.status === "delivered" &&
		invalidPlanResult.responseEnvelope?.messageType === "plan_result" &&
		invalidPlanPayload?.["accepted"] === false &&
		invalidPlanPayload?.["reason"] === "bounded_node_cli_task_requires_one_or_two_targets" &&
		invalidAssignmentResult.status === "delivered" &&
		invalidAssignmentResult.responseEnvelope?.messageType === "work_result" &&
		invalidAssignmentPayload?.["accepted"] === false &&
		invalidAssignmentPayload?.["reason"] === "coder_target_count_out_of_bounds"
	const routeSlotStayedGeneric =
		reservedBeeId === "queenbee.jsts_coder.001" &&
		assignmentPacket?.recipientBeeId === "queenbee.jsts_coder.001" &&
		shell.router.listImplementedEdges().includes("RouterBee->JSTSCoderBee") &&
		shell.router.listImplementedEdges().includes("JSTSCoderBee->RouterBee")

	details.push(
		`supportedFamilies=${shell.planner.listSupportedTaskFamilies().join(",")}`,
		`lookupCandidates=${candidateBeeIds.join(",") || "missing"}`,
		`assignmentAllowedFiles=${allowedFiles.join(",") || "missing"}`,
		`invalidPlanReason=${String(invalidPlanPayload?.["reason"] ?? "missing")}`,
		`invalidAssignmentReason=${String(invalidAssignmentPayload?.["reason"] ?? "missing")}`,
	)

	return {
		nodeLaneDocsPresent,
		packageScriptPresent,
		plannerSupportsNodeFamily,
		nodePlanDelivered,
		assignmentPacketExplicit,
		nodeLaneStayedBounded,
		routeSlotStayedGeneric,
		details,
	}
}

export function formatQueenBeeBoundedNodeHarnessResult(result: QueenBeeBoundedNodeHarnessResult): string {
	return [
		`Node lane docs present: ${result.nodeLaneDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Planner supports node family: ${result.plannerSupportsNodeFamily ? "PASS" : "FAIL"}`,
		`Node plan delivered: ${result.nodePlanDelivered ? "PASS" : "FAIL"}`,
		`Assignment packet explicit: ${result.assignmentPacketExplicit ? "PASS" : "FAIL"}`,
		`Node lane stayed bounded: ${result.nodeLaneStayedBounded ? "PASS" : "FAIL"}`,
		`Route slot stayed generic: ${result.routeSlotStayedGeneric ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeBoundedNodeHarness()
	console.log(formatQueenBeeBoundedNodeHarnessResult(result))
	process.exit(
		result.nodeLaneDocsPresent &&
			result.packageScriptPresent &&
			result.plannerSupportsNodeFamily &&
			result.nodePlanDelivered &&
			result.assignmentPacketExplicit &&
			result.nodeLaneStayedBounded &&
			result.routeSlotStayedGeneric
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:bounded-node] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
