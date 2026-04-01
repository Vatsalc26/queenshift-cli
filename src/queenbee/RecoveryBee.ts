import { buildQueenBeeEnvelope, isQueenBeeBeeId, type QueenBeeBeeId, type QueenBeeEnvelope } from "./QueenBeeProtocol"

export type QueenBeeRecoveryFailureFamily =
	| "protocol_violation"
	| "invalid_message"
	| "scope_violation"
	| "tool_violation"
	| "assignment_timeout"
	| "verification_failure"
	| "review_failure"
	| "merge_failure"
	| "registry_inconsistency"
	| "dependency_missing"
	| "provider_failure"
	| "unknown_failure"

export type QueenBeeRecoveryRequestPayload = {
	failedBeeId: QueenBeeBeeId
	sourceBeeId: QueenBeeBeeId
	failureFamily: QueenBeeRecoveryFailureFamily
	sourceMessageType: string
	failureReason: string
	retryCount: number
	artifactRefs: string[]
	requestSummary: string
}

export type QueenBeeRecoveryPlanPayload = {
	failedBeeId: QueenBeeBeeId
	failureFamily: QueenBeeRecoveryFailureFamily
	retryable: boolean
	sameBeeAllowed: boolean
	recommendedAction: string
	cooldownUntil: string | null
	maxRetryCount: number
	recoverySummary: string
}

export type QueenBeeBeeQuarantinedPayload = {
	failedBeeId: QueenBeeBeeId
	failureFamily: QueenBeeRecoveryFailureFamily
	quarantineReason: string
	recoverySummary: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function isFailureFamily(value: unknown): value is QueenBeeRecoveryFailureFamily {
	return (
		value === "protocol_violation" ||
		value === "invalid_message" ||
		value === "scope_violation" ||
		value === "tool_violation" ||
		value === "assignment_timeout" ||
		value === "verification_failure" ||
		value === "review_failure" ||
		value === "merge_failure" ||
		value === "registry_inconsistency" ||
		value === "dependency_missing" ||
		value === "provider_failure" ||
		value === "unknown_failure"
	)
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())))
		: []
}

function parseRecoveryRequestPayload(payload: unknown): QueenBeeRecoveryRequestPayload | null {
	const record = asRecord(payload)
	if (!record) return null
	const failedBeeId = typeof record["failedBeeId"] === "string" ? record["failedBeeId"] : ""
	const sourceBeeId = typeof record["sourceBeeId"] === "string" ? record["sourceBeeId"] : ""
	const failureFamily = record["failureFamily"]
	const sourceMessageType = typeof record["sourceMessageType"] === "string" ? record["sourceMessageType"].trim() : ""
	const failureReason = typeof record["failureReason"] === "string" ? record["failureReason"].trim() : ""
	const retryCount = typeof record["retryCount"] === "number" && Number.isInteger(record["retryCount"]) ? record["retryCount"] : -1
	const artifactRefs = readStringArray(record["artifactRefs"])
	const requestSummary = typeof record["requestSummary"] === "string" ? record["requestSummary"].trim() : ""
	if (!isQueenBeeBeeId(failedBeeId) || !isQueenBeeBeeId(sourceBeeId) || !isFailureFamily(failureFamily)) return null
	if (!sourceMessageType || !failureReason || retryCount < 0 || !requestSummary) return null
	return {
		failedBeeId,
		sourceBeeId,
		failureFamily,
		sourceMessageType,
		failureReason,
		retryCount,
		artifactRefs,
		requestSummary,
	}
}

function addMinutes(timestamp: string, minutes: number): string {
	const base = Date.parse(timestamp)
	const start = Number.isNaN(base) ? Date.now() : base
	return new Date(start + minutes * 60_000).toISOString()
}

function isHardQuarantine(request: QueenBeeRecoveryRequestPayload): boolean {
	if (
		request.failureFamily === "protocol_violation" ||
		request.failureFamily === "invalid_message" ||
		request.failureFamily === "scope_violation" ||
		request.failureFamily === "tool_violation" ||
		request.failureFamily === "registry_inconsistency"
	) {
		return true
	}
	return (
		request.retryCount >= 2 &&
		(request.failureFamily === "review_failure" ||
			request.failureFamily === "verification_failure" ||
			request.failureFamily === "merge_failure")
	)
}

