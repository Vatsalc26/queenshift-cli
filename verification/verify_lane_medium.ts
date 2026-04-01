import fs from "node:fs"
import path from "node:path"

import { CoordinatorAgent } from "../src/agents/CoordinatorAgent"
import { StubModelClient } from "../src/model/StubModelClient"
import { buildAssignmentLedger } from "../src/planning/AssignmentLedger"
import { buildCriticArtifact } from "../src/planning/CriticLane"
import { buildMediumLaneReliabilityArtifact } from "../src/planning/MediumLaneReliability"
import { buildSwarmPlanArtifact } from "../src/planning/PlanSchema"
import { buildRepoMapArtifact, type RepoMapGitHints } from "../src/planning/RepoMap"
import { buildTargetedEvaluatorsArtifact } from "../src/planning/TargetedEvaluators"
import { evaluateTaskAdmission } from "../src/run/AdmissionGate"
import { buildModeSelectorDecision } from "../src/run/ModeSelector"
import { ensureRunDir, writeRunSummary } from "../src/run/RunArtifacts"
import { listWorkspaceFilesForDiscovery } from "../src/run/SemiOpenDiscovery"
import type { VerificationProfileResult } from "../src/run/VerificationProfile"

type SummaryLike = Record<string, unknown>

export type MediumLaneHarnessResult = {
	mediumTaskAdmitted: boolean
	tooWideTaskRefused: boolean
	mediumPlanRecorded: boolean
	delegationContractVisible: boolean
	teamShapeVisible: boolean
	criticRequirementVisible: boolean
	targetedEvaluatorVisible: boolean
	mediumLaneReliabilityVisible: boolean
	refactorIntentVisible: boolean
	corpusScoutVisible: boolean
	modelClassificationBypassed: boolean
	modeSelectorVisible: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function writeFile(repoPath: string, relPath: string, content: string): void {
	const filePath = path.join(repoPath, relPath)
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, content, "utf8")
}

