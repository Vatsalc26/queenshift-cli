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

export type QueenBeeGatewayNodeCommandHarnessResult = {
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
	scoutCompilesScope: boolean
	plannerCompilesFamily: boolean
	candidatePreviewAligned: boolean
	shellSnapshotAligned: boolean
	repoCleanAfter: boolean
	details: string[]
}

async function setupNodeCommandFixture(repoPath: string): Promise<void> {
	const cliPath = path.join(repoPath, "src", "cli.ts")
	fs.mkdirSync(path.dirname(cliPath), { recursive: true })
	fs.writeFileSync(cliPath, `export function runCli(): string {\n\treturn "queenbee"\n}\n`, "utf8")
	await commitFixtureChanges(repoPath, "verification gateway node-command baseline")
}

export async function runQueenBeeGatewayNodeCommandHarness(
	rootDir = resolveRootDir(),
): Promise<QueenBeeGatewayNodeCommandHarnessResult> {
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
		packageJson.scripts?.["verify:queenbee:gateway:node-command"] ===
		"npm run build && node dist/verification/verify_queenbee_gateway_node_command.js"

	const gatewayTaskSetAligned = includesAll(gatewayTaskSetText, [
		"`QB-GW-03`",
		"`verify:queenbee:gateway:node-command`",
		"`QB-GW-03` is now `SUPPORTED`",
		"`JSTSNodeBee`",
		"`candidate_preview_only`",
	])

	const reverseEngineeringMapAligned = includesAll(reverseEngineeringMapText, [
		"## Gateway Reverse-Engineering Matrix",
		"`QB-GW-03`",
		"`SUPPORTED` after Session 237",
		"`JSTSNodeBee`",
		"`candidate_preview_only`",
	])

	const traceabilityAligned = includesAll(traceabilityText, [
		"`QB-TR-16`",
		"`gateway_node_command`",
		"`verify:queenbee:gateway:node-command`",
		"`JSTSNodeBee`",
	])

	const sideBySideAligned = includesAll(sideBySideText, [
		"`QB-EX-10`",
		"active comparison row",
		"preview-hold evidence",
	])

	const gapRegisterAligned = includesAll(gapRegisterText, [
		"`QB-GAP-237-01`",
		"`CLOSED_SESSION_237`",
		"Node or CLI discovery stays limited to one or two explicit command files",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B43 |",
		"`npm.cmd run verify:queenbee:gateway:node-command`",
		"`JSTSNodeBee`",
		"`candidate_preview_only`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"64. the Session 237 node-command gateway row now records one proof-backed bounded Node/CLI answer",
		"`npm.cmd run verify:queenbee:gateway:node-command`",
	])

	const benchmarkPlanAligned = includesAll(benchmarkPlanText, [
		"`QB-BM-10`",
		"active candidate comparison row",
		"`verify:queenbee:gateway:node-command`",
	])

	const expertRubricAligned = includesAll(expertRubricText, [
		"## Session 237 Gateway Row Reading",
		"Node/CLI gateway row fails scope fidelity",
		"`candidate_preview_only`",
	])

	const reproReadingAligned = includesAll(reproText, [
		"## Session 237 Gateway Row Repro Reading",
		"`QB-GW-03` and `QB-GW-04`",
		"`JSTSNodeBee`",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 237 hardens the remaining QueenBee gateway rows without widening the public beta boundary",
		"**Session:** 237",
		"`verify:queenbee:gateway:node-command`",
	])

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-gateway-node-command")
	try {
		await setupNodeCommandFixture(fixture.repoPath)

		const task =
			'update package.json and src/cli.ts together so package.json keeps one bounded CLI script and src/cli.ts includes the exact comment "// queenbee: gateway node"'
		const expectedFiles = ["package.json", "src/cli.ts"]

		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath })

		const scoutRequest = buildQueenBeeEnvelope({
			messageId: "msg-gateway-node-scout",
			missionId: "mission-gateway-node-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.scout.001",
			messageType: "scout_request",
			timestamp: "2026-03-29T09:00:00Z",
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
			String(scoutPayload?.["scoutSummary"] ?? "").includes("bounded_node_cli_task")

		const planRequest = buildQueenBeeEnvelope({
			messageId: "msg-gateway-node-plan",
			missionId: "mission-gateway-node-2",
			assignmentId: "assign-gateway-node-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-29T09:01:00Z",
			payload: {
				task,
				targetFiles: scoutTargets,
				languagePack: "js_ts",
				protectedFiles: ["utils.ts"],
			},
		})
		const planResult = shell.router.routeEnvelope(planRequest)
		const planPayload = asRecord(planResult.responseEnvelope?.payload)
		const planPacketPayload = asRecord(readAssignmentPacket(planResult.responseEnvelope)?.payload)
		const allowedFiles = Array.isArray(planPacketPayload?.["allowedFiles"]) ? (planPacketPayload["allowedFiles"] as string[]) : []
		const plannerCompilesFamily =
			planResult.status === "delivered" &&
			planPayload?.["accepted"] === true &&
			planPayload?.["taskFamily"] === "bounded_node_cli_task" &&
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
			cliResult.stdout.includes("Current bounded candidate hint: bounded_node_cli_task over package.json, src/cli.ts.") &&
			cliResult.stdout.includes("Selected specialist: JSTSNodeBee.") &&
			cliResult.stdout.includes(`Progress artifact: ${artifactPath}.`) &&
			cliResult.stdout.includes("Confidence outcome: candidate_preview_only.") &&
			cliResult.stderr.includes("[Swarm] Engine not ready.") &&
			Boolean(artifact) &&
			artifact?.engine === "queenbee" &&
			artifact?.status === "candidate_not_ready" &&
			artifact?.stopReason === "candidate_engine_not_ready" &&
			artifact?.taskFamilyHint === "bounded_node_cli_task" &&
			hasSameFileSet(artifact?.allowedFiles ?? [], expectedFiles) &&
			artifact?.activeQueue === "specialist_queue" &&
			artifact?.currentStage === "proposal" &&
			artifact?.selectedSpecialist === "JSTSNodeBee" &&
			artifact?.confidenceOutcome === "candidate_preview_only" &&
			artifact?.executionAttempted === false &&
			artifact?.assignmentId === "qb-preview-bounded_node_cli_task" &&
			typeof artifact?.lastEventAt === "string" &&
			artifact.lastEventAt.length > 0 &&
			typeof artifact?.nextTimeoutAt === "string" &&
			artifact.nextTimeoutAt.length > 0 &&
			typeof artifact?.nextExpectedHandoff === "string" &&
			artifact.nextExpectedHandoff.includes("JSTSNodeBee")

		const shellSnapshotAligned =
			shellSnapshot.summaryPath === null &&
			shellSnapshot.summaryText.includes(`Artifact: ${artifactPath}`) &&
			shellSnapshot.summaryText.includes('"taskFamilyHint": "bounded_node_cli_task"') &&
			shellSnapshot.summaryText.includes('"selectedSpecialist": "JSTSNodeBee"') &&
			shellSnapshot.forensicsText.includes("Stage: proposal (specialist_queue)") &&
			shellSnapshot.forensicsText.includes("Selected specialist: JSTSNodeBee") &&
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
			capabilityChecklistAligned,
			verificationCatalogAligned,
			benchmarkPlanAligned,
			expertRubricAligned,
			reproReadingAligned,
			architectureDecisionRecorded,
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

export function formatQueenBeeGatewayNodeCommandHarnessResult(result: QueenBeeGatewayNodeCommandHarnessResult): string {
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
		`Scout compiles scope: ${result.scoutCompilesScope ? "PASS" : "FAIL"}`,
		`Planner compiles family: ${result.plannerCompilesFamily ? "PASS" : "FAIL"}`,
		`Candidate preview aligned: ${result.candidatePreviewAligned ? "PASS" : "FAIL"}`,
		`Shell snapshot aligned: ${result.shellSnapshotAligned ? "PASS" : "FAIL"}`,
		`Repo clean after: ${result.repoCleanAfter ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeGatewayNodeCommandHarness()
	console.log(formatQueenBeeGatewayNodeCommandHarnessResult(result))
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
		console.error(`[verify:queenbee:gateway:node-command] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
