import type { RoutingDecision, RoutingPath } from "../agents/CoordinatorAgent"
import type { Subtask } from "../agents/SupervisorAgent"
import type { RepoMapArtifact } from "./RepoMap"
import { listRoleManualReferences, type RoleManualReference } from "./RoleManuals"
import type { RefactorIntent, TaskContract } from "../run/TaskContract"
import { buildScoutLaneEvidence } from "./ScoutLane"
import { inferSupervisorArbitrationFromSubtasks, type SupervisorArbitrationSummary } from "./SupervisorArbitration"
import { buildPlanningHorizonArtifact, type PlanningHorizonArtifact } from "./PlanningHorizon"
import { buildTeamShapeArtifact, type TeamShapeArtifact } from "./TeamShape"

export type SwarmPlanStatus = "planned" | "refused"
export type SwarmExecutionStatus = "not_started" | "running" | "done" | "blocked"

export type ScoutCoverageSummary = {
	source: "explicit_targets" | "semi_open_discovery" | "model_classification" | "deterministic_fallback"
	coveredFiles: string[]
	omittedFiles: string[]
	contextFiles: string[]
	corpusTaskId: string | null
	corpusLabel: string | null
	heuristicsUsed: string[]
	notes: string[]
	summary: string
}

export type PlanWorkItem = {
	id: string
	description: string
	files: string[]
	dependsOn: string[]
	assignmentHint: string
	status: "planned"
	riskHints: string[]
	stage?: number
	ownershipRule?: string | null
	dependencyReason?: string | null
}

export type SwarmPlanArtifact = {
	schemaVersion: 1
	task: string
	pathChosen: RoutingPath
	planStatus: SwarmPlanStatus
	executionStatus: SwarmExecutionStatus
	builderCountRequested: number
	builderCountRecommended: number
	arbitration: SupervisorArbitrationSummary
	planningHorizon?: PlanningHorizonArtifact
	teamShape?: TeamShapeArtifact
	roleContextPolicy: {
		planner: string
		builder: string
		critic: string
		reviewer: string
	}
	scoutCoverage: ScoutCoverageSummary
	workItems: PlanWorkItem[]
	expectedRisks: string[]
	unresolvedQuestions: string[]
	roleManuals: RoleManualReference[]
	repoMap?: RepoMapArtifact | null
	refactorIntent?: RefactorIntent | null
	createdAt: string
}

export type PlanValidationResult = {
	valid: boolean
	issues: string[]
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)))
}

