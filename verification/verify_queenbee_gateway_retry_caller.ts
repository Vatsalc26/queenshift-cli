import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { readShellSnapshot } from "../src/shell/ThinShell"
import { createTempTestRepoCopy, runVerificationGit } from "./test_workspace_baseline"
import {
	asRecord,
	type CandidateProgressSnapshot,
	commitFixtureChanges,
	hasSameFileSet,
	includesAll,
	readAssignmentPacket,
	readText,
	resolveRootDir,
	runCli,
} from "./queenbee_gateway_preview_helpers"

export type QueenBeeGatewayRetryCallerHarnessResult = {
	packageScriptPresent: boolean
	gatewayTaskSetAligned: boolean
	reverseEngineeringMapAligned: boolean
	traceabilityAligned: boolean
	sideBySideAligned: boolean
	gapRegisterAligned: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	verificationCatalogAligned: boolean
	scoutCompilesScope: boolean
	plannerCompilesFamily: boolean
	candidatePreviewAligned: boolean
	shellSnapshotAligned: boolean
	repoCleanAfter: boolean
	details: string[]
}

async function setupRetryCallerFixture(repoPath: string): Promise<void> {
	const retryPath = path.join(repoPath, "src", "retry.ts")
	const clientPath = path.join(repoPath, "src", "client.ts")
	fs.mkdirSync(path.dirname(retryPath), { recursive: true })
	fs.writeFileSync(
		retryPath,
		`export async function retryWithBackoff<T>(work: () => Promise<T>): Promise<T> {\n\treturn await work()\n}\n`,
		"utf8",
	)
	fs.writeFileSync(
		clientPath,
		`import { retryWithBackoff } from "./retry"\n\nexport async function runClient(work: () => Promise<string>): Promise<string> {\n\treturn await retryWithBackoff(work)\n}\n`,
		"utf8",
	)
	await commitFixtureChanges(repoPath, "verification gateway retry-caller baseline")
}

