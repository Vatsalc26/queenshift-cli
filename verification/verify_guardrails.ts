import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import { DatabaseService } from "../src/db/DatabaseService"
import { Orchestrator } from "../src/Orchestrator"
import { formatForensicsReport, type SummaryLike } from "../src/run/Forensics"
import { acquireWorkspaceRunLock, releaseWorkspaceRunLock } from "../src/run/RunGuardrails"
import { findLatestRunSummary } from "../src/run/RunArtifacts"
import { approveQueuedWorkItem, buildWorkQueueSummary, enqueueWorkItem } from "../src/run/WorkQueue"
import { validateExecutorAdapterCatalog } from "../src/run/VerificationProfileCatalog"
import { resolveRuntimeConfig } from "../src/run/RuntimeConfig"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type GuardrailsHarnessResult = {
	modelCallCeilingStopsRun: boolean
	runtimeCeilingStopsRun: boolean
	usageBudgetCeilingStopsRun: boolean
	ceilingArtifactsReported: boolean
	fastLaneVisible: boolean
	agentWaitCoversProviderTimeout: boolean
	workspaceSingleRunLock: boolean
	secondLiveRunRefusedGracefully: boolean
	backgroundQueueApprovalBoundary: boolean
	scheduledQueueBoundary: boolean
	adapterContractsBounded: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

async function createTempRepoCopy(rootDir: string, label: string): Promise<{ repoPath: string; cleanup: () => void }> {
	return createTempTestRepoCopy(rootDir, label, ".tmp-guardrails")
}

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
	const previous = new Map<string, string | undefined>()
	for (const [key, value] of Object.entries(overrides)) {
		previous.set(key, process.env[key])
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}

	return fn().finally(() => {
		for (const [key, value] of previous.entries()) {
			if (value === undefined) delete process.env[key]
			else process.env[key] = value
		}
	})
}

async function runCommandCapture(
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs: number },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
	const stdoutPath = path.join(options.cwd, `.tmp-guardrail-${stamp}.stdout.log`)
	const stderrPath = path.join(options.cwd, `.tmp-guardrail-${stamp}.stderr.log`)
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
			}, options.timeoutMs)
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

