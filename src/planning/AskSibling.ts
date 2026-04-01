import type { AssignmentLedger } from "./AssignmentLedger"
import type { SupervisorArbitrationSummary } from "./SupervisorArbitration"
import {
	resolveDependencyGraphRoute,
	type DependencyGraphArtifact,
	type DependencyGraphRoute,
	type DependencyGraphRouteRelation,
} from "./DependencyGraph"

export type AskSiblingExchange = {
	workItemId: string
	senderAssignmentId: string
	receiverAssignmentId: string
	relation: DependencyGraphRouteRelation
	routeReason: string
	question: string
	reply: string
	sequence: number
}

export type AskSiblingCoordinationPolicy = {
	graphStatus: DependencyGraphArtifact["status"]
	stageCount: number
	routeCount: number
	clarificationMode: SupervisorArbitrationSummary["clarificationMode"]
	completionRule: SupervisorArbitrationSummary["completionRule"]
}

export type AskSiblingLedger = {
	schemaVersion: 1
	limits: {
		maxExchangesPerWorkItem: number
		maxQuestionChars: number
		maxReplyChars: number
	}
	coordinationPolicy: AskSiblingCoordinationPolicy
	allowedRoutes: DependencyGraphRoute[]
	exchanges: AskSiblingExchange[]
}

export type AskSiblingResult =
	| {
			ok: true
			ledger: AskSiblingLedger
			exchange: AskSiblingExchange
	  }
	| {
			ok: false
			ledger: AskSiblingLedger
			error: string
	  }

export function createAskSiblingLedger(
	graph: DependencyGraphArtifact | null,
	arbitration: SupervisorArbitrationSummary | null = null,
	overrides: Partial<AskSiblingLedger["limits"]> = {},
): AskSiblingLedger {
	const clarificationMode = arbitration?.clarificationMode ?? (graph?.routes.length ? "dependency_and_same_stage_routes" : "disabled")
	const completionRule = arbitration?.completionRule ?? "assignment_tokens_then_review"
	const allowedRoutes = (() => {
		const routes = [...(graph?.routes ?? [])]
		if (clarificationMode === "disabled") return []
		if (clarificationMode === "dependency_routes_only") {
			return routes.filter((route) => route.relation !== "same_stage")
		}
		return routes
	})()
	const defaultMaxExchangesPerWorkItem =
		clarificationMode === "disabled" ? 0 : arbitration?.strategy === "medium_fanout" ? 2 : 1
	return {
		schemaVersion: 1,
		limits: {
			maxExchangesPerWorkItem: overrides.maxExchangesPerWorkItem ?? defaultMaxExchangesPerWorkItem,
			maxQuestionChars: overrides.maxQuestionChars ?? 180,
			maxReplyChars: overrides.maxReplyChars ?? 180,
		},
		coordinationPolicy: {
			graphStatus: graph?.status ?? "not_applicable",
			stageCount: graph?.stageCount ?? 0,
			routeCount: allowedRoutes.length,
			clarificationMode,
			completionRule,
		},
		allowedRoutes,
		exchanges: [],
	}
}

export function recordAskSiblingExchange(
	ledger: AskSiblingLedger,
	assignments: AssignmentLedger,
	input: {
		workItemId: string
		senderAssignmentId: string
		receiverAssignmentId: string
		question: string
		reply: string
	},
): AskSiblingResult {
	if (ledger.coordinationPolicy.clarificationMode === "disabled" || ledger.limits.maxExchangesPerWorkItem <= 0) {
		return { ok: false, ledger, error: "Ask-sibling is disabled for this delegation mode." }
	}
	const sender = assignments.assignments.find((assignment) => assignment.assignmentId === input.senderAssignmentId)
	const receiver = assignments.assignments.find((assignment) => assignment.assignmentId === input.receiverAssignmentId)
	if (!sender || !receiver) {
		return { ok: false, ledger, error: "Only assigned workers may use ask-sibling." }
	}
	if (input.senderAssignmentId === input.receiverAssignmentId) {
		return { ok: false, ledger, error: "Ask-sibling requires two distinct assignment owners." }
	}
	if (input.workItemId !== sender.workItemId) {
		return { ok: false, ledger, error: "Ask-sibling workItemId must match the sender assignment owner." }
	}

	const question = input.question.trim()
	const reply = input.reply.trim()
	if (!question || question.length > ledger.limits.maxQuestionChars) {
		return { ok: false, ledger, error: "Question exceeds the bounded ask-sibling limit." }
	}
	if (!reply || reply.length > ledger.limits.maxReplyChars) {
		return { ok: false, ledger, error: "Reply exceeds the bounded ask-sibling limit." }
	}

	const workItemCount = ledger.exchanges.filter((exchange) => exchange.workItemId === input.workItemId).length
	if (workItemCount >= ledger.limits.maxExchangesPerWorkItem) {
		return { ok: false, ledger, error: "Ask-sibling exchange cap reached for this work item." }
	}
	const route =
		resolveDependencyGraphRoute(
			{
				schemaVersion: 1,
				status: ledger.coordinationPolicy.graphStatus,
				nodes: [],
				edges: [],
				routes: ledger.allowedRoutes,
				readyWorkItemIds: [],
				blockedWorkItemIds: [],
				stageCount: ledger.coordinationPolicy.stageCount,
				maxParallelWidth: 0,
				blockers: [],
				summary: "",
			},
			input.senderAssignmentId,
			input.receiverAssignmentId,
		) ?? null
	if (!route) {
		return { ok: false, ledger, error: "Ask-sibling is only allowed across explicit dependency-graph routes." }
	}

	const exchange: AskSiblingExchange = {
		workItemId: input.workItemId,
		senderAssignmentId: input.senderAssignmentId,
		receiverAssignmentId: input.receiverAssignmentId,
		relation: route.relation,
		routeReason: route.reason,
		question,
		reply,
		sequence: ledger.exchanges.length + 1,
	}
	return {
		ok: true,
		ledger: {
			...ledger,
			exchanges: [...ledger.exchanges, exchange],
		},
		exchange,
	}
}

export function formatAskSiblingLedger(ledger: AskSiblingLedger): string {
	return [
		`Limits: exchangesPerWorkItem=${ledger.limits.maxExchangesPerWorkItem} questionChars=${ledger.limits.maxQuestionChars} replyChars=${ledger.limits.maxReplyChars}`,
		`Coordination policy: graphStatus=${ledger.coordinationPolicy.graphStatus} stages=${ledger.coordinationPolicy.stageCount} routes=${ledger.coordinationPolicy.routeCount} clarification=${ledger.coordinationPolicy.clarificationMode} completion=${ledger.coordinationPolicy.completionRule}`,
		"Exchanges:",
		...(ledger.exchanges.length > 0
			? ledger.exchanges.map(
					(exchange) =>
						`- ${exchange.sequence}: ${exchange.senderAssignmentId} -> ${exchange.receiverAssignmentId} [${exchange.workItemId}] relation=${exchange.relation}`,
				)
			: ["- (none)"]),
	].join("\n")
}
