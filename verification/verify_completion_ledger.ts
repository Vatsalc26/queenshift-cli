import fs from "node:fs"
import path from "node:path"

import { Orchestrator } from "../src/Orchestrator"
import { DatabaseService } from "../src/db/DatabaseService"
import { buildCompletionLedger, formatCompletionLedger, validateCompletionLedger, type CompletionLedger } from "../src/planning/CompletionLedger"
import type { AssignmentLedger } from "../src/planning/AssignmentLedger"

export type CompletionLedgerHarnessResult = {
	blockedEntriesRecorded: boolean
	dependencyStateVisible: boolean
	stageWindowVisible: boolean
	proofArtifactRequiredForComplete: boolean
	dependencyOrderingRejected: boolean
	staleCompletionRejected: boolean
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

function readCompletionLedger(summaryPath: string): CompletionLedger {
	const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>
	const completionLedger = summary["completionLedger"]
	if (!completionLedger || typeof completionLedger !== "object" || Array.isArray(completionLedger)) {
		throw new Error(`Expected completion ledger in ${summaryPath}`)
	}
	return completionLedger as CompletionLedger
}

function buildFixtureAssignments(): AssignmentLedger {
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

export async function runCompletionLedgerHarness(rootDir = resolveRootDir()): Promise<CompletionLedgerHarnessResult> {
	const details: string[] = []
	const repoHarness = createTempRepoCopy(rootDir, "completion-ledger")
	DatabaseService.reset()
	const dbPath = path.join(rootDir, "verification", `.tmp-completion-ledger-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)
	const db = DatabaseService.getInstance(dbPath)

	try {
		const orchestrator = new Orchestrator(repoHarness.repoPath, db, true)
		const runResult = await orchestrator.run("update hello.ts and utils.ts together")
		const ledger = readCompletionLedger(runResult.summaryPath)
		const blockedEntriesRecorded =
			ledger.entries.length > 0 &&
			ledger.entries.every((entry) => entry.state === "blocked") &&
			ledger.entries.some((entry) => entry.dependencyState === "ready")

		const completeLedger = buildCompletionLedger({
			runId: "task-current",
			finalStatus: "done",
			assignments: buildFixtureAssignments(),
			proofArtifactPath: "summary.json",
		})
		if (!completeLedger) throw new Error("Expected fixture completion ledger to exist")
		const dependencyStateVisible =
			completeLedger.dependencyGraphSafe &&
			completeLedger.entries[0]?.dependencyState === "released" &&
			completeLedger.entries[0]?.releasedWorkItems.includes("subtask-2") === true &&
			completeLedger.entries[1]?.dependsOn.includes("subtask-1") === true
		const stageWindowVisible =
			completeLedger.continuationSurface === "retry_planner_checkpoint_artifacts" &&
			completeLedger.stageSummary.totalStages === 2 &&
			completeLedger.stageSummary.activeStage === null &&
			completeLedger.stageSummary.completedStages.join(",") === "1,2" &&
			formatCompletionLedger(completeLedger).includes("Continuation surface: retry_planner_checkpoint_artifacts")
		const proofArtifactRequiredForComplete =
			validateCompletionLedger(completeLedger, "task-current").valid === true &&
			validateCompletionLedger(
				{
					...completeLedger,
					entries: completeLedger.entries.map((entry) => ({ ...entry, proofArtifactPath: null })),
				},
				"task-current",
			).valid === false
		const dependencyOrderingRejected =
			validateCompletionLedger(
				{
					...completeLedger,
					entries: completeLedger.entries.map((entry) =>
						entry.workItemId === "subtask-1"
							? {
									...entry,
									state: "blocked",
									proofArtifactPath: null,
							  }
							: entry,
					),
				},
				"task-current",
			).valid === false
		const staleCompletionRejected =
			validateCompletionLedger(
				{
					...completeLedger,
					entries: completeLedger.entries.map((entry) => ({ ...entry, runId: "task-old" })),
				},
				"task-current",
			).valid === false

		details.push(`summary=${runResult.summaryPath}`)
		details.push(`ledger=${formatCompletionLedger(ledger).split(/\r?\n/g)[1] ?? "(none)"}`)

		return {
			blockedEntriesRecorded,
			dependencyStateVisible,
			stageWindowVisible,
			proofArtifactRequiredForComplete,
			dependencyOrderingRejected,
			staleCompletionRejected,
			details,
		}
	} finally {
		db.close()
		DatabaseService.reset()
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
		repoHarness.cleanup()
	}
}

export function formatCompletionLedgerHarnessResult(result: CompletionLedgerHarnessResult): string {
	return [
		`Blocked entries recorded: ${result.blockedEntriesRecorded ? "PASS" : "FAIL"}`,
		`Dependency state visible: ${result.dependencyStateVisible ? "PASS" : "FAIL"}`,
		`Stage window visible: ${result.stageWindowVisible ? "PASS" : "FAIL"}`,
		`Proof artifact required for complete: ${result.proofArtifactRequiredForComplete ? "PASS" : "FAIL"}`,
		`Dependency ordering rejected: ${result.dependencyOrderingRejected ? "PASS" : "FAIL"}`,
		`Stale completion rejected: ${result.staleCompletionRejected ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runCompletionLedgerHarness()
	console.log(formatCompletionLedgerHarnessResult(result))
	process.exit(
		result.blockedEntriesRecorded &&
			result.dependencyStateVisible &&
			result.stageWindowVisible &&
			result.proofArtifactRequiredForComplete &&
			result.dependencyOrderingRejected &&
			result.staleCompletionRejected
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:completion-ledger] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
