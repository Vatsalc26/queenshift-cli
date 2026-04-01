import {
	QUEENBEE_ENGINE_NAME,
	QUEENBEE_PROTOCOL_VERSION,
	type QueenBeeEnvelopeSnapshot,
} from "./QueenBeeProtocol"

export type QueenBeeProtocolLedgerEntryType = "message_validation" | "route_result" | "state_change"

export type QueenBeeProtocolLedgerEntry = {
	sequence: number
	entryType: QueenBeeProtocolLedgerEntryType
	engine: typeof QUEENBEE_ENGINE_NAME
	protocolVersion: typeof QUEENBEE_PROTOCOL_VERSION
	timestamp: string
	messageId: string | null
	missionId: string | null
	assignmentId: string | null
	senderBeeId: string | null
	recipientBeeId: string | null
	messageType: string | null
	edge: string | null
	status: string
	reason: string | null
	actor: string | null
	details: Record<string, unknown>
}

export type QueenBeeProtocolLedgerArtifact = {
	schemaVersion: 1
	engine: typeof QUEENBEE_ENGINE_NAME
	protocolVersion: typeof QUEENBEE_PROTOCOL_VERSION
	entryCount: number
	validationCount: number
	routeCount: number
	stateChangeCount: number
	entries: QueenBeeProtocolLedgerEntry[]
}

function cloneDetails(details: Record<string, unknown>): Record<string, unknown> {
	return JSON.parse(JSON.stringify(details)) as Record<string, unknown>
}

function cloneEntry(entry: QueenBeeProtocolLedgerEntry): QueenBeeProtocolLedgerEntry {
	return {
		...entry,
		details: cloneDetails(entry.details),
	}
}

function normalizeTimestamp(value: string | null | undefined): string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString()
}

function buildBaseEntry(input: {
	sequence: number
	entryType: QueenBeeProtocolLedgerEntryType
	snapshot?: QueenBeeEnvelopeSnapshot | null
	edge?: string | null
	status: string
	reason?: string | null
	actor?: string | null
	timestamp?: string | null
	details?: Record<string, unknown>
}): QueenBeeProtocolLedgerEntry {
	return {
		sequence: input.sequence,
		entryType: input.entryType,
		engine: QUEENBEE_ENGINE_NAME,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		timestamp: normalizeTimestamp(input.timestamp ?? input.snapshot?.timestamp ?? null),
		messageId: input.snapshot?.messageId ?? null,
		missionId: input.snapshot?.missionId ?? null,
		assignmentId: input.snapshot?.assignmentId ?? null,
		senderBeeId: input.snapshot?.senderBeeId ?? null,
		recipientBeeId: input.snapshot?.recipientBeeId ?? null,
		messageType: input.snapshot?.messageType ?? null,
		edge: input.edge ?? null,
		status: input.status,
		reason: input.reason ?? null,
		actor: input.actor ?? null,
		details: cloneDetails(input.details ?? {}),
	}
}

export class QueenBeeProtocolLedger {
	private readonly entries: QueenBeeProtocolLedgerEntry[] = []

	recordValidation(input: {
		snapshot: QueenBeeEnvelopeSnapshot
		status: "accepted" | "rejected"
		reason?: string | null
		stage?: "incoming" | "response"
		details?: string[]
	}): QueenBeeProtocolLedgerEntry {
		const entry = buildBaseEntry({
			sequence: this.entries.length + 1,
			entryType: "message_validation",
			snapshot: input.snapshot,
			status: input.status,
			reason: input.reason ?? null,
			actor: "QueenBeeMessageValidator",
			details: {
				stage: input.stage ?? "incoming",
				details: input.details ?? [],
			},
		})
		this.entries.push(entry)
		return cloneEntry(entry)
	}

	recordRoute(input: {
		snapshot: QueenBeeEnvelopeSnapshot
		edge: string
		status: "delivered" | "rejected" | "recipient_runtime_unavailable"
		reason?: string | null
		handledBy?: string | null
		responseSnapshot?: QueenBeeEnvelopeSnapshot | null
	}): QueenBeeProtocolLedgerEntry {
		const entry = buildBaseEntry({
			sequence: this.entries.length + 1,
			entryType: "route_result",
			snapshot: input.snapshot,
			edge: input.edge,
			status: input.status,
			reason: input.reason ?? null,
			actor: input.handledBy ?? null,
			details: {
				responseMessageId: input.responseSnapshot?.messageId ?? null,
				responseMessageType: input.responseSnapshot?.messageType ?? null,
				responseRecipientBeeId: input.responseSnapshot?.recipientBeeId ?? null,
			},
		})
		this.entries.push(entry)
		return cloneEntry(entry)
	}

	recordStateChange(input: {
		beeId: string
		before: Record<string, unknown>
		after: Record<string, unknown>
		changedKeys: string[]
		missionId?: string | null
		assignmentId?: string | null
		sourceMessageId?: string | null
		timestamp?: string | null
		reason?: string | null
	}): QueenBeeProtocolLedgerEntry {
		const entry = buildBaseEntry({
			sequence: this.entries.length + 1,
			entryType: "state_change",
			snapshot: {
				messageId: input.sourceMessageId ?? null,
				missionId: input.missionId ?? null,
				assignmentId: input.assignmentId ?? null,
				senderBeeId: null,
				recipientBeeId: input.beeId,
				messageType: null,
				timestamp: input.timestamp ?? null,
			},
			status: "mutated",
			reason: input.reason ?? null,
			actor: "RegistryBee",
			details: {
				beeId: input.beeId,
				changedKeys: [...input.changedKeys],
				before: cloneDetails(input.before),
				after: cloneDetails(input.after),
			},
		})
		this.entries.push(entry)
		return cloneEntry(entry)
	}

	listEntries(): QueenBeeProtocolLedgerEntry[] {
		return this.entries.map((entry) => cloneEntry(entry))
	}

	buildArtifact(): QueenBeeProtocolLedgerArtifact {
		const entries = this.listEntries()
		return {
			schemaVersion: 1,
			engine: QUEENBEE_ENGINE_NAME,
			protocolVersion: QUEENBEE_PROTOCOL_VERSION,
			entryCount: entries.length,
			validationCount: entries.filter((entry) => entry.entryType === "message_validation").length,
			routeCount: entries.filter((entry) => entry.entryType === "route_result").length,
			stateChangeCount: entries.filter((entry) => entry.entryType === "state_change").length,
			entries,
		}
	}
}

function resolveArtifact(source: QueenBeeProtocolLedger | QueenBeeProtocolLedgerArtifact): QueenBeeProtocolLedgerArtifact {
	return source instanceof QueenBeeProtocolLedger ? source.buildArtifact() : source
}

export function formatQueenBeeProtocolLedger(source: QueenBeeProtocolLedger | QueenBeeProtocolLedgerArtifact): string {
	const artifact = resolveArtifact(source)
	return [
		`QueenBee protocol ledger: entries=${artifact.entryCount} validations=${artifact.validationCount} routes=${artifact.routeCount} stateChanges=${artifact.stateChangeCount}`,
		...artifact.entries.map(
			(entry) =>
				`- #${entry.sequence} ${entry.entryType} status=${entry.status} message=${entry.messageId ?? "(none)"} type=${entry.messageType ?? "(none)"} edge=${entry.edge ?? "(none)"} actor=${entry.actor ?? "(none)"} reason=${entry.reason ?? "(none)"}`,
		),
	].join("\n")
}
