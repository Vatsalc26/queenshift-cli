import fs from "node:fs"
import path from "node:path"

import { buildQueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { formatQueenBeeProtocolLedger } from "../src/queenbee/QueenBeeProtocolLedger"
import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"

export type QueenBeeLedgerHarnessResult = {
	ledgerDocsPresent: boolean
	packageScriptPresent: boolean
	shellExposesLedger: boolean
	messageValidationVisible: boolean
	routeDecisionVisible: boolean
	stateChangeVisible: boolean
	rejectedPacketVisible: boolean
	artifactVisibilityImproved: boolean
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

export async function runQueenBeeLedgerHarness(rootDir = resolveRootDir()): Promise<QueenBeeLedgerHarnessResult> {
	const details: string[] = []
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const failureText = readText(rootDir, "QUEENBEE_FAILURE_AND_QUARANTINE_RULES.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}

	const ledgerDocsPresent =
		includesAll(messageSchemaText, [
			"## Session 190 Validator And Ledger Shell",
			"`QueenBeeMessageValidator`",
			"`QueenBeeProtocolLedger`",
			"every accepted or rejected packet should append a ledger row",
		]) &&
		includesAll(failureText, [
			"## Session 190 Inspection Rule",
			"invalid packets must be recorded in the protocol ledger",
			"no silent packet drop",
		]) &&
		includesAll(architectureText, [
			"## Decision: QueenBee packet validation and protocol ledgering land before worker runtimes",
			"**Session:** 190",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:ledger`", "protocol ledger"])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:ledger"] === "npm run build && node dist/verification/verify_queenbee_ledger.js"

	const shell = createQueenBeeShell()
	const shellExposesLedger =
		typeof shell.messageValidator.validateEnvelope === "function" &&
		typeof shell.protocolLedger.buildArtifact === "function" &&
		shell.protocolLedger.listEntries().length === 0

	const lookupEnvelope = buildQueenBeeEnvelope({
		messageId: "msg-ledger-lookup",
		missionId: "mission-ledger-1",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.registry.001",
		messageType: "registry_lookup_request",
		timestamp: "2026-03-26T12:20:00Z",
		payload: {
			desiredRoleFamily: "coder",
			desiredLanguagePack: "js_ts",
			requiredToolFamilies: ["repo_edit"],
		},
	})
	const reserveEnvelope = buildQueenBeeEnvelope({
		messageId: "msg-ledger-reserve",
		missionId: "mission-ledger-2",
		assignmentId: "assign-ledger-2",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.registry.001",
		messageType: "bee_reserve_request",
		timestamp: "2026-03-26T12:21:00Z",
		payload: {
			targetBeeId: "queenbee.jsts_coder.001",
			assignmentId: "assign-ledger-2",
		},
	})
	const invalidEnvelope = {
		...buildQueenBeeEnvelope({
			messageId: "msg-ledger-invalid",
			missionId: "mission-ledger-3",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "bee_reserve_request",
			timestamp: "2026-03-26T12:22:00Z",
			payload: {
				targetBeeId: "queenbee.jsts_coder.001",
			},
		}),
	}

	const lookupResult = shell.router.routeEnvelope(lookupEnvelope)
	const reserveResult = shell.router.routeEnvelope(reserveEnvelope)
	const invalidResult = shell.router.routeEnvelope(invalidEnvelope)
	const entries = shell.protocolLedger.listEntries()
	const artifact = shell.protocolLedger.buildArtifact()
	const formatted = formatQueenBeeProtocolLedger(shell.protocolLedger)

	const messageValidationVisible =
		entries.filter((entry) => entry.entryType === "message_validation" && entry.status === "accepted").length >= 3 &&
		entries.some((entry) => entry.messageId === "msg-ledger-lookup") &&
		entries.some((entry) => entry.messageId === "msg-ledger-lookup:registry_lookup_result")
	const routeDecisionVisible =
		lookupResult.status === "delivered" &&
		reserveResult.status === "delivered" &&
		entries.some(
			(entry) =>
				entry.entryType === "route_result" &&
				entry.status === "delivered" &&
				entry.edge === "RouterBee->RegistryBee" &&
				entry.messageId === "msg-ledger-reserve",
		)
	const stateChangeVisible = entries.some((entry) => {
		if (entry.entryType !== "state_change") return false
		const beeId = entry.details["beeId"]
		const changedKeys = Array.isArray(entry.details["changedKeys"]) ? (entry.details["changedKeys"] as string[]) : []
		const before = entry.details["before"] as Record<string, unknown> | undefined
		const after = entry.details["after"] as Record<string, unknown> | undefined
		return (
			beeId === "queenbee.jsts_coder.001" &&
			changedKeys.includes("availabilityState") &&
			before?.["availabilityState"] === "idle" &&
			after?.["availabilityState"] === "reserved"
		)
	})
	const rejectedPacketVisible =
		invalidResult.status === "rejected" &&
		invalidResult.reason === "invalid_bee_reserve_request_payload" &&
		entries.some(
			(entry) =>
				entry.entryType === "message_validation" &&
				entry.status === "rejected" &&
				entry.messageId === "msg-ledger-invalid" &&
				entry.reason === "invalid_bee_reserve_request_payload",
		) &&
		entries.some(
			(entry) =>
				entry.entryType === "route_result" &&
				entry.status === "rejected" &&
				entry.messageId === "msg-ledger-invalid" &&
				entry.reason === "invalid_bee_reserve_request_payload",
		)
	const artifactVisibilityImproved =
		artifact.entryCount === entries.length &&
		artifact.validationCount >= 3 &&
		artifact.routeCount >= 2 &&
		artifact.stateChangeCount >= 1 &&
		formatted.includes("QueenBee protocol ledger: entries=") &&
		formatted.includes("msg-ledger-reserve")

	details.push(
		`entries=${entries.length}`,
		`validationCount=${artifact.validationCount}`,
		`routeCount=${artifact.routeCount}`,
		`stateChangeCount=${artifact.stateChangeCount}`,
		`latest=${entries.at(-1)?.entryType ?? "missing"}`,
	)

	return {
		ledgerDocsPresent,
		packageScriptPresent,
		shellExposesLedger,
		messageValidationVisible,
		routeDecisionVisible,
		stateChangeVisible,
		rejectedPacketVisible,
		artifactVisibilityImproved,
		details,
	}
}

export function formatQueenBeeLedgerHarnessResult(result: QueenBeeLedgerHarnessResult): string {
	return [
		`Ledger docs present: ${result.ledgerDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Shell exposes ledger: ${result.shellExposesLedger ? "PASS" : "FAIL"}`,
		`Message validation visible: ${result.messageValidationVisible ? "PASS" : "FAIL"}`,
		`Route decision visible: ${result.routeDecisionVisible ? "PASS" : "FAIL"}`,
		`State change visible: ${result.stateChangeVisible ? "PASS" : "FAIL"}`,
		`Rejected packet visible: ${result.rejectedPacketVisible ? "PASS" : "FAIL"}`,
		`Artifact visibility improved: ${result.artifactVisibilityImproved ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeLedgerHarness()
	console.log(formatQueenBeeLedgerHarnessResult(result))
	process.exit(
		result.ledgerDocsPresent &&
			result.packageScriptPresent &&
			result.shellExposesLedger &&
			result.messageValidationVisible &&
			result.routeDecisionVisible &&
			result.stateChangeVisible &&
			result.rejectedPacketVisible &&
			result.artifactVisibilityImproved
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:ledger] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
