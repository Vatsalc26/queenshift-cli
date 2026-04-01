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

export type QueenBeeGatewayUiLogicHarnessResult = {
	packageScriptPresent: boolean
	gatewayTaskSetAligned: boolean
	reverseEngineeringMapAligned: boolean
	traceabilityAligned: boolean
	sideBySideAligned: boolean
	gapRegisterAligned: boolean
	capabilityChecklistAligned: boolean
	verificationCatalogAligned: boolean
	benchmarkPlanAligned: boolean
	expertRubricAligned: boolean
	reproReadingAligned: boolean
	architectureDecisionRecorded: boolean
	scoutCompilesDirectScope: boolean
	scoutCompilesAnchorScope: boolean
	plannerCompilesDirectFamily: boolean
	plannerCompilesAnchorFamily: boolean
	plannerRefusesPreScoutAnchorLane: boolean
	candidatePreviewAligned: boolean
	shellSnapshotAligned: boolean
	repoCleanAfter: boolean
	details: string[]
}

async function setupUiLogicFixture(repoPath: string): Promise<void> {
	const componentPath = path.join(repoPath, "src", "ui", "Panel.tsx")
	const logicPath = path.join(repoPath, "src", "ui", "panelLogic.ts")
	fs.mkdirSync(path.dirname(componentPath), { recursive: true })
	fs.writeFileSync(
		componentPath,
		`import { buildPanelLabel } from "./panelLogic"\n\nexport function Panel(): string {\n\treturn buildPanelLabel("queenbee")\n}\n`,
		"utf8",
	)
	fs.writeFileSync(
		logicPath,
		`export function buildPanelLabel(input: string): string {\n\treturn input.toUpperCase()\n}\n`,
		"utf8",
	)
	await commitFixtureChanges(repoPath, "verification gateway ui-logic baseline")
}

