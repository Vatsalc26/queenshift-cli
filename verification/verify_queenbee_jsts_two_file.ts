import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import type { QueenBeeVerifierExecutor } from "../src/queenbee/VerifierBee"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeJstsTwoFileHarnessResult = {
	twoFileDocsPresent: boolean
	packageScriptPresent: boolean
	refactorSelectedForTwoFile: boolean
	twoFileProposalDelivered: boolean
	twoFileReviewDelivered: boolean
	twoFileVerificationDelivered: boolean
	twoFileMergeDelivered: boolean
	archiveWritten: boolean
	threeFileBoundPreserved: boolean
	taskText: string
	candidateBeeIds: string[]
	assignmentPacketSender: string | null
	proposalPaths: string[]
	reviewType: string | null
	verificationCommand: string | null
	mergeType: string | null
	archivePath: string | null
	tooWideReason: string | null
	details: string[]
}

export const QUEENBEE_JSTS_TWO_FILE_TASK = 'add the exact comment "// queenbee: two-file pass" to hello.ts and utils.ts'

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

export async function runQueenBeeJstsTwoFileHarness(rootDir = resolveRootDir()): Promise<QueenBeeJstsTwoFileHarnessResult> {
	const details: string[] = []
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const toolGrantText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}

	const twoFileDocsPresent =
		includesAll(messageSchemaText, [
			"## Session 197 Two-File Coordination Shell",
			"`bounded_two_file_update`",
			"two explicit JS/TS files",
			"`review_rework`",
		]) &&
		includesAll(protocolMapText, [
			"## Session 197 Runtime Two-File Coordination",
			"`bounded_two_file_update`",
			"`RouterBee -> PlannerBee -> JSTSCoderBee -> JSTSReviewerBee -> VerifierBee -> MergeBee -> ArchivistBee`",
			"`verify:queenbee:jsts:two-file`",
		]) &&
		includesAll(firstSliceText, [
			"## Session 197 Two-File Coordination Rule",
			"`bounded_two_file_update`",
			"`verify:queenbee:jsts:two-file`",
			"`verify:lane:medium`",
		]) &&
		includesAll(toolGrantText, [
			"## Session 197 Two-File Coordination Grant Rule",
			"`JSTSCoderBee`",
			"`MergeBee`",
			"`verify:queenbee:jsts:two-file`",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 197 QueenBee Candidate Note",
			"`bounded_two_file_update`",
			"`swarmengine` stays the shipped bounded engine",
		]) &&
		includesAll(architectureText, [
			"## Decision: QueenBee bounded two-file coordination reuses the same shell without widening public claims",
			"**Session:** 197",
		]) &&
		includesAll(verificationCatalogText, [
			"`npm.cmd run verify:queenbee:jsts:two-file`",
			"`bounded_two_file_update` explicit, proposal-first, reviewable, and candidate-only",
		])
	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:jsts:two-file"] === "npm run build && node dist/verification/verify_queenbee_jsts_two_file.js"

	const verifierExecutor: QueenBeeVerifierExecutor = ({ command }) => ({
		command,
		exitCode: command === "npm.cmd run verify:queenbee:jsts:two-file" ? 0 : 1,
		passed: command === "npm.cmd run verify:queenbee:jsts:two-file",
		outputSummary: command === "npm.cmd run verify:queenbee:jsts:two-file" ? "queenbee:jsts:two-file PASS" : "two-file stub failure",
	})

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-jsts-two-file")
	try {
		const helloPath = path.join(fixture.repoPath, "hello.ts")
		const utilsPath = path.join(fixture.repoPath, "utils.ts")
		const beforeHello = fs.readFileSync(helloPath, "utf8")
		const beforeUtils = fs.readFileSync(utilsPath, "utf8")
		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath, verifierExecutor })

		const lookupEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-two-file-lookup",
			missionId: "mission-jsts-two-file-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "registry_lookup_request",
			timestamp: "2026-03-26T17:10:00Z",
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
			messageId: "msg-jsts-two-file-reserve",
			missionId: "mission-jsts-two-file-1",
			assignmentId: "assign-jsts-two-file-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "bee_reserve_request",
			timestamp: "2026-03-26T17:11:00Z",
			payload: {
				targetBeeId: reservedBeeId,
				assignmentId: "assign-jsts-two-file-1",
			},
		})
		const reserveResult = shell.router.routeEnvelope(reserveEnvelope)
		const reserved = asRecord(reserveResult.responseEnvelope?.payload)?.["reserved"] === true

		const planEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-two-file-plan",
			missionId: "mission-jsts-two-file-1",
			assignmentId: "assign-jsts-two-file-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-26T17:12:00Z",
			payload: {
				task: QUEENBEE_JSTS_TWO_FILE_TASK,
				taskFamily: "bounded_two_file_update",
				targetFiles: ["hello.ts", "utils.ts"],
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
				reservedBeeId,
			},
		})
		const planResult = shell.router.routeEnvelope(planEnvelope)
		const assignmentPacket = readFirstAssignmentPacket(planResult.responseEnvelope)
		const refactorSelectedForTwoFile =
			assignmentPacket !== null && shell.coder.selectSpecialistForEnvelope(assignmentPacket) === "JSTSRefactorBee"
		const coderResult = assignmentPacket ? shell.router.relayPlannedAssignment(assignmentPacket) : null
		const coderPayload = asRecord(coderResult?.responseEnvelope?.payload)
		const proposals = Array.isArray(coderPayload?.["proposals"]) ? (coderPayload["proposals"] as Array<Record<string, unknown>>) : []
		const proposalPaths = proposals.map((proposal) => String(asRecord(proposal)?.["path"] ?? "missing"))
		const afterCoderHello = fs.readFileSync(helloPath, "utf8")
		const afterCoderUtils = fs.readFileSync(utilsPath, "utf8")
		const twoFileProposalDelivered =
			lookupResult.status === "delivered" &&
			reserved &&
			planResult.status === "delivered" &&
			coderResult?.status === "delivered" &&
			coderResult.responseEnvelope?.messageType === "work_result" &&
			coderPayload?.["accepted"] === true &&
			(coderPayload?.["proposalCount"] as number) === 2 &&
			Array.isArray(coderPayload?.["changedFiles"]) &&
			(coderPayload?.["changedFiles"] as string[]).join(",") === "hello.ts,utils.ts" &&
			proposalPaths.join(",") === "hello.ts,utils.ts" &&
			afterCoderHello === beforeHello &&
			afterCoderUtils === beforeUtils

		const reviewResult = coderResult?.responseEnvelope ? shell.router.relayCoderWorkResult(coderResult.responseEnvelope) : null
		const reviewPayload = asRecord(reviewResult?.responseEnvelope?.payload)
		const twoFileReviewDelivered =
			reviewResult?.status === "delivered" &&
			reviewResult.responseEnvelope?.messageType === "review_pass" &&
			reviewPayload?.["accepted"] === true &&
			Array.isArray(reviewPayload?.["changedFiles"]) &&
			(reviewPayload?.["changedFiles"] as string[]).join(",") === "hello.ts,utils.ts"

		const verificationResult =
			reviewResult?.responseEnvelope
				? shell.router.relayReviewVerdictToVerifier(
						reviewResult.responseEnvelope,
						["npm.cmd run verify:queenbee:jsts:two-file"],
						"daily_jsts_matrix_two_file_pack",
				  )
				: null
		const verificationPayload = asRecord(verificationResult?.responseEnvelope?.payload)
		const verificationRows = Array.isArray(verificationPayload?.["results"]) ? (verificationPayload["results"] as Array<Record<string, unknown>>) : []
		const twoFileVerificationDelivered =
			verificationResult?.status === "delivered" &&
			verificationResult.responseEnvelope?.messageType === "verification_pass" &&
			verificationPayload?.["accepted"] === true &&
			verificationRows.length === 1 &&
			verificationRows[0]?.["command"] === "npm.cmd run verify:queenbee:jsts:two-file" &&
			typeof verificationPayload?.["verifierSummary"] === "string" &&
			String(verificationPayload["verifierSummary"]).includes("daily_jsts_matrix_two_file_pack") &&
			String(verificationPayload["verifierSummary"]).includes("npm.cmd run verify:queenbee:jsts:two-file")

		const mergeResult =
			verificationResult?.responseEnvelope && coderResult?.responseEnvelope
				? shell.router.relayVerificationVerdictToMerge(verificationResult.responseEnvelope, coderResult.responseEnvelope)
				: null
		const mergePayload = asRecord(mergeResult?.responseEnvelope?.payload)
		const afterMergeHello = fs.readFileSync(helloPath, "utf8")
		const afterMergeUtils = fs.readFileSync(utilsPath, "utf8")
		const twoFileMergeDelivered =
			mergeResult?.status === "delivered" &&
			mergeResult.responseEnvelope?.messageType === "merge_pass" &&
			mergePayload?.["accepted"] === true &&
			afterMergeHello.includes("// queenbee: two-file pass") &&
			afterMergeUtils.includes("// queenbee: two-file pass")

		const archiveResult = mergeResult?.responseEnvelope ? shell.router.relayMergeResultToArchivist(mergeResult.responseEnvelope) : null
		const archivePayload = asRecord(archiveResult?.responseEnvelope?.payload)
		const archivePath = typeof archivePayload?.["archivePath"] === "string" ? archivePayload["archivePath"] : ""
		const archiveAbsolutePath = archivePath ? path.join(fixture.repoPath, archivePath) : ""
		const archiveJson =
			archiveAbsolutePath && fs.existsSync(archiveAbsolutePath)
				? (JSON.parse(fs.readFileSync(archiveAbsolutePath, "utf8")) as Record<string, unknown>)
				: null
		const archiveWritten =
			archiveResult?.status === "delivered" &&
			archiveResult.responseEnvelope?.messageType === "archive_written" &&
			archivePath === ".swarm/queenbee_archive/assign-jsts-two-file-1.json" &&
			Array.isArray(archiveJson?.["changedFiles"]) &&
			(archiveJson?.["changedFiles"] as string[]).join(",") === "hello.ts,utils.ts" &&
			Array.isArray(archiveJson?.["proofCommands"]) &&
			(archiveJson?.["proofCommands"] as string[]).join(",") === "npm.cmd run verify:queenbee:jsts:two-file" &&
			typeof archiveJson?.["verifierSummary"] === "string" &&
			String(archiveJson["verifierSummary"]).includes("daily_jsts_matrix_two_file_pack")

		const tooWideEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-two-file-too-wide",
			missionId: "mission-jsts-two-file-2",
			assignmentId: "assign-jsts-two-file-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-26T17:13:00Z",
			payload: {
				task: "update hello.ts, utils.ts, and package.json together",
				taskFamily: "bounded_two_file_update",
				languagePack: "js_ts",
				allowedFiles: ["hello.ts", "utils.ts", "package.json"],
				forbiddenFiles: [],
				expectedResult: "bounded_two_file_update",
				plannerSummary: "PlannerBee emitted 1 assignment packet for bounded_two_file_update over hello.ts, utils.ts, package.json.",
				requiresReview: true,
				requiresVerification: true,
			},
		})
		const tooWideResult = shell.router.routeEnvelope(tooWideEnvelope)
		const tooWidePayload = asRecord(tooWideResult.responseEnvelope?.payload)
		const threeFileBoundPreserved =
			tooWideResult.status === "delivered" &&
			tooWideResult.responseEnvelope?.messageType === "work_result" &&
			tooWidePayload?.["accepted"] === false &&
			tooWidePayload?.["reason"] === "coder_target_count_out_of_bounds"

		details.push(
			`candidates=${candidateBeeIds.join(",") || "missing"}`,
			`assignmentPacketSender=${assignmentPacket?.senderBeeId ?? "missing"}`,
			`proposalPaths=${proposalPaths.join(",") || "missing"}`,
			`reviewType=${reviewResult?.responseEnvelope?.messageType ?? "missing"}`,
			`verificationCommand=${String(verificationRows[0]?.["command"] ?? "missing")}`,
			`mergeType=${mergeResult?.responseEnvelope?.messageType ?? "missing"}`,
			`archivePath=${archivePath || "missing"}`,
			`tooWideReason=${String(tooWidePayload?.["reason"] ?? "missing")}`,
		)

		return {
			twoFileDocsPresent,
			packageScriptPresent,
			refactorSelectedForTwoFile,
			twoFileProposalDelivered,
			twoFileReviewDelivered,
			twoFileVerificationDelivered,
			twoFileMergeDelivered,
			archiveWritten,
			threeFileBoundPreserved,
			taskText: QUEENBEE_JSTS_TWO_FILE_TASK,
			candidateBeeIds,
			assignmentPacketSender: assignmentPacket?.senderBeeId ?? null,
			proposalPaths: proposalPaths.filter((proposalPath) => proposalPath !== "missing"),
			reviewType: reviewResult?.responseEnvelope?.messageType ?? null,
			verificationCommand: typeof verificationRows[0]?.["command"] === "string" ? String(verificationRows[0]?.["command"]) : null,
			mergeType: mergeResult?.responseEnvelope?.messageType ?? null,
			archivePath: archivePath || null,
			tooWideReason: typeof tooWidePayload?.["reason"] === "string" ? tooWidePayload["reason"] : null,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeJstsTwoFileHarnessResult(result: QueenBeeJstsTwoFileHarnessResult): string {
	return [
		`Two-file docs present: ${result.twoFileDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Refactor selected for two-file: ${result.refactorSelectedForTwoFile ? "PASS" : "FAIL"}`,
		`Two-file proposal delivered: ${result.twoFileProposalDelivered ? "PASS" : "FAIL"}`,
		`Two-file review delivered: ${result.twoFileReviewDelivered ? "PASS" : "FAIL"}`,
		`Two-file verification delivered: ${result.twoFileVerificationDelivered ? "PASS" : "FAIL"}`,
		`Two-file merge delivered: ${result.twoFileMergeDelivered ? "PASS" : "FAIL"}`,
		`Archive written: ${result.archiveWritten ? "PASS" : "FAIL"}`,
		`Three-file bound preserved: ${result.threeFileBoundPreserved ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeJstsTwoFileHarness()
	console.log(formatQueenBeeJstsTwoFileHarnessResult(result))
	process.exit(
		result.twoFileDocsPresent &&
			result.packageScriptPresent &&
			result.refactorSelectedForTwoFile &&
			result.twoFileProposalDelivered &&
			result.twoFileReviewDelivered &&
			result.twoFileVerificationDelivered &&
			result.twoFileMergeDelivered &&
			result.archiveWritten &&
			result.threeFileBoundPreserved
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:jsts:two-file] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
