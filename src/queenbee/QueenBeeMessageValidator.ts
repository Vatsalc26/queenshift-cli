import {
	QUEENBEE_ENGINE_NAME,
	QUEENBEE_OPTIONAL_ENVELOPE_FIELDS,
	QUEENBEE_PROTOCOL_VERSION,
	QUEENBEE_REQUIRED_ENVELOPE_FIELDS,
	isQueenBeeAvailabilityState,
	isQueenBeeBeeId,
	isQueenBeeBeeType,
	isQueenBeeCostClass,
	isQueenBeeLanguagePack,
	isQueenBeeMessageType,
	isQueenBeeRoleFamily,
	isQueenBeeSpeedClass,
	isQueenBeeTaskFamily,
	isQueenBeeToolFamily,
	isQueenBeeTrustState,
	snapshotQueenBeeEnvelope,
	type QueenBeeEnvelope,
	type QueenBeeEnvelopeSnapshot,
	type QueenBeeRegistryEntry,
} from "./QueenBeeProtocol"

export type QueenBeeMessageValidationReason =
	| "invalid_envelope_shape"
	| "missing_required_field"
	| "unknown_envelope_field"
	| "wrong_protocol_version"
	| "wrong_engine"
	| "invalid_message_id"
	| "invalid_mission_id"
	| "invalid_assignment_id"
	| "unknown_sender_bee"
	| "unknown_recipient_bee"
	| "invalid_message_type"
	| "invalid_timestamp"
	| "invalid_requires_ack"
	| "invalid_scope_token"
	| "invalid_tool_grant_token"
	| "invalid_parent_message_id"
	| "invalid_attempt"
	| "invalid_deadline_ms"
	| "invalid_priority"
	| "invalid_artifact_refs"
	| "invalid_failure_code"
	| "invalid_payload"
	| "invalid_registry_lookup_request_payload"
	| "invalid_registry_lookup_result_payload"
	| "invalid_scout_request_payload"
	| "invalid_scout_result_payload"
	| "invalid_plan_request_payload"
	| "invalid_plan_result_payload"
	| "invalid_assignment_packet_payload"
	| "invalid_work_result_payload"
	| "invalid_rework_request_payload"
	| "invalid_review_request_payload"
	| "invalid_review_pass_payload"
	| "invalid_review_rework_payload"
	| "invalid_review_fail_payload"
	| "invalid_verification_request_payload"
	| "invalid_verification_pass_payload"
	| "invalid_verification_fail_payload"
	| "invalid_merge_request_payload"
	| "invalid_merge_pass_payload"
	| "invalid_merge_blocked_payload"
	| "invalid_archive_request_payload"
	| "invalid_archive_written_payload"
	| "invalid_bee_reserve_request_payload"
	| "invalid_bee_reserved_payload"
	| "invalid_bee_release_payload"
	| "invalid_recovery_request_payload"
	| "invalid_recovery_plan_payload"
	| "invalid_quarantine_request_payload"
	| "invalid_bee_quarantined_payload"

export type QueenBeeMessageValidationResult = {
	valid: boolean
	reason: QueenBeeMessageValidationReason | null
	envelope: QueenBeeEnvelope | null
	snapshot: QueenBeeEnvelopeSnapshot
	details: string[]
}

const ALLOWED_TOP_LEVEL_FIELDS = new Set<string>([
	...QUEENBEE_REQUIRED_ENVELOPE_FIELDS,
	...QUEENBEE_OPTIONAL_ENVELOPE_FIELDS,
])

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0
}

function isStringOrNull(value: unknown): value is string | null {
	return value === null || isNonEmptyString(value)
}

function isFinitePositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0
}

function isFinitePositiveNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => isNonEmptyString(item))
}

