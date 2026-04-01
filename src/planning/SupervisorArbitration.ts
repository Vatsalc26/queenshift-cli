import path from "node:path"

import type { RoutingDecision } from "../agents/CoordinatorAgent"
import type { TaskContract } from "../run/TaskContract"

export type SupervisorArbitrationStrategy = "single_owner" | "parallel_split" | "medium_fanout"
export type SupervisorDependencyMode = "none" | "serial" | "parallel"
export type SupervisorDelegationMode = "single_owner" | "exclusive_parallel" | "staged_parallel"
export type SupervisorClarificationMode = "disabled" | "dependency_routes_only" | "dependency_and_same_stage_routes"
export type SupervisorCompletionRule = "single_owner_review_then_acceptance" | "assignment_tokens_then_review"

export type SupervisorArbitrationSummary = {
	schemaVersion: 1
	requestedBuilderCount: number
	activeBuilderCount: number
	strategy: SupervisorArbitrationStrategy
	dependencyMode: SupervisorDependencyMode
	delegationMode: SupervisorDelegationMode
	clarificationMode: SupervisorClarificationMode
	completionRule: SupervisorCompletionRule
	refusalTriggers: string[]
	reasons: string[]
}

function normalizeRelPath(input: string): string {
	return input.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => normalizeRelPath(value)).filter(Boolean)))
}

function isDocFile(file: string): boolean {
	const normalized = normalizeRelPath(file).toLowerCase()
	return normalized.endsWith(".md") || normalized.startsWith("docs/")
}

function isConfigFile(file: string): boolean {
	const normalized = normalizeRelPath(file)
	const baseName = path.posix.basename(normalized).toLowerCase()
	return ["package.json", "tsconfig.json", ".swarmcoder.json"].includes(baseName)
}

function buildDelegationSummary(input: {
	activeBuilderCount: number
	dependencyMode: SupervisorDependencyMode
}): Pick<SupervisorArbitrationSummary, "delegationMode" | "clarificationMode" | "completionRule" | "refusalTriggers"> {
	const singleOwner = input.activeBuilderCount <= 1
	const delegationMode: SupervisorDelegationMode = singleOwner
		? "single_owner"
		: input.dependencyMode === "serial"
			? "staged_parallel"
			: "exclusive_parallel"
	const clarificationMode: SupervisorClarificationMode = singleOwner
		? "disabled"
		: input.dependencyMode === "serial"
			? "dependency_routes_only"
			: "dependency_and_same_stage_routes"

	return {
		delegationMode,
		clarificationMode,
		completionRule: singleOwner ? "single_owner_review_then_acceptance" : "assignment_tokens_then_review",
		refusalTriggers: [
			"overlap",
			"missing_dependency_reason",
			"stale_assignment_completion",
			"unsafe_scope_expansion",
		],
	}
}

export function inferSupervisorArbitrationFromSubtasks(
	subtasks: Array<{ files: string[]; dependsOn?: string[] }>,
	requestedBuilderCount: number,
): SupervisorArbitrationSummary {
	const activeBuilderCount = Math.max(1, subtasks.length)
	const dependencyCount = subtasks.reduce((sum, subtask) => sum + (subtask.dependsOn?.length ?? 0), 0)
	const dependencyMode: SupervisorDependencyMode = dependencyCount > 0 ? "serial" : activeBuilderCount > 1 ? "parallel" : "none"
	return {
		schemaVersion: 1,
		requestedBuilderCount: Math.max(1, requestedBuilderCount),
		activeBuilderCount,
		strategy: activeBuilderCount >= 3 ? "medium_fanout" : activeBuilderCount === 1 ? "single_owner" : "parallel_split",
		dependencyMode,
		...buildDelegationSummary({
			activeBuilderCount,
			dependencyMode,
		}),
		reasons: dependencyMode === "serial" ? ["Work items include explicit dependency edges."] : ["Work items stay independently bounded."],
	}
}

