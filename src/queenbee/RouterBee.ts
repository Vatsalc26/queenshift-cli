import { ArchivistBee } from "./ArchivistBee"
import { JSTSCoderBee } from "./JSTSCoderBee"
import { JSTSReviewerBee } from "./JSTSReviewerBee"
import { MergeBee } from "./MergeBee"
import { PlannerBee } from "./PlannerBee"
import { RecoveryBee } from "./RecoveryBee"
import type { RegistryBee } from "./RegistryBee"
import { ScoutBee } from "./ScoutBee"
import { VerifierBee } from "./VerifierBee"
import {
	buildQueenBeeEnvelope,
	isQueenBeeBeeId,
	snapshotQueenBeeEnvelope,
	type QueenBeeBeeId,
	type QueenBeeBeeType,
	type QueenBeeEnvelope,
	type QueenBeeMessageType,
} from "./QueenBeeProtocol"
import { QueenBeeMessageValidator } from "./QueenBeeMessageValidator"
import { QueenBeeProtocolLedger } from "./QueenBeeProtocolLedger"

export const QUEENBEE_ALLOWED_ROUTE_PAIRS = [
	"QueenBee->RouterBee",
	"RouterBee->RegistryBee",
	"RouterBee->SafetyBee",
	"RouterBee->ScoutBee",
	"RouterBee->PlannerBee",
	"RouterBee->JSTSCoderBee",
	"RouterBee->JSTSReviewerBee",
	"RouterBee->VerifierBee",
	"RouterBee->MergeBee",
	"RouterBee->ArchivistBee",
	"RouterBee->RecoveryBee",
	"RegistryBee->RouterBee",
	"SafetyBee->RouterBee",
	"ScoutBee->RouterBee",
	"PlannerBee->RouterBee",
	"JSTSCoderBee->RouterBee",
	"JSTSReviewerBee->RouterBee",
	"VerifierBee->RouterBee",
	"MergeBee->RouterBee",
	"ArchivistBee->RouterBee",
	"RecoveryBee->RouterBee",
] as const

const IMPLEMENTED_ROUTE_PAIRS = [
	"RouterBee->RegistryBee",
	"RegistryBee->RouterBee",
	"RouterBee->ScoutBee",
	"ScoutBee->RouterBee",
	"RouterBee->PlannerBee",
	"PlannerBee->RouterBee",
	"RouterBee->JSTSCoderBee",
	"JSTSCoderBee->RouterBee",
	"RouterBee->JSTSReviewerBee",
	"JSTSReviewerBee->RouterBee",
	"RouterBee->VerifierBee",
	"VerifierBee->RouterBee",
	"RouterBee->MergeBee",
	"MergeBee->RouterBee",
	"RouterBee->ArchivistBee",
	"ArchivistBee->RouterBee",
	"RouterBee->RecoveryBee",
	"RecoveryBee->RouterBee",
] as const
const ROUTER_TO_REGISTRY_MESSAGE_TYPES = ["registry_lookup_request", "bee_reserve_request", "bee_release"] as const
const REGISTRY_TO_ROUTER_MESSAGE_TYPES = ["registry_lookup_result", "bee_reserved", "bee_release"] as const
const ROUTER_TO_SCOUT_MESSAGE_TYPES = ["scout_request"] as const
const SCOUT_TO_ROUTER_MESSAGE_TYPES = ["scout_result"] as const
const ROUTER_TO_PLANNER_MESSAGE_TYPES = ["plan_request"] as const
const PLANNER_TO_ROUTER_MESSAGE_TYPES = ["plan_result"] as const
const ROUTER_TO_JSTS_CODER_MESSAGE_TYPES = ["assignment_packet"] as const
const JSTS_CODER_TO_ROUTER_MESSAGE_TYPES = ["work_result"] as const
const ROUTER_TO_JSTS_REVIEWER_MESSAGE_TYPES = ["review_request"] as const
const JSTS_REVIEWER_TO_ROUTER_MESSAGE_TYPES = ["review_pass", "review_rework", "review_fail"] as const
const ROUTER_TO_VERIFIER_MESSAGE_TYPES = ["verification_request"] as const
const VERIFIER_TO_ROUTER_MESSAGE_TYPES = ["verification_pass", "verification_fail"] as const
const ROUTER_TO_MERGE_MESSAGE_TYPES = ["merge_request"] as const
const MERGE_TO_ROUTER_MESSAGE_TYPES = ["merge_pass", "merge_blocked"] as const
const ROUTER_TO_ARCHIVIST_MESSAGE_TYPES = ["archive_request"] as const
const ARCHIVIST_TO_ROUTER_MESSAGE_TYPES = ["archive_written"] as const
const ROUTER_TO_RECOVERY_MESSAGE_TYPES = ["recovery_request"] as const
const RECOVERY_TO_ROUTER_MESSAGE_TYPES = ["recovery_plan", "bee_quarantined"] as const

export type QueenBeeRouteStatus = "delivered" | "rejected" | "recipient_runtime_unavailable"

export type QueenBeeRouteResult = {
	status: QueenBeeRouteStatus
	edge: string
	reason: string | null
	responseEnvelope: QueenBeeEnvelope | null
	handledBy: QueenBeeBeeType | null
}

function edgeFor(senderType: QueenBeeBeeType, recipientType: QueenBeeBeeType): string {
	return `${senderType}->${recipientType}`
}