function isRecoveryFailureFamily(value: unknown): boolean {
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

function unknownFields(record: Record<string, unknown>): string[] {
	return Object.keys(record).filter((field) => !ALLOWED_TOP_LEVEL_FIELDS.has(field))
}

function missingRequiredFields(record: Record<string, unknown>): string[] {
	return QUEENBEE_REQUIRED_ENVELOPE_FIELDS.filter((field) => !(field in record))
}

function fail(
	reason: QueenBeeMessageValidationReason,
	snapshot: QueenBeeEnvelopeSnapshot,
	details: string[],
): QueenBeeMessageValidationResult {
	return {
		valid: false,
		reason,
		envelope: null,
		snapshot,
		details,
	}
}

function clonePayload(payload: Record<string, unknown>): Record<string, unknown> {
	return { ...payload }
}

function isValidRegistryEntry(value: unknown): value is QueenBeeRegistryEntry {
	const record = asRecord(value)
	if (!record) return false
	if (!isNonEmptyString(record["beeId"]) || !isQueenBeeBeeId(record["beeId"])) return false
	if (!isNonEmptyString(record["beeType"]) || !isQueenBeeBeeType(record["beeType"])) return false
	if (record["engine"] !== QUEENBEE_ENGINE_NAME) return false
	if (record["protocolVersion"] !== QUEENBEE_PROTOCOL_VERSION) return false
	if (!isNonEmptyString(record["languagePack"]) || !isQueenBeeLanguagePack(record["languagePack"])) return false
	if (!isNonEmptyString(record["roleFamily"]) || !isQueenBeeRoleFamily(record["roleFamily"])) return false
	if (!Array.isArray(record["toolFamilies"]) || !record["toolFamilies"].every((item) => isNonEmptyString(item) && isQueenBeeToolFamily(item))) {
		return false
	}
	if (!Array.isArray(record["allowedRecipients"]) || !record["allowedRecipients"].every((item) => isNonEmptyString(item) && isQueenBeeBeeId(item))) {
		return false
	}
	if (!isNonEmptyString(record["availabilityState"]) || !isQueenBeeAvailabilityState(record["availabilityState"])) return false
	if (!isNonEmptyString(record["trustState"]) || !isQueenBeeTrustState(record["trustState"])) return false
	if (!isFinitePositiveInteger(record["concurrencyLimit"])) return false
	if (!(record["currentAssignmentId"] === null || isNonEmptyString(record["currentAssignmentId"]))) return false
	if (!(record["cooldownUntil"] === null || isNonEmptyString(record["cooldownUntil"]))) return false
	if (!(record["quarantineReason"] === null || isNonEmptyString(record["quarantineReason"]))) return false
	if (!isNonEmptyString(record["costClass"]) || !isQueenBeeCostClass(record["costClass"])) return false
	if (!isNonEmptyString(record["speedClass"]) || !isQueenBeeSpeedClass(record["speedClass"])) return false
	if (!isNonEmptyString(record["notes"])) return false
	return true
}

function hasOnlyPayloadKeys(payload: Record<string, unknown>, allowedKeys: string[]): boolean {
	return Object.keys(payload).every((key) => allowedKeys.includes(key))
}

function validateRegistryLookupRequestPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["desiredRoleFamily", "desiredLanguagePack", "requiredToolFamilies"])) return false
	if (!isNonEmptyString(payload["desiredRoleFamily"]) || !isQueenBeeRoleFamily(payload["desiredRoleFamily"])) return false
	if ("desiredLanguagePack" in payload && !(isNonEmptyString(payload["desiredLanguagePack"]) && isQueenBeeLanguagePack(payload["desiredLanguagePack"]))) {
		return false
	}
	if (
		"requiredToolFamilies" in payload &&
		(!Array.isArray(payload["requiredToolFamilies"]) ||
			!payload["requiredToolFamilies"].every((item) => isNonEmptyString(item) && isQueenBeeToolFamily(item)))
	) {
		return false
	}
	return true
}

function validateRegistryLookupResultPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["accepted", "reason", "candidateBeeIds", "candidates"])) return false
	if (typeof payload["accepted"] !== "boolean") return false
	if (!("reason" in payload) || !isStringOrNull(payload["reason"])) return false
	if (!Array.isArray(payload["candidateBeeIds"]) || !payload["candidateBeeIds"].every((item) => isNonEmptyString(item) && isQueenBeeBeeId(item))) {
		return false
	}
	if (!Array.isArray(payload["candidates"]) || !payload["candidates"].every((candidate) => isValidRegistryEntry(candidate))) return false
	return true
}

function validatePlanRequestPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["task", "taskFamily", "targetFiles", "languagePack", "protectedFiles", "reservedBeeId"])) return false
	if (!isNonEmptyString(payload["task"])) return false
	if ("taskFamily" in payload && !(isNonEmptyString(payload["taskFamily"]) && isQueenBeeTaskFamily(payload["taskFamily"]))) return false
	if ("targetFiles" in payload && (!Array.isArray(payload["targetFiles"]) || !payload["targetFiles"].every((item) => isNonEmptyString(item)))) {
		return false
	}
	if (!isNonEmptyString(payload["languagePack"]) || payload["languagePack"] !== "js_ts") return false
	if (
		"protectedFiles" in payload &&
		(!Array.isArray(payload["protectedFiles"]) || !payload["protectedFiles"].every((item) => isNonEmptyString(item)))
	) {
		return false
	}
	if ("reservedBeeId" in payload && !(isNonEmptyString(payload["reservedBeeId"]) && isQueenBeeBeeId(payload["reservedBeeId"]))) {
		return false
	}
	return true
}

function validateAssignmentPacketPayload(payload: Record<string, unknown>): boolean {
	if (
		!hasOnlyPayloadKeys(payload, [
			"task",
			"taskFamily",
			"languagePack",
			"allowedFiles",
			"forbiddenFiles",
			"expectedResult",
			"plannerSummary",
			"requiresReview",
			"requiresVerification",
		])
	) {
		return false
	}
	return (
		isNonEmptyString(payload["task"]) &&
		isNonEmptyString(payload["taskFamily"]) &&
		isQueenBeeTaskFamily(payload["taskFamily"]) &&
		payload["languagePack"] === "js_ts" &&
		Array.isArray(payload["allowedFiles"]) &&
		payload["allowedFiles"].every((item) => isNonEmptyString(item)) &&
		Array.isArray(payload["forbiddenFiles"]) &&
		payload["forbiddenFiles"].every((item) => isNonEmptyString(item)) &&
		isNonEmptyString(payload["expectedResult"]) &&
		isNonEmptyString(payload["plannerSummary"]) &&
		typeof payload["requiresReview"] === "boolean" &&
		typeof payload["requiresVerification"] === "boolean"
	)
}

