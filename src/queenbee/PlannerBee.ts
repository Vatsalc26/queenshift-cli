import {
	buildQueenBeeEnvelope,
	isQueenBeeBeeId,
	isQueenBeeLanguagePack,
	isQueenBeeTaskFamily,
	type QueenBeeBeeId,
	type QueenBeeEnvelope,
	type QueenBeeLanguagePack,
	type QueenBeeTaskFamily,
} from "./QueenBeeProtocol"
import { compileQueenBeePlanScope, reasonForQueenBeeTargetCount } from "./QueenBeeNaturalLanguageScope"

export type QueenBeePlanRequestPayload = {
	task: string
	taskFamily?: QueenBeeTaskFamily
	targetFiles?: string[]
	languagePack: QueenBeeLanguagePack
	protectedFiles: string[]
	reservedBeeId?: QueenBeeBeeId
}

export type QueenBeePlanResultPayload = {
	accepted: boolean
	reason: string | null
	taskFamily: QueenBeeTaskFamily | null
	assignmentCount: number
	assignmentPackets: QueenBeeEnvelope[]
	plannerSummary: string
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)))
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value) ? uniqueStrings(value.filter((item): item is string => typeof item === "string")) : []
}

function expectedResultForTaskFamily(taskFamily: QueenBeeTaskFamily): string {
	switch (taskFamily) {
		case "comment_file":
			return "small_named_file_comment"
		case "create_tiny_file":
			return "file_creation"
		case "update_named_file":
			return "single_named_file_update"
		case "bounded_two_file_update":
			return "bounded_two_file_update"
		case "update_file_and_test":
			return "update_file_and_test"
		case "bounded_node_cli_task":
			return "bounded_node_cli_task"
		case "rename_export":
			return "rename_export"
	}
}

function isLikelyTestFile(filePath: string): boolean {
	const normalized = filePath.replace(/[\\/]+/g, "/").toLowerCase()
	return /(^|\/)__tests__(\/|$)|(?:\.|_)test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/u.test(normalized)
}

function parsePlanRequestPayload(payload: unknown): QueenBeePlanRequestPayload | null {
	const record = asRecord(payload)
	if (!record) return null
	const task = typeof record["task"] === "string" ? record["task"].trim() : ""
	const taskFamily = typeof record["taskFamily"] === "string" ? record["taskFamily"] : ""
	const targetFiles = readStringArray(record["targetFiles"])
	const protectedFiles = readStringArray(record["protectedFiles"])
	const languagePack = typeof record["languagePack"] === "string" ? record["languagePack"] : ""
	const reservedBeeId = typeof record["reservedBeeId"] === "string" ? record["reservedBeeId"] : ""
	if (!task) return null
	if (!isQueenBeeLanguagePack(languagePack)) return null
	return {
		task,
		taskFamily: isQueenBeeTaskFamily(taskFamily) ? taskFamily : undefined,
		targetFiles,
		languagePack,
		protectedFiles,
		reservedBeeId: isQueenBeeBeeId(reservedBeeId) ? reservedBeeId : undefined,
	}
}

export class PlannerBee {
	private readonly plannerBeeId: QueenBeeBeeId
	private readonly coderBeeId: QueenBeeBeeId

	constructor(plannerBeeId: QueenBeeBeeId = "queenbee.planner.001", coderBeeId: QueenBeeBeeId = "queenbee.jsts_coder.001") {
		this.plannerBeeId = plannerBeeId
		this.coderBeeId = coderBeeId
	}

	listSupportedTaskFamilies(): QueenBeeTaskFamily[] {
		return [
			"comment_file",
			"create_tiny_file",
			"update_named_file",
			"bounded_two_file_update",
			"update_file_and_test",
			"rename_export",
			"bounded_node_cli_task",
		]
	}