function buildScoutCoverage(
	task: string,
	routing: RoutingDecision,
	subtasks: Subtask[],
	repoMap?: RepoMapArtifact | null,
	taskContract?: TaskContract | null,
): ScoutCoverageSummary {
	const coveredFiles = uniqueStrings(
		(routing.taskContract?.scope?.allowedFiles ?? [])
			.concat(routing.targetFiles)
			.concat(subtasks.flatMap((subtask) => subtask.files)),
	)
	const scoutEvidence = buildScoutLaneEvidence({
		task,
		routing,
		repoMap,
		taskContract,
	})
	const contextFiles = uniqueStrings(scoutEvidence.contextFiles).filter((file) => !coveredFiles.includes(file))

	if (routing.path === "semi_open") {
		return {
			source: "semi_open_discovery",
			coveredFiles,
			omittedFiles: [],
			contextFiles,
			corpusTaskId: scoutEvidence.corpusTaskId,
			corpusLabel: scoutEvidence.corpusLabel,
			heuristicsUsed: scoutEvidence.heuristicsUsed,
			notes: scoutEvidence.notes,
			summary: coveredFiles.length > 0
				? `Semi-open discovery bounded planning to ${coveredFiles.join(", ")}.${contextFiles.length > 0 ? ` Scout context: ${contextFiles.join(", ")}.` : ""}`
				: "Semi-open discovery did not resolve explicit files.",
		}
	}

	if (!routing.usedModel && routing.targetFiles.length > 0) {
		return {
			source: "explicit_targets",
			coveredFiles,
			omittedFiles: [],
			contextFiles,
			corpusTaskId: scoutEvidence.corpusTaskId,
			corpusLabel: scoutEvidence.corpusLabel,
			heuristicsUsed: scoutEvidence.heuristicsUsed,
			notes: scoutEvidence.notes,
			summary:
				routing.path === "medium"
					? `Explicit medium-lane targets drove the plan across ${coveredFiles.length} files: ${coveredFiles.join(", ")}.${contextFiles.length > 0 ? ` Scout context: ${contextFiles.join(", ")}.` : ""}`
					: `Explicit task targets drove the plan: ${coveredFiles.join(", ")}.${contextFiles.length > 0 ? ` Scout context: ${contextFiles.join(", ")}.` : ""}`,
		}
	}

	if (routing.usedModel) {
		return {
			source: "model_classification",
			coveredFiles,
			omittedFiles: [],
			contextFiles,
			corpusTaskId: scoutEvidence.corpusTaskId,
			corpusLabel: scoutEvidence.corpusLabel,
			heuristicsUsed: scoutEvidence.heuristicsUsed,
			notes: scoutEvidence.notes,
			summary: coveredFiles.length > 0
				? `Model classification produced a bounded plan over ${coveredFiles.join(", ")}.${contextFiles.length > 0 ? ` Scout context: ${contextFiles.join(", ")}.` : ""}`
				: "Model classification selected the complex lane without explicit file coverage.",
		}
	}

	return {
		source: "deterministic_fallback",
		coveredFiles,
		omittedFiles: [],
		contextFiles,
		corpusTaskId: scoutEvidence.corpusTaskId,
		corpusLabel: scoutEvidence.corpusLabel,
		heuristicsUsed: scoutEvidence.heuristicsUsed,
		notes: scoutEvidence.notes,
		summary: coveredFiles.length > 0
			? `Deterministic fallback produced a bounded plan over ${coveredFiles.join(", ")}.${contextFiles.length > 0 ? ` Scout context: ${contextFiles.join(", ")}.` : ""}`
			: "Deterministic fallback produced a plan without explicit file coverage.",
	}
}

function buildPlanRisks(routing: RoutingDecision, subtasks: Subtask[], taskContract?: TaskContract | null): string[] {
	const risks: string[] = []
	if (routing.path === "semi_open") risks.push("Semi-open discovery may omit neighbors beyond the bounded derived file set.")
	if (routing.path === "medium") {
		risks.push("Medium bounded lane (6-10 files) requires critic review, checkpoint-aware artifacts, and explicit retry evidence before done.")
	}
	if (taskContract?.refactorIntent) {
		const refactorIntent = taskContract.refactorIntent
		risks.push(
			`Symbol-aware rename lane: rename ${refactorIntent.sourceSymbol} -> ${refactorIntent.targetSymbol} must keep anchor and related usage evidence aligned.`,
		)
		if (refactorIntent.anchorSymbolPresent === false) {
			risks.push(`Refactor anchor evidence is weak because ${refactorIntent.sourceSymbol} was not confirmed in ${refactorIntent.anchorFile ?? "the anchor file"}.`)
		}
	}
	if (routing.usedModel) risks.push("Planner relied on model classification for at least one routing decision.")
	if (subtasks.length > 1) risks.push("Multiple work items still require later assignment, merge order, and reviewer confirmation.")
	if (routing.targetFiles.length === 0 && subtasks.length > 0) risks.push("Planner has no explicit target-file list from the original task text.")
	return uniqueStrings(risks)
}