function validateFileProposal(value: unknown): boolean {
	const record = asRecord(value)
	if (!record) return false
	return (
		hasOnlyPayloadKeys(record, ["path", "beforeContent", "afterContent", "changeSummary"]) &&
		isNonEmptyString(record["path"]) &&
		typeof record["beforeContent"] === "string" &&
		typeof record["afterContent"] === "string" &&
		record["beforeContent"] !== record["afterContent"] &&
		isNonEmptyString(record["changeSummary"])
	)
}

function isValidEmbeddedAssignmentPacket(value: unknown): boolean {
	const record = asRecord(value)
	if (!record) return false
	if (!isNonEmptyString(record["messageId"])) return false
	if (record["protocolVersion"] !== QUEENBEE_PROTOCOL_VERSION) return false
	if (record["engine"] !== QUEENBEE_ENGINE_NAME) return false
	if (!isNonEmptyString(record["missionId"])) return false
	if (!(record["assignmentId"] === null || isNonEmptyString(record["assignmentId"]))) return false
	if (!isNonEmptyString(record["senderBeeId"]) || !isQueenBeeBeeId(record["senderBeeId"])) return false
	if (!isNonEmptyString(record["recipientBeeId"]) || !isQueenBeeBeeId(record["recipientBeeId"])) return false
	if (record["messageType"] !== "assignment_packet") return false
	if (!isNonEmptyString(record["timestamp"]) || Number.isNaN(Date.parse(record["timestamp"]))) return false
	if (typeof record["requiresAck"] !== "boolean") return false
	if (!(record["scopeToken"] === null || isNonEmptyString(record["scopeToken"]))) return false
	if (!(record["toolGrantToken"] === null || isNonEmptyString(record["toolGrantToken"]))) return false
	const payload = asRecord(record["payload"])
	return Boolean(payload && validateAssignmentPacketPayload(payload))
}

function validatePlanResultPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["accepted", "reason", "taskFamily", "assignmentCount", "assignmentPackets", "plannerSummary"])) {
		return false
	}
	if (typeof payload["accepted"] !== "boolean") return false
	if (!("reason" in payload) || !isStringOrNull(payload["reason"])) return false
	if (!(payload["taskFamily"] === null || (isNonEmptyString(payload["taskFamily"]) && isQueenBeeTaskFamily(payload["taskFamily"])))) return false
	if (!isFinitePositiveInteger(payload["assignmentCount"]) && payload["assignmentCount"] !== 0) return false
	if (!Array.isArray(payload["assignmentPackets"]) || !payload["assignmentPackets"].every((packet) => isValidEmbeddedAssignmentPacket(packet))) return false
	if (!isNonEmptyString(payload["plannerSummary"])) return false
	const assignmentCount = payload["assignmentCount"] as number
	const accepted = payload["accepted"] as boolean
	const packets = payload["assignmentPackets"] as unknown[]
	if (assignmentCount !== packets.length) return false
	if (accepted) {
		return payload["taskFamily"] !== null && assignmentCount > 0 && payload["reason"] === null
	}
	return assignmentCount === 0
}

function validateWorkResultPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["accepted", "reason", "changedFiles", "proposalCount", "proposals", "coderSummary"])) return false
	if (typeof payload["accepted"] !== "boolean") return false
	if (!("reason" in payload) || !isStringOrNull(payload["reason"])) return false
	if (!Array.isArray(payload["changedFiles"]) || !payload["changedFiles"].every((item) => isNonEmptyString(item))) return false
	if (!(typeof payload["proposalCount"] === "number" && Number.isInteger(payload["proposalCount"]) && payload["proposalCount"] >= 0)) return false
	if (!Array.isArray(payload["proposals"]) || !payload["proposals"].every((proposal) => validateFileProposal(proposal))) return false
	if (!isNonEmptyString(payload["coderSummary"])) return false
	const accepted = payload["accepted"] as boolean
	const changedFiles = payload["changedFiles"] as string[]
	const proposalCount = payload["proposalCount"] as number
	const proposals = payload["proposals"] as Array<Record<string, unknown>>
	if (proposalCount !== proposals.length) return false
	if (!accepted) return changedFiles.length === 0 && proposalCount === 0
	return payload["reason"] === null && proposalCount > 0 && changedFiles.length === proposalCount
}

function validateReworkRequestPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["languagePack", "allowedFiles", "requestedChanges", "reviewerSummary"])) return false
	return (
		payload["languagePack"] === "js_ts" &&
		Array.isArray(payload["allowedFiles"]) &&
		payload["allowedFiles"].every((item) => isNonEmptyString(item)) &&
		(payload["allowedFiles"] as unknown[]).length === 1 &&
		Array.isArray(payload["requestedChanges"]) &&
		payload["requestedChanges"].every((item) => isNonEmptyString(item)) &&
		(payload["requestedChanges"] as unknown[]).length > 0 &&
		isNonEmptyString(payload["reviewerSummary"])
	)
}

