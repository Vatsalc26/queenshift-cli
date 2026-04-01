import fs from "node:fs"
import path from "node:path"

import { Orchestrator } from "../src/Orchestrator"
import { DatabaseService } from "../src/db/DatabaseService"
import { buildMergeOrderArtifact, formatMergeOrderArtifact, type MergeOrderArtifact } from "../src/planning/MergeOrder"
import type { AssignmentLedger } from "../src/planning/AssignmentLedger"
import type { SwarmPlanArtifact } from "../src/planning/PlanSchema"
import { listRoleManualReferences } from "../src/planning/RoleManuals"

export type MergeOrderHarnessResult = {
	dependencyOrderWorks: boolean
	overlapHandlingWorks: boolean
	branchNamesVisible: boolean
	negotiationSurfaceVisible: boolean
	readinessSurfaceVisible: boolean
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
	if (fs.existsSync(swarmDir)) fs.rmSync(swarmDir, { recursive: true, force: true })
	return {
		repoPath,
		cleanup: () => {
			if (fs.existsSync(repoPath)) fs.rmSync(repoPath, { recursive: true, force: true })
		},
	}
}

function fixturePlan(shared = false): SwarmPlanArtifact {
	return {
		schemaVersion: 1,
		task: shared ? "touch shared.ts twice" : "update hello.ts before utils.ts",
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
			dependencyMode: shared ? "parallel" : "serial",
			delegationMode: shared ? "exclusive_parallel" : "staged_parallel",
			clarificationMode: shared ? "dependency_and_same_stage_routes" : "dependency_routes_only",
			completionRule: "assignment_tokens_then_review",
			refusalTriggers: ["overlap", "missing_dependency_reason", "stale_assignment_completion", "unsafe_scope_expansion"],
			reasons: shared ? ["Shared-file fixture keeps two conflicting owners visible."] : ["Dependency fixture keeps ordering explicit."],
		},
		roleContextPolicy: {
			planner: "Use run-level context packs with scout, repo-map, and omission evidence.",
			builder: "Use per-work-item context packs with owned files, task context, and scout context.",
			critic: "Use plan, arbitration, dependency, and omission evidence instead of the builder pack.",
			reviewer: "Use diff evidence plus reviewer-specific bounded context instead of builder edit context.",
		},
		scoutCoverage: {
			source: "explicit_targets",
			coveredFiles: shared ? ["shared.ts"] : ["hello.ts", "utils.ts"],
			omittedFiles: [],
			contextFiles: [],
			corpusTaskId: null,
			corpusLabel: null,
			heuristicsUsed: [],
			notes: [],
			summary: shared ? "Shared file fixture." : "Dependency fixture.",
		},
		workItems: shared
			? [
					{
						id: "subtask-1",
						description: "first shared edit",
						files: ["shared.ts"],
						dependsOn: [],
						assignmentHint: "builder-1",
						status: "planned",
						riskHints: ["shared file"],
						stage: 1,
						ownershipRule: "Shared-file fixture owner.",
						dependencyReason: null,
					},
					{
						id: "subtask-2",
						description: "second shared edit",
						files: ["shared.ts"],
						dependsOn: [],
						assignmentHint: "builder-2",
						status: "planned",
						riskHints: ["shared file"],
						stage: 1,
						ownershipRule: "Shared-file fixture owner.",
						dependencyReason: null,
					},
			  ]
			: [
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
		expectedRisks: ["Multiple work items require explicit merge order."],
		unresolvedQuestions: [],
		roleManuals: listRoleManualReferences(["supervisor", "builder", "critic", "reviewer"]),
		createdAt: "2026-03-22T00:00:00.000Z",
	}
}

function fixtureAssignments(shared = false): AssignmentLedger {
	return {
		schemaVersion: 1,
		handoffValid: true,
		handoffIssues: [],
		assignments: shared
			? [
					{
						workItemId: "subtask-1",
						assignmentId: "assign-subtask-1",
						assignmentToken: "builder-1:subtask-1:1",
						assignedBuilder: "builder-1",
						ownedFiles: ["shared.ts"],
						dependsOn: [],
						status: "assigned",
						blockers: [],
					},
					{
						workItemId: "subtask-2",
						assignmentId: "assign-subtask-2",
						assignmentToken: "builder-2:subtask-2:2",
						assignedBuilder: "builder-2",
						ownedFiles: ["shared.ts"],
						dependsOn: [],
						status: "assigned",
						blockers: [],
					},
			  ]
			: [
					{
						workItemId: "subtask-1",
						assignmentId: "assign-subtask-1",
						assignmentToken: "builder-1:subtask-1:1",
						assignedBuilder: "builder-1",
						ownedFiles: ["hello.ts"],
						dependsOn: [],
						status: "assigned",
						blockers: [],
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
					},
			  ],
	}
}