function createMediumLaneFixture(rootDir: string): { repoPath: string; cleanup: () => void } {
	const repoPath = path.join(rootDir, "verification", `.tmp-medium-lane-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.mkdirSync(repoPath, { recursive: true })

	writeFile(repoPath, "hello.ts", 'export const helper = () => "hello"\n')
	writeFile(repoPath, "utils.ts", 'import { helper } from "./hello"\n\nexport const twice = (value: number) => value * 2\nexport const callHelper = () => helper()\n')
	writeFile(repoPath, "package.json", `${JSON.stringify({ name: "medium-lane-fixture", version: "1.0.0" }, null, 2)}\n`)
	writeFile(repoPath, "notes.md", "# Notes\n\nhelper is referenced here.\n")
	writeFile(repoPath, "guide.md", "# Guide\n\nRename helper carefully.\n")
	writeFile(repoPath, "extra.ts", 'export const extra = helper => Boolean(helper)\n')

	return {
		repoPath,
		cleanup: () => {
			if (fs.existsSync(repoPath)) fs.rmSync(repoPath, { recursive: true, force: true })
		},
	}
}

function readSummary(summaryPath: string): SummaryLike {
	return JSON.parse(fs.readFileSync(summaryPath, "utf8")) as SummaryLike
}

function buildMediumSubtasks(task: string, files: string[]): Array<{
	id: string
	description: string
	files: string[]
	assignedBuilder: string
}> {
	const builderBuckets = [files.filter((_file, index) => index % 2 === 0), files.filter((_file, index) => index % 2 === 1)]
	return builderBuckets.map((bucket, index) => ({
		id: `subtask-${index + 1}`,
		description: `Update ${bucket.join(", ")} to satisfy: ${task}`,
		files: bucket,
		assignedBuilder: `builder-${index + 1}`,
	}))
}

export async function runMediumLaneHarness(rootDir = resolveRootDir()): Promise<MediumLaneHarnessResult> {
	const details: string[] = []
	const fixture = createMediumLaneFixture(rootDir)
	const mediumTask = "rename helper to formatHelper in hello.ts, utils.ts, package.json, notes.md, guide.md, and extra.ts together"
	const tooWideTask =
		"update a1.ts, a2.ts, a3.ts, a4.ts, a5.ts, a6.ts, a7.ts, a8.ts, a9.ts, a10.ts, and a11.ts together"

	try {
		const mediumAdmission = evaluateTaskAdmission(mediumTask, fixture.repoPath)
		const mediumAllowedFiles = mediumAdmission.derivedTaskContract?.scope?.allowedFiles ?? []
		const mediumTaskAdmitted =
			mediumAdmission.decision === "allow_with_review_bias" &&
			mediumAdmission.reasonCodes.includes("medium_bounded_task") &&
			mediumAllowedFiles.length === 6
		const refactorIntentVisible =
			mediumAdmission.derivedTaskContract?.refactorIntent?.kind === "rename_symbol" &&
			mediumAdmission.derivedTaskContract.refactorIntent.sourceSymbol === "helper" &&
			mediumAdmission.derivedTaskContract.refactorIntent.targetSymbol === "formatHelper" &&
			mediumAdmission.derivedTaskContract.refactorIntent.anchorFile === "hello.ts" &&
			mediumAdmission.derivedTaskContract.refactorIntent.anchorSymbolPresent === true

		const tooWideAdmission = evaluateTaskAdmission(tooWideTask, fixture.repoPath)
		const tooWideTaskRefused =
			tooWideAdmission.decision === "refuse" &&
			tooWideAdmission.reasonCodes.includes("too_many_target_files")

		const fileList = listWorkspaceFilesForDiscovery(fixture.repoPath)
		const routing = await new CoordinatorAgent(new StubModelClient("coordinator_classify")).classifyDetailed(
			mediumTask,
			fileList,
			{ workspaceRoot: fixture.repoPath },
		)
		const allowedFiles = mediumAdmission.derivedTaskContract?.scope?.allowedFiles ?? []
		const repoMap = await buildRepoMapArtifact(fixture.repoPath, {
			fileList,
			gitHintsOverride: {
				available: true,
				branch: "main",
				workingTree: "clean",
				changedFiles: [],
				recentFiles: ["hello.ts", "utils.ts"],
			} satisfies RepoMapGitHints,
		})
		const subtasks = buildMediumSubtasks(mediumTask, allowedFiles)
		const planArtifact = buildSwarmPlanArtifact({
			task: mediumTask,
			routing,
			subtasks,
			builderCountRequested: 2,
			repoMap,
			taskContract: mediumAdmission.derivedTaskContract,
			createdAt: new Date().toISOString(),
		})
		const assignments = buildAssignmentLedger(planArtifact, subtasks)
		const targetedEvaluators = buildTargetedEvaluatorsArtifact({
			plan: planArtifact,
			repoMap,
			taskContract: mediumAdmission.derivedTaskContract,
			changedFiles: [],
		})
		const modeSelector = buildModeSelectorDecision({
			routing,
			guardrailLimits: {
				maxModelCalls: 9,
				maxEstimatedTokens: 42_500,
			},
		})
		const criticArtifact = buildCriticArtifact({
			plan: planArtifact,
			assignments,
			finalStatus: "review_required",
			stopReason: "review_blocked",
			reviewerVerdict: "NEEDS_WORK",
			changedFiles: [],
			targetedEvaluators,
		})
		const runDir = ensureRunDir(fixture.repoPath, "task-medium-fixture")
		const checkpointArtifactPath = path.join(runDir, "checkpoints.json")
		fs.writeFileSync(checkpointArtifactPath, `${JSON.stringify({ schemaVersion: 1, runId: "task-medium-fixture" }, null, 2)}\n`, "utf8")
		const retrySnapshotPath = path.join(runDir, "retry-snapshot.json")
		fs.writeFileSync(retrySnapshotPath, `${JSON.stringify({ schemaVersion: 1, runId: "task-medium-fixture" }, null, 2)}\n`, "utf8")
		const verificationProfile: VerificationProfileResult = {
			status: "passed",
			applied: true,
			applicability: "applied",
			profileName: "local-npm-test",
			profileClass: "local_npm_test_v1",
			executorAdapterId: "npm_test",
			policyPackId: null,
			manifestHash: "fixture-manifest",
			sourcePath: ".swarmcoder.json",
			command: "npm test",
			cwd: ".",
			timeoutMs: 60_000,
			fileScopeHint: [],
			matchedChangedFiles: allowedFiles,
			message: 'Verification profile "local-npm-test" passed.',
			details: [],
			stdout: "",
			stderr: "",
			exitCode: 0,
		}
		const mediumLaneReliability = buildMediumLaneReliabilityArtifact({
			plan: planArtifact,
			modeSelector,
			criticLane: criticArtifact,
			targetedEvaluators,
			verificationProfile,
			checkpointArtifactPath,
			retryPlanner: {
				schemaVersion: 1,
				decision: "retryable",
				continuation: null,
				recoveryState: null,
				reasons: [],
				maxRetryCount: 2,
				retryCountUsed: 0,
				retriesRemaining: 2,
				strictSnapshotRequired: true,
				snapshotPath: retrySnapshotPath,
				proposals: [],
				summary: "Fixture retry snapshot stays visible.",
			},
		})
		const summaryPath = writeRunSummary(runDir, {
			taskId: "task-medium-fixture",
			task: mediumTask,
			workspace: fixture.repoPath,
			status: "review_required",
			stopReason: "review_blocked",
			pathChosen: "medium",
			modelClassificationUsed: routing.usedModel,
			modeSelector,
			mediumLaneReliability,
			plan: planArtifact,
			targetedEvaluators,
			criticLane: criticArtifact,
			checkpointArtifactPath,
			verificationProfile,
		})
		const summary = readSummary(summaryPath)
		const plan = (summary["plan"] as Record<string, unknown> | null) ?? null
		const critic = (summary["criticLane"] as Record<string, unknown> | null) ?? null
		const targetedEvaluatorsSummary = (summary["targetedEvaluators"] as Record<string, unknown> | null) ?? null
		const expectedRisks = Array.isArray(plan?.["expectedRisks"]) ? (plan?.["expectedRisks"] as string[]) : []
		const triggerReasons = Array.isArray(critic?.["triggerReasons"]) ? (critic?.["triggerReasons"] as string[]) : []
		const workItems = Array.isArray(plan?.["workItems"]) ? (plan?.["workItems"] as Array<Record<string, unknown>>) : []
		const mediumPlanRecorded =
			plan?.["pathChosen"] === "medium" &&
			workItems.length === 2 &&
			plan?.["builderCountRequested"] === 2 &&
			plan?.["builderCountRecommended"] === 2 &&
			expectedRisks.some((risk) => risk.includes("Medium bounded lane")) &&
			expectedRisks.some((risk) => risk.includes("Symbol-aware rename lane"))
		const arbitration = (plan?.["arbitration"] as Record<string, unknown> | null) ?? null
		const delegationContractVisible =
			arbitration?.["delegationMode"] === "exclusive_parallel" &&
			arbitration?.["clarificationMode"] === "dependency_and_same_stage_routes" &&
			arbitration?.["completionRule"] === "assignment_tokens_then_review"
		const teamShape = (plan?.["teamShape"] as Record<string, unknown> | null) ?? null
		const builderProfiles = Array.isArray(teamShape?.["builderProfiles"]) ? (teamShape?.["builderProfiles"] as Array<Record<string, unknown>>) : []
		const teamShapeVisible =
			teamShape?.["shapeId"] === "medium_parallel_lane" &&
			String(teamShape?.["summary"] ?? "").includes("medium lane") &&
			builderProfiles.some((profile) => profile["specializationId"] === "rename_anchor_owner") &&
			builderProfiles.some((profile) => profile["specializationId"] === "medium_bucket_owner")
		const scoutCoverage = (plan?.["scoutCoverage"] as Record<string, unknown> | null) ?? null
		const scoutContextFiles = Array.isArray(scoutCoverage?.["contextFiles"]) ? (scoutCoverage["contextFiles"] as string[]) : []
		const scoutNotes = Array.isArray(scoutCoverage?.["notes"]) ? (scoutCoverage["notes"] as string[]) : []
		const scoutHeuristics = Array.isArray(scoutCoverage?.["heuristicsUsed"]) ? (scoutCoverage["heuristicsUsed"] as string[]) : []
		const criticRequirementVisible =
			Boolean(critic?.["enabled"]) &&
			triggerReasons.includes("medium bounded lane") &&
			triggerReasons.includes("multiple work items")
		const targetedEvaluatorVisible =
			Boolean(targetedEvaluatorsSummary?.["enabled"]) &&
			targetedEvaluatorsSummary?.["status"] === "concern" &&
			(targetedEvaluatorsSummary?.["summary"] as string | undefined)?.includes("targeted evaluator") === true
		const mediumLaneReliabilityRecord = (summary["mediumLaneReliability"] as Record<string, unknown> | null) ?? null
		const mediumLaneReliabilityVisible =
			mediumLaneReliabilityRecord?.["laneId"] === "medium_lane_reliability_pack" &&
			mediumLaneReliabilityRecord?.["status"] === "ready" &&
			mediumLaneReliabilityRecord?.["deterministicRouting"] === true &&
			mediumLaneReliabilityRecord?.["criticVisible"] === true &&
			mediumLaneReliabilityRecord?.["targetedEvaluatorsVisible"] === true &&
			mediumLaneReliabilityRecord?.["verificationState"] === "passed" &&
			mediumLaneReliabilityRecord?.["checkpointReady"] === true &&
			mediumLaneReliabilityRecord?.["retrySnapshotReady"] === true &&
			Array.isArray(mediumLaneReliabilityRecord?.["evidence"]) &&
			(mediumLaneReliabilityRecord?.["evidence"] as string[]).some((entry) => entry.includes("targeted evaluator")) &&
			Array.isArray(mediumLaneReliabilityRecord?.["nextFocus"]) &&
			(mediumLaneReliabilityRecord?.["nextFocus"] as string[]).length === 0
		const modeSelectorRecord = (summary["modeSelector"] as Record<string, unknown> | null) ?? null
		const modeSelectorVisible =
			modeSelectorRecord?.["modeId"] === "high_context_medium_lane" &&
			modeSelectorRecord?.["routingPath"] === "medium" &&
			modeSelectorRecord?.["costTier"] === "high" &&
			modeSelectorRecord?.["maxModelCalls"] === 9 &&
			modeSelectorRecord?.["maxEstimatedTokens"] === 42_500 &&
			modeSelectorRecord?.["selectorSource"] === "explicit_targets" &&
			Array.isArray(modeSelectorRecord?.["reasonCodes"]) &&
			(modeSelectorRecord?.["reasonCodes"] as string[]).includes("medium_target_count") &&
			(modeSelectorRecord?.["reasonCodes"] as string[]).includes("guardrail_budget_high")
		const corpusScoutVisible =
			scoutCoverage?.["corpusTaskId"] === "medium_multi_file_update" &&
			scoutCoverage?.["corpusLabel"] === "Explicit medium multi-file update" &&
			scoutContextFiles.every((file) => !allowedFiles.includes(file)) &&
			scoutHeuristics.includes("task_corpus_match") &&
			scoutNotes.some((note) => note.includes("Task corpus match: medium_multi_file_update")) &&
			scoutNotes.some((note) => note.includes("Medium scout stays bounded"))
		const modelClassificationBypassed = summary["modelClassificationUsed"] === false

		details.push(`mediumAdmission=${mediumAdmission.decision}:${mediumAdmission.reasonCodes.join(",")}`)
		details.push(`summary=${summaryPath}`)

		return {
			mediumTaskAdmitted,
			tooWideTaskRefused,
			mediumPlanRecorded,
			delegationContractVisible,
			teamShapeVisible,
			criticRequirementVisible,
			targetedEvaluatorVisible,
			mediumLaneReliabilityVisible,
			refactorIntentVisible,
			corpusScoutVisible,
			modelClassificationBypassed,
			modeSelectorVisible,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatMediumLaneHarnessResult(result: MediumLaneHarnessResult): string {
	return [
		`Medium task admitted: ${result.mediumTaskAdmitted ? "PASS" : "FAIL"}`,
		`Too-wide task refused: ${result.tooWideTaskRefused ? "PASS" : "FAIL"}`,
		`Medium plan recorded: ${result.mediumPlanRecorded ? "PASS" : "FAIL"}`,
		`Delegation contract visible: ${result.delegationContractVisible ? "PASS" : "FAIL"}`,
		`Team shape visible: ${result.teamShapeVisible ? "PASS" : "FAIL"}`,
		`Critic requirement visible: ${result.criticRequirementVisible ? "PASS" : "FAIL"}`,
		`Targeted evaluator visible: ${result.targetedEvaluatorVisible ? "PASS" : "FAIL"}`,
		`Medium-lane reliability visible: ${result.mediumLaneReliabilityVisible ? "PASS" : "FAIL"}`,
		`Refactor intent visible: ${result.refactorIntentVisible ? "PASS" : "FAIL"}`,
		`Corpus scout visible: ${result.corpusScoutVisible ? "PASS" : "FAIL"}`,
		`Model classification bypassed: ${result.modelClassificationBypassed ? "PASS" : "FAIL"}`,
		`Mode selector visible: ${result.modeSelectorVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runMediumLaneHarness()
	console.log(formatMediumLaneHarnessResult(result))
	process.exit(
		result.mediumTaskAdmitted &&
			result.tooWideTaskRefused &&
			result.mediumPlanRecorded &&
			result.delegationContractVisible &&
			result.teamShapeVisible &&
			result.criticRequirementVisible &&
			result.targetedEvaluatorVisible &&
			result.mediumLaneReliabilityVisible &&
			result.refactorIntentVisible &&
			result.corpusScoutVisible &&
			result.modelClassificationBypassed &&
			result.modeSelectorVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:lane:medium] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
