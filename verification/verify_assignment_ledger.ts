import fs from "node:fs"
import path from "node:path"

import { Orchestrator } from "../src/Orchestrator"
import { DatabaseService } from "../src/db/DatabaseService"
import { buildAssignmentLedger, formatAssignmentLedger, validateAssignmentLedger, type AssignmentLedger } from "../src/planning/AssignmentLedger"
import { buildSwarmPlanArtifact } from "../src/planning/PlanSchema"
import { buildSupervisorArbitration } from "../src/planning/SupervisorArbitration"
import { buildScopedTaskContract } from "../src/run/TaskContract"

export type AssignmentLedgerHarnessResult = {
	explicitLedgerVisible: boolean
	handoffValidationWorks: boolean
	assignmentTokensPresent: boolean
	dynamicArbitrationVisible: boolean
	delegationRulesVisible: boolean
	dependencyMetadataVisible: boolean
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

function readAssignments(summaryPath: string): AssignmentLedger {
	const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>
	const assignments = summary["assignments"]
	if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) {
		throw new Error(`Expected assignment ledger in ${summaryPath}`)
	}
	return assignments as AssignmentLedger
}

function buildParallelBuckets(task: string, files: string[], bucketCount: number): Array<{
	id: string
	description: string
	files: string[]
	assignedBuilder: string
	stage: number
	ownershipRule: string
	dependencyReason: null
}> {
	const buckets = Array.from({ length: bucketCount }, () => [] as string[])
	files.forEach((file, index) => {
		buckets[index % bucketCount]?.push(file)
	})
	const subtasks: Array<{
		id: string
		description: string
		files: string[]
		assignedBuilder: string
		stage: number
		ownershipRule: string
		dependencyReason: null
	}> = []
	for (const [index, bucket] of buckets.entries()) {
		if (bucket.length === 0) continue
		subtasks.push({
			id: `subtask-${index + 1}`,
			description: `Update ${bucket.join(", ")} to satisfy: ${task}`,
			files: bucket,
			assignedBuilder: `builder-${index + 1}`,
			stage: 1,
			ownershipRule: "Parallel medium-lane file bucket with exclusive ownership.",
			dependencyReason: null,
		})
	}
	return subtasks
}

