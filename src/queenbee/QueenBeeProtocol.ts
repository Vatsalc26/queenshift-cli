export const QUEENBEE_PROTOCOL_VERSION = "qb-v1" as const
export const QUEENBEE_ENGINE_NAME = "queenbee" as const

export const QUEENBEE_BEE_TYPES = [
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
] as const

export const QUEENBEE_ROLE_FAMILIES = [
	"mission_owner",
	"router",
	"registry",
	"safety",
	"scout",
	"planner",
	"coder",
	"reviewer",
	"verifier",
	"merge",
	"archivist",
	"recovery",
] as const

export const QUEENBEE_LANGUAGE_PACKS = ["shared", "js_ts"] as const
export const QUEENBEE_TASK_FAMILIES = [
	"comment_file",
	"create_tiny_file",
	"update_named_file",
	"bounded_two_file_update",
	"update_file_and_test",
	"rename_export",
	"bounded_node_cli_task",
] as const
export const QUEENBEE_AVAILABILITY_STATES = [
	"idle",
	"reserved",
	"assigned",
	"executing",
	"waiting",
	"blocked",
	"cooling_off",
	"quarantined",
] as const
export const QUEENBEE_TRUST_STATES = ["trusted", "observed", "restricted", "quarantined"] as const
export const QUEENBEE_COST_CLASSES = ["cheap", "balanced", "expensive"] as const
export const QUEENBEE_SPEED_CLASSES = ["fast", "normal", "slow"] as const
export const QUEENBEE_TOOL_FAMILIES = [
	"message",
	"human_explain",
	"registry_read",
	"safety_check",
	"repo_read",
	"repo_edit",
	"verify_exec",
	"git_merge",
	"artifact_write",
	"failure_analyze",
] as const
export const QUEENBEE_VISIBLE_QUEUE_NAMES = [
	"mission_ingress_queue",
	"service_queue",
	"specialist_queue",
	"completion_queue",
] as const
export const QUEENBEE_VISIBLE_PROGRESS_STAGES = [
	"admission",
	"registry_and_scout",
	"planning",
	"proposal",
	"review",
	"verification",
	"merge_and_archive",
	"bounded_stop",
] as const
export const QUEENBEE_MESSAGE_TYPES = [
	"mission_submitted",
	"mission_admitted",
	"mission_refused",
	"mission_closed",
	"registry_lookup_request",
	"registry_lookup_result",
	"bee_reserve_request",
	"bee_reserved",
	"bee_release",
	"scout_request",
	"scout_result",
	"plan_request",
	"plan_result",
	"assignment_packet",
	"assignment_ack",
	"work_result",
	"work_blocker",
	"rework_request",
	"review_request",
	"review_pass",
	"review_rework",
	"review_fail",
	"verification_request",
	"verification_pass",
	"verification_fail",
	"merge_request",
	"merge_pass",
	"merge_blocked",
	"archive_request",
	"archive_written",
	"recovery_request",
	"recovery_plan",
	"quarantine_request",
	"bee_quarantined",
] as const

export const QUEENBEE_REQUIRED_ENVELOPE_FIELDS = [
	"messageId",
	"protocolVersion",
	"engine",
	"missionId",
	"assignmentId",
	"senderBeeId",
	"recipientBeeId",
	"messageType",
	"timestamp",
	"requiresAck",
	"scopeToken",
	"toolGrantToken",
	"payload",
] as const

export const QUEENBEE_OPTIONAL_ENVELOPE_FIELDS = [
	"parentMessageId",
	"attempt",
	"deadlineMs",
	"priority",
	"artifactRefs",
	"failureCode",
] as const

export const FIRST_REGISTERED_QUEENBEE_BEES = [
	"queenbee.queen.001",
	"queenbee.router.001",
	"queenbee.registry.001",
	"queenbee.safety.001",
	"queenbee.scout.001",
	"queenbee.planner.001",
	"queenbee.jsts_coder.001",
	"queenbee.jsts_reviewer.001",
	"queenbee.verifier.001",
	"queenbee.merge.001",
	"queenbee.archivist.001",
	"queenbee.recovery.001",
] as const

