import fs from "node:fs"
import path from "node:path"

import { buildSwarmPlanArtifact, formatSwarmPlanArtifact, validateSwarmPlanArtifact, type SwarmPlanArtifact } from "../src/planning/PlanSchema"
import type { RepoMapArtifact } from "../src/planning/RepoMap"

export type PlanSchemaHarnessResult = {
	stableSubtaskIds: boolean
	dependencyFieldsPresent: boolean
	builderCountAwareHints: boolean
	planningHorizonVisible: boolean
	roleContextPolicyVisible: boolean
	corpusScoutVisible: boolean
	planExecutionSeparated: boolean
	refusalFailsClosed: boolean
	repoMapAttached: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function fixtureRepoMap(): RepoMapArtifact {
	return {
		schemaVersion: 1,
		workspaceName: "plan-schema-fixture",
		generatedAt: "2026-03-22T00:00:00.000Z",
		totalFiles: 3,
		topLevelEntries: [
			{ path: "src", kind: "dir", role: "source", fileCount: 2 },
			{ path: "package.json", kind: "file", role: "config" },
		],
		keyFiles: ["package.json", "src/hello.ts"],
		likelyEntryPoints: ["src/hello.ts"],
		ignoredAreas: [".git", ".swarm", "node_modules"],
		fileTypeBreakdown: [{ extension: ".ts", count: 2 }],
		styleHints: {
			dominantCodeExtension: ".ts",
			importStyle: "esm",
			fileNameStyles: ["flat"],
		},
		gitHints: {
			available: true,
			branch: "main",
			workingTree: "clean",
			changedFiles: [],
			recentFiles: ["src/hello.ts"],
		},
		plannerSummary: ["Repo map fixture for plan schema proof."],
	}
}

export async function runPlanSchemaHarness(rootDir = resolveRootDir()): Promise<PlanSchemaHarnessResult> {
	const details: string[] = []
	const plan = buildSwarmPlanArtifact({
		task: "update hello.ts and utils.ts together",
		routing: {
			complexity: "COMPLEX",
			path: "scoped",
			usedModel: false,
			targetFiles: ["hello.ts", "utils.ts"],
			selectorSource: "explicit_targets",
			reasonCodes: ["explicit_file_targets", "bounded_target_count", "prefer_deterministic_coordination"],
			taskContract: null,
		},
		subtasks: [{ id: "subtask-1", description: "update hello.ts and utils.ts together", files: ["hello.ts", "utils.ts"], assignedBuilder: "builder-1" }],
		builderCountRequested: 2,
		repoMap: fixtureRepoMap(),
		createdAt: "2026-03-22T00:00:00.000Z",
	})
	const validation = validateSwarmPlanArtifact(plan)

	const finalizedPlan: SwarmPlanArtifact = {
		...plan,
		executionStatus: "blocked",
	}
	const stableSubtaskIds =
		validation.valid &&
		plan.workItems.length === 1 &&
		plan.workItems[0]?.id === "subtask-1" &&
		plan.workItems[0]?.files.includes("hello.ts") &&
		plan.workItems[0]?.files.includes("utils.ts")
	const dependencyFieldsPresent = plan.workItems.every((item) => Array.isArray(item.dependsOn))
	const builderCountAwareHints =
		plan.builderCountRequested === 2 &&
		plan.builderCountRecommended === 1 &&
		plan.scoutCoverage.source === "explicit_targets" &&
		plan.arbitration.strategy === "single_owner"
	const stagedPlan = buildSwarmPlanArtifact({
		task: "update hello.ts before utils.ts",
		routing: {
			complexity: "COMPLEX",
			path: "scoped",
			usedModel: false,
			targetFiles: ["hello.ts", "utils.ts"],
			selectorSource: "explicit_targets",
			reasonCodes: ["explicit_file_targets", "bounded_target_count", "prefer_deterministic_coordination"],
			taskContract: null,
		},
		subtasks: [
			{
				id: "subtask-1",
				description: "update hello.ts",
				files: ["hello.ts"],
				assignedBuilder: "builder-1",
				stage: 1,
				ownershipRule: "First bounded owner.",
				dependencyReason: null,
			},
			{
				id: "subtask-2",
				description: "update utils.ts after hello.ts",
				files: ["utils.ts"],
				assignedBuilder: "builder-2",
				dependsOn: ["subtask-1"],
				stage: 2,
				ownershipRule: "Follow-on bounded owner.",
				dependencyReason: "Wait for subtask-1 before updating utils.ts.",
			},
		],
		builderCountRequested: 2,
		repoMap: fixtureRepoMap(),
		createdAt: "2026-03-22T00:00:00.000Z",
	})
	const planningHorizonVisible =
		stagedPlan.planningHorizon?.mode === "stage_gated" &&
		stagedPlan.planningHorizon.totalStages === 2 &&
		stagedPlan.planningHorizon.continuationSurface === "retry_planner_checkpoint_artifacts" &&
		formatSwarmPlanArtifact(stagedPlan).includes("Planning horizon:")
	const roleContextPolicyVisible =
		plan.roleContextPolicy.planner.includes("run-level context packs") &&
		plan.roleContextPolicy.builder.includes("per-work-item context packs") &&
		plan.roleContextPolicy.critic.includes("arbitration") &&
		plan.roleContextPolicy.reviewer.includes("reviewer-specific bounded context")
	const corpusScoutVisible =
		plan.scoutCoverage.corpusTaskId === "bounded_two_file_update" &&
		plan.scoutCoverage.corpusLabel === "Bounded two-file coordination" &&
		plan.scoutCoverage.contextFiles.includes("package.json") &&
		plan.scoutCoverage.heuristicsUsed.includes("task_corpus_match")
	const planExecutionSeparated =
		finalizedPlan.planStatus === "planned" &&
		(finalizedPlan.executionStatus === "done" || finalizedPlan.executionStatus === "blocked")
	const repoMapAttached =
		Boolean(plan.repoMap) &&
		plan.repoMap?.schemaVersion === 1 &&
		plan.repoMap?.topLevelEntries.length > 0 &&
		plan.repoMap?.plannerSummary.length > 0

	const refused = buildSwarmPlanArtifact({
		task: "ambiguous complex task",
		routing: {
			complexity: "COMPLEX",
			path: "complex",
			usedModel: true,
			targetFiles: [],
			selectorSource: "model_complex",
			reasonCodes: ["ambiguous_task_needs_classifier", "model_selected_complex", "reserve_heavier_swarm"],
			taskContract: null,
		},
		subtasks: [],
		builderCountRequested: 2,
		createdAt: "2026-03-22T00:00:00.000Z",
	})
	const refusalFailsClosed =
		refused.planStatus === "refused" &&
		refused.executionStatus === "not_started" &&
		refused.unresolvedQuestions.length > 0

		details.push(`plan=${formatSwarmPlanArtifact(plan).split(/\r?\n/g)[0]}`)
	details.push(`horizon=${stagedPlan.planningHorizon?.summary ?? "(missing)"}`)
	details.push(`roleManuals=${plan.roleManuals.map((manual) => `${manual.role}@${manual.version}`).join(",")}`)
	details.push(`refusedStatus=${refused.planStatus}/${refused.executionStatus}`)

	return {
		stableSubtaskIds,
		dependencyFieldsPresent,
		builderCountAwareHints,
		planningHorizonVisible,
		roleContextPolicyVisible,
		corpusScoutVisible,
		planExecutionSeparated,
		refusalFailsClosed,
		repoMapAttached,
		details,
	}
}

export function formatPlanSchemaHarnessResult(result: PlanSchemaHarnessResult): string {
	return [
		`Stable subtask ids: ${result.stableSubtaskIds ? "PASS" : "FAIL"}`,
		`Dependency fields present: ${result.dependencyFieldsPresent ? "PASS" : "FAIL"}`,
		`Builder-count aware hints: ${result.builderCountAwareHints ? "PASS" : "FAIL"}`,
		`Planning horizon visible: ${result.planningHorizonVisible ? "PASS" : "FAIL"}`,
		`Role context policy visible: ${result.roleContextPolicyVisible ? "PASS" : "FAIL"}`,
		`Corpus scout visible: ${result.corpusScoutVisible ? "PASS" : "FAIL"}`,
		`Plan vs execution separated: ${result.planExecutionSeparated ? "PASS" : "FAIL"}`,
		`Refusal fails closed: ${result.refusalFailsClosed ? "PASS" : "FAIL"}`,
		`Repo map attached: ${result.repoMapAttached ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runPlanSchemaHarness()
	console.log(formatPlanSchemaHarnessResult(result))
	process.exit(
			result.stableSubtaskIds &&
			result.dependencyFieldsPresent &&
			result.builderCountAwareHints &&
			result.planningHorizonVisible &&
			result.roleContextPolicyVisible &&
			result.corpusScoutVisible &&
			result.planExecutionSeparated &&
			result.refusalFailsClosed &&
			result.repoMapAttached
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:plan-schema] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