function buildPlanQuestions(routing: RoutingDecision, subtasks: Subtask[], taskContract?: TaskContract | null): string[] {
	const questions: string[] = []
	if (routing.usedModel && routing.targetFiles.length === 0) {
		questions.push("Which exact files should the swarm prefer if later evidence expands beyond the initial plan?")
	}
	if (routing.path === "semi_open") {
		questions.push("Do the derived helper or docs neighbors still cover the owner intent without widening scope?")
	}
	if (subtasks.length === 0) {
		questions.push("No bounded work items were generated from the current task.")
	}
	if (taskContract?.refactorIntent && taskContract.refactorIntent.anchorSymbolPresent === false) {
		questions.push(
			`Does ${taskContract.refactorIntent.anchorFile ?? "the anchor file"} still contain ${taskContract.refactorIntent.sourceSymbol}, or does the rename request need narrower scope clarification first?`,
		)
	}
	return uniqueStrings(questions)
}

function buildWorkItems(subtasks: Subtask[]): PlanWorkItem[] {
	return subtasks.map((subtask) => ({
		id: subtask.id,
		description: subtask.description,
		files: uniqueStrings(subtask.files),
		dependsOn: uniqueStrings(subtask.dependsOn ?? []),
		assignmentHint: subtask.assignedBuilder,
		status: "planned",
		riskHints: subtask.files.length > 1 ? ["One builder owns multiple files in this bounded work item."] : [],
		stage: Math.max(1, subtask.stage ?? 1),
		ownershipRule: subtask.ownershipRule ?? null,
		dependencyReason: subtask.dependencyReason ?? null,
	}))
}

function buildRoleContextPolicy(): SwarmPlanArtifact["roleContextPolicy"] {
	return {
		planner: "Use run-level context packs with scout, repo-map, and omission evidence.",
		builder: "Use per-work-item context packs with owned files, task context, and scout context.",
		critic: "Use plan, arbitration, dependency, and omission evidence instead of the builder pack.",
		reviewer: "Use diff evidence plus reviewer-specific bounded context instead of builder edit context.",
	}
}

export function buildSwarmPlanArtifact(input: {
	task: string
	routing: RoutingDecision
	subtasks: Subtask[]
	builderCountRequested: number
	repoMap?: RepoMapArtifact | null
	taskContract?: TaskContract | null
	arbitration?: SupervisorArbitrationSummary | null
	createdAt?: string
}): SwarmPlanArtifact {
	const workItems = buildWorkItems(input.subtasks)
	const arbitration = input.arbitration ?? inferSupervisorArbitrationFromSubtasks(input.subtasks, input.builderCountRequested)
	const builderCountRecommended = Math.max(1, Math.min(arbitration.activeBuilderCount, Math.max(workItems.length, 1)))
	const effectiveTaskContract = input.taskContract ?? input.routing.taskContract ?? null
	const scoutCoverage = buildScoutCoverage(input.task, input.routing, input.subtasks, input.repoMap ?? null, effectiveTaskContract)
	const planningHorizon = buildPlanningHorizonArtifact(workItems)
	const teamShape = buildTeamShapeArtifact({
		routingPath: input.routing.path,
		arbitration,
		subtasks: input.subtasks,
		taskContract: effectiveTaskContract,
		scoutCoverage: {
			source: scoutCoverage.source,
			corpusTaskId: scoutCoverage.corpusTaskId,
			corpusLabel: scoutCoverage.corpusLabel,
			heuristicsUsed: scoutCoverage.heuristicsUsed,
		},
	})
	const expectedRisks = buildPlanRisks(input.routing, input.subtasks, effectiveTaskContract)
	const unresolvedQuestions = buildPlanQuestions(input.routing, input.subtasks, effectiveTaskContract)
	const planStatus: SwarmPlanStatus = workItems.length > 0 ? "planned" : "refused"
	return {
		schemaVersion: 1,
		task: input.task,
		pathChosen: input.routing.path,
		planStatus,
		executionStatus: planStatus === "planned" ? "running" : "not_started",
		builderCountRequested: Math.max(1, arbitration.requestedBuilderCount),
		builderCountRecommended,
		arbitration,
		planningHorizon,
		teamShape,
		roleContextPolicy: buildRoleContextPolicy(),
		scoutCoverage,
		workItems,
		expectedRisks,
		unresolvedQuestions,
		roleManuals: listRoleManualReferences(["supervisor", "builder", "critic", "reviewer"]),
		repoMap: input.repoMap ?? null,
		refactorIntent: effectiveTaskContract?.refactorIntent ?? null,
		createdAt: input.createdAt ?? new Date().toISOString(),
	}
}