export type QueenBeeBeeType = (typeof QUEENBEE_BEE_TYPES)[number]
export type QueenBeeRoleFamily = (typeof QUEENBEE_ROLE_FAMILIES)[number]
export type QueenBeeLanguagePack = (typeof QUEENBEE_LANGUAGE_PACKS)[number]
export type QueenBeeTaskFamily = (typeof QUEENBEE_TASK_FAMILIES)[number]
export type QueenBeeAvailabilityState = (typeof QUEENBEE_AVAILABILITY_STATES)[number]
export type QueenBeeTrustState = (typeof QUEENBEE_TRUST_STATES)[number]
export type QueenBeeCostClass = (typeof QUEENBEE_COST_CLASSES)[number]
export type QueenBeeSpeedClass = (typeof QUEENBEE_SPEED_CLASSES)[number]
export type QueenBeeToolFamily = (typeof QUEENBEE_TOOL_FAMILIES)[number]
export type QueenBeeVisibleQueueName = (typeof QUEENBEE_VISIBLE_QUEUE_NAMES)[number]
export type QueenBeeVisibleProgressStage = (typeof QUEENBEE_VISIBLE_PROGRESS_STAGES)[number]
export type QueenBeeMessageType = (typeof QUEENBEE_MESSAGE_TYPES)[number]
export type QueenBeeBeeId = (typeof FIRST_REGISTERED_QUEENBEE_BEES)[number]
export type QueenBeeRequiredEnvelopeField = (typeof QUEENBEE_REQUIRED_ENVELOPE_FIELDS)[number]
export type QueenBeeOptionalEnvelopeField = (typeof QUEENBEE_OPTIONAL_ENVELOPE_FIELDS)[number]

export type QueenBeeEnvelope = {
	messageId: string
	protocolVersion: typeof QUEENBEE_PROTOCOL_VERSION
	engine: typeof QUEENBEE_ENGINE_NAME
	missionId: string
	assignmentId: string | null
	senderBeeId: QueenBeeBeeId
	recipientBeeId: QueenBeeBeeId
	messageType: QueenBeeMessageType
	timestamp: string
	requiresAck: boolean
	scopeToken: string | null
	toolGrantToken: string | null
	payload: Record<string, unknown>
	parentMessageId?: string
	attempt?: number
	deadlineMs?: number
	priority?: string
	artifactRefs?: string[]
	failureCode?: string
}

export type QueenBeeEnvelopeSnapshot = {
	messageId: string | null
	missionId: string | null
	assignmentId: string | null
	senderBeeId: string | null
	recipientBeeId: string | null
	messageType: string | null
	timestamp: string | null
}

export type QueenBeeRegistryEntry = {
	beeId: QueenBeeBeeId
	beeType: QueenBeeBeeType
	engine: typeof QUEENBEE_ENGINE_NAME
	protocolVersion: typeof QUEENBEE_PROTOCOL_VERSION
	languagePack: QueenBeeLanguagePack
	roleFamily: QueenBeeRoleFamily
	toolFamilies: QueenBeeToolFamily[]
	allowedRecipients: QueenBeeBeeId[]
	availabilityState: QueenBeeAvailabilityState
	trustState: QueenBeeTrustState
	concurrencyLimit: number
	currentAssignmentId: string | null
	cooldownUntil: string | null
	quarantineReason: string | null
	costClass: QueenBeeCostClass
	speedClass: QueenBeeSpeedClass
	notes: string
}

export type QueenBeeLookupQuery = {
	roleFamily: QueenBeeRoleFamily
	languagePack?: QueenBeeLanguagePack
	requiredToolFamilies?: QueenBeeToolFamily[]
	protocolVersion?: typeof QUEENBEE_PROTOCOL_VERSION
	engine?: typeof QUEENBEE_ENGINE_NAME
}

function readStringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function isQueenBeeBeeType(value: string): value is QueenBeeBeeType {
	return (QUEENBEE_BEE_TYPES as readonly string[]).includes(value)
}

export function isQueenBeeRoleFamily(value: string): value is QueenBeeRoleFamily {
	return (QUEENBEE_ROLE_FAMILIES as readonly string[]).includes(value)
}

export function isQueenBeeLanguagePack(value: string): value is QueenBeeLanguagePack {
	return (QUEENBEE_LANGUAGE_PACKS as readonly string[]).includes(value)
}

export function isQueenBeeTaskFamily(value: string): value is QueenBeeTaskFamily {
	return (QUEENBEE_TASK_FAMILIES as readonly string[]).includes(value)
}

