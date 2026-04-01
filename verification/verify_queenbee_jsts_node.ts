import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import type { QueenBeeVerifierExecutor } from "../src/queenbee/VerifierBee"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeJstsNodeHarnessResult = {
	nodeDocsPresent: boolean
	reverseEngineeringDocsPresent: boolean
	packageScriptPresent: boolean
	nodeSpecialistListed: boolean
	nodeSelected: boolean
	assignmentDelivered: boolean
	reviewAndProofDelivered: boolean
	mergeAndArchiveDelivered: boolean
	nodeSummaryVisible: boolean
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

export async function runQueenBeeJstsNodeHarness(rootDir = resolveRootDir()): Promise<QueenBeeJstsNodeHarnessResult> {
	const details: string[] = []
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const registryText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const reverseEngineeringMapText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const envelopesText = readText(rootDir, "QUEENBEE_BEE_OPERATING_ENVELOPES.md")
	const parallelModelText = readText(rootDir, "QUEENBEE_PARALLEL_EXECUTION_MODEL.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }

	const nodeDocsPresent =
		includesAll(protocolMapText, [
			"## Session 210 Node Specialist Selection",
			"`JSTSCoderBee` may now select `JSTSNodeBee`",
			"`bounded_node_cli_task`",
			"`verify:queenbee:jsts:node`",
		]) &&
		includesAll(registryText, [
			"## Session 210 Node Specialist Runtime",
			"`JSTSNodeBee` is now live",
			"`bounded_node_cli_task`",
			"`verify:queenbee:jsts:node`",
		]) &&
		includesAll(firstSliceText, [
			"## Session 210 Node/CLI Specialist Lane",
			"`bounded_node_cli_task`",
			"`JSTSNodeBee`",
			"`verify:queenbee:bounded-node`",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 210 QueenBee Node/CLI Lane Note",
			"`bounded_node_cli_task`",
			"`JSTSNodeBee`",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 210 lets JSTSNodeBee own the first bounded Node/CLI lane inside the existing coder slot",
			"`JSTSNodeBee`",
			"`package.json`",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:jsts:node`", "`JSTSNodeBee`"])
	const reverseEngineeringDocsPresent =
		includesAll(reverseEngineeringMapText, [
			"## Session 225 Async, Node, And Parallel-Pressure Answer",
			"`QB-CAN-07`",
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
			"`JSTSNodeBee`",
			"same-assignment multi-coder fan-out remains rejected",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 225 QueenBee Async, Node, And Parallel-Pressure Note",
			"`bounded_node_cli_task` is now explicitly mapped through `JSTSNodeBee` without widening into general repo CLI surgery",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 225 keeps async, Node, and first parallel-pressure rows on singleton specialist handling",
			"**Session:** 225",
		]) &&
		includesAll(verificationCatalogText, [
			"the Session 225 async, Node, and parallel-pressure reverse-engineering answer now records",
			"`bounded_two_file_update` and `bounded_node_cli_task` as singleton specialist rows",
		])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:jsts:node"] === "npm run build && node dist/verification/verify_queenbee_jsts_node.js"
	const verifierExecutor: QueenBeeVerifierExecutor = ({ command }) => ({
		command,
		exitCode: command === "npm.cmd run verify:queenbee:jsts:node" || command === "npm.cmd run verify:queenbee:bounded-node" ? 0 : 1,
		passed: command === "npm.cmd run verify:queenbee:jsts:node" || command === "npm.cmd run verify:queenbee:bounded-node",
		outputSummary:
			command === "npm.cmd run verify:queenbee:jsts:node"
				? "queenbee:jsts:node PASS"
				: command === "npm.cmd run verify:queenbee:bounded-node"
					? "queenbee:bounded-node PASS"
					: "node stub failure",
	})

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-jsts-node")
	try {
		const helloPath = path.join(fixture.repoPath, "hello.ts")
		const packagePath = path.join(fixture.repoPath, "package.json")
		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath, verifierExecutor })
		const nodeSpecialistListed =
			shell.coder.listAvailableSpecialists().join(",") === "JSTSCoreBee,JSTSAsyncBee,JSTSNodeBee,JSTSTestBee,JSTSRefactorBee"

		const lookupEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-node-lookup",
			missionId: "mission-jsts-node-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "registry_lookup_request",
			timestamp: "2026-03-27T12:10:00Z",
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
			messageId: "msg-jsts-node-reserve",
			missionId: "mission-jsts-node-1",
			assignmentId: "assign-jsts-node-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "bee_reserve_request",
			timestamp: "2026-03-27T12:11:00Z",
			payload: {
				targetBeeId: reservedBeeId,
				assignmentId: "assign-jsts-node-1",
			},
		})
		const reserveResult = shell.router.routeEnvelope(reserveEnvelope)
		const reserved = asRecord(reserveResult.responseEnvelope?.payload)?.["reserved"] === true

		const planEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-node-plan",
			missionId: "mission-jsts-node-1",
			assignmentId: "assign-jsts-node-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-27T12:12:00Z",
			payload: {
				task: 'add the exact comment "// queenbee: node cli hello" to hello.ts and add a npm run cli entry for hello.ts',
				taskFamily: "bounded_node_cli_task",
				targetFiles: ["package.json", "hello.ts"],
				languagePack: "js_ts",
				protectedFiles: ["utils.ts"],
				reservedBeeId,
			},
		})
		const planResult = shell.router.routeEnvelope(planEnvelope)
		const assignmentPacket = readFirstAssignmentPacket(planResult.responseEnvelope)
		const nodeSelected = assignmentPacket !== null && shell.coder.selectSpecialistForEnvelope(assignmentPacket) === "JSTSNodeBee"
		const coderResult = assignmentPacket ? shell.router.relayPlannedAssignment(assignmentPacket) : null
		const coderPayload = asRecord(coderResult?.responseEnvelope?.payload)
		const proposals = Array.isArray(coderPayload?.["proposals"]) ? (coderPayload["proposals"] as Array<Record<string, unknown>>) : []
		const packageProposal = proposals.find((proposal) => proposal["path"] === "package.json")
		const fileProposal = proposals.find((proposal) => proposal["path"] === "hello.ts")

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
						["npm.cmd run verify:queenbee:jsts:node", "npm.cmd run verify:queenbee:bounded-node"],
						"daily_jsts_matrix_node_pack",
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
			(verificationPayload?.["results"] as Array<Record<string, unknown>>).length === 2 &&
			(verificationPayload?.["results"] as Array<Record<string, unknown>>).map((row) => String(row["command"] ?? "")).join(",") ===
				"npm.cmd run verify:queenbee:jsts:node,npm.cmd run verify:queenbee:bounded-node" &&
			typeof verificationPayload?.["verifierSummary"] === "string" &&
			String(verificationPayload["verifierSummary"]).includes("daily_jsts_matrix_node_pack") &&
			String(verificationPayload["verifierSummary"]).includes("npm.cmd run verify:queenbee:jsts:node") &&
			String(verificationPayload["verifierSummary"]).includes("npm.cmd run verify:queenbee:bounded-node")
		const mergeResult =
			verificationResult?.responseEnvelope && coderResult?.responseEnvelope
				? shell.router.relayVerificationVerdictToMerge(verificationResult.responseEnvelope, coderResult.responseEnvelope)
				: null
		const mergePayload = asRecord(mergeResult?.responseEnvelope?.payload)
		const afterPackage = fs.readFileSync(packagePath, "utf8")
		const afterHello = fs.readFileSync(helloPath, "utf8")
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
			afterPackage.includes('"queenbee:node:hello": "node ./hello.ts"') &&
			afterHello.includes("// queenbee: node cli hello") &&
			archiveResult?.status === "delivered" &&
			archiveResult.responseEnvelope?.messageType === "archive_written" &&
			archivePath === ".swarm/queenbee_archive/assign-jsts-node-1.json" &&
			Array.isArray(archiveJson?.["changedFiles"]) &&
			(archiveJson?.["changedFiles"] as string[]).join(",") === "package.json,hello.ts" &&
			Array.isArray(archiveJson?.["proofCommands"]) &&
			(archiveJson?.["proofCommands"] as string[]).join(",") ===
				"npm.cmd run verify:queenbee:jsts:node,npm.cmd run verify:queenbee:bounded-node" &&
			typeof archiveJson?.["verifierSummary"] === "string" &&
			String(archiveJson["verifierSummary"]).includes("daily_jsts_matrix_node_pack")
		const nodeSummaryVisible = typeof coderPayload?.["coderSummary"] === "string" && String(coderPayload["coderSummary"]).includes("JSTSNodeBee")
		const routeSlotStayedGeneric =
			reservedBeeId === "queenbee.jsts_coder.001" &&
			assignmentPacket?.recipientBeeId === "queenbee.jsts_coder.001" &&
			shell.router.listImplementedEdges().includes("RouterBee->JSTSCoderBee") &&
			shell.router.listImplementedEdges().includes("JSTSCoderBee->RouterBee")
		const parallelNeedStayedSingleton =
			reverseEngineeringDocsPresent &&
			routeSlotStayedGeneric &&
			includesAll(reverseEngineeringMapText, ["`QB-CAN-07`", "one routed specialist slot", "no same-assignment clone-worker fan-out need"]) &&
			includesAll(gapRegisterText, ["`QB-GAP-225-02`", "`CLOSED_SESSION_225`"])

		const tooWideEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-node-too-wide",
			missionId: "mission-jsts-node-2",
			assignmentId: "assign-jsts-node-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-27T12:13:00Z",
			payload: {
				task: "update package.json, hello.ts, and utils.ts for one cli task",
				taskFamily: "bounded_node_cli_task",
				languagePack: "js_ts",
				allowedFiles: ["package.json", "hello.ts", "utils.ts"],
				forbiddenFiles: [],
				expectedResult: "bounded_node_cli_task",
				plannerSummary: "PlannerBee emitted 1 assignment packet for bounded_node_cli_task over package.json, hello.ts, utils.ts.",
				requiresReview: true,
				requiresVerification: true,
			},
		})
		const tooWideResult = shell.router.routeEnvelope(tooWideEnvelope)
		const tooWidePayload = asRecord(tooWideResult.responseEnvelope?.payload)
		const proposalStayedScoped =
			(coderPayload?.["proposalCount"] as number) === 2 &&
			Array.isArray(coderPayload?.["changedFiles"]) &&
			(coderPayload?.["changedFiles"] as string[]).join(",") === "package.json,hello.ts" &&
			typeof packageProposal?.["afterContent"] === "string" &&
			String(packageProposal["afterContent"]).includes('"queenbee:node:hello": "node ./hello.ts"') &&
			typeof fileProposal?.["afterContent"] === "string" &&
			String(fileProposal["afterContent"]).includes("// queenbee: node cli hello") &&
			tooWideResult.status === "delivered" &&
			tooWidePayload?.["accepted"] === false &&
			tooWidePayload?.["reason"] === "coder_target_count_out_of_bounds" &&
			typeof tooWidePayload?.["coderSummary"] === "string" &&
			String(tooWidePayload["coderSummary"]).includes("JSTSNodeBee")

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
			nodeDocsPresent,
			reverseEngineeringDocsPresent,
			packageScriptPresent,
			nodeSpecialistListed,
			nodeSelected,
			assignmentDelivered,
			reviewAndProofDelivered,
			mergeAndArchiveDelivered,
			nodeSummaryVisible,
			routeSlotStayedGeneric,
			parallelNeedStayedSingleton,
			proposalStayedScoped,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeJstsNodeHarnessResult(result: QueenBeeJstsNodeHarnessResult): string {
	return [
		`Node docs present: ${result.nodeDocsPresent ? "PASS" : "FAIL"}`,
		`Reverse-engineering docs present: ${result.reverseEngineeringDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Node specialist listed: ${result.nodeSpecialistListed ? "PASS" : "FAIL"}`,
		`Node selected: ${result.nodeSelected ? "PASS" : "FAIL"}`,
		`Assignment delivered: ${result.assignmentDelivered ? "PASS" : "FAIL"}`,
		`Review and proof delivered: ${result.reviewAndProofDelivered ? "PASS" : "FAIL"}`,
		`Merge and archive delivered: ${result.mergeAndArchiveDelivered ? "PASS" : "FAIL"}`,
		`Node summary visible: ${result.nodeSummaryVisible ? "PASS" : "FAIL"}`,
		`Route slot stayed generic: ${result.routeSlotStayedGeneric ? "PASS" : "FAIL"}`,
		`Parallel need stayed singleton: ${result.parallelNeedStayedSingleton ? "PASS" : "FAIL"}`,
		`Proposal stayed scoped: ${result.proposalStayedScoped ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeJstsNodeHarness()
	console.log(formatQueenBeeJstsNodeHarnessResult(result))
	process.exit(
		result.nodeDocsPresent &&
			result.reverseEngineeringDocsPresent &&
			result.packageScriptPresent &&
			result.nodeSpecialistListed &&
			result.nodeSelected &&
			result.assignmentDelivered &&
			result.reviewAndProofDelivered &&
			result.mergeAndArchiveDelivered &&
			result.nodeSummaryVisible &&
			result.routeSlotStayedGeneric &&
			result.parallelNeedStayedSingleton &&
			result.proposalStayedScoped
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:jsts:node] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