export function finalizeSwarmPlanArtifact(
	plan: SwarmPlanArtifact | null,
	finalStatus: "done" | "review_required" | "failed",
): SwarmPlanArtifact | null {
	if (!plan) return null
	return {
		...plan,
		executionStatus: finalStatus === "done" ? "done" : "blocked",
	}
}

export function validateSwarmPlanArtifact(plan: SwarmPlanArtifact): PlanValidationResult {
	const issues: string[] = []
	if (plan.schemaVersion !== 1) issues.push(`Unsupported schemaVersion: ${String(plan.schemaVersion)}`)
	if (plan.planStatus === "planned" && plan.workItems.length === 0) issues.push("Planned artifact is missing work items.")
	if (plan.builderCountRecommended > plan.builderCountRequested) {
		issues.push("builderCountRecommended exceeds builderCountRequested.")
	}
	if (plan.arbitration.activeBuilderCount > plan.arbitration.requestedBuilderCount) {
		issues.push("Arbitration activeBuilderCount exceeds requestedBuilderCount.")
	}
	if (plan.planningHorizon && plan.planningHorizon.schemaVersion !== 1) {
		issues.push("Plan planningHorizon schemaVersion is unsupported.")
	}
	if (plan.teamShape && plan.teamShape.schemaVersion !== 1) {
		issues.push("Plan teamShape schemaVersion is unsupported.")
	}
	if (plan.teamShape && plan.teamShape.builderProfiles.length !== plan.workItems.length) {
		issues.push("Plan teamShape builderProfiles do not cover every work item.")
	}
	if (!plan.roleContextPolicy.planner?.trim() || !plan.roleContextPolicy.builder?.trim() || !plan.roleContextPolicy.critic?.trim() || !plan.roleContextPolicy.reviewer?.trim()) {
		issues.push("Plan artifact is missing role context policy entries.")
	}
	if (plan.repoMap && plan.repoMap.schemaVersion !== 1) issues.push("Repo map schemaVersion is unsupported.")
	if (!Array.isArray(plan.roleManuals) || plan.roleManuals.length === 0) issues.push("Plan artifact is missing role manual references.")
	if (plan.refactorIntent && plan.refactorIntent.kind !== "rename_symbol") issues.push("Plan refactorIntent is unsupported.")

	const seenRoles = new Set<string>()
	for (const manual of plan.roleManuals ?? []) {
		if (!manual.role?.trim()) issues.push("Role manual reference is missing role.")
		if (!manual.version?.trim()) issues.push(`Role manual reference for ${manual.role || "(unknown)"} is missing version.`)
		if (seenRoles.has(manual.role)) issues.push(`Duplicate role manual reference: ${manual.role}`)
		seenRoles.add(manual.role)
	}

	const seenIds = new Set<string>()
	for (const item of plan.workItems) {
		if (!item.id.trim()) issues.push("Work item id is missing.")
		if (seenIds.has(item.id)) issues.push(`Duplicate work item id: ${item.id}`)
		seenIds.add(item.id)
		if (item.dependsOn.some((dependency) => dependency === item.id)) issues.push(`Work item ${item.id} depends on itself.`)
		if (item.files.length === 0) issues.push(`Work item ${item.id} has no owned files or boundaries.`)
		if (item.dependsOn.length > 0 && !item.dependencyReason) issues.push(`Work item ${item.id} has dependencies but no dependencyReason.`)
	}

	for (const item of plan.workItems) {
		for (const dependency of item.dependsOn) {
			if (!seenIds.has(dependency)) issues.push(`Work item ${item.id} depends on missing item ${dependency}.`)
		}
	}

	return {
		valid: issues.length === 0,
		issues,
	}
}

