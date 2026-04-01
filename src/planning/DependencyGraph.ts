import type { AssignmentLedger } from "./AssignmentLedger"
import type { SwarmPlanArtifact } from "./PlanSchema"

export type DependencyGraphStatus = "not_applicable" | "planned" | "blocked"
export type DependencyGraphNodeState = "ready" | "blocked"
export type DependencyGraphRouteRelation = "depends_on" | "dependency_of" | "same_stage"

export type DependencyGraphNode = {
	workItemId: string
	assignmentId: string
	stage: number
	ownedFiles: string[]
	dependsOn: string[]
	dependents: string[]
	state: DependencyGraphNodeState
}

export type DependencyGraphEdge = {
	fromWorkItemId: string
	toWorkItemId: string
	relation: "depends_on"
	stage: number
	reason: string
}

export type DependencyGraphRoute = {
	senderAssignmentId: string
	receiverAssignmentId: string
	senderWorkItemId: string
	receiverWorkItemId: string
	relation: DependencyGraphRouteRelation
	stage: number
	reason: string
}

export type DependencyGraphArtifact = {
	schemaVersion: 1
	status: DependencyGraphStatus
	nodes: DependencyGraphNode[]
	edges: DependencyGraphEdge[]
	routes: DependencyGraphRoute[]
	readyWorkItemIds: string[]
	blockedWorkItemIds: string[]
	stageCount: number
	maxParallelWidth: number
	blockers: string[]
	summary: string
}

function hasDirectDependency(left: string, right: string, dependencies: Map<string, Set<string>>): boolean {
	return dependencies.get(left)?.has(right) === true || dependencies.get(right)?.has(left) === true
}

function detectDependencyCycles(dependencies: Map<string, Set<string>>): string[] {
	const blockers: string[] = []
	const visiting = new Set<string>()
	const visited = new Set<string>()

	const walk = (workItemId: string) => {
		if (visited.has(workItemId)) return
		if (visiting.has(workItemId)) {
			blockers.push(`Dependency cycle detected at ${workItemId}.`)
			return
		}
		visiting.add(workItemId)
		for (const dependency of dependencies.get(workItemId) ?? []) {
			walk(dependency)
		}
		visiting.delete(workItemId)
		visited.add(workItemId)
	}

	for (const workItemId of dependencies.keys()) walk(workItemId)
	return blockers
}

