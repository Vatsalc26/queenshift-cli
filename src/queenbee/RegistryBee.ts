import {
	QUEENBEE_ENGINE_NAME,
	QUEENBEE_PROTOCOL_VERSION,
	buildQueenBeeEnvelope,
	cloneQueenBeeRegistryEntry,
	isQueenBeeBeeId,
	isQueenBeeLanguagePack,
	isQueenBeeRoleFamily,
	isQueenBeeToolFamily,
	type QueenBeeAvailabilityState,
	type QueenBeeBeeId,
	type QueenBeeEnvelope,
	type QueenBeeLookupQuery,
	type QueenBeeRegistryEntry,
	type QueenBeeToolFamily,
	type QueenBeeTrustState,
} from "./QueenBeeProtocol"
import { QueenBeeProtocolLedger } from "./QueenBeeProtocolLedger"

export type QueenBeeLookupResult = {
	candidates: QueenBeeRegistryEntry[]
}

export type QueenBeeReserveResult = {
	reserved: boolean
	entry: QueenBeeRegistryEntry | null
	reason: string | null
}

export type QueenBeeReleaseResult = {
	released: boolean
	entry: QueenBeeRegistryEntry | null
	reason: string | null
}

export type QueenBeeRegistryMutationSource = {
	messageId?: string | null
	missionId?: string | null
	assignmentId?: string | null
	timestamp?: string | null
	reason?: string | null
}

function createEntry(entry: QueenBeeRegistryEntry): QueenBeeRegistryEntry {
	return cloneQueenBeeRegistryEntry(entry)
}

