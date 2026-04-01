import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeJstsCoreHarnessResult = {
	coreDocsPresent: boolean
	packageScriptPresent: boolean
	specialistListVisible: boolean
	coreSelectedByDefault: boolean
	assignmentDelivered: boolean
	coreSummaryVisible: boolean
	routeSlotStayedGeneric: boolean
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

export async function runQueenBeeJstsCoreHarness(rootDir = resolveRootDir()): Promise<QueenBeeJstsCoreHarnessResult> {
	const details: string[] = []
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const registryText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const wiringMapText = readText(rootDir, "WIRING_MAP.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }

	const coreDocsPresent =
		includesAll(protocolMapText, [
			"## Session 208 Core Specialist Runtime",
			"`RouterBee -> JSTSCoderBee` and `JSTSCoderBee -> RouterBee` remain the live protocol edges",
			"`JSTSCoreBee`",
			"`verify:queenbee:jsts:core`",
		]) &&
		includesAll(registryText, [
			"## Session 208 Core Specialist Runtime",
			"`queenbee.jsts_coder.001` remains the bounded JS/TS coder route target",
			"`JSTSCoreBee`",
			"`coderSummary` should name `JSTSCoreBee`",
		]) &&
		includesAll(firstSliceText, [
			"`JSTSCoderBee` remains the routed coder endpoint",
			"Session 208 activates `JSTSCoreBee`",
			"`JSTSCoreBee`",
		]) &&
		includesAll(wiringMapText, [
			"`JSTSCoderBee` route slot now delegates to `JSTSCoreBee`, `JSTSAsyncBee`, `JSTSNodeBee`, `JSTSTestBee`, or `JSTSRefactorBee`",
			"JSTSCoderBee.handleEnvelope() -> selected specialist codeAssignment()",
			"Route audit reaffirmed through Session 269",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 208 makes JSTSCoreBee the first live specialist behind the bounded coder route slot",
			"`JSTSCoreBee`",
			"`coderSummary`",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:jsts:core`", "`JSTSCoreBee`"])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:jsts:core"] === "npm run build && node dist/verification/verify_queenbee_jsts_core.js"

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-jsts-core")
	try {
		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath })
		const specialistListVisible =
			shell.coder.listAvailableSpecialists().join(",") === "JSTSCoreBee,JSTSAsyncBee,JSTSNodeBee,JSTSTestBee,JSTSRefactorBee"

		const lookupEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-core-lookup",
			missionId: "mission-jsts-core-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "registry_lookup_request",
			timestamp: "2026-03-27T10:10:00Z",
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
			messageId: "msg-jsts-core-reserve",
			missionId: "mission-jsts-core-1",
			assignmentId: "assign-jsts-core-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "bee_reserve_request",
			timestamp: "2026-03-27T10:11:00Z",
			payload: {
				targetBeeId: reservedBeeId,
				assignmentId: "assign-jsts-core-1",
			},
		})
		const reserveResult = shell.router.routeEnvelope(reserveEnvelope)
		const reserved = asRecord(reserveResult.responseEnvelope?.payload)?.["reserved"] === true

		const planEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-core-plan",
			missionId: "mission-jsts-core-1",
			assignmentId: "assign-jsts-core-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-27T10:12:00Z",
			payload: {
				task: 'add the exact comment "// queenbee: core hello" to hello.ts',
				taskFamily: "comment_file",
				targetFiles: ["hello.ts"],
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
				reservedBeeId,
			},
		})
		const planResult = shell.router.routeEnvelope(planEnvelope)
		const assignmentPacket = readFirstAssignmentPacket(planResult.responseEnvelope)
		const coreSelectedByDefault = assignmentPacket !== null && shell.coder.selectSpecialistForEnvelope(assignmentPacket) === "JSTSCoreBee"
		const coderResult = assignmentPacket ? shell.router.relayPlannedAssignment(assignmentPacket) : null
		const coderPayload = asRecord(coderResult?.responseEnvelope?.payload)
		const proposals = Array.isArray(coderPayload?.["proposals"]) ? (coderPayload["proposals"] as Array<Record<string, unknown>>) : []
		const firstProposal = asRecord(proposals[0])

		const assignmentDelivered =
			lookupResult.status === "delivered" &&
			reserved &&
			planResult.status === "delivered" &&
			coderResult?.status === "delivered" &&
			coderResult.edge === "RouterBee->JSTSCoderBee" &&
			coderResult.responseEnvelope?.messageType === "work_result" &&
			coderPayload?.["accepted"] === true &&
			firstProposal?.["path"] === "hello.ts"
		const coreSummaryVisible = typeof coderPayload?.["coderSummary"] === "string" && String(coderPayload["coderSummary"]).includes("JSTSCoreBee")
		const routeSlotStayedGeneric =
			reservedBeeId === "queenbee.jsts_coder.001" &&
			assignmentPacket?.recipientBeeId === "queenbee.jsts_coder.001" &&
			shell.router.listImplementedEdges().includes("RouterBee->JSTSCoderBee") &&
			shell.router.listImplementedEdges().includes("JSTSCoderBee->RouterBee")

		const tooWideEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-core-too-wide",
			missionId: "mission-jsts-core-2",
			assignmentId: "assign-jsts-core-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-27T10:13:00Z",
			payload: {
				task: "update hello.ts and utils.ts together",
				taskFamily: "update_named_file",
				languagePack: "js_ts",
				allowedFiles: ["hello.ts", "utils.ts"],
				forbiddenFiles: ["package.json"],
				expectedResult: "single_named_file_update",
				plannerSummary: "PlannerBee emitted 1 assignment packet for update_named_file over hello.ts, utils.ts.",
				requiresReview: true,
				requiresVerification: true,
			},
		})
		const tooWideResult = shell.router.routeEnvelope(tooWideEnvelope)
		const tooWidePayload = asRecord(tooWideResult.responseEnvelope?.payload)
		const proposalStayedScoped =
			(coderPayload?.["proposalCount"] as number) === 1 &&
			Array.isArray(coderPayload?.["changedFiles"]) &&
			(coderPayload?.["changedFiles"] as string[]).join(",") === "hello.ts" &&
			typeof firstProposal?.["afterContent"] === "string" &&
			String(firstProposal?.["afterContent"]).includes("// queenbee: core hello") &&
			tooWideResult.status === "delivered" &&
			tooWidePayload?.["accepted"] === false &&
			tooWidePayload?.["reason"] === "coder_target_count_out_of_bounds" &&
			typeof tooWidePayload?.["coderSummary"] === "string" &&
			String(tooWidePayload["coderSummary"]).includes("JSTSCoreBee")

		details.push(
			`specialists=${shell.coder.listAvailableSpecialists().join(",") || "missing"}`,
			`lookupCandidates=${candidateBeeIds.join(",") || "missing"}`,
			`assignmentRecipient=${assignmentPacket?.recipientBeeId ?? "missing"}`,
			`coderSummary=${String(coderPayload?.["coderSummary"] ?? "missing")}`,
			`tooWideReason=${String(tooWidePayload?.["reason"] ?? "missing")}`,
		)

		return {
			coreDocsPresent,
			packageScriptPresent,
			specialistListVisible,
			coreSelectedByDefault,
			assignmentDelivered,
			coreSummaryVisible,
			routeSlotStayedGeneric,
			proposalStayedScoped,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeJstsCoreHarnessResult(result: QueenBeeJstsCoreHarnessResult): string {
	return [
		`Core docs present: ${result.coreDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Specialist list visible: ${result.specialistListVisible ? "PASS" : "FAIL"}`,
		`Core selected by default: ${result.coreSelectedByDefault ? "PASS" : "FAIL"}`,
		`Assignment delivered: ${result.assignmentDelivered ? "PASS" : "FAIL"}`,
		`Core summary visible: ${result.coreSummaryVisible ? "PASS" : "FAIL"}`,
		`Route slot stayed generic: ${result.routeSlotStayedGeneric ? "PASS" : "FAIL"}`,
		`Proposal stayed scoped: ${result.proposalStayedScoped ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeJstsCoreHarness()
	console.log(formatQueenBeeJstsCoreHarnessResult(result))
	process.exit(
		result.coreDocsPresent &&
			result.packageScriptPresent &&
			result.specialistListVisible &&
			result.coreSelectedByDefault &&
			result.assignmentDelivered &&
			result.coreSummaryVisible &&
			result.routeSlotStayedGeneric &&
			result.proposalStayedScoped
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:jsts:core] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
