import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import type { MergeOrderArtifact } from "../src/planning/MergeOrder"
import { buildInitialReviewRecord, ensureReviewPack } from "../src/run/ReviewQueue"
import { ensureRunDir, readRunSummary, resolveRunDir, writeRunSummary } from "../src/run/RunArtifacts"
import { enqueueWorkItem } from "../src/run/WorkQueue"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type ReviewQueueHarnessResult = {
	listingWorks: boolean
	showWorks: boolean
	mergeNegotiationVisible: boolean
	approvalPackageVisible: boolean
	queueFollowUpVisible: boolean
	approveWorks: boolean
	blockedMergeNegotiationRefusesApproval: boolean
	discardWorks: boolean
	multiReviewerPolicyWorks: boolean
	operatorAuditVisible: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

async function createTempRepoCopy(rootDir: string): Promise<{ repoPath: string; cleanup: () => void }> {
	return await createTempTestRepoCopy(rootDir, "review-queue")
}

async function runCommandCapture(
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs?: number } = { cwd: process.cwd() },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	const timeoutMs = options.timeoutMs ?? 60_000
	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
	const stdoutPath = path.join(options.cwd, `.tmp-review-cmd-${stamp}.stdout.log`)
	const stderrPath = path.join(options.cwd, `.tmp-review-cmd-${stamp}.stderr.log`)
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
			} else {
				try {
					child.kill("SIGTERM")
				} catch {
					// ignore
				}
			}
		}, timeoutMs)
		timeout.unref?.()

		child.once("error", reject)
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
	const result = await runCommandCapture("git", ["-c", `safe.directory=${repoPath}`, ...args], { cwd: repoPath, timeoutMs: 30_000 })
	if (result.code !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
	}
	return result.stdout.trim()
}

function buildCoordinatedMergeOrderArtifact(runId: string, status: "planned" | "blocked"): MergeOrderArtifact {
	const branch1 = `swarm/${runId}/subtask-1`
	const branch2 = `swarm/${runId}/subtask-2`
	const integrationBranch = `swarm/${runId}/integration`
	const sequence = [
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
			ownedFiles: status === "blocked" ? ["hello.ts"] : ["utils.ts"],
		},
	]
	const blockers = status === "blocked" ? ["Shared file ownership requires explicit dependency order: hello.ts"] : []
	const conflictReview =
		status === "blocked"
			? ["Shared file hello.ts needs manual conflict review before approval."]
			: ["Confirm swarm handoff from subtask-1 into subtask-2 before approval."]
	return {
		schemaVersion: 1,
		status,
		sequence,
		conflictRisks: status === "blocked" ? ["Shared file hello.ts is owned by more than one branch."] : [],
		blockers,
		negotiation: {
			mode: status === "blocked" ? "manual_conflict_review" : "integration_branch_review",
			readiness: status === "blocked" ? "blocked" : "ready_for_review",
			targetBranch: integrationBranch,
			approvalBranch: integrationBranch,
			sourceBranches: [branch1, branch2],
			steps: sequence.map((entry) => ({
				order: entry.order,
				workItemId: entry.workItemId,
				assignmentId: entry.assignmentId,
				sourceBranch: entry.branchName,
				targetBranch: integrationBranch,
				dependsOnBranches:
					entry.workItemId === "subtask-2"
						? [branch1]
						: [],
				reviewFocus: [...entry.ownedFiles],
			})),
			reviewStages:
				status === "blocked"
					? [
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
					  ]
					: [
							{
								id: "source_order",
								label: "Source order",
								status: "ready",
								summary: `Review the ordered source branches: ${branch1} -> ${branch2}.`,
							},
							{
								id: "integration_branch",
								label: "Integration branch",
								status: "ready",
								summary: `Inspect ${integrationBranch} as the only approval candidate for this coordinated run.`,
							},
							{
								id: "human_approval",
								label: "Human approval",
								status: "ready",
								summary: "Approval can proceed once the recorded branch order and review focus still match the artifact.",
							},
					  ],
			reviewChecklist:
				status === "blocked"
					? [
							"Do not approve this run until merge blockers are resolved.",
							"Discard or rerun with narrower ownership or explicit dependency ordering.",
					  ]
					: [
							`Review the integration branch ${integrationBranch} before approval.`,
							`Confirm the source branches landed in order: ${branch1} -> ${branch2}.`,
							"Approve only if the recorded branch set and merge order still match this artifact.",
					  ],
			conflictReview,
			handoffSummary:
				status === "blocked"
					? `Ordered handoff: ${branch1} (hello.ts) -> ${branch2} (hello.ts).`
					: `Ordered handoff: ${branch1} (hello.ts) -> ${branch2} after subtask-1 (utils.ts).`,
			summary:
				status === "blocked"
					? "Merge negotiation is blocked. Human review can inspect the evidence but should not approve this run."
					: `Integration branch ${integrationBranch} should absorb 2 source branches before human approval.`,
		},
		summary:
			status === "blocked"
				? "Merge order blocked because dependency-safe sequencing could not be proven."
				: "Merge order planned across 2 work item(s).",
	}
}

