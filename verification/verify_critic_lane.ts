import fs from "node:fs"
import path from "node:path"

import { buildAssignmentLedger } from "../src/planning/AssignmentLedger"
import { buildCriticArtifact, formatCriticArtifact, type CriticArtifact } from "../src/planning/CriticLane"
import { buildSwarmPlanArtifact } from "../src/planning/PlanSchema"
import { buildTargetedEvaluatorsArtifact } from "../src/planning/TargetedEvaluators"
import { ensureRunDir, writeRunSummary } from "../src/run/RunArtifacts"
import { buildScopedTaskContract } from "../src/run/TaskContract"

export type CriticLaneHarnessResult = {
	entryConditionsBounded: boolean
	structuredOutputVisible: boolean
	concernVisibleOnComplexRun: boolean
	arbitrationConcernVisible: boolean
	teamShapeSpecializationVisible: boolean
	refactorConcernVisible: boolean
	targetedEvaluatorVisible: boolean
	renameEvaluatorVisible: boolean
	executionTruthSeparated: boolean
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

function readSummary(summaryPath: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>
}

function readCritic(summaryPath: string): CriticArtifact {
	const summary = readSummary(summaryPath)
	const critic = summary["criticLane"]
	if (!critic || typeof critic !== "object" || Array.isArray(critic)) {
		throw new Error(`Expected critic lane artifact in ${summaryPath}`)
	}
	return critic as CriticArtifact
}

export async function runCriticLaneHarness(rootDir = resolveRootDir()): Promise<CriticLaneHarnessResult> {
	const details: string[] = []
	const repoHarness = createTempRepoCopy(rootDir, "critic-lane")

	try {
		const lowRiskPlan = buildSwarmPlanArtifact({
			task: "update hello.ts",
			routing: {
				complexity: "COMPLEX",
				path: "scoped",
				usedModel: false,
				targetFiles: ["hello.ts"],
				selectorSource: "explicit_targets",
				reasonCodes: ["explicit_file_targets", "bounded_target_count", "prefer_deterministic_coordination"],
			},
			subtasks: [{ id: "subtask-1", description: "update hello.ts", files: ["hello.ts"], assignedBuilder: "builder-1" }],
			builderCountRequested: 1,
			createdAt: "2026-03-22T00:00:00.000Z",
		})
		const lowRiskCritic = buildCriticArtifact({
			plan: lowRiskPlan,
			assignments: null,
			finalStatus: "done",
			stopReason: "success",
			reviewerVerdict: "PASS",
			changedFiles: ["hello.ts"],
		})

		const complexTaskContract = {
			...buildScopedTaskContract(["hello.ts", "utils.ts"]),
			refactorIntent: {
				kind: "rename_symbol" as const,
				sourceSymbol: "helper",
				targetSymbol: "formatHelper",
				anchorFile: "hello.ts",
				relatedFiles: ["hello.ts", "utils.ts"],
				languagePackId: "javascript_typescript" as const,
				anchorSymbolPresent: true,
			},
		}
		const complexPlan = buildSwarmPlanArtifact({
			task: "rename helper to formatHelper in hello.ts and utils.ts together",
			routing: {
				complexity: "COMPLEX",
				path: "scoped",
				usedModel: false,
				targetFiles: ["hello.ts", "utils.ts"],
				selectorSource: "explicit_targets",
				reasonCodes: ["explicit_file_targets", "bounded_target_count", "prefer_deterministic_coordination"],
			},
			subtasks: [
				{
					id: "subtask-1",
					description: "update hello.ts first",
					files: ["hello.ts"],
					assignedBuilder: "builder-1",
					stage: 1,
					ownershipRule: "Anchor owner.",
					dependencyReason: null,
				},
				{
					id: "subtask-2",
					description: "update utils.ts after hello.ts",
					files: ["utils.ts"],
					assignedBuilder: "builder-2",
					dependsOn: ["subtask-1"],
					stage: 2,
					ownershipRule: "Follow-on owner.",
					dependencyReason: "Wait for subtask-1 before updating utils.ts.",
				},
			],
			builderCountRequested: 3,
			arbitration: {
				schemaVersion: 1,
				requestedBuilderCount: 3,
				activeBuilderCount: 2,
				strategy: "parallel_split",
				dependencyMode: "serial",
				delegationMode: "staged_parallel",
				clarificationMode: "dependency_routes_only",
				completionRule: "assignment_tokens_then_review",
				refusalTriggers: ["overlap", "missing_dependency_reason", "stale_assignment_completion", "unsafe_scope_expansion"],
				reasons: ["One worker slot stays unused because this bounded rename needs serial follow-on ownership."],
			},
			taskContract: complexTaskContract,
			createdAt: "2026-03-24T00:00:00.000Z",
		})
		const complexSubtasks = [
			{
				id: "subtask-1",
				description: "update hello.ts first",
				files: ["hello.ts"],
				assignedBuilder: "builder-1",
				stage: 1,
				ownershipRule: "Anchor owner.",
				dependencyReason: null,
			},
			{
				id: "subtask-2",
				description: "update utils.ts after hello.ts",
				files: ["utils.ts"],
				assignedBuilder: "builder-2",
				dependsOn: ["subtask-1"],
				stage: 2,
				ownershipRule: "Follow-on owner.",
				dependencyReason: "Wait for subtask-1 before updating utils.ts.",
			},
		]
		const complexAssignments = buildAssignmentLedger(complexPlan, complexSubtasks)
		const targetedEvaluators = buildTargetedEvaluatorsArtifact({
			plan: complexPlan,
			taskContract: complexTaskContract,
			changedFiles: [],
		})
		const complexCritic = buildCriticArtifact({
			plan: complexPlan,
			assignments: complexAssignments,
			finalStatus: "review_required",
			stopReason: "review_blocked",
			reviewerVerdict: "NEEDS_WORK",
			changedFiles: [],
			targetedEvaluators,
		})
		const runDir = ensureRunDir(repoHarness.repoPath, "task-critic-fixture")
		const summaryPath = writeRunSummary(runDir, {
			taskId: "task-critic-fixture",
			task: "update hello.ts and utils.ts together",
			workspace: repoHarness.repoPath,
			status: "review_required",
			stopReason: "review_blocked",
			criticLane: complexCritic,
			targetedEvaluators,
		})
		const critic = readCritic(summaryPath)
		const summary = readSummary(summaryPath)
		const summaryStatus = typeof summary["status"] === "string" ? String(summary["status"]) : ""
		const targetedEvaluatorsSummary =
			summary["targetedEvaluators"] && typeof summary["targetedEvaluators"] === "object" && !Array.isArray(summary["targetedEvaluators"])
				? (summary["targetedEvaluators"] as Record<string, unknown>)
				: null
		const evaluatorList = Array.isArray(targetedEvaluatorsSummary?.["evaluators"])
			? (targetedEvaluatorsSummary?.["evaluators"] as Array<Record<string, unknown>>)
			: []

		const entryConditionsBounded = lowRiskCritic.enabled === false && lowRiskCritic.status === "not_applicable"
		const structuredOutputVisible = critic.concerns.every(
			(concern) => Boolean(concern.category && concern.evidence.trim() && concern.recommendedAction.trim()),
		)
		const concernVisibleOnComplexRun = critic.enabled && critic.status === "concern" && critic.concerns.length > 0
		const arbitrationConcernVisible =
			critic.triggerReasons.includes("dynamic worker arbitration") &&
			critic.triggerReasons.includes("serialized dependencies") &&
			critic.triggerReasons.some((reason) => reason.includes("specialized team shape")) &&
			critic.concerns.some(
				(concern) =>
					concern.category === "handoff_risk" &&
					concern.evidence.includes("activated 2/3 builders") &&
					concern.evidence.includes("dependency mode serial") &&
					concern.evidence.includes("rename_anchor_owner"),
			)
		const teamShapeSpecializationVisible = critic.concerns.some(
			(concern) =>
				concern.category === "specialist_check" &&
				concern.evidence.includes("staged_handoff_lane") &&
				concern.recommendedAction.includes("anchor rename consistency"),
		)
		const refactorConcernVisible = critic.concerns.some(
			(concern) => concern.category === "refactor_risk" && concern.evidence.includes("helper") && concern.evidence.includes("formatHelper"),
		)
		const targetedEvaluatorVisible =
			Boolean(targetedEvaluatorsSummary?.["enabled"]) &&
			targetedEvaluatorsSummary?.["status"] === "concern" &&
			(targetedEvaluatorsSummary?.["concernCount"] as number | undefined) !== undefined
		const renameEvaluatorVisible = evaluatorList.some((evaluator) => {
			const findings = Array.isArray(evaluator["findings"]) ? (evaluator["findings"] as Array<Record<string, unknown>>) : []
			return (
				evaluator["evaluatorId"] === "rename_symbol_consistency" &&
				evaluator["status"] === "concern" &&
				findings.some((finding) => String(finding["evidence"] ?? "").includes("formatHelper"))
			)
		})
		const executionTruthSeparated = (summaryStatus === "failed" || summaryStatus === "review_required") && critic.status === "concern"

		details.push(`summary=${summaryPath}`)
		details.push(`critic=${formatCriticArtifact(critic).split(/\r?\n/g)[0]}`)

		return {
			entryConditionsBounded,
			structuredOutputVisible,
			concernVisibleOnComplexRun,
			arbitrationConcernVisible,
			teamShapeSpecializationVisible,
			refactorConcernVisible,
			targetedEvaluatorVisible,
			renameEvaluatorVisible,
			executionTruthSeparated,
			details,
		}
	} finally {
		repoHarness.cleanup()
	}
}

export function formatCriticLaneHarnessResult(result: CriticLaneHarnessResult): string {
	return [
		`Entry conditions bounded: ${result.entryConditionsBounded ? "PASS" : "FAIL"}`,
		`Structured output visible: ${result.structuredOutputVisible ? "PASS" : "FAIL"}`,
		`Concern visible on complex run: ${result.concernVisibleOnComplexRun ? "PASS" : "FAIL"}`,
		`Arbitration concern visible: ${result.arbitrationConcernVisible ? "PASS" : "FAIL"}`,
		`Team-shape specialization visible: ${result.teamShapeSpecializationVisible ? "PASS" : "FAIL"}`,
		`Refactor concern visible: ${result.refactorConcernVisible ? "PASS" : "FAIL"}`,
		`Targeted evaluator visible: ${result.targetedEvaluatorVisible ? "PASS" : "FAIL"}`,
		`Rename evaluator visible: ${result.renameEvaluatorVisible ? "PASS" : "FAIL"}`,
		`Execution truth separated: ${result.executionTruthSeparated ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runCriticLaneHarness()
	console.log(formatCriticLaneHarnessResult(result))
	process.exit(
		result.entryConditionsBounded &&
			result.structuredOutputVisible &&
			result.concernVisibleOnComplexRun &&
			result.arbitrationConcernVisible &&
			result.teamShapeSpecializationVisible &&
			result.refactorConcernVisible &&
			result.targetedEvaluatorVisible &&
			result.renameEvaluatorVisible &&
			result.executionTruthSeparated
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:critic-lane] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
