import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { evaluateRepoReadiness } from "../run/AdmissionGate"
import { buildInitialReviewRecord, ensureReviewPack, listPendingReviewItems } from "../run/ReviewQueue"
import { ensureRunDir, readRunSummary, resolveRunDir, writeRunSummary } from "../run/RunArtifacts"
import {
	buildShellLaunchSpec,
	buildShellReviewCommandSpec,
	type ShellLaunchSpec,
} from "../shell/ThinShell"

type ReviewListEntry = {
	runId: string
	label: string
}

type ShellSmokeState = {
	output: string
	commandPreview: string
	runtimeText: string
	summaryText: string
	forensicsText: string
	reviewItems: ReviewListEntry[]
	selectedReviewId: string
	selectedReviewText: string
	workspace: string
}

export type ThinShellSmokeDriver = {
	repoRoot: string
	getState: () => ShellSmokeState
	refreshPanels: (workspace: string, preferredRunId?: string) => Promise<void>
	launchCliSpec: (spec: ShellLaunchSpec) => Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

export type ThinShellSmokeResult = {
	passed: boolean
	ownerSafeDefaultWorkspace: boolean
	session18TaskLaunch: boolean
	session18SummarySurfaced: boolean
	session18ForensicsSurfaced: boolean
	session137CommandPreviewSurfaced: boolean
	session249RuntimeSummarySurfaced: boolean
	session19ReviewInboxSurfaced: boolean
	session19DiscardAction: boolean
	workspace: string
	session18SummaryPath: string | null
	reviewRunId: string | null
	details: string[]
	error: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

async function runCommandCapture(
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs?: number } = { cwd: process.cwd() },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	const timeoutMs = options.timeoutMs ?? 30_000
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		})

		let stdout = ""
		let stderr = ""
		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk)
		})
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk)
		})

		const timeout = setTimeout(() => {
			if (process.platform === "win32" && child.pid) {
				try {
					spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
				} catch {
					// ignore timeout cleanup failures
				}
				return
			}
			try {
				child.kill("SIGTERM")
			} catch {
				// ignore timeout cleanup failures
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
				stdout,
				stderr,
			})
		})
	})
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

