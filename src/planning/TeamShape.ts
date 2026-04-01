import type { RoutingPath } from "../agents/CoordinatorAgent"
import type { Subtask } from "../agents/SupervisorAgent"
import type { TaskContract } from "../run/TaskContract"
import type { SupervisorArbitrationSummary } from "./SupervisorArbitration"
import { getWorkerSpecialization, type WorkerSpecializationId } from "./RoleManuals"

export type TeamShapeId = "single_owner_lane" | "parallel_bucket_lane" | "staged_handoff_lane" | "medium_parallel_lane"

export type TeamShapeBuilderProfile = {
	workItemId: string
	assignedBuilder: string
	specializationId: WorkerSpecializationId
	label: string
	summary: string
}

export type TeamShapeArtifact = {
	schemaVersion: 1
	shapeId: TeamShapeId
	summary: string
	sourceSignals: string[]
	supervisorFocus: string
	criticFocus: string
	builderProfiles: TeamShapeBuilderProfile[]
}

function normalizeRelPath(input: string): string {
	return input.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)))
}

function isDocOrConfigFile(file: string): boolean {
	const normalized = normalizeRelPath(file).toLowerCase()
	return (
		normalized.endsWith(".md") ||
		normalized.startsWith("docs/") ||
		normalized === "package.json" ||
		normalized === "tsconfig.json" ||
		normalized === ".swarmcoder.json"
	)
}

function buildShapeSummary(shapeId: TeamShapeId, scoutLabel: string | null): string {
	const baseSummary =
		shapeId === "single_owner_lane"
			? "One bounded owner handles the full change and later review carries the remaining safety load."
			: shapeId === "staged_handoff_lane"
				? "An anchor owner goes first and follow-on owners wait for explicit dependency handoff."
				: shapeId === "medium_parallel_lane"
					? "The medium lane uses a small parallel owner set with critic review focused on cross-bucket drift."
					: "Independent file buckets split across explicit owners without hidden overlap."
	return scoutLabel ? `${baseSummary} Scout anchor: ${scoutLabel}.` : baseSummary
}

function buildSupervisorFocus(shapeId: TeamShapeId): string {
	if (shapeId === "single_owner_lane") return "Prefer one bounded owner and refuse extra worker theater."
	if (shapeId === "staged_handoff_lane") return "Keep prerequisites first and make every later handoff dependency explicit."
	if (shapeId === "medium_parallel_lane") return "Use only a small parallel bucket set and keep reviewer plus critic checkpoints visible."
	return "Allow parallel owners only when each bucket keeps exclusive files and a clear merge story."
}

function buildCriticFocus(shapeId: TeamShapeId, taskContract: TaskContract | null | undefined): string {
	if (taskContract?.refactorIntent) {
		return "Check anchor rename consistency, follow-on ownership, and cross-bucket drift before accepting the run."
	}
	if (shapeId === "medium_parallel_lane") {
		return "Check cross-bucket drift, merge risk, and bounded review bias before accepting the medium lane."
	}
	if (shapeId === "staged_handoff_lane") {
		return "Check that dependency routes stayed explicit and follow-on owners did not race the anchor owner."
	}
	if (shapeId === "parallel_bucket_lane") {
		return "Check that parallel owners stayed disjoint and did not require hidden same-file coordination."
	}
	return "Check that the single-owner lane stayed bounded and did not invent extra coordination."
}

function selectTeamShapeId(input: {
	routingPath: RoutingPath
	arbitration: SupervisorArbitrationSummary
	taskContract?: TaskContract | null
}): TeamShapeId {
	if (input.arbitration.activeBuilderCount <= 1) return "single_owner_lane"
	if (input.routingPath === "medium") return "medium_parallel_lane"
	if (input.taskContract?.refactorIntent || input.arbitration.delegationMode === "staged_parallel") return "staged_handoff_lane"
	return "parallel_bucket_lane"
}