async function createCommittedBranch(
	repoPath: string,
	baseBranch: string,
	branch: string,
	fileName: string,
	insertText: string,
): Promise<void> {
	await runGit(repoPath, ["checkout", baseBranch])
	await runGit(repoPath, ["checkout", "-b", branch])
	fs.appendFileSync(path.join(repoPath, fileName), insertText, "utf8")
	await runGit(repoPath, ["add", fileName])
	await runGit(repoPath, ["commit", "-m", `review fixture ${branch}`])
}

async function createReviewRun(
	repoPath: string,
	runId: string,
	task: string,
	fileName: string,
	insertText: string,
	options: { createBranch?: boolean } = {},
): Promise<{ branch: string; mainBefore: string }> {
	const currentBranch = (await runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim()
	const baseRef = (await runGit(repoPath, ["rev-parse", "HEAD"])).trim()
	const branch = `swarm/${runId}/simple`
	const targetPath = path.join(repoPath, fileName)
	const mainBefore = fs.readFileSync(targetPath, "utf8")

	if (options.createBranch !== false) {
		await runGit(repoPath, ["checkout", "-b", branch])
		fs.appendFileSync(targetPath, insertText, "utf8")
		await runGit(repoPath, ["add", fileName])
		await runGit(repoPath, ["commit", "-m", `review fixture ${runId}`])
		await runGit(repoPath, ["checkout", currentBranch])
	}

	const runDir = ensureRunDir(repoPath, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task,
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
		taskContract: null,
		acceptanceGate: {
			passed: false,
			failedChecks: ["reviewer_not_passed"],
			warnings: [],
			evidenceSummary: {
				changedFiles: [fileName],
				createdFiles: [],
				scopedFiles: [],
				requiredTargetFiles: [],
			},
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
	await ensureReviewPack(repoPath, runId)
	return { branch, mainBefore }
}

async function createCoordinatedReviewRun(
	repoPath: string,
	runId: string,
	task: string,
	options: { blocked?: boolean } = {},
): Promise<{ branches: string[]; integrationBranch: string }> {
	const currentBranch = (await runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim()
	const baseRef = (await runGit(repoPath, ["rev-parse", "HEAD"])).trim()
	const branch1 = `swarm/${runId}/subtask-1`
	const branch2 = `swarm/${runId}/subtask-2`
	const integrationBranch = `swarm/${runId}/integration`

	await createCommittedBranch(repoPath, currentBranch, branch1, "hello.ts", "\n// coordinated review fixture hello\n")
	await createCommittedBranch(
		repoPath,
		currentBranch,
		branch2,
		options.blocked ? "hello.ts" : "utils.ts",
		options.blocked ? "\n// blocked merge fixture hello\n" : "\n// coordinated review fixture utils\n",
	)

	await runGit(repoPath, ["checkout", currentBranch])
	await runGit(repoPath, ["checkout", "-b", integrationBranch])
	if (!options.blocked) {
		await runGit(repoPath, ["merge", "--no-ff", "-m", `integrate ${branch1}`, branch1])
		await runGit(repoPath, ["merge", "--no-ff", "-m", `integrate ${branch2}`, branch2])
	}
	await runGit(repoPath, ["checkout", currentBranch])

	const branchNames = [branch1, branch2, integrationBranch]
	const runDir = ensureRunDir(repoPath, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task,
		workspace: repoPath,
		dryRun: false,
		allowDirty: false,
		startedAt: new Date().toISOString(),
		endedAt: new Date().toISOString(),
		durationMs: 1,
		status: "review_required",
		stopReason: "review_blocked",
		message: "Human review required.",
		complexity: "COMPLEX",
		pathChosen: "scoped",
		modelClassificationUsed: false,
		taskContract: {
			scope: {
				requiredTargetFiles: options.blocked ? ["hello.ts"] : ["hello.ts", "utils.ts"],
			},
		},
		acceptanceGate: {
			passed: false,
			failedChecks: ["reviewer_not_passed"],
			warnings: [],
			evidenceSummary: {
				changedFiles: options.blocked ? ["hello.ts"] : ["hello.ts", "utils.ts"],
				createdFiles: [],
				scopedFiles: [],
				requiredTargetFiles: options.blocked ? ["hello.ts"] : ["hello.ts", "utils.ts"],
			},
		},
		agentCount: 3,
		builderIterationCount: 2,
		reviewerVerdict: "NEEDS_WORK",
		changedFiles: options.blocked ? ["hello.ts"] : ["hello.ts", "utils.ts"],
		createdFiles: [],
		git: {
			baseRef,
			branches: branchNames,
		},
		mergeOrder: buildCoordinatedMergeOrderArtifact(runId, options.blocked ? "blocked" : "planned"),
		review: buildInitialReviewRecord(repoPath, runId, "review_required", false, branchNames),
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
	await ensureReviewPack(repoPath, runId)
	return { branches: branchNames, integrationBranch }
}

async function runReviewCli(
	rootDir: string,
	repoPath: string,
	args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return runCommandCapture(process.execPath, [path.join(rootDir, "dist", "swarm.js"), ...args, "--workspace", repoPath], {
		cwd: rootDir,
		timeoutMs: 120_000,
	})
}

export async function runReviewQueueHarness(rootDir = resolveRootDir()): Promise<ReviewQueueHarnessResult> {
	const { repoPath, cleanup } = await createTempRepoCopy(rootDir)
	const details: string[] = []

	try {
		const eligibleRunId = `task-review-approve-${Date.now()}`
		const blockedRunId = `task-review-blocked-${Date.now()}`
		const discardRunId = `task-review-discard-${Date.now()}`
		const multiReviewRunId = `task-review-multi-${Date.now()}`

		const eligibleFixture = await createCoordinatedReviewRun(repoPath, eligibleRunId, "coordinated review hello.ts + utils.ts")
		const blockedFixture = await createCoordinatedReviewRun(repoPath, blockedRunId, "blocked coordinated review", { blocked: true })
		enqueueWorkItem(repoPath, {
			task: "approve the queued follow-up after review",
			executionMode: "background_candidate",
			originRunId: eligibleRunId,
		})
		enqueueWorkItem(repoPath, {
			task: "run the scheduled queued follow-up later",
			scheduledAt: new Date(Date.now() + 60_000).toISOString(),
			originRunId: eligibleRunId,
		})
		const discardFixture = await createReviewRun(
			repoPath,
			discardRunId,
			"review utils.ts",
			"utils.ts",
			"\n// review discard fixture\n",
		)

		const listResult = await runReviewCli(rootDir, repoPath, ["review:list", "--json"])
		if (listResult.code !== 0) throw new Error(`review:list failed: ${listResult.stderr || listResult.stdout}`)
		const listed = JSON.parse(listResult.stdout) as Array<{ runId?: string }>
		const listingWorks = listed.some((item) => item.runId === eligibleRunId) && listed.some((item) => item.runId === discardRunId)
		details.push(`listed=${listed.length}`)

		const showResult = await runReviewCli(rootDir, repoPath, ["review:show", eligibleRunId, "--json"])
		if (showResult.code !== 0) throw new Error(`review:show failed: ${showResult.stderr || showResult.stdout}`)
		const shown = JSON.parse(showResult.stdout) as {
			cleanup?: { primaryBranch?: unknown }
			diffPreview?: unknown
			mergeNegotiation?: { status?: unknown; approvalBranch?: unknown; reviewChecklist?: unknown }
			queueFollowUp?: { state?: unknown; awaitingApprovalCount?: unknown; scheduledCount?: unknown; nextCommandHint?: unknown }
		}
		const showWorks =
			typeof shown.cleanup?.primaryBranch === "string" &&
			String(shown.cleanup.primaryBranch) === eligibleFixture.integrationBranch &&
			typeof shown.diffPreview === "string" &&
			String(shown.diffPreview).includes("coordinated review fixture hello") &&
			String(shown.diffPreview).includes("coordinated review fixture utils")
		const mergeNegotiationVisible =
			shown.mergeNegotiation?.status === "planned" &&
			shown.mergeNegotiation?.approvalBranch === eligibleFixture.integrationBranch &&
			Array.isArray(shown.mergeNegotiation?.reviewChecklist) &&
			(shown.mergeNegotiation?.reviewChecklist as unknown[]).length > 0
		const approvalPackageVisible =
			(shown as { approvalPackage?: { readiness?: unknown; requiredChecks?: unknown[]; focusAreas?: unknown[] } }).approvalPackage
				?.readiness === "ready" &&
			Array.isArray((shown as { approvalPackage?: { requiredChecks?: unknown[] } }).approvalPackage?.requiredChecks) &&
			Array.isArray((shown as { approvalPackage?: { focusAreas?: unknown[] } }).approvalPackage?.focusAreas)
		const queueFollowUpVisible =
			shown.queueFollowUp?.state === "awaiting_owner" &&
			shown.queueFollowUp?.awaitingApprovalCount === 1 &&
			shown.queueFollowUp?.scheduledCount === 1 &&
			typeof shown.queueFollowUp?.nextCommandHint === "string" &&
			String(shown.queueFollowUp.nextCommandHint).includes("queue:approve")

		const approveResult = await runReviewCli(rootDir, repoPath, ["review:approve", eligibleRunId, "--json"])
		if (approveResult.code !== 0) throw new Error(`review:approve failed: ${approveResult.stderr || approveResult.stdout}`)
		const approvedSummary = readRunSummary(resolveRunDir(repoPath, eligibleRunId))
		const approvedReview = approvedSummary ? (approvedSummary["review"] as Record<string, unknown> | undefined) : undefined
		const mainAfterApproveHello = fs.readFileSync(path.join(repoPath, "hello.ts"), "utf8")
		const mainAfterApproveUtils = fs.readFileSync(path.join(repoPath, "utils.ts"), "utf8")
		const approveWorks =
			approvedReview?.["decision"] === "approved" &&
			mainAfterApproveHello.includes("coordinated review fixture hello") &&
			mainAfterApproveUtils.includes("coordinated review fixture utils") &&
			!(await branchExistsInRepo(repoPath, eligibleFixture.integrationBranch)) &&
			!(await branchExistsInRepo(repoPath, eligibleFixture.branches[0] ?? "")) &&
			!(await branchExistsInRepo(repoPath, eligibleFixture.branches[1] ?? ""))

		const refuseResult = await runReviewCli(rootDir, repoPath, ["review:approve", blockedRunId, "--json"])
		const blockedMergeNegotiationRefusesApproval =
			refuseResult.code !== 0 &&
			`${refuseResult.stderr}${refuseResult.stdout}`.includes("Merge negotiation is blocked")

		const discardResult = await runReviewCli(rootDir, repoPath, ["review:discard", discardRunId, "--json"])
		if (discardResult.code !== 0) throw new Error(`review:discard failed: ${discardResult.stderr || discardResult.stdout}`)
		const discardedSummary = readRunSummary(resolveRunDir(repoPath, discardRunId))
		const discardedReview = discardedSummary ? (discardedSummary["review"] as Record<string, unknown> | undefined) : undefined
		const mainAfterDiscard = fs.readFileSync(path.join(repoPath, "utils.ts"), "utf8")
		const discardBranchExists = await branchExistsInRepo(repoPath, discardFixture.branch)
		const discardChangeDidNotLand = !mainAfterDiscard.includes("review discard fixture")
		details.push(
			`discard decision=${String(discardedReview?.["decision"] ?? "null")} branchExists=${String(discardBranchExists)} mainUntouched=${String(discardChangeDidNotLand)}`,
		)
		details.push(`blocked primary=${blockedFixture.integrationBranch} blockedRefused=${String(blockedMergeNegotiationRefusesApproval)}`)
		const discardWorks =
			discardedReview?.["decision"] === "discarded" &&
			discardChangeDidNotLand &&
			!discardBranchExists

		fs.writeFileSync(
			path.join(repoPath, ".swarmcoder.json"),
			`${JSON.stringify({ reviewPolicy: { requiredApprovals: 2, allowedReviewers: ["alice", "bob"] } }, null, 2)}\n`,
			"utf8",
		)
		await runGit(repoPath, ["add", ".swarmcoder.json"])
		await runGit(repoPath, ["commit", "-m", "review policy fixture"])
		const multiFixture = await createReviewRun(
			repoPath,
			multiReviewRunId,
			"multi reviewer review",
			"hello.ts",
			"\n// multi reviewer fixture\n",
		)
		const firstApproval = await runReviewCli(rootDir, repoPath, ["review:approve", multiReviewRunId, "--reviewer", "alice", "--json"])
		if (firstApproval.code !== 0) throw new Error(`first multi approval failed: ${firstApproval.stderr || firstApproval.stdout}`)
		const firstApprovalResult = JSON.parse(firstApproval.stdout) as { decision?: unknown }
		const firstApprovalSummary = readRunSummary(resolveRunDir(repoPath, multiReviewRunId))
		const firstApprovalReview = firstApprovalSummary ? (firstApprovalSummary["review"] as Record<string, unknown> | undefined) : undefined
		const duplicateApproval = await runReviewCli(rootDir, repoPath, ["review:approve", multiReviewRunId, "--reviewer", "alice", "--json"])
		const finalApproval = await runReviewCli(rootDir, repoPath, ["review:approve", multiReviewRunId, "--reviewer", "bob", "--json"])
		if (finalApproval.code !== 0) throw new Error(`final multi approval failed: ${finalApproval.stderr || finalApproval.stdout}`)
		const finalApprovalResult = JSON.parse(finalApproval.stdout) as { decision?: unknown }
		const finalApprovalSummary = readRunSummary(resolveRunDir(repoPath, multiReviewRunId))
		const finalApprovalReview = finalApprovalSummary ? (finalApprovalSummary["review"] as Record<string, unknown> | undefined) : undefined
		const multiReviewerPolicyWorks =
			firstApprovalResult.decision === "approval_recorded" &&
			firstApprovalReview?.["decision"] === "pending" &&
			Array.isArray(firstApprovalReview?.["approvedBy"]) &&
			(firstApprovalReview?.["approvedBy"] as unknown[]).includes("alice") &&
			duplicateApproval.code !== 0 &&
			finalApprovalResult.decision === "approved" &&
			finalApprovalReview?.["decision"] === "approved" &&
			Array.isArray(finalApprovalReview?.["approvedBy"]) &&
			(finalApprovalReview?.["approvedBy"] as unknown[]).includes("alice") &&
			(finalApprovalReview?.["approvedBy"] as unknown[]).includes("bob") &&
			!(await branchExistsInRepo(repoPath, multiFixture.branch))
		const multiReviewPackResult = await runReviewCli(rootDir, repoPath, ["review:show", multiReviewRunId, "--json"])
		if (multiReviewPackResult.code !== 0) throw new Error(`review:show multi failed: ${multiReviewPackResult.stderr || multiReviewPackResult.stdout}`)
		const multiReviewPack = JSON.parse(multiReviewPackResult.stdout) as {
			audit?: { history?: unknown[]; pendingReviewers?: unknown }
		}
		const operatorAuditVisible =
			Array.isArray(multiReviewPack.audit?.history) &&
			(multiReviewPack.audit?.history as Array<Record<string, unknown>>).some((entry) => entry["actor"] === "alice") &&
			(multiReviewPack.audit?.history as Array<Record<string, unknown>>).some((entry) => entry["actor"] === "bob") &&
			Array.isArray(multiReviewPack.audit?.pendingReviewers)
		details.push(
			`multi review=${String(finalApprovalReview?.["decision"] ?? "null")} duplicateCode=${String(duplicateApproval.code)} firstApprovedBy=${JSON.stringify(firstApprovalReview?.["approvedBy"] ?? null)}`,
		)

		return {
			listingWorks,
			showWorks,
			mergeNegotiationVisible,
			approvalPackageVisible,
			queueFollowUpVisible,
			approveWorks,
			blockedMergeNegotiationRefusesApproval,
			discardWorks,
			multiReviewerPolicyWorks,
			operatorAuditVisible,
			details,
		}
	} finally {
		cleanup()
	}
}

async function branchExistsInRepo(repoPath: string, branch: string): Promise<boolean> {
	const result = await runCommandCapture("git", ["-c", `safe.directory=${repoPath}`, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
		cwd: repoPath,
		timeoutMs: 15_000,
	})
	return result.code === 0
}

export function formatReviewQueueHarnessResult(result: ReviewQueueHarnessResult): string {
	return [
		`List review items: ${result.listingWorks ? "PASS" : "FAIL"}`,
		`Show normalized review pack: ${result.showWorks ? "PASS" : "FAIL"}`,
		`Merge negotiation visible: ${result.mergeNegotiationVisible ? "PASS" : "FAIL"}`,
		`Approval package visible: ${result.approvalPackageVisible ? "PASS" : "FAIL"}`,
		`Queue follow-up visible: ${result.queueFollowUpVisible ? "PASS" : "FAIL"}`,
		`Approve eligible review: ${result.approveWorks ? "PASS" : "FAIL"}`,
		`Blocked merge approval refused: ${result.blockedMergeNegotiationRefusesApproval ? "PASS" : "FAIL"}`,
		`Discard review and cleanup: ${result.discardWorks ? "PASS" : "FAIL"}`,
		`Multi-reviewer policy: ${result.multiReviewerPolicyWorks ? "PASS" : "FAIL"}`,
		`Operator audit visible: ${result.operatorAuditVisible ? "PASS" : "FAIL"}`,
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runReviewQueueHarness()
	console.log(formatReviewQueueHarnessResult(result))
	process.exit(
			result.listingWorks &&
			result.showWorks &&
			result.mergeNegotiationVisible &&
			result.approvalPackageVisible &&
			result.queueFollowUpVisible &&
			result.approveWorks &&
			result.blockedMergeNegotiationRefusesApproval &&
			result.discardWorks &&
			result.multiReviewerPolicyWorks &&
			result.operatorAuditVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:review:queue] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
