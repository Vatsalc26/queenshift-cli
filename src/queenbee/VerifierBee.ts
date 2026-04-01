import { buildQueenBeeEnvelope, type QueenBeeBeeId, type QueenBeeEnvelope } from "./QueenBeeProtocol"

export type QueenBeeVerificationRequestPayload = {
	languagePack: string
	changedFiles: string[]
	proofCommands: string[]
	reviewSummary: string
	expectedPassSurface: string
}

export type QueenBeeVerificationResultRow = {
	command: string
	exitCode: number
	passed: boolean
	outputSummary: string
}

export type QueenBeeVerificationVerdictPayload = {
	accepted: boolean
	reason: string | null
	proofCommands: string[]
	resultCount: number
	results: QueenBeeVerificationResultRow[]
	verifierSummary: string
}

export type QueenBeeVerifierExecutor = (input: { workspaceRoot: string; command: string }) => QueenBeeVerificationResultRow

type VerificationVerdict = {
	messageType: "verification_pass" | "verification_fail"
	payload: QueenBeeVerificationVerdictPayload
}

const DEFAULT_ALLOWED_PROOF_COMMANDS = new Set([
	"npm.cmd test",
	"npm.cmd run verify:lane:small",
	"npm.cmd run verify:lane:medium",
	"npm.cmd run verify:guardrails",
	"npm.cmd run verify:task-corpus",
	"npm.cmd run verify:queenbee:jsts:small",
	"npm.cmd run verify:queenbee:jsts:two-file",
	"npm.cmd run verify:queenbee:jsts:async",
	"npm.cmd run verify:queenbee:jsts:file-and-test",
	"npm.cmd run verify:queenbee:jsts:rename",
	"npm.cmd run verify:queenbee:jsts:node",
	"npm.cmd run verify:queenbee:bounded-node",
])

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())))
		: []
}

function parseVerificationRequestPayload(payload: unknown): QueenBeeVerificationRequestPayload | null {
	const record = asRecord(payload)
	if (!record) return null
	const languagePack = typeof record["languagePack"] === "string" ? record["languagePack"].trim() : ""
	const changedFiles = readStringArray(record["changedFiles"])
	const proofCommands = readStringArray(record["proofCommands"])
	const reviewSummary = typeof record["reviewSummary"] === "string" ? record["reviewSummary"].trim() : ""
	const expectedPassSurface = typeof record["expectedPassSurface"] === "string" ? record["expectedPassSurface"].trim() : ""
	if (!languagePack || !reviewSummary || !expectedPassSurface || proofCommands.length === 0) return null
	return {
		languagePack,
		changedFiles,
		proofCommands,
		reviewSummary,
		expectedPassSurface,
	}
}

function buildVerdict(
	messageType: "verification_pass" | "verification_fail",
	payload: QueenBeeVerificationVerdictPayload,
): VerificationVerdict {
	return {
		messageType,
		payload,
	}
}

function buildFailVerdict(
	reason: string,
	proofCommands: string[],
	results: QueenBeeVerificationResultRow[],
	verifierSummary: string,
): VerificationVerdict {
	return buildVerdict("verification_fail", {
		accepted: false,
		reason,
		proofCommands,
		resultCount: results.length,
		results,
		verifierSummary,
	})
}

function describeProofBundle(commands: string[]): string {
	const firstCommand = commands[0]
	return commands.length === 1 && firstCommand ? firstCommand : commands.join(", ")
}

function createFailClosedVerifierExecutor(): QueenBeeVerifierExecutor {
	return ({ command }) => ({
		command,
		exitCode: 1,
		passed: false,
		outputSummary: "VerifierBee executor was not configured for this shell instance.",
	})
}

export class VerifierBee {
	private readonly verifierBeeId: QueenBeeBeeId
	private readonly workspaceRoot: string
	private readonly executor: QueenBeeVerifierExecutor

	constructor(
		workspaceRoot: string,
		executor: QueenBeeVerifierExecutor = createFailClosedVerifierExecutor(),
		verifierBeeId: QueenBeeBeeId = "queenbee.verifier.001",
	) {
		this.workspaceRoot = workspaceRoot
		this.executor = executor
		this.verifierBeeId = verifierBeeId
	}

	verifyEnvelope(envelope: QueenBeeEnvelope): VerificationVerdict {
		const payload = parseVerificationRequestPayload(envelope.payload)
		if (!payload) {
			return buildFailVerdict(
				"invalid_verification_request_payload",
				[],
				[],
				"VerifierBee refused the request because the verification payload was incomplete.",
			)
		}
		if (payload.languagePack !== "js_ts") {
			return buildFailVerdict(
				"unsupported_language_pack",
				payload.proofCommands,
				[],
				"VerifierBee stays inside the JS/TS-first candidate boundary.",
			)
		}
		if (payload.changedFiles.length < 1 || payload.changedFiles.length > 3) {
			return buildFailVerdict(
				"verification_target_count_out_of_bounds",
				payload.proofCommands,
				[],
				"VerifierBee stays bounded to one, two, or three explicit JS/TS targets in the current verification slice.",
			)
		}
		if (payload.proofCommands.some((command) => !DEFAULT_ALLOWED_PROOF_COMMANDS.has(command))) {
			return buildFailVerdict(
				"proof_command_not_allowed",
				payload.proofCommands,
				[],
				`VerifierBee refused a proof command outside the bounded allowlist for ${payload.expectedPassSurface}.`,
			)
		}

		const results = payload.proofCommands.map((command) => this.executor({ workspaceRoot: this.workspaceRoot, command }))
		const failingResult = results.find((result) => !result.passed)
		if (failingResult) {
			return buildFailVerdict(
				"proof_command_failed",
				payload.proofCommands,
				results,
				`VerifierBee recorded a bounded proof failure on ${failingResult.command} for ${payload.expectedPassSurface}.`,
			)
		}

		return buildVerdict("verification_pass", {
			accepted: true,
			reason: null,
			proofCommands: payload.proofCommands,
			resultCount: results.length,
			results,
			verifierSummary:
				`VerifierBee cleared ${results.length} bounded proof command(s) for ${payload.expectedPassSurface}: ` +
				`${describeProofBundle(payload.proofCommands)}.`,
		})
	}

	handleEnvelope(envelope: QueenBeeEnvelope): QueenBeeEnvelope | null {
		if (envelope.messageType !== "verification_request") return null
		const verdict = this.verifyEnvelope(envelope)
		return buildQueenBeeEnvelope({
			messageId: `${envelope.messageId}:${verdict.messageType}`,
			missionId: envelope.missionId,
			assignmentId: envelope.assignmentId,
			senderBeeId: this.verifierBeeId,
			recipientBeeId: envelope.senderBeeId,
			messageType: verdict.messageType,
			timestamp: envelope.timestamp,
			scopeToken: envelope.scopeToken,
			toolGrantToken: envelope.toolGrantToken,
			parentMessageId: envelope.messageId,
			payload: verdict.payload as unknown as Record<string, unknown>,
		})
	}
}
