import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import type { CheckpointArtifact } from "../planning/Checkpoints"
import { readRetrySnapshot } from "../planning/RetryPlanner"
import type { DatabaseService } from "../db/DatabaseService"
import { formatQueenshiftWorkspaceCommand } from "../cli/CommandSurface"
import { createFailureNarrative } from "./FailureNarrative"
import { readCheckpointArtifact, writeRunSummary } from "./RunArtifacts"
import { listProtectedPendingReviewBranches } from "./ReviewQueue"

type GitWorktreeInfo = {
	path: string
	branch: string | null
}

export type RecoveryInventory = {
	orphanedWorktrees: string[]
	orphanedSwarmBranches: string[]
	staleTaskIds: string[]
	staleTmpEntries: string[]
	incompleteRunArtifacts: string[]
}

export type RecoveryReport = RecoveryInventory & {
	reconciledTaskIds: string[]
	removedWorktrees: string[]
	removedBranches: string[]
	removedTmpEntries: string[]
	recoveredRunArtifacts: string[]
	warnings: string[]
}

async function runGit(repoPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	const swarmTmpDir = path.join(repoPath, ".swarm", "tmp")
	fs.mkdirSync(swarmTmpDir, { recursive: true })
	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
	const stdoutPath = path.join(swarmTmpDir, `recovery-${stamp}.stdout.log`)
	const stderrPath = path.join(swarmTmpDir, `recovery-${stamp}.stderr.log`)
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
		const code = await new Promise<number | null>((resolve, reject) => {
			const child = spawn("git", ["-c", `safe.directory=${repoPath}`, ...args], {
				cwd: repoPath,
				windowsHide: true,
				stdio: ["ignore", stdoutFd, stderrFd],
			})
			child.once("error", reject)
			child.once("close", (exitCode) => resolve(typeof exitCode === "number" ? exitCode : null))
		})

		const stdout = readFile(stdoutPath)
		const stderr = readFile(stderrPath)
		if (code !== 0) {
			throw new Error(`git ${args.join(" ")} failed (exit ${code ?? "null"})\n${stderr || stdout}`.trim())
		}

		return { stdout, stderr }
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

async function listGitWorktrees(repoPath: string): Promise<GitWorktreeInfo[]> {
	const { stdout } = await runGit(repoPath, ["worktree", "list", "--porcelain"])
	const blocks = stdout.split(/\r?\n\r?\n/g).map((block) => block.trim()).filter(Boolean)
	return blocks.map((block) => {
		let worktreePath = ""
		let branch: string | null = null
		for (const line of block.split(/\r?\n/g)) {
			if (line.startsWith("worktree ")) worktreePath = line.slice("worktree ".length).trim()
			if (line.startsWith("branch ")) branch = line.slice("branch refs/heads/".length).trim()
		}
		return { path: worktreePath, branch: branch && branch !== "(detached HEAD)" ? branch : null }
	})
}

async function listSwarmBranches(repoPath: string): Promise<string[]> {
	try {
		const { stdout } = await runGit(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads/swarm"])
		return stdout
			.split(/\r?\n/g)
			.map((line) => line.trim())
			.filter(Boolean)
	} catch {
		return []
	}
}

export function resolveOwnedWorktreeBase(workspace: string, env: Record<string, string | undefined> = process.env): string {
	const override = (env["SWARM_WORKTREE_BASE"] ?? "").trim()
	return override ? path.resolve(override) : path.join(path.dirname(workspace), ".swarm-worktrees")
}

function readRecoveredCheckpointHint(runDir: string): {
	checkpoints: CheckpointArtifact | null
	retrySnapshotPath: string | null
	recoveryMode: string
	continuationSurface: string
	completedWorkItems: string[]
	remainingWorkItems: string[]
	stageSummary: Record<string, unknown> | null
} | null {
	const checkpoints = readCheckpointArtifact<CheckpointArtifact>(runDir)
	const retrySnapshotPath = checkpoints?.latestRetrySnapshotPath ?? path.join(runDir, "retry-snapshot.json")
	const retrySnapshot =
		retrySnapshotPath && fs.existsSync(retrySnapshotPath)
			? readRetrySnapshot(retrySnapshotPath)
			: null
	if (!checkpoints && !retrySnapshot?.recoveryState) return null
	return {
		checkpoints: checkpoints ?? null,
		retrySnapshotPath: retrySnapshotPath && fs.existsSync(retrySnapshotPath) ? retrySnapshotPath : null,
		recoveryMode:
			retrySnapshot?.recoveryState?.mode ??
			((checkpoints?.completedWorkItems.length ?? 0) > 0 && (checkpoints?.remainingWorkItems.length ?? 0) > 0
				? "resume_remaining_work"
				: "retry_same_snapshot"),
		continuationSurface: retrySnapshot?.recoveryState?.continuationSurface ?? "retry_planner_checkpoint_artifacts",
		completedWorkItems: retrySnapshot?.recoveryState?.completedWorkItems ?? checkpoints?.completedWorkItems ?? [],
		remainingWorkItems: retrySnapshot?.recoveryState?.remainingWorkItems ?? checkpoints?.remainingWorkItems ?? [],
		stageSummary: (retrySnapshot?.recoveryState?.stageSummary as Record<string, unknown> | null | undefined) ?? null,
	}
}

export async function inventoryRecoverableState(workspace: string, db?: DatabaseService): Promise<RecoveryInventory> {
	const baseDir = resolveOwnedWorktreeBase(workspace)
	const warnings: string[] = []
	let worktrees: GitWorktreeInfo[] = []
	try {
		worktrees = await listGitWorktrees(workspace)
	} catch (err) {
		warnings.push(err instanceof Error ? err.message : String(err))
	}

	const orphanedWorktrees = worktrees
		.map((worktree) => path.resolve(worktree.path))
		.filter((worktreePath) => worktreePath !== path.resolve(workspace))
		.filter((worktreePath) => worktreePath.startsWith(path.resolve(baseDir)))

	const activeBranches = new Set(worktrees.map((worktree) => worktree.branch).filter((branch): branch is string => Boolean(branch)))
	const protectedReviewBranches = new Set(listProtectedPendingReviewBranches(workspace))
	const orphanedSwarmBranches = (await listSwarmBranches(workspace)).filter(
		(branch) => !activeBranches.has(branch) && !protectedReviewBranches.has(branch),
	)
	const staleTaskIds = db?.all<{ id: string }>("SELECT id FROM tasks WHERE status = 'in_progress'").map((row) => row.id) ?? []

	const tmpDir = path.join(workspace, ".swarm", "tmp")
	const staleTmpEntries = fs.existsSync(tmpDir)
		? fs.readdirSync(tmpDir).map((entry) => path.join(tmpDir, entry))
		: []

	const runsDir = path.join(workspace, ".swarm", "runs")
	const incompleteRunArtifacts = fs.existsSync(runsDir)
		? fs
				.readdirSync(runsDir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => path.join(runsDir, entry.name))
				.filter((runDir) => !fs.existsSync(path.join(runDir, "summary.json")))
		: []

	void warnings
	return {
		orphanedWorktrees,
		orphanedSwarmBranches,
		staleTaskIds,
		staleTmpEntries,
		incompleteRunArtifacts,
	}
}

export async function reconcileOwnedState(workspace: string, db?: DatabaseService): Promise<RecoveryReport> {
	const inventory = await inventoryRecoverableState(workspace, db)
	const warnings: string[] = []
	const removedWorktrees: string[] = []
	const removedBranches: string[] = []
	const removedTmpEntries: string[] = []
	const recoveredRunArtifacts: string[] = []
	const reconciledTaskIds: string[] = []

	for (const worktreePath of inventory.orphanedWorktrees) {
		try {
			await runGit(workspace, ["worktree", "remove", "--force", worktreePath])
			removedWorktrees.push(worktreePath)
		} catch (err) {
			warnings.push(err instanceof Error ? err.message : String(err))
			try {
				if (fs.existsSync(worktreePath)) {
					fs.rmSync(worktreePath, { recursive: true, force: true })
					removedWorktrees.push(worktreePath)
				}
			} catch (innerErr) {
				warnings.push(innerErr instanceof Error ? innerErr.message : String(innerErr))
			}
		}
	}

	try {
		await runGit(workspace, ["worktree", "prune"])
	} catch (err) {
		warnings.push(err instanceof Error ? err.message : String(err))
	}

	const activeBranchesAfterCleanup = new Set(
		(await listGitWorktrees(workspace))
			.map((worktree) => worktree.branch)
			.filter((branch): branch is string => Boolean(branch)),
	)
	const orphanedBranchesAfterCleanup = (await listSwarmBranches(workspace)).filter((branch) => !activeBranchesAfterCleanup.has(branch))

	for (const branch of orphanedBranchesAfterCleanup) {
		try {
			await runGit(workspace, ["branch", "-D", branch])
			removedBranches.push(branch)
		} catch (err) {
			warnings.push(err instanceof Error ? err.message : String(err))
		}
	}

	for (const entry of inventory.staleTmpEntries) {
		try {
			fs.rmSync(entry, { recursive: true, force: true })
			removedTmpEntries.push(entry)
		} catch (err) {
			warnings.push(err instanceof Error ? err.message : String(err))
		}
	}

	for (const runDir of inventory.incompleteRunArtifacts) {
		try {
			const recoveredHint = readRecoveredCheckpointHint(runDir)
			const runId = path.basename(runDir)
			const summaryPath = path.join(runDir, "summary.json")
			const checkpointArtifactPath = recoveredHint?.checkpoints ? path.join(runDir, "checkpoints.json") : null
			const safestNextStep =
				recoveredHint?.recoveryMode === "resume_remaining_work"
					? `resume only the remaining bounded work -> ${formatQueenshiftWorkspaceCommand(["resume:show", runId], workspace)}`
					: `inspect the recovered resume candidate -> ${formatQueenshiftWorkspaceCommand(["resume:show", runId], workspace)}`
			const recoveryFooting =
				recoveredHint?.recoveryMode === "resume_remaining_work"
					? `Completed work items stay preserved; remaining work items: ${recoveredHint.remainingWorkItems.join(", ") || "(none recorded)"}`
					: `Recovery mode is ${recoveredHint?.recoveryMode ?? "retry_same_snapshot"} and the latest bounded snapshot stays authoritative.`
			const failureNarrative = createFailureNarrative({
				whatFailed: `Recovered incomplete run artifact (${runId})`,
				whyItStopped:
					recoveredHint?.recoveryMode === "resume_remaining_work"
						? "Startup reconciliation found an incomplete bounded run and failed it closed instead of guessing completion."
						: "Startup reconciliation found an incomplete run artifact and recorded a truthful failed summary for follow-up.",
				safestNextStep,
				recoveryFooting,
				authoritativeArtifacts: [summaryPath, checkpointArtifactPath, recoveredHint?.retrySnapshotPath ?? null],
			})
			writeRunSummary(runDir, {
				taskId: runId,
				status: "failed",
				stopReason: "operator_abort",
				message:
					recoveredHint?.recoveryMode === "resume_remaining_work"
						? "Recovered incomplete run artifact during startup reconciliation; resume only the remaining bounded work."
						: "Recovered incomplete run artifact during startup reconciliation.",
				recovered: true,
				endedAt: new Date().toISOString(),
				recovery: recoveredHint
					? {
							startupRecovered: true,
							recoveryMode: recoveredHint.recoveryMode,
							continuationSurface: recoveredHint.continuationSurface,
							completedWorkItems: recoveredHint.completedWorkItems,
							remainingWorkItems: recoveredHint.remainingWorkItems,
							checkpointArtifactPath,
							retrySnapshotPath: recoveredHint.retrySnapshotPath,
							stageSummary: recoveredHint.stageSummary,
							failureNarrative,
						}
					: {
							startupRecovered: true,
							failureNarrative,
						},
			})
			recoveredRunArtifacts.push(runDir)
		} catch (err) {
			warnings.push(err instanceof Error ? err.message : String(err))
		}
	}

	if (db) {
		for (const taskId of inventory.staleTaskIds) {
			try {
				db.run("UPDATE tasks SET status = ?, finished_at = ? WHERE id = ? AND status = 'in_progress'", [
					"failed",
					new Date().toISOString(),
					taskId,
				])
				reconciledTaskIds.push(taskId)
			} catch (err) {
				warnings.push(err instanceof Error ? err.message : String(err))
			}
		}
	}

	return {
		...inventory,
		reconciledTaskIds,
		removedWorktrees,
		removedBranches,
		removedTmpEntries,
		recoveredRunArtifacts,
		warnings,
	}
}