function readSummary(summaryPath: string): SummaryLike & Record<string, unknown> {
	return JSON.parse(fs.readFileSync(summaryPath, "utf8")) as SummaryLike & Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

async function waitForLatestSummaryPath(workspace: string, timeoutMs = 2_000): Promise<string | null> {
	const startedAt = Date.now()
	while (Date.now() - startedAt < timeoutMs) {
		const summaryPath = findLatestRunSummary(workspace)
		if (summaryPath && fs.existsSync(summaryPath)) return summaryPath
		await delay(100)
	}
	const finalSummaryPath = findLatestRunSummary(workspace)
	return finalSummaryPath && fs.existsSync(finalSummaryPath) ? finalSummaryPath : null
}

export async function runGuardrailsHarness(rootDir = resolveRootDir()): Promise<GuardrailsHarnessResult> {
	const details: string[] = []

	const modelRepo = await createTempRepoCopy(rootDir, "model")
	const runtimeRepo = await createTempRepoCopy(rootDir, "runtime")
	const usageRepo = await createTempRepoCopy(rootDir, "usage")
	const lockRepo = await createTempRepoCopy(rootDir, "lock")

	try {
		const modelCallCeilingStopsRun = await withEnv(
			{
				SWARM_SMALL_TASK_MAX_MODEL_CALLS: "1",
				SWARM_MAX_MODEL_CALLS: "10",
				SWARM_SMALL_TASK_MAX_ESTIMATED_TOKENS: "25000",
				SWARM_MAX_ESTIMATED_TOKENS: "50000",
			},
			async () => {
				DatabaseService.reset()
				const db = DatabaseService.getInstance(path.join(modelRepo.repoPath, ".swarm", "swarmcoder.db"))
				try {
					const orchestrator = new Orchestrator(modelRepo.repoPath, db, true)
					const result = await orchestrator.run("add a brief comment to hello.ts")
					details.push(`model stopReason=${result.stopReason}`)
					return result.stopReason === "model_call_ceiling"
				} finally {
					db.close()
					DatabaseService.reset()
				}
			},
		)

		const runtimeCeilingStopsRun = await withEnv(
			{
				SWARM_RUN_CEILING_MS: "50",
				SWARM_MAX_MODEL_CALLS: "10",
				SWARM_MAX_ESTIMATED_TOKENS: "50000",
			},
			async () => {
				DatabaseService.reset()
				const db = DatabaseService.getInstance(path.join(runtimeRepo.repoPath, ".swarm", "swarmcoder.db"))
				try {
					const orchestrator = new Orchestrator(runtimeRepo.repoPath, db, true)
					const harness = orchestrator as unknown as {
						runSimpleWithRetry: (...args: unknown[]) => Promise<{ status: "done"; message: string; stopReason: "success" }>
						abortError: Error | null
					}
					harness.runSimpleWithRetry = async () => {
						await delay(120)
						if (harness.abortError) throw harness.abortError
						return { status: "done", message: "unexpected success", stopReason: "success" }
					}
					const result = await orchestrator.run("add a brief comment to hello.ts")
					details.push(`runtime stopReason=${result.stopReason}`)
					return result.stopReason === "run_duration_ceiling"
				} finally {
					db.close()
					DatabaseService.reset()
				}
			},
		)

		const usageBudgetCeilingStopsRun = await withEnv(
			{
				SWARM_SMALL_TASK_MAX_ESTIMATED_TOKENS: "1",
				SWARM_MAX_ESTIMATED_TOKENS: "50000",
				SWARM_SMALL_TASK_MAX_MODEL_CALLS: "6",
				SWARM_MAX_MODEL_CALLS: "10",
			},
			async () => {
				DatabaseService.reset()
				const db = DatabaseService.getInstance(path.join(usageRepo.repoPath, ".swarm", "swarmcoder.db"))
				try {
					const orchestrator = new Orchestrator(usageRepo.repoPath, db, true)
					const result = await orchestrator.run("add a brief comment to hello.ts")
					details.push(`usage stopReason=${result.stopReason}`)
					return result.stopReason === "usage_budget_ceiling"
				} finally {
					db.close()
					DatabaseService.reset()
				}
			},
		)

		const agentWaitCoversProviderTimeout = await withEnv(
			{
				GEMINI_CLI_TIMEOUT_MS: "420000",
				SWARM_AGENT_WAIT_TIMEOUT_MS: "300000",
				SWARM_WATCHDOG_INTERVAL_MS: "30000",
				SWARM_HEARTBEAT_INTERVAL_MS: "15000",
			},
			async () => {
				const runtimeConfig = resolveRuntimeConfig(process.env as Record<string, string | undefined>)
				const expectedMinimum =
					runtimeConfig.providerCallTimeoutMs +
					runtimeConfig.watchdogCheckIntervalMs +
					runtimeConfig.heartbeatIntervalMs
				details.push(
					`agentWait=${runtimeConfig.agentWaitTimeoutMs} provider=${runtimeConfig.providerCallTimeoutMs} minimum=${expectedMinimum}`,
				)
				return runtimeConfig.agentWaitTimeoutMs >= expectedMinimum
			},
		)

		const modelSummaryPath = path.join(modelRepo.repoPath, ".swarm", "runs")
		const modelSummaryDir = fs
			.readdirSync(modelSummaryPath, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => path.join(modelSummaryPath, entry.name))
			.sort((a, b) => fs.statSync(path.join(b, "summary.json")).mtimeMs - fs.statSync(path.join(a, "summary.json")).mtimeMs)[0]
		const modelSummary = modelSummaryDir ? readSummary(path.join(modelSummaryDir, "summary.json")) : null
		const ceilingArtifactsReported =
			Boolean(modelSummary) &&
			(modelSummary?.stopReason === "model_call_ceiling") &&
			((modelSummary?.guardrails as Record<string, unknown> | undefined)?.["modelCalls"] as Record<string, unknown> | undefined)?.[
				"reached"
			] === true &&
			formatForensicsReport(modelSummaryDir ? path.join(modelSummaryDir, "summary.json") : null, modelSummary).includes("Guardrails:")
		const fastLane = modelSummary ? ((modelSummary.fastLane as Record<string, unknown> | undefined) ?? null) : null
		const fastLaneVisible =
			Boolean(fastLane) &&
			fastLane?.["laneId"] === "simple_task_fast_lane" &&
			fastLane?.["predictability"] === "high" &&
			fastLane?.["expectedWorkItems"] === 1 &&
			fastLane?.["expectedBuilderCount"] === 1 &&
			fastLane?.["mergeMode"] === "not_applicable" &&
			fastLane?.["reviewMode"] === "single_file_bounded"
		details.push(`fastLane=${fastLaneVisible ? "visible" : "missing"}`)

		DatabaseService.reset()
		const lockDbPath = path.join(lockRepo.repoPath, ".swarm", "swarmcoder.db")
		const lockDb = DatabaseService.getInstance(lockDbPath)
		let workspaceSingleRunLock = false
		let secondLiveRunRefusedGracefully = false
		let backgroundQueueApprovalBoundary = false
		let scheduledQueueBoundary = false
		try {
			const lock = acquireWorkspaceRunLock(lockDb, lockRepo.repoPath, {
				taskId: "task-active-lock",
				task: "existing live run",
				pid: process.pid,
			})
			workspaceSingleRunLock = lock.acquired

			const cliResult = await runCommandCapture(
				process.execPath,
				[path.join(rootDir, "dist", "swarm.js"), "--task", "add a brief comment to hello.ts", "--workspace", lockRepo.repoPath],
				{ cwd: rootDir, timeoutMs: 30_000 },
			)

			const latestLockSummaryPath = await waitForLatestSummaryPath(lockRepo.repoPath)
			const latestLockSummary = latestLockSummaryPath ? readSummary(latestLockSummaryPath) : null
			const lockForensics = formatForensicsReport(latestLockSummaryPath ?? null, latestLockSummary)
			const workspaceLock = asRecord(asRecord(latestLockSummary?.guardrails)?.workspaceRunLock)
			const cliOutput = `${cliResult.stdout}\n${cliResult.stderr}`.toLowerCase()
			const lockMessageSurfaced =
				cliOutput.includes("active live run lock") || cliOutput.includes("workspace already has an active live run lock")
			const summaryShowsLock =
				latestLockSummary?.stopReason === "workspace_run_locked" &&
				workspaceLock?.blockedByActiveRun === true &&
				workspaceLock?.blockingTaskId === "task-active-lock" &&
				lockForensics.includes("Workspace lock: blocked by active live run task-active-lock")
			secondLiveRunRefusedGracefully =
				cliResult.code === 1 &&
				(summaryShowsLock || lockMessageSurfaced)
			details.push(`lock cli code=${String(cliResult.code)}`)
			if (!secondLiveRunRefusedGracefully) {
				details.push(`lock summary path=${latestLockSummaryPath ?? "null"}`)
				details.push(`lock stopReason=${String(latestLockSummary?.stopReason ?? "null")}`)
				details.push(`lock stdout=${cliResult.stdout.replace(/\s+/g, " ").trim().slice(0, 240)}`)
				details.push(`lock stderr=${cliResult.stderr.replace(/\s+/g, " ").trim().slice(0, 240)}`)
			}

			releaseWorkspaceRunLock(lockDb, lock.acquired ? lock.record : null)
		} finally {
			lockDb.close()
			DatabaseService.reset()
		}

		const queued = enqueueWorkItem(lockRepo.repoPath, {
			task: "add a guarded note to hello.ts",
			executionMode: "background_candidate",
		})
		const queueBeforeApproval = buildWorkQueueSummary(lockRepo.repoPath)
		const approvalResult = approveQueuedWorkItem(lockRepo.repoPath, queued.item.queueId, { approvedBy: "owner-fixture" })
		const queueAfterApproval = buildWorkQueueSummary(lockRepo.repoPath)
		backgroundQueueApprovalBoundary =
			queueBeforeApproval.readyCount === 0 &&
			queueBeforeApproval.awaitingApprovalCount === 1 &&
			queueBeforeApproval.nextAwaitingApprovalItem?.queueId === queued.item.queueId &&
			approvalResult.approved === true &&
			queueAfterApproval.readyCount === 1 &&
			queueAfterApproval.awaitingApprovalCount === 0 &&
			queueAfterApproval.nextReadyItem?.queueId === queued.item.queueId
		details.push(`backgroundQueue boundary=${String(backgroundQueueApprovalBoundary)}`)

		const scheduledAt = new Date(Date.now() + 60_000).toISOString()
		const scheduled = enqueueWorkItem(lockRepo.repoPath, {
			task: "run this scheduled queue item later",
			scheduledAt,
		})
		const queueBeforeSchedule = buildWorkQueueSummary(lockRepo.repoPath)
		const queueAfterScheduleDue = buildWorkQueueSummary(lockRepo.repoPath, Date.parse(scheduledAt) + 1)
		scheduledQueueBoundary =
			queueBeforeSchedule.scheduledCount >= 1 &&
			queueBeforeSchedule.readyCount === 1 &&
			queueBeforeSchedule.nextScheduledItem?.queueId === scheduled.item.queueId &&
			queueBeforeSchedule.state === "ready" &&
			queueBeforeSchedule.statusMessage.includes("scheduled for") &&
			queueAfterScheduleDue.readyCount >= 2 &&
			queueAfterScheduleDue.nextReadyItem?.queueId === queued.item.queueId
		details.push(`scheduledQueue boundary=${String(scheduledQueueBoundary)}`)

		const adapterCatalogIssues = validateExecutorAdapterCatalog()
		const adapterContractsBounded = adapterCatalogIssues.length === 0
		if (!adapterContractsBounded) {
			details.push(`adapter catalog issues=${adapterCatalogIssues.join(" | ")}`)
		}

		return {
			modelCallCeilingStopsRun,
			runtimeCeilingStopsRun,
			usageBudgetCeilingStopsRun,
			ceilingArtifactsReported,
			fastLaneVisible,
			agentWaitCoversProviderTimeout,
			workspaceSingleRunLock,
			secondLiveRunRefusedGracefully,
			backgroundQueueApprovalBoundary,
			scheduledQueueBoundary,
			adapterContractsBounded,
			details,
		}
	} finally {
		modelRepo.cleanup()
		runtimeRepo.cleanup()
		usageRepo.cleanup()
		lockRepo.cleanup()
	}
}

export function formatGuardrailsHarnessResult(result: GuardrailsHarnessResult): string {
	const lines = [
		`Model-call ceiling stops run: ${result.modelCallCeilingStopsRun ? "PASS" : "FAIL"}`,
		`Run-duration ceiling stops run: ${result.runtimeCeilingStopsRun ? "PASS" : "FAIL"}`,
		`Estimated usage budget stops run: ${result.usageBudgetCeilingStopsRun ? "PASS" : "FAIL"}`,
		`Ceiling artifacts are reported: ${result.ceilingArtifactsReported ? "PASS" : "FAIL"}`,
		`Simple-task fast lane stays visible: ${result.fastLaneVisible ? "PASS" : "FAIL"}`,
		`Agent wait covers slow provider timeout: ${result.agentWaitCoversProviderTimeout ? "PASS" : "FAIL"}`,
		`Workspace single-run lock is enforced: ${result.workspaceSingleRunLock ? "PASS" : "FAIL"}`,
		`Second live run is refused cleanly: ${result.secondLiveRunRefusedGracefully ? "PASS" : "FAIL"}`,
		`Background queue approval boundary: ${result.backgroundQueueApprovalBoundary ? "PASS" : "FAIL"}`,
		`Scheduled queue boundary: ${result.scheduledQueueBoundary ? "PASS" : "FAIL"}`,
		`Adapter contracts stay bounded: ${result.adapterContractsBounded ? "PASS" : "FAIL"}`,
	]

	if (
		(!result.modelCallCeilingStopsRun ||
			!result.runtimeCeilingStopsRun ||
			!result.usageBudgetCeilingStopsRun ||
			!result.ceilingArtifactsReported ||
			!result.fastLaneVisible ||
			!result.agentWaitCoversProviderTimeout ||
			!result.workspaceSingleRunLock ||
			!result.secondLiveRunRefusedGracefully ||
			!result.backgroundQueueApprovalBoundary ||
			!result.scheduledQueueBoundary ||
			!result.adapterContractsBounded) &&
		result.details.length > 0
	) {
		lines.push(`Details: ${result.details.join(" | ")}`)
	}

	return lines.join("\n")
}

async function main(): Promise<void> {
	const result = await runGuardrailsHarness()
	console.log(formatGuardrailsHarnessResult(result))
	process.exit(
		result.modelCallCeilingStopsRun &&
		result.runtimeCeilingStopsRun &&
		result.usageBudgetCeilingStopsRun &&
		result.ceilingArtifactsReported &&
		result.fastLaneVisible &&
		result.agentWaitCoversProviderTimeout &&
		result.workspaceSingleRunLock &&
		result.secondLiveRunRefusedGracefully &&
		result.backgroundQueueApprovalBoundary &&
		result.scheduledQueueBoundary &&
		result.adapterContractsBounded
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:guardrails] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