const DEFAULT_QUEENBEE_REGISTRY_ENTRIES: QueenBeeRegistryEntry[] = [
	createEntry({
		beeId: "queenbee.queen.001",
		beeType: "QueenBee",
		engine: QUEENBEE_ENGINE_NAME,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		languagePack: "shared",
		roleFamily: "mission_owner",
		toolFamilies: ["message", "human_explain"],
		allowedRecipients: ["queenbee.router.001"],
		availabilityState: "idle",
		trustState: "trusted",
		concurrencyLimit: 1,
		currentAssignmentId: null,
		cooldownUntil: null,
		quarantineReason: null,
		costClass: "cheap",
		speedClass: "normal",
		notes: "Mission owner for the experimental QueenBee shell.",
	}),
	createEntry({
		beeId: "queenbee.router.001",
		beeType: "RouterBee",
		engine: QUEENBEE_ENGINE_NAME,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		languagePack: "shared",
		roleFamily: "router",
		toolFamilies: ["message"],
		allowedRecipients: [
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
		],
		availabilityState: "idle",
		trustState: "trusted",
		concurrencyLimit: 1,
		currentAssignmentId: null,
		cooldownUntil: null,
		quarantineReason: null,
		costClass: "cheap",
		speedClass: "fast",
		notes: "Deterministic route controller for the QueenBee candidate.",
	}),
	createEntry({
		beeId: "queenbee.registry.001",
		beeType: "RegistryBee",
		engine: QUEENBEE_ENGINE_NAME,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		languagePack: "shared",
		roleFamily: "registry",
		toolFamilies: ["message", "registry_read"],
		allowedRecipients: ["queenbee.router.001"],
		availabilityState: "idle",
		trustState: "trusted",
		concurrencyLimit: 1,
		currentAssignmentId: null,
		cooldownUntil: null,
		quarantineReason: null,
		costClass: "cheap",
		speedClass: "fast",
		notes: "Deterministic registry ledger for capability lookup and reservation state.",
	}),
	createEntry({
		beeId: "queenbee.safety.001",
		beeType: "SafetyBee",
		engine: QUEENBEE_ENGINE_NAME,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		languagePack: "shared",
		roleFamily: "safety",
		toolFamilies: ["message", "safety_check", "human_explain"],
		allowedRecipients: ["queenbee.router.001"],
		availabilityState: "idle",
		trustState: "trusted",
		concurrencyLimit: 1,
		currentAssignmentId: null,
		cooldownUntil: null,
		quarantineReason: null,
		costClass: "cheap",
		speedClass: "fast",
		notes: "Future safety bridge endpoint.",
	}),
	createEntry({
		beeId: "queenbee.scout.001",
		beeType: "ScoutBee",
		engine: QUEENBEE_ENGINE_NAME,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		languagePack: "shared",
		roleFamily: "scout",
		toolFamilies: ["message", "repo_read", "human_explain"],
		allowedRecipients: ["queenbee.router.001"],
		availabilityState: "idle",
		trustState: "trusted",
		concurrencyLimit: 1,
		currentAssignmentId: null,
		cooldownUntil: null,
		quarantineReason: null,
		costClass: "balanced",
		speedClass: "normal",
		notes: "Future bounded discovery endpoint.",
	}),
	createEntry({
		beeId: "queenbee.planner.001",
		beeType: "PlannerBee",
		engine: QUEENBEE_ENGINE_NAME,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		languagePack: "shared",
		roleFamily: "planner",
		toolFamilies: ["message", "human_explain"],
		allowedRecipients: ["queenbee.router.001"],
		availabilityState: "idle",
		trustState: "trusted",
		concurrencyLimit: 1,
		currentAssignmentId: null,
		cooldownUntil: null,
		quarantineReason: null,
		costClass: "balanced",
		speedClass: "normal",
		notes: "Future assignment packet planner endpoint.",
	}),
	createEntry({
		beeId: "queenbee.jsts_coder.001",
		beeType: "JSTSCoderBee",
		engine: QUEENBEE_ENGINE_NAME,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		languagePack: "js_ts",
		roleFamily: "coder",
		toolFamilies: ["message", "repo_read", "repo_edit", "human_explain"],
		allowedRecipients: ["queenbee.router.001"],
		availabilityState: "idle",
		trustState: "trusted",
		concurrencyLimit: 1,
		currentAssignmentId: null,
		cooldownUntil: null,
		quarantineReason: null,
		costClass: "balanced",
		speedClass: "normal",
		notes: "Future JS/TS coding worker endpoint.",
	}),
	createEntry({
		beeId: "queenbee.jsts_reviewer.001",
		beeType: "JSTSReviewerBee",
		engine: QUEENBEE_ENGINE_NAME,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		languagePack: "js_ts",
		roleFamily: "reviewer",
		toolFamilies: ["message", "repo_read", "human_explain"],
		allowedRecipients: ["queenbee.router.001"],
		availabilityState: "idle",
		trustState: "trusted",
		concurrencyLimit: 1,
		currentAssignmentId: null,
		cooldownUntil: null,
		quarantineReason: null,
		costClass: "balanced",
		speedClass: "normal",
		notes: "Future JS/TS review endpoint.",
	}),
	createEntry({
		beeId: "queenbee.verifier.001",
		beeType: "VerifierBee",
		engine: QUEENBEE_ENGINE_NAME,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		languagePack: "js_ts",
		roleFamily: "verifier",
		toolFamilies: ["message", "verify_exec", "human_explain"],
		allowedRecipients: ["queenbee.router.001"],
		availabilityState: "idle",
		trustState: "trusted",
		concurrencyLimit: 1,
		currentAssignmentId: null,
		cooldownUntil: null,
		quarantineReason: null,
		costClass: "balanced",
		speedClass: "normal",
		notes: "Future JS/TS verification endpoint.",
	}),
	createEntry({
		beeId: "queenbee.merge.001",
		beeType: "MergeBee",
		engine: QUEENBEE_ENGINE_NAME,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		languagePack: "shared",
		roleFamily: "merge",
		toolFamilies: ["message", "repo_read", "git_merge", "human_explain"],
		allowedRecipients: ["queenbee.router.001"],
		availabilityState: "idle",
		trustState: "trusted",
		concurrencyLimit: 1,
		currentAssignmentId: null,
		cooldownUntil: null,
		quarantineReason: null,
		costClass: "balanced",
		speedClass: "normal",
		notes: "Future merge endpoint.",
	}),
	createEntry({
		beeId: "queenbee.archivist.001",
		beeType: "ArchivistBee",
		engine: QUEENBEE_ENGINE_NAME,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		languagePack: "shared",
		roleFamily: "archivist",
		toolFamilies: ["message", "artifact_write"],
		allowedRecipients: ["queenbee.router.001"],
		availabilityState: "idle",
		trustState: "trusted",
		concurrencyLimit: 1,
		currentAssignmentId: null,
		cooldownUntil: null,
		quarantineReason: null,
		costClass: "cheap",
		speedClass: "fast",
		notes: "Future artifact persistence endpoint.",
	}),
	createEntry({
		beeId: "queenbee.recovery.001",
		beeType: "RecoveryBee",
		engine: QUEENBEE_ENGINE_NAME,
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		languagePack: "shared",
		roleFamily: "recovery",
		toolFamilies: ["message", "failure_analyze", "human_explain"],
		allowedRecipients: ["queenbee.router.001"],
		availabilityState: "idle",
		trustState: "trusted",
		concurrencyLimit: 1,
		currentAssignmentId: null,
		cooldownUntil: null,
		quarantineReason: null,
		costClass: "expensive",
		speedClass: "slow",
		notes: "Future recovery and quarantine endpoint.",
	}),
]

