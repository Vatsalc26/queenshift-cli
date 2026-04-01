import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import type { MergeOrderArtifact } from "../src/planning/MergeOrder"
import { buildInitialReviewRecord } from "../src/run/ReviewQueue"
import {
	ensureIncidentPack,
	formatIncidentPack,
	rollbackIncidentRun,
} from "../src/run/IncidentPack"
import { ensureRunDir, readRunSummary, resolveRunDir, writeRunSummary } from "../src/run/RunArtifacts"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type IncidentHarnessResult = {
	incidentPackGenerated: boolean
	incidentPackContents: boolean
	safeDiscardCleanup: boolean
	ambiguousRollbackRefused: boolean
	mergeNegotiationVisible: boolean
	operatorAuditVisible: boolean
	redLaneSuggestionGenerated: boolean
	nextActionHint: boolean
	failureNarrativeVisible: boolean
	recoveryLoopVisible: boolean
	supportIssueIntakeVisible: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

async function createTempRepoCopy(rootDir: string): Promise<{ repoPath: string; cleanup: () => void }> {
	return await createTempTestRepoCopy(rootDir, "incident")
}

async function runCommandCapture(
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs?: number } = { cwd: process.cwd() },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	const timeoutMs = options.timeoutMs ?? 60_000
	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
	const stdoutPath = path.join(options.cwd, `.tmp-incident-cmd-${stamp}.stdout.log`)
	const stderrPath = path.join(options.cwd, `.tmp-incident-cmd-${stamp}.stderr.log`)
	const stdoutFd = fs.openSync(stdoutPath, "w")
	const stderrFd = fs.openSync(stderrPath, "w")

	const readFile = (filePath: string): string => {
		try {
			return fs.readFileSync(filePath, "utf8")
		} catch {
			return ""
		}
	}

	try {
		return await new Promise((resolve, reject) => {
			const child = spawn(command, args, {
				cwd: options.cwd,
				windowsHide: true,
				stdio: ["ignore", stdoutFd, stderrFd],
			})

			const timeout = setTimeout(() => {
				if (process.platform === "win32" && child.pid) {
					try {
						spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
					} catch {
						// ignore
					}
					return
				}
				try {
					child.kill("SIGTERM")
				} catch {
					// ignore
				}
			}, timeoutMs)
			timeout.unref?.()

			child.once("error", (err) => {
				clearTimeout(timeout)
				reject(err)
			})
			child.once("close", (code) => {
				clearTimeout(timeout)
				resolve({
					code: typeof code === "number" ? code : null,
					stdout: readFile(stdoutPath),
					stderr: readFile(stderrPath),
				})
			})
		})
	} finally {
		try {
			fs.closeSync(stdoutFd)
		} catch {
			// ignore
		}
		try {
			fs.closeSync(stderrFd)
		} catch {
			// ignore
		}
		try {
			fs.unlinkSync(stdoutPath)
		} catch {
			// ignore
		}
		try {
			fs.unlinkSync(stderrPath)
		} catch {
			// ignore
		}
	}
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
	const result = await runCommandCapture("git", ["-c", `safe.directory=${repoPath}`, ...args], {
		cwd: repoPath,
		timeoutMs: 30_000,
	})
	if (result.code !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
	}
	return result.stdout.trim()
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
	const result = await runCommandCapture("git", ["-c", `safe.directory=${repoPath}`, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
		cwd: repoPath,
		timeoutMs: 15_000,
	})
	return result.code === 0
}