function selectBuilderSpecialization(input: {
	subtask: Pick<Subtask, "files" | "dependsOn">
	routingPath: RoutingPath
	arbitration: SupervisorArbitrationSummary
	taskContract?: TaskContract | null
}): WorkerSpecializationId {
	if (input.arbitration.activeBuilderCount <= 1) return "solo_owner"
	const anchorFile = normalizeRelPath(input.taskContract?.refactorIntent?.anchorFile ?? "")
	if (anchorFile && input.subtask.files.map(normalizeRelPath).includes(anchorFile)) return "rename_anchor_owner"
	if ((input.subtask.dependsOn?.length ?? 0) > 0) return "follow_on_owner"
	if (input.routingPath === "medium") return "medium_bucket_owner"
	if (input.subtask.files.some((file) => isDocOrConfigFile(file))) return "docs_config_owner"
	return "parallel_owner"
}

export function buildTeamShapeArtifact(input: {
	routingPath: RoutingPath
	arbitration: SupervisorArbitrationSummary
	subtasks: Array<Pick<Subtask, "id" | "assignedBuilder" | "files" | "dependsOn">>
	taskContract?: TaskContract | null
	scoutCoverage?: {
		source: string
		corpusTaskId?: string | null
		corpusLabel?: string | null
		heuristicsUsed?: string[]
	}
}): TeamShapeArtifact {
	const shapeId = selectTeamShapeId(input)
	const builderProfiles = input.subtasks.map((subtask) => {
		const specializationId = selectBuilderSpecialization({
			subtask,
			routingPath: input.routingPath,
			arbitration: input.arbitration,
			taskContract: input.taskContract,
		})
		const specialization = getWorkerSpecialization(specializationId)
		return {
			workItemId: subtask.id,
			assignedBuilder: subtask.assignedBuilder,
			specializationId,
			label: specialization.label,
			summary: specialization.summary,
		}
	})
	const sourceSignals = uniqueStrings([
		`routing:${input.routingPath}`,
		`delegation:${input.arbitration.delegationMode}`,
		input.taskContract?.refactorIntent ? `refactor:${input.taskContract.refactorIntent.kind}` : "",
		input.scoutCoverage?.source ? `scout_source:${input.scoutCoverage.source}` : "",
		input.scoutCoverage?.corpusTaskId ? `scout_task:${input.scoutCoverage.corpusTaskId}` : "",
		...(input.scoutCoverage?.heuristicsUsed ?? []).slice(0, 2).map((heuristic) => `heuristic:${heuristic}`),
	])

	return {
		schemaVersion: 1,
		shapeId,
		summary: buildShapeSummary(shapeId, input.scoutCoverage?.corpusLabel ?? null),
		sourceSignals,
		supervisorFocus: buildSupervisorFocus(shapeId),
		criticFocus: buildCriticFocus(shapeId, input.taskContract),
		builderProfiles,
	}
}

export function findTeamShapeBuilderProfile(
	teamShape: TeamShapeArtifact | null | undefined,
	workItemId: string,
	assignedBuilder?: string | null,
): TeamShapeBuilderProfile | null {
	if (!teamShape) return null
	return (
		teamShape.builderProfiles.find(
			(profile) =>
				profile.workItemId === workItemId ||
				(Boolean(assignedBuilder) && profile.assignedBuilder === assignedBuilder),
		) ?? null
	)
}

export function formatTeamShapePromptSummary(
	teamShape: TeamShapeArtifact,
	options: {
		workItemId?: string | null
		assignedBuilder?: string | null
	} = {},
): string {
	const builderProfile =
		options.workItemId || options.assignedBuilder
			? findTeamShapeBuilderProfile(teamShape, options.workItemId ?? "", options.assignedBuilder ?? null)
			: null
	return [
		`Team shape: ${teamShape.shapeId}. ${teamShape.summary}`,
		builderProfile ? `Worker specialization: ${builderProfile.label} (${builderProfile.specializationId}). ${builderProfile.summary}` : null,
		`Supervisor focus: ${teamShape.supervisorFocus}`,
		`Critic focus: ${teamShape.criticFocus}`,
		`Source signals: ${teamShape.sourceSignals.join(", ") || "(none)"}`,
	]
		.filter((value): value is string => Boolean(value))
		.join("\n")
}
