import fs from "node:fs"
import path from "node:path"

import { Orchestrator } from "../src/Orchestrator"
import { DatabaseService } from "../src/db/DatabaseService"
import { buildMergeOrderArtifact } from "../src/planning/MergeOrder"
import { buildPostMergeQualityArtifact, formatPostMergeQualityArtifact, type PostMergeQualityArtifact } from "../src/planning/PostMergeQuality"
import type { AssignmentLedger } from "../src/planning/AssignmentLedger"
import type { SwarmPlanArtifact } from "../src/planning/PlanSchema"
import { listRoleManualReferences } from "../src/planning/RoleManuals"
import type { VerificationProfileResult } from "../src/run/VerificationProfile"

export type PostMergeQualityHarnessResult = {
	passedWithVerification: boolean
	blockedWithoutCleanRun: boolean
	omissionMetadataVisible: boolean
	targetedMetadataVisible: boolean
	approvalRiskVisible: boolean
	summarySurfaceVisible: boolean
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

function fixturePlan(): SwarmPlanArtifact {
	return {
		schemaVersion: 1,
		task: "update hello.ts before utils.ts",
		pathChosen: "scoped",
		planStatus: "planned",
		executionStatus: "running",
		builderCountRequested: 2,
		builderCountRecommended: 2,
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
			reasons: ["Dependency fixture keeps ordering explicit."],
		},
		roleContextPolicy: {
			planner: "Use run-level context packs with scout, repo-map, and omission evidence.",
			builder: "Use per-work-item context packs with owned files, task context, and scout context.",
			critic: "Use plan, arbitration, dependency, and omission evidence instead of the builder pack.",
			reviewer: "Use diff evidence plus reviewer-specific bounded context instead of builder edit context.",
		},
		scoutCoverage: {
			source: "explicit_targets",
			coveredFiles: ["hello.ts", "utils.ts"],
			omittedFiles: ["README.md"],
			contextFiles: [],
			corpusTaskId: null,
			corpusLabel: null,
			heuristicsUsed: [],
			notes: [],
			summary: "Dependency fixture.",
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
				ownershipRule: "First bounded owner.",
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
				ownershipRule: "Follow-on bounded owner.",
				dependencyReason: "Wait for subtask-1 before updating utils.ts.",
			},
		],
		expectedRisks: ["Multiple work items require explicit merge order."],
		unresolvedQuestions: [],
		roleManuals: listRoleManualReferences(["supervisor", "builder", "critic", "reviewer"]),
		createdAt: "2026-03-22T00:00:00.000Z",
	}
}

function fixtureAssignments(): AssignmentLedger {
	return {
		schemaVersion: 1,
		handoffValid: true,
		handoffIssues: [],
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
			},
		],
	}
}

function fixtureVerification(status: VerificationProfileResult["status"], message: string): VerificationProfileResult {
	return {
		status,
		applied: status !== "not_applicable",
		applicability: status === "not_applicable" ? "no_profile_declared" : "applied",
		profileName: status === "not_applicable" ? null : "repo-check",
		profileClass: null,
		executorAdapterId: null,
		policyPackId: null,
		manifestHash: null,
		sourcePath: status === "not_applicable" ? null : "package.json",
		command: status === "not_applicable" ? null : "npm test",
		cwd: status === "not_applicable" ? null : ".",
		timeoutMs: status === "not_applicable" ? null : 60_000,
		fileScopeHint: ["hello.ts", "utils.ts"],
		matchedChangedFiles: ["hello.ts", "utils.ts"],
		message,
		details: [message],
		stdout: "",
		stderr: "",
		exitCode: status === "passed" ? 0 : 1,
	}
}

function readPostMergeQuality(summaryPath: string): PostMergeQualityArtifact {
	const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>
	const postMergeQuality = summary["postMergeQuality"]
	if (!postMergeQuality || typeof postMergeQuality !== "object" || Array.isArray(postMergeQuality)) {
		throw new Error(`Expected post-merge quality artifact in ${summaryPath}`)
	}
	return postMergeQuality as PostMergeQualityArtifact
}