function buildBlockedMergeOrderArtifact(runId: string): MergeOrderArtifact {
	const branch1 = `swarm/${runId}/subtask-1`
	const branch2 = `swarm/${runId}/subtask-2`
	const integrationBranch = `swarm/${runId}/integration`
	return {
		schemaVersion: 1,
		status: "blocked",
		sequence: [
			{
				workItemId: "subtask-1",
				assignmentId: "assign-subtask-1",
				branchName: branch1,
				order: 1,
				dependsOn: [],
				reason: "No prerequisite work items.",
				ownedFiles: ["hello.ts"],
			},
			{
				workItemId: "subtask-2",
				assignmentId: "assign-subtask-2",
				branchName: branch2,
				order: 2,
				dependsOn: ["subtask-1"],
				reason: "Depends on subtask-1.",
				ownedFiles: ["hello.ts"],
			},
		],
		conflictRisks: ["Shared file hello.ts is owned by more than one branch."],
		blockers: ["Shared file ownership requires explicit dependency order: hello.ts"],
		negotiation: {
			mode: "manual_conflict_review",
			readiness: "blocked",
			targetBranch: integrationBranch,
			approvalBranch: integrationBranch,
			sourceBranches: [branch1, branch2],
			steps: [
				{
					order: 1,
					workItemId: "subtask-1",
					assignmentId: "assign-subtask-1",
					sourceBranch: branch1,
					targetBranch: integrationBranch,
					dependsOnBranches: [],
					reviewFocus: ["hello.ts"],
				},
				{
					order: 2,
					workItemId: "subtask-2",
					assignmentId: "assign-subtask-2",
					sourceBranch: branch2,
					targetBranch: integrationBranch,
					dependsOnBranches: [branch1],
					reviewFocus: ["hello.ts"],
				},
			],
			reviewStages: [
				{
					id: "source_order",
					label: "Source order",
					status: "blocked",
					summary: "Dependency-safe source ordering is not yet safe enough for approval.",
				},
				{
					id: "integration_branch",
					label: "Integration branch",
					status: "blocked",
					summary: `Do not trust ${integrationBranch} until the merge blockers are resolved.`,
				},
				{
					id: "human_approval",
					label: "Human approval",
					status: "blocked",
					summary: "Human approval must stop until merge blockers are cleared.",
				},
			],
			reviewChecklist: [
				"Do not approve this run until merge blockers are resolved.",
				"Discard or rerun with narrower ownership or explicit dependency ordering.",
			],
			conflictReview: ["Shared file hello.ts needs manual conflict review before approval."],
			handoffSummary: `Ordered handoff: ${branch1} (hello.ts) -> ${branch2} after subtask-1 (hello.ts).`,
			summary: "Merge negotiation is blocked. Human review can inspect the evidence but should not approve this run.",
		},
		summary: "Merge order blocked because dependency-safe sequencing could not be proven.",
	}
}

async function createReviewIncidentRun(
	repoPath: string,
	runId: string,
	fileName: string,
	insertText: string,
): Promise<{ branch: string }> {
	const currentBranch = (await runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim()
	const baseRef = (await runGit(repoPath, ["rev-parse", "HEAD"])).trim()
	const branch = `swarm/${runId}/simple`
	const targetPath = path.join(repoPath, fileName)

	await runGit(repoPath, ["checkout", "-b", branch])
	fs.appendFileSync(targetPath, insertText, "utf8")
	await runGit(repoPath, ["add", fileName])
	await runGit(repoPath, ["commit", "-m", `incident fixture ${runId}`])
	await runGit(repoPath, ["checkout", currentBranch])

	const runDir = ensureRunDir(repoPath, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "review incident fixture",
		workspace: repoPath,
		dryRun: false,
		allowDirty: false,
		startedAt: new Date().toISOString(),
		endedAt: new Date().toISOString(),
		durationMs: 1,
		status: "review_required",
		stopReason: "review_blocked",
		message: "Human review required.",
		complexity: "SIMPLE",
		pathChosen: "small_task",
		modelClassificationUsed: false,
		taskContract: {
			scope: {
				requiredTargetFiles: [fileName],
			},
		},
		acceptanceGate: {
			passed: false,
			failedChecks: ["reviewer_not_passed"],
			warnings: [],
		},
		agentCount: 2,
		builderIterationCount: 1,
		reviewerVerdict: "NEEDS_WORK",
		changedFiles: [fileName],
		createdFiles: [],
		git: {
			baseRef,
			branches: [branch],
		},
		review: buildInitialReviewRecord(repoPath, runId, "review_required", false, [branch]),
		recovery: null,
		runtime: {},
		provider: {
			provider: "stub",
			model: null,
			failureBucket: null,
			retryCount: 0,
		},
		modelCallCount: 0,
		usage: {
			tokenUsageAvailable: false,
			estimatedPromptTokens: 0,
			estimatedResponseTokens: 0,
			estimatedTotalTokens: 0,
		},
	})

	return { branch }
}