export function buildDependencyGraphArtifact(input: {
	plan: SwarmPlanArtifact | null
	assignments: AssignmentLedger | null
}): DependencyGraphArtifact {
	if (!input.plan || !input.assignments) {
		return {
			schemaVersion: 1,
			status: "not_applicable",
			nodes: [],
			edges: [],
			routes: [],
			readyWorkItemIds: [],
			blockedWorkItemIds: [],
			stageCount: 0,
			maxParallelWidth: 0,
			blockers: [],
			summary: "Dependency graph is not applicable outside the bounded complex lane.",
		}
	}

	const blockers = [...input.assignments.handoffIssues]
	const dependencies = new Map<string, Set<string>>()
	const dependents = new Map<string, Set<string>>()
	const assignmentsByWorkItemId = new Map(input.assignments.assignments.map((assignment) => [assignment.workItemId, assignment]))

	for (const assignment of input.assignments.assignments) {
		dependencies.set(assignment.workItemId, new Set(assignment.dependsOn))
		for (const dependency of assignment.dependsOn) {
			const dependentSet = dependents.get(dependency) ?? new Set<string>()
			dependentSet.add(assignment.workItemId)
			dependents.set(dependency, dependentSet)
			if (!assignmentsByWorkItemId.has(dependency)) {
				blockers.push(`Dependency graph references missing work item ${dependency}.`)
			}
		}
	}

	blockers.push(...detectDependencyCycles(dependencies))

	const nodes = input.assignments.assignments.map((assignment) => ({
		workItemId: assignment.workItemId,
		assignmentId: assignment.assignmentId,
		stage: Math.max(1, assignment.stage ?? 1),
		ownedFiles: [...assignment.ownedFiles],
		dependsOn: [...assignment.dependsOn],
		dependents: Array.from(dependents.get(assignment.workItemId) ?? []),
		state: assignment.dependsOn.length > 0 ? ("blocked" as const) : ("ready" as const),
	}))

	const edges: DependencyGraphEdge[] = input.assignments.assignments.flatMap((assignment) =>
		assignment.dependsOn.map((dependency) => ({
			fromWorkItemId: assignment.workItemId,
			toWorkItemId: dependency,
			relation: "depends_on" as const,
			stage: Math.max(1, assignment.stage ?? 1),
			reason: assignment.dependencyReason?.trim() || `Work item ${assignment.workItemId} waits on ${dependency}.`,
		})),
	)

	const routes: DependencyGraphRoute[] = []
	for (const assignment of input.assignments.assignments) {
		for (const dependency of assignment.dependsOn) {
			const prerequisite = assignmentsByWorkItemId.get(dependency)
			if (!prerequisite) continue
			routes.push({
				senderAssignmentId: assignment.assignmentId,
				receiverAssignmentId: prerequisite.assignmentId,
				senderWorkItemId: assignment.workItemId,
				receiverWorkItemId: prerequisite.workItemId,
				relation: "depends_on",
				stage: Math.max(1, assignment.stage ?? 1),
				reason: assignment.dependencyReason?.trim() || `Work item ${assignment.workItemId} waits on ${dependency}.`,
			})
			routes.push({
				senderAssignmentId: prerequisite.assignmentId,
				receiverAssignmentId: assignment.assignmentId,
				senderWorkItemId: prerequisite.workItemId,
				receiverWorkItemId: assignment.workItemId,
				relation: "dependency_of",
				stage: Math.max(1, prerequisite.stage ?? 1),
				reason: `Completing ${prerequisite.workItemId} unblocks ${assignment.workItemId}.`,
			})
		}
	}

	const stageBuckets = new Map<number, typeof input.assignments.assignments>()
	for (const assignment of input.assignments.assignments) {
		const stage = Math.max(1, assignment.stage ?? 1)
		const bucket = stageBuckets.get(stage) ?? []
		bucket.push(assignment)
		stageBuckets.set(stage, bucket)
	}

	for (const [stage, bucket] of stageBuckets.entries()) {
		const ordered = [...bucket].sort((left, right) => left.assignmentId.localeCompare(right.assignmentId))
		for (let index = 0; index < ordered.length; index += 1) {
			const left = ordered[index]
			if (!left) continue
			for (let otherIndex = index + 1; otherIndex < ordered.length; otherIndex += 1) {
				const right = ordered[otherIndex]
				if (!right) continue
				if (hasDirectDependency(left.workItemId, right.workItemId, dependencies)) continue
				routes.push({
					senderAssignmentId: left.assignmentId,
					receiverAssignmentId: right.assignmentId,
					senderWorkItemId: left.workItemId,
					receiverWorkItemId: right.workItemId,
					relation: "same_stage",
					stage,
					reason: `Same-stage coordination route for stage ${stage}.`,
				})
				routes.push({
					senderAssignmentId: right.assignmentId,
					receiverAssignmentId: left.assignmentId,
					senderWorkItemId: right.workItemId,
					receiverWorkItemId: left.workItemId,
					relation: "same_stage",
					stage,
					reason: `Same-stage coordination route for stage ${stage}.`,
				})
			}
		}
	}

	const readyWorkItemIds = nodes.filter((node) => node.state === "ready").map((node) => node.workItemId)
	const blockedWorkItemIds = nodes.filter((node) => node.state === "blocked").map((node) => node.workItemId)
	const stageCount = stageBuckets.size
	const maxParallelWidth = Math.max(0, ...Array.from(stageBuckets.values()).map((bucket) => bucket.length))
	const status: DependencyGraphStatus = blockers.length > 0 ? "blocked" : "planned"

	return {
		schemaVersion: 1,
		status,
		nodes,
		edges,
		routes,
		readyWorkItemIds,
		blockedWorkItemIds,
		stageCount,
		maxParallelWidth,
		blockers: Array.from(new Set(blockers)),
		summary:
			status === "blocked"
				? `Dependency graph blocked with ${blockers.length} issue(s).`
				: `Dependency graph planned across ${nodes.length} work item(s), ${edges.length} dependency edge(s), and ${routes.length} bounded clarification route(s).`,
	}
}

export function resolveDependencyGraphRoute(
	graph: DependencyGraphArtifact | null,
	senderAssignmentId: string,
	receiverAssignmentId: string,
): DependencyGraphRoute | null {
	if (!graph || graph.status === "not_applicable") return null
	return (
		graph.routes.find(
			(route) => route.senderAssignmentId === senderAssignmentId && route.receiverAssignmentId === receiverAssignmentId,
		) ?? null
	)
}

export function formatDependencyGraphArtifact(graph: DependencyGraphArtifact | null): string {
	if (!graph) return "Dependency graph: (none)"
	return [
		`Status: ${graph.status}`,
		`Summary: ${graph.summary}`,
		`Ready work items: ${graph.readyWorkItemIds.join(", ") || "(none)"}`,
		`Blocked work items: ${graph.blockedWorkItemIds.join(", ") || "(none)"}`,
		`Stages: ${graph.stageCount} maxParallelWidth=${graph.maxParallelWidth}`,
		...(graph.blockers.length > 0 ? ["Blockers:", ...graph.blockers.map((blocker) => `- ${blocker}`)] : []),
		"Routes:",
		...(graph.routes.length > 0
			? graph.routes.map(
					(route) =>
						`- ${route.senderAssignmentId} -> ${route.receiverAssignmentId} relation=${route.relation} stage=${route.stage}`,
				)
			: ["- (none)"]),
	].join("\n")
}