function isValidEmbeddedReworkRequest(value: unknown): boolean {
	const record = asRecord(value)
	if (!record) return false
	if (!isNonEmptyString(record["messageId"])) return false
	if (record["protocolVersion"] !== QUEENBEE_PROTOCOL_VERSION) return false
	if (record["engine"] !== QUEENBEE_ENGINE_NAME) return false
	if (!isNonEmptyString(record["missionId"])) return false
	if (!(record["assignmentId"] === null || isNonEmptyString(record["assignmentId"]))) return false
	if (!isNonEmptyString(record["senderBeeId"]) || !isQueenBeeBeeId(record["senderBeeId"])) return false
	if (!isNonEmptyString(record["recipientBeeId"]) || !isQueenBeeBeeId(record["recipientBeeId"])) return false
	if (record["messageType"] !== "rework_request") return false
	if (!isNonEmptyString(record["timestamp"]) || Number.isNaN(Date.parse(record["timestamp"]))) return false
	if (typeof record["requiresAck"] !== "boolean") return false
	if (!(record["scopeToken"] === null || isNonEmptyString(record["scopeToken"]))) return false
	if (!(record["toolGrantToken"] === null || isNonEmptyString(record["toolGrantToken"]))) return false
	const payload = asRecord(record["payload"])
	return Boolean(payload && validateReworkRequestPayload(payload))
}

function validateReviewRequestPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["languagePack", "changedFiles", "proposalCount", "proposals", "coderSummary"])) return false
	if (payload["languagePack"] !== "js_ts") return false
	if (!Array.isArray(payload["changedFiles"]) || !payload["changedFiles"].every((item) => isNonEmptyString(item))) return false
	if (!(typeof payload["proposalCount"] === "number" && Number.isInteger(payload["proposalCount"]) && payload["proposalCount"] >= 0)) return false
	if (!Array.isArray(payload["proposals"]) || !payload["proposals"].every((proposal) => validateFileProposal(proposal))) return false
	if (!isNonEmptyString(payload["coderSummary"])) return false
	return (payload["proposalCount"] as number) === (payload["proposals"] as unknown[]).length
}

function validateReviewVerdictPayload(
	payload: Record<string, unknown>,
	verdict: "review_pass" | "review_rework" | "review_fail",
): boolean {
	if (!hasOnlyPayloadKeys(payload, ["accepted", "reason", "changedFiles", "reworkCount", "reworkRequests", "reviewSummary"])) return false
	if (typeof payload["accepted"] !== "boolean") return false
	if (!("reason" in payload) || !isStringOrNull(payload["reason"])) return false
	if (!Array.isArray(payload["changedFiles"]) || !payload["changedFiles"].every((item) => isNonEmptyString(item))) return false
	if (!(typeof payload["reworkCount"] === "number" && Number.isInteger(payload["reworkCount"]) && payload["reworkCount"] >= 0)) return false
	if (!Array.isArray(payload["reworkRequests"]) || !payload["reworkRequests"].every((request) => isValidEmbeddedReworkRequest(request))) return false
	if (!isNonEmptyString(payload["reviewSummary"])) return false

	const accepted = payload["accepted"] as boolean
	const reworkCount = payload["reworkCount"] as number
	const reworkRequests = payload["reworkRequests"] as unknown[]
	if (reworkCount !== reworkRequests.length) return false

	if (verdict === "review_pass") {
		return accepted && payload["reason"] === null && reworkCount === 0
	}
	if (verdict === "review_rework") {
		return !accepted && isNonEmptyString(payload["reason"]) && reworkCount > 0
	}
	return !accepted && isNonEmptyString(payload["reason"]) && reworkCount === 0
}

function validateVerificationRequestPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["languagePack", "changedFiles", "proofCommands", "reviewSummary", "expectedPassSurface"])) return false
	return (
		payload["languagePack"] === "js_ts" &&
		Array.isArray(payload["changedFiles"]) &&
		payload["changedFiles"].every((item) => isNonEmptyString(item)) &&
		Array.isArray(payload["proofCommands"]) &&
		payload["proofCommands"].every((item) => isNonEmptyString(item)) &&
		(payload["proofCommands"] as unknown[]).length > 0 &&
		isNonEmptyString(payload["reviewSummary"]) &&
		isNonEmptyString(payload["expectedPassSurface"])
	)
}

function validateVerificationResultRow(value: unknown): boolean {
	const record = asRecord(value)
	if (!record) return false
	return (
		hasOnlyPayloadKeys(record, ["command", "exitCode", "passed", "outputSummary"]) &&
		isNonEmptyString(record["command"]) &&
		typeof record["exitCode"] === "number" &&
		Number.isInteger(record["exitCode"]) &&
		typeof record["passed"] === "boolean" &&
		isNonEmptyString(record["outputSummary"])
	)
}