function createFailedIncidentRun(repoPath: string, runId: string): void {
	const runDir = ensureRunDir(repoPath, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "failed incident fixture",
		workspace: repoPath,
		dryRun: false,
		allowDirty: false,
		startedAt: new Date().toISOString(),
		endedAt: new Date().toISOString(),
		durationMs: 1,
		status: "failed",
		stopReason: "verification_failed",
		message: "Verification did not pass.",
		complexity: "SIMPLE",
		pathChosen: "small_task",
		modelClassificationUsed: false,
		taskContract: {
			scope: {
				requiredTargetFiles: ["hello.ts"],
			},
			derivation: {
				mode: "explicit",
				summary: "hello.ts only",
			},
		},
		acceptanceGate: {
			passed: false,
			failedChecks: ["verification_profile_failed"],
			warnings: [],
		},
		verificationProfile: {
			profileName: "local-npm-test",
			status: "failed",
			message: "npm test exited non-zero",
		},
		agentCount: 2,
		builderIterationCount: 1,
		reviewerVerdict: "PASS",
		changedFiles: ["hello.ts"],
		createdFiles: [],
		git: {
			baseRef: "HEAD",
			branches: [],
		},
		review: null,
		recovery: {
			orphanedWorktrees: [],
			orphanedSwarmBranches: [],
			staleTaskIds: [],
			staleTmpEntries: [path.join(repoPath, ".swarm", "tmp", "incident-leftover.log")],
			incompleteRunArtifacts: [],
		},
		runtime: {},
		provider: {
			provider: "stub",
			model: null,
			failureBucket: null,
			retryCount: 0,
		},
		modelCallCount: 0,
		usage: {
			tokenUsageAvailable: false,
			estimatedPromptTokens: 0,
			estimatedResponseTokens: 0,
			estimatedTotalTokens: 0,
		},
	})

	const tmpDir = path.join(repoPath, ".swarm", "tmp")
	fs.mkdirSync(tmpDir, { recursive: true })
	fs.writeFileSync(path.join(tmpDir, "incident-leftover.log"), "leftover\n", "utf8")
}

function createAmbiguousIncidentRun(repoPath: string, runId: string): void {
	const runDir = ensureRunDir(repoPath, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "ambiguous incident fixture",
		workspace: repoPath,
		dryRun: false,
		allowDirty: false,
		startedAt: new Date().toISOString(),
		endedAt: new Date().toISOString(),
		durationMs: 1,
		status: "failed",
		stopReason: "merge_conflict",
		message: "Merge conflict encountered.",
		complexity: "COMPLEX",
		pathChosen: "scoped",
		modelClassificationUsed: false,
		taskContract: null,
		acceptanceGate: {
			passed: false,
			failedChecks: ["merge_conflict"],
			warnings: [],
		},
		verificationProfile: null,
		agentCount: 3,
		builderIterationCount: 2,
		reviewerVerdict: "NEEDS_WORK",
		changedFiles: ["hello.ts", "utils.ts"],
		createdFiles: [],
		git: {
			baseRef: "HEAD",
			branches: ["feature/user-owned"],
		},
		mergeOrder: buildBlockedMergeOrderArtifact(runId),
		review: {
			decision: "pending",
			primaryBranch: "feature/user-owned",
			branchNames: ["feature/user-owned"],
			ownedWorktreeDir: path.join(repoPath, "..", "user-worktree"),
			mainWorkspaceTouched: true,
		},
		recovery: null,
		runtime: {},
		provider: {
			provider: "stub",
			model: null,
			failureBucket: null,
			retryCount: 0,
		},
		modelCallCount: 0,
		usage: {
			tokenUsageAvailable: false,
			estimatedPromptTokens: 0,
			estimatedResponseTokens: 0,
			estimatedTotalTokens: 0,
		},
	})
}