	planEnvelope(envelope: QueenBeeEnvelope): QueenBeePlanResultPayload {
		const payload = parsePlanRequestPayload(envelope.payload)
		if (!payload) {
			return {
				accepted: false,
				reason: "invalid_plan_request_payload",
				taskFamily: null,
				assignmentCount: 0,
				assignmentPackets: [],
				plannerSummary: "PlannerBee refused the request because the frozen plan_request payload was incomplete.",
			}
		}
		if (payload.languagePack !== "js_ts") {
			return {
				accepted: false,
				reason: "unsupported_language_pack",
				taskFamily: payload.taskFamily ?? null,
				assignmentCount: 0,
				assignmentPackets: [],
				plannerSummary: "PlannerBee stays inside the JS/TS-first candidate boundary.",
			}
		}

		const compiledScope = compileQueenBeePlanScope({
			task: payload.task,
			explicitTargetFiles: payload.targetFiles,
			explicitTaskFamily: payload.taskFamily,
		})
		if (!compiledScope.accepted || !compiledScope.taskFamily) {
			return {
				accepted: false,
				reason: compiledScope.reason ?? "invalid_plan_request_payload",
				taskFamily: payload.taskFamily ?? null,
				assignmentCount: 0,
				assignmentPackets: [],
				plannerSummary: compiledScope.summary,
			}
		}

		const targetCountReason = reasonForQueenBeeTargetCount(compiledScope.taskFamily, compiledScope.targetFiles)
		if (targetCountReason) {
			return {
				accepted: false,
				reason: targetCountReason,
				taskFamily: compiledScope.taskFamily,
				assignmentCount: 0,
				assignmentPackets: [],
				plannerSummary: `PlannerBee refused ${compiledScope.taskFamily} because the target file count was out of bounds.`,
			}
		}

		const allowedFiles = uniqueStrings(compiledScope.targetFiles)
		const forbiddenFiles = uniqueStrings(payload.protectedFiles.filter((file) => !allowedFiles.includes(file)))
		const assignmentId = envelope.assignmentId ?? `${envelope.missionId}:planner-assign-1`
		const plannerSummary = `PlannerBee emitted 1 assignment packet for ${compiledScope.taskFamily} over ${allowedFiles.join(", ")}.`
		const assignmentPacket = buildQueenBeeEnvelope({
			messageId: `${envelope.messageId}:assignment_packet:1`,
			missionId: envelope.missionId,
			assignmentId,
			senderBeeId: this.plannerBeeId,
			recipientBeeId: payload.reservedBeeId ?? this.coderBeeId,
			messageType: "assignment_packet",
			timestamp: envelope.timestamp,
			requiresAck: true,
			scopeToken: envelope.scopeToken,
			toolGrantToken: envelope.toolGrantToken,
			payload: {
				task: payload.task,
				taskFamily: compiledScope.taskFamily,
				languagePack: payload.languagePack,
				allowedFiles,
				forbiddenFiles,
				expectedResult: expectedResultForTaskFamily(compiledScope.taskFamily),
				plannerSummary,
				requiresReview: true,
				requiresVerification: true,
			},
		})

		return {
			accepted: true,
			reason: null,
			taskFamily: compiledScope.taskFamily,
			assignmentCount: 1,
			assignmentPackets: [assignmentPacket],
			plannerSummary,
		}
	}

	handleEnvelope(envelope: QueenBeeEnvelope): QueenBeeEnvelope | null {
		if (envelope.messageType !== "plan_request") return null
		const planResult = this.planEnvelope(envelope)
		return buildQueenBeeEnvelope({
			messageId: `${envelope.messageId}:plan_result`,
			missionId: envelope.missionId,
			assignmentId: envelope.assignmentId,
			senderBeeId: this.plannerBeeId,
			recipientBeeId: envelope.senderBeeId,
			messageType: "plan_result",
			timestamp: envelope.timestamp,
			scopeToken: envelope.scopeToken,
			toolGrantToken: envelope.toolGrantToken,
			payload: planResult as unknown as Record<string, unknown>,
		})
	}
}
