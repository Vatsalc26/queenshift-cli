import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import type { QueenBeeVerifierExecutor } from "../src/queenbee/VerifierBee"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeJstsAsyncHarnessResult = {
	asyncDocsPresent: boolean
	reverseEngineeringDocsPresent: boolean
	packageScriptPresent: boolean
	asyncSpecialistListed: boolean
	asyncSelected: boolean
	assignmentDelivered: boolean
	reviewAndProofDelivered: boolean
	mergeAndArchiveDelivered: boolean
	asyncSummaryVisible: boolean
	routeSlotStayedGeneric: boolean
	parallelNeedStayedSingleton: boolean
	proposalStayedScoped: boolean
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

export async function runQueenBeeJstsAsyncHarness(rootDir = resolveRootDir()): Promise<QueenBeeJstsAsyncHarnessResult> {
	const details: string[] = []
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const registryText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const reverseEngineeringMapText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const envelopesText = readText(rootDir, "QUEENBEE_BEE_OPERATING_ENVELOPES.md")
	const parallelModelText = readText(rootDir, "QUEENBEE_PARALLEL_EXECUTION_MODEL.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }

	const asyncDocsPresent =
		includesAll(protocolMapText, [
			"## Session 209 Async Specialist Selection",
			"`JSTSCoderBee` may now select `JSTSAsyncBee`",
			"`coderSummary` should name `JSTSAsyncBee`",
			"`verify:queenbee:jsts:async`",
		]) &&
		includesAll(registryText, [
			"## Session 209 Async Specialist Runtime",
			"`JSTSAsyncBee` is now live",
			"`verify:queenbee:jsts:async`",
			"`verify:queenbee:selection`",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 209 QueenBee Async Specialist Note",
			"`JSTSAsyncBee` may now handle async-sensitive work",
			"does not yet widen QueenBee into `update_file_and_test`",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 209 lets JSTSAsyncBee beat the core default only on bounded async evidence",
			"`JSTSAsyncBee`",
			"already-scoped file evidence",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:jsts:async`", "`JSTSAsyncBee`"])
	const reverseEngineeringDocsPresent =
		includesAll(reverseEngineeringMapText, [
			"## Session 225 Async, Node, And Parallel-Pressure Answer",
			"`QB-CAN-06`",
			"`SUPPORTED` after Session 225",
			"no same-assignment clone-worker fan-out need",
		]) &&
		includesAll(gapRegisterText, [
			"`QB-GAP-225-01`",
			"`QB-GAP-225-02`",
			"`CLOSED_SESSION_225`",
		]) &&
		includesAll(envelopesText, [
			"## Session 225 Specialist Envelope Reading",
			"`JSTSAsyncBee` and `JSTSNodeBee` still stay behind the existing `queenbee.jsts_coder.001` route slot",
		]) &&
		includesAll(parallelModelText, [
			"## Session 225 Reverse-Engineering Reading",
			"`bounded_two_file_update` is the first row that pressures clone-worker language",
			"same-assignment multi-coder fan-out remains rejected",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 225 QueenBee Async, Node, And Parallel-Pressure Note",
			"`JSTSAsyncBee` is now explicitly part of the truthful answer for async-sensitive bounded rows",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 225 keeps async, Node, and first parallel-pressure rows on singleton specialist handling",
			"**Session:** 225",
		]) &&
		includesAll(verificationCatalogText, [
			"the Session 225 async, Node, and parallel-pressure reverse-engineering answer now records",
			"`bounded_two_file_update` and `bounded_node_cli_task` as singleton specialist rows",
		])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:jsts:async"] === "npm run build && node dist/verification/verify_queenbee_jsts_async.js"
	const verifierExecutor: QueenBeeVerifierExecutor = ({ command }) => ({
		command,
		exitCode: command === "npm.cmd run verify:queenbee:jsts:async" ? 0 : 1,
		passed: command === "npm.cmd run verify:queenbee:jsts:async",
		outputSummary: command === "npm.cmd run verify:queenbee:jsts:async" ? "queenbee:jsts:async PASS" : "async stub failure",
	})

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-jsts-async")
	try {
		const utilsPath = path.join(fixture.repoPath, "utils.ts")
		const beforeUtils = fs.readFileSync(utilsPath, "utf8")
		fs.writeFileSync(
			utilsPath,
			`${beforeUtils}\nexport async function retryLater(delayMs: number): Promise<string> {\n\tawait new Promise((resolve) => setTimeout(resolve, delayMs))\n\treturn "later"\n}\n`,
			"utf8",
		)

		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath, verifierExecutor })
		const asyncSpecialistListed =
			shell.coder.listAvailableSpecialists().join(",") === "JSTSCoreBee,JSTSAsyncBee,JSTSNodeBee,JSTSTestBee,JSTSRefactorBee"

		const lookupEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-async-lookup",
			missionId: "mission-jsts-async-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "registry_lookup_request",
			timestamp: "2026-03-27T11:10:00Z",
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
			messageId: "msg-jsts-async-reserve",
			missionId: "mission-jsts-async-1",
			assignmentId: "assign-jsts-async-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "bee_reserve_request",
			timestamp: "2026-03-27T11:11:00Z",
			payload: {
				targetBeeId: reservedBeeId,
				assignmentId: "assign-jsts-async-1",
			},
		})
		const reserveResult = shell.router.routeEnvelope(reserveEnvelope)
		const reserved = asRecord(reserveResult.responseEnvelope?.payload)?.["reserved"] === true

		const planEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-async-plan",
			missionId: "mission-jsts-async-1",
			assignmentId: "assign-jsts-async-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-27T11:12:00Z",
			payload: {
				task: 'add the exact comment "// queenbee: async pair" to utils.ts and hello.ts while keeping the async retry timer path visible',
				taskFamily: "bounded_two_file_update",
				targetFiles: ["utils.ts", "hello.ts"],
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
				reservedBeeId,
			},
		})
		const planResult = shell.router.routeEnvelope(planEnvelope)
		const assignmentPacket = readFirstAssignmentPacket(planResult.responseEnvelope)
		const asyncSelected = assignmentPacket !== null && shell.coder.selectSpecialistForEnvelope(assignmentPacket) === "JSTSAsyncBee"
		const coderResult = assignmentPacket ? shell.router.relayPlannedAssignment(assignmentPacket) : null
		const coderPayload = asRecord(coderResult?.responseEnvelope?.payload)
		const proposals = Array.isArray(coderPayload?.["proposals"]) ? (coderPayload["proposals"] as Array<Record<string, unknown>>) : []
		const utilsProposal = proposals.find((proposal) => proposal["path"] === "utils.ts")
		const helloProposal = proposals.find((proposal) => proposal["path"] === "hello.ts")

		const assignmentDelivered =
			lookupResult.status === "delivered" &&
			reserved &&
			planResult.status === "delivered" &&
			coderResult?.status === "delivered" &&
			coderResult.edge === "RouterBee->JSTSCoderBee" &&
			coderResult.responseEnvelope?.messageType === "work_result" &&
			coderPayload?.["accepted"] === true &&
			proposals.length === 2
		const reviewResult = coderResult?.responseEnvelope ? shell.router.relayCoderWorkResult(coderResult.responseEnvelope) : null
		const reviewPayload = asRecord(reviewResult?.responseEnvelope?.payload)
		const verificationResult =
			reviewResult?.responseEnvelope
				? shell.router.relayReviewVerdictToVerifier(
						reviewResult.responseEnvelope,
						["npm.cmd run verify:queenbee:jsts:async"],
						"daily_jsts_matrix_async_two_file_pack",
				  )
				: null
		const verificationPayload = asRecord(verificationResult?.responseEnvelope?.payload)
		const reviewAndProofDelivered =
			reviewResult?.status === "delivered" &&
			reviewResult.responseEnvelope?.messageType === "review_pass" &&
			reviewPayload?.["accepted"] === true &&
			verificationResult?.status === "delivered" &&
			verificationResult.responseEnvelope?.messageType === "verification_pass" &&
			verificationPayload?.["accepted"] === true &&
			Array.isArray(verificationPayload?.["results"]) &&
			(verificationPayload?.["results"] as Array<Record<string, unknown>>).length === 1 &&
			(verificationPayload?.["results"] as Array<Record<string, unknown>>)[0]?.["command"] === "npm.cmd run verify:queenbee:jsts:async" &&
			typeof verificationPayload?.["verifierSummary"] === "string" &&
			String(verificationPayload["verifierSummary"]).includes("daily_jsts_matrix_async_two_file_pack") &&
			String(verificationPayload["verifierSummary"]).includes("npm.cmd run verify:queenbee:jsts:async")
		const mergeResult =
			verificationResult?.responseEnvelope && coderResult?.responseEnvelope
				? shell.router.relayVerificationVerdictToMerge(verificationResult.responseEnvelope, coderResult.responseEnvelope)
				: null
		const mergePayload = asRecord(mergeResult?.responseEnvelope?.payload)
		const afterUtils = fs.readFileSync(utilsPath, "utf8")
		const afterHello = fs.readFileSync(path.join(fixture.repoPath, "hello.ts"), "utf8")
		const archiveResult = mergeResult?.responseEnvelope ? shell.router.relayMergeResultToArchivist(mergeResult.responseEnvelope) : null
		const archivePayload = asRecord(archiveResult?.responseEnvelope?.payload)
		const archivePath = typeof archivePayload?.["archivePath"] === "string" ? archivePayload["archivePath"] : ""
		const archiveAbsolutePath = archivePath ? path.join(fixture.repoPath, archivePath) : ""
		const archiveJson =
			archiveAbsolutePath && fs.existsSync(archiveAbsolutePath)
				? (JSON.parse(fs.readFileSync(archiveAbsolutePath, "utf8")) as Record<string, unknown>)
				: null
		const mergeAndArchiveDelivered =
			mergeResult?.status === "delivered" &&
			mergeResult.responseEnvelope?.messageType === "merge_pass" &&
			mergePayload?.["accepted"] === true &&
			afterUtils.includes("// queenbee: async pair") &&
			afterHello.includes("// queenbee: async pair") &&
			archiveResult?.status === "delivered" &&
			archiveResult.responseEnvelope?.messageType === "archive_written" &&
			archivePath === ".swarm/queenbee_archive/assign-jsts-async-1.json" &&
			Array.isArray(archiveJson?.["changedFiles"]) &&
			(archiveJson?.["changedFiles"] as string[]).join(",") === "utils.ts,hello.ts" &&
			Array.isArray(archiveJson?.["proofCommands"]) &&
			(archiveJson?.["proofCommands"] as string[]).join(",") === "npm.cmd run verify:queenbee:jsts:async" &&
			typeof archiveJson?.["verifierSummary"] === "string" &&
			String(archiveJson["verifierSummary"]).includes("daily_jsts_matrix_async_two_file_pack")
		const asyncSummaryVisible = typeof coderPayload?.["coderSummary"] === "string" && String(coderPayload["coderSummary"]).includes("JSTSAsyncBee")
		const routeSlotStayedGeneric =
			reservedBeeId === "queenbee.jsts_coder.001" &&
			assignmentPacket?.recipientBeeId === "queenbee.jsts_coder.001" &&
			shell.router.listImplementedEdges().includes("RouterBee->JSTSCoderBee") &&
			shell.router.listImplementedEdges().includes("JSTSCoderBee->RouterBee")
		const parallelNeedStayedSingleton =
			reverseEngineeringDocsPresent &&
			routeSlotStayedGeneric &&
			includesAll(reverseEngineeringMapText, ["`QB-CAN-06`", "one routed specialist slot", "no same-assignment clone-worker fan-out need"]) &&
			includesAll(gapRegisterText, ["`QB-GAP-225-02`", "`CLOSED_SESSION_225`"])

		const tooWideEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-async-too-wide",
			missionId: "mission-jsts-async-2",
			assignmentId: "assign-jsts-async-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-27T11:13:00Z",
			payload: {
				task: "update utils.ts and hello.ts together while preserving the async retry timeout behavior",
				taskFamily: "bounded_two_file_update",
				languagePack: "js_ts",
				allowedFiles: ["utils.ts", "hello.ts", "math.ts"],
				forbiddenFiles: ["package.json"],
				expectedResult: "bounded_two_file_update",
				plannerSummary: "PlannerBee emitted 1 assignment packet for bounded_two_file_update over utils.ts, hello.ts, math.ts.",
				requiresReview: true,
				requiresVerification: true,
			},
		})
		const tooWideResult = shell.router.routeEnvelope(tooWideEnvelope)
		const tooWidePayload = asRecord(tooWideResult.responseEnvelope?.payload)
		const proposalStayedScoped =
			(coderPayload?.["proposalCount"] as number) === 2 &&
			Array.isArray(coderPayload?.["changedFiles"]) &&
			(coderPayload?.["changedFiles"] as string[]).join(",") === "utils.ts,hello.ts" &&
			typeof utilsProposal?.["afterContent"] === "string" &&
			String(utilsProposal?.["afterContent"]).includes("// queenbee: async pair") &&
			typeof helloProposal?.["afterContent"] === "string" &&
			String(helloProposal?.["afterContent"]).includes("// queenbee: async pair") &&
			tooWideResult.status === "delivered" &&
			tooWidePayload?.["accepted"] === false &&
			tooWidePayload?.["reason"] === "coder_target_count_out_of_bounds" &&
			typeof tooWidePayload?.["coderSummary"] === "string" &&
			String(tooWidePayload["coderSummary"]).includes("JSTSAsyncBee")

		details.push(
			`specialists=${shell.coder.listAvailableSpecialists().join(",") || "missing"}`,
			`lookupCandidates=${candidateBeeIds.join(",") || "missing"}`,
			`assignmentRecipient=${assignmentPacket?.recipientBeeId ?? "missing"}`,
			`coderSummary=${String(coderPayload?.["coderSummary"] ?? "missing")}`,
			`reviewType=${reviewResult?.responseEnvelope?.messageType ?? "missing"}`,
			`verificationType=${verificationResult?.responseEnvelope?.messageType ?? "missing"}`,
			`mergeType=${mergeResult?.responseEnvelope?.messageType ?? "missing"}`,
			`archivePath=${archivePath || "missing"}`,
			`tooWideReason=${String(tooWidePayload?.["reason"] ?? "missing")}`,
		)

		return {
			asyncDocsPresent,
			reverseEngineeringDocsPresent,
			packageScriptPresent,
			asyncSpecialistListed,
			asyncSelected,
			assignmentDelivered,
			reviewAndProofDelivered,
			mergeAndArchiveDelivered,
			asyncSummaryVisible,
			routeSlotStayedGeneric,
			parallelNeedStayedSingleton,
			proposalStayedScoped,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeJstsAsyncHarnessResult(result: QueenBeeJstsAsyncHarnessResult): string {
	return [
		`Async docs present: ${result.asyncDocsPresent ? "PASS" : "FAIL"}`,
		`Reverse-engineering docs present: ${result.reverseEngineeringDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Async specialist listed: ${result.asyncSpecialistListed ? "PASS" : "FAIL"}`,
		`Async selected: ${result.asyncSelected ? "PASS" : "FAIL"}`,
		`Assignment delivered: ${result.assignmentDelivered ? "PASS" : "FAIL"}`,
		`Review and proof delivered: ${result.reviewAndProofDelivered ? "PASS" : "FAIL"}`,
		`Merge and archive delivered: ${result.mergeAndArchiveDelivered ? "PASS" : "FAIL"}`,
		`Async summary visible: ${result.asyncSummaryVisible ? "PASS" : "FAIL"}`,
		`Route slot stayed generic: ${result.routeSlotStayedGeneric ? "PASS" : "FAIL"}`,
		`Parallel need stayed singleton: ${result.parallelNeedStayedSingleton ? "PASS" : "FAIL"}`,
		`Proposal stayed scoped: ${result.proposalStayedScoped ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeJstsAsyncHarness()
	console.log(formatQueenBeeJstsAsyncHarnessResult(result))
	process.exit(
		result.asyncDocsPresent &&
			result.reverseEngineeringDocsPresent &&
			result.packageScriptPresent &&
			result.asyncSpecialistListed &&
			result.asyncSelected &&
			result.assignmentDelivered &&
			result.reviewAndProofDelivered &&
			result.mergeAndArchiveDelivered &&
			result.asyncSummaryVisible &&
			result.routeSlotStayedGeneric &&
			result.parallelNeedStayedSingleton &&
			result.proposalStayedScoped
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:jsts:async] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