export async function runIncidentHarness(rootDir = resolveRootDir()): Promise<IncidentHarnessResult> {
	const { repoPath, cleanup } = await createTempRepoCopy(rootDir)
	const details: string[] = []

	try {
		const failedRunId = `task-incident-failed-${Date.now()}`
		const reviewRunId = `task-incident-review-${Date.now()}`
		const ambiguousRunId = `task-incident-ambiguous-${Date.now()}`

		createFailedIncidentRun(repoPath, failedRunId)
		const failedPack = await ensureIncidentPack(repoPath, failedRunId)
		const failedPackText = formatIncidentPack(failedPack)
		const incidentPackPath = failedPack.artifacts.incidentPackPath
		const incidentPackGenerated = fs.existsSync(incidentPackPath)
		const incidentPackContents =
			failedPack.failureBucket === "verification profile" &&
			failedPack.changedFiles.includes("hello.ts") &&
			failedPack.redLaneHint.recommended === true &&
			failedPack.recoveryAction.label.length > 0 &&
			failedPack.cleanupOwnership.recoveryInventory.staleTmpEntries.length === 1
		const redLaneSuggestionGenerated =
			failedPack.redLaneHint.suggestedFileName === "FixRedLane_SessionXX_VerificationProfile.md" &&
			failedPack.redLaneHint.firstInvariantAtRisk === "post-edit verification contract" &&
			failedPack.redLaneHint.nearbyProofCommands.includes("npm.cmd run verify:profiles")
		const failureNarrativeVisible =
			failedPack.failureNarrative?.whatFailed.includes("Verification profile failure") === true &&
			failedPack.failureNarrative?.safestNextStep.includes("stop and fix red lane") === true &&
			failedPackText.includes("Failure narrative:") &&
			failedPackText.includes("What failed:") &&
			failedPackText.includes("Safest next step:") &&
			failedPackText.includes("Keep these artifacts authoritative:")
		const supportIssueIntakeVisible =
			failedPack.supportIssueIntake.templatePath === ".github/ISSUE_TEMPLATE/bug_report.md" &&
			failedPack.supportIssueIntake.guidePath === "SUPPORT_ISSUE_INTAKE.md" &&
			failedPack.supportIssueIntake.proofCommands.includes("npm.cmd test") &&
			failedPack.supportIssueIntake.artifactPaths.includes(failedPack.artifacts.summaryPath) &&
			failedPackText.includes("Support issue intake:") &&
			failedPackText.includes("Suggested issue title: [bug]") &&
			failedPackText.includes(".github/ISSUE_TEMPLATE/bug_report.md")
		details.push(
			`failedPack bucket=${failedPack.failureBucket} recovery=${failedPack.recoveryAction.kind}`,
			`failedPack redLaneFile=${failedPack.redLaneHint.suggestedFileName}`,
			`failedPack issueTitle=${failedPack.supportIssueIntake.suggestedTitle}`,
		)

		const reviewFixture = await createReviewIncidentRun(repoPath, reviewRunId, "hello.ts", "\n// incident discard fixture\n")
		const discardResult = await rollbackIncidentRun(repoPath, reviewRunId)
		const reviewSummary = readRunSummary(resolveRunDir(repoPath, reviewRunId))
		const reviewIncident = reviewSummary ? (reviewSummary["incident"] as Record<string, unknown> | undefined) : undefined
		const reviewCleanup = reviewIncident ? (reviewIncident["cleanup"] as Record<string, unknown> | undefined) : undefined
		const safeDiscardCleanup =
			discardResult.decision === "discarded_review" &&
			reviewCleanup?.["status"] === "applied" &&
			!(await branchExists(repoPath, reviewFixture.branch))
		details.push(`discard decision=${discardResult.decision} branchDeleted=${String(!(await branchExists(repoPath, reviewFixture.branch)))}`)

		createAmbiguousIncidentRun(repoPath, ambiguousRunId)
		const ambiguousResult = await rollbackIncidentRun(repoPath, ambiguousRunId)
		const ambiguousPack = await ensureIncidentPack(repoPath, ambiguousRunId)
		const ambiguousPackText = formatIncidentPack(ambiguousPack)
		const ambiguousRollbackRefused =
			ambiguousResult.decision === "refused" &&
			ambiguousPack.cleanupOwnership.ambiguousOwnership === true &&
			ambiguousPack.redLaneHint.recommended === true
		const recoveryLoopVisible =
			failedPackText.includes("Recovery loop: incident:latest -> owner:quick-actions -> replay:latest") &&
			ambiguousPackText.includes("Recovery loop: incident:latest -> owner:quick-actions -> replay:latest")
		const mergeNegotiationVisible =
			ambiguousPack.mergeNegotiation?.status === "blocked" &&
			ambiguousPack.mergeNegotiation.mode === "manual_conflict_review" &&
			ambiguousPackText.includes("Merge conflict review:") &&
			ambiguousPackText.includes("Merge negotiation: blocked / manual_conflict_review")
		const operatorAuditVisible =
			Boolean(reviewSummary) &&
			ambiguousPack.operatorAudit === null &&
			(Array.isArray(failedPack.operatorAudit?.history) || failedPack.operatorAudit === null) &&
			failedPackText.includes("Operator audit:")
		details.push(`ambiguous decision=${ambiguousResult.decision} reasons=${ambiguousPack.cleanupOwnership.ambiguousOwnershipReasons.length}`)

		const latestPack = await ensureIncidentPack(repoPath)
		const nextActionHint =
			latestPack.runId === ambiguousRunId &&
			latestPack.redLaneHint.rationale.length > 0 &&
			latestPack.recoveryAction.command !== null &&
			latestPack.redLaneHint.stageCommand.includes("FixRedLane_SessionXX_MergeConflict.md") &&
			latestPack.nextAction.label === "stop and fix red lane"

		return {
			incidentPackGenerated,
			incidentPackContents,
			safeDiscardCleanup,
			ambiguousRollbackRefused,
			mergeNegotiationVisible,
			operatorAuditVisible,
			redLaneSuggestionGenerated,
			nextActionHint,
			failureNarrativeVisible,
			recoveryLoopVisible,
			supportIssueIntakeVisible,
			details,
		}
	} finally {
		cleanup()
	}
}

