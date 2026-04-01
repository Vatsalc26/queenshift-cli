import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import type { QueenBeeVerifierExecutor } from "../src/queenbee/VerifierBee"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeRouterHarnessResult = {
	routerDocsPresent: boolean
	routeTableAligned: boolean
	implementedEdgesScoped: boolean
	registryLookupDelivered: boolean
	plannerPlanDelivered: boolean
	coderWorkDelivered: boolean
	coreSpecialistVisible: boolean
	reviewVerdictDelivered: boolean
	verificationDelivered: boolean
	mergeDelivered: boolean
	archiveWritten: boolean
	recoveryDelivered: boolean
	forbiddenDirectEdgeRejected: boolean
	messageTypeBoundaryEnforced: boolean
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

function sameOrderedList(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index])
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

export async function runQueenBeeRouterHarness(rootDir = resolveRootDir()): Promise<QueenBeeRouterHarnessResult> {
	const details: string[] = []
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const wiringMapText = readText(rootDir, "WIRING_MAP.md")
	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-router")
	try {
		const verifierExecutor: QueenBeeVerifierExecutor = ({ command }) => ({
			command,
			exitCode: command === "npm.cmd run verify:guardrails" ? 0 : 1,
			passed: command === "npm.cmd run verify:guardrails",
			outputSummary: command === "npm.cmd run verify:guardrails" ? "guardrails PASS" : "router stub failure",
		})
		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath, verifierExecutor })

		const expectedEdges = [
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
		]

		const routerDocsPresent =
			includesAll(protocolMapText, [
				"## Session 188 Runtime Skeleton",
				"## Session 191 Runtime Planner",
				"## Session 192 Runtime Scout And Reservation",
				"## Session 193 Runtime Coder",
				"## Session 194 Runtime Reviewer",
				"## Session 195 Runtime Verifier",
				"## Session 196 Runtime Completion",
				"## Session 198 Runtime Recovery",
				"## Session 208 Core Specialist Runtime",
				"`verify:queenbee:router`",
				"`verify:queenbee:jsts:core`",
				"`RouterBee -> RegistryBee`",
				"`RouterBee -> ScoutBee`",
				"`RouterBee -> PlannerBee`",
				"`RouterBee -> JSTSCoderBee`",
				"`RouterBee -> JSTSReviewerBee`",
				"`RouterBee -> VerifierBee`",
				"`RouterBee -> MergeBee`",
				"`RouterBee -> ArchivistBee`",
				"`RouterBee -> RecoveryBee`",
				"`RecoveryBee -> RouterBee`",
				"`recipient_runtime_unavailable`",
			]) &&
			includesAll(messageSchemaText, [
				"## Session 188 Runtime Shell",
				"## Session 191 Planner Shell",
				"## Session 192 Scout And Reservation Shell",
				"## Session 193 One-File Coder Shell",
				"## Session 194 Reviewer Verdict Shell",
				"## Session 195 Verification Shell",
				"## Session 196 Completion Shell",
				"## Session 198 Recovery Shell",
				"`registry_lookup_request`",
				"`bee_reserve_request`",
				"`bee_release`",
				"`scout_request`",
				"`scout_result`",
				"`plan_request`",
				"`plan_result`",
				"`work_result`",
				"`review_request`",
				"`review_pass`",
				"`verification_request`",
				"`verification_pass`",
				"`merge_request`",
				"`merge_pass`",
				"`archive_request`",
				"`archive_written`",
				"`recovery_request`",
				"`recovery_plan`",
				"`bee_quarantined`",
			]) &&
			includesAll(architectureText, [
				"## Decision: QueenBee shell starts with deterministic RouterBee and RegistryBee runtimes",
				"## Decision: QueenBee one-file JSTSCoderBee stays assignment-scoped and proposal-first",
				"## Decision: QueenBee JSTSReviewerBee returns explicit pass, rework, or fail verdicts",
				"## Decision: QueenBee VerifierBee dispatches bounded proof requests through protocol",
				"## Decision: QueenBee completion stays drift-aware, one-file, and artifact-backed",
				"## Decision: QueenBee RecoveryBee makes cooldown and quarantine explicit without inventing a QueenBee return edge",
				"## Decision: Session 208 makes JSTSCoreBee the first live specialist behind the bounded coder route slot",
			]) &&
			includesAll(wiringMapText, [
				"`JSTSCoderBee` route slot now delegates to `JSTSCoreBee`, `JSTSAsyncBee`, `JSTSNodeBee`, `JSTSTestBee`, or `JSTSRefactorBee`",
				"JSTSCoderBee.handleEnvelope() -> selected specialist codeAssignment()",
				"Route audit reaffirmed through Session 269",
			])

		const routeTableAligned = sameOrderedList(shell.router.listAllowedEdges(), expectedEdges)
		const implementedEdgesScoped = sameOrderedList(shell.router.listImplementedEdges(), [
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
		])

		const lookupEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-router-lookup",
			missionId: "mission-router-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "registry_lookup_request",
			timestamp: "2026-03-26T12:00:00Z",
			payload: {
				desiredRoleFamily: "coder",
				desiredLanguagePack: "js_ts",
				requiredToolFamilies: ["repo_edit"],
			},
		})
		const lookupResult = shell.router.routeEnvelope(lookupEnvelope)
		const lookupPayload = lookupResult.responseEnvelope?.payload ?? {}
		const candidateBeeIds = Array.isArray(lookupPayload["candidateBeeIds"]) ? (lookupPayload["candidateBeeIds"] as string[]) : []
		const reservedBeeId = candidateBeeIds[0] ?? ""
		const registryLookupDelivered =
			lookupResult.status === "delivered" &&
			lookupResult.edge === "RouterBee->RegistryBee" &&
			lookupResult.responseEnvelope?.messageType === "registry_lookup_result" &&
			sameOrderedList(candidateBeeIds, ["queenbee.jsts_coder.001"])

		const scoutEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-router-scout",
			missionId: "mission-router-scout-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.scout.001",
			messageType: "scout_request",
			timestamp: "2026-03-26T12:00:30Z",
			payload: {
				task: "Update hello.ts",
				workspace: fixture.repoPath,
				targetFiles: ["hello.ts"],
				languagePack: "js_ts",
			},
		})
		const scoutResult = shell.router.routeEnvelope(scoutEnvelope)
		const scoutPayload = scoutResult.responseEnvelope?.payload ?? {}
		const scoutDelivered =
			scoutResult.status === "delivered" &&
			scoutResult.edge === "RouterBee->ScoutBee" &&
			scoutResult.responseEnvelope?.messageType === "scout_result" &&
			scoutPayload["accepted"] === true

		const reserveEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-router-reserve",
			missionId: "mission-router-plan-1",
			assignmentId: "assign-router-plan-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "bee_reserve_request",
			timestamp: "2026-03-26T12:00:45Z",
			payload: {
				targetBeeId: reservedBeeId,
				assignmentId: "assign-router-plan-1",
			},
		})
		const reserveResult = shell.router.routeEnvelope(reserveEnvelope)
		const reservePayload = reserveResult.responseEnvelope?.payload ?? {}

		const planEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-router-plan",
			missionId: "mission-router-plan-1",
			assignmentId: "assign-router-plan-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-26T12:01:00Z",
			payload: {
				task: 'add the exact comment "// queenbee: router" to hello.ts',
				taskFamily: "comment_file",
				targetFiles: ["hello.ts"],
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
				reservedBeeId,
			},
		})
		const planResult = shell.router.routeEnvelope(planEnvelope)
		const planPayload = planResult.responseEnvelope?.payload ?? {}
		const assignmentPacket = readFirstAssignmentPacket(planResult.responseEnvelope)
		const plannerPlanDelivered =
			planResult.status === "delivered" &&
			planResult.edge === "RouterBee->PlannerBee" &&
			planResult.responseEnvelope?.messageType === "plan_result" &&
			planPayload["accepted"] === true &&
			asRecord(reservePayload)?.["reserved"] === true &&
			assignmentPacket?.senderBeeId === "queenbee.planner.001"

		const coderResult = assignmentPacket ? shell.router.relayPlannedAssignment(assignmentPacket) : null
		const coderPayload = coderResult?.responseEnvelope?.payload ?? {}
		const coderWorkDelivered =
			scoutDelivered &&
			coderResult?.status === "delivered" &&
			coderResult.edge === "RouterBee->JSTSCoderBee" &&
			coderResult.responseEnvelope?.messageType === "work_result" &&
			coderPayload["accepted"] === true
		const coreSpecialistVisible =
			typeof coderPayload["coderSummary"] === "string" && String(coderPayload["coderSummary"]).includes("JSTSCoreBee")
		const reviewResult = coderResult?.responseEnvelope ? shell.router.relayCoderWorkResult(coderResult.responseEnvelope) : null
		const reviewPayload = reviewResult?.responseEnvelope?.payload ?? {}
		const reviewVerdictDelivered =
			reviewResult?.status === "delivered" &&
			reviewResult.edge === "RouterBee->JSTSReviewerBee" &&
			reviewResult.responseEnvelope?.messageType === "review_pass" &&
			reviewPayload["accepted"] === true
		const verificationResult =
			reviewResult?.responseEnvelope
				? shell.router.relayReviewVerdictToVerifier(
						reviewResult.responseEnvelope,
						["npm.cmd run verify:guardrails"],
						"router_guardrail_pack",
				  )
				: null
		const verificationPayload = verificationResult?.responseEnvelope?.payload ?? {}
		const verificationDelivered =
			verificationResult?.status === "delivered" &&
			verificationResult.edge === "RouterBee->VerifierBee" &&
			verificationResult.responseEnvelope?.messageType === "verification_pass" &&
			verificationPayload["accepted"] === true
		const mergeResult =
			verificationResult?.responseEnvelope && coderResult?.responseEnvelope
				? shell.router.relayVerificationVerdictToMerge(verificationResult.responseEnvelope, coderResult.responseEnvelope)
				: null
		const mergePayload = mergeResult?.responseEnvelope?.payload ?? {}
		const mergeDelivered =
			mergeResult?.status === "delivered" &&
			mergeResult.edge === "RouterBee->MergeBee" &&
			mergeResult.responseEnvelope?.messageType === "merge_pass" &&
			mergePayload["accepted"] === true
		const archiveResult = mergeResult?.responseEnvelope ? shell.router.relayMergeResultToArchivist(mergeResult.responseEnvelope) : null
		const archivePayload = archiveResult?.responseEnvelope?.payload ?? {}
		const archiveWritten =
			archiveResult?.status === "delivered" &&
			archiveResult.edge === "RouterBee->ArchivistBee" &&
			archiveResult.responseEnvelope?.messageType === "archive_written" &&
			typeof archivePayload["archivePath"] === "string"
		const recoverySeed = buildQueenBeeEnvelope({
			messageId: "msg-router-recovery",
			missionId: "mission-router-recovery-1",
			assignmentId: "assign-router-recovery-1",
			senderBeeId: "queenbee.merge.001",
			recipientBeeId: "queenbee.router.001",
			messageType: "merge_blocked",
			timestamp: "2026-03-26T12:03:00Z",
			failureCode: "merge_failure",
			payload: {
				accepted: false,
				reason: "workspace_drift_detected",
				changedFiles: ["hello.ts"],
				proofCommands: ["npm.cmd run verify:guardrails"],
				verifierSummary: "VerifierBee passed before the synthetic drift.",
				mergeSummary: "MergeBee refused to merge the drifted workspace.",
			},
		})
		const recoveryResult = shell.router.relayFailureToRecovery(recoverySeed, {
			failedBeeId: "queenbee.merge.001",
			retryCount: 0,
			artifactRefs: [".swarm/failures/router-recovery.json"],
		})
		const recoveryDelivered =
			recoveryResult.status === "delivered" &&
			recoveryResult.edge === "RouterBee->RecoveryBee" &&
			recoveryResult.responseEnvelope?.messageType === "recovery_plan"

		const forbiddenEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-router-forbidden",
			missionId: "mission-router-2",
			senderBeeId: "queenbee.jsts_coder.001",
			recipientBeeId: "queenbee.merge.001",
			messageType: "merge_request",
			timestamp: "2026-03-26T12:01:00Z",
			payload: {
				changedFiles: ["hello.ts"],
				proposals: [
					{
						path: "hello.ts",
						beforeContent: 'export const message = "hello"\n',
						afterContent: 'export const message = "hello // forbidden"\n',
						changeSummary: "Direct coder-to-merge hop should still be rejected even when the payload is valid.",
					},
				],
				proofCommands: ["npm.cmd run verify:guardrails"],
				verifierSummary: "Synthetic valid merge payload for forbidden-edge routing coverage.",
			},
		})
		const forbiddenResult = shell.router.routeEnvelope(forbiddenEnvelope)
		const forbiddenDirectEdgeRejected = forbiddenResult.status === "rejected" && forbiddenResult.reason === "edge_not_allowed"

		const wrongMessageEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-router-wrong-type",
			missionId: "mission-router-3",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-26T12:02:00Z",
			payload: {
				task: "Add a brief comment to hello.ts",
				taskFamily: "comment_file",
				languagePack: "js_ts",
				allowedFiles: ["hello.ts"],
				forbiddenFiles: ["package.json"],
				expectedResult: "small_named_file_comment",
				plannerSummary: "PlannerBee emitted 1 assignment packet for comment_file over hello.ts.",
				requiresReview: true,
				requiresVerification: true,
			},
		})
		const wrongMessageResult = shell.router.routeEnvelope(wrongMessageEnvelope)
		const messageTypeBoundaryEnforced =
			wrongMessageResult.status === "rejected" && wrongMessageResult.reason === "message_type_not_allowed_on_edge"

		details.push(
			`allowedEdges=${shell.router.listAllowedEdges().join(",")}`,
			`implementedEdges=${shell.router.listImplementedEdges().join(",")}`,
			`lookupCandidates=${candidateBeeIds.join(",") || "missing"}`,
			`reserved=${String(asRecord(reservePayload)?.["reserved"] ?? "missing")}`,
			`scoutContext=${Array.isArray(scoutPayload["contextFiles"]) ? (scoutPayload["contextFiles"] as string[]).join(",") : "missing"}`,
			`assignmentPacketSender=${assignmentPacket?.senderBeeId ?? "missing"}`,
			`coderChangedFiles=${Array.isArray(coderPayload["changedFiles"]) ? (coderPayload["changedFiles"] as string[]).join(",") : "missing"}`,
			`reviewType=${reviewResult?.responseEnvelope?.messageType ?? "missing"}`,
			`verificationType=${verificationResult?.responseEnvelope?.messageType ?? "missing"}`,
			`mergeType=${mergeResult?.responseEnvelope?.messageType ?? "missing"}`,
			`archivePath=${typeof archivePayload["archivePath"] === "string" ? archivePayload["archivePath"] : "missing"}`,
			`recoveryType=${recoveryResult.responseEnvelope?.messageType ?? "missing"}`,
		)

		return {
			routerDocsPresent,
			routeTableAligned,
			implementedEdgesScoped,
			registryLookupDelivered,
			plannerPlanDelivered,
			coderWorkDelivered,
			coreSpecialistVisible,
			reviewVerdictDelivered,
			verificationDelivered,
			mergeDelivered,
			archiveWritten,
			recoveryDelivered,
			forbiddenDirectEdgeRejected,
			messageTypeBoundaryEnforced,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeRouterHarnessResult(result: QueenBeeRouterHarnessResult): string {
	return [
		`Router docs present: ${result.routerDocsPresent ? "PASS" : "FAIL"}`,
		`Route table aligned: ${result.routeTableAligned ? "PASS" : "FAIL"}`,
		`Implemented edges scoped: ${result.implementedEdgesScoped ? "PASS" : "FAIL"}`,
		`Registry lookup delivered: ${result.registryLookupDelivered ? "PASS" : "FAIL"}`,
		`Planner plan delivered: ${result.plannerPlanDelivered ? "PASS" : "FAIL"}`,
		`Coder work delivered: ${result.coderWorkDelivered ? "PASS" : "FAIL"}`,
		`Core specialist visible: ${result.coreSpecialistVisible ? "PASS" : "FAIL"}`,
		`Review verdict delivered: ${result.reviewVerdictDelivered ? "PASS" : "FAIL"}`,
		`Verification delivered: ${result.verificationDelivered ? "PASS" : "FAIL"}`,
		`Merge delivered: ${result.mergeDelivered ? "PASS" : "FAIL"}`,
		`Archive written: ${result.archiveWritten ? "PASS" : "FAIL"}`,
		`Recovery delivered: ${result.recoveryDelivered ? "PASS" : "FAIL"}`,
		`Forbidden direct edge rejected: ${result.forbiddenDirectEdgeRejected ? "PASS" : "FAIL"}`,
		`Message-type boundary enforced: ${result.messageTypeBoundaryEnforced ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeRouterHarness()
	console.log(formatQueenBeeRouterHarnessResult(result))
	process.exit(
		result.routerDocsPresent &&
			result.routeTableAligned &&
			result.implementedEdgesScoped &&
			result.registryLookupDelivered &&
			result.plannerPlanDelivered &&
			result.coderWorkDelivered &&
			result.coreSpecialistVisible &&
			result.reviewVerdictDelivered &&
			result.verificationDelivered &&
			result.mergeDelivered &&
			result.archiveWritten &&
			result.recoveryDelivered &&
			result.forbiddenDirectEdgeRejected &&
			result.messageTypeBoundaryEnforced
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:router] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
