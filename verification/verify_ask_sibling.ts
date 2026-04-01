import fs from "node:fs"
import path from "node:path"

import { Orchestrator } from "../src/Orchestrator"
import { DatabaseService } from "../src/db/DatabaseService"
import { createAskSiblingLedger, formatAskSiblingLedger, recordAskSiblingExchange, type AskSiblingLedger } from "../src/planning/AskSibling"
import { buildDependencyGraphArtifact, type DependencyGraphArtifact } from "../src/planning/DependencyGraph"
import type { AssignmentLedger } from "../src/planning/AssignmentLedger"
import type { SwarmPlanArtifact } from "../src/planning/PlanSchema"
import { listRoleManualReferences } from "../src/planning/RoleManuals"

export type AskSiblingHarnessResult = {
	artifactedExchangeFormat: boolean
	routePolicyVisible: boolean
	delegationPolicyVisible: boolean
	limitEnforcementWorks: boolean
	onlyAssignedWorkersMayAsk: boolean
	unrelatedRouteBlocked: boolean
	sameStageRouteBlockedByPolicy: boolean
	summarySurfaceIncludesLane: boolean
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

function readAskSiblingLedger(summaryPath: string): AskSiblingLedger {
	const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>
	const ledger = summary["askSiblingLedger"]
	if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
		throw new Error(`Expected ask-sibling ledger in ${summaryPath}`)
	}
	return ledger as AskSiblingLedger
}

function readDependencyGraph(summaryPath: string): DependencyGraphArtifact {
	const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>
	const graph = summary["dependencyGraph"]
	if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
		throw new Error(`Expected dependency graph in ${summaryPath}`)
	}
	return graph as DependencyGraphArtifact
}

function fixturePlan(): SwarmPlanArtifact {
	return {
		schemaVersion: 1,
		task: "update hello.ts, utils.ts, and package.json together",
		pathChosen: "scoped",
		planStatus: "planned",
		executionStatus: "running",
		builderCountRequested: 3,
		builderCountRecommended: 3,
		arbitration: {
			schemaVersion: 1,
			requestedBuilderCount: 3,
			activeBuilderCount: 3,
			strategy: "parallel_split",
			dependencyMode: "serial",
			delegationMode: "staged_parallel",
			clarificationMode: "dependency_routes_only",
			completionRule: "assignment_tokens_then_review",
			refusalTriggers: ["overlap", "missing_dependency_reason", "stale_assignment_completion", "unsafe_scope_expansion"],
			reasons: ["Fixture keeps one dependency route and one same-stage route visible."],
		},
		roleContextPolicy: {
			planner: "Use run-level context packs with scout, repo-map, and omission evidence.",
			builder: "Use per-work-item context packs with owned files, task context, and scout context.",
			critic: "Use plan, arbitration, dependency, and omission evidence instead of the builder pack.",
			reviewer: "Use diff evidence plus reviewer-specific bounded context instead of builder edit context.",
		},
		scoutCoverage: {
			source: "explicit_targets",
			coveredFiles: ["hello.ts", "utils.ts", "package.json"],
			omittedFiles: [],
			contextFiles: [],
			corpusTaskId: null,
			corpusLabel: null,
			heuristicsUsed: [],
			notes: [],
			summary: "Three-file coordination fixture.",
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
				ownershipRule: "Parallel owner.",
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
				ownershipRule: "Dependent owner.",
				dependencyReason: "Wait for subtask-1 before updating utils.ts.",
			},
			{
				id: "subtask-3",
				description: "update package.json alongside hello.ts",
				files: ["package.json"],
				dependsOn: [],
				assignmentHint: "builder-3",
				status: "planned",
				riskHints: [],
				stage: 1,
				ownershipRule: "Parallel owner.",
				dependencyReason: null,
			},
		],
		expectedRisks: ["One worker waits on another; bounded clarification should stay explicit."],
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
			requestedBuilderCount: 3,
			activeBuilderCount: 3,
			strategy: "parallel_split",
			dependencyMode: "serial",
			delegationMode: "staged_parallel",
			clarificationMode: "dependency_routes_only",
			completionRule: "assignment_tokens_then_review",
			refusalTriggers: ["overlap", "missing_dependency_reason", "stale_assignment_completion", "unsafe_scope_expansion"],
			reasons: ["Fixture keeps one dependency route and one same-stage route visible."],
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
				ownershipRule: "Parallel owner.",
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
				ownershipRule: "Dependent owner.",
				dependencyReason: "Wait for subtask-1 before updating utils.ts.",
			},
			{
				workItemId: "subtask-3",
				assignmentId: "assign-subtask-3",
				assignmentToken: "builder-3:subtask-3:3",
				assignedBuilder: "builder-3",
				ownedFiles: ["package.json"],
				dependsOn: [],
				status: "assigned",
				blockers: [],
				stage: 1,
				ownershipRule: "Parallel owner.",
				dependencyReason: null,
			},
		],
	}
}