function readMergeOrder(summaryPath: string): MergeOrderArtifact {
	const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>
	const mergeOrder = summary["mergeOrder"]
	if (!mergeOrder || typeof mergeOrder !== "object" || Array.isArray(mergeOrder)) {
		throw new Error(`Expected merge order artifact in ${summaryPath}`)
	}
	return mergeOrder as MergeOrderArtifact
}

export async function runMergeOrderHarness(rootDir = resolveRootDir()): Promise<MergeOrderHarnessResult> {
	const details: string[] = []
	const repoHarness = createTempRepoCopy(rootDir, "merge-order")
	DatabaseService.reset()
	const dbPath = path.join(rootDir, "verification", `.tmp-merge-order-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)
	const db = DatabaseService.getInstance(dbPath)

	try {
		const planned = buildMergeOrderArtifact({
			taskId: "task-merge-order",
			plan: fixturePlan(false),
			assignments: fixtureAssignments(false),
		})
		const blocked = buildMergeOrderArtifact({
			taskId: "task-merge-overlap",
			plan: fixturePlan(true),
			assignments: fixtureAssignments(true),
		})

		const orchestrator = new Orchestrator(repoHarness.repoPath, db, true)
		const runResult = await orchestrator.run("update hello.ts and utils.ts together")
		const summaryMergeOrder = readMergeOrder(runResult.summaryPath)

		const dependencyOrderWorks =
			planned.status === "planned" &&
			planned.sequence[0]?.workItemId === "subtask-1" &&
			planned.sequence[1]?.workItemId === "subtask-2" &&
			planned.negotiation.sourceBranches[0] === planned.sequence[0]?.branchName &&
			planned.negotiation.sourceBranches[1] === planned.sequence[1]?.branchName
		const overlapHandlingWorks =
			blocked.status === "blocked" &&
			blocked.negotiation.mode === "manual_conflict_review" &&
			blocked.blockers.some((blocker) => blocker.includes("Shared file ownership"))
		const branchNamesVisible =
			planned.sequence.every((entry) => entry.branchName.startsWith("swarm/task-merge-order/")) &&
			planned.negotiation.approvalBranch === "swarm/task-merge-order/integration"
		const negotiationSurfaceVisible =
			summaryMergeOrder.status === "planned" &&
			summaryMergeOrder.sequence.length > 0 &&
			summaryMergeOrder.negotiation.reviewChecklist.length > 0 &&
			formatMergeOrderArtifact(summaryMergeOrder).includes("Negotiation:")
		const readinessSurfaceVisible =
			planned.negotiation.readiness === "ready_for_review" &&
			planned.negotiation.reviewStages.length === 3 &&
			planned.negotiation.handoffSummary.includes("Ordered handoff:") &&
			blocked.negotiation.readiness === "blocked" &&
			formatMergeOrderArtifact(summaryMergeOrder).includes("Readiness:")

		details.push(`summary=${runResult.summaryPath}`)
		details.push(`mergeOrder=${formatMergeOrderArtifact(summaryMergeOrder).split(/\r?\n/g)[0]}`)

		return {
			dependencyOrderWorks,
			overlapHandlingWorks,
			branchNamesVisible,
			negotiationSurfaceVisible,
			readinessSurfaceVisible,
			details,
		}
	} finally {
		db.close()
		DatabaseService.reset()
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
		repoHarness.cleanup()
	}
}

export function formatMergeOrderHarnessResult(result: MergeOrderHarnessResult): string {
	return [
		`Dependency order works: ${result.dependencyOrderWorks ? "PASS" : "FAIL"}`,
		`Overlap handling works: ${result.overlapHandlingWorks ? "PASS" : "FAIL"}`,
		`Branch names visible: ${result.branchNamesVisible ? "PASS" : "FAIL"}`,
		`Negotiation surface visible: ${result.negotiationSurfaceVisible ? "PASS" : "FAIL"}`,
		`Readiness surface visible: ${result.readinessSurfaceVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runMergeOrderHarness()
	console.log(formatMergeOrderHarnessResult(result))
	process.exit(
		result.dependencyOrderWorks &&
			result.overlapHandlingWorks &&
			result.branchNamesVisible &&
			result.negotiationSurfaceVisible &&
			result.readinessSurfaceVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:merge-order] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
