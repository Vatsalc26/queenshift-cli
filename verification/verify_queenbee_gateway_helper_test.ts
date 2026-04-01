import fs from "node:fs"
import path from "node:path"

import { resolveOwnerProviderSelection } from "../src/owner/ProviderResolution"
import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { findLatestRunSummary, readRunSummary } from "../src/run/RunArtifacts"
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

export type QueenBeeGatewayHelperTestHarnessResult = {
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
	runtimeOutcomeAligned: boolean
	shellSnapshotAligned: boolean
	repoCleanAfter: boolean
	details: string[]
}

const LIVE_PROVIDER_STOP_REASONS = new Set([
	"provider_auth_failure",
	"provider_launch_failure",
	"provider_timeout",
	"provider_malformed_response",
	"provider_empty_response",
	"provider_transport_failure",
	"provider_ceiling_reached",
	"provider_unknown_failure",
])

async function setupHelperTestFixture(repoPath: string): Promise<void> {
	const sourcePath = path.join(repoPath, "src", "format.ts")
	const testPath = path.join(repoPath, "src", "format.test.ts")
	fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
	fs.writeFileSync(sourcePath, `export function formatValue(input: string): string {\n\treturn input.trim()\n}\n`, "utf8")
	fs.writeFileSync(
		testPath,
		`import { formatValue } from "./format"\n\nexport function expectFormatValue(): string {\n\treturn formatValue(" hi ")\n}\n`,
		"utf8",
	)
	await commitFixtureChanges(repoPath, "verification gateway helper-test baseline")
}