export function formatSwarmPlanArtifact(plan: SwarmPlanArtifact): string {
	return [
		`Plan status: ${plan.planStatus}`,
		`Execution status: ${plan.executionStatus}`,
		`Path chosen: ${plan.pathChosen}`,
		`Builder counts: requested=${plan.builderCountRequested} recommended=${plan.builderCountRecommended}`,
		`Arbitration: strategy=${plan.arbitration.strategy} active=${plan.arbitration.activeBuilderCount}/${plan.arbitration.requestedBuilderCount} dependencyMode=${plan.arbitration.dependencyMode} delegation=${plan.arbitration.delegationMode} clarification=${plan.arbitration.clarificationMode} completion=${plan.arbitration.completionRule}`,
		...(plan.planningHorizon
			? [
					`Planning horizon: mode=${plan.planningHorizon.mode} totalStages=${plan.planningHorizon.totalStages} continuation=${plan.planningHorizon.continuationSurface}`,
					`Planning horizon summary: ${plan.planningHorizon.summary}`,
			  ]
			: []),
		...(plan.teamShape
			? [
					`Team shape: ${plan.teamShape.shapeId} -> ${plan.teamShape.summary}`,
					`Team shape signals: ${plan.teamShape.sourceSignals.join(", ") || "(none)"}`,
			  ]
			: []),
		`Role context policy: planner=${plan.roleContextPolicy.planner} | builder=${plan.roleContextPolicy.builder} | critic=${plan.roleContextPolicy.critic} | reviewer=${plan.roleContextPolicy.reviewer}`,
		...(plan.arbitration.reasons.length > 0 ? ["Arbitration reasons:", ...plan.arbitration.reasons.map((reason) => `- ${reason}`)] : []),
		`Role manuals: ${plan.roleManuals.map((manual) => `${manual.role}@${manual.version}`).join(", ") || "(none)"}`,
		...(plan.repoMap ? [`Repo map: ${plan.repoMap.workspaceName} files=${plan.repoMap.totalFiles}`] : []),
		...(plan.refactorIntent
			? [
					`Refactor intent: ${plan.refactorIntent.sourceSymbol} -> ${plan.refactorIntent.targetSymbol} anchor=${plan.refactorIntent.anchorFile ?? "(none)"} related=${plan.refactorIntent.relatedFiles.join(", ") || "(none)"}`,
			  ]
			: []),
		...(plan.scoutCoverage.corpusTaskId
			? [`Scout corpus: ${plan.scoutCoverage.corpusTaskId}${plan.scoutCoverage.corpusLabel ? ` (${plan.scoutCoverage.corpusLabel})` : ""}`]
			: []),
		`Scout coverage: ${plan.scoutCoverage.source} -> ${plan.scoutCoverage.summary}`,
		...(plan.scoutCoverage.contextFiles.length > 0 ? [`Scout context: ${plan.scoutCoverage.contextFiles.join(", ")}`] : []),
		...(plan.scoutCoverage.heuristicsUsed.length > 0 ? [`Scout heuristics: ${plan.scoutCoverage.heuristicsUsed.join(", ")}`] : []),
		...(plan.scoutCoverage.notes.length > 0 ? ["Scout notes:", ...plan.scoutCoverage.notes.map((note) => `- ${note}`)] : []),
		`Work items: ${plan.workItems.length}`,
		...plan.workItems.map(
			(item) =>
				`- ${item.id}: stage=${item.stage} files=${item.files.join(", ")} dependsOn=${item.dependsOn.join(", ") || "(none)"} ownership=${item.ownershipRule ?? "(none)"}`,
		),
		...(plan.expectedRisks.length > 0 ? ["Expected risks:", ...plan.expectedRisks.map((risk) => `- ${risk}`)] : []),
		...(plan.unresolvedQuestions.length > 0 ? ["Unresolved questions:", ...plan.unresolvedQuestions.map((question) => `- ${question}`)] : []),
	].join("\n")
}