export async function runQueenBeeGatewayRetryCallerHarness(
	rootDir = resolveRootDir(),
): Promise<QueenBeeGatewayRetryCallerHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const gatewayTaskSetText = readText(rootDir, "QUEENBEE_GATEWAY_TASK_SET.md")
	const reverseEngineeringMapText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const traceabilityText = readText(rootDir, "QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
	const sideBySideText = readText(rootDir, "QUEENBEE_SIDE_BY_SIDE_EXAMPLES.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:gateway:retry-caller"] ===
		"npm run build && node dist/verification/verify_queenbee_gateway_retry_caller.js"

	const gatewayTaskSetAligned = includesAll(gatewayTaskSetText, [
		"`QB-GW-02`",
		"`verify:queenbee:gateway:retry-caller`",
		"`QB-GW-02` is now `SUPPORTED`",
		"exactly one direct caller",
		"`candidate_preview_only`",
	])

	const reverseEngineeringMapAligned = includesAll(reverseEngineeringMapText, [
		"## Gateway Reverse-Engineering Matrix",
		"`QB-GW-02`",
		"SUPPORTED` after Session 236",
		"`JSTSAsyncBee`",
		"exactly one direct caller",
	])

	const traceabilityAligned = includesAll(traceabilityText, [
		"`QB-TR-15`",
		"`gateway_retry_caller`",
		"`verify:queenbee:gateway:retry-caller`",
		"`JSTSAsyncBee`",
	])

	const sideBySideAligned = includesAll(sideBySideText, [
		"`QB-EX-09`",
		"active comparison row",
		"preview-hold evidence",
	])

	const gapRegisterAligned = includesAll(gapRegisterText, [
		"`QB-GAP-236-01`",
		"`CLOSED_SESSION_236`",
		"exactly one direct caller",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 236 hardens the first QueenBee gateway rows without widening the public beta boundary",
		"**Session:** 236",
		"`verify:queenbee:gateway:retry-caller`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B42 |",
		"`npm.cmd run verify:queenbee:gateway:retry-caller`",
		"`candidate_preview_only`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"63. the Session 236 retry/caller gateway row now records one proof-backed two-file async answer",
		"`npm.cmd run verify:queenbee:gateway:retry-caller`",
	])

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-gateway-retry-caller")
	try {
		await setupRetryCallerFixture(fixture.repoPath)

		const task =
			'update src/retry.ts and keep its direct caller aligned so both files include the exact comment "// queenbee: gateway retry"'
		const expectedFiles = ["src/client.ts", "src/retry.ts"]

		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath })

		const scoutRequest = buildQueenBeeEnvelope({
			messageId: "msg-gateway-retry-scout",
			missionId: "mission-gateway-retry-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.scout.001",
			messageType: "scout_request",
			timestamp: "2026-03-28T18:10:00Z",
			payload: {
				task,
				workspace: fixture.repoPath,
				languagePack: "js_ts",
			},
		})
		const scoutResult = shell.router.routeEnvelope(scoutRequest)
		const scoutPayload = asRecord(scoutResult.responseEnvelope?.payload)
		const scoutTargets = Array.isArray(scoutPayload?.["targetFiles"]) ? (scoutPayload["targetFiles"] as string[]) : []
		const scoutCompilesScope =
			scoutResult.status === "delivered" &&
			scoutPayload?.["accepted"] === true &&
			hasSameFileSet(scoutTargets, expectedFiles) &&
			String(scoutPayload?.["scoutSummary"] ?? "").includes("retry/caller scope")

		const planRequest = buildQueenBeeEnvelope({
			messageId: "msg-gateway-retry-plan",
			missionId: "mission-gateway-retry-2",
			assignmentId: "assign-gateway-retry-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-28T18:11:00Z",
			payload: {
				task,
				targetFiles: scoutTargets,
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
			},
		})
		const planResult = shell.router.routeEnvelope(planRequest)
		const planPayload = asRecord(planResult.responseEnvelope?.payload)
		const planPacketPayload = asRecord(readAssignmentPacket(planResult.responseEnvelope)?.payload)
		const allowedFiles = Array.isArray(planPacketPayload?.["allowedFiles"]) ? (planPacketPayload["allowedFiles"] as string[]) : []
		const plannerCompilesFamily =
			planResult.status === "delivered" &&
			planPayload?.["accepted"] === true &&
			planPayload?.["taskFamily"] === "bounded_two_file_update" &&
			hasSameFileSet(allowedFiles, expectedFiles)

		const cliResult = await runCli(rootDir, ["--engine", "queenbee", "--task", task, "--workspace", fixture.repoPath], process.env)
		const artifactPath = path.join(fixture.repoPath, ".swarm", "queenbee-candidate", "latest-progress.json")
		const artifact = fs.existsSync(artifactPath)
			? (JSON.parse(fs.readFileSync(artifactPath, "utf8")) as CandidateProgressSnapshot)
			: null
		const shellSnapshot = readShellSnapshot(fixture.repoPath)
		const repoStatus = await runVerificationGit(fixture.repoPath, ["status", "--porcelain", "--untracked-files=all"])
		const repoCleanAfter = repoStatus.trim().length === 0

		const candidatePreviewAligned =
			cliResult.code === 1 &&
			cliResult.stdout.includes("[Swarm] Final status: candidate_not_ready") &&
			cliResult.stdout.includes("Current bounded candidate hint: bounded_two_file_update over src/client.ts, src/retry.ts.") &&
			cliResult.stdout.includes("Selected specialist: JSTSAsyncBee.") &&
			cliResult.stdout.includes(`Progress artifact: ${artifactPath}.`) &&
			cliResult.stdout.includes("Confidence outcome: candidate_preview_only.") &&
			cliResult.stderr.includes("[Swarm] Engine not ready.") &&
			Boolean(artifact) &&
			artifact?.engine === "queenbee" &&
			artifact?.status === "candidate_not_ready" &&
			artifact?.stopReason === "candidate_engine_not_ready" &&
			artifact?.taskFamilyHint === "bounded_two_file_update" &&
			hasSameFileSet(artifact?.allowedFiles ?? [], expectedFiles) &&
			artifact?.activeQueue === "specialist_queue" &&
			artifact?.currentStage === "proposal" &&
			artifact?.selectedSpecialist === "JSTSAsyncBee" &&
			artifact?.confidenceOutcome === "candidate_preview_only" &&
			artifact?.executionAttempted === false &&
			artifact?.assignmentId === "qb-preview-bounded_two_file_update" &&
			typeof artifact?.lastEventAt === "string" &&
			artifact.lastEventAt.length > 0 &&
			typeof artifact?.nextTimeoutAt === "string" &&
			artifact.nextTimeoutAt.length > 0 &&
			typeof artifact?.nextExpectedHandoff === "string" &&
			artifact.nextExpectedHandoff.includes("JSTSAsyncBee")

		const shellSnapshotAligned =
			shellSnapshot.summaryPath === null &&
			shellSnapshot.summaryText.includes(`Artifact: ${artifactPath}`) &&
			shellSnapshot.summaryText.includes('"taskFamilyHint": "bounded_two_file_update"') &&
			shellSnapshot.summaryText.includes('"selectedSpecialist": "JSTSAsyncBee"') &&
			shellSnapshot.forensicsText.includes("Stage: proposal (specialist_queue)") &&
			shellSnapshot.forensicsText.includes("Selected specialist: JSTSAsyncBee") &&
			shellSnapshot.forensicsText.includes("Confidence outcome: candidate_preview_only")

		details.push(
			`scoutTargets=${scoutTargets.join(",") || "missing"}`,
			`planFamily=${String(planPayload?.["taskFamily"] ?? "missing")}`,
			`allowedFiles=${allowedFiles.join(",") || "missing"}`,
			`previewFamily=${String(artifact?.taskFamilyHint ?? "missing")}`,
			`previewSpecialist=${String(artifact?.selectedSpecialist ?? "missing")}`,
			`repoCleanAfter=${repoCleanAfter ? "yes" : "no"}`,
		)

		return {
			packageScriptPresent,
			gatewayTaskSetAligned,
			reverseEngineeringMapAligned,
			traceabilityAligned,
			sideBySideAligned,
			gapRegisterAligned,
			architectureDecisionRecorded,
			capabilityChecklistAligned,
			verificationCatalogAligned,
			scoutCompilesScope,
			plannerCompilesFamily,
			candidatePreviewAligned,
			shellSnapshotAligned,
			repoCleanAfter,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeGatewayRetryCallerHarnessResult(result: QueenBeeGatewayRetryCallerHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Gateway task set aligned: ${result.gatewayTaskSetAligned ? "PASS" : "FAIL"}`,
		`Reverse-engineering map aligned: ${result.reverseEngineeringMapAligned ? "PASS" : "FAIL"}`,
		`Traceability aligned: ${result.traceabilityAligned ? "PASS" : "FAIL"}`,
		`Side-by-side aligned: ${result.sideBySideAligned ? "PASS" : "FAIL"}`,
		`Gap register aligned: ${result.gapRegisterAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Scout compiles scope: ${result.scoutCompilesScope ? "PASS" : "FAIL"}`,
		`Planner compiles family: ${result.plannerCompilesFamily ? "PASS" : "FAIL"}`,
		`Candidate preview aligned: ${result.candidatePreviewAligned ? "PASS" : "FAIL"}`,
		`Shell snapshot aligned: ${result.shellSnapshotAligned ? "PASS" : "FAIL"}`,
		`Repo clean after: ${result.repoCleanAfter ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeGatewayRetryCallerHarness()
	console.log(formatQueenBeeGatewayRetryCallerHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.gatewayTaskSetAligned &&
			result.reverseEngineeringMapAligned &&
			result.traceabilityAligned &&
			result.sideBySideAligned &&
			result.gapRegisterAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned &&
			result.scoutCompilesScope &&
			result.plannerCompilesFamily &&
			result.candidatePreviewAligned &&
			result.shellSnapshotAligned &&
			result.repoCleanAfter
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:gateway:retry-caller] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