export async function runQueenBeeGatewayHelperTestHarness(
	rootDir = resolveRootDir(),
): Promise<QueenBeeGatewayHelperTestHarnessResult> {
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
		packageJson.scripts?.["verify:queenbee:gateway:helper-test"] ===
		"npm run build && node dist/verification/verify_queenbee_gateway_helper_test.js"

	const gatewayTaskSetAligned = includesAll(gatewayTaskSetText, [
		"`QB-GW-01`",
		"`verify:queenbee:gateway:helper-test`",
		"`QB-GW-01` now records one provider-backed live gateway pass through `QB-LIVE-GW-01`",
		"`update_file_and_test`",
		"`QB-GW-02` through `QB-GW-04` remain proof-backed bounded rows",
	])

	const reverseEngineeringMapAligned = includesAll(reverseEngineeringMapText, [
		"## Gateway Reverse-Engineering Matrix",
		"`QB-GW-01`",
		"provider-backed live on `QB-LIVE-GW-01` after Session 241",
		"`JSTSTestBee`",
	])

	const traceabilityAligned = includesAll(traceabilityText, [
		"`QB-TR-14`",
		"`gateway_helper_test`",
		"`verify:queenbee:gateway:helper-test`",
		"`verify:queenbee:live:gateway`",
		"`JSTSTestBee`",
	])

	const sideBySideAligned = includesAll(sideBySideText, [
		"`QB-EX-08`",
		"`QB-LIVE-GW-01`",
		"`QB-EX-09` through `QB-EX-11` remain preview-hold evidence",
	])

	const gapRegisterAligned = includesAll(gapRegisterText, [
		"`QB-GAP-240-01`",
		"`CLOSED_SESSION_241`",
		"`QB-GW-01` now reuses the live lane",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 241 turns one proof-backed QueenBee gateway row into a real provider-backed live path",
		"**Session:** 241",
		"`verify:queenbee:live:gateway`",
		"`verify:queenbee:gateway:helper-test`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B47 |",
		"`npm.cmd run verify:queenbee:live:gateway`",
		"`npm.cmd run verify:queenbee:gateway:helper-test`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:gateway:helper-test`",
		"`npm.cmd run verify:queenbee:live:gateway`",
		"the Session 241 live gateway pack now records `QB-LIVE-GW-01` as one provider-backed helper/test gateway row",
	])

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-gateway-helper-test")
	try {
		await setupHelperTestFixture(fixture.repoPath)

		const task = 'update src/format.ts and keep its test aligned so both files include the exact comment "// queenbee: gateway helper"'
		const expectedFiles = ["src/format.ts", "src/format.test.ts"]

		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath })

		const scoutRequest = buildQueenBeeEnvelope({
			messageId: "msg-gateway-helper-scout",
			missionId: "mission-gateway-helper-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.scout.001",
			messageType: "scout_request",
			timestamp: "2026-03-28T18:00:00Z",
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
			String(scoutPayload?.["scoutSummary"] ?? "").includes("helper/test scope")

		const planRequest = buildQueenBeeEnvelope({
			messageId: "msg-gateway-helper-plan",
			missionId: "mission-gateway-helper-2",
			assignmentId: "assign-gateway-helper-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-28T18:01:00Z",
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
			planPayload?.["taskFamily"] === "update_file_and_test" &&
			hasSameFileSet(allowedFiles, expectedFiles)

		const cliResult = await runCli(rootDir, ["--engine", "queenbee", "--task", task, "--workspace", fixture.repoPath], process.env)
		const artifactPath = path.join(fixture.repoPath, ".swarm", "queenbee-candidate", "latest-progress.json")
		const artifact = fs.existsSync(artifactPath)
			? (JSON.parse(fs.readFileSync(artifactPath, "utf8")) as CandidateProgressSnapshot)
			: null
		const summaryPath = findLatestRunSummary(fixture.repoPath)
		const summary = summaryPath ? readRunSummary<Record<string, unknown>>(path.dirname(summaryPath)) : null
		const shellSnapshot = readShellSnapshot(fixture.repoPath)
		const repoStatus = await runVerificationGit(fixture.repoPath, ["status", "--porcelain", "--untracked-files=all"])
		const repoCleanAfter = repoStatus.trim().length === 0
		const queenbeeLive = asRecord(summary?.["queenbeeLive"])
		const provider = asRecord(summary?.["provider"])
		const verificationProfile = asRecord(summary?.["verificationProfile"])
		const providerSelection = resolveOwnerProviderSelection(process.env)
		const providerConfigured =
			providerSelection.provider === "gemini" &&
			providerSelection.ready &&
			providerSelection.model === "gemini-2.5-flash"

		const candidatePreviewAligned =
			cliResult.code === 1 &&
			cliResult.stdout.includes("[Swarm] Final status: candidate_not_ready") &&
			cliResult.stdout.includes("Current bounded candidate hint: update_file_and_test over src/format.ts, src/format.test.ts.") &&
			cliResult.stdout.includes("Selected specialist: JSTSTestBee.") &&
			cliResult.stdout.includes(`Progress artifact: ${artifactPath}.`) &&
			cliResult.stdout.includes("Confidence outcome: candidate_preview_only.") &&
			cliResult.stderr.includes("[Swarm] Engine not ready.") &&
			Boolean(artifact) &&
			artifact?.engine === "queenbee" &&
			artifact?.status === "candidate_not_ready" &&
			artifact?.stopReason === "candidate_engine_not_ready" &&
			artifact?.taskFamilyHint === "update_file_and_test" &&
			hasSameFileSet(artifact?.allowedFiles ?? [], expectedFiles) &&
			artifact?.activeQueue === "specialist_queue" &&
			artifact?.currentStage === "proposal" &&
			artifact?.selectedSpecialist === "JSTSTestBee" &&
			artifact?.confidenceOutcome === "candidate_preview_only" &&
			artifact?.executionAttempted === false &&
			artifact?.assignmentId === "qb-preview-update_file_and_test" &&
			typeof artifact?.lastEventAt === "string" &&
			artifact.lastEventAt.length > 0 &&
			typeof artifact?.nextTimeoutAt === "string" &&
			artifact.nextTimeoutAt.length > 0 &&
			typeof artifact?.nextExpectedHandoff === "string" &&
			artifact.nextExpectedHandoff.includes("JSTSTestBee")

		const liveOutcomeAligned =
			cliResult.code === 0 &&
			Boolean(summaryPath) &&
			summary?.["engine"] === "queenbee" &&
			summary?.["status"] === "done" &&
			summary?.["stopReason"] === "success" &&
			provider?.["providerCallObserved"] === true &&
			provider?.["provider"] === "gemini" &&
			provider?.["model"] === "gemini-2.5-flash" &&
			verificationProfile?.["profileName"] === "queenbee_live_gateway" &&
			verificationProfile?.["status"] === "passed" &&
			queenbeeLive?.["rowId"] === "QB-LIVE-GW-01" &&
			queenbeeLive?.["gatewayRowId"] === "QB-GW-01" &&
			queenbeeLive?.["selectedSpecialist"] === "JSTSTestBee" &&
			queenbeeLive?.["taskFamily"] === "update_file_and_test" &&
			hasSameFileSet((queenbeeLive?.["changedFiles"] as string[]) ?? [], expectedFiles) &&
			!artifact

		const liveAttemptOutcomeAligned =
			cliResult.code === 1 &&
			Boolean(summaryPath) &&
			summary?.["engine"] === "queenbee" &&
			summary?.["status"] === "failed" &&
			typeof summary?.["stopReason"] === "string" &&
			LIVE_PROVIDER_STOP_REASONS.has(String(summary["stopReason"])) &&
			verificationProfile?.["profileName"] === "queenbee_live_gateway" &&
			verificationProfile?.["status"] === "failed" &&
			queenbeeLive?.["rowId"] === "QB-LIVE-GW-01" &&
			queenbeeLive?.["gatewayRowId"] === "QB-GW-01" &&
			queenbeeLive?.["selectedSpecialist"] === "JSTSTestBee" &&
			queenbeeLive?.["taskFamily"] === "update_file_and_test" &&
			hasSameFileSet((queenbeeLive?.["changedFiles"] as string[]) ?? [], expectedFiles) &&
			!artifact

		const runtimeOutcomeAligned = candidatePreviewAligned || liveOutcomeAligned || liveAttemptOutcomeAligned

		const shellSnapshotAligned = candidatePreviewAligned
			? (
			shellSnapshot.summaryPath === null &&
			shellSnapshot.summaryText.includes(`Artifact: ${artifactPath}`) &&
			shellSnapshot.summaryText.includes('"taskFamilyHint": "update_file_and_test"') &&
			shellSnapshot.summaryText.includes('"selectedSpecialist": "JSTSTestBee"') &&
			shellSnapshot.forensicsText.includes("Stage: proposal (specialist_queue)") &&
			shellSnapshot.forensicsText.includes("Selected specialist: JSTSTestBee") &&
			shellSnapshot.forensicsText.includes("Confidence outcome: candidate_preview_only")
			  )
			: liveOutcomeAligned
				? Boolean(summaryPath) &&
					shellSnapshot.summaryPath === summaryPath &&
					shellSnapshot.summaryText.includes(`Artifact: ${summaryPath}`) &&
					shellSnapshot.summaryText.includes('"rowId": "QB-LIVE-GW-01"') &&
					shellSnapshot.summaryText.includes('"gatewayRowId": "QB-GW-01"') &&
					shellSnapshot.summaryText.includes('"providerCallObserved": true') &&
					shellSnapshot.forensicsText.includes("Terminal status: done") &&
					shellSnapshot.forensicsText.includes("Likely failure bucket: success")
				: Boolean(summaryPath) &&
					shellSnapshot.summaryPath === summaryPath &&
					shellSnapshot.summaryText.includes(`Artifact: ${summaryPath}`) &&
					shellSnapshot.summaryText.includes('"rowId": "QB-LIVE-GW-01"') &&
					shellSnapshot.summaryText.includes('"gatewayRowId": "QB-GW-01"') &&
					shellSnapshot.summaryText.includes('"status": "failed"') &&
					shellSnapshot.forensicsText.includes("Terminal status: failed") &&
					shellSnapshot.forensicsText.includes("Likely failure bucket: provider/config failure")

		details.push(
			`scoutTargets=${scoutTargets.join(",") || "missing"}`,
			`planFamily=${String(planPayload?.["taskFamily"] ?? "missing")}`,
			`allowedFiles=${allowedFiles.join(",") || "missing"}`,
			`providerConfigured=${providerConfigured ? "yes" : "no"}`,
			`runtimeMode=${candidatePreviewAligned ? "preview" : liveOutcomeAligned ? "live" : liveAttemptOutcomeAligned ? "live_attempt" : "unknown"}`,
			`summaryStatus=${String(summary?.["status"] ?? "missing")}`,
			`summaryStopReason=${String(summary?.["stopReason"] ?? "missing")}`,
			`previewFamily=${String(artifact?.taskFamilyHint ?? queenbeeLive?.["taskFamily"] ?? "missing")}`,
			`previewSpecialist=${String(artifact?.selectedSpecialist ?? queenbeeLive?.["selectedSpecialist"] ?? "missing")}`,
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
			runtimeOutcomeAligned,
			shellSnapshotAligned,
			repoCleanAfter,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeGatewayHelperTestHarnessResult(result: QueenBeeGatewayHelperTestHarnessResult): string {
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
		`Runtime outcome aligned: ${result.runtimeOutcomeAligned ? "PASS" : "FAIL"}`,
		`Shell snapshot aligned: ${result.shellSnapshotAligned ? "PASS" : "FAIL"}`,
		`Repo clean after: ${result.repoCleanAfter ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeGatewayHelperTestHarness()
	console.log(formatQueenBeeGatewayHelperTestHarnessResult(result))
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
			result.runtimeOutcomeAligned &&
			result.shellSnapshotAligned &&
			result.repoCleanAfter
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:gateway:helper-test] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