const TRUST_RANK: Record<QueenBeeTrustState, number> = {
	trusted: 0,
	observed: 1,
	restricted: 2,
	quarantined: 3,
}

const COST_RANK = {
	cheap: 0,
	balanced: 1,
	expensive: 2,
} as const

const SPEED_RANK = {
	fast: 0,
	normal: 1,
	slow: 2,
} as const

function compareEntries(left: QueenBeeRegistryEntry, right: QueenBeeRegistryEntry): number {
	const trustDelta = TRUST_RANK[left.trustState] - TRUST_RANK[right.trustState]
	if (trustDelta !== 0) return trustDelta
	const costDelta = COST_RANK[left.costClass] - COST_RANK[right.costClass]
	if (costDelta !== 0) return costDelta
	const speedDelta = SPEED_RANK[left.speedClass] - SPEED_RANK[right.speedClass]
	if (speedDelta !== 0) return speedDelta
	return left.beeId.localeCompare(right.beeId)
}

function parseRequiredToolFamilies(value: unknown): QueenBeeToolFamily[] {
	if (!Array.isArray(value)) return []
	return value.filter((item): item is QueenBeeToolFamily => typeof item === "string" && isQueenBeeToolFamily(item))
}

export function buildDefaultQueenBeeRegistryEntries(): QueenBeeRegistryEntry[] {
	return DEFAULT_QUEENBEE_REGISTRY_ENTRIES.map((entry) => cloneQueenBeeRegistryEntry(entry))
}

export class RegistryBee {
	private readonly entries = new Map<QueenBeeBeeId, QueenBeeRegistryEntry>()
	private readonly registryBeeId: QueenBeeBeeId
	private readonly protocolLedger: QueenBeeProtocolLedger | null

	constructor(
		entries: QueenBeeRegistryEntry[] = buildDefaultQueenBeeRegistryEntries(),
		registryBeeId: QueenBeeBeeId = "queenbee.registry.001",
		protocolLedger: QueenBeeProtocolLedger | null = null,
	) {
		this.registryBeeId = registryBeeId
		this.protocolLedger = protocolLedger
		for (const entry of entries) {
			this.entries.set(entry.beeId, cloneQueenBeeRegistryEntry(entry))
		}
	}

	private recordStateChange(
		beeId: QueenBeeBeeId,
		before: Record<string, unknown>,
		after: Record<string, unknown>,
		source: QueenBeeRegistryMutationSource | undefined,
	): void {
		if (!this.protocolLedger) return
		const changedKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(
			(key) => before[key] !== after[key],
		)
		if (changedKeys.length === 0) return
		this.protocolLedger.recordStateChange({
			beeId,
			before,
			after,
			changedKeys,
			missionId: source?.missionId ?? null,
			assignmentId: source?.assignmentId ?? null,
			sourceMessageId: source?.messageId ?? null,
			timestamp: source?.timestamp ?? null,
			reason: source?.reason ?? null,
		})
	}

