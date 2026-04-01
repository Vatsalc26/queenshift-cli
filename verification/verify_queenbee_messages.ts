import fs from "node:fs"
import path from "node:path"

import { buildQueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"

export type QueenBeeMessagesHarnessResult = {
	packetFreezeContractPresent: boolean
	envelopeFieldsAligned: boolean
	messageFamiliesAligned: boolean
	routeBindingPresent: boolean
	assignmentExampleAligned: boolean
	runtimeValidatorPresent: boolean
	unknownEnvelopeFieldRejected: boolean
	registryPayloadValidationWorks: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function readText(rootDir: string, relativePath: string): string {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8")
}

function extractSection(text: string, heading: string): string {
	const headingPattern = new RegExp(`^## ${escapeRegExp(heading)}\\b.*$`, "m")
	const headingMatch = headingPattern.exec(text)
	if (!headingMatch || typeof headingMatch.index !== "number") return ""

	const sectionStart = headingMatch.index
	const afterHeading = text.slice(sectionStart)
	const remainder = afterHeading.slice(headingMatch[0].length)
	const nextHeadingIndex = remainder.search(/\n##\s/u)
	if (nextHeadingIndex === -1) return afterHeading.trimEnd()
	return afterHeading.slice(0, headingMatch[0].length + nextHeadingIndex).trimEnd()
}

function extractSubsection(section: string, heading: string): string {
	const headingPattern = new RegExp(`^### ${escapeRegExp(heading)}\\b.*$`, "m")
	const headingMatch = headingPattern.exec(section)
	if (!headingMatch || typeof headingMatch.index !== "number") return ""

	const sectionStart = headingMatch.index
	const afterHeading = section.slice(sectionStart)
	const remainder = afterHeading.slice(headingMatch[0].length)
	const nextHeadingIndex = remainder.search(/\n###\s/u)
	if (nextHeadingIndex === -1) return afterHeading.trimEnd()
	return afterHeading.slice(0, headingMatch[0].length + nextHeadingIndex).trimEnd()
}

function extractBacktickedItems(section: string): string[] {
	return Array.from(section.matchAll(/`([^`]+)`/g), (match) => match[1] ?? "").filter((item) => item.length > 0)
}

function sameOrderedList(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

export async function runQueenBeeMessagesHarness(rootDir = resolveRootDir()): Promise<QueenBeeMessagesHarnessResult> {
	const details: string[] = []
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const shell = createQueenBeeShell()

	const envelopeSection = extractSection(messageSchemaText, "Message Envelope")
	const requiredTypesSection = extractSection(messageSchemaText, "Required Message Types")
	const missionSection = extractSubsection(requiredTypesSection, "Mission-level")
	const registrySection = extractSubsection(requiredTypesSection, "Registry and routing")
	const discoverySection = extractSubsection(requiredTypesSection, "Discovery and planning")
	const executionSection = extractSubsection(requiredTypesSection, "Work execution")
	const reviewSection = extractSubsection(requiredTypesSection, "Review and verification")
	const mergeSection = extractSubsection(requiredTypesSection, "Merge and archival")
	const failureSection = extractSubsection(requiredTypesSection, "Failure and recovery")
	const routeBoundSection = extractSection(messageSchemaText, "Route-Bound Message Families")
	const exampleSection = extractSection(messageSchemaText, "Example Assignment Packet")

	const packetFreezeContractPresent = includesAll(messageSchemaText, [
		"## Packet Freeze Contract",
		"`qb-v1`",
		"## Envelope Invariants",
		"## Route-Bound Message Families",
		"## Undefined Message Rule",
	])
	const envelopeFieldsAligned =
		sameOrderedList(extractBacktickedItems(envelopeSection).slice(0, 13), [
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
		]) &&
		includesAll(messageSchemaText, ["`protocolVersion` must be `qb-v1`", "`engine` must be `queenbee`"])
	const messageFamiliesAligned =
		sameOrderedList(extractBacktickedItems(missionSection), ["mission_submitted", "mission_admitted", "mission_refused", "mission_closed"]) &&
		sameOrderedList(extractBacktickedItems(registrySection), ["registry_lookup_request", "registry_lookup_result", "bee_reserve_request", "bee_reserved", "bee_release"]) &&
		sameOrderedList(extractBacktickedItems(discoverySection), ["scout_request", "scout_result", "plan_request", "plan_result"]) &&
		sameOrderedList(extractBacktickedItems(executionSection), ["assignment_packet", "assignment_ack", "work_result", "work_blocker", "rework_request"]) &&
		sameOrderedList(extractBacktickedItems(reviewSection), ["review_request", "review_pass", "review_rework", "review_fail", "verification_request", "verification_pass", "verification_fail"]) &&
		sameOrderedList(extractBacktickedItems(mergeSection), ["merge_request", "merge_pass", "merge_blocked", "archive_request", "archive_written"]) &&
		sameOrderedList(extractBacktickedItems(failureSection), ["recovery_request", "recovery_plan", "quarantine_request", "bee_quarantined"])
	const routeBindingPresent = includesAll(routeBoundSection, [
		"`QueenBee <-> RouterBee`",
		"`RouterBee <-> RegistryBee`",
		"`RouterBee <-> ScoutBee`",
		"`RouterBee <-> PlannerBee`",
		"`RouterBee <-> JSTSCoderBee`",
		"`RouterBee <-> JSTSReviewerBee`",
		"`RouterBee <-> VerifierBee`",
		"`RouterBee <-> MergeBee`",
		"`RouterBee <-> ArchivistBee`",
		"`RouterBee <-> RecoveryBee`",
	])
	const assignmentExampleAligned = includesAll(exampleSection, [
		'"protocolVersion": "qb-v1"',
		'"engine": "queenbee"',
		'"messageType": "assignment_packet"',
		'"senderBeeId": "queenbee.planner.001"',
		'"recipientBeeId": "queenbee.jsts_coder.001"',
		'"requiresAck": true',
		'"scopeToken": "scope-abc"',
		'"toolGrantToken": "grant-xyz"',
		'"taskFamily": "comment_file"',
		'"plannerSummary": "PlannerBee emitted 1 assignment packet for comment_file over hello.ts."',
	]) &&
		includesAll(messageSchemaText, [
			"`assignment_ack`",
			"Silence should time out into a protocol-visible failure.",
			"## Session 190 Validator And Ledger Shell",
			"`QueenBeeMessageValidator`",
			"`QueenBeeProtocolLedger`",
			"`npm.cmd run verify:queenbee:ledger`",
		])

	const assignmentPacket = buildQueenBeeEnvelope({
		messageId: "msg-message-validator-assignment",
		missionId: "mission-message-validator-1",
		assignmentId: "assign-message-validator-1",
		senderBeeId: "queenbee.planner.001",
		recipientBeeId: "queenbee.jsts_coder.001",
		messageType: "assignment_packet",
		timestamp: "2026-03-26T12:10:00Z",
		requiresAck: true,
		scopeToken: "scope-abc",
		toolGrantToken: "grant-xyz",
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
	const validAssignment = shell.messageValidator.validateEnvelope(assignmentPacket)
	const runtimeValidatorPresent =
		validAssignment.valid &&
		validAssignment.envelope?.messageType === "assignment_packet" &&
		validAssignment.envelope.requiresAck === true

	const unknownFieldValidation = shell.messageValidator.validateEnvelope({
		...assignmentPacket,
		driftField: "not-allowed",
	})
	const unknownEnvelopeFieldRejected = !unknownFieldValidation.valid && unknownFieldValidation.reason === "unknown_envelope_field"

	const badReserveResult = shell.router.routeEnvelope({
		...buildQueenBeeEnvelope({
			messageId: "msg-message-validator-reserve",
			missionId: "mission-message-validator-2",
			assignmentId: "assign-message-validator-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "bee_reserve_request",
			timestamp: "2026-03-26T12:11:00Z",
			payload: {
				targetBeeId: "queenbee.jsts_coder.001",
			},
		}),
	})
	const goodReserveResult = shell.router.routeEnvelope(
		buildQueenBeeEnvelope({
			messageId: "msg-message-validator-reserve-good",
			missionId: "mission-message-validator-3",
			assignmentId: "assign-message-validator-3",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "bee_reserve_request",
			timestamp: "2026-03-26T12:12:00Z",
			payload: {
				targetBeeId: "queenbee.jsts_coder.001",
				assignmentId: "assign-message-validator-3",
			},
		}),
	)
	const registryPayloadValidationWorks =
		badReserveResult.status === "rejected" &&
		badReserveResult.reason === "invalid_bee_reserve_request_payload" &&
		goodReserveResult.status === "delivered" &&
		goodReserveResult.responseEnvelope?.messageType === "bee_reserved"

	details.push(
		`envelopeFields=${extractBacktickedItems(envelopeSection).slice(0, 13).join(",") || "missing"}`,
		`missionTypes=${extractBacktickedItems(missionSection).join(",") || "missing"}`,
		`executionTypes=${extractBacktickedItems(executionSection).join(",") || "missing"}`,
		`routeBoundSection=${routeBoundSection ? "present" : "missing"}`,
		`validatorReason=${validAssignment.reason ?? "accepted"}`,
		`unknownFieldReason=${unknownFieldValidation.reason ?? "accepted"}`,
		`badReserveReason=${badReserveResult.reason ?? "accepted"}`,
	)

	return {
		packetFreezeContractPresent,
		envelopeFieldsAligned,
		messageFamiliesAligned,
		routeBindingPresent,
		assignmentExampleAligned,
		runtimeValidatorPresent,
		unknownEnvelopeFieldRejected,
		registryPayloadValidationWorks,
		details,
	}
}

export function formatQueenBeeMessagesHarnessResult(result: QueenBeeMessagesHarnessResult): string {
	return [
		`Packet freeze contract present: ${result.packetFreezeContractPresent ? "PASS" : "FAIL"}`,
		`Envelope fields aligned: ${result.envelopeFieldsAligned ? "PASS" : "FAIL"}`,
		`Message families aligned: ${result.messageFamiliesAligned ? "PASS" : "FAIL"}`,
		`Route binding present: ${result.routeBindingPresent ? "PASS" : "FAIL"}`,
		`Assignment example aligned: ${result.assignmentExampleAligned ? "PASS" : "FAIL"}`,
		`Runtime validator present: ${result.runtimeValidatorPresent ? "PASS" : "FAIL"}`,
		`Unknown envelope field rejected: ${result.unknownEnvelopeFieldRejected ? "PASS" : "FAIL"}`,
		`Registry payload validation works: ${result.registryPayloadValidationWorks ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeMessagesHarness()
	console.log(formatQueenBeeMessagesHarnessResult(result))
	process.exit(
		result.packetFreezeContractPresent &&
			result.envelopeFieldsAligned &&
			result.messageFamiliesAligned &&
			result.routeBindingPresent &&
			result.assignmentExampleAligned &&
			result.runtimeValidatorPresent &&
			result.unknownEnvelopeFieldRejected &&
			result.registryPayloadValidationWorks
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:messages] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