export async function runPostMergeQualityHarness(rootDir = resolveRootDir()): Promise<PostMergeQualityHarnessResult> {
	const details: string[] = []
	const repoHarness = createTempRepoCopy(rootDir, "post-merge-quality")
	DatabaseService.reset()
	const dbPath = path.join(rootDir, "verification", `.tmp-post-merge-quality-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)
	const db = DatabaseService.getInstance(dbPath)

	try {
		const mergeOrder = buildMergeOrderArtifact({
			taskId: "task-post-merge",
			plan: fixturePlan(),
			assignments: fixtureAssignments(),
		})
		const passed = buildPostMergeQualityArtifact({
			mergeOrder,
			finalStatus: "done",
			verificationProfile: fixtureVerification("passed", "Verification passed."),
			changedFiles: ["hello.ts"],
			omittedFiles: ["README.md"],
		})
		const blocked = buildPostMergeQualityArtifact({
			mergeOrder,
			finalStatus: "failed",
			verificationProfile: null,
			changedFiles: ["hello.ts"],
		})

		const orchestrator = new Orchestrator(repoHarness.repoPath, db, true)
		const runResult = await orchestrator.run("update hello.ts and utils.ts together")
		const summaryPostMergeQuality = readPostMergeQuality(runResult.summaryPath)

		const passedWithVerification = passed.status === "passed" && passed.verificationSource === "repo_profile"
		const blockedWithoutCleanRun = blocked.status === "blocked" && blocked.blockers.length > 0
		const omissionMetadataVisible = passed.changedFileCount === 1 && passed.omissionCount === 1
		const targetedMetadataVisible =
			summaryPostMergeQuality.targetedEvaluatorStatus === "concern" &&
			summaryPostMergeQuality.targetedConcernCount > 0 &&
			summaryPostMergeQuality.targetedEvaluatorIds.length > 0 &&
			summaryPostMergeQuality.targetedSummary.includes("targeted evaluator")
		const approvalRiskVisible =
			passed.approvalRisk === "none" &&
			blocked.approvalRisk === "run_not_clean" &&
			blocked.followUpChecks.length > 0 &&
			formatPostMergeQualityArtifact(summaryPostMergeQuality).includes("Approval risk:")
		const summarySurfaceVisible = summaryPostMergeQuality.status === "blocked" && typeof summaryPostMergeQuality.summary === "string"

		details.push(`summary=${runResult.summaryPath}`)
		details.push(`postMergeQuality=${formatPostMergeQualityArtifact(summaryPostMergeQuality).split(/\r?\n/g)[0]}`)

		return {
			passedWithVerification,
			blockedWithoutCleanRun,
			omissionMetadataVisible,
			targetedMetadataVisible,
			approvalRiskVisible,
			summarySurfaceVisible,
			details,
		}
	} finally {
		db.close()
		DatabaseService.reset()
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
		repoHarness.cleanup()
	}
}

export function formatPostMergeQualityHarnessResult(result: PostMergeQualityHarnessResult): string {
	return [
		`Passed with verification: ${result.passedWithVerification ? "PASS" : "FAIL"}`,
		`Blocked without clean run: ${result.blockedWithoutCleanRun ? "PASS" : "FAIL"}`,
		`Omission metadata visible: ${result.omissionMetadataVisible ? "PASS" : "FAIL"}`,
		`Targeted metadata visible: ${result.targetedMetadataVisible ? "PASS" : "FAIL"}`,
		`Approval risk visible: ${result.approvalRiskVisible ? "PASS" : "FAIL"}`,
		`Summary surface visible: ${result.summarySurfaceVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runPostMergeQualityHarness()
	console.log(formatPostMergeQualityHarnessResult(result))
	process.exit(
			result.passedWithVerification &&
			result.blockedWithoutCleanRun &&
			result.omissionMetadataVisible &&
			result.targetedMetadataVisible &&
			result.approvalRiskVisible &&
			result.summarySurfaceVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:post-merge-quality] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
