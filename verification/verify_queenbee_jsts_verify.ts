import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import type { QueenBeeVerifierExecutor } from "../src/queenbee/VerifierBee"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeJstsVerifyHarnessResult = {
	verifierDocsPresent: boolean
	packageScriptPresent: boolean
	verifierEdgesImplemented: boolean
	verificationPassDelivered: boolean
	verificationFailDelivered: boolean
	proofDispatchBounded: boolean
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

export async function runQueenBeeJstsVerifyHarness(rootDir = resolveRootDir()): Promise<QueenBeeJstsVerifyHarnessResult> {
	const details: string[] = []
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const toolGrantText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const traceabilityText = readText(rootDir, "QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
	const confidenceContractText = readText(rootDir, "QUEENBEE_OPERATOR_CONFIDENCE_CONTRACT.md")
	const dailyProgramText = readText(rootDir, "QUEENBEE_DAILY_JSTS_PROGRAM.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}

	const verifierDocsPresent =
		includesAll(messageSchemaText, [
			"## Session 195 Verification Shell",
			"`verification_request`",
			"`verification_pass`",
			"`verification_fail`",
			"`proofCommands`",
			"`results`",
		]) &&
		includesAll(protocolMapText, [
			"## Session 195 Runtime Verifier",
			"`RouterBee -> VerifierBee`",
			"`VerifierBee -> RouterBee`",
			"`verification_request`",
			"`verification_pass`",
			"`verification_fail`",
		]) &&
		includesAll(firstSliceText, [
			"## Session 195 Verifier Rule",
			"`verify:queenbee:jsts:verify`",
			"`VerifierBee`",
		]) &&
		includesAll(toolGrantText, [
			"## Session 195 Verifier Grant Rule",
			"`VerifierBee`",
			"`verify_exec`",
			"`verify:queenbee:jsts:verify`",
		]) &&
		includesAll(architectureText, [
			"## Decision: QueenBee VerifierBee dispatches bounded proof requests through protocol",
			"**Session:** 195",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:jsts:verify`", "bounded proof dispatch"]) &&
		includesAll(traceabilityText, [
			"## Session 277 Daily Matrix Proof Reading",
			"`QB-TR-01` through `QB-TR-06`",
			"`verify:queenbee:jsts:small`",
			"`verify:queenbee:jsts:two-file`",
		]) &&
		includesAll(confidenceContractText, [
			"## Session 277 Daily Matrix Verification Confidence",
			"the verifier surface should name the proof command that actually ran",
			"`verify:queenbee:jsts:small`",
			"`verify:queenbee:jsts:two-file`",
		]) &&
		includesAll(dailyProgramText, [
			"## Session 277 Matrix Quality Confidence Update",
			"`comment_file`, `update_named_file`, `bounded_two_file_update`, `update_file_and_test`, `rename_export`, and `bounded_node_cli_task`",
			"`verify:queenbee:jsts:async`",
		])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:jsts:verify"] === "npm run build && node dist/verification/verify_queenbee_jsts_verify.js"

	const executedCommands: string[] = []
	const verifierExecutor: QueenBeeVerifierExecutor = ({ command }) => {
		executedCommands.push(command)
		if (command === "npm.cmd run verify:queenbee:jsts:small") {
			return {
				command,
				exitCode: 0,
				passed: true,
				outputSummary: "queenbee:jsts:small PASS",
			}
		}
		return {
			command,
			exitCode: 1,
			passed: false,
			outputSummary: "stub executor has no passing fixture for this command",
		}
	}

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-jsts-verify")
	try {
		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath, verifierExecutor })
		const verifierEdgesImplemented =
			shell.router.listImplementedEdges().includes("RouterBee->VerifierBee") &&
			shell.router.listImplementedEdges().includes("VerifierBee->RouterBee")

		const lookupEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-verify-lookup",
			missionId: "mission-jsts-verify-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "registry_lookup_request",
			timestamp: "2026-03-26T15:10:00Z",
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

		const reserveEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-verify-reserve",
			missionId: "mission-jsts-verify-1",
			assignmentId: "assign-jsts-verify-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "bee_reserve_request",
			timestamp: "2026-03-26T15:11:00Z",
			payload: {
				targetBeeId: reservedBeeId,
				assignmentId: "assign-jsts-verify-1",
			},
		})
		const reserveResult = shell.router.routeEnvelope(reserveEnvelope)
		const reserved = asRecord(reserveResult.responseEnvelope?.payload)?.["reserved"] === true

		const planEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-verify-plan",
			missionId: "mission-jsts-verify-1",
			assignmentId: "assign-jsts-verify-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-26T15:12:00Z",
			payload: {
				task: 'add the exact comment "// queenbee: verify pass" to hello.ts',
				taskFamily: "comment_file",
				targetFiles: ["hello.ts"],
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
				reservedBeeId,
			},
		})
		const planResult = shell.router.routeEnvelope(planEnvelope)
		const assignmentPacket = readFirstAssignmentPacket(planResult.responseEnvelope)
		const coderResult = assignmentPacket ? shell.router.relayPlannedAssignment(assignmentPacket) : null
		const reviewResult = coderResult?.responseEnvelope ? shell.router.relayCoderWorkResult(coderResult.responseEnvelope) : null

		const verificationPassResult =
			reviewResult?.responseEnvelope
				? shell.router.relayReviewVerdictToVerifier(
						reviewResult.responseEnvelope,
						["npm.cmd run verify:queenbee:jsts:small"],
						"daily_jsts_matrix_small_row_pack",
				  )
				: null
		const verificationPassPayload = asRecord(verificationPassResult?.responseEnvelope?.payload)
		const passResults = Array.isArray(verificationPassPayload?.["results"]) ? (verificationPassPayload["results"] as Array<Record<string, unknown>>) : []
		const firstPassRow = asRecord(passResults[0])
		const verificationPassDelivered =
			lookupResult.status === "delivered" &&
			reserved &&
			planResult.status === "delivered" &&
			coderResult?.status === "delivered" &&
			reviewResult?.status === "delivered" &&
			verificationPassResult?.status === "delivered" &&
			verificationPassResult.edge === "RouterBee->VerifierBee" &&
			verificationPassResult.responseEnvelope?.messageType === "verification_pass" &&
			verificationPassPayload?.["accepted"] === true &&
			firstPassRow?.["command"] === "npm.cmd run verify:queenbee:jsts:small" &&
			typeof verificationPassPayload?.["verifierSummary"] === "string" &&
			String(verificationPassPayload["verifierSummary"]).includes("daily_jsts_matrix_small_row_pack") &&
			String(verificationPassPayload["verifierSummary"]).includes("npm.cmd run verify:queenbee:jsts:small")

		const verificationFailResult =
			reviewResult?.responseEnvelope
				? shell.router.relayReviewVerdictToVerifier(
						reviewResult.responseEnvelope,
						["npm.cmd run verify:not-real"],
						"unsupported_pack",
				  )
				: null
		const verificationFailPayload = asRecord(verificationFailResult?.responseEnvelope?.payload)
		const verificationFailDelivered =
			verificationFailResult?.status === "delivered" &&
			verificationFailResult.responseEnvelope?.messageType === "verification_fail" &&
			verificationFailPayload?.["accepted"] === false &&
			verificationFailPayload?.["reason"] === "proof_command_not_allowed"

		const proofDispatchBounded =
			executedCommands.join(",") === "npm.cmd run verify:queenbee:jsts:small" &&
			Array.isArray(verificationFailPayload?.["results"]) &&
			(verificationFailPayload?.["results"] as unknown[]).length === 0

		details.push(
			`implementedEdges=${shell.router.listImplementedEdges().join(",")}`,
			`candidates=${candidateBeeIds.join(",") || "missing"}`,
			`reviewType=${reviewResult?.responseEnvelope?.messageType ?? "missing"}`,
			`verificationPassType=${verificationPassResult?.responseEnvelope?.messageType ?? "missing"}`,
			`verificationFailReason=${String(verificationFailPayload?.["reason"] ?? "missing")}`,
			`executedCommands=${executedCommands.join(",") || "missing"}`,
		)

		return {
			verifierDocsPresent,
			packageScriptPresent,
			verifierEdgesImplemented,
			verificationPassDelivered,
			verificationFailDelivered,
			proofDispatchBounded,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeJstsVerifyHarnessResult(result: QueenBeeJstsVerifyHarnessResult): string {
	return [
		`Verifier docs present: ${result.verifierDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Verifier edges implemented: ${result.verifierEdgesImplemented ? "PASS" : "FAIL"}`,
		`Verification pass delivered: ${result.verificationPassDelivered ? "PASS" : "FAIL"}`,
		`Verification fail delivered: ${result.verificationFailDelivered ? "PASS" : "FAIL"}`,
		`Proof dispatch bounded: ${result.proofDispatchBounded ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeJstsVerifyHarness()
	console.log(formatQueenBeeJstsVerifyHarnessResult(result))
	process.exit(
		result.verifierDocsPresent &&
			result.packageScriptPresent &&
			result.verifierEdgesImplemented &&
			result.verificationPassDelivered &&
			result.verificationFailDelivered &&
			result.proofDispatchBounded
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:jsts:verify] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
