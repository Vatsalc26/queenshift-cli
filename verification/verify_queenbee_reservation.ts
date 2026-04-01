import fs from "node:fs"
import path from "node:path"

import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"

export type QueenBeeReservationHarnessResult = {
	reservationDocsPresent: boolean
	packageScriptPresent: boolean
	lookupDelivered: boolean
	reserveDelivered: boolean
	assignmentPacketTargetsReservedBee: boolean
	releaseRestoresAvailability: boolean
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

function readFirstAssignmentPacket(envelope: QueenBeeEnvelope | null): QueenBeeEnvelope | null {
	const payload = asRecord(envelope?.payload)
	if (!payload || !Array.isArray(payload["assignmentPackets"])) return null
	const first = payload["assignmentPackets"][0]
	return first && typeof first === "object" && !Array.isArray(first) ? (first as QueenBeeEnvelope) : null
}

export async function runQueenBeeReservationHarness(rootDir = resolveRootDir()): Promise<QueenBeeReservationHarnessResult> {
	const details: string[] = []
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const capabilityText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}

	const reservationDocsPresent =
		includesAll(messageSchemaText, [
			"## Session 192 Scout And Reservation Shell",
			"`reservedBeeId`",
			"`bee_reserve_request`",
		]) &&
		includesAll(protocolMapText, [
			"## Session 192 Runtime Scout And Reservation",
			"`bee_reserve_request`",
			"`bee_reserved`",
		]) &&
		includesAll(capabilityText, [
			"## Session 192 Capability Reservation Flow",
			"`registry_lookup_request`",
			"`bee_reserve_request`",
			"`reservedBeeId`",
		]) &&
		includesAll(architectureText, [
			"## Decision: QueenBee ScoutBee stays read-only and reservation stays protocol-visible",
			"**Session:** 192",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:reservation`", "reserved"])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:reservation"] === "npm run build && node dist/verification/verify_queenbee_reservation.js"

	const shell = createQueenBeeShell()
	const workspace = path.join(rootDir, "verification", "test_workspace")

	const lookupEnvelope = buildQueenBeeEnvelope({
		messageId: "msg-reservation-lookup",
		missionId: "mission-reservation-1",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.registry.001",
		messageType: "registry_lookup_request",
		timestamp: "2026-03-26T12:50:00Z",
		payload: {
			desiredRoleFamily: "coder",
			desiredLanguagePack: "js_ts",
			requiredToolFamilies: ["repo_edit"],
		},
	})
	const lookupResult = shell.router.routeEnvelope(lookupEnvelope)
	const lookupPayload = asRecord(lookupResult.responseEnvelope?.payload)
	const candidateBeeIds = Array.isArray(lookupPayload?.["candidateBeeIds"]) ? (lookupPayload["candidateBeeIds"] as string[]) : []
	const reservedBeeId = candidateBeeIds[0] ?? ""
	const lookupDelivered =
		lookupResult.status === "delivered" &&
		lookupResult.responseEnvelope?.messageType === "registry_lookup_result" &&
		candidateBeeIds.join(",") === "queenbee.jsts_coder.001"

	const reserveEnvelope = buildQueenBeeEnvelope({
		messageId: "msg-reservation-reserve",
		missionId: "mission-reservation-1",
		assignmentId: "assign-reservation-1",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.registry.001",
		messageType: "bee_reserve_request",
		timestamp: "2026-03-26T12:51:00Z",
		payload: {
			targetBeeId: reservedBeeId,
			assignmentId: "assign-reservation-1",
		},
	})
	const reserveResult = shell.router.routeEnvelope(reserveEnvelope)
	const reservePayload = asRecord(reserveResult.responseEnvelope?.payload)
	const reservedEntry = asRecord(reservePayload?.["entry"])
	const reserveDelivered =
		reserveResult.status === "delivered" &&
		reserveResult.responseEnvelope?.messageType === "bee_reserved" &&
		reservePayload?.["reserved"] === true &&
		reservedEntry?.["availabilityState"] === "reserved" &&
		reservedEntry?.["currentAssignmentId"] === "assign-reservation-1"

	const scoutEnvelope = buildQueenBeeEnvelope({
		messageId: "msg-reservation-scout",
		missionId: "mission-reservation-1",
		assignmentId: "assign-reservation-1",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.scout.001",
		messageType: "scout_request",
		timestamp: "2026-03-26T12:52:00Z",
		payload: {
			task: "Update hello.ts",
			workspace,
			targetFiles: ["hello.ts"],
			languagePack: "js_ts",
		},
	})
	const scoutResult = shell.router.routeEnvelope(scoutEnvelope)
	const scoutPayload = asRecord(scoutResult.responseEnvelope?.payload)
	const scoutSummary = typeof scoutPayload?.["scoutSummary"] === "string" ? (scoutPayload["scoutSummary"] as string) : ""

	const planEnvelope = buildQueenBeeEnvelope({
		messageId: "msg-reservation-plan",
		missionId: "mission-reservation-1",
		assignmentId: "assign-reservation-1",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.planner.001",
		messageType: "plan_request",
		timestamp: "2026-03-26T12:53:00Z",
		payload: {
			task: "Update hello.ts",
			taskFamily: "update_named_file",
			targetFiles: ["hello.ts"],
			languagePack: "js_ts",
			protectedFiles: ["package.json"],
			reservedBeeId,
		},
	})
	const planResult = shell.router.routeEnvelope(planEnvelope)
	const assignmentPacket = readFirstAssignmentPacket(planResult.responseEnvelope)
	const assignmentPacketTargetsReservedBee =
		scoutResult.status === "delivered" &&
		scoutPayload?.["accepted"] === true &&
		scoutSummary.includes("hello.ts") &&
		planResult.status === "delivered" &&
		assignmentPacket?.recipientBeeId === reservedBeeId

	const releaseEnvelope = buildQueenBeeEnvelope({
		messageId: "msg-reservation-release",
		missionId: "mission-reservation-1",
		assignmentId: "assign-reservation-1",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.registry.001",
		messageType: "bee_release",
		timestamp: "2026-03-26T12:54:00Z",
		payload: {
			targetBeeId: reservedBeeId,
			assignmentId: "assign-reservation-1",
		},
	})
	const releaseResult = shell.router.routeEnvelope(releaseEnvelope)
	const finalEntry = shell.registry.getEntry("queenbee.jsts_coder.001")
	const releasePayload = asRecord(releaseResult.responseEnvelope?.payload)
	const releaseRestoresAvailability =
		releaseResult.status === "delivered" &&
		releasePayload?.["released"] === true &&
		finalEntry?.availabilityState === "idle" &&
		finalEntry?.currentAssignmentId === null

	details.push(
		`candidates=${candidateBeeIds.join(",") || "missing"}`,
		`reservedEntry=${String(reservedEntry?.["availabilityState"] ?? "missing")}`,
		`assignmentRecipient=${assignmentPacket?.recipientBeeId ?? "missing"}`,
		`released=${String(releasePayload?.["released"] ?? "missing")}`,
	)

	return {
		reservationDocsPresent,
		packageScriptPresent,
		lookupDelivered,
		reserveDelivered,
		assignmentPacketTargetsReservedBee,
		releaseRestoresAvailability,
		details,
	}
}

export function formatQueenBeeReservationHarnessResult(result: QueenBeeReservationHarnessResult): string {
	return [
		`Reservation docs present: ${result.reservationDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Lookup delivered: ${result.lookupDelivered ? "PASS" : "FAIL"}`,
		`Reserve delivered: ${result.reserveDelivered ? "PASS" : "FAIL"}`,
		`Assignment packet targets reserved bee: ${result.assignmentPacketTargetsReservedBee ? "PASS" : "FAIL"}`,
		`Release restores availability: ${result.releaseRestoresAvailability ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeReservationHarness()
	console.log(formatQueenBeeReservationHarnessResult(result))
	process.exit(
		result.reservationDocsPresent &&
			result.packageScriptPresent &&
			result.lookupDelivered &&
			result.reserveDelivered &&
			result.assignmentPacketTargetsReservedBee &&
			result.releaseRestoresAvailability
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:reservation] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