function buildSoftRecoveryPlan(request: QueenBeeRecoveryRequestPayload, timestamp: string): QueenBeeRecoveryPlanPayload {
	if (request.failureFamily === "dependency_missing") {
		return {
			failedBeeId: request.failedBeeId,
			failureFamily: request.failureFamily,
			retryable: false,
			sameBeeAllowed: false,
			recommendedAction: "abort_until_dependency_restored",
			cooldownUntil: addMinutes(timestamp, 15),
			maxRetryCount: 0,
			recoverySummary: `RecoveryBee paused ${request.failedBeeId} until the missing dependency is restored.`,
		}
	}
	if (request.failureFamily === "provider_failure" || request.failureFamily === "assignment_timeout") {
		return {
			failedBeeId: request.failedBeeId,
			failureFamily: request.failureFamily,
			retryable: true,
			sameBeeAllowed: false,
			recommendedAction: "retry_after_cooldown",
			cooldownUntil: addMinutes(timestamp, 10),
			maxRetryCount: 1,
			recoverySummary: `RecoveryBee placed ${request.failedBeeId} into cooldown after ${request.failureFamily}.`,
		}
	}
	if (request.failureFamily === "review_failure" || request.failureFamily === "verification_failure") {
		return {
			failedBeeId: request.failedBeeId,
			failureFamily: request.failureFamily,
			retryable: true,
			sameBeeAllowed: false,
			recommendedAction: "replan_before_retry",
			cooldownUntil: addMinutes(timestamp, 15),
			maxRetryCount: 1,
			recoverySummary: `RecoveryBee routed ${request.failedBeeId} into cooldown and requires a replanned retry after ${request.failureFamily}.`,
		}
	}
	if (request.failureFamily === "merge_failure") {
		return {
			failedBeeId: request.failedBeeId,
			failureFamily: request.failureFamily,
			retryable: true,
			sameBeeAllowed: false,
			recommendedAction: "inspect_workspace_then_replan",
			cooldownUntil: addMinutes(timestamp, 15),
			maxRetryCount: 1,
			recoverySummary: `RecoveryBee held ${request.failedBeeId} in cooldown until the merge surface is reinspected.`,
		}
	}
	return {
		failedBeeId: request.failedBeeId,
		failureFamily: request.failureFamily,
		retryable: false,
		sameBeeAllowed: false,
		recommendedAction: "abort_and_inspect",
		cooldownUntil: addMinutes(timestamp, 15),
		maxRetryCount: 0,
		recoverySummary: `RecoveryBee kept ${request.failedBeeId} visible in cooldown while the operator inspects ${request.failureFamily}.`,
	}
}

export class RecoveryBee {
	private readonly recoveryBeeId: QueenBeeBeeId

	constructor(recoveryBeeId: QueenBeeBeeId = "queenbee.recovery.001") {
		this.recoveryBeeId = recoveryBeeId
	}

	handleEnvelope(envelope: QueenBeeEnvelope): QueenBeeEnvelope | null {
		if (envelope.messageType !== "recovery_request") return null
		const request = parseRecoveryRequestPayload(envelope.payload)
		if (!request) return null

		if (isHardQuarantine(request)) {
			const quarantineReason = `RecoveryBee quarantined ${request.failedBeeId} after ${request.failureFamily} from ${request.sourceBeeId}.`
			return buildQueenBeeEnvelope({
				messageId: `${envelope.messageId}:bee_quarantined`,
				missionId: envelope.missionId,
				assignmentId: envelope.assignmentId,
				senderBeeId: this.recoveryBeeId,
				recipientBeeId: envelope.senderBeeId,
				messageType: "bee_quarantined",
				timestamp: envelope.timestamp,
				scopeToken: envelope.scopeToken,
				toolGrantToken: envelope.toolGrantToken,
				parentMessageId: envelope.messageId,
				payload: {
					failedBeeId: request.failedBeeId,
					failureFamily: request.failureFamily,
					quarantineReason,
					recoverySummary: `RecoveryBee marked ${request.failedBeeId} quarantined after a non-retryable ${request.failureFamily}.`,
				},
				artifactRefs: request.artifactRefs,
				failureCode: request.failureFamily,
			})
		}

		const plan = buildSoftRecoveryPlan(request, envelope.timestamp)
		return buildQueenBeeEnvelope({
			messageId: `${envelope.messageId}:recovery_plan`,
			missionId: envelope.missionId,
			assignmentId: envelope.assignmentId,
			senderBeeId: this.recoveryBeeId,
			recipientBeeId: envelope.senderBeeId,
			messageType: "recovery_plan",
			timestamp: envelope.timestamp,
			scopeToken: envelope.scopeToken,
			toolGrantToken: envelope.toolGrantToken,
			parentMessageId: envelope.messageId,
			payload: plan as unknown as Record<string, unknown>,
			artifactRefs: request.artifactRefs,
			failureCode: request.failureFamily,
		})
	}
}