export function buildSupervisorArbitration(input: {
	task: string
	routing: RoutingDecision
	taskContract?: TaskContract | null
}): SupervisorArbitrationSummary {
	const targetFiles = uniqueStrings((input.taskContract?.scope?.allowedFiles ?? []).concat(input.routing.targetFiles ?? []))
	const docFiles = targetFiles.filter((file) => isDocFile(file))
	const configFiles = targetFiles.filter((file) => isConfigFile(file))
	const codeFiles = targetFiles.filter((file) => !docFiles.includes(file) && !configFiles.includes(file))
	const requestedBuilderCount = 2
	const reasons: string[] = []

	if (targetFiles.length <= 2) {
		reasons.push("Tightly coupled small coordination stays single-owner to avoid hidden overlap.")
		return {
			schemaVersion: 1,
			requestedBuilderCount,
			activeBuilderCount: 1,
			strategy: "single_owner",
			dependencyMode: "none",
			...buildDelegationSummary({
				activeBuilderCount: 1,
				dependencyMode: "none",
			}),
			reasons,
		}
	}

	if (input.taskContract?.refactorIntent) {
		reasons.push(
			`Rename flow ${input.taskContract.refactorIntent.sourceSymbol} -> ${input.taskContract.refactorIntent.targetSymbol} stays single-owner until staged shared-state execution exists.`,
		)
		return {
			schemaVersion: 1,
			requestedBuilderCount,
			activeBuilderCount: 1,
			strategy: "single_owner",
			dependencyMode: "none",
			...buildDelegationSummary({
				activeBuilderCount: 1,
				dependencyMode: "none",
			}),
			reasons,
		}
	}

	if (codeFiles.length > 0 && (docFiles.length > 0 || configFiles.length > 0)) {
		reasons.push("Mixed code plus docs/config scope stays single-owner because later files depend on earlier code truth.")
		return {
			schemaVersion: 1,
			requestedBuilderCount,
			activeBuilderCount: 1,
			strategy: "single_owner",
			dependencyMode: "none",
			...buildDelegationSummary({
				activeBuilderCount: 1,
				dependencyMode: "none",
			}),
			reasons,
		}
	}

	if (input.routing.path === "medium") {
		const activeBuilderCount = Math.min(requestedBuilderCount, 2, targetFiles.length)
		reasons.push(`Medium bounded lane stays capped at ${activeBuilderCount} parallel owner bucket(s).`)
		reasons.push("The cap keeps medium throughput and merge cost below the full complex lane.")
		reasons.push("Each worker keeps exclusive file ownership; merge order and critic evidence stay explicit.")
		return {
			schemaVersion: 1,
			requestedBuilderCount,
			activeBuilderCount,
			strategy: "medium_fanout",
			dependencyMode: "parallel",
			...buildDelegationSummary({
				activeBuilderCount,
				dependencyMode: "parallel",
			}),
			reasons,
		}
	}

	const activeBuilderCount = Math.min(requestedBuilderCount, 2, targetFiles.length)
	reasons.push(`Explicit bounded multi-file task splits into ${activeBuilderCount} parallel owner bucket(s).`)
	return {
		schemaVersion: 1,
		requestedBuilderCount,
		activeBuilderCount,
		strategy: activeBuilderCount === 1 ? "single_owner" : "parallel_split",
		dependencyMode: activeBuilderCount === 1 ? "none" : "parallel",
		...buildDelegationSummary({
			activeBuilderCount,
			dependencyMode: activeBuilderCount === 1 ? "none" : "parallel",
		}),
		reasons,
	}
}

export function formatSupervisorArbitrationPromptSummary(summary: SupervisorArbitrationSummary, maxLines = 6): string {
	return [
		`Delegation strategy: ${summary.strategy} (${summary.delegationMode}).`,
		`Dependency mode: ${summary.dependencyMode}.`,
		`Clarification mode: ${summary.clarificationMode}.`,
		`Completion rule: ${summary.completionRule}.`,
		`Refuse when: ${summary.refusalTriggers.join(", ") || "(none)"}.`,
		...(summary.reasons.length > 0 ? [`Arbitration reasons: ${summary.reasons.join(" | ")}`] : []),
	]
		.slice(0, Math.max(1, maxLines))
		.join("\n")
}
