import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import type { QueenBeeVerifierExecutor } from "../src/queenbee/VerifierBee"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeJstsCompleteHarnessResult = {
	completionDocsPresent: boolean
	reverseEngineeringDocsPresent: boolean
	packageScriptPresent: boolean
	completionEdgesImplemented: boolean
	mergePassDelivered: boolean
	archiveWritten: boolean
	tinyFileCompletionDelivered: boolean
	smallRowsStaySingleWorker: boolean
	driftBlocked: boolean
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

function readCandidateBeeIds(envelope: QueenBeeEnvelope | null): string[] {
	const payload = asRecord(envelope?.payload)
	return Array.isArray(payload?.["candidateBeeIds"]) ? (payload["candidateBeeIds"] as string[]) : []
}

export async function runQueenBeeJstsCompleteHarness(rootDir = resolveRootDir()): Promise<QueenBeeJstsCompleteHarnessResult> {
	const details: string[] = []
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const toolGrantText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const failureRulesText = readText(rootDir, "QUEENBEE_FAILURE_AND_QUARANTINE_RULES.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const reverseEngineeringMapText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const traceabilityText = readText(rootDir, "QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
	const confidenceContractText = readText(rootDir, "QUEENBEE_OPERATOR_CONFIDENCE_CONTRACT.md")
	const liveEvidencePackText = readText(rootDir, "QUEENBEE_LIVE_EVIDENCE_PACK.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}

	const completionDocsPresent =
		includesAll(messageSchemaText, [
			"## Session 196 Completion Shell",
			"`merge_request`",
			"`merge_pass`",
			"`merge_blocked`",
			"`archive_request`",
			"`archive_written`",
		]) &&
		includesAll(protocolMapText, [
			"## Session 196 Runtime Completion",
			"`RouterBee -> MergeBee`",
			"`MergeBee -> RouterBee`",
			"`RouterBee -> ArchivistBee`",
			"`ArchivistBee -> RouterBee`",
		]) &&
		includesAll(firstSliceText, [
			"## Session 196 Completion Rule",
			"`verify:queenbee:jsts:complete`",
			"`MergeBee`",
			"`ArchivistBee`",
		]) &&
		includesAll(toolGrantText, [
			"## Session 196 Completion Grant Rule",
			"`git_merge`",
			"`artifact_write`",
			"`verify:queenbee:jsts:complete`",
		]) &&
		includesAll(failureRulesText, [
			"## Session 196 Completion Failure Rule",
			"`merge_failure`",
			"`merge_blocked`",
		]) &&
		includesAll(architectureText, [
			"## Decision: QueenBee completion stays drift-aware, one-file, and artifact-backed",
			"**Session:** 196",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:jsts:complete`", "bounded merge plus one explicit completion artifact"])
	const reverseEngineeringDocsPresent =
		includesAll(reverseEngineeringMapText, [
			"`QB-CAN-02`",
			"`SUPPORTED`",
			"create-safe merge",
		]) &&
		includesAll(gapRegisterText, [
			"`QB-GAP-223-01`",
			"`CLOSED_SESSION_232`",
			"`create_tiny_file`",
		]) &&
		includesAll(traceabilityText, [
			"`QB-TR-01`",
			"`QB-TR-02`",
			"`QB-TR-07`",
			"`verify:queenbee:file-creation`",
			"`verify:queenbee:create-complete`",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 232 closes the bounded create_tiny_file lane with create-safe merge and archive proof",
			"**Session:** 232",
		]) &&
		includesAll(verificationCatalogText, [
			"`npm.cmd run verify:queenbee:create-complete`",
			"create-safe merge and archive completion lane",
			"the Session 277 daily JS/TS matrix quality-confidence lane now carries row-specific review wording",
		]) &&
		includesAll(confidenceContractText, [
			"## Session 277 Daily Matrix Verification Confidence",
			"verifier and archive summaries",
			"`verify:queenbee:jsts:node`",
		]) &&
		includesAll(liveEvidencePackText, [
			"## Session 277 Daily Matrix Artifact Confidence",
			"row-specific review surface and exact proof bundle together",
			"generic `guardrails` or `lane:medium` wording is no longer enough",
		])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:jsts:complete"] === "npm run build && node dist/verification/verify_queenbee_jsts_complete.js"

	const verifierExecutor: QueenBeeVerifierExecutor = ({ command }) => ({
		command,
		exitCode: command === "npm.cmd run verify:queenbee:jsts:small" ? 0 : 1,
		passed: command === "npm.cmd run verify:queenbee:jsts:small",
		outputSummary: command === "npm.cmd run verify:queenbee:jsts:small" ? "queenbee:jsts:small PASS" : "completion stub failure",
	})

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-jsts-complete")
	try {
		const helloPath = path.join(fixture.repoPath, "hello.ts")
		const utilsPath = path.join(fixture.repoPath, "utils.ts")
		const beforeHelloDisk = fs.readFileSync(helloPath, "utf8")
		const commentShell = createQueenBeeShell({ workspaceRoot: fixture.repoPath, verifierExecutor })
		const namedShell = createQueenBeeShell({ workspaceRoot: fixture.repoPath, verifierExecutor })
		const mergeShell = createQueenBeeShell({ workspaceRoot: fixture.repoPath, verifierExecutor })

		const completionEdgesImplemented =
			commentShell.router.listImplementedEdges().includes("RouterBee->MergeBee") &&
			commentShell.router.listImplementedEdges().includes("MergeBee->RouterBee") &&
			commentShell.router.listImplementedEdges().includes("RouterBee->ArchivistBee") &&
			commentShell.router.listImplementedEdges().includes("ArchivistBee->RouterBee")

		const commentLookupResult = commentShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-complete-lookup",
				missionId: "mission-jsts-complete-1",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.registry.001",
				messageType: "registry_lookup_request",
				timestamp: "2026-03-28T02:10:00Z",
				payload: {
					desiredRoleFamily: "coder",
					desiredLanguagePack: "js_ts",
					requiredToolFamilies: ["repo_edit"],
				},
			}),
		)
		const commentCandidateBeeIds = readCandidateBeeIds(commentLookupResult.responseEnvelope)
		const commentReservedBeeId = commentCandidateBeeIds[0] ?? ""

		const commentReserveResult = commentShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-complete-reserve",
				missionId: "mission-jsts-complete-1",
				assignmentId: "assign-jsts-complete-1",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.registry.001",
				messageType: "bee_reserve_request",
				timestamp: "2026-03-28T02:11:00Z",
				payload: {
					targetBeeId: commentReservedBeeId,
					assignmentId: "assign-jsts-complete-1",
				},
			}),
		)
		const commentReserved = asRecord(commentReserveResult.responseEnvelope?.payload)?.["reserved"] === true

		const commentPlanResult = commentShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-complete-plan",
				missionId: "mission-jsts-complete-1",
				assignmentId: "assign-jsts-complete-1",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.planner.001",
				messageType: "plan_request",
				timestamp: "2026-03-28T02:12:00Z",
				payload: {
					task: 'add the exact comment "// queenbee: complete pass" to hello.ts',
					taskFamily: "comment_file",
					targetFiles: ["hello.ts"],
					languagePack: "js_ts",
					protectedFiles: ["package.json"],
					reservedBeeId: commentReservedBeeId,
				},
			}),
		)
		const commentAssignmentPacket = readFirstAssignmentPacket(commentPlanResult.responseEnvelope)
		const commentCoderResult = commentAssignmentPacket ? commentShell.router.relayPlannedAssignment(commentAssignmentPacket) : null
		const commentReviewResult = commentCoderResult?.responseEnvelope ? commentShell.router.relayCoderWorkResult(commentCoderResult.responseEnvelope) : null
		const commentVerificationResult =
			commentReviewResult?.responseEnvelope
				? commentShell.router.relayReviewVerdictToVerifier(
						commentReviewResult.responseEnvelope,
						["npm.cmd run verify:queenbee:jsts:small"],
						"daily_jsts_matrix_comment_completion_pack",
				  )
				: null
		const commentMergeResult =
			commentVerificationResult?.responseEnvelope && commentCoderResult?.responseEnvelope
				? commentShell.router.relayVerificationVerdictToMerge(commentVerificationResult.responseEnvelope, commentCoderResult.responseEnvelope)
				: null
		const commentMergePayload = asRecord(commentMergeResult?.responseEnvelope?.payload)
		const afterHelloDisk = fs.readFileSync(helloPath, "utf8")
		const commentMergeDelivered =
			commentLookupResult.status === "delivered" &&
			commentReserved &&
			commentPlanResult.status === "delivered" &&
			commentCoderResult?.status === "delivered" &&
			commentReviewResult?.status === "delivered" &&
			commentVerificationResult?.status === "delivered" &&
			commentMergeResult?.status === "delivered" &&
			commentMergeResult.edge === "RouterBee->MergeBee" &&
			commentMergeResult.responseEnvelope?.messageType === "merge_pass" &&
			commentMergePayload?.["accepted"] === true &&
			Array.isArray(commentMergePayload?.["proofCommands"]) &&
			(commentMergePayload?.["proofCommands"] as string[]).join(",") === "npm.cmd run verify:queenbee:jsts:small" &&
			typeof commentMergePayload?.["verifierSummary"] === "string" &&
			String(commentMergePayload["verifierSummary"]).includes("daily_jsts_matrix_comment_completion_pack") &&
			afterHelloDisk.includes("// queenbee: complete pass")

		const commentArchiveResult = commentMergeResult?.responseEnvelope ? commentShell.router.relayMergeResultToArchivist(commentMergeResult.responseEnvelope) : null
		const commentArchivePayload = asRecord(commentArchiveResult?.responseEnvelope?.payload)
		const commentArchivePath = typeof commentArchivePayload?.["archivePath"] === "string" ? commentArchivePayload["archivePath"] : ""
		const commentArchiveAbsolutePath = commentArchivePath ? path.join(fixture.repoPath, commentArchivePath) : ""
		const commentArchiveJson =
			commentArchiveAbsolutePath && fs.existsSync(commentArchiveAbsolutePath)
				? (JSON.parse(fs.readFileSync(commentArchiveAbsolutePath, "utf8")) as Record<string, unknown>)
				: null
		const commentArchiveWritten =
			commentArchiveResult?.status === "delivered" &&
			commentArchiveResult.edge === "RouterBee->ArchivistBee" &&
			commentArchiveResult.responseEnvelope?.messageType === "archive_written" &&
			commentArchivePath === ".swarm/queenbee_archive/assign-jsts-complete-1.json" &&
			Array.isArray(commentArchiveJson?.["proofCommands"]) &&
			(commentArchiveJson?.["proofCommands"] as string[]).join(",") === "npm.cmd run verify:queenbee:jsts:small" &&
			Boolean(commentArchiveJson?.["mergeSummary"]) &&
			typeof commentArchiveJson?.["verifierSummary"] === "string" &&
			String(commentArchiveJson["verifierSummary"]).includes("daily_jsts_matrix_comment_completion_pack") &&
			String(commentArchiveJson["verifierSummary"]).includes("npm.cmd run verify:queenbee:jsts:small")

		const namedLookupResult = namedShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-complete-named-lookup",
				missionId: "mission-jsts-complete-2",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.registry.001",
				messageType: "registry_lookup_request",
				timestamp: "2026-03-28T02:20:00Z",
				payload: {
					desiredRoleFamily: "coder",
					desiredLanguagePack: "js_ts",
					requiredToolFamilies: ["repo_edit"],
				},
			}),
		)
		const namedCandidateBeeIds = readCandidateBeeIds(namedLookupResult.responseEnvelope)
		const namedReservedBeeId = namedCandidateBeeIds[0] ?? ""

		const namedReserveResult = namedShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-complete-named-reserve",
				missionId: "mission-jsts-complete-2",
				assignmentId: "assign-jsts-complete-2",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.registry.001",
				messageType: "bee_reserve_request",
				timestamp: "2026-03-28T02:21:00Z",
				payload: {
					targetBeeId: namedReservedBeeId,
					assignmentId: "assign-jsts-complete-2",
				},
			}),
		)
		const namedReserved = asRecord(namedReserveResult.responseEnvelope?.payload)?.["reserved"] === true

		const namedPlanResult = namedShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-complete-named-plan",
				missionId: "mission-jsts-complete-2",
				assignmentId: "assign-jsts-complete-2",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.planner.001",
				messageType: "plan_request",
				timestamp: "2026-03-28T02:22:00Z",
				payload: {
					task: 'update utils.ts so it includes the exact text "// queenbee: named complete pass"',
					taskFamily: "update_named_file",
					targetFiles: ["utils.ts"],
					languagePack: "js_ts",
					protectedFiles: ["package.json"],
					reservedBeeId: namedReservedBeeId,
				},
			}),
		)
		const namedAssignmentPacket = readFirstAssignmentPacket(namedPlanResult.responseEnvelope)
		const namedCoderResult = namedAssignmentPacket ? namedShell.router.relayPlannedAssignment(namedAssignmentPacket) : null
		const namedReviewResult = namedCoderResult?.responseEnvelope ? namedShell.router.relayCoderWorkResult(namedCoderResult.responseEnvelope) : null
		const namedVerificationResult =
			namedReviewResult?.responseEnvelope
				? namedShell.router.relayReviewVerdictToVerifier(
						namedReviewResult.responseEnvelope,
						["npm.cmd run verify:queenbee:jsts:small"],
						"daily_jsts_matrix_named_completion_pack",
				  )
				: null
		const namedMergeResult =
			namedVerificationResult?.responseEnvelope && namedCoderResult?.responseEnvelope
				? namedShell.router.relayVerificationVerdictToMerge(namedVerificationResult.responseEnvelope, namedCoderResult.responseEnvelope)
				: null
		const namedMergePayload = asRecord(namedMergeResult?.responseEnvelope?.payload)
		const afterUtilsDisk = fs.readFileSync(utilsPath, "utf8")
		const namedMergeDelivered =
			namedLookupResult.status === "delivered" &&
			namedReserved &&
			namedPlanResult.status === "delivered" &&
			namedCoderResult?.status === "delivered" &&
			namedReviewResult?.status === "delivered" &&
			namedVerificationResult?.status === "delivered" &&
			namedMergeResult?.status === "delivered" &&
			namedMergeResult.edge === "RouterBee->MergeBee" &&
			namedMergeResult.responseEnvelope?.messageType === "merge_pass" &&
			namedMergePayload?.["accepted"] === true &&
			Array.isArray(namedMergePayload?.["proofCommands"]) &&
			(namedMergePayload?.["proofCommands"] as string[]).join(",") === "npm.cmd run verify:queenbee:jsts:small" &&
			typeof namedMergePayload?.["verifierSummary"] === "string" &&
			String(namedMergePayload["verifierSummary"]).includes("daily_jsts_matrix_named_completion_pack") &&
			afterUtilsDisk.includes("// queenbee: named complete pass")

		const namedArchiveResult = namedMergeResult?.responseEnvelope ? namedShell.router.relayMergeResultToArchivist(namedMergeResult.responseEnvelope) : null
		const namedArchivePayload = asRecord(namedArchiveResult?.responseEnvelope?.payload)
		const namedArchivePath = typeof namedArchivePayload?.["archivePath"] === "string" ? namedArchivePayload["archivePath"] : ""
		const namedArchiveAbsolutePath = namedArchivePath ? path.join(fixture.repoPath, namedArchivePath) : ""
		const namedArchiveJson =
			namedArchiveAbsolutePath && fs.existsSync(namedArchiveAbsolutePath)
				? (JSON.parse(fs.readFileSync(namedArchiveAbsolutePath, "utf8")) as Record<string, unknown>)
				: null
		const namedArchiveWritten =
			namedArchiveResult?.status === "delivered" &&
			namedArchiveResult.edge === "RouterBee->ArchivistBee" &&
			namedArchiveResult.responseEnvelope?.messageType === "archive_written" &&
			namedArchivePath === ".swarm/queenbee_archive/assign-jsts-complete-2.json" &&
			Array.isArray(namedArchiveJson?.["proofCommands"]) &&
			(namedArchiveJson?.["proofCommands"] as string[]).join(",") === "npm.cmd run verify:queenbee:jsts:small" &&
			Boolean(namedArchiveJson?.["mergeSummary"]) &&
			typeof namedArchiveJson?.["verifierSummary"] === "string" &&
			String(namedArchiveJson["verifierSummary"]).includes("daily_jsts_matrix_named_completion_pack") &&
			String(namedArchiveJson["verifierSummary"]).includes("npm.cmd run verify:queenbee:jsts:small")

		const mergePassDelivered = commentMergeDelivered && namedMergeDelivered
		const archiveWritten = commentArchiveWritten && namedArchiveWritten

		fs.writeFileSync(helloPath, `${afterHelloDisk}\n// local drift\n`, "utf8")
		const driftBlockedResult = commentShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-complete-drift",
				missionId: "mission-jsts-complete-3",
				assignmentId: "assign-jsts-complete-3",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.merge.001",
				messageType: "merge_request",
				timestamp: "2026-03-28T02:30:00Z",
				payload: {
					changedFiles: ["hello.ts"],
					proposals: [
						{
							path: "hello.ts",
							beforeContent: beforeHelloDisk,
							afterContent: `// queenbee: drift test\n${beforeHelloDisk}`,
							changeSummary: "Attempted a stale merge over drifted workspace state.",
						},
					],
					proofCommands: ["npm.cmd run verify:guardrails"],
					verifierSummary: "VerifierBee cleared one bounded proof command.",
				},
			}),
		)
		const driftBlockedPayload = asRecord(driftBlockedResult.responseEnvelope?.payload)
		const driftBlocked =
			driftBlockedResult.status === "delivered" &&
			driftBlockedResult.responseEnvelope?.messageType === "merge_blocked" &&
			driftBlockedPayload?.["accepted"] === false &&
			driftBlockedPayload?.["reason"] === "workspace_drift_detected"

		const tinyCreatePath = path.join(fixture.repoPath, "src", "newTiny.ts")
		fs.mkdirSync(path.dirname(tinyCreatePath), { recursive: true })
		const tinyFileMergeResult = mergeShell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: "msg-jsts-complete-create-refusal",
				missionId: "mission-jsts-complete-4",
				assignmentId: "assign-jsts-complete-4",
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.merge.001",
				messageType: "merge_request",
				timestamp: "2026-03-28T02:31:00Z",
				payload: {
					changedFiles: ["src/newTiny.ts"],
					proposals: [
						{
							path: "src/newTiny.ts",
							beforeContent: "",
							afterContent: 'export const queenbeeTiny = "blocked"\n',
							changeSummary: "JSTSCoreBee prepared one bounded JS/TS new-file proposal for src/newTiny.ts.",
						},
					],
					proofCommands: ["npm.cmd run verify:guardrails"],
					verifierSummary: "VerifierBee cleared one bounded proof command.",
				},
			}),
		)
		const tinyFileMergePayload = asRecord(tinyFileMergeResult.responseEnvelope?.payload)
		const tinyFileCompletionDelivered =
			tinyFileMergeResult.status === "delivered" &&
			tinyFileMergeResult.responseEnvelope?.messageType === "merge_pass" &&
			tinyFileMergePayload?.["accepted"] === true &&
			fs.existsSync(tinyCreatePath)

		const smallRowsStaySingleWorker =
			includesAll(reverseEngineeringMapText, ["`queenbee.jsts_coder.001`", "`specialist_queue`", "no clone-worker"]) &&
			commentReservedBeeId === "queenbee.jsts_coder.001" &&
			namedReservedBeeId === "queenbee.jsts_coder.001" &&
			commentAssignmentPacket?.recipientBeeId === "queenbee.jsts_coder.001" &&
			namedAssignmentPacket?.recipientBeeId === "queenbee.jsts_coder.001"

		details.push(
			`implementedEdges=${commentShell.router.listImplementedEdges().join(",")}`,
			`commentCandidates=${commentCandidateBeeIds.join(",") || "missing"}`,
			`namedCandidates=${namedCandidateBeeIds.join(",") || "missing"}`,
			`commentArchivePath=${commentArchivePath || "missing"}`,
			`namedArchivePath=${namedArchivePath || "missing"}`,
			`driftReason=${String(driftBlockedPayload?.["reason"] ?? "missing")}`,
			`tinyFileMergeReason=${String(tinyFileMergePayload?.["reason"] ?? "missing")}`,
		)

		return {
			completionDocsPresent,
			reverseEngineeringDocsPresent,
			packageScriptPresent,
			completionEdgesImplemented,
			mergePassDelivered,
			archiveWritten,
			tinyFileCompletionDelivered,
			smallRowsStaySingleWorker,
			driftBlocked,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeJstsCompleteHarnessResult(result: QueenBeeJstsCompleteHarnessResult): string {
	return [
		`Completion docs present: ${result.completionDocsPresent ? "PASS" : "FAIL"}`,
		`Reverse-engineering docs present: ${result.reverseEngineeringDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Completion edges implemented: ${result.completionEdgesImplemented ? "PASS" : "FAIL"}`,
		`Merge pass delivered: ${result.mergePassDelivered ? "PASS" : "FAIL"}`,
		`Archive written: ${result.archiveWritten ? "PASS" : "FAIL"}`,
		`Tiny-file completion delivered: ${result.tinyFileCompletionDelivered ? "PASS" : "FAIL"}`,
		`Small rows stay single-worker: ${result.smallRowsStaySingleWorker ? "PASS" : "FAIL"}`,
		`Drift blocked: ${result.driftBlocked ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeJstsCompleteHarness()
	console.log(formatQueenBeeJstsCompleteHarnessResult(result))
	process.exit(
		result.completionDocsPresent &&
			result.reverseEngineeringDocsPresent &&
			result.packageScriptPresent &&
			result.completionEdgesImplemented &&
			result.mergePassDelivered &&
			result.archiveWritten &&
			result.tinyFileCompletionDelivered &&
			result.smallRowsStaySingleWorker &&
			result.driftBlocked
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:jsts:complete] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