export async function runAskSiblingHarness(rootDir = resolveRootDir()): Promise<AskSiblingHarnessResult> {
	const details: string[] = []
	const repoHarness = createTempRepoCopy(rootDir, "ask-sibling")
	DatabaseService.reset()
	const dbPath = path.join(rootDir, "verification", `.tmp-ask-sibling-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)
	const db = DatabaseService.getInstance(dbPath)

	try {
		const assignments = fixtureAssignments()
		const graph = buildDependencyGraphArtifact({
			plan: fixturePlan(),
			assignments,
		})
		const seeded = createAskSiblingLedger(graph, fixturePlan().arbitration, {
			maxExchangesPerWorkItem: 1,
			maxQuestionChars: 80,
			maxReplyChars: 80,
		})
		const valid = recordAskSiblingExchange(seeded, assignments, {
			workItemId: "subtask-2",
			senderAssignmentId: "assign-subtask-2",
			receiverAssignmentId: "assign-subtask-1",
			question: "Did hello.ts rename the helper before I touch utils.ts?",
			reply: "No rename, only a bounded comment update.",
		})
		const overLimit = valid.ok
			? recordAskSiblingExchange(valid.ledger, assignments, {
					workItemId: "subtask-2",
					senderAssignmentId: "assign-subtask-2",
					receiverAssignmentId: "assign-subtask-1",
					question: "Second question",
					reply: "Second reply",
			  })
			: { ok: false as const, ledger: seeded, error: "valid exchange missing" }
		const unassigned = recordAskSiblingExchange(seeded, assignments, {
			workItemId: "subtask-2",
			senderAssignmentId: "assign-missing",
			receiverAssignmentId: "assign-subtask-1",
			question: "Can I ask?",
			reply: "No.",
		})
		const unrelated = recordAskSiblingExchange(seeded, assignments, {
			workItemId: "subtask-2",
			senderAssignmentId: "assign-subtask-2",
			receiverAssignmentId: "assign-subtask-3",
			question: "Can I bypass the graph?",
			reply: "No.",
		})
		const sameStageBlocked = recordAskSiblingExchange(seeded, assignments, {
			workItemId: "subtask-1",
			senderAssignmentId: "assign-subtask-1",
			receiverAssignmentId: "assign-subtask-3",
			question: "Can same-stage workers coordinate directly?",
			reply: "No.",
		})
		fs.writeFileSync(
			path.join(repoHarness.repoPath, "math.ts"),
			"export function sum(a: number, b: number): number {\n\treturn a + b\n}\n",
			"utf8",
		)

		const orchestrator = new Orchestrator(repoHarness.repoPath, db, true)
		const runResult = await orchestrator.run("update hello.ts, utils.ts, and math.ts together")
		const summaryLedger = readAskSiblingLedger(runResult.summaryPath)
		const summaryGraph = readDependencyGraph(runResult.summaryPath)
		const expectedSummaryClarification =
			summaryGraph.routes.some((route) => route.relation === "same_stage")
				? "dependency_and_same_stage_routes"
				: summaryGraph.routes.length > 0
					? "dependency_routes_only"
					: "disabled"

		const artifactedExchangeFormat =
			valid.ok &&
			valid.exchange.sequence === 1 &&
			valid.exchange.relation === "depends_on" &&
			valid.exchange.routeReason.includes("Wait for subtask-1") &&
			formatAskSiblingLedger(valid.ledger).includes("relation=depends_on")
		const routePolicyVisible =
			graph.status === "planned" &&
			graph.routes.some((route) => route.relation === "same_stage") &&
			seeded.coordinationPolicy.routeCount === 2 &&
			formatAskSiblingLedger(seeded).includes("graphStatus=planned")
		const delegationPolicyVisible =
			seeded.coordinationPolicy.clarificationMode === "dependency_routes_only" &&
			seeded.coordinationPolicy.completionRule === "assignment_tokens_then_review" &&
			formatAskSiblingLedger(seeded).includes("clarification=dependency_routes_only")
		const limitEnforcementWorks = overLimit.ok === false && overLimit.error.includes("cap reached")
		const onlyAssignedWorkersMayAsk = unassigned.ok === false && unassigned.error.includes("Only assigned workers")
		const unrelatedRouteBlocked = unrelated.ok === false && unrelated.error.includes("explicit dependency-graph routes")
		const sameStageRouteBlockedByPolicy =
			sameStageBlocked.ok === false && sameStageBlocked.error.includes("explicit dependency-graph routes")
		const summarySurfaceIncludesLane =
			summaryLedger.coordinationPolicy.routeCount > 0 &&
			summaryLedger.coordinationPolicy.graphStatus === summaryGraph.status &&
			summaryLedger.coordinationPolicy.clarificationMode === expectedSummaryClarification &&
			formatAskSiblingLedger(summaryLedger).includes(`clarification=${expectedSummaryClarification}`)

		details.push(`summary=${runResult.summaryPath}`)
		details.push(`ledger=${formatAskSiblingLedger(summaryLedger).split(/\r?\n/g)[1] ?? "(none)"}`)

		return {
			artifactedExchangeFormat,
			routePolicyVisible,
			delegationPolicyVisible,
			limitEnforcementWorks,
			onlyAssignedWorkersMayAsk,
			unrelatedRouteBlocked,
			sameStageRouteBlockedByPolicy,
			summarySurfaceIncludesLane,
			details,
		}
	} finally {
		db.close()
		DatabaseService.reset()
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
		repoHarness.cleanup()
	}
}

export function formatAskSiblingHarnessResult(result: AskSiblingHarnessResult): string {
	return [
		`Artifacted exchange format: ${result.artifactedExchangeFormat ? "PASS" : "FAIL"}`,
		`Route policy visible: ${result.routePolicyVisible ? "PASS" : "FAIL"}`,
		`Delegation policy visible: ${result.delegationPolicyVisible ? "PASS" : "FAIL"}`,
		`Limit enforcement works: ${result.limitEnforcementWorks ? "PASS" : "FAIL"}`,
		`Only assigned workers may ask: ${result.onlyAssignedWorkersMayAsk ? "PASS" : "FAIL"}`,
		`Unrelated route blocked: ${result.unrelatedRouteBlocked ? "PASS" : "FAIL"}`,
		`Same-stage route blocked by policy: ${result.sameStageRouteBlockedByPolicy ? "PASS" : "FAIL"}`,
		`Summary surface includes lane: ${result.summarySurfaceIncludesLane ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runAskSiblingHarness()
	console.log(formatAskSiblingHarnessResult(result))
	process.exit(
		result.artifactedExchangeFormat &&
			result.routePolicyVisible &&
			result.delegationPolicyVisible &&
			result.limitEnforcementWorks &&
			result.onlyAssignedWorkersMayAsk &&
			result.unrelatedRouteBlocked &&
			result.sameStageRouteBlockedByPolicy &&
			result.summarySurfaceIncludesLane
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:ask-sibling] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