export async function runAssignmentLedgerHarness(rootDir = resolveRootDir()): Promise<AssignmentLedgerHarnessResult> {
	const details: string[] = []
	const repoHarness = createTempRepoCopy(rootDir, "assignment-ledger")
	DatabaseService.reset()
	const dbPath = path.join(rootDir, "verification", `.tmp-assignment-ledger-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)
	const db = DatabaseService.getInstance(dbPath)

	try {
		const orchestrator = new Orchestrator(repoHarness.repoPath, db, true)
		const runResult = await orchestrator.run("update hello.ts and utils.ts together")
		const ledger = readAssignments(runResult.summaryPath)
		const validation = validateAssignmentLedger(ledger)

		const explicitLedgerVisible = ledger.assignments.length === 1 && ledger.handoffValid && validation.valid
		const assignmentTokensPresent = ledger.assignments.every((entry) => entry.assignmentToken.includes(entry.workItemId))

		const handoffValidationWorks = (() => {
			const overlappingPlan = buildSwarmPlanArtifact({
				task: "overlap fixture",
				routing: {
					complexity: "COMPLEX",
					path: "scoped",
					usedModel: false,
					targetFiles: ["hello.ts", "utils.ts"],
					selectorSource: "explicit_targets",
					reasonCodes: ["explicit_file_targets", "bounded_target_count", "prefer_deterministic_coordination"],
				},
				subtasks: [
					{ id: "subtask-1", description: "update hello.ts", files: ["hello.ts"], assignedBuilder: "builder-1" },
					{ id: "subtask-2", description: "also update hello.ts", files: ["hello.ts"], assignedBuilder: "builder-2" },
				],
				builderCountRequested: 2,
				createdAt: "2026-03-22T00:00:00.000Z",
			})
			const overlappingLedger = buildAssignmentLedger(overlappingPlan, [
				{ id: "subtask-1", description: "update hello.ts", files: ["hello.ts"], assignedBuilder: "builder-1" },
				{ id: "subtask-2", description: "also update hello.ts", files: ["hello.ts"], assignedBuilder: "builder-2" },
			])
			return overlappingLedger.handoffValid === false && overlappingLedger.handoffIssues.some((issue) => issue.includes("overlaps"))
		})()

		const mediumFiles = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts", "h.ts"]
		const mediumTask = "update a.ts, b.ts, c.ts, d.ts, e.ts, f.ts, g.ts, and h.ts together"
		const mediumRouting = {
			complexity: "COMPLEX" as const,
			path: "medium" as const,
			usedModel: false,
			targetFiles: mediumFiles,
			selectorSource: "explicit_targets" as const,
			reasonCodes: ["explicit_file_targets", "medium_target_count", "prefer_deterministic_coordination"],
		}
		const mediumTaskContract = buildScopedTaskContract(mediumFiles)
		const mediumArbitration = buildSupervisorArbitration({
			task: mediumTask,
			routing: mediumRouting,
			taskContract: mediumTaskContract,
		})
		const mediumSubtasks = buildParallelBuckets(mediumTask, mediumFiles, mediumArbitration.activeBuilderCount)
		const mediumPlan = buildSwarmPlanArtifact({
			task: mediumTask,
			routing: mediumRouting,
			subtasks: mediumSubtasks,
			builderCountRequested: mediumArbitration.requestedBuilderCount,
			taskContract: mediumTaskContract,
			arbitration: mediumArbitration,
			createdAt: "2026-03-24T00:00:00.000Z",
		})
		const mediumLedger = buildAssignmentLedger(mediumPlan, mediumSubtasks)
		const dynamicArbitrationVisible =
			mediumLedger.handoffValid &&
			mediumLedger.arbitration?.strategy === "medium_fanout" &&
			mediumLedger.arbitration?.requestedBuilderCount === 2 &&
			mediumLedger.arbitration?.activeBuilderCount === 2 &&
			mediumLedger.assignments.length === 2
		const delegationRulesVisible =
			mediumLedger.arbitration?.delegationMode === "exclusive_parallel" &&
			mediumLedger.arbitration?.clarificationMode === "dependency_and_same_stage_routes" &&
			mediumLedger.arbitration?.completionRule === "assignment_tokens_then_review" &&
			mediumLedger.arbitration?.refusalTriggers.includes("stale_assignment_completion") === true &&
			formatAssignmentLedger(mediumLedger).includes("clarification=dependency_and_same_stage_routes")

		const serialPlan = buildSwarmPlanArtifact({
			task: "serial dependency fixture",
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
			createdAt: "2026-03-24T00:00:00.000Z",
		})
		const serialLedger = buildAssignmentLedger(serialPlan, [
			{
				id: "subtask-1",
				description: "update hello.ts first",
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
		])
		const dependencyMetadataVisible =
			serialLedger.assignments.some(
				(entry) => entry.dependsOn.includes("subtask-1") && entry.stage === 2 && entry.dependencyReason?.includes("Wait for subtask-1") === true,
			) && formatAssignmentLedger(serialLedger).includes("dependsOn=subtask-1")

		details.push(`summary=${runResult.summaryPath}`)
		details.push(`ledger=${formatAssignmentLedger(ledger).split(/\r?\n/g)[0]}`)
		details.push(`mediumArbitration=${mediumLedger.arbitration?.strategy ?? "(missing)"}:${mediumLedger.arbitration?.activeBuilderCount ?? 0}`)

		return {
			explicitLedgerVisible,
			handoffValidationWorks,
			assignmentTokensPresent,
			dynamicArbitrationVisible,
			delegationRulesVisible,
			dependencyMetadataVisible,
			details,
		}
	} finally {
		db.close()
		DatabaseService.reset()
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
		repoHarness.cleanup()
	}
}

export function formatAssignmentLedgerHarnessResult(result: AssignmentLedgerHarnessResult): string {
	return [
		`Explicit ledger visible: ${result.explicitLedgerVisible ? "PASS" : "FAIL"}`,
		`Handoff validation works: ${result.handoffValidationWorks ? "PASS" : "FAIL"}`,
		`Assignment tokens present: ${result.assignmentTokensPresent ? "PASS" : "FAIL"}`,
		`Dynamic arbitration visible: ${result.dynamicArbitrationVisible ? "PASS" : "FAIL"}`,
		`Delegation rules visible: ${result.delegationRulesVisible ? "PASS" : "FAIL"}`,
		`Dependency metadata visible: ${result.dependencyMetadataVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runAssignmentLedgerHarness()
	console.log(formatAssignmentLedgerHarnessResult(result))
	process.exit(
		result.explicitLedgerVisible &&
			result.handoffValidationWorks &&
			result.assignmentTokensPresent &&
			result.dynamicArbitrationVisible &&
			result.delegationRulesVisible &&
			result.dependencyMetadataVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:assignment-ledger] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