	listEntries(): QueenBeeRegistryEntry[] {
		return Array.from(this.entries.values(), (entry) => cloneQueenBeeRegistryEntry(entry))
	}

	getEntry(beeId: QueenBeeBeeId): QueenBeeRegistryEntry | null {
		const entry = this.entries.get(beeId)
		return entry ? cloneQueenBeeRegistryEntry(entry) : null
	}

	setAvailability(
		beeId: QueenBeeBeeId,
		availabilityState: QueenBeeAvailabilityState,
		assignmentId: string | null = null,
		source?: QueenBeeRegistryMutationSource,
	): QueenBeeRegistryEntry {
		const existing = this.entries.get(beeId)
		if (!existing) throw new Error(`Unknown QueenBee registry entry: ${beeId}`)
		const next: QueenBeeRegistryEntry = {
			...existing,
			availabilityState,
			currentAssignmentId: assignmentId,
		}
		this.entries.set(beeId, next)
		this.recordStateChange(
			beeId,
			{
				availabilityState: existing.availabilityState,
				currentAssignmentId: existing.currentAssignmentId,
			},
			{
				availabilityState: next.availabilityState,
				currentAssignmentId: next.currentAssignmentId,
			},
			source,
		)
		return cloneQueenBeeRegistryEntry(next)
	}

	setTrustState(
		beeId: QueenBeeBeeId,
		trustState: QueenBeeTrustState,
		quarantineReason: string | null = null,
		source?: QueenBeeRegistryMutationSource,
	): QueenBeeRegistryEntry {
		const existing = this.entries.get(beeId)
		if (!existing) throw new Error(`Unknown QueenBee registry entry: ${beeId}`)
		const next: QueenBeeRegistryEntry = {
			...existing,
			trustState,
			quarantineReason,
		}
		this.entries.set(beeId, next)
		this.recordStateChange(
			beeId,
			{
				trustState: existing.trustState,
				quarantineReason: existing.quarantineReason,
			},
			{
				trustState: next.trustState,
				quarantineReason: next.quarantineReason,
			},
			source,
		)
		return cloneQueenBeeRegistryEntry(next)
	}

	setCoolingOff(
		beeId: QueenBeeBeeId,
		cooldownUntil: string,
		source?: QueenBeeRegistryMutationSource,
	): QueenBeeRegistryEntry {
		const existing = this.entries.get(beeId)
		if (!existing) throw new Error(`Unknown QueenBee registry entry: ${beeId}`)
		const next: QueenBeeRegistryEntry = {
			...existing,
			availabilityState: "cooling_off",
			currentAssignmentId: null,
			cooldownUntil,
		}
		this.entries.set(beeId, next)
		this.recordStateChange(
			beeId,
			{
				availabilityState: existing.availabilityState,
				currentAssignmentId: existing.currentAssignmentId,
				cooldownUntil: existing.cooldownUntil,
			},
			{
				availabilityState: next.availabilityState,
				currentAssignmentId: next.currentAssignmentId,
				cooldownUntil: next.cooldownUntil,
			},
			source,
		)
		return cloneQueenBeeRegistryEntry(next)
	}

	quarantine(
		beeId: QueenBeeBeeId,
		quarantineReason: string,
		source?: QueenBeeRegistryMutationSource,
	): QueenBeeRegistryEntry {
		const existing = this.entries.get(beeId)
		if (!existing) throw new Error(`Unknown QueenBee registry entry: ${beeId}`)
		const next: QueenBeeRegistryEntry = {
			...existing,
			availabilityState: "quarantined",
			trustState: "quarantined",
			currentAssignmentId: null,
			cooldownUntil: null,
			quarantineReason,
		}
		this.entries.set(beeId, next)
		this.recordStateChange(
			beeId,
			{
				availabilityState: existing.availabilityState,
				trustState: existing.trustState,
				currentAssignmentId: existing.currentAssignmentId,
				cooldownUntil: existing.cooldownUntil,
				quarantineReason: existing.quarantineReason,
			},
			{
				availabilityState: next.availabilityState,
				trustState: next.trustState,
				currentAssignmentId: next.currentAssignmentId,
				cooldownUntil: next.cooldownUntil,
				quarantineReason: next.quarantineReason,
			},
			source,
		)
		return cloneQueenBeeRegistryEntry(next)
	}