function validateVerificationVerdictPayload(
	payload: Record<string, unknown>,
	verdict: "verification_pass" | "verification_fail",
): boolean {
	if (!hasOnlyPayloadKeys(payload, ["accepted", "reason", "proofCommands", "resultCount", "results", "verifierSummary"])) return false
	if (typeof payload["accepted"] !== "boolean") return false
	if (!("reason" in payload) || !isStringOrNull(payload["reason"])) return false
	if (!Array.isArray(payload["proofCommands"]) || !payload["proofCommands"].every((item) => isNonEmptyString(item))) return false
	if (!(typeof payload["resultCount"] === "number" && Number.isInteger(payload["resultCount"]) && payload["resultCount"] >= 0)) return false
	if (!Array.isArray(payload["results"]) || !payload["results"].every((row) => validateVerificationResultRow(row))) return false
	if (!isNonEmptyString(payload["verifierSummary"])) return false

	const accepted = payload["accepted"] as boolean
	const proofCommands = payload["proofCommands"] as string[]
	const resultCount = payload["resultCount"] as number
	const results = payload["results"] as Array<Record<string, unknown>>
	if (resultCount !== results.length) return false
	if (proofCommands.length !== results.length && resultCount > 0) return false
	if (resultCount > 0 && !results.every((row, index) => row["command"] === proofCommands[index])) return false

	if (verdict === "verification_pass") {
		return accepted && payload["reason"] === null && resultCount > 0 && results.every((row) => row["passed"] === true)
	}
	if (accepted) return false
	if (!isNonEmptyString(payload["reason"])) return false
	return resultCount === 0 || results.some((row) => row["passed"] === false)
}

function validateMergeRequestPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["changedFiles", "proposals", "proofCommands", "verifierSummary"])) return false
	return (
		Array.isArray(payload["changedFiles"]) &&
		payload["changedFiles"].every((item) => isNonEmptyString(item)) &&
		Array.isArray(payload["proposals"]) &&
		payload["proposals"].every((proposal) => validateFileProposal(proposal)) &&
		Array.isArray(payload["proofCommands"]) &&
		payload["proofCommands"].every((item) => isNonEmptyString(item)) &&
		(payload["proofCommands"] as unknown[]).length > 0 &&
		isNonEmptyString(payload["verifierSummary"])
	)
}

function validateMergeResultPayload(
	payload: Record<string, unknown>,
	verdict: "merge_pass" | "merge_blocked",
): boolean {
	if (!hasOnlyPayloadKeys(payload, ["accepted", "reason", "changedFiles", "proofCommands", "verifierSummary", "mergeSummary"])) return false
	if (typeof payload["accepted"] !== "boolean") return false
	if (!("reason" in payload) || !isStringOrNull(payload["reason"])) return false
	if (!Array.isArray(payload["changedFiles"]) || !payload["changedFiles"].every((item) => isNonEmptyString(item))) return false
	if (!Array.isArray(payload["proofCommands"]) || !payload["proofCommands"].every((item) => isNonEmptyString(item))) return false
	if (!isNonEmptyString(payload["verifierSummary"])) return false
	if (!isNonEmptyString(payload["mergeSummary"])) return false
	if (verdict === "merge_pass") {
		return payload["accepted"] === true && payload["reason"] === null && (payload["changedFiles"] as unknown[]).length > 0
	}
	return payload["accepted"] === false && isNonEmptyString(payload["reason"])
}

function validateArchiveRequestPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["changedFiles", "proofCommands", "verifierSummary", "mergeSummary"])) return false
	return (
		Array.isArray(payload["changedFiles"]) &&
		payload["changedFiles"].every((item) => isNonEmptyString(item)) &&
		Array.isArray(payload["proofCommands"]) &&
		payload["proofCommands"].every((item) => isNonEmptyString(item)) &&
		isNonEmptyString(payload["verifierSummary"]) &&
		isNonEmptyString(payload["mergeSummary"])
	)
}

function validateArchiveWrittenPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["archivePath", "changedFiles", "archiveSummary"])) return false
	return (
		isNonEmptyString(payload["archivePath"]) &&
		Array.isArray(payload["changedFiles"]) &&
		payload["changedFiles"].every((item) => isNonEmptyString(item)) &&
		isNonEmptyString(payload["archiveSummary"])
	)
}

function validateScoutRequestPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["task", "workspace", "targetFiles", "languagePack"])) return false
	return (
		isNonEmptyString(payload["task"]) &&
		isNonEmptyString(payload["workspace"]) &&
		(!("targetFiles" in payload) ||
			(Array.isArray(payload["targetFiles"]) && payload["targetFiles"].every((item) => isNonEmptyString(item)))) &&
		payload["languagePack"] === "js_ts"
	)
}

function validateScoutResultPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["accepted", "reason", "workspaceName", "targetFiles", "contextFiles", "totalFiles", "readOnly", "scoutSummary"])) {
		return false
	}
	if (typeof payload["accepted"] !== "boolean") return false
	if (!("reason" in payload) || !isStringOrNull(payload["reason"])) return false
	if (!(payload["workspaceName"] === null || isNonEmptyString(payload["workspaceName"]))) return false
	if (!Array.isArray(payload["targetFiles"]) || !payload["targetFiles"].every((item) => isNonEmptyString(item))) return false
	if (!Array.isArray(payload["contextFiles"]) || !payload["contextFiles"].every((item) => isNonEmptyString(item))) return false
	if (!(typeof payload["totalFiles"] === "number" && Number.isInteger(payload["totalFiles"]) && payload["totalFiles"] >= 0)) return false
	if (payload["readOnly"] !== true) return false
	return isNonEmptyString(payload["scoutSummary"])
}

function validateBeeReserveRequestPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["targetBeeId", "assignmentId"])) return false
	return (
		isNonEmptyString(payload["targetBeeId"]) &&
		isQueenBeeBeeId(payload["targetBeeId"]) &&
		isNonEmptyString(payload["assignmentId"])
	)
}

function validateBeeReservedPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["reserved", "reason", "entry"])) return false
	if (typeof payload["reserved"] !== "boolean") return false
	if (!("reason" in payload) || !isStringOrNull(payload["reason"])) return false
	return payload["entry"] === null || isValidRegistryEntry(payload["entry"])
}

function validateBeeReleasePayload(payload: Record<string, unknown>): boolean {
	const requestShape =
		hasOnlyPayloadKeys(payload, ["targetBeeId", "assignmentId"]) &&
		isNonEmptyString(payload["targetBeeId"]) &&
		isQueenBeeBeeId(payload["targetBeeId"]) &&
		(!("assignmentId" in payload) || payload["assignmentId"] === null || isNonEmptyString(payload["assignmentId"]))
	const responseShape =
		hasOnlyPayloadKeys(payload, ["released", "reason", "entry"]) &&
		typeof payload["released"] === "boolean" &&
		("reason" in payload && isStringOrNull(payload["reason"])) &&
		(payload["entry"] === null || isValidRegistryEntry(payload["entry"]))
	return requestShape || responseShape
}

function validateRecoveryRequestPayload(payload: Record<string, unknown>): boolean {
	if (
		!hasOnlyPayloadKeys(payload, [
			"failedBeeId",
			"sourceBeeId",
			"failureFamily",
			"sourceMessageType",
			"failureReason",
			"retryCount",
			"artifactRefs",
			"requestSummary",
		])
	) {
		return false
	}
	return (
		isNonEmptyString(payload["failedBeeId"]) &&
		isQueenBeeBeeId(payload["failedBeeId"]) &&
		isNonEmptyString(payload["sourceBeeId"]) &&
		isQueenBeeBeeId(payload["sourceBeeId"]) &&
		isRecoveryFailureFamily(payload["failureFamily"]) &&
		isNonEmptyString(payload["sourceMessageType"]) &&
		isNonEmptyString(payload["failureReason"]) &&
		typeof payload["retryCount"] === "number" &&
		Number.isInteger(payload["retryCount"]) &&
		payload["retryCount"] >= 0 &&
		isStringArray(payload["artifactRefs"]) &&
		isNonEmptyString(payload["requestSummary"])
	)
}

function validateRecoveryPlanPayload(payload: Record<string, unknown>): boolean {
	if (
		!hasOnlyPayloadKeys(payload, [
			"failedBeeId",
			"failureFamily",
			"retryable",
			"sameBeeAllowed",
			"recommendedAction",
			"cooldownUntil",
			"maxRetryCount",
			"recoverySummary",
		])
	) {
		return false
	}
	return (
		isNonEmptyString(payload["failedBeeId"]) &&
		isQueenBeeBeeId(payload["failedBeeId"]) &&
		isRecoveryFailureFamily(payload["failureFamily"]) &&
		typeof payload["retryable"] === "boolean" &&
		typeof payload["sameBeeAllowed"] === "boolean" &&
		isNonEmptyString(payload["recommendedAction"]) &&
		(payload["cooldownUntil"] === null || isNonEmptyString(payload["cooldownUntil"])) &&
		typeof payload["maxRetryCount"] === "number" &&
		Number.isInteger(payload["maxRetryCount"]) &&
		payload["maxRetryCount"] >= 0 &&
		isNonEmptyString(payload["recoverySummary"])
	)
}

function validateQuarantineRequestPayload(payload: Record<string, unknown>): boolean {
	if (
		!hasOnlyPayloadKeys(payload, [
			"failedBeeId",
			"sourceBeeId",
			"failureFamily",
			"quarantineReason",
			"artifactRefs",
			"requestSummary",
		])
	) {
		return false
	}
	return (
		isNonEmptyString(payload["failedBeeId"]) &&
		isQueenBeeBeeId(payload["failedBeeId"]) &&
		isNonEmptyString(payload["sourceBeeId"]) &&
		isQueenBeeBeeId(payload["sourceBeeId"]) &&
		isRecoveryFailureFamily(payload["failureFamily"]) &&
		isNonEmptyString(payload["quarantineReason"]) &&
		isStringArray(payload["artifactRefs"]) &&
		isNonEmptyString(payload["requestSummary"])
	)
}

function validateBeeQuarantinedPayload(payload: Record<string, unknown>): boolean {
	if (!hasOnlyPayloadKeys(payload, ["failedBeeId", "failureFamily", "quarantineReason", "recoverySummary"])) return false
	return (
		isNonEmptyString(payload["failedBeeId"]) &&
		isQueenBeeBeeId(payload["failedBeeId"]) &&
		isRecoveryFailureFamily(payload["failureFamily"]) &&
		isNonEmptyString(payload["quarantineReason"]) &&
		isNonEmptyString(payload["recoverySummary"])
	)
}

