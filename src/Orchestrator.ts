import { spawn } from "child_process"
import fs from "fs"
import path from "path"

import { DatabaseService } from "./db/DatabaseService"
import { MessageBus } from "./mail/MessageBus"
import type { IModelClient } from "./model/IModelClient"
import { createLiveModelClient } from "./model/createLiveModelClient"
import { StubModelClient } from "./model/StubModelClient"
import { TelemetryModelClient } from "./model/TelemetryModelClient"
import { CoordinatorAgent, type Complexity, type RoutingDecision, type RoutingPath } from "./agents/CoordinatorAgent"
import { SupervisorAgent, type Subtask } from "./agents/SupervisorAgent"
import { WorktreeManager } from "./worktree/WorktreeManager"
import { WatchdogDaemon } from "./watchdog/WatchdogDaemon"
import { buildAssignmentLedger, type AssignmentLedger } from "./planning/AssignmentLedger"
import { createAskSiblingLedger, type AskSiblingLedger } from "./planning/AskSibling"
import { buildCheckpointArtifact, type RecordedCheckpointBoundary } from "./planning/Checkpoints"
import { buildContinuationState } from "./planning/CampaignContinuation"
import { buildCompletionLedger } from "./planning/CompletionLedger"
import { buildCriticArtifact } from "./planning/CriticLane"
import { buildDependencyGraphArtifact, type DependencyGraphArtifact } from "./planning/DependencyGraph"
import { buildMergeOrderArtifact, type MergeOrderArtifact } from "./planning/MergeOrder"
import { buildMediumLaneReliabilityArtifact } from "./planning/MediumLaneReliability"
import { buildPostMergeQualityArtifact } from "./planning/PostMergeQuality"
import { buildSwarmPlanArtifact, finalizeSwarmPlanArtifact, type SwarmPlanArtifact } from "./planning/PlanSchema"
import {
	buildPatternMemoryArtifact,
	formatPatternMemoryPromptSummary,
	resolvePatternMemoryArtifactPath,
	type PatternMemoryArtifact,
	writePatternMemoryArtifact,
} from "./planning/PatternMemory"
import { buildProgressMap } from "./planning/ProgressMap"
import { buildTargetedEvaluatorsArtifact } from "./planning/TargetedEvaluators"
import {
	buildContextPackArtifact,
	buildSubtaskContextPackArtifacts,
	formatContextPackPromptSummary,
	type ContextPackArtifact,
} from "./planning/ContextPacks"
import { buildRepoMapArtifact, formatRepoMapPromptSummary, type RepoMapArtifact } from "./planning/RepoMap"
import { buildWorkspaceMemoryOverview, formatWorkspaceMemoryPromptSummary } from "./planning/WorkspaceMemory"
import { buildScoutLaneEvidence } from "./planning/ScoutLane"
import { buildSupervisorArbitration, formatSupervisorArbitrationPromptSummary, type SupervisorArbitrationSummary } from "./planning/SupervisorArbitration"
import { findTeamShapeBuilderProfile, formatTeamShapePromptSummary } from "./planning/TeamShape"
import { planRetryWithSnapshot } from "./planning/RetryPlanner"
import { listRoleManualReferences } from "./planning/RoleManuals"
import { buildReplayArtifact } from "./run/ReplayExport"
import {
	buildFastLaneDecision,
	buildModeSelectorDecision,
	formatFastLaneDecision,
	formatModeSelectorDecision,
	type FastLaneDecision,
	type ModeSelectorDecision,
} from "./run/ModeSelector"
import {
	appendRunEvent,
	ensureRunDir,
	readRunEvents,
	resolveCheckpointArtifactPath,
	resolveContextPackArtifactPath,
	resolveReplayArtifactPath,
	resolveRepoMapArtifactPath,
	resolveSubtaskContextPackArtifactPath,
	updateRunSummary,
	writeCheckpointArtifact,
	writeContextPackArtifact,
	writeReplayArtifact,
	writeRepoMapArtifact,
	writeSubtaskContextPackArtifact,
	writeRunSummary,
} from "./run/RunArtifacts"
import { evaluateAcceptanceGate, type AcceptanceGateResult } from "./run/AcceptanceGate"
import { listWorkspaceFilesForDiscovery } from "./run/SemiOpenDiscovery"
import {
	buildScopedTaskContract,
	mergeTaskContracts,
	normalizeRelPath as normalizeContractPath,
	normalizeTaskContract,
	type TaskContract,
} from "./run/TaskContract"
import { resolveRuntimeConfig, type RuntimeConfig } from "./run/RuntimeConfig"
import { inventoryRecoverableState, reconcileOwnedState, type RecoveryReport } from "./run/RecoveryManager"
import { buildInitialReviewRecord, ensureReviewPack } from "./run/ReviewQueue"
import {
	runRepoVerificationProfile,
	type VerificationProfileResult,
} from "./run/VerificationProfile"
import { ProviderError } from "./model/ProviderFailure"
import {
	GuardrailError,
	acquireWorkspaceRunLock,
	formatWorkspaceRunLockBlockMessage,
	initializeRunGuardrails,
	makeDryRunLockSnapshot,
	readRunGuardrailUsage,
	releaseWorkspaceRunLock,
	type RunGuardrailLimits,
	type WorkspaceRunLockRecord,
	type WorkspaceRunLockSnapshot,
	updateRunGuardrailLimits,
} from "./run/RunGuardrails"

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function normalizeRelPath(p: string): string {
	return p.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

type TaskStatus = "done" | "failed" | "review_required"
type StopReason =
	| "success"
	| "review_blocked"
	| "reviewer_invalid"
	| "reviewer_unavailable"
	| "no_diff_evidence"
	| "dirty_repo_refusal"
	| "workspace_run_locked"
	| "command_blocked"
	| "timeout"
	| "run_duration_ceiling"
	| "model_call_ceiling"
	| "usage_budget_ceiling"
	| "watchdog_abort"
	| "ceiling_reached"
	| "merge_conflict"
	| "agent_error"
	| "scope_drift"
	| "missing_expected_change"
	| "too_many_changed_files"
	| "acceptance_gate_failed"
	| "verification_failed"
	| "verification_command_blocked"
	| "verification_timeout"
	| "provider_auth_failure"
	| "provider_launch_failure"
	| "provider_timeout"
	| "provider_malformed_response"
	| "provider_empty_response"
	| "provider_transport_failure"
	| "provider_ceiling_reached"
	| "operator_abort"
	| "unknown"

type PhaseResult = {
	status: Exclude<TaskStatus, "failed">
	message: string
	stopReason: StopReason
	reviewerVerdict?: "PASS" | "NEEDS_WORK"
	changedFiles?: string[]
	createdFiles?: string[]
	branchNames?: string[]
	taskContract?: TaskContract | null
	acceptanceGate?: AcceptanceGateResult | null
	verificationProfile?: VerificationProfileResult | null
}

type ReviewWaitResult =
	| {
			kind: "verdict"
			payload: Record<string, unknown>
	  }
	| {
			kind: "review_required"
			message: string
	  }

type ChangeEvidence = {
	changedFiles: string[]
	filesForReview: string[]
	fileDiffs: Record<string, string>
	hasMeaningfulDiff: boolean
}

export type OrchestratorRunResult = {
	taskId: string
	status: TaskStatus
	complexity: Complexity | null
	message: string
	stopReason: StopReason
	summaryPath: string
}

export class Orchestrator {
	private db: DatabaseService
	private bus: MessageBus
	private workspace: string
	private dryRun: boolean
	private allowDirty: boolean
	private currentRunDir: string | null = null
	private currentMaxModelCalls: number | null = null
	private currentMaxEstimatedTokens: number | null = null
	private currentTaskId: string | null = null
	private abortError: Error | null = null
	private abortStopReason: StopReason | null = null
	private currentWorkspaceRunLockRecord: WorkspaceRunLockRecord | null = null
	private currentPlanArtifact: SwarmPlanArtifact | null = null
	private currentAssignmentLedger: AssignmentLedger | null = null
	private currentDependencyGraph: DependencyGraphArtifact | null = null
	private currentAskSiblingLedger: AskSiblingLedger | null = null
	private currentMergeOrder: MergeOrderArtifact | null = null
	private currentCheckpointBoundaries: RecordedCheckpointBoundary[] = []
	private currentRepoMap: RepoMapArtifact | null = null
	private currentContextPack: ContextPackArtifact | null = null
	private currentSubtaskContextPackPaths: Record<string, string> | null = null
	private currentPatternMemory: PatternMemoryArtifact | null = null
	private currentModeSelector: ModeSelectorDecision | null = null
	private currentFastLane: FastLaneDecision | null = null
	private readonly runtimeConfig: RuntimeConfig

	constructor(workspace: string, db: DatabaseService, dryRun: boolean, options: { allowDirty?: boolean } = {}) {
		this.workspace = workspace
		this.db = db
		this.bus = new MessageBus(db)
		this.dryRun = dryRun
		this.allowDirty = options.allowDirty === true
		this.runtimeConfig = resolveRuntimeConfig(process.env)
	}

	private setAbortError(err: Error): void {
		if (!this.abortError) this.abortError = err
	}

	requestAbort(message: string, stopReason: StopReason = "operator_abort"): void {
		if (this.abortError) return
		this.abortStopReason = stopReason
		this.setAbortError(new Error(message))
	}

	private resolveActiveProfileManifestHash(): string | null {
		const raw = (process.env["SWARM_OWNER_PROFILE_MANIFEST_HASH"] ?? "").trim()
		return raw || null
	}

	private recordAssignmentCheckpoint(taskId: string, workItemId: string, branchName: string, reason: string): void {
		const assignment = this.currentAssignmentLedger?.assignments.find((entry) => entry.workItemId === workItemId)
		if (!assignment) return

		const boundary: RecordedCheckpointBoundary = {
			kind: "assignment_commit",
			recordedAt: new Date().toISOString(),
			workItemId,
			assignmentId: assignment.assignmentId,
			branchName,
			reason,
		}
		this.currentCheckpointBoundaries.push(boundary)
		if (!this.currentRunDir) return
		appendRunEvent(this.currentRunDir, {
			type: "checkpoint_recorded",
			taskId,
			checkpointKind: boundary.kind,
			workItemId,
			assignmentId: assignment.assignmentId,
			branchName,
		})
	}

	private recordRetrySnapshotCheckpoint(taskId: string, snapshotPath: string): void {
		const boundary: RecordedCheckpointBoundary = {
			kind: "retry_snapshot",
			recordedAt: new Date().toISOString(),
			retrySnapshotPath: snapshotPath,
			reason: "Saved an exact bounded retry snapshot after the run stopped short of final acceptance.",
		}
		this.currentCheckpointBoundaries.push(boundary)
		if (!this.currentRunDir) return
		appendRunEvent(this.currentRunDir, {
			type: "checkpoint_recorded",
			taskId,
			checkpointKind: boundary.kind,
			retrySnapshotPath: snapshotPath,
		})
	}

	private parseErrorMessage(taskId: string, msg: { from_agent: string; payload: string }): Error | null {
		let agentId = msg.from_agent
		let reason = "unknown"
		let payloadTaskId: string | null = null
		let lastHeartbeat = ""

		try {
			const payload = asRecord(JSON.parse(msg.payload) as unknown) ?? {}

			const payloadAgentId = payload["agentId"]
			if (typeof payloadAgentId === "string" && payloadAgentId.trim()) agentId = payloadAgentId

			const payloadReason = payload["reason"]
			if (typeof payloadReason === "string" && payloadReason.trim()) reason = payloadReason

			const hb = payload["lastHeartbeat"]
			if (typeof hb === "string" && hb.trim()) lastHeartbeat = hb

			const tid = payload["taskId"]
			if (typeof tid === "string" && tid.trim()) payloadTaskId = tid
		} catch {
			// ignore
		}

		if (payloadTaskId && payloadTaskId !== taskId && reason !== "watchdog_stale_heartbeat") return null

		if (reason === "watchdog_stale_heartbeat") {
			const hbSuffix = lastHeartbeat ? ` (last heartbeat ${lastHeartbeat})` : ""
			return new Error(`Agent ${agentId} went silent (no heartbeat for 2 minutes)${hbSuffix}. Run aborted.`)
		}

		return new Error(`Agent ${agentId} failed: ${reason}`)
	}

	private listWorkspaceFiles(): string[] {
		return listWorkspaceFilesForDiscovery(this.workspace)
	}

	private buildDeterministicComplexSubtasks(task: string, targetFiles: string[], builderCount: number): Subtask[] {
		const normalizedTargets = Array.from(new Set(targetFiles.map((file) => normalizeRelPath(file)).filter(Boolean)))
		if (builderCount <= 1 || normalizedTargets.length <= 2) {
			return [
				{
					id: "subtask-1",
					description: `Update ${normalizedTargets.join(", ")} together to satisfy: ${task}`,
					files: normalizedTargets,
					assignedBuilder: "builder-1",
					stage: 1,
					ownershipRule: "Single owner keeps tightly coupled bounded changes together.",
					dependencyReason: null,
				},
			]
		}

		const activeBuilderCount = Math.max(1, Math.min(builderCount, normalizedTargets.length))
		const buckets = Array.from({ length: activeBuilderCount }, () => [] as string[])

		normalizedTargets.forEach((file, index) => {
			buckets[index % activeBuilderCount]?.push(file)
		})

		const subtasks: Subtask[] = []
		for (const [index, files] of buckets.entries()) {
			if (files.length === 0) continue
			const fileLabel = files.join(", ")
			subtasks.push({
				id: `subtask-${index + 1}`,
				description: `Update ${fileLabel} to satisfy: ${task}`,
				files,
				assignedBuilder: `builder-${index + 1}`,
				stage: 1,
				ownershipRule:
					activeBuilderCount >= 3
						? "Parallel medium-lane file bucket with exclusive ownership."
						: "Parallel bounded file bucket with exclusive ownership.",
				dependencyReason: null,
			})
		}
		return subtasks
	}

	private async planComplexSubtasks(
		task: string,
		fileList: string[],
		routing: RoutingDecision,
		arbitration: SupervisorArbitrationSummary,
		builderCount: number,
		workspaceMemorySummary: string | null,
		repoMap: RepoMapArtifact | null,
		contextPack: ContextPackArtifact | null,
		patternMemory: PatternMemoryArtifact | null,
	): Promise<Subtask[]> {
		if (routing.targetFiles.length >= 2 && routing.targetFiles.length <= 10) {
			const subtasks = this.buildDeterministicComplexSubtasks(task, routing.targetFiles, builderCount)
			console.log(
				`[Supervisor] Deterministic plan for ${
					routing.path === "semi_open" ? "semi-open" : routing.path === "medium" ? "medium bounded" : "bounded"
				} target files: ${routing.targetFiles.join(", ")}`,
			)
			return subtasks
		}

		const subtasks = await new SupervisorAgent(this.createInlineModelClient("supervisor")).plan(task, fileList, builderCount, {
			delegationSummary: formatSupervisorArbitrationPromptSummary(arbitration),
			memorySummary: workspaceMemorySummary ?? undefined,
			repoMapSummary: repoMap ? formatRepoMapPromptSummary(repoMap) : undefined,
			contextPackSummary: contextPack ? formatContextPackPromptSummary(contextPack, "planner") : undefined,
			patternMemorySummary: patternMemory ? formatPatternMemoryPromptSummary(patternMemory) : undefined,
		})
		console.log(`[Supervisor] Planned ${subtasks.length} subtask(s)`)
		return subtasks
	}

	private resolveWorktreeRunDir(taskId: string): string {
		const override = (process.env["SWARM_WORKTREE_BASE"] ?? "").trim()
		const baseDir = override ? path.resolve(override) : path.join(path.dirname(this.workspace), ".swarm-worktrees")
		return path.join(baseDir, taskId)
	}

	private resolveRunGuardrailLimits(pathChosen: RoutingPath | null): RunGuardrailLimits {
		const lowCostLimits = {
			maxModelCalls: this.runtimeConfig.smallTaskMaxModelCalls,
			maxEstimatedTokens: this.runtimeConfig.smallTaskMaxEstimatedTokens,
		}
		const mediumLaneLimits = {
			maxModelCalls: this.runtimeConfig.mediumTaskMaxModelCalls,
			maxEstimatedTokens: this.runtimeConfig.mediumTaskMaxEstimatedTokens,
		}
		const highCostLimits = {
			maxModelCalls: this.runtimeConfig.maxModelCallsPerRun,
			maxEstimatedTokens: this.runtimeConfig.maxEstimatedTokensPerRun,
		}
		const balancedCostLimits = {
			maxModelCalls: Math.max(
				lowCostLimits.maxModelCalls,
				Math.min(
					highCostLimits.maxModelCalls,
					Math.floor((lowCostLimits.maxModelCalls + highCostLimits.maxModelCalls) / 2),
				),
			),
			maxEstimatedTokens: Math.max(
				lowCostLimits.maxEstimatedTokens,
				Math.min(
					highCostLimits.maxEstimatedTokens,
					Math.floor((lowCostLimits.maxEstimatedTokens + highCostLimits.maxEstimatedTokens) / 2),
				),
			),
		}
		switch (pathChosen) {
			case "small_task":
			case "simple":
				return lowCostLimits
			case "scoped":
			case "semi_open":
				return balancedCostLimits
			case "medium":
				return mediumLaneLimits
			case "complex":
			default:
				return highCostLimits
		}
	}

	private createInlineModelClient(actor: string): IModelClient {
		const baseClient = this.dryRun
			? new StubModelClient(["coordinator_classify"])
			: createLiveModelClient(process.env as Record<string, string | undefined>)
		return this.currentRunDir
			? new TelemetryModelClient(baseClient, {
					runDir: this.currentRunDir,
					actor,
					maxCalls: this.currentMaxModelCalls ?? undefined,
					maxEstimatedTokens: this.currentMaxEstimatedTokens ?? undefined,
					db: this.db,
					taskId: this.currentTaskId ?? undefined,
			  })
			: baseClient
	}

	private spawnAgentRunner(
		runnerPath: string,
		runnerArgs: string[],
		envOverrides: Record<string, string> = {},
	): ReturnType<typeof spawn> {
		const artifactEnv =
			this.currentRunDir && !envOverrides["SWARM_RUN_ARTIFACT_DIR"] ? { SWARM_RUN_ARTIFACT_DIR: this.currentRunDir } : {}
		const ceilingEnv =
			this.currentMaxModelCalls !== null && !envOverrides["SWARM_MAX_MODEL_CALLS"]
				? { SWARM_MAX_MODEL_CALLS: String(this.currentMaxModelCalls) }
				: {}
		const usageEnv =
			this.currentMaxEstimatedTokens !== null && !envOverrides["SWARM_MAX_ESTIMATED_TOKENS"]
				? { SWARM_MAX_ESTIMATED_TOKENS: String(this.currentMaxEstimatedTokens) }
				: {}
		const env = { ...process.env, ...artifactEnv, ...ceilingEnv, ...usageEnv, ...envOverrides }
		const opts = { stdio: "inherit" as const, env }

		if (runnerPath.endsWith(".ts")) {
			if (process.platform === "win32") {
				return spawn("cmd.exe", ["/d", "/s", "/c", "npx", "tsx", runnerPath, ...runnerArgs], opts)
			}
			return spawn("npx", ["tsx", runnerPath, ...runnerArgs], opts)
		}

		return spawn(process.execPath, [runnerPath, ...runnerArgs], opts)
	}

	private async runGitAt(cwd: string, args: string[]): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const child = spawn("git", ["-c", `safe.directory=${cwd}`, ...args], {
				cwd,
				windowsHide: true,
				stdio: "ignore",
			})

			child.once("error", reject)
			child.once("close", (code) => {
				if (code === 0) resolve()
				else reject(new Error(`git ${args.join(" ")} failed (exit ${code ?? "null"})`))
			})
		})
	}

	private async runGit(args: string[]): Promise<void> {
		return this.runGitAt(this.workspace, args)
	}

	private async runGitCaptureAt(
		cwd: string,
		args: string[],
		options: { timeoutMs?: number; maxOutputChars?: number } = {},
	): Promise<{ stdout: string; stderr: string }> {
		const timeoutMs = options.timeoutMs ?? 30_000
		const maxOutputChars = options.maxOutputChars ?? 200_000

		const swarmDir = path.join(cwd, ".swarm")
		const tmpDir = path.join(swarmDir, "tmp")
		try {
			if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
		} catch {
			// ignore
		}

		const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
		const stdoutPath = path.join(tmpDir, `git-${stamp}.stdout.log`)
		const stderrPath = path.join(tmpDir, `git-${stamp}.stderr.log`)

		const stdoutFd = fs.openSync(stdoutPath, "w")
		const stderrFd = fs.openSync(stderrPath, "w")

		const readTail = (filePath: string): string => {
			try {
				const raw = fs.readFileSync(filePath, "utf8")
				if (raw.length <= maxOutputChars) return raw
				return raw.slice(-maxOutputChars)
			} catch {
				return ""
			}
		}

		try {
			const child = spawn("git", ["-c", `safe.directory=${cwd}`, ...args], {
				cwd,
				windowsHide: true,
				stdio: ["ignore", stdoutFd, stderrFd],
			})

			const killTree = () => {
				if (!child.pid) return
				if (process.platform === "win32") {
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
			}

			const timeout = setTimeout(() => killTree(), timeoutMs)
			timeout.unref?.()

			const exitCode = await new Promise<number | null>((resolve, reject) => {
				child.once("error", reject)
				child.once("close", (code) => resolve(typeof code === "number" ? code : null))
			}).finally(() => clearTimeout(timeout))

			const stdout = readTail(stdoutPath)
			const stderr = readTail(stderrPath)

			if (exitCode !== 0) {
				throw new Error(`git ${args.join(" ")} failed (exit ${exitCode ?? "null"})\n${stderr || stdout}`.trim())
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

	private async runGitCapture(
		args: string[],
		options: { timeoutMs?: number; maxOutputChars?: number } = {},
	): Promise<{ stdout: string; stderr: string }> {
		return this.runGitCaptureAt(this.workspace, args, options)
	}

	private async getBaseRef(repoPath = this.workspace): Promise<string> {
		if (this.dryRun) return "HEAD"
		try {
			const { stdout } = await this.runGitCaptureAt(repoPath, ["rev-parse", "HEAD"], {
				timeoutMs: 15_000,
				maxOutputChars: 10_000,
			})
			const sha = stdout.trim()
			return sha || "HEAD"
		} catch {
			return "HEAD"
		}
	}

	private async getRepoStatusEntries(repoPath: string): Promise<string[]> {
		if (this.dryRun) return []
		try {
			const { stdout } = await this.runGitCaptureAt(repoPath, ["status", "--porcelain", "--untracked-files=all"], {
				timeoutMs: 15_000,
				maxOutputChars: 100_000,
			})
			return stdout
				.split(/\r?\n/g)
				.map((line) => line.trimEnd())
				.filter(Boolean)
		} catch {
			return []
		}
	}

	private async ensureWorkspaceReadyForLiveRun(): Promise<void> {
		if (this.dryRun) return

		const dirtyEntries = await this.getRepoStatusEntries(this.workspace)
		if (dirtyEntries.length === 0) return

		if (this.allowDirty) {
			console.warn(`[Orchestrator] WARNING: proceeding on a dirty workspace because --allowDirty was set (${dirtyEntries.length} entries).`)
			return
		}

		throw new Error(
			"Workspace has uncommitted tracked or untracked changes. Refusing live run unless --allowDirty is set.",
		)
	}

	private async commitRepoChanges(repoPath: string, message: string): Promise<boolean> {
		if (this.dryRun) return false
		const dirtyEntries = await this.getRepoStatusEntries(repoPath)
		if (dirtyEntries.length === 0) return false
		try {
			await this.runGitAt(repoPath, ["add", "-A"])
			await this.runGitAt(repoPath, ["commit", "-m", message])
			return true
		} catch (err) {
			console.warn(`[Orchestrator] Git commit warning: ${err instanceof Error ? err.message : String(err)}`)
			return false
		}
	}

	private async mergeBranchIntoMain(branch: string, message: string): Promise<void> {
		try {
			await this.runGit(["merge", "--no-ff", "-m", message, branch])
		} catch (err) {
			try {
				await this.runGit(["merge", "--abort"])
			} catch {
				// ignore
			}
			throw err
		}
	}

	private async getChangedFilesSinceAt(repoPath: string, baseRef: string): Promise<string[]> {
		if (this.dryRun) return []
		try {
			const { stdout } = await this.runGitCaptureAt(repoPath, ["diff", "--name-only", baseRef, "--"], {
				timeoutMs: 15_000,
				maxOutputChars: 50_000,
			})
			return stdout
				.split(/\r?\n/g)
				.map((l) => l.trim())
				.filter(Boolean)
		} catch {
			return []
		}
	}

	private async getChangedFilesSince(baseRef: string): Promise<string[]> {
		return this.getChangedFilesSinceAt(this.workspace, baseRef)
	}

	private async getCreatedFilesSinceAt(repoPath: string, baseRef: string): Promise<string[]> {
		if (this.dryRun) return []
		try {
			const { stdout } = await this.runGitCaptureAt(repoPath, ["diff", "--diff-filter=A", "--name-only", baseRef, "--"], {
				timeoutMs: 15_000,
				maxOutputChars: 50_000,
			})
			return stdout
				.split(/\r?\n/g)
				.map((line) => normalizeRelPath(line))
				.filter(Boolean)
		} catch {
			return []
		}
	}

	private async getFileDiffsSinceAt(repoPath: string, baseRef: string, files: string[]): Promise<Record<string, string>> {
		const fileDiffs: Record<string, string> = {}
		if (this.dryRun || files.length === 0) return fileDiffs

		for (const file of files) {
			try {
				const { stdout } = await this.runGitCaptureAt(repoPath, ["diff", baseRef, "--", file], {
					timeoutMs: 15_000,
					maxOutputChars: 200_000,
				})
				fileDiffs[file] = stdout.trim() || "(no diff)"
			} catch (err) {
				fileDiffs[file] = `(diff unavailable) ${err instanceof Error ? err.message : String(err)}`
			}
		}

		return fileDiffs
	}

	private async getFileDiffsSince(baseRef: string, files: string[]): Promise<Record<string, string>> {
		return this.getFileDiffsSinceAt(this.workspace, baseRef, files)
	}

	private printVerdict(verdictPayload: Record<string, unknown>): {
		verdict: "PASS" | "NEEDS_WORK"
		feedback: string
		valid: boolean
		reviewOutputValid: boolean
	} {
		const verdictValue = verdictPayload["verdict"]
		const valid = verdictValue === "PASS" || verdictValue === "NEEDS_WORK"
		const verdict = valid ? verdictValue : "NEEDS_WORK"
		const reviewOutputValid = verdictPayload["reviewOutputValid"] !== false
		console.log(`[Reviewer] Verdict: ${valid ? verdict : "INVALID"}`)

		const feedbackLines: string[] = []

		const summaryRaw = typeof verdictPayload["summary"] === "string" ? verdictPayload["summary"].trim() : ""
		const summary = summaryRaw || (!valid ? "Reviewer output was missing or unreadable." : "")
		if (summary) {
			console.log(`[Reviewer] Summary: ${summary}`)
			feedbackLines.push(summary)
		}

		const issuesRaw = Array.isArray(verdictPayload["issues"]) ? verdictPayload["issues"] : []
		for (const issue of issuesRaw) {
			const issueObj = asRecord(issue)
			if (!issueObj) continue
			const severity = issueObj["severity"]
			const description = issueObj["description"]
			if (typeof severity === "string" && typeof description === "string" && severity.trim() && description.trim()) {
				const line = `[${severity.toUpperCase()}] ${description.trim()}`
				console.log(`  ${line}`)
				feedbackLines.push(line)
			}
		}

		if (!reviewOutputValid) {
			console.log("[Reviewer] Output validity: invalid/unreadable")
		}

		if (feedbackLines.length === 0 && !reviewOutputValid) {
			feedbackLines.push("Reviewer output was invalid or unreadable.")
		}

		return { verdict, feedback: feedbackLines.join("\n").trim(), valid, reviewOutputValid }
	}

	private taskAppearsCodeChanging(task: string): boolean {
		const taskLower = task.toLowerCase()
		if (/\b(explain|review|analyze|summari[sz]e|inspect|describe)\b/.test(taskLower)) return false
		return /\b(add|change|create|edit|fix|implement|make|modify|refactor|remove|rename|update|write)\b/.test(taskLower)
	}

	private diffTextLooksMeaningful(diffText: string): boolean {
		const trimmed = diffText.trim()
		if (!trimmed) return false
		if (trimmed === "(no diff)") return false
		if (trimmed.startsWith("(diff unavailable)")) return false
		return true
	}

	private async collectChangeEvidence(baseRef: string, fallbackFiles: string[], maxFiles: number): Promise<ChangeEvidence> {
		return this.collectChangeEvidenceAt(this.workspace, baseRef, fallbackFiles, maxFiles)
	}

	private async collectChangeEvidenceAt(
		repoPath: string,
		baseRef: string,
		fallbackFiles: string[],
		maxFiles: number,
	): Promise<ChangeEvidence> {
		const changedFiles = (await this.getChangedFilesSinceAt(repoPath, baseRef)).slice(0, maxFiles)
		const dedupedFallbackFiles = Array.from(
			new Set(
				fallbackFiles
					.filter((file) => typeof file === "string")
					.map((file) => normalizeRelPath(file))
					.filter(Boolean),
			),
		).slice(0, maxFiles)

		const filesForReview = changedFiles.length > 0 ? changedFiles : dedupedFallbackFiles
		const fileDiffs = await this.getFileDiffsSinceAt(repoPath, baseRef, filesForReview)
		const hasMeaningfulDiff =
			changedFiles.length > 0 && changedFiles.some((file) => this.diffTextLooksMeaningful(fileDiffs[file] ?? ""))

		return {
			changedFiles,
			filesForReview,
			fileDiffs,
			hasMeaningfulDiff,
		}
	}

	private buildDerivedTaskContract(routing: RoutingDecision): TaskContract | null {
		if (routing.taskContract) {
			return routing.taskContract
		}
		if (routing.targetFiles.length >= 2 && routing.targetFiles.length <= 5) {
			return buildScopedTaskContract(routing.targetFiles)
		}
		return null
	}

	private async readPostRunFileContents(repoPath: string, files: string[]): Promise<Record<string, string | null>> {
		const result: Record<string, string | null> = {}
		for (const file of Array.from(new Set(files.map((entry) => normalizeContractPath(entry)).filter(Boolean)))) {
			const absolute = path.join(repoPath, file)
			try {
				result[file] = fs.readFileSync(absolute, "utf8")
			} catch {
				result[file] = null
			}
		}
		return result
	}

	private async evaluateAcceptanceAt(
		repoPath: string,
		baseRef: string,
		evidence: ChangeEvidence,
		reviewerVerdict: "PASS" | "NEEDS_WORK",
		reviewOutputValid: boolean,
		requireMeaningfulDiff: boolean,
		taskContract?: TaskContract | null,
	): Promise<{ acceptanceGate: AcceptanceGateResult; createdFiles: string[]; normalizedTaskContract: TaskContract | null }> {
		const normalizedTaskContract = normalizeTaskContract(taskContract)
		const snippetFiles = [
			...(normalizedTaskContract?.acceptance?.requiredContentSnippets ?? []).map((entry) => entry.path),
			...(normalizedTaskContract?.acceptance?.forbiddenContentSnippets ?? []).map((entry) => entry.path),
		]
		const scopeFiles = normalizedTaskContract?.scope?.allowedFiles ?? []
		const createdFiles = await this.getCreatedFilesSinceAt(repoPath, baseRef)
		const fileContents = await this.readPostRunFileContents(repoPath, [
			...evidence.changedFiles,
			...snippetFiles,
			...scopeFiles,
			...createdFiles,
		])

		return {
			acceptanceGate: evaluateAcceptanceGate({
				reviewerVerdict,
				reviewOutputValid,
				requireMeaningfulDiff,
				hasMeaningfulDiff: evidence.hasMeaningfulDiff,
				changedFiles: evidence.changedFiles,
				createdFiles,
				postRunFileContents: fileContents,
				taskContract: normalizedTaskContract,
			}),
			createdFiles,
			normalizedTaskContract,
		}
	}

	private mapAcceptanceFailureToStopReason(acceptanceGate: AcceptanceGateResult): StopReason {
		const codes = new Set(acceptanceGate.failedChecks.map((failure) => failure.code))
		if (codes.has("scope_drift") || codes.has("forbidden_file_changed")) return "scope_drift"
		if (codes.has("missing_expected_change") || codes.has("required_created_file_missing")) return "missing_expected_change"
		if (codes.has("too_many_changed_files")) return "too_many_changed_files"
		if (codes.has("no_meaningful_diff")) return "no_diff_evidence"
		return "acceptance_gate_failed"
	}

	private formatAcceptanceFailureMessage(acceptanceGate: AcceptanceGateResult): string {
		const firstFailure = acceptanceGate.failedChecks[0]
		if (!firstFailure) return "Acceptance gate failed."
		return `Acceptance gate failed: ${firstFailure.message}`
	}

	private async runPostEditVerification(
		repoPath: string,
		changedFiles: string[],
		isCodeChangingTask: boolean,
	): Promise<VerificationProfileResult> {
		return await runRepoVerificationProfile(this.workspace, repoPath, changedFiles, {
			isCodeChangingTask,
			runtimeConfig: this.runtimeConfig,
		})
	}

	private mapVerificationStopReason(verificationProfile: VerificationProfileResult): StopReason {
		switch (verificationProfile.status) {
			case "timed_out":
				return "verification_timeout"
			case "blocked":
				return "verification_command_blocked"
			case "failed":
				return "verification_failed"
			default:
				return "success"
		}
	}

	private buildSuccessMessage(isCodeChangingTask: boolean, verificationProfile: VerificationProfileResult): string {
		const reviewMessage = isCodeChangingTask
			? "Reviewer PASS received and change evidence confirmed."
			: "Reviewer PASS received."

		if (verificationProfile.status === "passed" && verificationProfile.profileName) {
			return `${reviewMessage} Verification profile "${verificationProfile.profileName}" passed.`
		}

		if (verificationProfile.status === "not_applicable") {
			return `${reviewMessage} ${verificationProfile.message}`
		}

		return reviewMessage
	}

	private buildVerificationFailureMessage(verificationProfile: VerificationProfileResult): string {
		const detail = verificationProfile.details[0]
		if (verificationProfile.status === "timed_out") {
			return `${verificationProfile.message} Human review required.`
		}
		if (verificationProfile.status === "blocked") {
			return `${verificationProfile.message}${detail ? ` ${detail}` : ""} Human review required.`.trim()
		}
		return `${verificationProfile.message}${detail ? ` ${detail}` : ""} Human review required.`.trim()
	}

	private async runBuilderOnce(
		runnerPath: string,
		dbPath: string,
		taskId: string,
		builderId: string,
		task: string,
		envOverrides: Record<string, string> = {},
		workspaceOverride?: string,
	): Promise<Record<string, unknown>> {
		this.db.run("INSERT OR REPLACE INTO agents (id, role, status) VALUES (?,?,?)", [builderId, "builder", "idle"])
		this.db.run("UPDATE messages SET read = 1 WHERE to_agent = 'orchestrator' AND from_agent = ? AND read = 0", [builderId])

		const workspace = workspaceOverride ?? this.workspace
		const builderArgs = [
			"--role",
			"builder",
			"--agentId",
			builderId,
			"--taskId",
			taskId,
			"--task",
			task,
			"--workspace",
			workspace,
			"--dbPath",
			dbPath,
			...(this.dryRun ? ["--dryRun"] : []),
		]

		const builderChild = this.spawnAgentRunner(runnerPath, builderArgs, envOverrides)

		const childClosed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
			builderChild.once("close", (code, signal) => resolve({ code, signal }))
		})

		try {
			return await Promise.race([
				this.waitForCompletion(taskId, this.runtimeConfig.agentWaitTimeoutMs, childClosed, builderId),
				new Promise<Record<string, unknown>>((_resolve, reject) => builderChild.once("error", reject)),
			])
		} finally {
			try {
				builderChild.kill()
			} catch {
				// ignore
			}
		}
	}

	private async runMergerOnce(
		runnerPath: string,
		dbPath: string,
		taskId: string,
		mergerId: string,
		task: string,
		branches: string[],
		workspaceOverride?: string,
	): Promise<Record<string, unknown>> {
		this.db.run("INSERT OR REPLACE INTO agents (id, role, status) VALUES (?,?,?)", [mergerId, "merger", "idle"])
		this.db.run("UPDATE messages SET read = 1 WHERE to_agent = 'orchestrator' AND from_agent = ? AND read = 0", [mergerId])

		const workspace = workspaceOverride ?? this.workspace
		const mergerArgs = [
			"--role",
			"merger",
			"--agentId",
			mergerId,
			"--taskId",
			taskId,
			"--task",
			task,
			"--workspace",
			workspace,
			"--dbPath",
			dbPath,
			"--branchesJson",
			JSON.stringify(branches),
			...(this.dryRun ? ["--dryRun"] : []),
		]

		const mergerChild = this.spawnAgentRunner(runnerPath, mergerArgs)
		const childClosed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
			mergerChild.once("close", (code, signal) => resolve({ code, signal }))
		})

		try {
			return await Promise.race([
				this.waitForCompletion(taskId, this.runtimeConfig.agentWaitTimeoutMs, childClosed, mergerId),
				new Promise<Record<string, unknown>>((_resolve, reject) => mergerChild.once("error", reject)),
			])
		} finally {
			try {
				mergerChild.kill()
			} catch {
				// ignore
			}
		}
	}

	private async runReviewerOnce(
		runnerPath: string,
		dbPath: string,
		taskId: string,
		reviewerId: string,
		taskDescription: string,
		filesWritten: string[],
		fileDiffs: Record<string, string>,
		contextSummary = "",
	): Promise<ReviewWaitResult> {
		this.db.run("INSERT OR REPLACE INTO agents (id, role, status) VALUES (?,?,?)", [reviewerId, "reviewer", "idle"])
		this.db.run("UPDATE messages SET read = 1 WHERE to_agent = ? AND read = 0", [reviewerId])

		await this.bus.send({
			from: "orchestrator",
			to: reviewerId,
			type: "review_request",
			payload: {
				taskId,
				taskDescription,
				filesWritten,
				fileDiffs,
				contextSummary,
			},
		})

		const reviewerArgs = [
			"--role",
			"reviewer",
			"--agentId",
			reviewerId,
			"--taskId",
			taskId,
			"--task",
			taskDescription,
			"--workspace",
			this.workspace,
			"--dbPath",
			dbPath,
			...(this.dryRun ? ["--dryRun"] : []),
		]

		const reviewerChild = this.spawnAgentRunner(runnerPath, reviewerArgs)

		const reviewerClosed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
			reviewerChild.once("close", (code, signal) => resolve({ code, signal }))
		})

		try {
			return await Promise.race([
				this.waitForVerdict(taskId, this.runtimeConfig.agentWaitTimeoutMs, reviewerClosed, reviewerId),
				new Promise<ReviewWaitResult>((resolve) => {
					reviewerChild.once("error", (err) =>
						resolve({
							kind: "review_required",
							message: `Reviewer runner failed before verdict: ${err instanceof Error ? err.message : String(err)}`,
						}),
					)
				}),
			])
		} finally {
			try {
				reviewerChild.kill()
			} catch {
				// ignore
			}
		}
	}

	private async runSimpleWithRetry(
		runnerPath: string,
		dbPath: string,
		taskId: string,
		baseRef: string,
		task: string,
		builderEnvOverrides: Record<string, string> = {},
		taskContract: TaskContract | null = null,
	): Promise<PhaseResult> {
		const builderId = "builder-1"
		const reviewerId = "reviewer-1"
		const isCodeChangingTask = this.taskAppearsCodeChanging(task)

		let retries = 0
		let attemptTask = task

		if (this.dryRun) {
			while (true) {
				const builderOutput = await this.runBuilderOnce(
					runnerPath,
					dbPath,
					taskId,
					builderId,
					attemptTask,
					builderEnvOverrides,
				)
				const filesWritten = Array.isArray(builderOutput["filesWritten"])
					? (builderOutput["filesWritten"].filter((f) => typeof f === "string") as string[])
					: []

				const evidence = await this.collectChangeEvidence(baseRef, filesWritten, 50)
				const reviewResult = await this.runReviewerOnce(
					runnerPath,
					dbPath,
					taskId,
					reviewerId,
					task,
					evidence.filesForReview,
					evidence.fileDiffs,
					this.currentContextPack ? formatContextPackPromptSummary(this.currentContextPack, "reviewer") : "",
				)

				if (reviewResult.kind !== "verdict") {
					console.log(`[Orchestrator] ${reviewResult.message}`)
					return {
						status: "review_required",
						message: reviewResult.message,
						stopReason: "reviewer_unavailable",
						taskContract,
					}
				}

				const review = this.printVerdict(reviewResult.payload)
				if (!review.valid || !review.reviewOutputValid) {
					const message = review.feedback || "Reviewer output was invalid or unreadable. Human review required."
					console.log(`[Orchestrator] ${message}`)
					return {
						status: "review_required",
						message,
						stopReason: "reviewer_invalid",
						reviewerVerdict: review.verdict,
						taskContract,
					}
				}

				if (review.verdict === "PASS") {
					const gate = await this.evaluateAcceptanceAt(
						this.workspace,
						baseRef,
						evidence,
						"PASS",
						review.reviewOutputValid,
						isCodeChangingTask,
						taskContract,
					)
					if (!gate.acceptanceGate.passed) {
						const message = this.formatAcceptanceFailureMessage(gate.acceptanceGate)
						console.log(`[Orchestrator] ${message}`)
						return {
							status: "review_required",
							message,
							stopReason: this.mapAcceptanceFailureToStopReason(gate.acceptanceGate),
							reviewerVerdict: "PASS",
							changedFiles: evidence.changedFiles,
							createdFiles: gate.createdFiles,
							taskContract: gate.normalizedTaskContract,
							acceptanceGate: gate.acceptanceGate,
						}
					}

					const verificationProfile = await this.runPostEditVerification(
						this.workspace,
						evidence.changedFiles,
						isCodeChangingTask,
					)
					if (verificationProfile.status !== "passed" && verificationProfile.status !== "not_applicable") {
						const message = this.buildVerificationFailureMessage(verificationProfile)
						console.log(`[Orchestrator] ${message}`)
						return {
							status: "review_required",
							message,
							stopReason: this.mapVerificationStopReason(verificationProfile),
							reviewerVerdict: "PASS",
							changedFiles: evidence.changedFiles,
							createdFiles: gate.createdFiles,
							taskContract: gate.normalizedTaskContract,
							acceptanceGate: gate.acceptanceGate,
							verificationProfile,
						}
					}

					return {
						status: "done",
						message: this.buildSuccessMessage(isCodeChangingTask, verificationProfile),
						stopReason: "success",
						reviewerVerdict: "PASS",
						changedFiles: evidence.changedFiles,
						createdFiles: gate.createdFiles,
						taskContract: gate.normalizedTaskContract,
						acceptanceGate: gate.acceptanceGate,
						verificationProfile,
					}
				}

				if (retries < 2) {
					console.log(`[Orchestrator] NEEDS_WORK - retry ${retries + 1}/2`)
					retries++
					attemptTask = `${task}\n\nPrevious attempt feedback:\n${review.feedback || "(no feedback)"}`
					continue
				}

				const message = "Reviewer returned NEEDS_WORK after the retry limit. Human review required."
				console.log(`[Orchestrator] ${message}`)
				return {
					status: "review_required",
					message,
					stopReason: "review_blocked",
					reviewerVerdict: "NEEDS_WORK",
					changedFiles: evidence.changedFiles,
					taskContract,
				}
			}
		}

		const wm = new WorktreeManager(this.workspace)
		const runDir = this.resolveWorktreeRunDir(taskId)
		const branch = `swarm/${taskId}/simple`
		const worktreePath = path.join(runDir, `wt-${builderId}`)

		await wm.create(branch, worktreePath, baseRef)

		try {
			while (true) {
				const builderOutput = await this.runBuilderOnce(
					runnerPath,
					dbPath,
					taskId,
					builderId,
					attemptTask,
					{ SWARM_BUILDER_NO_COMMIT: "true", ...builderEnvOverrides },
					worktreePath,
				)
				await this.commitRepoChanges(worktreePath, `swarm: ${task.slice(0, 72)}`)

				const filesWritten = Array.isArray(builderOutput["filesWritten"])
					? (builderOutput["filesWritten"].filter((f) => typeof f === "string") as string[])
					: []

				const evidence = await this.collectChangeEvidenceAt(worktreePath, baseRef, filesWritten, 50)
				const reviewResult = await this.runReviewerOnce(
					runnerPath,
					dbPath,
					taskId,
					reviewerId,
					task,
					evidence.filesForReview,
					evidence.fileDiffs,
					this.currentContextPack ? formatContextPackPromptSummary(this.currentContextPack, "reviewer") : "",
				)

				if (reviewResult.kind !== "verdict") {
					console.log(`[Orchestrator] ${reviewResult.message}`)
					return {
						status: "review_required",
						message: reviewResult.message,
						stopReason: "reviewer_unavailable",
						taskContract,
					}
				}

				const review = this.printVerdict(reviewResult.payload)
				if (!review.valid || !review.reviewOutputValid) {
					const message = review.feedback || "Reviewer output was invalid or unreadable. Human review required."
					console.log(`[Orchestrator] ${message}`)
					return {
						status: "review_required",
						message,
						stopReason: "reviewer_invalid",
						reviewerVerdict: review.verdict,
						taskContract,
					}
				}

				if (review.verdict === "PASS") {
					const gate = await this.evaluateAcceptanceAt(
						worktreePath,
						baseRef,
						evidence,
						"PASS",
						review.reviewOutputValid,
						isCodeChangingTask,
						taskContract,
					)
					if (!gate.acceptanceGate.passed) {
						const message = this.formatAcceptanceFailureMessage(gate.acceptanceGate)
						console.log(`[Orchestrator] ${message}`)
						return {
							status: "review_required",
							message,
							stopReason: this.mapAcceptanceFailureToStopReason(gate.acceptanceGate),
							reviewerVerdict: "PASS",
							changedFiles: evidence.changedFiles,
							createdFiles: gate.createdFiles,
							branchNames: [branch],
							taskContract: gate.normalizedTaskContract,
							acceptanceGate: gate.acceptanceGate,
						}
					}

					const verificationProfile = await this.runPostEditVerification(
						worktreePath,
						evidence.changedFiles,
						isCodeChangingTask,
					)
					if (verificationProfile.status !== "passed" && verificationProfile.status !== "not_applicable") {
						const message = this.buildVerificationFailureMessage(verificationProfile)
						console.log(`[Orchestrator] ${message}`)
						return {
							status: "review_required",
							message,
							stopReason: this.mapVerificationStopReason(verificationProfile),
							reviewerVerdict: "PASS",
							changedFiles: evidence.changedFiles,
							createdFiles: gate.createdFiles,
							branchNames: [branch],
							taskContract: gate.normalizedTaskContract,
							acceptanceGate: gate.acceptanceGate,
							verificationProfile,
						}
					}

					await this.mergeBranchIntoMain(branch, `swarm: integrate ${branch}`)
					return {
						status: "done",
						message: this.buildSuccessMessage(isCodeChangingTask, verificationProfile),
						stopReason: "success",
						reviewerVerdict: "PASS",
						changedFiles: evidence.changedFiles,
						createdFiles: gate.createdFiles,
						branchNames: [branch],
						taskContract: gate.normalizedTaskContract,
						acceptanceGate: gate.acceptanceGate,
						verificationProfile,
					}
				}

				if (retries < 2) {
					console.log(`[Orchestrator] NEEDS_WORK - retry ${retries + 1}/2`)
					retries++
					attemptTask = `${task}\n\nPrevious attempt feedback:\n${review.feedback || "(no feedback)"}`
					continue
				}

				const message = "Reviewer returned NEEDS_WORK after the retry limit. Human review required."
				console.log(`[Orchestrator] ${message}`)
				return {
					status: "review_required",
					message,
					stopReason: "review_blocked",
					reviewerVerdict: "NEEDS_WORK",
					changedFiles: evidence.changedFiles,
					branchNames: [branch],
					taskContract,
				}
			}
		} finally {
			try {
				await wm.remove(worktreePath, true)
			} catch (err) {
				console.warn(`[Orchestrator] Worktree cleanup warning: ${err instanceof Error ? err.message : String(err)}`)
			}
			try {
				await wm.prune()
			} catch {
				// ignore
			}
		}
	}

	private async runComplexOnce(
		runnerPath: string,
		dbPath: string,
		taskId: string,
		baseRef: string,
		task: string,
		subtasks: Subtask[],
		taskContract: TaskContract | null = null,
	): Promise<PhaseResult> {
		const reviewerId = "reviewer-1"
		const isCodeChangingTask = this.taskAppearsCodeChanging(task)

		const contextFiles = Array.from(new Set(subtasks.flatMap((s) => s.files)))
		const branches = subtasks.map((s) => `swarm/${taskId}/${s.id}`)
		const mergeBranches =
			this.currentMergeOrder?.status === "planned" && this.currentMergeOrder.sequence.length === branches.length
				? this.currentMergeOrder.sequence.map((entry) => entry.branchName)
				: branches
		const integrationBranch = `swarm/${taskId}/integration`

		const finalizeReview = async (repoPath: string, fallbackFiles: string[]): Promise<PhaseResult> => {
			const evidence = await this.collectChangeEvidenceAt(repoPath, baseRef, fallbackFiles, 100)
			const reviewResult = await this.runReviewerOnce(
				runnerPath,
				dbPath,
				taskId,
				reviewerId,
				task,
				evidence.filesForReview,
				evidence.fileDiffs,
				this.currentContextPack ? formatContextPackPromptSummary(this.currentContextPack, "reviewer") : "",
			)

			if (reviewResult.kind !== "verdict") {
				console.log(`[Orchestrator] ${reviewResult.message}`)
				return {
					status: "review_required",
					message: reviewResult.message,
					stopReason: "reviewer_unavailable",
					taskContract,
				}
			}

			const review = this.printVerdict(reviewResult.payload)
			if (!review.valid || !review.reviewOutputValid) {
				const message = review.feedback || "Reviewer output was invalid or unreadable. Human review required."
				console.log(`[Orchestrator] ${message}`)
				return {
					status: "review_required",
					message,
					stopReason: "reviewer_invalid",
					reviewerVerdict: review.verdict,
					taskContract,
				}
			}

			if (review.verdict !== "PASS") {
				const message = "COMPLEX path reviewer returned NEEDS_WORK. Human review required."
				console.log(`[Orchestrator] ${message}`)
				return {
					status: "review_required",
					message,
					stopReason: "review_blocked",
					reviewerVerdict: "NEEDS_WORK",
					changedFiles: evidence.changedFiles,
					branchNames: [...mergeBranches, integrationBranch],
					taskContract,
				}
			}

			const gate = await this.evaluateAcceptanceAt(
				repoPath,
				baseRef,
				evidence,
				"PASS",
				review.reviewOutputValid,
				isCodeChangingTask,
				taskContract,
			)
			if (!gate.acceptanceGate.passed) {
				const message = this.formatAcceptanceFailureMessage(gate.acceptanceGate)
				console.log(`[Orchestrator] ${message}`)
				return {
					status: "review_required",
					message,
					stopReason: this.mapAcceptanceFailureToStopReason(gate.acceptanceGate),
					reviewerVerdict: "PASS",
					changedFiles: evidence.changedFiles,
					createdFiles: gate.createdFiles,
					branchNames: [...mergeBranches, integrationBranch],
					taskContract: gate.normalizedTaskContract,
					acceptanceGate: gate.acceptanceGate,
				}
			}

			const verificationProfile = await this.runPostEditVerification(repoPath, evidence.changedFiles, isCodeChangingTask)
			if (verificationProfile.status !== "passed" && verificationProfile.status !== "not_applicable") {
				const message = this.buildVerificationFailureMessage(verificationProfile)
				console.log(`[Orchestrator] ${message}`)
				return {
					status: "review_required",
					message,
					stopReason: this.mapVerificationStopReason(verificationProfile),
					reviewerVerdict: "PASS",
					changedFiles: evidence.changedFiles,
					createdFiles: gate.createdFiles,
					branchNames: [...mergeBranches, integrationBranch],
					taskContract: gate.normalizedTaskContract,
					acceptanceGate: gate.acceptanceGate,
					verificationProfile,
				}
			}

			return {
				status: "done",
				message: this.buildSuccessMessage(isCodeChangingTask, verificationProfile),
				stopReason: "success",
				reviewerVerdict: "PASS",
				changedFiles: evidence.changedFiles,
				createdFiles: gate.createdFiles,
				branchNames: [...mergeBranches, integrationBranch],
				taskContract: gate.normalizedTaskContract,
				acceptanceGate: gate.acceptanceGate,
				verificationProfile,
			}
		}

		if (this.dryRun) {
			const outputs = await Promise.all(
				subtasks.map((s) => {
					const builderTask =
						`Parent task: ${task}\n` +
						`Subtask (${s.id}): ${s.description}\n` +
						`Allowed files: ${s.files.join(", ")}\n\n` +
						"Rules:\n- Only modify the allowed files.\n"

					return this.runBuilderOnce(
						runnerPath,
						dbPath,
						taskId,
						s.assignedBuilder,
						builderTask,
						(() => {
							const teamShape = this.currentPlanArtifact?.teamShape ?? null
							const builderProfile = findTeamShapeBuilderProfile(teamShape, s.id, s.assignedBuilder)
							const teamShapeSummary = teamShape
								? formatTeamShapePromptSummary(teamShape, {
										workItemId: s.id,
										assignedBuilder: s.assignedBuilder,
								  })
								: ""
							const envOverrides: Record<string, string> = {
								SWARM_BUILDER_NO_COMMIT: "true",
								SWARM_BUILDER_ALLOWED_FILES_JSON: JSON.stringify(s.files),
								SWARM_BUILDER_CONTEXT_FILES_JSON: JSON.stringify(contextFiles),
								...(builderProfile ? { SWARM_BUILDER_SPECIALIZATION_ID: builderProfile.specializationId } : {}),
								...(teamShapeSummary ? { SWARM_BUILDER_TEAM_SHAPE_SUMMARY: teamShapeSummary } : {}),
							}
							const subtaskPath = this.currentRunDir ? this.currentSubtaskContextPackPaths?.[s.id] ?? null : null
							if (subtaskPath) {
								envOverrides["SWARM_BUILDER_CONTEXT_PACK_PATH"] = subtaskPath
							} else if (this.currentContextPack && this.currentRunDir) {
								envOverrides["SWARM_BUILDER_CONTEXT_PACK_PATH"] = resolveContextPackArtifactPath(this.currentRunDir)
							}
							return envOverrides
						})(),
					)
				}),
			)

			const fallbackFiles = (() => {
				const set = new Set<string>()
				for (const out of outputs) {
					const filesWritten = Array.isArray(out["filesWritten"]) ? out["filesWritten"] : []
					for (const f of filesWritten) if (typeof f === "string" && f.trim()) set.add(f.trim())
				}
				return Array.from(set)
			})()

			return finalizeReview(this.workspace, fallbackFiles)
		}

		const wm = new WorktreeManager(this.workspace)
		const runDir = this.resolveWorktreeRunDir(taskId)
		const worktreeByBuilder = new Map<string, string>()
		const integrationWorktree = path.join(runDir, "wt-integration")
		const createdWorktrees: string[] = []

		try {
			console.log(`[Orchestrator] Creating worktrees for ${subtasks.length} builders + integration`)
			for (const s of subtasks) {
				const branch = `swarm/${taskId}/${s.id}`
				const worktreePath = path.join(runDir, `wt-${s.assignedBuilder}`)
				await wm.create(branch, worktreePath, baseRef)
				worktreeByBuilder.set(s.assignedBuilder, worktreePath)
				createdWorktrees.push(worktreePath)
				console.log(`[Orchestrator] Worktree ready: ${s.assignedBuilder} -> ${worktreePath}`)
			}
			await wm.create(integrationBranch, integrationWorktree, baseRef)
			createdWorktrees.push(integrationWorktree)
			console.log(`[Orchestrator] Worktree ready: integration -> ${integrationWorktree}`)

			const builderResults = await Promise.allSettled(
				subtasks.map((s) => {
					const builderTask =
						`Parent task: ${task}\n` +
						`Subtask (${s.id}): ${s.description}\n` +
						`Allowed files: ${s.files.join(", ")}\n\n` +
						"Rules:\n- Only modify the allowed files.\n"

					const builderWorkspace = worktreeByBuilder.get(s.assignedBuilder) ?? this.workspace
					console.log(`[${s.assignedBuilder}] Starting (worktree: ${builderWorkspace})`)
					return this.runBuilderOnce(
						runnerPath,
						dbPath,
						taskId,
						s.assignedBuilder,
						builderTask,
						(() => {
							const teamShape = this.currentPlanArtifact?.teamShape ?? null
							const builderProfile = findTeamShapeBuilderProfile(teamShape, s.id, s.assignedBuilder)
							const teamShapeSummary = teamShape
								? formatTeamShapePromptSummary(teamShape, {
										workItemId: s.id,
										assignedBuilder: s.assignedBuilder,
								  })
								: ""
							const envOverrides: Record<string, string> = {
								SWARM_BUILDER_NO_COMMIT: "true",
								SWARM_BUILDER_ALLOWED_FILES_JSON: JSON.stringify(s.files),
								SWARM_BUILDER_CONTEXT_FILES_JSON: JSON.stringify(contextFiles),
								...(builderProfile ? { SWARM_BUILDER_SPECIALIZATION_ID: builderProfile.specializationId } : {}),
								...(teamShapeSummary ? { SWARM_BUILDER_TEAM_SHAPE_SUMMARY: teamShapeSummary } : {}),
							}
							const subtaskPath = this.currentRunDir ? this.currentSubtaskContextPackPaths?.[s.id] ?? null : null
							if (subtaskPath) {
								envOverrides["SWARM_BUILDER_CONTEXT_PACK_PATH"] = subtaskPath
							} else if (this.currentContextPack && this.currentRunDir) {
								envOverrides["SWARM_BUILDER_CONTEXT_PACK_PATH"] = resolveContextPackArtifactPath(this.currentRunDir)
							}
							return envOverrides
						})(),
						builderWorkspace,
					)
				}),
			)

			const successfulBuilders: Array<{ subtask: Subtask; output: Record<string, unknown> }> = []
			for (const [index, result] of builderResults.entries()) {
				const subtask = subtasks[index]
				if (!subtask) continue
				if (result.status === "rejected") {
					const err = result.reason instanceof Error ? result.reason : new Error(String(result.reason))
					this.setAbortError(err)
					continue
				}
				successfulBuilders.push({ subtask, output: result.value })
			}

			for (const { subtask } of successfulBuilders) {
				const builderWorkspace = worktreeByBuilder.get(subtask.assignedBuilder)
				if (!builderWorkspace) continue
				const committed = await this.commitRepoChanges(builderWorkspace, `swarm: ${subtask.description.slice(0, 72)}`)
				if (!committed) continue
				this.recordAssignmentCheckpoint(
					taskId,
					subtask.id,
					`swarm/${taskId}/${subtask.id}`,
					`Committed isolated builder branch for ${subtask.id} before final merge or review.`,
				)
			}

			const outputs = successfulBuilders.map((builder) => builder.output)
			if (this.abortError) throw this.abortError

			const fallbackFiles = (() => {
				const set = new Set<string>()
				for (const out of outputs) {
					const filesWritten = Array.isArray(out["filesWritten"]) ? out["filesWritten"] : []
					for (const f of filesWritten) if (typeof f === "string" && f.trim()) set.add(f.trim())
				}
				return Array.from(set)
			})()

			const mergerId = "merger-1"
			const mergePayload = await this.runMergerOnce(runnerPath, dbPath, taskId, mergerId, task, mergeBranches, integrationWorktree)

			const conflicted = Array.isArray(mergePayload["conflictedBranches"])
				? mergePayload["conflictedBranches"].filter((b) => typeof b === "string" && b.trim()).map((b) => String(b))
				: []
			if (conflicted.length > 0) {
				throw new Error(`Merge conflicts in: ${conflicted.join(", ")}`)
			}

			const reviewResult = await finalizeReview(integrationWorktree, fallbackFiles)
			if (reviewResult.status === "done") {
				await this.mergeBranchIntoMain(integrationBranch, `swarm: integrate ${integrationBranch}`)
			}
			return reviewResult
		} finally {
			if (createdWorktrees.length > 0) {
				console.log(`[Orchestrator] Cleaning up ${createdWorktrees.length} worktree(s)`)
			}
			for (const worktreePath of createdWorktrees) {
				try {
					await wm.remove(worktreePath)
				} catch (err) {
					console.warn(`[Orchestrator] Worktree cleanup warning: ${err instanceof Error ? err.message : String(err)}`)
				}
			}
			try {
				await wm.prune()
			} catch {
				// ignore
			}
		}
	}

	private inferFailureStopReason(message: string, error?: Error): StopReason {
		if (error instanceof ProviderError) {
			switch (error.bucket) {
				case "provider_auth_failure":
					return "provider_auth_failure"
				case "provider_launch_failure":
					return "provider_launch_failure"
				case "provider_timeout":
					return "provider_timeout"
				case "provider_malformed_response":
					return "provider_malformed_response"
				case "provider_empty_response":
					return "provider_empty_response"
				case "provider_transport_failure":
					return "provider_transport_failure"
				case "provider_ceiling_reached":
					return "provider_ceiling_reached"
				default:
					return "unknown"
			}
		}

		if (error instanceof GuardrailError) {
			switch (error.code) {
				case "workspace_run_locked":
					return "workspace_run_locked"
				case "model_call_ceiling":
					return "model_call_ceiling"
				case "usage_budget_ceiling":
					return "usage_budget_ceiling"
				default:
					return "unknown"
			}
		}

		if (this.abortStopReason) return this.abortStopReason

		const lower = message.toLowerCase()
		if (lower.includes("dirty run unless --allowdirty")) return "dirty_repo_refusal"
		if (lower.includes("workspace has uncommitted")) return "dirty_repo_refusal"
		if (lower.includes("active live run lock") || lower.includes("workspace already has an active live run lock")) {
			return "workspace_run_locked"
		}
		if (lower.includes("command blocked")) return "command_blocked"
		if (lower.includes("merge conflict")) return "merge_conflict"
		if (lower.includes("went silent") || lower.includes("watchdog")) return "watchdog_abort"
		if (lower.includes("operator requested abort")) return "operator_abort"
		if (lower.includes("verification profile") && lower.includes("timed out")) return "verification_timeout"
		if (lower.includes("verification profile") && lower.includes("blocked")) return "verification_command_blocked"
		if (lower.includes("verification profile") && lower.includes("failed")) return "verification_failed"
		if (lower.includes("run-duration ceiling")) return "run_duration_ceiling"
		if (lower.includes("model_call_ceiling") || lower.includes("model-call ceiling")) return "model_call_ceiling"
		if (lower.includes("usage_budget_ceiling") || lower.includes("estimated usage budget")) return "usage_budget_ceiling"
		if (lower.includes("timeout")) return "timeout"
		if (lower.includes("model_call_ceiling_exceeded")) return "ceiling_reached"
		if (lower.includes("provider auth/config")) return "provider_auth_failure"
		if (lower.includes("provider launch failed")) return "provider_launch_failure"
		if (lower.includes("provider returned malformed")) return "provider_malformed_response"
		if (lower.includes("provider returned an empty")) return "provider_empty_response"
		if (lower.includes("provider transport failed")) return "provider_transport_failure"
		if (lower.includes("max_iterations")) return "ceiling_reached"
		if (lower.includes("agent reported error")) return "agent_error"
		return "unknown"
	}

	async run(task: string, options: { taskContract?: TaskContract | null } = {}): Promise<OrchestratorRunResult> {
		this.abortError = null
		this.abortStopReason = null
		this.currentWorkspaceRunLockRecord = null
		this.currentPlanArtifact = null
		this.currentAssignmentLedger = null
		this.currentDependencyGraph = null
		this.currentAskSiblingLedger = null
		this.currentMergeOrder = null
		this.currentCheckpointBoundaries = []
		this.currentRepoMap = null
		this.currentContextPack = null
		this.currentSubtaskContextPackPaths = null
		this.currentPatternMemory = null
		const taskId = `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
		const activeProfileManifestHash = this.resolveActiveProfileManifestHash()
		const roleManuals = listRoleManualReferences(["supervisor", "builder", "critic", "reviewer"])
		const startedAtIso = new Date().toISOString()
		const startedAtMs = Date.now()
		const runDir = ensureRunDir(this.workspace, taskId)
		this.currentRunDir = runDir
		this.currentTaskId = taskId
		appendRunEvent(runDir, {
			type: "run_start",
			taskId,
			task,
			workspace: this.workspace,
			dryRun: this.dryRun,
			allowDirty: this.allowDirty,
		})
		appendRunEvent(runDir, {
			type: "role_manuals_selected",
			taskId,
			roleManuals: roleManuals.map((manual) => `${manual.role}@${manual.version}`),
		})
		let complexity: Complexity | null = null
		let pathChosen: RoutingPath | null = null
		let modelClassificationUsed = false

		console.log(`[Orchestrator] Starting task: "${task}"${this.dryRun ? " (dry-run)" : ""}`)

		this.db.run("INSERT INTO tasks (id, description, status, complexity) VALUES (?,?,?,?)", [taskId, task, "in_progress", null])

		// Clear stale unread messages from prior runs (prevents false positives).
		this.db.run("UPDATE messages SET read = 1 WHERE to_agent = 'orchestrator' AND read = 0")

		const watchdog = new WatchdogDaemon(this.db)
		watchdog.start()

		let finalStatus: TaskStatus = "done"
		let finalMessage = ""
		let finalStopReason: StopReason = "unknown"
		let phaseResult: PhaseResult | null = null
		let baseRef = "HEAD"
		let summaryPath = path.join(runDir, "summary.json")
		const repoMapArtifactPath = resolveRepoMapArtifactPath(runDir)
		const contextPackArtifactPath = resolveContextPackArtifactPath(runDir)
		const replayArtifactPath = resolveReplayArtifactPath(runDir)
		const patternMemoryArtifactPath = resolvePatternMemoryArtifactPath(this.workspace)
		let recoveryReport: RecoveryReport | null = null
		let effectiveTaskContract = normalizeTaskContract(options.taskContract)
		let workspaceRunLockSnapshot: WorkspaceRunLockSnapshot = this.dryRun ? makeDryRunLockSnapshot() : {
			enabled: true,
			acquired: false,
			released: false,
			blockedByActiveRun: false,
			blockingTaskId: null,
			blockingPid: null,
			blockingTask: null,
			acquiredAt: null,
			staleLockCleared: false,
		}
		const defaultGuardrailLimits = this.resolveRunGuardrailLimits(null)
		this.currentMaxModelCalls = defaultGuardrailLimits.maxModelCalls
		this.currentMaxEstimatedTokens = defaultGuardrailLimits.maxEstimatedTokens
		const runCeilingTimer = setTimeout(() => {
			this.requestAbort(
				`Run-duration ceiling reached after ${this.runtimeConfig.overallRunCeilingMs}ms. Aborting run.`,
				"run_duration_ceiling",
			)
		}, this.runtimeConfig.overallRunCeilingMs)
		runCeilingTimer.unref?.()

		try {
			if (!this.dryRun) {
				const lockResult = acquireWorkspaceRunLock(this.db, this.workspace, { taskId, task })
				workspaceRunLockSnapshot = lockResult.snapshot
				if (!lockResult.acquired) {
					const message = formatWorkspaceRunLockBlockMessage(lockResult.snapshot)
					console.log(`[Orchestrator] ${message}`)
					throw new GuardrailError("workspace_run_locked", message, {
						blockingTaskId: lockResult.snapshot.blockingTaskId,
						blockingPid: lockResult.snapshot.blockingPid,
						acquiredAt: lockResult.snapshot.acquiredAt,
					})
				}
				this.currentWorkspaceRunLockRecord = lockResult.record
			}

			initializeRunGuardrails(this.db, taskId, defaultGuardrailLimits)
			appendRunEvent(runDir, {
				type: "guardrails_initialized",
				taskId,
				maxModelCalls: defaultGuardrailLimits.maxModelCalls,
				maxEstimatedTokens: defaultGuardrailLimits.maxEstimatedTokens,
				maxConcurrentLiveRunsPerWorkspace: this.runtimeConfig.maxConcurrentLiveRunsPerWorkspace,
				workspaceRunLockEnabled: !this.dryRun,
			})

			if (!this.dryRun) {
				const inventory = await inventoryRecoverableState(this.workspace, this.db)
				appendRunEvent(runDir, {
					type: "recovery_inventory",
					taskId,
					orphanedWorktreeCount: inventory.orphanedWorktrees.length,
					orphanedBranchCount: inventory.orphanedSwarmBranches.length,
					staleTaskCount: inventory.staleTaskIds.length,
					incompleteRunArtifactCount: inventory.incompleteRunArtifacts.length,
				})
				recoveryReport = await reconcileOwnedState(this.workspace, this.db)
				appendRunEvent(runDir, {
					type: "recovery_reconcile",
					taskId,
					removedWorktreeCount: recoveryReport.removedWorktrees.length,
					removedBranchCount: recoveryReport.removedBranches.length,
					removedTmpEntryCount: recoveryReport.removedTmpEntries.length,
					reconciledTaskCount: recoveryReport.reconciledTaskIds.length,
					recoveredRunArtifactCount: recoveryReport.recoveredRunArtifacts.length,
					warningCount: recoveryReport.warnings.length,
				})
			}

			await this.ensureWorkspaceReadyForLiveRun()
			baseRef = await this.getBaseRef()

			const dbPath = path.join(this.workspace, ".swarm", "swarmcoder.db")
			const runnerTsPath = path.join(__dirname, "runner", "agentRunner.ts")
			const runnerJsPath = path.join(__dirname, "runner", "agentRunner.js")
			const runnerPath = fs.existsSync(runnerJsPath) ? runnerJsPath : runnerTsPath

			const coordinator = new CoordinatorAgent(this.createInlineModelClient("coordinator"))
			const fileList = this.listWorkspaceFiles()
			this.currentRepoMap = await buildRepoMapArtifact(this.workspace, {
				fileList,
				generatedAt: startedAtIso,
			})
			writeRepoMapArtifact(runDir, this.currentRepoMap)
			appendRunEvent(runDir, {
				type: "repo_map_built",
				taskId,
				totalFiles: this.currentRepoMap.totalFiles,
				entryPointCount: this.currentRepoMap.likelyEntryPoints.length,
				topLevelCount: this.currentRepoMap.topLevelEntries.length,
				repoMapArtifactPath,
			})
			const routing = await coordinator.classifyDetailed(task, fileList, { workspaceRoot: this.workspace })
			complexity = routing.complexity
			pathChosen = routing.path
			modelClassificationUsed = routing.usedModel
			const selectedGuardrailLimits = this.resolveRunGuardrailLimits(pathChosen)
			this.currentModeSelector = buildModeSelectorDecision({
				routing,
				guardrailLimits: selectedGuardrailLimits,
			})
			this.currentFastLane = buildFastLaneDecision(this.currentModeSelector)
			this.currentMaxModelCalls = selectedGuardrailLimits.maxModelCalls
			this.currentMaxEstimatedTokens = selectedGuardrailLimits.maxEstimatedTokens
			updateRunGuardrailLimits(this.db, taskId, selectedGuardrailLimits)
			effectiveTaskContract = mergeTaskContracts(effectiveTaskContract, this.buildDerivedTaskContract(routing))
			const contextPackTargets =
				effectiveTaskContract?.scope?.allowedFiles && effectiveTaskContract.scope.allowedFiles.length > 0
					? effectiveTaskContract.scope.allowedFiles
					: routing.targetFiles
			const scoutLaneEvidence = buildScoutLaneEvidence({
				task,
				routing,
				repoMap: this.currentRepoMap,
				taskContract: effectiveTaskContract,
			})
			if (contextPackTargets.length > 0 || (effectiveTaskContract?.scope?.readOnlyContextFiles?.length ?? 0) > 0) {
				this.currentContextPack = buildContextPackArtifact(this.workspace, {
					taskFiles: contextPackTargets,
					repoMap: this.currentRepoMap,
					taskContract: effectiveTaskContract,
					scoutNotes: scoutLaneEvidence.notes,
					scoutContextFiles: scoutLaneEvidence.contextFiles,
					generatedAt: startedAtIso,
				})
				writeContextPackArtifact(runDir, this.currentContextPack)
				appendRunEvent(runDir, {
					type: "context_pack_built",
					taskId,
					selectedFileCount: this.currentContextPack.selectedFiles.length,
					omittedFileCount: this.currentContextPack.omittedFiles.length,
					previewBytesUsed: this.currentContextPack.previewBytesUsed,
					contextPackArtifactPath,
				})
			}
			this.currentPatternMemory = buildPatternMemoryArtifact(this.workspace, {
				pathChosen: routing.path,
				taskContract: effectiveTaskContract,
				repoMap: this.currentRepoMap,
				generatedAt: startedAtIso,
			})
			writePatternMemoryArtifact(this.workspace, this.currentPatternMemory)
			const workspaceMemorySummary = formatWorkspaceMemoryPromptSummary(
				buildWorkspaceMemoryOverview(this.workspace, {
					generatedAt: startedAtIso,
				}),
			)
			appendRunEvent(runDir, {
				type: "pattern_memory_matched",
				taskId,
				acceptedRunCount: this.currentPatternMemory.acceptedRunCount,
				suggestedPatternCount: this.currentPatternMemory.suggestedPatterns.length,
				patternMemoryArtifactPath,
			})
			console.log(`[Coordinator] Complexity: ${complexity}`)
			if (pathChosen === "small_task" || pathChosen === "scoped" || pathChosen === "medium" || pathChosen === "semi_open") {
				console.log(`[Coordinator] Path chosen: ${pathChosen}`)
			}
			if (this.currentModeSelector) {
				console.log(`[ModeSelector] ${formatModeSelectorDecision(this.currentModeSelector)}`)
				appendRunEvent(runDir, {
					type: "mode_selected",
					taskId,
					modeId: this.currentModeSelector.modeId,
					routingPath: this.currentModeSelector.routingPath,
					costTier: this.currentModeSelector.costTier,
					steeringTier: this.currentModeSelector.steeringTier,
					selectorSource: this.currentModeSelector.selectorSource,
				})
			}
			if (this.currentFastLane) {
				console.log(`[FastLane] ${formatFastLaneDecision(this.currentFastLane)}`)
				appendRunEvent(runDir, {
					type: "fast_lane_selected",
					taskId,
					laneId: this.currentFastLane.laneId,
					predictability: this.currentFastLane.predictability,
					expectedWorkItems: this.currentFastLane.expectedWorkItems,
					expectedBuilderCount: this.currentFastLane.expectedBuilderCount,
				})
			}
			console.log(
				`[Orchestrator] Guardrails: runtime<=${this.runtimeConfig.overallRunCeilingMs}ms | modelCalls<=${this.currentMaxModelCalls} | estimatedTokens<=${this.currentMaxEstimatedTokens} | liveWorkspaceRuns<=${this.runtimeConfig.maxConcurrentLiveRunsPerWorkspace}`,
			)

			this.db.run("UPDATE tasks SET complexity = ? WHERE id = ?", [complexity, taskId])

			const scopedFiles = effectiveTaskContract?.scope?.allowedFiles ?? routing.targetFiles
			const simpleBuilderEnv: Record<string, string> =
				scopedFiles.length > 0
					? {
							SWARM_BUILDER_ALLOWED_FILES_JSON: JSON.stringify(scopedFiles),
							SWARM_BUILDER_CONTEXT_FILES_JSON: JSON.stringify(
								effectiveTaskContract?.scope?.readOnlyContextFiles ?? scopedFiles,
							),
							SWARM_BUILDER_SPECIALIZATION_ID: "solo_owner",
							...(this.currentContextPack ? { SWARM_BUILDER_CONTEXT_PACK_PATH: contextPackArtifactPath } : {}),
							SWARM_BUILDER_MAX_ITERATIONS: "4",
					  }
					: {}

			if (complexity === "SIMPLE") {
				this.currentPlanArtifact = null
				this.currentAssignmentLedger = null
				this.currentDependencyGraph = null
				this.currentAskSiblingLedger = null
				this.currentMergeOrder = null
				phaseResult = await this.runSimpleWithRetry(runnerPath, dbPath, taskId, baseRef, task, simpleBuilderEnv, effectiveTaskContract)
			} else {
				const arbitration = buildSupervisorArbitration({
					task,
					routing,
					taskContract: effectiveTaskContract,
				})
				const subtasks = await this.planComplexSubtasks(
					task,
					fileList,
					routing,
					arbitration,
					arbitration.activeBuilderCount,
					workspaceMemorySummary,
					this.currentRepoMap,
					this.currentContextPack,
					this.currentPatternMemory,
				)
				this.currentPlanArtifact = buildSwarmPlanArtifact({
					task,
					routing,
					subtasks,
					builderCountRequested: arbitration.requestedBuilderCount,
					repoMap: this.currentRepoMap,
					taskContract: effectiveTaskContract,
					arbitration: {
						...arbitration,
						activeBuilderCount: Math.max(1, subtasks.length),
					},
					createdAt: startedAtIso,
				})
				appendRunEvent(runDir, {
					type: "plan_built",
					taskId,
					pathChosen: routing.path,
					planStatus: this.currentPlanArtifact.planStatus,
					workItemCount: this.currentPlanArtifact.workItems.length,
					builderCountRequested: this.currentPlanArtifact.builderCountRequested,
					builderCountRecommended: this.currentPlanArtifact.builderCountRecommended,
					scoutCoverageSource: this.currentPlanArtifact.scoutCoverage.source,
				})
				if (this.currentPlanArtifact.planStatus !== "planned") {
					throw new Error("Planner could not produce a safe bounded plan.")
				}
				this.currentAssignmentLedger = buildAssignmentLedger(this.currentPlanArtifact, subtasks)
				appendRunEvent(runDir, {
					type: "assignments_created",
					taskId,
					handoffValid: this.currentAssignmentLedger.handoffValid,
					assignmentCount: this.currentAssignmentLedger.assignments.length,
				})
				if (!this.currentAssignmentLedger.handoffValid) {
					throw new Error(`Assignment handoff validation failed: ${this.currentAssignmentLedger.handoffIssues.join("; ")}`)
				}
				this.currentDependencyGraph = buildDependencyGraphArtifact({
					plan: this.currentPlanArtifact,
					assignments: this.currentAssignmentLedger,
				})
				appendRunEvent(runDir, {
					type: "dependency_graph_built",
					taskId,
					graphStatus: this.currentDependencyGraph.status,
					stageCount: this.currentDependencyGraph.stageCount,
					routeCount: this.currentDependencyGraph.routes.length,
					blockerCount: this.currentDependencyGraph.blockers.length,
				})
				if (this.currentDependencyGraph.status === "blocked") {
					throw new Error(`Dependency graph failed: ${this.currentDependencyGraph.blockers.join("; ")}`)
				}
				const subtaskContextPacks = buildSubtaskContextPackArtifacts(this.workspace, {
					subtasks,
					repoMap: this.currentRepoMap,
					taskContract: effectiveTaskContract,
					scoutNotes: this.currentPlanArtifact.scoutCoverage.notes,
					scoutContextFiles: this.currentPlanArtifact.scoutCoverage.contextFiles,
					generatedAt: startedAtIso,
				})
				this.currentSubtaskContextPackPaths = Object.fromEntries(
					Object.entries(subtaskContextPacks).map(([workItemId, pack]) => [workItemId, writeSubtaskContextPackArtifact(runDir, workItemId, pack)]),
				)
				appendRunEvent(runDir, {
					type: "subtask_context_packs_built",
					taskId,
					subtaskCount: Object.keys(this.currentSubtaskContextPackPaths).length,
				})
				this.currentAskSiblingLedger = createAskSiblingLedger(this.currentDependencyGraph, this.currentPlanArtifact.arbitration)
				appendRunEvent(runDir, {
					type: "ask_sibling_enabled",
					taskId,
					maxExchangesPerWorkItem: this.currentAskSiblingLedger.limits.maxExchangesPerWorkItem,
					routeCount: this.currentAskSiblingLedger.coordinationPolicy.routeCount,
				})
				this.currentMergeOrder = buildMergeOrderArtifact({
					taskId,
					plan: this.currentPlanArtifact,
					assignments: this.currentAssignmentLedger,
				})
				appendRunEvent(runDir, {
					type: "merge_order_planned",
					taskId,
					mergeOrderStatus: this.currentMergeOrder.status,
					sequenceLength: this.currentMergeOrder.sequence.length,
					blockerCount: this.currentMergeOrder.blockers.length,
				})
				if (this.currentMergeOrder.status === "blocked") {
					throw new Error(`Merge sequencing failed: ${this.currentMergeOrder.blockers.join("; ")}`)
				}
				phaseResult = await this.runComplexOnce(
					runnerPath,
					dbPath,
					taskId,
					baseRef,
					task,
					subtasks,
					effectiveTaskContract,
				)
			}

			finalStatus = phaseResult.status
			finalMessage = phaseResult.message
			finalStopReason = phaseResult.stopReason

			if (finalStatus === "done") {
				console.log("[Orchestrator] Task complete.")
			}
		} catch (err) {
			finalStatus = "failed"
			const error = err instanceof Error ? err : new Error(String(err))
			this.setAbortError(error)
			finalMessage = error.message
			finalStopReason = this.inferFailureStopReason(finalMessage, error)
			console.error(`[Orchestrator] Run failed: ${finalMessage}`)
		} finally {
			clearTimeout(runCeilingTimer)
			watchdog.stop()
			this.db.run("UPDATE tasks SET status=?, finished_at=? WHERE id=?", [
				finalStatus,
				new Date().toISOString(),
				taskId,
			])

			appendRunEvent(runDir, {
				type: "run_end",
				taskId,
				status: finalStatus,
				stopReason: finalStopReason,
				message: finalMessage,
			})

			const events = readRunEvents(runDir)
			const modelCalls = events.filter((event) => event.type === "model_call")
			const builderIterations = events
				.filter((event) => event.type === "agent_iteration" && event.role === "builder")
				.reduce((sum, event) => sum + (typeof event.iteration === "number" ? event.iteration : 0), 0)
			const agentCount = new Set(
				events
					.filter((event) => event.type === "agent_start")
					.map((event) => String(event.agentId ?? ""))
					.filter(Boolean),
			).size
			const estimatedPromptTokens = modelCalls.reduce(
				(sum, event) => sum + (typeof event.estimatedPromptTokens === "number" ? event.estimatedPromptTokens : 0),
				0,
			)
			const estimatedResponseTokens = modelCalls.reduce(
				(sum, event) => sum + (typeof event.estimatedResponseTokens === "number" ? event.estimatedResponseTokens : 0),
				0,
			)
			const estimatedTotalTokens = estimatedPromptTokens + estimatedResponseTokens
			const providerFailures = events.filter((event) => event.type === "provider_failure")
			const providerRetries = events.filter((event) => event.type === "provider_retry")
			const lastProviderFailure = providerFailures.at(-1)
			const guardrailUsage = readRunGuardrailUsage(this.db, taskId)
			if (!this.dryRun && this.currentWorkspaceRunLockRecord) {
				workspaceRunLockSnapshot = {
					...workspaceRunLockSnapshot,
					released: releaseWorkspaceRunLock(this.db, this.currentWorkspaceRunLockRecord),
				}
			}
			const durationMs = Date.now() - startedAtMs
			const resolvedModelCallLimit =
				guardrailUsage?.maxModelCalls ?? this.currentMaxModelCalls ?? defaultGuardrailLimits.maxModelCalls
			const resolvedEstimatedTokenLimit =
				guardrailUsage?.maxEstimatedTokens ?? this.currentMaxEstimatedTokens ?? defaultGuardrailLimits.maxEstimatedTokens
			const usedModelCalls = guardrailUsage?.modelCallsUsed ?? modelCalls.length
			const usedEstimatedTokens = guardrailUsage?.estimatedTokensUsed ?? estimatedTotalTokens
			const finalizedPlan = finalizeSwarmPlanArtifact(this.currentPlanArtifact, finalStatus)
			const completionLedger = buildCompletionLedger({
				runId: taskId,
				finalStatus,
				assignments: this.currentAssignmentLedger,
				proofArtifactPath: summaryPath,
				dependencyGraph: this.currentDependencyGraph,
			})
			const progressMap = buildProgressMap({
				assignments: this.currentAssignmentLedger,
				completionLedger,
				events,
				dependencyGraph: this.currentDependencyGraph,
			})
			const targetedEvaluators = buildTargetedEvaluatorsArtifact({
				plan: finalizedPlan,
				repoMap: this.currentRepoMap,
				taskContract: phaseResult?.taskContract ?? effectiveTaskContract,
				acceptanceGate: phaseResult?.acceptanceGate ?? null,
				verificationProfile: phaseResult?.verificationProfile ?? null,
				changedFiles: phaseResult?.changedFiles ?? [],
			})
			appendRunEvent(runDir, {
				type: "targeted_evaluators_evaluated",
				taskId,
				status: targetedEvaluators.status,
				applicableEvaluatorCount: targetedEvaluators.applicableEvaluatorCount,
				concernCount: targetedEvaluators.concernCount,
			})
			const criticLane = buildCriticArtifact({
				plan: finalizedPlan,
				assignments: this.currentAssignmentLedger,
				mergeOrder: this.currentMergeOrder,
				finalStatus,
				stopReason: finalStopReason,
				reviewerVerdict: phaseResult?.reviewerVerdict ?? null,
				acceptanceGate: phaseResult?.acceptanceGate ?? null,
				verificationProfile: phaseResult?.verificationProfile ?? null,
				changedFiles: phaseResult?.changedFiles ?? [],
				targetedEvaluators,
			})
			appendRunEvent(runDir, {
				type: "critic_evaluated",
				taskId,
				status: criticLane.status,
				enabled: criticLane.enabled,
				concernCount: criticLane.concerns.length,
			})
			const checkpointArtifactPath = resolveCheckpointArtifactPath(runDir)
			const retryPlanner = planRetryWithSnapshot(runDir, {
				runId: taskId,
				task,
				finalStatus,
				stopReason: finalStopReason,
				reviewerVerdict: phaseResult?.reviewerVerdict ?? null,
				acceptanceGate: phaseResult?.acceptanceGate ?? null,
				verificationProfile: phaseResult?.verificationProfile ?? null,
				criticLane,
				assignments: this.currentAssignmentLedger,
				completionLedger,
				taskContract: (phaseResult?.taskContract as Record<string, unknown> | null | undefined) ?? (effectiveTaskContract as Record<string, unknown> | null),
				checkpointRefs: {
					summaryPath,
					reviewPackPath: null,
					incidentPackPath: null,
					checkpointArtifactPath,
				},
				profileManifestHash: activeProfileManifestHash,
				retryCountUsed: 0,
				maxRetryCount: 2,
				continuationState: buildContinuationState(taskId),
			})
			if (retryPlanner.snapshotPath) {
				this.recordRetrySnapshotCheckpoint(taskId, retryPlanner.snapshotPath)
			}
			appendRunEvent(runDir, {
				type: "retry_planner_evaluated",
				taskId,
				decision: retryPlanner.planner.decision,
				retriesRemaining: retryPlanner.planner.retriesRemaining,
				snapshotPath: retryPlanner.snapshotPath,
			})
			const postMergeQuality = buildPostMergeQualityArtifact({
				mergeOrder: this.currentMergeOrder,
				finalStatus,
				verificationProfile: phaseResult?.verificationProfile ?? null,
				changedFiles: phaseResult?.changedFiles ?? [],
				omittedFiles: finalizedPlan?.scoutCoverage.omittedFiles ?? [],
				targetedEvaluators,
			})
			appendRunEvent(runDir, {
				type: "post_merge_quality_evaluated",
				taskId,
				status: postMergeQuality.status,
				blockerCount: postMergeQuality.blockers.length,
			})
			const campaign = retryPlanner.snapshot?.continuation ?? buildContinuationState(taskId)
			const checkpoints = buildCheckpointArtifact({
				runId: taskId,
				runStatus: finalStatus,
				assignments: this.currentAssignmentLedger,
				recordedBoundaries: this.currentCheckpointBoundaries,
				profileManifestHash: activeProfileManifestHash,
				continuationState: campaign,
			})
			if (checkpoints) {
				writeCheckpointArtifact(runDir, checkpoints)
			}
			const mediumLaneReliability = buildMediumLaneReliabilityArtifact({
				plan: finalizedPlan,
				modeSelector: this.currentModeSelector,
				criticLane,
				targetedEvaluators,
				verificationProfile: phaseResult?.verificationProfile ?? null,
				checkpointArtifactPath: checkpoints ? checkpointArtifactPath : null,
				retryPlanner: retryPlanner.planner,
			})

			const summaryRecord = {
				taskId,
				task,
				workspace: this.workspace,
				dryRun: this.dryRun,
				allowDirty: this.allowDirty,
				startedAt: startedAtIso,
				endedAt: new Date().toISOString(),
				durationMs,
				status: finalStatus,
				stopReason: finalStopReason,
				message: finalMessage,
				complexity,
				pathChosen,
				modelClassificationUsed,
				modeSelector: this.currentModeSelector,
				fastLane: this.currentFastLane,
				mediumLaneReliability,
				repoMapArtifactPath: this.currentRepoMap ? repoMapArtifactPath : null,
				repoMap: this.currentRepoMap,
				contextPackArtifactPath: this.currentContextPack ? contextPackArtifactPath : null,
				contextPack: this.currentContextPack,
				subtaskContextPackArtifactPaths: this.currentSubtaskContextPackPaths,
				patternMemoryArtifactPath: this.currentPatternMemory ? patternMemoryArtifactPath : null,
				patternMemory: this.currentPatternMemory,
				plan: finalizedPlan,
				assignments: this.currentAssignmentLedger,
				dependencyGraph: this.currentDependencyGraph,
				askSiblingLedger: this.currentAskSiblingLedger,
				mergeOrder: this.currentMergeOrder,
				targetedEvaluators,
				criticLane,
				retryPlanner: retryPlanner.planner,
				checkpointArtifactPath: checkpoints ? checkpointArtifactPath : null,
				checkpoints,
				completionLedger,
				progressMap,
				postMergeQuality,
				campaign,
				roleManuals,
				profileManifestHash: activeProfileManifestHash,
				taskContract: phaseResult?.taskContract ?? effectiveTaskContract,
				acceptanceGate: phaseResult?.acceptanceGate ?? null,
				verificationProfile: phaseResult?.verificationProfile ?? null,
				agentCount,
				builderIterationCount: builderIterations,
				reviewerVerdict: phaseResult?.reviewerVerdict ?? null,
				changedFiles: phaseResult?.changedFiles ?? [],
				createdFiles: phaseResult?.createdFiles ?? [],
				git: {
					baseRef,
					branches: phaseResult?.branchNames ?? [],
				},
				review: buildInitialReviewRecord(this.workspace, taskId, finalStatus, this.dryRun, phaseResult?.branchNames ?? []),
				recovery: recoveryReport,
				surface: process.env["SWARM_RUN_SURFACE"] ?? "cli_artifact",
				runtime: {
					providerCallTimeoutMs: this.runtimeConfig.providerCallTimeoutMs,
					agentWaitTimeoutMs: this.runtimeConfig.agentWaitTimeoutMs,
				overallRunCeilingMs: this.runtimeConfig.overallRunCeilingMs,
				maxModelCallsPerRun: this.runtimeConfig.maxModelCallsPerRun,
				smallTaskMaxModelCalls: this.runtimeConfig.smallTaskMaxModelCalls,
				mediumTaskMaxModelCalls: this.runtimeConfig.mediumTaskMaxModelCalls,
				maxEstimatedTokensPerRun: this.runtimeConfig.maxEstimatedTokensPerRun,
				smallTaskMaxEstimatedTokens: this.runtimeConfig.smallTaskMaxEstimatedTokens,
				mediumTaskMaxEstimatedTokens: this.runtimeConfig.mediumTaskMaxEstimatedTokens,
				maxConcurrentLiveRunsPerWorkspace: this.runtimeConfig.maxConcurrentLiveRunsPerWorkspace,
				agentStaleThresholdMs: this.runtimeConfig.agentStaleThresholdMs,
				watchdogCheckIntervalMs: this.runtimeConfig.watchdogCheckIntervalMs,
					heartbeatIntervalMs: this.runtimeConfig.heartbeatIntervalMs,
					providerMaxRetries: this.runtimeConfig.providerMaxRetries,
					verificationProfileDefaultTimeoutMs: this.runtimeConfig.verificationProfileDefaultTimeoutMs,
					verificationProfileMaxTimeoutMs: this.runtimeConfig.verificationProfileMaxTimeoutMs,
					verificationProfileMaxOutputChars: this.runtimeConfig.verificationProfileMaxOutputChars,
				},
				provider: {
					provider: process.env["SWARM_PROVIDER"] ?? "openai",
					model: process.env["SWARM_MODEL"] ?? null,
					failureBucket:
						typeof lastProviderFailure?.bucket === "string" ? (lastProviderFailure.bucket as string) : null,
					retryCount: providerRetries.length,
				},
				modelCallCount: modelCalls.length,
				usage: {
					tokenUsageAvailable: false,
					estimatedPromptTokens,
					estimatedResponseTokens,
					estimatedTotalTokens,
				},
				guardrails: {
					runtimeMs: {
						used: durationMs,
						limit: this.runtimeConfig.overallRunCeilingMs,
						reached: finalStopReason === "run_duration_ceiling",
					},
					modelCalls: {
						used: usedModelCalls,
						limit: resolvedModelCallLimit,
						reached: finalStopReason === "model_call_ceiling",
					},
					estimatedUsageTokens: {
						used: usedEstimatedTokens,
						limit: resolvedEstimatedTokenLimit,
						reached: finalStopReason === "usage_budget_ceiling",
					},
					workspaceRunLock: workspaceRunLockSnapshot,
				},
			}
			summaryPath = writeRunSummary(runDir, summaryRecord)
			const replayArtifact = buildReplayArtifact(runDir, summaryPath, summaryRecord, events)
			writeReplayArtifact(runDir, replayArtifact)
			const refreshedPatternMemory = buildPatternMemoryArtifact(this.workspace, {
				pathChosen,
				taskContract: phaseResult?.taskContract ?? effectiveTaskContract,
				repoMap: this.currentRepoMap,
				verificationProfile: phaseResult?.verificationProfile?.profileName ?? null,
				generatedAt: new Date().toISOString(),
			})
			this.currentPatternMemory = refreshedPatternMemory
			writePatternMemoryArtifact(this.workspace, refreshedPatternMemory)
			summaryPath =
				updateRunSummary(runDir, (summary) => ({
					...summary,
					replayArtifactPath,
					replayOverview: {
						gateMode: replayArtifact.gateMode,
						eventCount: replayArtifact.eventCount,
						stageCounts: replayArtifact.stageCounts,
						planningSummary: replayArtifact.overview.planningSummary,
						coordinationSummary: replayArtifact.overview.coordinationSummary,
						reviewSummary: replayArtifact.overview.reviewSummary,
						artifactSummary: replayArtifact.overview.artifactSummary,
						highlightCount: replayArtifact.overview.highlights.length,
						highlights: replayArtifact.overview.highlights,
					},
					reproducibilityOverview: {
						comparisonKey: replayArtifact.reproducibility.comparisonKey,
						outcomeKey: replayArtifact.reproducibility.outcomeKey,
						facts: replayArtifact.reproducibility.facts,
						summary: replayArtifact.reproducibility.summary,
						guidance: replayArtifact.reproducibility.guidance,
					},
					patternMemoryArtifactPath,
					patternMemory: refreshedPatternMemory,
				})) ?? summaryPath
			console.log(
				`[Orchestrator] Guardrails used: runtime ${durationMs}/${this.runtimeConfig.overallRunCeilingMs}ms | model calls ${usedModelCalls}/${resolvedModelCallLimit} | estimated tokens ${usedEstimatedTokens}/${resolvedEstimatedTokenLimit}`,
			)
			if (finalStatus === "review_required") {
				try {
					await ensureReviewPack(this.workspace, taskId)
				} catch (err) {
					console.warn(`[Orchestrator] Review pack warning: ${err instanceof Error ? err.message : String(err)}`)
				}
			}
			this.currentRunDir = null
			this.currentTaskId = null
			this.currentPlanArtifact = null
			this.currentAssignmentLedger = null
			this.currentDependencyGraph = null
			this.currentAskSiblingLedger = null
			this.currentMergeOrder = null
			this.currentCheckpointBoundaries = []
			this.currentMaxModelCalls = null
			this.currentMaxEstimatedTokens = null
			this.currentWorkspaceRunLockRecord = null
			this.currentContextPack = null
			this.currentSubtaskContextPackPaths = null
			this.currentPatternMemory = null
			this.currentModeSelector = null
			this.currentFastLane = null
		}

		console.log(`[Orchestrator] Terminal status: ${finalStatus}`)
		return { taskId, status: finalStatus, complexity, message: finalMessage, stopReason: finalStopReason, summaryPath }
	}

	private async waitForCompletion(
		taskId: string,
		timeoutMs: number,
		childClosed?: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
		fromAgent?: string,
	): Promise<Record<string, unknown>> {
		const start = Date.now()
		let childExit: { code: number | null; signal: NodeJS.Signals | null } | null = null
		let childExitAt = 0

		const sleep = async (ms: number): Promise<void> => {
			await new Promise((r) => setTimeout(r, ms))
		}

		while (Date.now() - start < timeoutMs) {
			if (this.abortError) throw this.abortError

			const params: unknown[] = []
			const typeFilter = fromAgent
				? "(type = 'error' OR (type = 'worker_done' AND from_agent = ?))"
				: "(type = 'worker_done' OR type = 'error')"
			if (fromAgent) params.push(fromAgent)

			const msg = this.db.get<{ id: number; from_agent: string; type: string; payload: string }>(
				`SELECT id, from_agent, type, payload FROM messages
         WHERE to_agent = 'orchestrator'
           AND ${typeFilter}
           AND read = 0
         ORDER BY id LIMIT 1`,
				params,
			)

			if (msg) {
				this.db.run("UPDATE messages SET read = 1 WHERE id = ?", [msg.id])

				if (msg.type === "error") {
					const err = this.parseErrorMessage(taskId, msg)
					if (!err) {
						await sleep(10)
						continue
					}
					this.setAbortError(err)
					throw err
				}

				// worker_done received
				const payload = (() => {
					try {
						return asRecord(JSON.parse(msg.payload) as unknown) ?? {}
					} catch {
						return {}
					}
				})()

				const payloadTaskId = payload["taskId"]
				if (payloadTaskId && String(payloadTaskId) !== taskId) {
					await sleep(10)
					continue
				}
				return payload
			}

			if (childExit) {
				const graceMs = 5_000
				if (Date.now() - childExitAt > graceMs) {
					const code = childExit.code === null ? "null" : String(childExit.code)
					const signal = childExit.signal ? ` signal=${childExit.signal}` : ""
					const err = new Error(`Builder runner exited before sending completion (code=${code}${signal})`)
					this.setAbortError(err)
					throw err
				}

				await sleep(100)
				continue
			}

			if (childClosed) {
				const winner = await Promise.race([
					childClosed.then((info) => ({ kind: "exit" as const, info })),
					sleep(1000).then(() => ({ kind: "sleep" as const })),
				])

				if (winner.kind === "exit") {
					childExit = winner.info
					childExitAt = Date.now()
					await sleep(100)
				}

				continue
			}

			await sleep(1000)
		}

		const err = new Error(`Orchestrator: timeout waiting for builder after ${timeoutMs}ms`)
		this.setAbortError(err)
		throw err
	}

	private async waitForVerdict(
		taskId: string,
		timeoutMs: number,
		childClosed?: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
		fromAgent?: string,
	): Promise<ReviewWaitResult> {
		const start = Date.now()
		let childExit: { code: number | null; signal: NodeJS.Signals | null } | null = null
		let childExitAt = 0

		const sleep = async (ms: number): Promise<void> => {
			await new Promise((r) => setTimeout(r, ms))
		}

		while (Date.now() - start < timeoutMs) {
			if (this.abortError) throw this.abortError

			const params: unknown[] = []
			const typeFilter = fromAgent ? "(type = 'error' OR (type = 'verdict' AND from_agent = ?))" : "(type = 'verdict' OR type = 'error')"
			if (fromAgent) params.push(fromAgent)

			const msg = this.db.get<{ id: number; from_agent: string; type: string; payload: string }>(
				`SELECT id, from_agent, type, payload FROM messages
         WHERE to_agent = 'orchestrator'
           AND ${typeFilter}
           AND read = 0
         ORDER BY id LIMIT 1`,
				params,
			)

			if (msg) {
				this.db.run("UPDATE messages SET read = 1 WHERE id = ?", [msg.id])

				if (msg.type === "error") {
					const err = this.parseErrorMessage(taskId, msg)
					if (!err) {
						await sleep(10)
						continue
					}
					return {
						kind: "review_required",
						message: `Reviewer unavailable: ${err.message}`,
					}
				}

				const payload = (() => {
					try {
						return asRecord(JSON.parse(msg.payload) as unknown) ?? {}
					} catch {
						return {}
					}
				})()

				const payloadTaskId = payload["taskId"]
				if (payloadTaskId && String(payloadTaskId) !== taskId) {
					await sleep(10)
					continue
				}
				return { kind: "verdict", payload }
			}

			if (!childExit && childClosed) {
				const winner = await Promise.race([
					childClosed.then((info) => ({ kind: "exit" as const, info })),
					sleep(1000).then(() => ({ kind: "sleep" as const })),
				])
				if (winner.kind === "exit") {
					childExit = winner.info
					childExitAt = Date.now()
				}
			}

			if (childExit) {
				const graceMs = 5_000
				if (Date.now() - childExitAt > graceMs) {
					const code = childExit.code === null ? "null" : String(childExit.code)
					const signal = childExit.signal ? ` signal=${childExit.signal}` : ""
					return {
						kind: "review_required",
						message: `Reviewer runner exited before sending verdict (code=${code}${signal})`,
					}
				}
				await sleep(100)
				continue
			}

			await sleep(1000)
		}

		return {
			kind: "review_required",
			message: `Reviewer timed out after ${timeoutMs}ms without a verdict.`,
		}
	}
}