	lookup(query: QueenBeeLookupQuery): QueenBeeLookupResult {
		const candidates = this.listEntries()
			.filter((entry) => entry.engine === (query.engine ?? QUEENBEE_ENGINE_NAME))
			.filter((entry) => entry.protocolVersion === (query.protocolVersion ?? QUEENBEE_PROTOCOL_VERSION))
			.filter((entry) => entry.roleFamily === query.roleFamily)
			.filter((entry) => (query.languagePack ? entry.languagePack === query.languagePack : true))
			.filter((entry) => entry.availabilityState === "idle")
			.filter((entry) => entry.currentAssignmentId === null)
			.filter((entry) => entry.trustState !== "quarantined")
			.filter((entry) => (query.requiredToolFamilies ?? []).every((toolFamily) => entry.toolFamilies.includes(toolFamily)))
			.sort(compareEntries)
		return {
			candidates,
		}
	}

	reserve(input: { beeId: QueenBeeBeeId; assignmentId: string }, source?: QueenBeeRegistryMutationSource): QueenBeeReserveResult {
		const entry = this.entries.get(input.beeId)
		if (!entry) {
			return { reserved: false, entry: null, reason: "unknown_bee" }
		}
		if (entry.trustState === "quarantined") {
			return { reserved: false, entry: cloneQueenBeeRegistryEntry(entry), reason: "bee_quarantined" }
		}
		if (entry.availabilityState !== "idle" || entry.currentAssignmentId) {
			return { reserved: false, entry: cloneQueenBeeRegistryEntry(entry), reason: "bee_not_idle" }
		}
		const next: QueenBeeRegistryEntry = {
			...entry,
			availabilityState: "reserved",
			currentAssignmentId: input.assignmentId,
		}
		this.entries.set(input.beeId, next)
		this.recordStateChange(
			input.beeId,
			{
				availabilityState: entry.availabilityState,
				currentAssignmentId: entry.currentAssignmentId,
			},
			{
				availabilityState: next.availabilityState,
				currentAssignmentId: next.currentAssignmentId,
			},
			source,
		)
		return {
			reserved: true,
			entry: cloneQueenBeeRegistryEntry(next),
			reason: null,
		}
	}

	release(input: { beeId: QueenBeeBeeId; assignmentId?: string | null }, source?: QueenBeeRegistryMutationSource): QueenBeeReleaseResult {
		const entry = this.entries.get(input.beeId)
		if (!entry) {
			return { released: false, entry: null, reason: "unknown_bee" }
		}
		if (input.assignmentId && entry.currentAssignmentId && entry.currentAssignmentId !== input.assignmentId) {
			return { released: false, entry: cloneQueenBeeRegistryEntry(entry), reason: "assignment_mismatch" }
		}
		const next: QueenBeeRegistryEntry = {
			...entry,
			availabilityState: "idle",
			currentAssignmentId: null,
			cooldownUntil: null,
		}
		this.entries.set(input.beeId, next)
		this.recordStateChange(
			input.beeId,
			{
				availabilityState: entry.availabilityState,
				currentAssignmentId: entry.currentAssignmentId,
				cooldownUntil: entry.cooldownUntil,
			},
			{
				availabilityState: next.availabilityState,
				currentAssignmentId: next.currentAssignmentId,
				cooldownUntil: next.cooldownUntil,
			},
			source,
		)
		return {
			released: true,
			entry: cloneQueenBeeRegistryEntry(next),
			reason: null,
		}
	}