function validateMessagePayload(
	messageType: string,
	payload: Record<string, unknown>,
): QueenBeeMessageValidationReason | null {
	switch (messageType) {
		case "registry_lookup_request":
			return validateRegistryLookupRequestPayload(payload) ? null : "invalid_registry_lookup_request_payload"
		case "registry_lookup_result":
			return validateRegistryLookupResultPayload(payload) ? null : "invalid_registry_lookup_result_payload"
		case "scout_request":
			return validateScoutRequestPayload(payload) ? null : "invalid_scout_request_payload"
		case "scout_result":
			return validateScoutResultPayload(payload) ? null : "invalid_scout_result_payload"
		case "plan_request":
			return validatePlanRequestPayload(payload) ? null : "invalid_plan_request_payload"
		case "plan_result":
			return validatePlanResultPayload(payload) ? null : "invalid_plan_result_payload"
		case "assignment_packet":
			return validateAssignmentPacketPayload(payload) ? null : "invalid_assignment_packet_payload"
		case "work_result":
			return validateWorkResultPayload(payload) ? null : "invalid_work_result_payload"
		case "rework_request":
			return validateReworkRequestPayload(payload) ? null : "invalid_rework_request_payload"
		case "review_request":
			return validateReviewRequestPayload(payload) ? null : "invalid_review_request_payload"
		case "review_pass":
			return validateReviewVerdictPayload(payload, "review_pass") ? null : "invalid_review_pass_payload"
		case "review_rework":
			return validateReviewVerdictPayload(payload, "review_rework") ? null : "invalid_review_rework_payload"
		case "review_fail":
			return validateReviewVerdictPayload(payload, "review_fail") ? null : "invalid_review_fail_payload"
		case "verification_request":
			return validateVerificationRequestPayload(payload) ? null : "invalid_verification_request_payload"
		case "verification_pass":
			return validateVerificationVerdictPayload(payload, "verification_pass") ? null : "invalid_verification_pass_payload"
		case "verification_fail":
			return validateVerificationVerdictPayload(payload, "verification_fail") ? null : "invalid_verification_fail_payload"
		case "merge_request":
			return validateMergeRequestPayload(payload) ? null : "invalid_merge_request_payload"
		case "merge_pass":
			return validateMergeResultPayload(payload, "merge_pass") ? null : "invalid_merge_pass_payload"
		case "merge_blocked":
			return validateMergeResultPayload(payload, "merge_blocked") ? null : "invalid_merge_blocked_payload"
		case "archive_request":
			return validateArchiveRequestPayload(payload) ? null : "invalid_archive_request_payload"
		case "archive_written":
			return validateArchiveWrittenPayload(payload) ? null : "invalid_archive_written_payload"
		case "bee_reserve_request":
			return validateBeeReserveRequestPayload(payload) ? null : "invalid_bee_reserve_request_payload"
		case "bee_reserved":
			return validateBeeReservedPayload(payload) ? null : "invalid_bee_reserved_payload"
		case "bee_release":
			return validateBeeReleasePayload(payload) ? null : "invalid_bee_release_payload"
		case "recovery_request":
			return validateRecoveryRequestPayload(payload) ? null : "invalid_recovery_request_payload"
		case "recovery_plan":
			return validateRecoveryPlanPayload(payload) ? null : "invalid_recovery_plan_payload"
		case "quarantine_request":
			return validateQuarantineRequestPayload(payload) ? null : "invalid_quarantine_request_payload"
		case "bee_quarantined":
			return validateBeeQuarantinedPayload(payload) ? null : "invalid_bee_quarantined_payload"
		default:
			return null
	}
}

