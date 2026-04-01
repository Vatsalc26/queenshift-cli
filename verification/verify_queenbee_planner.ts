import fs from "node:fs"
import path from "node:path"

import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"

export type QueenBeePlannerHarnessResult = {
	plannerDocsPresent: boolean
	packageScriptPresent: boolean
	supportedTaskFamiliesAligned: boolean
	plannerEdgesImplemented: boolean
	planRequestDelivered: boolean
	assignmentPacketExplicit: boolean
	planningStayedBounded: boolean
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

function readAssignmentPackets(envelope: QueenBeeEnvelope | null): QueenBeeEnvelope[] {
	const payload = asRecord(envelope?.payload)
	if (!payload || !Array.isArray(payload["assignmentPackets"])) return []
	return payload["assignmentPackets"].filter((packet): packet is QueenBeeEnvelope => {
		const record = asRecord(packet)
		return Boolean(record && typeof record["messageType"] === "string")
	})
}

export async function runQueenBeePlannerHarness(rootDir = resolveRootDir()): Promise<QueenBeePlannerHarnessResult> {
	const details: string[] = []
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}

	const plannerDocsPresent =
		includesAll(messageSchemaText, [
			"## Session 191 Planner Shell",
			"`plan_request`",
			"`plan_result`",
			"`assignmentPackets`",
		]) &&
		includesAll(firstSliceText, [
			"## Session 191 Planner Rule",
			"`comment_file`",
			"`update_named_file`",
			"`bounded_two_file_update`",
			"## Session 212 Update File And Test Lane",
			"`update_file_and_test`",
			"## Session 210 Node/CLI Specialist Lane",
			"`bounded_node_cli_task`",
			"## Session 211 Rename Export Lane",
			"`rename_export`",
			"`verify:queenbee:planner`",
		]) &&
		includesAll(architectureText, [
			"## Decision: QueenBee PlannerBee emits explicit assignment packets before coder runtime",
			"**Session:** 191",
		]) &&
		includesAll(protocolMapText, [
			"## Session 191 Runtime Planner",
			"## Session 212 File-And-Test Lane",
			"## Session 210 Node Specialist Selection",
			"## Session 211 Rename Export Lane",
			"`RouterBee -> PlannerBee`",
			"`plan_request`",
			"`plan_result`",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:planner`", "assignment packet", "`update_file_and_test`", "`rename_export`"])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:planner"] === "npm run build && node dist/verification/verify_queenbee_planner.js"

	const shell = createQueenBeeShell()
	const supportedTaskFamiliesAligned =
		shell.planner.listSupportedTaskFamilies().join(",") ===
		"comment_file,create_tiny_file,update_named_file,bounded_two_file_update,update_file_and_test,rename_export,bounded_node_cli_task"
	const plannerEdgesImplemented =
		shell.router.listImplementedEdges().includes("RouterBee->PlannerBee") &&
		shell.router.listImplementedEdges().includes("PlannerBee->RouterBee")

	const planRequest = buildQueenBeeEnvelope({
		messageId: "msg-planner-request",
		missionId: "mission-planner-1",
		assignmentId: "assign-planner-1",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.planner.001",
		messageType: "plan_request",
		timestamp: "2026-03-26T12:30:00Z",
		payload: {
			task: "Update hello.ts and utils.ts together",
			taskFamily: "bounded_two_file_update",
			targetFiles: ["hello.ts", "utils.ts"],
			languagePack: "js_ts",
			protectedFiles: ["package.json"],
		},
	})
	const planResult = shell.router.routeEnvelope(planRequest)
	const planPayload = asRecord(planResult.responseEnvelope?.payload)
	const assignmentPackets = readAssignmentPackets(planResult.responseEnvelope)
	const firstPacket = assignmentPackets[0]
	const firstPacketPayload = asRecord(firstPacket?.payload)
	const allowedFiles = Array.isArray(firstPacketPayload?.["allowedFiles"]) ? (firstPacketPayload["allowedFiles"] as string[]) : []
	const forbiddenFiles = Array.isArray(firstPacketPayload?.["forbiddenFiles"]) ? (firstPacketPayload["forbiddenFiles"] as string[]) : []
	const planRequestDelivered =
		planResult.status === "delivered" &&
		planResult.edge === "RouterBee->PlannerBee" &&
		planResult.responseEnvelope?.messageType === "plan_result" &&
		planPayload?.["accepted"] === true
	const assignmentPacketExplicit =
		assignmentPackets.length === 1 &&
		firstPacket?.messageType === "assignment_packet" &&
		firstPacket?.senderBeeId === "queenbee.planner.001" &&
		firstPacket?.recipientBeeId === "queenbee.jsts_coder.001" &&
		allowedFiles.join(",") === "hello.ts,utils.ts" &&
		forbiddenFiles.join(",") === "package.json"

	const invalidPlanRequest = buildQueenBeeEnvelope({
		messageId: "msg-planner-invalid",
		missionId: "mission-planner-2",
		assignmentId: "assign-planner-2",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.planner.001",
		messageType: "plan_request",
		timestamp: "2026-03-26T12:31:00Z",
		payload: {
			task: "Update hello.ts, utils.ts, and package.json together",
			taskFamily: "bounded_two_file_update",
			targetFiles: ["hello.ts", "utils.ts", "package.json"],
			languagePack: "js_ts",
			protectedFiles: [],
		},
	})
	const invalidPlanResult = shell.router.routeEnvelope(invalidPlanRequest)
	const invalidPayload = asRecord(invalidPlanResult.responseEnvelope?.payload)
	const invalidAssignmentPackets = readAssignmentPackets(invalidPlanResult.responseEnvelope)
	const planningStayedBounded =
		invalidPlanResult.status === "delivered" &&
		invalidPlanResult.responseEnvelope?.messageType === "plan_result" &&
		invalidPayload?.["accepted"] === false &&
		invalidPayload?.["reason"] === "bounded_two_file_update_requires_two_targets" &&
		invalidAssignmentPackets.length === 0

	details.push(
		`implementedEdges=${shell.router.listImplementedEdges().join(",")}`,
		`supportedFamilies=${shell.planner.listSupportedTaskFamilies().join(",")}`,
		`assignmentCount=${String(planPayload?.["assignmentCount"] ?? "missing")}`,
		`invalidReason=${String(invalidPayload?.["reason"] ?? "missing")}`,
	)

	return {
		plannerDocsPresent,
		packageScriptPresent,
		supportedTaskFamiliesAligned,
		plannerEdgesImplemented,
		planRequestDelivered,
		assignmentPacketExplicit,
		planningStayedBounded,
		details,
	}
}

export function formatQueenBeePlannerHarnessResult(result: QueenBeePlannerHarnessResult): string {
	return [
		`Planner docs present: ${result.plannerDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Supported task families aligned: ${result.supportedTaskFamiliesAligned ? "PASS" : "FAIL"}`,
		`Planner edges implemented: ${result.plannerEdgesImplemented ? "PASS" : "FAIL"}`,
		`Plan request delivered: ${result.planRequestDelivered ? "PASS" : "FAIL"}`,
		`Assignment packet explicit: ${result.assignmentPacketExplicit ? "PASS" : "FAIL"}`,
		`Planning stayed bounded: ${result.planningStayedBounded ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeePlannerHarness()
	console.log(formatQueenBeePlannerHarnessResult(result))
	process.exit(
		result.plannerDocsPresent &&
			result.packageScriptPresent &&
			result.supportedTaskFamiliesAligned &&
			result.plannerEdgesImplemented &&
			result.planRequestDelivered &&
			result.assignmentPacketExplicit &&
			result.planningStayedBounded
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:planner] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