	handleEnvelope(envelope: QueenBeeEnvelope): QueenBeeEnvelope | null {
		const source: QueenBeeRegistryMutationSource = {
			messageId: envelope.messageId,
			missionId: envelope.missionId,
			assignmentId: envelope.assignmentId,
			timestamp: envelope.timestamp,
			reason: envelope.messageType,
		}
		switch (envelope.messageType) {
			case "registry_lookup_request": {
				const desiredRoleFamily = typeof envelope.payload["desiredRoleFamily"] === "string" ? envelope.payload["desiredRoleFamily"] : ""
				const desiredLanguagePack = typeof envelope.payload["desiredLanguagePack"] === "string" ? envelope.payload["desiredLanguagePack"] : ""
				const query: QueenBeeLookupQuery | null = isQueenBeeRoleFamily(desiredRoleFamily)
					? {
							roleFamily: desiredRoleFamily,
							languagePack: isQueenBeeLanguagePack(desiredLanguagePack) ? desiredLanguagePack : undefined,
							requiredToolFamilies: parseRequiredToolFamilies(envelope.payload["requiredToolFamilies"]),
					  }
					: null
				const lookup = query ? this.lookup(query) : { candidates: [] }
				return buildQueenBeeEnvelope({
					messageId: `${envelope.messageId}:registry_lookup_result`,
					missionId: envelope.missionId,
					assignmentId: envelope.assignmentId,
					senderBeeId: this.registryBeeId,
					recipientBeeId: envelope.senderBeeId,
					messageType: "registry_lookup_result",
					timestamp: envelope.timestamp,
					payload: {
						accepted: query !== null,
						reason: query === null ? "invalid_lookup_request" : null,
						candidateBeeIds: lookup.candidates.map((candidate) => candidate.beeId),
						candidates: lookup.candidates,
					},
				})
			}
			case "bee_reserve_request": {
				const requestedBeeId = typeof envelope.payload["targetBeeId"] === "string" ? envelope.payload["targetBeeId"] : ""
				const assignmentId = typeof envelope.payload["assignmentId"] === "string" ? envelope.payload["assignmentId"] : ""
				const reserveResult =
					isQueenBeeBeeId(requestedBeeId) && assignmentId.trim()
						? this.reserve({ beeId: requestedBeeId, assignmentId: assignmentId.trim() }, source)
						: { reserved: false, entry: null, reason: "invalid_reserve_request" }
				return buildQueenBeeEnvelope({
					messageId: `${envelope.messageId}:bee_reserved`,
					missionId: envelope.missionId,
					assignmentId: assignmentId || envelope.assignmentId,
					senderBeeId: this.registryBeeId,
					recipientBeeId: envelope.senderBeeId,
					messageType: "bee_reserved",
					timestamp: envelope.timestamp,
					payload: {
						reserved: reserveResult.reserved,
						reason: reserveResult.reason,
						entry: reserveResult.entry,
					},
				})
			}
			case "bee_release": {
				const requestedBeeId = typeof envelope.payload["targetBeeId"] === "string" ? envelope.payload["targetBeeId"] : ""
				const assignmentId = typeof envelope.payload["assignmentId"] === "string" ? envelope.payload["assignmentId"] : envelope.assignmentId
				const releaseResult =
					isQueenBeeBeeId(requestedBeeId)
						? this.release(
								{ beeId: requestedBeeId, assignmentId: typeof assignmentId === "string" ? assignmentId : null },
								source,
						  )
						: { released: false, entry: null, reason: "invalid_release_request" }
				return buildQueenBeeEnvelope({
					messageId: `${envelope.messageId}:bee_release`,
					missionId: envelope.missionId,
					assignmentId: typeof assignmentId === "string" ? assignmentId : envelope.assignmentId,
					senderBeeId: this.registryBeeId,
					recipientBeeId: envelope.senderBeeId,
					messageType: "bee_release",
					timestamp: envelope.timestamp,
					payload: {
						released: releaseResult.released,
						reason: releaseResult.reason,
						entry: releaseResult.entry,
					},
				})
			}
			default:
				return null
		}
	}
}