export class QueenBeeMessageValidator {
	validateEnvelope(value: unknown): QueenBeeMessageValidationResult {
		const snapshot = snapshotQueenBeeEnvelope(value)
		const record = asRecord(value)
		if (!record) {
			return fail("invalid_envelope_shape", snapshot, ["Envelope must be a plain object."])
		}

		const missingFields = missingRequiredFields(record)
		if (missingFields.length > 0) {
			return fail("missing_required_field", snapshot, [`Missing fields: ${missingFields.join(", ")}`])
		}

		const extraFields = unknownFields(record)
		if (extraFields.length > 0) {
			return fail("unknown_envelope_field", snapshot, [`Unknown fields: ${extraFields.join(", ")}`])
		}

		if (!isNonEmptyString(record["messageId"])) {
			return fail("invalid_message_id", snapshot, ["messageId must be a non-empty string."])
		}
		if (record["protocolVersion"] !== QUEENBEE_PROTOCOL_VERSION) {
			return fail("wrong_protocol_version", snapshot, [`protocolVersion must be ${QUEENBEE_PROTOCOL_VERSION}.`])
		}
		if (record["engine"] !== QUEENBEE_ENGINE_NAME) {
			return fail("wrong_engine", snapshot, [`engine must be ${QUEENBEE_ENGINE_NAME}.`])
		}
		if (!isNonEmptyString(record["missionId"])) {
			return fail("invalid_mission_id", snapshot, ["missionId must be a non-empty string."])
		}
		if (!(record["assignmentId"] === null || isNonEmptyString(record["assignmentId"]))) {
			return fail("invalid_assignment_id", snapshot, ["assignmentId must be a non-empty string or null."])
		}
		if (!isNonEmptyString(record["senderBeeId"]) || !isQueenBeeBeeId(record["senderBeeId"])) {
			return fail("unknown_sender_bee", snapshot, ["senderBeeId must name a registered QueenBee bee."])
		}
		if (!isNonEmptyString(record["recipientBeeId"]) || !isQueenBeeBeeId(record["recipientBeeId"])) {
			return fail("unknown_recipient_bee", snapshot, ["recipientBeeId must name a registered QueenBee bee."])
		}
		if (!isNonEmptyString(record["messageType"]) || !isQueenBeeMessageType(record["messageType"])) {
			return fail("invalid_message_type", snapshot, ["messageType must be part of the frozen qb-v1 set."])
		}
		if (!isNonEmptyString(record["timestamp"]) || Number.isNaN(Date.parse(record["timestamp"]))) {
			return fail("invalid_timestamp", snapshot, ["timestamp must be a valid date-time string."])
		}
		if (typeof record["requiresAck"] !== "boolean") {
			return fail("invalid_requires_ack", snapshot, ["requiresAck must be boolean."])
		}
		if (!(record["scopeToken"] === null || isNonEmptyString(record["scopeToken"]))) {
			return fail("invalid_scope_token", snapshot, ["scopeToken must be a non-empty string or null."])
		}
		if (!(record["toolGrantToken"] === null || isNonEmptyString(record["toolGrantToken"]))) {
			return fail("invalid_tool_grant_token", snapshot, ["toolGrantToken must be a non-empty string or null."])
		}
		if ("parentMessageId" in record && !isNonEmptyString(record["parentMessageId"])) {
			return fail("invalid_parent_message_id", snapshot, ["parentMessageId must be a non-empty string when present."])
		}
		if ("attempt" in record && !isFinitePositiveInteger(record["attempt"])) {
			return fail("invalid_attempt", snapshot, ["attempt must be a positive integer when present."])
		}
		if ("deadlineMs" in record && !isFinitePositiveNumber(record["deadlineMs"])) {
			return fail("invalid_deadline_ms", snapshot, ["deadlineMs must be a positive number when present."])
		}
		if ("priority" in record && !isNonEmptyString(record["priority"])) {
			return fail("invalid_priority", snapshot, ["priority must be a non-empty string when present."])
		}
		if ("artifactRefs" in record && !isStringArray(record["artifactRefs"])) {
			return fail("invalid_artifact_refs", snapshot, ["artifactRefs must be an array of strings when present."])
		}
		if ("failureCode" in record && !isNonEmptyString(record["failureCode"])) {
			return fail("invalid_failure_code", snapshot, ["failureCode must be a non-empty string when present."])
		}

		const payload = asRecord(record["payload"])
		if (!payload) {
			return fail("invalid_payload", snapshot, ["payload must be a plain object."])
		}

		const payloadReason = validateMessagePayload(record["messageType"], payload)
		if (payloadReason) {
			return fail(payloadReason, snapshot, [`Payload validation failed for ${record["messageType"]}.`])
		}

		const envelope: QueenBeeEnvelope = {
			messageId: record["messageId"],
			protocolVersion: QUEENBEE_PROTOCOL_VERSION,
			engine: QUEENBEE_ENGINE_NAME,
			missionId: record["missionId"],
			assignmentId: record["assignmentId"] === null ? null : record["assignmentId"],
			senderBeeId: record["senderBeeId"],
			recipientBeeId: record["recipientBeeId"],
			messageType: record["messageType"],
			timestamp: record["timestamp"],
			requiresAck: record["requiresAck"],
			scopeToken: record["scopeToken"] === null ? null : record["scopeToken"],
			toolGrantToken: record["toolGrantToken"] === null ? null : record["toolGrantToken"],
			payload: clonePayload(payload),
		}
		if ("parentMessageId" in record && isNonEmptyString(record["parentMessageId"])) {
			envelope.parentMessageId = record["parentMessageId"]
		}
		if ("attempt" in record && typeof record["attempt"] === "number") {
			envelope.attempt = record["attempt"]
		}
		if ("deadlineMs" in record && typeof record["deadlineMs"] === "number") {
			envelope.deadlineMs = record["deadlineMs"]
		}
		if ("priority" in record && isNonEmptyString(record["priority"])) {
			envelope.priority = record["priority"]
		}
		if ("artifactRefs" in record && Array.isArray(record["artifactRefs"])) {
			envelope.artifactRefs = [...record["artifactRefs"]] as string[]
		}
		if ("failureCode" in record && isNonEmptyString(record["failureCode"])) {
			envelope.failureCode = record["failureCode"]
		}

		return {
			valid: true,
			reason: null,
			envelope,
			snapshot,
			details: ["Envelope accepted by QueenBeeMessageValidator."],
		}
	}
}