export function formatIncidentHarnessResult(result: IncidentHarnessResult): string {
	return [
		`Incident pack generation: ${result.incidentPackGenerated ? "PASS" : "FAIL"}`,
		`Incident pack contents: ${result.incidentPackContents ? "PASS" : "FAIL"}`,
		`Safe discard cleanup: ${result.safeDiscardCleanup ? "PASS" : "FAIL"}`,
		`Ambiguous rollback refusal: ${result.ambiguousRollbackRefused ? "PASS" : "FAIL"}`,
		`Merge negotiation visible: ${result.mergeNegotiationVisible ? "PASS" : "FAIL"}`,
		`Operator audit visible: ${result.operatorAuditVisible ? "PASS" : "FAIL"}`,
		`Red-lane suggestion generated: ${result.redLaneSuggestionGenerated ? "PASS" : "FAIL"}`,
		`Owner next-action hint: ${result.nextActionHint ? "PASS" : "FAIL"}`,
		`Failure narrative visible: ${result.failureNarrativeVisible ? "PASS" : "FAIL"}`,
		`Recovery loop visible: ${result.recoveryLoopVisible ? "PASS" : "FAIL"}`,
		`Support issue intake visible: ${result.supportIssueIntakeVisible ? "PASS" : "FAIL"}`,
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runIncidentHarness()
	console.log(formatIncidentHarnessResult(result))
	process.exit(
		result.incidentPackGenerated &&
			result.incidentPackContents &&
			result.safeDiscardCleanup &&
			result.ambiguousRollbackRefused &&
			result.mergeNegotiationVisible &&
			result.operatorAuditVisible &&
			result.redLaneSuggestionGenerated &&
			result.nextActionHint &&
			result.failureNarrativeVisible &&
			result.recoveryLoopVisible &&
			result.supportIssueIntakeVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:incident] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
