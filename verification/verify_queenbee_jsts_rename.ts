import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import type { QueenBeeVerifierExecutor } from "../src/queenbee/VerifierBee"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeJstsRenameHarnessResult = {
	renameDocsPresent: boolean
	reverseEngineeringDocsPresent: boolean
	publicDocsTruthful: boolean
	packageScriptPresent: boolean
	coreSelectedForRename: boolean
	assignmentDelivered: boolean
	reviewAndProofDelivered: boolean
	routeSlotStayedGeneric: boolean
	parallelNeedStayedSingleton: boolean
	renameStayedScoped: boolean
	symbolScopeFailClosed: boolean
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

export async function runQueenBeeJstsRenameHarness(rootDir = resolveRootDir()): Promise<QueenBeeJstsRenameHarnessResult> {
	const details: string[] = []
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const reverseEngineeringMapText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const traceabilityText = readText(rootDir, "QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
	const publicTaskFamiliesText = readText(rootDir, "public_pack/docs/task-families.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }

	const renameDocsPresent =
		includesAll(protocolMapText, [
			"## Session 211 Rename Export Lane",
			"`rename_export` should stay on `JSTSCoreBee`",
			"`verify:queenbee:jsts:rename`",
		]) &&
		includesAll(firstSliceText, [
			"## Session 211 Rename Export Lane",
			"`rename_export` may touch one explicit source file plus one or two explicit direct call-site files",
			"`verify:queenbee:jsts:rename`",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 211 QueenBee Rename Export Note",
			"`rename_export` may now cover one explicit source file plus one or two explicit direct call-site files",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 211 keeps rename_export on JSTSCoreBee and fails closed on ambiguous source symbols",
			"`JSTSCoreBee`",
			"multiple supported exported symbols",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:jsts:rename`", "bounded `rename_export` lane stays symbol-scoped"])
	const reverseEngineeringDocsPresent =
		includesAll(reverseEngineeringMapText, [
			"## Session 224 Symbol And Source-Test Answer",
			"`QB-CAN-04`",
			"`SUPPORTED` after Session 224",
			"no bounded multi-slice fan-out need",
		]) &&
		includesAll(gapRegisterText, [
			"`QB-GAP-224-01`",
			"`QB-GAP-224-02`",
			"`CLOSED_SESSION_224`",
		]) &&
		includesAll(traceabilityText, [
			"`QB-TR-05`",
			"still on one routed specialist slot",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 224 QueenBee Symbol And Source-Test Reverse-Engineering Note",
			"`rename_export` is now explicitly mapped through the current review and verifier surfaces",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 224 records rename and source-plus-test rows as review-and-proof-backed singleton lanes",
			"**Session:** 224",
		]) &&
		includesAll(verificationCatalogText, [
			"the Session 224 symbol and source-plus-test reverse-engineering answer now records",
			"`rename_export` and `update_file_and_test` as review-and-proof-backed singleton rows",
		])
	const publicDocsTruthful = includesAll(publicTaskFamiliesText, ["`rename_export`", "one named source file and its direct local call sites"])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:jsts:rename"] === "npm run build && node dist/verification/verify_queenbee_jsts_rename.js"
	const verifierExecutor: QueenBeeVerifierExecutor = ({ command }) => ({
		command,
		exitCode: command === "npm.cmd run verify:queenbee:jsts:rename" ? 0 : 1,
		passed: command === "npm.cmd run verify:queenbee:jsts:rename",
		outputSummary: command === "npm.cmd run verify:queenbee:jsts:rename" ? "queenbee:jsts:rename PASS" : "rename stub failure",
	})

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-jsts-rename")
	try {
		fs.writeFileSync(
			path.join(fixture.repoPath, "format.ts"),
			'export function formatLine(input: string): string {\n\treturn input.trim()\n}\n',
			"utf8",
		)
		fs.writeFileSync(
			path.join(fixture.repoPath, "hello.ts"),
			'import { formatLine } from "./format"\n\nexport function greet(name: string): string {\n\treturn formatLine(name)\n}\n',
			"utf8",
		)
		fs.writeFileSync(
			path.join(fixture.repoPath, "utils.ts"),
			'import { formatLine } from "./format"\n\nexport function shout(input: string): string {\n\treturn formatLine(input).toUpperCase()\n}\n',
			"utf8",
		)
		fs.writeFileSync(
			path.join(fixture.repoPath, "ambiguous.ts"),
			'export function firstName(input: string): string {\n\treturn input.trim()\n}\n\nexport function secondName(input: string): string {\n\treturn input.toUpperCase()\n}\n',
			"utf8",
		)

		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath, verifierExecutor })

		const lookupEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-rename-lookup",
			missionId: "mission-jsts-rename-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "registry_lookup_request",
			timestamp: "2026-03-28T03:10:00Z",
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
			messageId: "msg-jsts-rename-reserve",
			missionId: "mission-jsts-rename-1",
			assignmentId: "assign-jsts-rename-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "bee_reserve_request",
			timestamp: "2026-03-28T03:11:00Z",
			payload: {
				targetBeeId: reservedBeeId,
				assignmentId: "assign-jsts-rename-1",
			},
		})
		const reserveResult = shell.router.routeEnvelope(reserveEnvelope)
		const reserved = asRecord(reserveResult.responseEnvelope?.payload)?.["reserved"] === true

		const planEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-rename-plan",
			missionId: "mission-jsts-rename-1",
			assignmentId: "assign-jsts-rename-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-28T03:12:00Z",
			payload: {
				task: "rename the export in format.ts to formatValue and update its direct call sites",
				taskFamily: "rename_export",
				targetFiles: ["format.ts", "hello.ts", "utils.ts"],
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
				reservedBeeId,
			},
		})
		const planResult = shell.router.routeEnvelope(planEnvelope)
		const assignmentPacket = readFirstAssignmentPacket(planResult.responseEnvelope)
		const coreSelectedForRename = assignmentPacket !== null && shell.coder.selectSpecialistForEnvelope(assignmentPacket) === "JSTSCoreBee"
		const coderResult = assignmentPacket ? shell.router.relayPlannedAssignment(assignmentPacket) : null
		const coderPayload = asRecord(coderResult?.responseEnvelope?.payload)
		const proposals = Array.isArray(coderPayload?.["proposals"]) ? (coderPayload["proposals"] as Array<Record<string, unknown>>) : []
		const formatProposal = proposals.find((proposal) => proposal["path"] === "format.ts")
		const helloProposal = proposals.find((proposal) => proposal["path"] === "hello.ts")
		const utilsProposal = proposals.find((proposal) => proposal["path"] === "utils.ts")

		const assignmentDelivered =
			lookupResult.status === "delivered" &&
			reserved &&
			planResult.status === "delivered" &&
			coderResult?.status === "delivered" &&
			coderResult.edge === "RouterBee->JSTSCoderBee" &&
			coderResult.responseEnvelope?.messageType === "work_result" &&
			coderPayload?.["accepted"] === true &&
			proposals.length === 3

		const reviewResult = coderResult?.responseEnvelope ? shell.router.relayCoderWorkResult(coderResult.responseEnvelope) : null
		const reviewPayload = asRecord(reviewResult?.responseEnvelope?.payload)
		const verificationResult =
			reviewResult?.responseEnvelope
				? shell.router.relayReviewVerdictToVerifier(
						reviewResult.responseEnvelope,
						["npm.cmd run verify:queenbee:jsts:rename"],
						"daily_jsts_matrix_rename_pack",
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
			(verificationPayload?.["results"] as Array<Record<string, unknown>>)[0]?.["command"] === "npm.cmd run verify:queenbee:jsts:rename" &&
			typeof verificationPayload?.["verifierSummary"] === "string" &&
			String(verificationPayload["verifierSummary"]).includes("daily_jsts_matrix_rename_pack") &&
			String(verificationPayload["verifierSummary"]).includes("npm.cmd run verify:queenbee:jsts:rename")

		const routeSlotStayedGeneric =
			reservedBeeId === "queenbee.jsts_coder.001" &&
			assignmentPacket?.recipientBeeId === "queenbee.jsts_coder.001" &&
			shell.router.listImplementedEdges().includes("RouterBee->JSTSCoderBee") &&
			shell.router.listImplementedEdges().includes("JSTSCoderBee->RouterBee")
		const parallelNeedStayedSingleton =
			reverseEngineeringDocsPresent &&
			routeSlotStayedGeneric &&
			includesAll(reverseEngineeringMapText, ["`QB-CAN-04`", "one routed specialist slot", "no bounded multi-slice fan-out need"]) &&
			includesAll(gapRegisterText, ["`QB-GAP-224-02`", "`CLOSED_SESSION_224`"])
		const renameStayedScoped =
			Array.isArray(coderPayload?.["changedFiles"]) &&
			(coderPayload?.["changedFiles"] as string[]).join(",") === "format.ts,hello.ts,utils.ts" &&
			typeof formatProposal?.["afterContent"] === "string" &&
			String(formatProposal["afterContent"]).includes("export function formatValue") &&
			typeof helloProposal?.["afterContent"] === "string" &&
			String(helloProposal["afterContent"]).includes('import { formatValue } from "./format"') &&
			String(helloProposal["afterContent"]).includes("return formatValue(name)") &&
			typeof utilsProposal?.["afterContent"] === "string" &&
			String(utilsProposal["afterContent"]).includes("return formatValue(input).toUpperCase()")

		const ambiguousEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-rename-ambiguous",
			missionId: "mission-jsts-rename-2",
			assignmentId: "assign-jsts-rename-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-28T03:13:00Z",
			payload: {
				task: "rename the export in ambiguous.ts to formatValue and update its direct call sites",
				taskFamily: "rename_export",
				languagePack: "js_ts",
				allowedFiles: ["ambiguous.ts", "hello.ts"],
				forbiddenFiles: ["package.json"],
				expectedResult: "rename_export",
				plannerSummary: "PlannerBee emitted 1 assignment packet for rename_export over ambiguous.ts, hello.ts.",
				requiresReview: true,
				requiresVerification: true,
			},
		})
		const ambiguousResult = shell.router.routeEnvelope(ambiguousEnvelope)
		const ambiguousPayload = asRecord(ambiguousResult.responseEnvelope?.payload)
		const symbolScopeFailClosed =
			ambiguousResult.status === "delivered" &&
			ambiguousResult.responseEnvelope?.messageType === "work_result" &&
			ambiguousPayload?.["accepted"] === false &&
			ambiguousPayload?.["reason"] === "rename_export_source_symbol_ambiguous"

		details.push(
			`lookupCandidates=${candidateBeeIds.join(",") || "missing"}`,
			`assignmentRecipient=${assignmentPacket?.recipientBeeId ?? "missing"}`,
			`coderSummary=${String(coderPayload?.["coderSummary"] ?? "missing")}`,
			`reviewType=${reviewResult?.responseEnvelope?.messageType ?? "missing"}`,
			`verificationType=${verificationResult?.responseEnvelope?.messageType ?? "missing"}`,
			`ambiguousReason=${String(ambiguousPayload?.["reason"] ?? "missing")}`,
		)

		return {
			renameDocsPresent,
			reverseEngineeringDocsPresent,
			publicDocsTruthful,
			packageScriptPresent,
			coreSelectedForRename,
			assignmentDelivered,
			reviewAndProofDelivered,
			routeSlotStayedGeneric,
			parallelNeedStayedSingleton,
			renameStayedScoped,
			symbolScopeFailClosed,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeJstsRenameHarnessResult(result: QueenBeeJstsRenameHarnessResult): string {
	return [
		`Rename docs present: ${result.renameDocsPresent ? "PASS" : "FAIL"}`,
		`Reverse-engineering docs present: ${result.reverseEngineeringDocsPresent ? "PASS" : "FAIL"}`,
		`Public docs truthful: ${result.publicDocsTruthful ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Core selected for rename: ${result.coreSelectedForRename ? "PASS" : "FAIL"}`,
		`Assignment delivered: ${result.assignmentDelivered ? "PASS" : "FAIL"}`,
		`Review and proof delivered: ${result.reviewAndProofDelivered ? "PASS" : "FAIL"}`,
		`Route slot stayed generic: ${result.routeSlotStayedGeneric ? "PASS" : "FAIL"}`,
		`Parallel need stayed singleton: ${result.parallelNeedStayedSingleton ? "PASS" : "FAIL"}`,
		`Rename stayed scoped: ${result.renameStayedScoped ? "PASS" : "FAIL"}`,
		`Symbol scope fail-closed: ${result.symbolScopeFailClosed ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeJstsRenameHarness()
	console.log(formatQueenBeeJstsRenameHarnessResult(result))
	process.exit(
		result.renameDocsPresent &&
			result.reverseEngineeringDocsPresent &&
			result.publicDocsTruthful &&
			result.packageScriptPresent &&
			result.coreSelectedForRename &&
			result.assignmentDelivered &&
			result.reviewAndProofDelivered &&
			result.routeSlotStayedGeneric &&
			result.parallelNeedStayedSingleton &&
			result.renameStayedScoped &&
			result.symbolScopeFailClosed
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:jsts:rename] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