export function isQueenBeeToolFamily(value: string): value is QueenBeeToolFamily {
	return (QUEENBEE_TOOL_FAMILIES as readonly string[]).includes(value)
}

export function isQueenBeeAvailabilityState(value: string): value is QueenBeeAvailabilityState {
	return (QUEENBEE_AVAILABILITY_STATES as readonly string[]).includes(value)
}

export function isQueenBeeTrustState(value: string): value is QueenBeeTrustState {
	return (QUEENBEE_TRUST_STATES as readonly string[]).includes(value)
}

export function isQueenBeeCostClass(value: string): value is QueenBeeCostClass {
	return (QUEENBEE_COST_CLASSES as readonly string[]).includes(value)
}

export function isQueenBeeSpeedClass(value: string): value is QueenBeeSpeedClass {
	return (QUEENBEE_SPEED_CLASSES as readonly string[]).includes(value)
}

export function isQueenBeeBeeId(value: string): value is QueenBeeBeeId {
	return (FIRST_REGISTERED_QUEENBEE_BEES as readonly string[]).includes(value)
}

export function isQueenBeeMessageType(value: string): value is QueenBeeMessageType {
	return (QUEENBEE_MESSAGE_TYPES as readonly string[]).includes(value)
}

export function cloneQueenBeeRegistryEntry(entry: QueenBeeRegistryEntry): QueenBeeRegistryEntry {
	return {
		...entry,
		toolFamilies: [...entry.toolFamilies],
		allowedRecipients: [...entry.allowedRecipients],
	}
}

export function buildQueenBeeEnvelope(input: {
	messageId: string
	missionId: string
	assignmentId?: string | null
	senderBeeId: QueenBeeBeeId
	recipientBeeId: QueenBeeBeeId
	messageType: QueenBeeMessageType
	timestamp: string
	requiresAck?: boolean
	scopeToken?: string | null
	toolGrantToken?: string | null
	payload?: Record<string, unknown>
	parentMessageId?: string
	attempt?: number
	deadlineMs?: number
	priority?: string
	artifactRefs?: string[]
	failureCode?: string
}): QueenBeeEnvelope {
	const envelope: QueenBeeEnvelope = {
		messageId: input.messageId,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		engine: QUEENBEE_ENGINE_NAME,
		missionId: input.missionId,
		assignmentId: input.assignmentId ?? null,
		senderBeeId: input.senderBeeId,
		recipientBeeId: input.recipientBeeId,
		messageType: input.messageType,
		timestamp: input.timestamp,
		requiresAck: input.requiresAck === true,
		scopeToken: input.scopeToken ?? null,
		toolGrantToken: input.toolGrantToken ?? null,
		payload: input.payload ?? {},
	}
	if (typeof input.parentMessageId === "string" && input.parentMessageId.trim().length > 0) {
		envelope.parentMessageId = input.parentMessageId
	}
	if (typeof input.attempt === "number") {
		envelope.attempt = input.attempt
	}
	if (typeof input.deadlineMs === "number") {
		envelope.deadlineMs = input.deadlineMs
	}
	if (typeof input.priority === "string" && input.priority.trim().length > 0) {
		envelope.priority = input.priority
	}
	if (Array.isArray(input.artifactRefs)) {
		envelope.artifactRefs = [...input.artifactRefs]
	}
	if (typeof input.failureCode === "string" && input.failureCode.trim().length > 0) {
		envelope.failureCode = input.failureCode
	}
	return envelope
}

export function snapshotQueenBeeEnvelope(value: unknown): QueenBeeEnvelopeSnapshot {
	const record = asRecord(value)
	if (!record) {
		return {
			messageId: null,
			missionId: null,
			assignmentId: null,
			senderBeeId: null,
			recipientBeeId: null,
			messageType: null,
			timestamp: null,
		}
	}

	return {
		messageId: readStringOrNull(record["messageId"]),
		missionId: readStringOrNull(record["missionId"]),
		assignmentId: record["assignmentId"] === null ? null : readStringOrNull(record["assignmentId"]),
		senderBeeId: readStringOrNull(record["senderBeeId"]),
		recipientBeeId: readStringOrNull(record["recipientBeeId"]),
		messageType: readStringOrNull(record["messageType"]),
		timestamp: readStringOrNull(record["timestamp"]),
	}
}
