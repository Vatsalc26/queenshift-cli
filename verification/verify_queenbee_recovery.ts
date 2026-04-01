import fs from "node:fs"
import path from "node:path"

import { buildQueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeRecoveryHarnessResult = {
	recoveryDocsPresent: boolean
	implementedEdgesAligned: boolean
	cooldownDelivered: boolean
	cooldownStateVisible: boolean
	quarantineDelivered: boolean
	quarantineStateVisible: boolean
	quarantineReserveBlocked: boolean
	messageBoundaryEnforced: boolean
	wiringMapTruthful: boolean
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

export async function runQueenBeeRecoveryHarness(rootDir = resolveRootDir()): Promise<QueenBeeRecoveryHarnessResult> {
	const details: string[] = []
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const failureRulesText = readText(rootDir, "QUEENBEE_FAILURE_AND_QUARANTINE_RULES.md")
	const registryText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const toolGrantsText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const wiringMapText = readText(rootDir, "WIRING_MAP.md")

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-recovery")
	try {
		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath })

		const recoveryDocsPresent =
			includesAll(protocolMapText, [
				"## Session 198 Runtime Recovery",
				"`RouterBee -> RecoveryBee` now accepts `recovery_request`",
				"`RecoveryBee -> RouterBee` now returns `recovery_plan` or `bee_quarantined`",
				"no live `RouterBee -> QueenBee` runtime handback exists yet",
			]) &&
			includesAll(messageSchemaText, [
				"## Session 198 Recovery Shell",
				"`recovery_request` must carry `failedBeeId`, `sourceBeeId`, `failureFamily`, `sourceMessageType`, `failureReason`, `retryCount`, `artifactRefs`, and `requestSummary`",
				"`recovery_plan` must report `failedBeeId`, `failureFamily`, `retryable`, `sameBeeAllowed`, `recommendedAction`, `cooldownUntil`, `maxRetryCount`, and `recoverySummary`",
				"`bee_quarantined` must report `failedBeeId`, `failureFamily`, `quarantineReason`, and `recoverySummary`",
			]) &&
			includesAll(failureRulesText, [
				"## Session 198 Runtime Recovery Rule",
				"`RecoveryBee` now returns its recommendation to `RouterBee`",
				"`RouterBee` applies explicit `cooling_off` or `quarantined` registry state",
			]) &&
			includesAll(registryText, [
				"## Session 198 Runtime Cooling-Off And Quarantine Control",
				"`setCoolingOff`",
				"`quarantine`",
			]) &&
			includesAll(toolGrantsText, [
				"## Session 198 Recovery Grant Rule",
				"`RecoveryBee` may use `failure_analyze` only for explicit recovery packets",
			]) &&
			includesAll(firstSliceText, [
				"## Session 198 Recovery Rule",
				"`RecoveryBee` may classify only explicit routed failures in the first slice",
			]) &&
			includesAll(architectureText, [
				"## Decision: QueenBee RecoveryBee makes cooldown and quarantine explicit without inventing a QueenBee return edge",
				"`RouterBee -> RecoveryBee` and `RecoveryBee -> RouterBee`",
			])

		const implementedEdgesAligned =
			shell.router.listImplementedEdges().includes("RouterBee->RecoveryBee") &&
			shell.router.listImplementedEdges().includes("RecoveryBee->RouterBee")

		const verificationFailure = buildQueenBeeEnvelope({
			messageId: "msg-recovery-cooldown",
			missionId: "mission-recovery-1",
			assignmentId: "assign-recovery-1",
			senderBeeId: "queenbee.verifier.001",
			recipientBeeId: "queenbee.router.001",
			messageType: "verification_fail",
			timestamp: "2026-03-26T13:00:00Z",
			artifactRefs: [".swarm/failures/verification-fail.json"],
			failureCode: "verification_failure",
			payload: {
				accepted: false,
				reason: "proof_command_failed",
				proofCommands: ["npm.cmd test"],
				resultCount: 1,
				results: [
					{
						command: "npm.cmd test",
						exitCode: 1,
						passed: false,
						outputSummary: "synthetic verifier failure",
					},
				],
				verifierSummary: "VerifierBee recorded a bounded proof failure for recovery coverage.",
			},
		})
		const cooldownResult = shell.router.relayFailureToRecovery(verificationFailure, {
			failedBeeId: "queenbee.jsts_coder.001",
			retryCount: 0,
			artifactRefs: [".swarm/failures/recovery-request.json"],
		})
		const cooledEntry = shell.registry.getEntry("queenbee.jsts_coder.001")
		const cooldownDelivered =
			cooldownResult.status === "delivered" &&
			cooldownResult.edge === "RouterBee->RecoveryBee" &&
			cooldownResult.responseEnvelope?.messageType === "recovery_plan"
		const cooldownStateVisible =
			cooledEntry?.availabilityState === "cooling_off" &&
			typeof cooledEntry.cooldownUntil === "string" &&
			cooledEntry.cooldownUntil.length > 0 &&
			cooledEntry.trustState === "trusted"

		const mergeBlocked = buildQueenBeeEnvelope({
			messageId: "msg-recovery-quarantine",
			missionId: "mission-recovery-2",
			assignmentId: "assign-recovery-2",
			senderBeeId: "queenbee.merge.001",
			recipientBeeId: "queenbee.router.001",
			messageType: "merge_blocked",
			timestamp: "2026-03-26T13:05:00Z",
			artifactRefs: [".swarm/failures/merge-blocked.json"],
			failureCode: "merge_failure",
			payload: {
				accepted: false,
				reason: "workspace_drift_detected",
				changedFiles: ["hello.ts"],
				proofCommands: ["npm.cmd test"],
				verifierSummary: "VerifierBee passed before the synthetic merge drift.",
				mergeSummary: "MergeBee refused because the workspace drifted.",
			},
		})
		const quarantineResult = shell.router.relayFailureToRecovery(mergeBlocked, {
			failedBeeId: "queenbee.merge.001",
			retryCount: 2,
			artifactRefs: [".swarm/failures/quarantine-request.json"],
		})
		const quarantinedEntry = shell.registry.getEntry("queenbee.merge.001")
		const reserveAttempt = shell.registry.reserve({
			beeId: "queenbee.merge.001",
			assignmentId: "assign-recovery-3",
		})
		const quarantineDelivered =
			quarantineResult.status === "delivered" &&
			quarantineResult.edge === "RouterBee->RecoveryBee" &&
			quarantineResult.responseEnvelope?.messageType === "bee_quarantined"
		const quarantineStateVisible =
			quarantinedEntry?.availabilityState === "quarantined" &&
			quarantinedEntry.trustState === "quarantined" &&
			typeof quarantinedEntry.quarantineReason === "string" &&
			quarantinedEntry.quarantineReason.length > 0
		const quarantineReserveBlocked = reserveAttempt.reserved === false && reserveAttempt.reason === "bee_quarantined"

		const wrongMessageResult = shell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-recovery-wrong-type",
				missionId: "mission-recovery-4",
				assignmentId: "assign-recovery-4",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.recovery.001",
				messageType: "recovery_plan",
				timestamp: "2026-03-26T13:10:00Z",
				payload: {
					failedBeeId: "queenbee.merge.001",
					failureFamily: "merge_failure",
					retryable: true,
					sameBeeAllowed: false,
					recommendedAction: "replan_before_retry",
					cooldownUntil: "2026-03-26T13:20:00Z",
					maxRetryCount: 1,
					recoverySummary: "Synthetic wrong-edge packet for route-boundary coverage.",
				},
			}),
		)
		const messageBoundaryEnforced =
			wrongMessageResult.status === "rejected" && wrongMessageResult.reason === "message_type_not_allowed_on_edge"

		const wiringMapTruthful =
			includesAll(wiringMapText, [
				"Last message-route change: Session 198 (QueenBee recovery shell)",
				"RouterBee | recovery_request | RecoveryBee | RecoveryBee.handleEnvelope() | Session 198",
				"RecoveryBee | recovery_plan | RouterBee | RouterBee.routeEnvelope() | Session 198",
				"RecoveryBee | bee_quarantined | RouterBee | RouterBee.routeEnvelope() | Session 198",
				"`QueenBee -> RouterBee` and any `RouterBee -> QueenBee` handback still remain non-live candidate boundaries",
			])

		details.push(
			`implementedEdges=${shell.router.listImplementedEdges().join(",")}`,
			`cooldownType=${cooldownResult.responseEnvelope?.messageType ?? "missing"}`,
			`cooldownState=${cooledEntry?.availabilityState ?? "missing"}`,
			`cooldownUntil=${cooledEntry?.cooldownUntil ?? "missing"}`,
			`quarantineType=${quarantineResult.responseEnvelope?.messageType ?? "missing"}`,
			`quarantineState=${quarantinedEntry?.availabilityState ?? "missing"}`,
			`quarantineReason=${quarantinedEntry?.quarantineReason ?? "missing"}`,
			`reserveAttempt=${reserveAttempt.reason ?? "accepted"}`,
		)

		return {
			recoveryDocsPresent,
			implementedEdgesAligned,
			cooldownDelivered,
			cooldownStateVisible,
			quarantineDelivered,
			quarantineStateVisible,
			quarantineReserveBlocked,
			messageBoundaryEnforced,
			wiringMapTruthful,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeRecoveryHarnessResult(result: QueenBeeRecoveryHarnessResult): string {
	return [
		`Recovery docs present: ${result.recoveryDocsPresent ? "PASS" : "FAIL"}`,
		`Implemented edges aligned: ${result.implementedEdgesAligned ? "PASS" : "FAIL"}`,
		`Cooldown delivered: ${result.cooldownDelivered ? "PASS" : "FAIL"}`,
		`Cooldown state visible: ${result.cooldownStateVisible ? "PASS" : "FAIL"}`,
		`Quarantine delivered: ${result.quarantineDelivered ? "PASS" : "FAIL"}`,
		`Quarantine state visible: ${result.quarantineStateVisible ? "PASS" : "FAIL"}`,
		`Quarantine reserve blocked: ${result.quarantineReserveBlocked ? "PASS" : "FAIL"}`,
		`Message boundary enforced: ${result.messageBoundaryEnforced ? "PASS" : "FAIL"}`,
		`Wiring map truthful: ${result.wiringMapTruthful ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeRecoveryHarness()
	console.log(formatQueenBeeRecoveryHarnessResult(result))
	process.exit(
		result.recoveryDocsPresent &&
			result.implementedEdgesAligned &&
			result.cooldownDelivered &&
			result.cooldownStateVisible &&
			result.quarantineDelivered &&
			result.quarantineStateVisible &&
			result.quarantineReserveBlocked &&
			result.messageBoundaryEnforced &&
			result.wiringMapTruthful
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:recovery] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
