import fs from "node:fs"
import path from "node:path"

import { buildProgressMap, formatProgressMap, type ProgressMap } from "../src/planning/ProgressMap"
import type { AssignmentLedger } from "../src/planning/AssignmentLedger"
import type { CompletionLedger } from "../src/planning/CompletionLedger"
import { buildDependencyGraphArtifact } from "../src/planning/DependencyGraph"
import type { SwarmPlanArtifact } from "../src/planning/PlanSchema"
import { listRoleManualReferences } from "../src/planning/RoleManuals"
import { ensureRunDir, writeRunSummary, type RunEvent } from "../src/run/RunArtifacts"

export type ProgressMapHarnessResult = {
	inProgressStateVisible: boolean
	dependencyWaitVisible: boolean
	dependencyReleaseVisible: boolean
	completeStateVisible: boolean
	stageWindowVisible: boolean
	progressArtifactVisible: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function createTempRepoCopy(rootDir: string, name: string): { repoPath: string; cleanup: () => void } {
	const repoPath = path.join(rootDir, "verification", `.tmp-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.cpSync(path.join(rootDir, "verification", "test_workspace"), repoPath, { recursive: true, force: true })
	const swarmDir = path.join(repoPath, ".swarm")
	if (fs.existsSync(swarmDir)) fs.rmSync(swarmDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
	return {
		repoPath,
		cleanup: () => {
			if (fs.existsSync(repoPath)) fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
		},
	}
}

function readProgressMap(summaryPath: string): ProgressMap {
	const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>
	const progressMap = summary["progressMap"]
	if (!progressMap || typeof progressMap !== "object" || Array.isArray(progressMap)) {
		throw new Error(`Expected progress map in ${summaryPath}`)
	}
	return progressMap as ProgressMap
}

function fixturePlan(): SwarmPlanArtifact {
	return {
		schemaVersion: 1,
		task: "update hello.ts before utils.ts",
		pathChosen: "scoped",
		planStatus: "planned",
		executionStatus: "running",
		builderCountRequested: 2,
		builderCountRecommended: 2,
		arbitration: {
			schemaVersion: 1,
			requestedBuilderCount: 2,
			activeBuilderCount: 2,
			strategy: "parallel_split",
			dependencyMode: "serial",
			delegationMode: "staged_parallel",
			clarificationMode: "dependency_routes_only",
			completionRule: "assignment_tokens_then_review",
			refusalTriggers: ["overlap", "missing_dependency_reason", "stale_assignment_completion", "unsafe_scope_expansion"],
			reasons: ["Second work item waits on the first."],
		},
		roleContextPolicy: {
			planner: "Use run-level context packs with scout, repo-map, and omission evidence.",
			builder: "Use per-work-item context packs with owned files, task context, and scout context.",
			critic: "Use plan, arbitration, dependency, and omission evidence instead of the builder pack.",
			reviewer: "Use diff evidence plus reviewer-specific bounded context instead of builder edit context.",
		},
		scoutCoverage: {
			source: "explicit_targets",
			coveredFiles: ["hello.ts", "utils.ts"],
			omittedFiles: [],
			contextFiles: [],
			corpusTaskId: null,
			corpusLabel: null,
			heuristicsUsed: [],
			notes: [],
			summary: "Dependency fixture.",
		},
		workItems: [
			{
				id: "subtask-1",
				description: "update hello.ts",
				files: ["hello.ts"],
				dependsOn: [],
				assignmentHint: "builder-1",
				status: "planned",
				riskHints: [],
				stage: 1,
				ownershipRule: "First bounded owner.",
				dependencyReason: null,
			},
			{
				id: "subtask-2",
				description: "update utils.ts after hello.ts",
				files: ["utils.ts"],
				dependsOn: ["subtask-1"],
				assignmentHint: "builder-2",
				status: "planned",
				riskHints: ["dependency"],
				stage: 2,
				ownershipRule: "Follow-on bounded owner.",
				dependencyReason: "Wait for subtask-1 before updating utils.ts.",
			},
		],
		expectedRisks: ["Dependency fixture."],
		unresolvedQuestions: [],
		roleManuals: listRoleManualReferences(["supervisor", "builder", "critic", "reviewer"]),
		createdAt: "2026-03-24T00:00:00.000Z",
	}
}

function fixtureAssignments(): AssignmentLedger {
	return {
		schemaVersion: 1,
		handoffValid: true,
		handoffIssues: [],
		arbitration: {
			schemaVersion: 1,
			requestedBuilderCount: 2,
			activeBuilderCount: 2,
			strategy: "parallel_split",
			dependencyMode: "serial",
			delegationMode: "staged_parallel",
			clarificationMode: "dependency_routes_only",
			completionRule: "assignment_tokens_then_review",
			refusalTriggers: ["overlap", "missing_dependency_reason", "stale_assignment_completion", "unsafe_scope_expansion"],
			reasons: ["Second work item waits on the first."],
		},
		assignments: [
			{
				workItemId: "subtask-1",
				assignmentId: "assign-subtask-1",
				assignmentToken: "builder-1:subtask-1:1",
				assignedBuilder: "builder-1",
				ownedFiles: ["hello.ts"],
				dependsOn: [],
				status: "assigned",
				blockers: [],
				stage: 1,
				ownershipRule: "First bounded owner.",
				dependencyReason: null,
			},
			{
				workItemId: "subtask-2",
				assignmentId: "assign-subtask-2",
				assignmentToken: "builder-2:subtask-2:2",
				assignedBuilder: "builder-2",
				ownedFiles: ["utils.ts"],
				dependsOn: ["subtask-1"],
				status: "assigned",
				blockers: [],
				stage: 2,
				ownershipRule: "Follow-on bounded owner.",
				dependencyReason: "Wait for subtask-1 before updating utils.ts.",
			},
		],
	}
}

function fixtureEvents(): RunEvent[] {
	return [
		{ type: "agent_start", agentId: "builder-1" },
		{ type: "agent_iteration", agentId: "builder-1", role: "builder", iteration: 1 },
	]
}

function fixtureCompletion(state: "complete" | "blocked"): CompletionLedger {
	const entries = [
		{
			workItemId: "subtask-1",
			assignmentId: "assign-subtask-1",
			assignmentToken: "builder-1:subtask-1:1",
			runId: "task-current",
			state,
			stage: 1,
			dependsOn: [],
			dependencyState: state === "complete" ? ("released" as const) : ("ready" as const),
			releasedWorkItems: state === "complete" ? ["subtask-2"] : [],
			proofArtifactPath: state === "complete" ? "summary.json" : null,
			proofReason: state === "complete" ? "summary proof" : "blocked proof",
		},
		...(state === "complete"
			? [
					{
						workItemId: "subtask-2",
						assignmentId: "assign-subtask-2",
						assignmentToken: "builder-2:subtask-2:2",
						runId: "task-current",
						state: "complete" as const,
						stage: 2,
						dependsOn: ["subtask-1"],
						dependencyState: "ready" as const,
						releasedWorkItems: [],
						proofArtifactPath: "summary.json",
						proofReason: "summary proof",
					},
			  ]
			: []),
	]
	return {
		schemaVersion: 1,
		proofBeforeDoneValid: state === "complete",
		dependencyGraphSafe: state === "complete",
		continuationSurface: state === "complete" ? "retry_planner_checkpoint_artifacts" : "not_needed",
		stageSummary: {
			totalStages: state === "complete" ? 2 : 1,
			activeStage: state === "complete" ? null : 1,
			completedStages: state === "complete" ? [1, 2] : [],
			remainingStages: state === "complete" ? [] : [1],
			nextStage: state === "complete" ? null : null,
			anchorWorkItems: state === "complete" ? [] : ["subtask-1"],
			summary: state === "complete" ? "All 2 stage(s) complete." : "Stage 1 is active; next stage (none).",
		},
		entries,
	}
}

export async function runProgressMapHarness(rootDir = resolveRootDir()): Promise<ProgressMapHarnessResult> {
	const details: string[] = []
	const repoHarness = createTempRepoCopy(rootDir, "progress-map")

	try {
		const assignments = fixtureAssignments()
		const dependencyGraph = buildDependencyGraphArtifact({
			plan: fixturePlan(),
			assignments,
		})
		const inProgress = buildProgressMap({
			assignments: {
				...assignments,
				assignments: [assignments.assignments[0]!],
			},
			completionLedger: null,
			events: fixtureEvents(),
			dependencyGraph,
		})
		const dependencyWait = buildProgressMap({
			assignments,
			completionLedger: null,
			events: fixtureEvents(),
			dependencyGraph,
		})
		const complete = buildProgressMap({
			assignments,
			completionLedger: fixtureCompletion("complete"),
			events: fixtureEvents(),
			dependencyGraph,
		})
		const runDir = ensureRunDir(repoHarness.repoPath, "task-progress-fixture")
		const summaryPath = writeRunSummary(runDir, {
			taskId: "task-progress-fixture",
			task: "update hello.ts and utils.ts together",
			workspace: repoHarness.repoPath,
			status: "review_required",
			stopReason: "review_blocked",
			progressMap: dependencyWait,
		})
		const dependencyWaitFromArtifact = readProgressMap(summaryPath)

		const inProgressStateVisible =
			inProgress !== null &&
			inProgress.entries[0]?.state === "in_progress" &&
			inProgress.entries[0]?.dependencyState === "ready" &&
			inProgress.readyAssignmentIds.includes("assign-subtask-1") === true
		const dependencyWaitVisible =
			dependencyWait !== null &&
			dependencyWait.entries[1]?.state === "blocked" &&
			dependencyWait.entries[1]?.waitingOn.includes("subtask-1") === true &&
			dependencyWait.entries[1]?.dependencyState === "waiting" &&
			dependencyWait.blockedAssignmentIds.includes("assign-subtask-2") === true
		const dependencyReleaseVisible =
			complete !== null &&
			complete.entries[0]?.dependencyState === "released" &&
			complete.entries[0]?.releasedWorkItems.includes("subtask-2") === true &&
			complete.releasedAssignmentIds.includes("assign-subtask-1") === true
		const completeStateVisible =
			complete !== null &&
			complete.entries.every((entry) => entry.state === "complete") === true &&
			complete.entries[1]?.history.includes("complete") === true
		const stageWindowVisible =
			dependencyWait !== null &&
			complete !== null &&
			dependencyWait.stageSummary.totalStages === 2 &&
			dependencyWait.stageSummary.activeStage === 1 &&
			dependencyWait.stageSummary.nextStage === 2 &&
			complete.stageSummary.activeStage === null &&
			complete.stageSummary.completedStages.join(",") === "1,2"
		const progressArtifactVisible =
			dependencyWaitFromArtifact.entries.length > 0 &&
			formatProgressMap(dependencyWaitFromArtifact).includes("Stage summary: active=1 next=2") &&
			formatProgressMap(dependencyWaitFromArtifact).includes("waitingOn=subtask-1") &&
			formatProgressMap(dependencyWaitFromArtifact).includes("Summary: ready=assign-subtask-1")

		details.push(`summary=${summaryPath}`)
		details.push(`blocked=${formatProgressMap(dependencyWaitFromArtifact).split(/\r?\n/g)[2] ?? "(none)"}`)

		return {
			inProgressStateVisible,
			dependencyWaitVisible,
			dependencyReleaseVisible,
			completeStateVisible,
			stageWindowVisible,
			progressArtifactVisible,
			details,
		}
	} finally {
		repoHarness.cleanup()
	}
}

export function formatProgressMapHarnessResult(result: ProgressMapHarnessResult): string {
	return [
		`In-progress state visible: ${result.inProgressStateVisible ? "PASS" : "FAIL"}`,
		`Dependency wait visible: ${result.dependencyWaitVisible ? "PASS" : "FAIL"}`,
		`Dependency release visible: ${result.dependencyReleaseVisible ? "PASS" : "FAIL"}`,
		`Complete state visible: ${result.completeStateVisible ? "PASS" : "FAIL"}`,
		`Stage window visible: ${result.stageWindowVisible ? "PASS" : "FAIL"}`,
		`Progress artifact visible: ${result.progressArtifactVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runProgressMapHarness()
	console.log(formatProgressMapHarnessResult(result))
	process.exit(
		result.inProgressStateVisible &&
			result.dependencyWaitVisible &&
			result.dependencyReleaseVisible &&
			result.completeStateVisible &&
			result.stageWindowVisible &&
			result.progressArtifactVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:progress-map] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
