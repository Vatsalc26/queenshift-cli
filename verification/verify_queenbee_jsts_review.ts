import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeJstsReviewHarnessResult = {
	reviewerDocsPresent: boolean
	packageScriptPresent: boolean
	reviewerEdgesImplemented: boolean
	reviewPassDelivered: boolean
	reviewReworkContractDefined: boolean
	reviewFailDelivered: boolean
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

function readFirstReworkRequest(payload: Record<string, unknown> | null): QueenBeeEnvelope | null {
	if (!payload || !Array.isArray(payload["reworkRequests"])) return null
	const first = payload["reworkRequests"][0]
	return first && typeof first === "object" && !Array.isArray(first) ? (first as QueenBeeEnvelope) : null
}

export async function runQueenBeeJstsReviewHarness(rootDir = resolveRootDir()): Promise<QueenBeeJstsReviewHarnessResult> {
	const details: string[] = []
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const toolGrantText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const evalRubricText = readText(rootDir, "QUEENBEE_EXPERT_EVAL_RUBRIC.md")
	const confidenceContractText = readText(rootDir, "QUEENBEE_OPERATOR_CONFIDENCE_CONTRACT.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}

	const reviewerDocsPresent =
		includesAll(messageSchemaText, [
			"## Session 194 Reviewer Verdict Shell",
			"`review_request`",
			"`review_pass`",
			"`review_rework`",
			"`review_fail`",
			"`rework_request`",
		]) &&
		includesAll(protocolMapText, [
			"## Session 194 Runtime Reviewer",
			"`RouterBee -> JSTSReviewerBee`",
			"`JSTSReviewerBee -> RouterBee`",
			"`review_request`",
			"`review_rework`",
		]) &&
		includesAll(firstSliceText, [
			"## Session 194 Reviewer Rule",
			"`verify:queenbee:jsts:review`",
			"`review_pass`",
			"`review_rework`",
			"`review_fail`",
		]) &&
		includesAll(toolGrantText, [
			"## Session 194 Reviewer Grant Rule",
			"`JSTSReviewerBee`",
			"`verify:queenbee:jsts:review`",
			"`rework_request`",
		]) &&
		includesAll(architectureText, [
			"## Decision: QueenBee JSTSReviewerBee returns explicit pass, rework, or fail verdicts",
			"**Session:** 194",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:jsts:review`", "pass, rework, or fail verdicts"]) &&
		includesAll(evalRubricText, [
			"## Session 272 Quality Lane Reading",
			"review summary should name the bounded review surface",
			"rework should identify the smallest bounded fix",
			"## Session 277 Daily Matrix Quality Reading",
			"current daily JS/TS matrix rows do not reach `EXPERT_GREEN` unless the review surface stays row-specific",
		]) &&
		includesAll(confidenceContractText, [
			"## Session 272 Review And Proof Clarity",
			"`review_pass` and `review_rework` should name the bounded review surface",
			"smallest bounded fix before verification",
			"## Session 277 Daily Matrix Verification Confidence",
			"current daily JS/TS matrix rows should keep row-specific review wording",
		])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:jsts:review"] === "npm run build && node dist/verification/verify_queenbee_jsts_review.js"

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-jsts-review")
	try {
		const helloPath = path.join(fixture.repoPath, "hello.ts")
		const beforeDisk = fs.readFileSync(helloPath, "utf8")
		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath })

		const reviewerEdgesImplemented =
			shell.router.listImplementedEdges().includes("RouterBee->JSTSReviewerBee") &&
			shell.router.listImplementedEdges().includes("JSTSReviewerBee->RouterBee")

		const lookupEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-review-lookup",
			missionId: "mission-jsts-review-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "registry_lookup_request",
			timestamp: "2026-03-26T14:10:00Z",
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
			messageId: "msg-jsts-review-reserve",
			missionId: "mission-jsts-review-1",
			assignmentId: "assign-jsts-review-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.registry.001",
			messageType: "bee_reserve_request",
			timestamp: "2026-03-26T14:11:00Z",
			payload: {
				targetBeeId: reservedBeeId,
				assignmentId: "assign-jsts-review-1",
			},
		})
		const reserveResult = shell.router.routeEnvelope(reserveEnvelope)
		const reserved = asRecord(reserveResult.responseEnvelope?.payload)?.["reserved"] === true

		const planEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-jsts-review-plan",
			missionId: "mission-jsts-review-1",
			assignmentId: "assign-jsts-review-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-26T14:12:00Z",
			payload: {
				task: 'add the exact comment "// queenbee: review pass" to hello.ts',
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
		const reviewPassResult = coderResult?.responseEnvelope ? shell.router.relayCoderWorkResult(coderResult.responseEnvelope) : null
		const reviewPassPayload = asRecord(reviewPassResult?.responseEnvelope?.payload)
		const reviewPassDelivered =
			lookupResult.status === "delivered" &&
			reserved &&
			planResult.status === "delivered" &&
			coderResult?.status === "delivered" &&
			reviewPassResult?.status === "delivered" &&
			reviewPassResult.edge === "RouterBee->JSTSReviewerBee" &&
			reviewPassResult.responseEnvelope?.messageType === "review_pass" &&
			reviewPassPayload?.["accepted"] === true &&
			typeof reviewPassPayload?.["reviewSummary"] === "string" &&
			String(reviewPassPayload["reviewSummary"]).includes("current daily JS/TS matrix single-file review surface")

		const reviewReworkInput = buildQueenBeeEnvelope({
			messageId: "msg-jsts-review-rework",
			missionId: "mission-jsts-review-2",
			assignmentId: "assign-jsts-review-2",
			senderBeeId: "queenbee.jsts_coder.001",
			recipientBeeId: "queenbee.router.001",
			messageType: "work_result",
			timestamp: "2026-03-26T14:13:00Z",
			payload: {
				accepted: true,
				reason: null,
				changedFiles: ["hello.ts"],
				proposalCount: 1,
				proposals: [
					{
						path: "hello.ts",
						beforeContent: beforeDisk,
						afterContent: `// review marker missing\n${beforeDisk}`,
						changeSummary: "Inserted a comment without the bounded queenbee marker.",
					},
				],
				coderSummary: "JSTSCoderBee prepared one proposal that still needs reviewer feedback.",
			},
		})
		const reviewReworkResult = shell.router.relayCoderWorkResult(reviewReworkInput)
		const reviewReworkPayload = asRecord(reviewReworkResult.responseEnvelope?.payload)
		const firstReworkRequest = readFirstReworkRequest(reviewReworkPayload)
		const firstReworkPayload = asRecord(firstReworkRequest?.payload)
		const reviewReworkContractDefined =
			reviewReworkResult.status === "delivered" &&
			reviewReworkResult.responseEnvelope?.messageType === "review_rework" &&
			reviewReworkPayload?.["accepted"] === false &&
			reviewReworkPayload?.["reason"] === "review_marker_missing" &&
			typeof reviewReworkPayload?.["reviewSummary"] === "string" &&
			String(reviewReworkPayload["reviewSummary"]).includes("current daily JS/TS matrix single-file review surface") &&
			firstReworkRequest?.messageType === "rework_request" &&
			firstReworkRequest?.senderBeeId === "queenbee.jsts_reviewer.001" &&
			firstReworkRequest?.recipientBeeId === "queenbee.jsts_coder.001" &&
			Array.isArray(firstReworkPayload?.["allowedFiles"]) &&
			(firstReworkPayload?.["allowedFiles"] as string[]).join(",") === "hello.ts" &&
			Array.isArray(firstReworkPayload?.["requestedChanges"]) &&
			String((firstReworkPayload?.["requestedChanges"] as string[])[0] ?? "").includes("current daily JS/TS matrix single-file review surface") &&
			typeof firstReworkPayload?.["reviewerSummary"] === "string" &&
			String(firstReworkPayload["reviewerSummary"]).includes("current daily JS/TS matrix single-file review surface")

		const reviewFailInput = buildQueenBeeEnvelope({
			messageId: "msg-jsts-review-fail",
			missionId: "mission-jsts-review-3",
			assignmentId: "assign-jsts-review-3",
			senderBeeId: "queenbee.jsts_coder.001",
			recipientBeeId: "queenbee.router.001",
			messageType: "work_result",
			timestamp: "2026-03-26T14:14:00Z",
			payload: {
				accepted: true,
				reason: null,
				changedFiles: ["hello.ts"],
				proposalCount: 1,
				proposals: [
					{
						path: "notes.md",
						beforeContent: "before\n",
						afterContent: "after\n",
						changeSummary: "Drifted outside the one-file JS/TS review scope.",
					},
				],
				coderSummary: "JSTSCoderBee prepared one proposal that drifted off the allowed review target.",
			},
		})
		const reviewFailResult = shell.router.relayCoderWorkResult(reviewFailInput)
		const reviewFailPayload = asRecord(reviewFailResult.responseEnvelope?.payload)
		const reviewFailDelivered =
			reviewFailResult.status === "delivered" &&
			reviewFailResult.responseEnvelope?.messageType === "review_fail" &&
			reviewFailPayload?.["accepted"] === false &&
			reviewFailPayload?.["reason"] === "review_scope_mismatch"

		details.push(
			`implementedEdges=${shell.router.listImplementedEdges().join(",")}`,
			`candidates=${candidateBeeIds.join(",") || "missing"}`,
			`reviewPassType=${reviewPassResult?.responseEnvelope?.messageType ?? "missing"}`,
			`reworkType=${reviewReworkResult.responseEnvelope?.messageType ?? "missing"}`,
			`failReason=${String(reviewFailPayload?.["reason"] ?? "missing")}`,
		)

		return {
			reviewerDocsPresent,
			packageScriptPresent,
			reviewerEdgesImplemented,
			reviewPassDelivered,
			reviewReworkContractDefined,
			reviewFailDelivered,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeJstsReviewHarnessResult(result: QueenBeeJstsReviewHarnessResult): string {
	return [
		`Reviewer docs present: ${result.reviewerDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Reviewer edges implemented: ${result.reviewerEdgesImplemented ? "PASS" : "FAIL"}`,
		`Review pass delivered: ${result.reviewPassDelivered ? "PASS" : "FAIL"}`,
		`Review rework contract defined: ${result.reviewReworkContractDefined ? "PASS" : "FAIL"}`,
		`Review fail delivered: ${result.reviewFailDelivered ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeJstsReviewHarness()
	console.log(formatQueenBeeJstsReviewHarnessResult(result))
	process.exit(
		result.reviewerDocsPresent &&
			result.packageScriptPresent &&
			result.reviewerEdgesImplemented &&
			result.reviewPassDelivered &&
			result.reviewReworkContractDefined &&
			result.reviewFailDelivered
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:jsts:review] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