function createTempRepoCopy(rootDir: string): { repoPath: string; cleanup: () => void } {
	const repoPath = path.join(rootDir, "verification", `.tmp-vscode-shell-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`)
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

async function createPendingReviewRun(
	repoPath: string,
	runId: string,
): Promise<{
	runId: string
	branch: string
}> {
	const currentBranch = (await runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim()
	const baseRef = (await runGit(repoPath, ["rev-parse", "HEAD"])).trim()
	const branch = `swarm/${runId}/simple`
	const fileName = "hello.ts"
	const targetPath = path.join(repoPath, fileName)

	await runGit(repoPath, ["checkout", "-b", branch])
	fs.appendFileSync(targetPath, "\n// thin shell smoke review fixture\n", "utf8")
	await runGit(repoPath, ["add", fileName])
	await runGit(repoPath, ["commit", "-m", `review fixture ${runId}`])
	await runGit(repoPath, ["checkout", currentBranch])

	const runDir = ensureRunDir(repoPath, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "review thin shell smoke fixture",
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
	return { runId, branch }
}

export async function runThinShellSmoke(driver: ThinShellSmokeDriver): Promise<ThinShellSmokeResult> {
	const details: string[] = []
	const { repoPath, cleanup } = createTempRepoCopy(driver.repoRoot)

	try {
		const initialState = driver.getState()
		const initialWorkspace = initialState.workspace.trim()
		const initialWorkspaceReadiness = initialWorkspace ? await evaluateRepoReadiness(initialWorkspace) : null
		const ownerSafeDefaultWorkspace =
			initialWorkspace.length === 0 || initialWorkspaceReadiness?.decision !== "refuse"
		details.push(
			`initial workspace=${initialWorkspace || "(empty)"} readiness=${initialWorkspaceReadiness?.decision ?? "prompt"}`,
		)

		const dryRunTask = "add a brief comment to hello.ts"
		const taskSpec = buildShellLaunchSpec(driver.repoRoot, dryRunTask, repoPath, { dryRun: true })
		const taskLaunch = await driver.launchCliSpec(taskSpec)
		await driver.refreshPanels(repoPath)
		const afterTask = driver.getState()
		const launchedDryRunCommand =
			afterTask.output.includes("--dryRun") &&
			(afterTask.output.includes("[Swarm] Final status: review_required") ||
				afterTask.output.includes("[Shell] CLI exited with code 2."))

		const session18TaskLaunch = taskLaunch.code === 2 && launchedDryRunCommand
		const session18SummarySurfaced =
			afterTask.summaryText.includes("Artifact:") && afterTask.summaryText.includes('"status": "review_required"')
		const session18ForensicsSurfaced = afterTask.forensicsText.includes("Likely failure bucket:")
		const commandSurfaceText = `${afterTask.commandPreview}\n${afterTask.output}`
		const session137CommandPreviewSurfaced =
			commandSurfaceText.includes('queenshift "add a brief comment to hello.ts"') &&
			commandSurfaceText.includes("--dryRun") &&
			commandSurfaceText.includes("--workspace") &&
			commandSurfaceText.includes("hello.ts")
		const session249RuntimeSummarySurfaced =
			afterTask.runtimeText.includes("Runtime summary:") &&
			afterTask.runtimeText.includes("Visible progress:") &&
			afterTask.runtimeText.includes("Summary artifact:") &&
			afterTask.runtimeText.includes("Next step: queenshift review:list")
		details.push(
			`session18 exit=${String(taskLaunch.code)} summary=${String(session18SummarySurfaced)} forensics=${String(session18ForensicsSurfaced)} commandPreview=${String(session137CommandPreviewSurfaced)} runtimeSummary=${String(session249RuntimeSummarySurfaced)} preview=${afterTask.commandPreview}`,
		)

		const reviewRun = await createPendingReviewRun(repoPath, `task-shell-review-${Date.now()}`)
		await driver.refreshPanels(repoPath, reviewRun.runId)
		const reviewState = driver.getState()
		const session19ReviewInboxSurfaced =
			reviewState.reviewItems.some((item) => item.runId === reviewRun.runId) &&
			reviewState.selectedReviewId === reviewRun.runId &&
			reviewState.selectedReviewText.includes("Diff preview:")
		details.push(`review inbox items=${String(reviewState.reviewItems.length)} selected=${reviewState.selectedReviewId || "(none)"}`)

		const discardSpec = buildShellReviewCommandSpec(driver.repoRoot, "review:discard", repoPath, reviewRun.runId)
		const discardLaunch = await driver.launchCliSpec(discardSpec)
		await driver.refreshPanels(repoPath, reviewRun.runId)

		const updatedSummary = readRunSummary(resolveRunDir(repoPath, reviewRun.runId))
		const review = asRecord(asRecord(updatedSummary)?.["review"])
		const pendingAfterDiscard = listPendingReviewItems(repoPath).some((item) => item.runId === reviewRun.runId)
		const session19DiscardAction =
			discardLaunch.code === 0 && review?.["decision"] === "discarded" && pendingAfterDiscard === false
		details.push(`discard exit=${String(discardLaunch.code)} pendingAfterDiscard=${String(pendingAfterDiscard)}`)

		return {
			passed:
				ownerSafeDefaultWorkspace &&
				session18TaskLaunch &&
				session18SummarySurfaced &&
				session18ForensicsSurfaced &&
				session137CommandPreviewSurfaced &&
				session249RuntimeSummarySurfaced &&
				session19ReviewInboxSurfaced &&
				session19DiscardAction,
			ownerSafeDefaultWorkspace,
			session18TaskLaunch,
			session18SummarySurfaced,
			session18ForensicsSurfaced,
			session137CommandPreviewSurfaced,
			session249RuntimeSummarySurfaced,
			session19ReviewInboxSurfaced,
			session19DiscardAction,
			workspace: repoPath,
			session18SummaryPath: afterTask.summaryText.startsWith("Artifact: ")
				? afterTask.summaryText.split(/\r?\n/g)[0]?.replace(/^Artifact:\s+/u, "") ?? null
				: null,
			reviewRunId: reviewRun.runId,
			details,
			error: null,
		}
	} catch (err) {
		return {
			passed: false,
			ownerSafeDefaultWorkspace: false,
			session18TaskLaunch: false,
			session18SummarySurfaced: false,
			session18ForensicsSurfaced: false,
			session137CommandPreviewSurfaced: false,
			session249RuntimeSummarySurfaced: false,
			session19ReviewInboxSurfaced: false,
			session19DiscardAction: false,
			workspace: repoPath,
			session18SummaryPath: null,
			reviewRunId: null,
			details,
			error: err instanceof Error ? err.message : String(err),
		}
	} finally {
		cleanup()
	}
}