function isMessageTypeAllowedOnEdge(edge: string, messageType: QueenBeeMessageType): boolean {
	if (edge === "RouterBee->RegistryBee") {
		return (ROUTER_TO_REGISTRY_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "RegistryBee->RouterBee") {
		return (REGISTRY_TO_ROUTER_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "RouterBee->ScoutBee") {
		return (ROUTER_TO_SCOUT_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "ScoutBee->RouterBee") {
		return (SCOUT_TO_ROUTER_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "RouterBee->PlannerBee") {
		return (ROUTER_TO_PLANNER_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "PlannerBee->RouterBee") {
		return (PLANNER_TO_ROUTER_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "RouterBee->JSTSCoderBee") {
		return (ROUTER_TO_JSTS_CODER_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "JSTSCoderBee->RouterBee") {
		return (JSTS_CODER_TO_ROUTER_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "RouterBee->JSTSReviewerBee") {
		return (ROUTER_TO_JSTS_REVIEWER_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "JSTSReviewerBee->RouterBee") {
		return (JSTS_REVIEWER_TO_ROUTER_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "RouterBee->VerifierBee") {
		return (ROUTER_TO_VERIFIER_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "VerifierBee->RouterBee") {
		return (VERIFIER_TO_ROUTER_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "RouterBee->MergeBee") {
		return (ROUTER_TO_MERGE_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "MergeBee->RouterBee") {
		return (MERGE_TO_ROUTER_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "RouterBee->ArchivistBee") {
		return (ROUTER_TO_ARCHIVIST_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "ArchivistBee->RouterBee") {
		return (ARCHIVIST_TO_ROUTER_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "RouterBee->RecoveryBee") {
		return (ROUTER_TO_RECOVERY_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	if (edge === "RecoveryBee->RouterBee") {
		return (RECOVERY_TO_ROUTER_MESSAGE_TYPES as readonly string[]).includes(messageType)
	}
	return true
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())))
		: []
}

export class RouterBee {
	private readonly registry: RegistryBee
	private readonly protocolLedger: QueenBeeProtocolLedger
	private readonly messageValidator: QueenBeeMessageValidator
	private readonly scout: ScoutBee | null
	private readonly planner: PlannerBee | null
	private readonly coder: JSTSCoderBee | null
	private readonly reviewer: JSTSReviewerBee | null
	private readonly verifier: VerifierBee | null
	private readonly merge: MergeBee | null
	private readonly archivist: ArchivistBee | null
	private readonly recovery: RecoveryBee | null

	constructor(
		registry: RegistryBee,
		protocolLedger: QueenBeeProtocolLedger = new QueenBeeProtocolLedger(),
		messageValidator: QueenBeeMessageValidator = new QueenBeeMessageValidator(),
		scout: ScoutBee | null = null,
		planner: PlannerBee | null = null,
		coder: JSTSCoderBee | null = null,
		reviewer: JSTSReviewerBee | null = null,
		verifier: VerifierBee | null = null,
		merge: MergeBee | null = null,
		archivist: ArchivistBee | null = null,
		recovery: RecoveryBee | null = null,
	) {
		this.registry = registry
		this.protocolLedger = protocolLedger
		this.messageValidator = messageValidator
		this.scout = scout
		this.planner = planner
		this.coder = coder
		this.reviewer = reviewer
		this.verifier = verifier
		this.merge = merge
		this.archivist = archivist
		this.recovery = recovery
	}

	listAllowedEdges(): string[] {
		return [...QUEENBEE_ALLOWED_ROUTE_PAIRS]
	}

	listImplementedEdges(): string[] {
		return [...IMPLEMENTED_ROUTE_PAIRS]
	}

	relayPlannedAssignment(assignmentPacketInput: unknown): QueenBeeRouteResult {
		const validation = this.messageValidator.validateEnvelope(assignmentPacketInput)
		if (!validation.valid || !validation.envelope) {
			return {
				status: "rejected",
				edge: "PlannerBee->RouterBee",
				reason: validation.reason ?? "invalid_assignment_packet",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		const assignmentPacket = validation.envelope
		const senderEntry = this.registry.getEntry(assignmentPacket.senderBeeId)
		const recipientEntry = this.registry.getEntry(assignmentPacket.recipientBeeId)
		if (!senderEntry || !recipientEntry) {
			return {
				status: "rejected",
				edge: "PlannerBee->RouterBee",
				reason: "unknown_bee",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}
		if (senderEntry.beeType !== "PlannerBee" || recipientEntry.beeType !== "JSTSCoderBee" || assignmentPacket.messageType !== "assignment_packet") {
			return {
				status: "rejected",
				edge: `${senderEntry.beeType}->${recipientEntry.beeType}`,
				reason: "planner_assignment_handoff_invalid",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		const routedAssignment = buildQueenBeeEnvelope({
			messageId: `${assignmentPacket.messageId}:router_delivery`,
			missionId: assignmentPacket.missionId,
			assignmentId: assignmentPacket.assignmentId,
			senderBeeId: "queenbee.router.001",
			recipientBeeId: assignmentPacket.recipientBeeId,
			messageType: "assignment_packet",
			timestamp: assignmentPacket.timestamp,
			requiresAck: assignmentPacket.requiresAck,
			scopeToken: assignmentPacket.scopeToken,
			toolGrantToken: assignmentPacket.toolGrantToken,
			parentMessageId: assignmentPacket.messageId,
			payload: assignmentPacket.payload,
		})

		return this.routeEnvelope(routedAssignment)
	}

	relayCoderWorkResult(workResultInput: unknown): QueenBeeRouteResult {
		const validation = this.messageValidator.validateEnvelope(workResultInput)
		if (!validation.valid || !validation.envelope) {
			return {
				status: "rejected",
				edge: "JSTSCoderBee->RouterBee",
				reason: validation.reason ?? "invalid_work_result",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		const workResult = validation.envelope
		const senderEntry = this.registry.getEntry(workResult.senderBeeId)
		const recipientEntry = this.registry.getEntry(workResult.recipientBeeId)
		if (!senderEntry || !recipientEntry) {
			return {
				status: "rejected",
				edge: "JSTSCoderBee->RouterBee",
				reason: "unknown_bee",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}
		if (senderEntry.beeType !== "JSTSCoderBee" || recipientEntry.beeType !== "RouterBee" || workResult.messageType !== "work_result") {
			return {
				status: "rejected",
				edge: `${senderEntry.beeType}->${recipientEntry.beeType}`,
				reason: "coder_review_handoff_invalid",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		const workPayload = workResult.payload
		const changedFiles = Array.isArray(workPayload["changedFiles"]) ? [...(workPayload["changedFiles"] as string[])] : []
		const proposalCount =
			typeof workPayload["proposalCount"] === "number" && Number.isInteger(workPayload["proposalCount"])
				? (workPayload["proposalCount"] as number)
				: 0
		const proposals = Array.isArray(workPayload["proposals"]) ? [...(workPayload["proposals"] as Array<Record<string, unknown>>)] : []
		const coderSummary = typeof workPayload["coderSummary"] === "string" ? workPayload["coderSummary"] : ""

		const reviewRequest = buildQueenBeeEnvelope({
			messageId: `${workResult.messageId}:review_request`,
			missionId: workResult.missionId,
			assignmentId: workResult.assignmentId,
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_reviewer.001",
			messageType: "review_request",
			timestamp: workResult.timestamp,
			scopeToken: workResult.scopeToken,
			toolGrantToken: workResult.toolGrantToken,
			parentMessageId: workResult.messageId,
			payload: {
				languagePack: "js_ts",
				changedFiles,
				proposalCount,
				proposals,
				coderSummary,
			},
		})

		return this.routeEnvelope(reviewRequest)
	}

	relayReviewVerdictToVerifier(
		reviewVerdictInput: unknown,
		proofCommands: string[] = ["npm.cmd run verify:guardrails"],
		expectedPassSurface = "bounded_guardrail_pack",
	): QueenBeeRouteResult {
		const validation = this.messageValidator.validateEnvelope(reviewVerdictInput)
		if (!validation.valid || !validation.envelope) {
			return {
				status: "rejected",
				edge: "JSTSReviewerBee->RouterBee",
				reason: validation.reason ?? "invalid_review_verdict",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		const reviewVerdict = validation.envelope
		const senderEntry = this.registry.getEntry(reviewVerdict.senderBeeId)
		const recipientEntry = this.registry.getEntry(reviewVerdict.recipientBeeId)
		if (!senderEntry || !recipientEntry) {
			return {
				status: "rejected",
				edge: "JSTSReviewerBee->RouterBee",
				reason: "unknown_bee",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}
		if (senderEntry.beeType !== "JSTSReviewerBee" || recipientEntry.beeType !== "RouterBee") {
			return {
				status: "rejected",
				edge: `${senderEntry.beeType}->${recipientEntry.beeType}`,
				reason: "review_verifier_handoff_invalid",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}
		if (reviewVerdict.messageType !== "review_pass") {
			return {
				status: "rejected",
				edge: "JSTSReviewerBee->RouterBee",
				reason: "review_not_ready_for_verification",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		const reviewPayload = reviewVerdict.payload
		const changedFiles = Array.isArray(reviewPayload["changedFiles"]) ? [...(reviewPayload["changedFiles"] as string[])] : []
		const reviewSummary = typeof reviewPayload["reviewSummary"] === "string" ? reviewPayload["reviewSummary"] : ""

		const verificationRequest = buildQueenBeeEnvelope({
			messageId: `${reviewVerdict.messageId}:verification_request`,
			missionId: reviewVerdict.missionId,
			assignmentId: reviewVerdict.assignmentId,
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.verifier.001",
			messageType: "verification_request",
			timestamp: reviewVerdict.timestamp,
			scopeToken: reviewVerdict.scopeToken,
			toolGrantToken: reviewVerdict.toolGrantToken,
			parentMessageId: reviewVerdict.messageId,
			payload: {
				languagePack: "js_ts",
				changedFiles,
				proofCommands: [...proofCommands],
				reviewSummary,
				expectedPassSurface,
			},
		})

		return this.routeEnvelope(verificationRequest)
	}

	relayVerificationVerdictToMerge(verificationVerdictInput: unknown, workResultInput: unknown): QueenBeeRouteResult {
		const verificationValidation = this.messageValidator.validateEnvelope(verificationVerdictInput)
		if (!verificationValidation.valid || !verificationValidation.envelope) {
			return {
				status: "rejected",
				edge: "VerifierBee->RouterBee",
				reason: verificationValidation.reason ?? "invalid_verification_verdict",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}
		const workResultValidation = this.messageValidator.validateEnvelope(workResultInput)
		if (!workResultValidation.valid || !workResultValidation.envelope) {
			return {
				status: "rejected",
				edge: "JSTSCoderBee->RouterBee",
				reason: workResultValidation.reason ?? "invalid_work_result",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		const verificationVerdict = verificationValidation.envelope
		const workResult = workResultValidation.envelope
		const verificationSender = this.registry.getEntry(verificationVerdict.senderBeeId)
		const verificationRecipient = this.registry.getEntry(verificationVerdict.recipientBeeId)
		const workSender = this.registry.getEntry(workResult.senderBeeId)
		const workRecipient = this.registry.getEntry(workResult.recipientBeeId)
		if (!verificationSender || !verificationRecipient || !workSender || !workRecipient) {
			return {
				status: "rejected",
				edge: "VerifierBee->RouterBee",
				reason: "unknown_bee",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}
		if (
			verificationSender.beeType !== "VerifierBee" ||
			verificationRecipient.beeType !== "RouterBee" ||
			verificationVerdict.messageType !== "verification_pass"
		) {
			return {
				status: "rejected",
				edge: `${verificationSender.beeType}->${verificationRecipient.beeType}`,
				reason: "verification_merge_handoff_invalid",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}
		if (workSender.beeType !== "JSTSCoderBee" || workRecipient.beeType !== "RouterBee" || workResult.messageType !== "work_result") {
			return {
				status: "rejected",
				edge: `${workSender.beeType}->${workRecipient.beeType}`,
				reason: "merge_requires_work_result_context",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		const verificationPayload = verificationVerdict.payload
		const workPayload = workResult.payload
		const changedFiles = Array.isArray(workPayload["changedFiles"]) ? [...(workPayload["changedFiles"] as string[])] : []
		const proposals = Array.isArray(workPayload["proposals"]) ? [...(workPayload["proposals"] as Array<Record<string, unknown>>)] : []
		const proofCommands = Array.isArray(verificationPayload["proofCommands"]) ? [...(verificationPayload["proofCommands"] as string[])] : []
		const verifierSummary = typeof verificationPayload["verifierSummary"] === "string" ? verificationPayload["verifierSummary"] : ""

		const mergeRequest = buildQueenBeeEnvelope({
			messageId: `${verificationVerdict.messageId}:merge_request`,
			missionId: verificationVerdict.missionId,
			assignmentId: verificationVerdict.assignmentId,
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.merge.001",
			messageType: "merge_request",
			timestamp: verificationVerdict.timestamp,
			scopeToken: verificationVerdict.scopeToken,
			toolGrantToken: verificationVerdict.toolGrantToken,
			parentMessageId: verificationVerdict.messageId,
			payload: {
				changedFiles,
				proposals,
				proofCommands,
				verifierSummary,
			},
		})

		return this.routeEnvelope(mergeRequest)
	}

	relayMergeResultToArchivist(mergeResultInput: unknown): QueenBeeRouteResult {
		const validation = this.messageValidator.validateEnvelope(mergeResultInput)
		if (!validation.valid || !validation.envelope) {
			return {
				status: "rejected",
				edge: "MergeBee->RouterBee",
				reason: validation.reason ?? "invalid_merge_result",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		const mergeResult = validation.envelope
		const senderEntry = this.registry.getEntry(mergeResult.senderBeeId)
		const recipientEntry = this.registry.getEntry(mergeResult.recipientBeeId)
		if (!senderEntry || !recipientEntry) {
			return {
				status: "rejected",
				edge: "MergeBee->RouterBee",
				reason: "unknown_bee",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}
		if (senderEntry.beeType !== "MergeBee" || recipientEntry.beeType !== "RouterBee" || mergeResult.messageType !== "merge_pass") {
			return {
				status: "rejected",
				edge: `${senderEntry.beeType}->${recipientEntry.beeType}`,
				reason: "merge_archive_handoff_invalid",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		const mergePayload = mergeResult.payload
		const changedFiles = Array.isArray(mergePayload["changedFiles"]) ? [...(mergePayload["changedFiles"] as string[])] : []
		const proofCommands = Array.isArray(mergePayload["proofCommands"]) ? [...(mergePayload["proofCommands"] as string[])] : []
		const verifierSummary = typeof mergePayload["verifierSummary"] === "string" ? mergePayload["verifierSummary"] : ""
		const mergeSummary = typeof mergePayload["mergeSummary"] === "string" ? mergePayload["mergeSummary"] : ""

		const archiveRequest = buildQueenBeeEnvelope({
			messageId: `${mergeResult.messageId}:archive_request`,
			missionId: mergeResult.missionId,
			assignmentId: mergeResult.assignmentId,
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.archivist.001",
			messageType: "archive_request",
			timestamp: mergeResult.timestamp,
			scopeToken: mergeResult.scopeToken,
			toolGrantToken: mergeResult.toolGrantToken,
			parentMessageId: mergeResult.messageId,
			payload: {
				changedFiles,
				proofCommands,
				verifierSummary,
				mergeSummary,
			},
		})

		return this.routeEnvelope(archiveRequest)
	}

	relayFailureToRecovery(
		failureEnvelopeInput: unknown,
		options: {
			failedBeeId?: QueenBeeBeeId
			retryCount?: number
			artifactRefs?: string[]
		} = {},
	): QueenBeeRouteResult {
		const validation = this.messageValidator.validateEnvelope(failureEnvelopeInput)
		if (!validation.valid || !validation.envelope) {
			return {
				status: "rejected",
				edge: "unknown",
				reason: validation.reason ?? "invalid_failure_envelope",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		const failureEnvelope = validation.envelope
		const senderEntry = this.registry.getEntry(failureEnvelope.senderBeeId)
		const recipientEntry = this.registry.getEntry(failureEnvelope.recipientBeeId)
		if (!senderEntry || !recipientEntry) {
			return {
				status: "rejected",
				edge: "unknown",
				reason: "unknown_bee",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}
		if (recipientEntry.beeType !== "RouterBee") {
			return {
				status: "rejected",
				edge: `${senderEntry.beeType}->${recipientEntry.beeType}`,
				reason: "failure_recovery_handoff_invalid",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		let failureFamily: string
		switch (failureEnvelope.messageType) {
			case "review_fail":
				failureFamily = "review_failure"
				break
			case "verification_fail":
				failureFamily = "verification_failure"
				break
			case "merge_blocked":
				failureFamily = "merge_failure"
				break
			default:
				failureFamily = typeof failureEnvelope.failureCode === "string" ? failureEnvelope.failureCode : "unknown_failure"
				break
		}
		const failureReason =
			typeof failureEnvelope.payload["reason"] === "string"
				? (failureEnvelope.payload["reason"] as string)
				: typeof failureEnvelope.failureCode === "string"
					? failureEnvelope.failureCode
					: "unknown_failure"
		const failedBeeId = options.failedBeeId ?? failureEnvelope.senderBeeId
		const artifactRefs = Array.from(new Set([...(failureEnvelope.artifactRefs ?? []), ...(options.artifactRefs ?? [])]))
		const retryCount = typeof options.retryCount === "number" && Number.isInteger(options.retryCount) && options.retryCount >= 0 ? options.retryCount : 0
		const recoveryRequest = buildQueenBeeEnvelope({
			messageId: `${failureEnvelope.messageId}:recovery_request`,
			missionId: failureEnvelope.missionId,
			assignmentId: failureEnvelope.assignmentId,
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.recovery.001",
			messageType: "recovery_request",
			timestamp: failureEnvelope.timestamp,
			scopeToken: failureEnvelope.scopeToken,
			toolGrantToken: failureEnvelope.toolGrantToken,
			parentMessageId: failureEnvelope.messageId,
			payload: {
				failedBeeId,
				sourceBeeId: failureEnvelope.senderBeeId,
				failureFamily,
				sourceMessageType: failureEnvelope.messageType,
				failureReason,
				retryCount,
				artifactRefs,
				requestSummary: `RouterBee escalated ${failureEnvelope.messageType} from ${failureEnvelope.senderBeeId} for explicit recovery handling.`,
			},
			artifactRefs,
			failureCode: failureFamily,
		})

		return this.routeEnvelope(recoveryRequest)
	}

	private applyRecoveryResponse(envelope: QueenBeeEnvelope): string | null {
		const payload = envelope.payload
		const source = {
			messageId: envelope.messageId,
			missionId: envelope.missionId,
			assignmentId: envelope.assignmentId,
			timestamp: envelope.timestamp,
			reason: envelope.messageType,
		}
		if (envelope.messageType === "recovery_plan") {
			const failedBeeId = typeof payload["failedBeeId"] === "string" ? payload["failedBeeId"] : ""
			const cooldownUntil = typeof payload["cooldownUntil"] === "string" ? payload["cooldownUntil"] : ""
			if (!isQueenBeeBeeId(failedBeeId) || !cooldownUntil.trim()) {
				return "recovery_plan_missing_cooldown_target"
			}
			this.registry.setCoolingOff(failedBeeId, cooldownUntil.trim(), source)
			return null
		}
		if (envelope.messageType === "bee_quarantined") {
			const failedBeeId = typeof payload["failedBeeId"] === "string" ? payload["failedBeeId"] : ""
			const quarantineReason = typeof payload["quarantineReason"] === "string" ? payload["quarantineReason"] : ""
			if (!isQueenBeeBeeId(failedBeeId) || !quarantineReason.trim()) {
				return "bee_quarantined_missing_target"
			}
			this.registry.quarantine(failedBeeId, quarantineReason.trim(), source)
			return null
		}
		return "recovery_response_message_type_invalid"
	}

	routeEnvelope(envelopeInput: unknown): QueenBeeRouteResult {
		const validation = this.messageValidator.validateEnvelope(envelopeInput)
		this.protocolLedger.recordValidation({
			snapshot: validation.snapshot,
			status: validation.valid ? "accepted" : "rejected",
			reason: validation.reason,
			stage: "incoming",
			details: validation.details,
		})
		if (!validation.valid || !validation.envelope) {
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge: "unknown",
				status: "rejected",
				reason: validation.reason ?? "invalid_message",
				handledBy: "RouterBee",
			})
			return {
				status: "rejected",
				edge: "unknown",
				reason: validation.reason ?? "invalid_message",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		const envelope = validation.envelope
		const senderEntry = this.registry.getEntry(envelope.senderBeeId)
		const recipientEntry = this.registry.getEntry(envelope.recipientBeeId)
		if (!senderEntry || !recipientEntry) {
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge: "unknown",
				status: "rejected",
				reason: "unknown_bee",
				handledBy: "RouterBee",
			})
			return {
				status: "rejected",
				edge: "unknown",
				reason: "unknown_bee",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		const edge = edgeFor(senderEntry.beeType, recipientEntry.beeType)
		if (!(QUEENBEE_ALLOWED_ROUTE_PAIRS as readonly string[]).includes(edge)) {
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "rejected",
				reason: "edge_not_allowed",
				handledBy: "RouterBee",
			})
			return {
				status: "rejected",
				edge,
				reason: "edge_not_allowed",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		if (!isMessageTypeAllowedOnEdge(edge, envelope.messageType)) {
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "rejected",
				reason: "message_type_not_allowed_on_edge",
				handledBy: "RouterBee",
			})
			return {
				status: "rejected",
				edge,
				reason: "message_type_not_allowed_on_edge",
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		if (edge === "RouterBee->RegistryBee") {
			const responseEnvelope = this.registry.handleEnvelope(envelope)
			if (!responseEnvelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "registry_handler_missing_response",
					handledBy: "RegistryBee",
				})
				return {
					status: "rejected",
					edge,
					reason: "registry_handler_missing_response",
					responseEnvelope: null,
					handledBy: "RegistryBee",
				}
			}
			const responseValidation = this.messageValidator.validateEnvelope(responseEnvelope)
			this.protocolLedger.recordValidation({
				snapshot: responseValidation.snapshot,
				status: responseValidation.valid ? "accepted" : "rejected",
				reason: responseValidation.reason,
				stage: "response",
				details: responseValidation.details,
			})
			if (!responseValidation.valid || !responseValidation.envelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: responseValidation.reason ?? "registry_response_invalid",
					handledBy: "RegistryBee",
					responseSnapshot: responseValidation.snapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: responseValidation.reason ?? "registry_response_invalid",
					responseEnvelope: null,
					handledBy: "RegistryBee",
				}
			}

			const responseSnapshot = snapshotQueenBeeEnvelope(responseValidation.envelope)
			const validatedResponseEnvelope = responseValidation.envelope
			const responseSender = this.registry.getEntry(validatedResponseEnvelope.senderBeeId)
			const responseRecipient = this.registry.getEntry(validatedResponseEnvelope.recipientBeeId)
			const responseEdge =
				responseSender && responseRecipient ? edgeFor(responseSender.beeType, responseRecipient.beeType) : "unknown"
			if (
				responseEdge !== "RegistryBee->RouterBee" ||
				!isMessageTypeAllowedOnEdge(responseEdge, validatedResponseEnvelope.messageType)
			) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "registry_response_edge_invalid",
					handledBy: "RegistryBee",
					responseSnapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: "registry_response_edge_invalid",
					responseEnvelope: validatedResponseEnvelope,
					handledBy: "RegistryBee",
				}
			}
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "RegistryBee",
				responseSnapshot,
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: validatedResponseEnvelope,
				handledBy: "RegistryBee",
			}
		}

		if (edge === "RegistryBee->RouterBee") {
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "RouterBee",
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		if (edge === "RouterBee->ScoutBee") {
			const responseEnvelope = this.scout?.handleEnvelope(envelope) ?? null
			if (!responseEnvelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "scout_handler_missing_response",
					handledBy: "ScoutBee",
				})
				return {
					status: "rejected",
					edge,
					reason: "scout_handler_missing_response",
					responseEnvelope: null,
					handledBy: "ScoutBee",
				}
			}

			const responseValidation = this.messageValidator.validateEnvelope(responseEnvelope)
			this.protocolLedger.recordValidation({
				snapshot: responseValidation.snapshot,
				status: responseValidation.valid ? "accepted" : "rejected",
				reason: responseValidation.reason,
				stage: "response",
				details: responseValidation.details,
			})
			if (!responseValidation.valid || !responseValidation.envelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: responseValidation.reason ?? "scout_response_invalid",
					handledBy: "ScoutBee",
					responseSnapshot: responseValidation.snapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: responseValidation.reason ?? "scout_response_invalid",
					responseEnvelope: null,
					handledBy: "ScoutBee",
				}
			}

			const responseSnapshot = snapshotQueenBeeEnvelope(responseValidation.envelope)
			const validatedResponseEnvelope = responseValidation.envelope
			const responseSender = this.registry.getEntry(validatedResponseEnvelope.senderBeeId)
			const responseRecipient = this.registry.getEntry(validatedResponseEnvelope.recipientBeeId)
			const responseEdge =
				responseSender && responseRecipient ? edgeFor(responseSender.beeType, responseRecipient.beeType) : "unknown"
			if (
				responseEdge !== "ScoutBee->RouterBee" ||
				!isMessageTypeAllowedOnEdge(responseEdge, validatedResponseEnvelope.messageType)
			) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "scout_response_edge_invalid",
					handledBy: "ScoutBee",
					responseSnapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: "scout_response_edge_invalid",
					responseEnvelope: validatedResponseEnvelope,
					handledBy: "ScoutBee",
				}
			}

			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "ScoutBee",
				responseSnapshot,
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: validatedResponseEnvelope,
				handledBy: "ScoutBee",
			}
		}

		if (edge === "ScoutBee->RouterBee") {
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "RouterBee",
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		if (edge === "RouterBee->PlannerBee") {
			const responseEnvelope = this.planner?.handleEnvelope(envelope) ?? null
			if (!responseEnvelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "planner_handler_missing_response",
					handledBy: "PlannerBee",
				})
				return {
					status: "rejected",
					edge,
					reason: "planner_handler_missing_response",
					responseEnvelope: null,
					handledBy: "PlannerBee",
				}
			}

			const responseValidation = this.messageValidator.validateEnvelope(responseEnvelope)
			this.protocolLedger.recordValidation({
				snapshot: responseValidation.snapshot,
				status: responseValidation.valid ? "accepted" : "rejected",
				reason: responseValidation.reason,
				stage: "response",
				details: responseValidation.details,
			})
			if (!responseValidation.valid || !responseValidation.envelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: responseValidation.reason ?? "planner_response_invalid",
					handledBy: "PlannerBee",
					responseSnapshot: responseValidation.snapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: responseValidation.reason ?? "planner_response_invalid",
					responseEnvelope: null,
					handledBy: "PlannerBee",
				}
			}

			const responseSnapshot = snapshotQueenBeeEnvelope(responseValidation.envelope)
			const validatedResponseEnvelope = responseValidation.envelope
			const responseSender = this.registry.getEntry(validatedResponseEnvelope.senderBeeId)
			const responseRecipient = this.registry.getEntry(validatedResponseEnvelope.recipientBeeId)
			const responseEdge =
				responseSender && responseRecipient ? edgeFor(responseSender.beeType, responseRecipient.beeType) : "unknown"
			if (
				responseEdge !== "PlannerBee->RouterBee" ||
				!isMessageTypeAllowedOnEdge(responseEdge, validatedResponseEnvelope.messageType)
			) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "planner_response_edge_invalid",
					handledBy: "PlannerBee",
					responseSnapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: "planner_response_edge_invalid",
					responseEnvelope: validatedResponseEnvelope,
					handledBy: "PlannerBee",
				}
			}

			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "PlannerBee",
				responseSnapshot,
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: validatedResponseEnvelope,
				handledBy: "PlannerBee",
			}
		}

		if (edge === "PlannerBee->RouterBee") {
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "RouterBee",
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		if (edge === "RouterBee->JSTSCoderBee") {
			const responseEnvelope = this.coder?.handleEnvelope(envelope) ?? null
			if (!responseEnvelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "coder_handler_missing_response",
					handledBy: "JSTSCoderBee",
				})
				return {
					status: "rejected",
					edge,
					reason: "coder_handler_missing_response",
					responseEnvelope: null,
					handledBy: "JSTSCoderBee",
				}
			}

			const responseValidation = this.messageValidator.validateEnvelope(responseEnvelope)
			this.protocolLedger.recordValidation({
				snapshot: responseValidation.snapshot,
				status: responseValidation.valid ? "accepted" : "rejected",
				reason: responseValidation.reason,
				stage: "response",
				details: responseValidation.details,
			})
			if (!responseValidation.valid || !responseValidation.envelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: responseValidation.reason ?? "coder_response_invalid",
					handledBy: "JSTSCoderBee",
					responseSnapshot: responseValidation.snapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: responseValidation.reason ?? "coder_response_invalid",
					responseEnvelope: null,
					handledBy: "JSTSCoderBee",
				}
			}

			const responseSnapshot = snapshotQueenBeeEnvelope(responseValidation.envelope)
			const validatedResponseEnvelope = responseValidation.envelope
			const responseSender = this.registry.getEntry(validatedResponseEnvelope.senderBeeId)
			const responseRecipient = this.registry.getEntry(validatedResponseEnvelope.recipientBeeId)
			const responseEdge =
				responseSender && responseRecipient ? edgeFor(responseSender.beeType, responseRecipient.beeType) : "unknown"
			if (
				responseEdge !== "JSTSCoderBee->RouterBee" ||
				!isMessageTypeAllowedOnEdge(responseEdge, validatedResponseEnvelope.messageType)
			) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "coder_response_edge_invalid",
					handledBy: "JSTSCoderBee",
					responseSnapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: "coder_response_edge_invalid",
					responseEnvelope: validatedResponseEnvelope,
					handledBy: "JSTSCoderBee",
				}
			}

			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "JSTSCoderBee",
				responseSnapshot,
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: validatedResponseEnvelope,
				handledBy: "JSTSCoderBee",
			}
		}

		if (edge === "JSTSCoderBee->RouterBee") {
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "RouterBee",
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		if (edge === "RouterBee->JSTSReviewerBee") {
			const responseEnvelope = this.reviewer?.handleEnvelope(envelope) ?? null
			if (!responseEnvelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "reviewer_handler_missing_response",
					handledBy: "JSTSReviewerBee",
				})
				return {
					status: "rejected",
					edge,
					reason: "reviewer_handler_missing_response",
					responseEnvelope: null,
					handledBy: "JSTSReviewerBee",
				}
			}

			const responseValidation = this.messageValidator.validateEnvelope(responseEnvelope)
			this.protocolLedger.recordValidation({
				snapshot: responseValidation.snapshot,
				status: responseValidation.valid ? "accepted" : "rejected",
				reason: responseValidation.reason,
				stage: "response",
				details: responseValidation.details,
			})
			if (!responseValidation.valid || !responseValidation.envelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: responseValidation.reason ?? "reviewer_response_invalid",
					handledBy: "JSTSReviewerBee",
					responseSnapshot: responseValidation.snapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: responseValidation.reason ?? "reviewer_response_invalid",
					responseEnvelope: null,
					handledBy: "JSTSReviewerBee",
				}
			}

			const responseSnapshot = snapshotQueenBeeEnvelope(responseValidation.envelope)
			const validatedResponseEnvelope = responseValidation.envelope
			const responseSender = this.registry.getEntry(validatedResponseEnvelope.senderBeeId)
			const responseRecipient = this.registry.getEntry(validatedResponseEnvelope.recipientBeeId)
			const responseEdge =
				responseSender && responseRecipient ? edgeFor(responseSender.beeType, responseRecipient.beeType) : "unknown"
			if (
				responseEdge !== "JSTSReviewerBee->RouterBee" ||
				!isMessageTypeAllowedOnEdge(responseEdge, validatedResponseEnvelope.messageType)
			) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "reviewer_response_edge_invalid",
					handledBy: "JSTSReviewerBee",
					responseSnapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: "reviewer_response_edge_invalid",
					responseEnvelope: validatedResponseEnvelope,
					handledBy: "JSTSReviewerBee",
				}
			}

			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "JSTSReviewerBee",
				responseSnapshot,
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: validatedResponseEnvelope,
				handledBy: "JSTSReviewerBee",
			}
		}

		if (edge === "JSTSReviewerBee->RouterBee") {
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "RouterBee",
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		if (edge === "RouterBee->VerifierBee") {
			const responseEnvelope = this.verifier?.handleEnvelope(envelope) ?? null
			if (!responseEnvelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "verifier_handler_missing_response",
					handledBy: "VerifierBee",
				})
				return {
					status: "rejected",
					edge,
					reason: "verifier_handler_missing_response",
					responseEnvelope: null,
					handledBy: "VerifierBee",
				}
			}

			const responseValidation = this.messageValidator.validateEnvelope(responseEnvelope)
			this.protocolLedger.recordValidation({
				snapshot: responseValidation.snapshot,
				status: responseValidation.valid ? "accepted" : "rejected",
				reason: responseValidation.reason,
				stage: "response",
				details: responseValidation.details,
			})
			if (!responseValidation.valid || !responseValidation.envelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: responseValidation.reason ?? "verifier_response_invalid",
					handledBy: "VerifierBee",
					responseSnapshot: responseValidation.snapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: responseValidation.reason ?? "verifier_response_invalid",
					responseEnvelope: null,
					handledBy: "VerifierBee",
				}
			}

			const responseSnapshot = snapshotQueenBeeEnvelope(responseValidation.envelope)
			const validatedResponseEnvelope = responseValidation.envelope
			const responseSender = this.registry.getEntry(validatedResponseEnvelope.senderBeeId)
			const responseRecipient = this.registry.getEntry(validatedResponseEnvelope.recipientBeeId)
			const responseEdge =
				responseSender && responseRecipient ? edgeFor(responseSender.beeType, responseRecipient.beeType) : "unknown"
			if (
				responseEdge !== "VerifierBee->RouterBee" ||
				!isMessageTypeAllowedOnEdge(responseEdge, validatedResponseEnvelope.messageType)
			) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "verifier_response_edge_invalid",
					handledBy: "VerifierBee",
					responseSnapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: "verifier_response_edge_invalid",
					responseEnvelope: validatedResponseEnvelope,
					handledBy: "VerifierBee",
				}
			}

			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "VerifierBee",
				responseSnapshot,
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: validatedResponseEnvelope,
				handledBy: "VerifierBee",
			}
		}

		if (edge === "VerifierBee->RouterBee") {
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "RouterBee",
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		if (edge === "RouterBee->MergeBee") {
			const responseEnvelope = this.merge?.handleEnvelope(envelope) ?? null
			if (!responseEnvelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "merge_handler_missing_response",
					handledBy: "MergeBee",
				})
				return {
					status: "rejected",
					edge,
					reason: "merge_handler_missing_response",
					responseEnvelope: null,
					handledBy: "MergeBee",
				}
			}

			const responseValidation = this.messageValidator.validateEnvelope(responseEnvelope)
			this.protocolLedger.recordValidation({
				snapshot: responseValidation.snapshot,
				status: responseValidation.valid ? "accepted" : "rejected",
				reason: responseValidation.reason,
				stage: "response",
				details: responseValidation.details,
			})
			if (!responseValidation.valid || !responseValidation.envelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: responseValidation.reason ?? "merge_response_invalid",
					handledBy: "MergeBee",
					responseSnapshot: responseValidation.snapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: responseValidation.reason ?? "merge_response_invalid",
					responseEnvelope: null,
					handledBy: "MergeBee",
				}
			}

			const responseSnapshot = snapshotQueenBeeEnvelope(responseValidation.envelope)
			const validatedResponseEnvelope = responseValidation.envelope
			const responseSender = this.registry.getEntry(validatedResponseEnvelope.senderBeeId)
			const responseRecipient = this.registry.getEntry(validatedResponseEnvelope.recipientBeeId)
			const responseEdge =
				responseSender && responseRecipient ? edgeFor(responseSender.beeType, responseRecipient.beeType) : "unknown"
			if (
				responseEdge !== "MergeBee->RouterBee" ||
				!isMessageTypeAllowedOnEdge(responseEdge, validatedResponseEnvelope.messageType)
			) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "merge_response_edge_invalid",
					handledBy: "MergeBee",
					responseSnapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: "merge_response_edge_invalid",
					responseEnvelope: validatedResponseEnvelope,
					handledBy: "MergeBee",
				}
			}

			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "MergeBee",
				responseSnapshot,
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: validatedResponseEnvelope,
				handledBy: "MergeBee",
			}
		}

		if (edge === "MergeBee->RouterBee") {
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "RouterBee",
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		if (edge === "RouterBee->ArchivistBee") {
			const responseEnvelope = this.archivist?.handleEnvelope(envelope) ?? null
			if (!responseEnvelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "archivist_handler_missing_response",
					handledBy: "ArchivistBee",
				})
				return {
					status: "rejected",
					edge,
					reason: "archivist_handler_missing_response",
					responseEnvelope: null,
					handledBy: "ArchivistBee",
				}
			}

			const responseValidation = this.messageValidator.validateEnvelope(responseEnvelope)
			this.protocolLedger.recordValidation({
				snapshot: responseValidation.snapshot,
				status: responseValidation.valid ? "accepted" : "rejected",
				reason: responseValidation.reason,
				stage: "response",
				details: responseValidation.details,
			})
			if (!responseValidation.valid || !responseValidation.envelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: responseValidation.reason ?? "archivist_response_invalid",
					handledBy: "ArchivistBee",
					responseSnapshot: responseValidation.snapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: responseValidation.reason ?? "archivist_response_invalid",
					responseEnvelope: null,
					handledBy: "ArchivistBee",
				}
			}

			const responseSnapshot = snapshotQueenBeeEnvelope(responseValidation.envelope)
			const validatedResponseEnvelope = responseValidation.envelope
			const responseSender = this.registry.getEntry(validatedResponseEnvelope.senderBeeId)
			const responseRecipient = this.registry.getEntry(validatedResponseEnvelope.recipientBeeId)
			const responseEdge =
				responseSender && responseRecipient ? edgeFor(responseSender.beeType, responseRecipient.beeType) : "unknown"
			if (
				responseEdge !== "ArchivistBee->RouterBee" ||
				!isMessageTypeAllowedOnEdge(responseEdge, validatedResponseEnvelope.messageType)
			) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "archivist_response_edge_invalid",
					handledBy: "ArchivistBee",
					responseSnapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: "archivist_response_edge_invalid",
					responseEnvelope: validatedResponseEnvelope,
					handledBy: "ArchivistBee",
				}
			}

			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "ArchivistBee",
				responseSnapshot,
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: validatedResponseEnvelope,
				handledBy: "ArchivistBee",
			}
		}

		if (edge === "ArchivistBee->RouterBee") {
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "RouterBee",
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		if (edge === "RouterBee->RecoveryBee") {
			const responseEnvelope = this.recovery?.handleEnvelope(envelope) ?? null
			if (!responseEnvelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "recovery_handler_missing_response",
					handledBy: "RecoveryBee",
				})
				return {
					status: "rejected",
					edge,
					reason: "recovery_handler_missing_response",
					responseEnvelope: null,
					handledBy: "RecoveryBee",
				}
			}

			const responseValidation = this.messageValidator.validateEnvelope(responseEnvelope)
			this.protocolLedger.recordValidation({
				snapshot: responseValidation.snapshot,
				status: responseValidation.valid ? "accepted" : "rejected",
				reason: responseValidation.reason,
				stage: "response",
				details: responseValidation.details,
			})
			if (!responseValidation.valid || !responseValidation.envelope) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: responseValidation.reason ?? "recovery_response_invalid",
					handledBy: "RecoveryBee",
					responseSnapshot: responseValidation.snapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: responseValidation.reason ?? "recovery_response_invalid",
					responseEnvelope: null,
					handledBy: "RecoveryBee",
				}
			}

			const responseSnapshot = snapshotQueenBeeEnvelope(responseValidation.envelope)
			const validatedResponseEnvelope = responseValidation.envelope
			const responseSender = this.registry.getEntry(validatedResponseEnvelope.senderBeeId)
			const responseRecipient = this.registry.getEntry(validatedResponseEnvelope.recipientBeeId)
			const responseEdge =
				responseSender && responseRecipient ? edgeFor(responseSender.beeType, responseRecipient.beeType) : "unknown"
			if (
				responseEdge !== "RecoveryBee->RouterBee" ||
				!isMessageTypeAllowedOnEdge(responseEdge, validatedResponseEnvelope.messageType)
			) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: "recovery_response_edge_invalid",
					handledBy: "RecoveryBee",
					responseSnapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: "recovery_response_edge_invalid",
					responseEnvelope: validatedResponseEnvelope,
					handledBy: "RecoveryBee",
				}
			}

			const mutationReason = this.applyRecoveryResponse(validatedResponseEnvelope)
			if (mutationReason) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: mutationReason,
					handledBy: "RouterBee",
					responseSnapshot,
				})
				return {
					status: "rejected",
					edge,
					reason: mutationReason,
					responseEnvelope: validatedResponseEnvelope,
					handledBy: "RouterBee",
				}
			}

			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "RecoveryBee",
				responseSnapshot,
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: validatedResponseEnvelope,
				handledBy: "RecoveryBee",
			}
		}

		if (edge === "RecoveryBee->RouterBee") {
			const mutationReason = this.applyRecoveryResponse(envelope)
			if (mutationReason) {
				this.protocolLedger.recordRoute({
					snapshot: validation.snapshot,
					edge,
					status: "rejected",
					reason: mutationReason,
					handledBy: "RouterBee",
				})
				return {
					status: "rejected",
					edge,
					reason: mutationReason,
					responseEnvelope: null,
					handledBy: "RouterBee",
				}
			}
			this.protocolLedger.recordRoute({
				snapshot: validation.snapshot,
				edge,
				status: "delivered",
				reason: null,
				handledBy: "RouterBee",
			})
			return {
				status: "delivered",
				edge,
				reason: null,
				responseEnvelope: null,
				handledBy: "RouterBee",
			}
		}

		this.protocolLedger.recordRoute({
			snapshot: validation.snapshot,
			edge,
			status: "recipient_runtime_unavailable",
			reason: "recipient_runtime_unavailable",
			handledBy: null,
		})
		return {
			status: "recipient_runtime_unavailable",
			edge,
			reason: "recipient_runtime_unavailable",
			responseEnvelope: null,
			handledBy: null,
		}
	}
}