export async function runQueenBeeGatewayUiLogicHarness(
	rootDir = resolveRootDir(),
): Promise<QueenBeeGatewayUiLogicHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const gatewayTaskSetText = readText(rootDir, "QUEENBEE_GATEWAY_TASK_SET.md")
	const reverseEngineeringMapText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const traceabilityText = readText(rootDir, "QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
	const sideBySideText = readText(rootDir, "QUEENBEE_SIDE_BY_SIDE_EXAMPLES.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const benchmarkPlanText = readText(rootDir, "QUEENBEE_BENCHMARK_PLAN.md")
	const expertRubricText = readText(rootDir, "QUEENBEE_EXPERT_EVAL_RUBRIC.md")
	const reproText = readText(rootDir, "QUEENBEE_MODEL_VARIANCE_AND_REPRODUCIBILITY.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:gateway:ui-logic"] ===
		"npm run build && node dist/verification/verify_queenbee_gateway_ui_logic.js"

	const gatewayTaskSetAligned = includesAll(gatewayTaskSetText, [
		"`QB-GW-04`",
		"`verify:queenbee:gateway:ui-logic`",
		"`QB-GW-04` is now `SUPPORTED`",
		"`JSTSRefactorBee`",
		"`candidate_preview_only`",
		"one named existing UI anchor when ScoutBee can derive exactly one direct same-directory JS/TS companion",
	])

	const reverseEngineeringMapAligned = includesAll(reverseEngineeringMapText, [
		"## Gateway Reverse-Engineering Matrix",
		"`QB-GW-04`",
		"`SUPPORTED` after Session 237",
		"`JSTSRefactorBee`",
		"`candidate_preview_only`",
		"## Session 273 Repo-Local Scope Answer",
		"one named UI anchor may now expand to exactly one direct same-directory UI companion",
	])

	const traceabilityAligned = includesAll(traceabilityText, [
		"`QB-TR-17`",
		"`gateway_ui_logic`",
		"`verify:queenbee:gateway:ui-logic`",
		"`JSTSRefactorBee`",
		"`verify:queenbee:gateway`",
		"one named existing UI anchor plus one direct same-directory JS/TS companion",
	])

	const sideBySideAligned = includesAll(sideBySideText, [
		"`QB-EX-11`",
		"active comparison row",
		"preview-hold evidence",
		"## Session 273 Repo-Local UI Anchor Reading",
		"one named existing UI anchor",
	])

	const gapRegisterAligned = includesAll(gapRegisterText, [
		"`QB-GAP-237-01`",
		"`CLOSED_SESSION_237`",
		"existing-file UI logic stays limited to exactly two explicit JS/TS files",
		"`QB-GAP-273-01`",
		"`CLOSED_SESSION_273`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B43 |",
		"`npm.cmd run verify:queenbee:gateway:ui-logic`",
		"`JSTSRefactorBee`",
		"`candidate_preview_only`",
		"| B63 |",
		"`npm.cmd run verify:queenbee:gateway`",
		"one named existing UI anchor",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"65. the Session 237 existing-file UI gateway row now records one proof-backed bounded UI-logic answer",
		"`npm.cmd run verify:queenbee:gateway:ui-logic`",
		"the Session 273 bounded repo-local scope widening now accepts one named UI anchor",
	])

	const benchmarkPlanAligned = includesAll(benchmarkPlanText, [
		"`QB-BM-11`",
		"active candidate comparison row",
		"`verify:queenbee:gateway:ui-logic`",
		"## Session 273 Repo-Local UI Anchor Reading",
		"`verify:queenbee:gateway`",
	])

	const expertRubricAligned = includesAll(expertRubricText, [
		"## Session 237 Gateway Row Reading",
		"existing-file UI gateway row fails scope fidelity",
		"`candidate_preview_only`",
		"## Session 273 Repo-Local UI Anchor Reading",
		"one named existing UI anchor plus exactly one direct same-directory JS/TS companion",
	])

	const reproReadingAligned = includesAll(reproText, [
		"## Session 237 Gateway Row Repro Reading",
		"`QB-GW-03` and `QB-GW-04`",
		"`JSTSRefactorBee`",
		"## Session 273 Repo-Local UI Anchor Reading",
		"`QB-GW-04`",
		"anchor file plus exactly one direct same-directory UI companion",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 237 hardens the remaining QueenBee gateway rows without widening the public beta boundary",
		"**Session:** 237",
		"`verify:queenbee:gateway:ui-logic`",
		"## Decision: Session 273 widens bounded repo-local natural-language scope by one UI-anchor lane and one aggregate gateway proof",
		"**Session:** 273",
		"`QB-GW-04`",
	])

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-gateway-ui-logic")
	try {
		await setupUiLogicFixture(fixture.repoPath)

		const directTask =
			'update src/ui/Panel.tsx and src/ui/panelLogic.ts together so both files include the exact comment "// queenbee: gateway ui"'
		const anchorTask =
			'update src/ui/Panel.tsx and keep its direct ui logic aligned so both files include the exact comment "// queenbee: gateway ui anchor"'
		const expectedFiles = ["src/ui/Panel.tsx", "src/ui/panelLogic.ts"]

		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath })

		const directScoutRequest = buildQueenBeeEnvelope({
			messageId: "msg-gateway-ui-scout-direct",
			missionId: "mission-gateway-ui-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.scout.001",
			messageType: "scout_request",
			timestamp: "2026-03-29T09:10:00Z",
			payload: {
				task: directTask,
				workspace: fixture.repoPath,
				languagePack: "js_ts",
			},
		})
		const directScoutResult = shell.router.routeEnvelope(directScoutRequest)
		const directScoutPayload = asRecord(directScoutResult.responseEnvelope?.payload)
		const directScoutTargets = Array.isArray(directScoutPayload?.["targetFiles"]) ? (directScoutPayload["targetFiles"] as string[]) : []
		const scoutCompilesDirectScope =
			directScoutResult.status === "delivered" &&
			directScoutPayload?.["accepted"] === true &&
			hasSameFileSet(directScoutTargets, expectedFiles) &&
			String(directScoutPayload?.["scoutSummary"] ?? "").includes("bounded_two_file_update")

		const anchorScoutRequest = buildQueenBeeEnvelope({
			messageId: "msg-gateway-ui-scout-anchor",
			missionId: "mission-gateway-ui-1b",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.scout.001",
			messageType: "scout_request",
			timestamp: "2026-04-01T10:25:00Z",
			payload: {
				task: anchorTask,
				workspace: fixture.repoPath,
				languagePack: "js_ts",
			},
		})
		const anchorScoutResult = shell.router.routeEnvelope(anchorScoutRequest)
		const anchorScoutPayload = asRecord(anchorScoutResult.responseEnvelope?.payload)
		const anchorScoutTargets = Array.isArray(anchorScoutPayload?.["targetFiles"]) ? (anchorScoutPayload["targetFiles"] as string[]) : []
		const scoutCompilesAnchorScope =
			anchorScoutResult.status === "delivered" &&
			anchorScoutPayload?.["accepted"] === true &&
			hasSameFileSet(anchorScoutTargets, expectedFiles) &&
			String(anchorScoutPayload?.["scoutSummary"] ?? "").includes("ui_logic")

		const directPlanRequest = buildQueenBeeEnvelope({
			messageId: "msg-gateway-ui-plan-direct",
			missionId: "mission-gateway-ui-2",
			assignmentId: "assign-gateway-ui-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-29T09:11:00Z",
			payload: {
				task: directTask,
				targetFiles: directScoutTargets,
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
			},
		})
		const directPlanResult = shell.router.routeEnvelope(directPlanRequest)
		const directPlanPayload = asRecord(directPlanResult.responseEnvelope?.payload)
		const directPlanPacketPayload = asRecord(readAssignmentPacket(directPlanResult.responseEnvelope)?.payload)
		const directAllowedFiles = Array.isArray(directPlanPacketPayload?.["allowedFiles"])
			? (directPlanPacketPayload["allowedFiles"] as string[])
			: []
		const plannerCompilesDirectFamily =
			directPlanResult.status === "delivered" &&
			directPlanPayload?.["accepted"] === true &&
			directPlanPayload?.["taskFamily"] === "bounded_two_file_update" &&
			hasSameFileSet(directAllowedFiles, expectedFiles)

		const anchorPlanRequest = buildQueenBeeEnvelope({
			messageId: "msg-gateway-ui-plan-anchor",
			missionId: "mission-gateway-ui-2b",
			assignmentId: "assign-gateway-ui-2b",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-04-01T10:26:00Z",
			payload: {
				task: anchorTask,
				targetFiles: anchorScoutTargets,
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
			},
		})
		const anchorPlanResult = shell.router.routeEnvelope(anchorPlanRequest)
		const anchorPlanPayload = asRecord(anchorPlanResult.responseEnvelope?.payload)
		const anchorPlanPacketPayload = asRecord(readAssignmentPacket(anchorPlanResult.responseEnvelope)?.payload)
		const anchorAllowedFiles = Array.isArray(anchorPlanPacketPayload?.["allowedFiles"])
			? (anchorPlanPacketPayload["allowedFiles"] as string[])
			: []
		const plannerCompilesAnchorFamily =
			anchorPlanResult.status === "delivered" &&
			anchorPlanPayload?.["accepted"] === true &&
			anchorPlanPayload?.["taskFamily"] === "bounded_two_file_update" &&
			hasSameFileSet(anchorAllowedFiles, expectedFiles)

		const preScoutAnchorPlanRequest = buildQueenBeeEnvelope({
			messageId: "msg-gateway-ui-plan-anchor-only",
			missionId: "mission-gateway-ui-2c",
			assignmentId: "assign-gateway-ui-2c",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-04-01T10:27:00Z",
			payload: {
				task: anchorTask,
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
			},
		})
		const preScoutAnchorPlanResult = shell.router.routeEnvelope(preScoutAnchorPlanRequest)
		const preScoutAnchorPlanPayload = asRecord(preScoutAnchorPlanResult.responseEnvelope?.payload)
		const plannerRefusesPreScoutAnchorLane =
			preScoutAnchorPlanResult.status === "delivered" &&
			preScoutAnchorPlanPayload?.["accepted"] === false &&
			preScoutAnchorPlanPayload?.["reason"] === "natural_language_scope_requires_scout_resolution"

		const cliResult = await runCli(rootDir, ["--engine", "queenbee", "--task", anchorTask, "--workspace", fixture.repoPath], process.env)
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
			cliResult.stdout.includes("Current bounded candidate hint: bounded_two_file_update over src/ui/Panel.tsx, src/ui/panelLogic.ts.") &&
			cliResult.stdout.includes("Selected specialist: JSTSRefactorBee.") &&
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
			artifact?.selectedSpecialist === "JSTSRefactorBee" &&
			artifact?.confidenceOutcome === "candidate_preview_only" &&
			artifact?.executionAttempted === false &&
			artifact?.assignmentId === "qb-preview-bounded_two_file_update" &&
			typeof artifact?.lastEventAt === "string" &&
			artifact.lastEventAt.length > 0 &&
			typeof artifact?.nextTimeoutAt === "string" &&
			artifact.nextTimeoutAt.length > 0 &&
			typeof artifact?.nextExpectedHandoff === "string" &&
			artifact.nextExpectedHandoff.includes("JSTSRefactorBee")

		const shellSnapshotAligned =
			shellSnapshot.summaryPath === null &&
			shellSnapshot.summaryText.includes(`Artifact: ${artifactPath}`) &&
			shellSnapshot.summaryText.includes('"taskFamilyHint": "bounded_two_file_update"') &&
			shellSnapshot.summaryText.includes('"selectedSpecialist": "JSTSRefactorBee"') &&
			shellSnapshot.forensicsText.includes("Stage: proposal (specialist_queue)") &&
			shellSnapshot.forensicsText.includes("Selected specialist: JSTSRefactorBee") &&
			shellSnapshot.forensicsText.includes("Confidence outcome: candidate_preview_only")

		details.push(
			`directScoutTargets=${directScoutTargets.join(",") || "missing"}`,
			`anchorScoutTargets=${anchorScoutTargets.join(",") || "missing"}`,
			`directPlanFamily=${String(directPlanPayload?.["taskFamily"] ?? "missing")}`,
			`anchorPlanFamily=${String(anchorPlanPayload?.["taskFamily"] ?? "missing")}`,
			`directAllowedFiles=${directAllowedFiles.join(",") || "missing"}`,
			`anchorAllowedFiles=${anchorAllowedFiles.join(",") || "missing"}`,
			`preScoutAnchorReason=${String(preScoutAnchorPlanPayload?.["reason"] ?? "missing")}`,
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
			capabilityChecklistAligned,
			verificationCatalogAligned,
			benchmarkPlanAligned,
			expertRubricAligned,
			reproReadingAligned,
			architectureDecisionRecorded,
			scoutCompilesDirectScope,
			scoutCompilesAnchorScope,
			plannerCompilesDirectFamily,
			plannerCompilesAnchorFamily,
			plannerRefusesPreScoutAnchorLane,
			candidatePreviewAligned,
			shellSnapshotAligned,
			repoCleanAfter,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeGatewayUiLogicHarnessResult(result: QueenBeeGatewayUiLogicHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Gateway task set aligned: ${result.gatewayTaskSetAligned ? "PASS" : "FAIL"}`,
		`Reverse-engineering map aligned: ${result.reverseEngineeringMapAligned ? "PASS" : "FAIL"}`,
		`Traceability aligned: ${result.traceabilityAligned ? "PASS" : "FAIL"}`,
		`Side-by-side aligned: ${result.sideBySideAligned ? "PASS" : "FAIL"}`,
		`Gap register aligned: ${result.gapRegisterAligned ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Benchmark plan aligned: ${result.benchmarkPlanAligned ? "PASS" : "FAIL"}`,
		`Expert rubric aligned: ${result.expertRubricAligned ? "PASS" : "FAIL"}`,
		`Repro reading aligned: ${result.reproReadingAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Scout compiles direct scope: ${result.scoutCompilesDirectScope ? "PASS" : "FAIL"}`,
		`Scout compiles anchor scope: ${result.scoutCompilesAnchorScope ? "PASS" : "FAIL"}`,
		`Planner compiles direct family: ${result.plannerCompilesDirectFamily ? "PASS" : "FAIL"}`,
		`Planner compiles anchor family: ${result.plannerCompilesAnchorFamily ? "PASS" : "FAIL"}`,
		`Planner refuses pre-scout anchor lane: ${result.plannerRefusesPreScoutAnchorLane ? "PASS" : "FAIL"}`,
		`Candidate preview aligned: ${result.candidatePreviewAligned ? "PASS" : "FAIL"}`,
		`Shell snapshot aligned: ${result.shellSnapshotAligned ? "PASS" : "FAIL"}`,
		`Repo clean after: ${result.repoCleanAfter ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeGatewayUiLogicHarness()
	console.log(formatQueenBeeGatewayUiLogicHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.gatewayTaskSetAligned &&
			result.reverseEngineeringMapAligned &&
			result.traceabilityAligned &&
			result.sideBySideAligned &&
			result.gapRegisterAligned &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned &&
			result.benchmarkPlanAligned &&
			result.expertRubricAligned &&
			result.reproReadingAligned &&
			result.architectureDecisionRecorded &&
			result.scoutCompilesDirectScope &&
			result.scoutCompilesAnchorScope &&
			result.plannerCompilesDirectFamily &&
			result.plannerCompilesAnchorFamily &&
			result.plannerRefusesPreScoutAnchorLane &&
			result.candidatePreviewAligned &&
			result.shellSnapshotAligned &&
			result.repoCleanAfter
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:gateway:ui-logic] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
