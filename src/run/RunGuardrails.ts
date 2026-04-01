import fs from "node:fs"
import path from "node:path"

import type { DatabaseService } from "../db/DatabaseService"

export type RunGuardrailLimits = {
	maxModelCalls: number
	maxEstimatedTokens: number
}

export type RunGuardrailUsage = {
	taskId: string
	maxModelCalls: number
	modelCallsUsed: number
	maxEstimatedTokens: number
	estimatedTokensUsed: number
}

export type WorkspaceRunLockRecord = {
	lockKey: "live_run"
	taskId: string
	pid: number
	task: string
	acquiredAt: string
}

export type WorkspaceRunLockSnapshot = {
	enabled: boolean
	acquired: boolean
	released: boolean
	blockedByActiveRun: boolean
	blockingTaskId: string | null
	blockingPid: number | null
	blockingTask: string | null
	acquiredAt: string | null
	staleLockCleared: boolean
}

export type GuardrailErrorCode = "model_call_ceiling" | "usage_budget_ceiling" | "workspace_run_locked"

export class GuardrailError extends Error {
	readonly code: GuardrailErrorCode
	readonly details: Record<string, unknown> | null

	constructor(code: GuardrailErrorCode, message: string, details: Record<string, unknown> | null = null) {
		super(message)
		this.name = "GuardrailError"
		this.code = code
		this.details = details
	}
}

const LIVE_RUN_LOCK_KEY = "live_run"

function nowIso(): string {
	return new Date().toISOString()
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	} catch (err) {
		const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code ?? "") : ""
		return code === "EPERM"
	}
}

function summaryExists(workspace: string, taskId: string): boolean {
	const summaryPath = path.join(workspace, ".swarm", "runs", taskId, "summary.json")
	return fs.existsSync(summaryPath)
}

function buildUsageBudgetMessage(used: number, limit: number): string {
	return `Estimated usage budget reached for this run (${used}/${limit} tokens).`
}

function buildModelCallCeilingMessage(used: number, limit: number): string {
	return `Model-call ceiling reached for this run (${used}/${limit}).`
}

function readWorkspaceRunLock(db: DatabaseService): WorkspaceRunLockRecord | null {
	const row = db.get<{
		lock_key: string
		task_id: string
		pid: number
		task: string
		acquired_at: string
	}>(
		"SELECT lock_key, task_id, pid, task, acquired_at FROM workspace_run_locks WHERE lock_key = ?",
		[LIVE_RUN_LOCK_KEY],
	)

	if (!row || row.lock_key !== LIVE_RUN_LOCK_KEY) return null
	return {
		lockKey: "live_run",
		taskId: row.task_id,
		pid: row.pid,
		task: row.task,
		acquiredAt: row.acquired_at,
	}
}

function isWorkspaceRunLockStale(workspace: string, record: WorkspaceRunLockRecord): boolean {
	if (summaryExists(workspace, record.taskId)) return true
	return !isProcessAlive(record.pid)
}

function makeLockSnapshot(
	partial: Partial<WorkspaceRunLockSnapshot> = {},
): WorkspaceRunLockSnapshot {
	return {
		enabled: true,
		acquired: false,
		released: false,
		blockedByActiveRun: false,
		blockingTaskId: null,
		blockingPid: null,
		blockingTask: null,
		acquiredAt: null,
		staleLockCleared: false,
		...partial,
	}
}

export function makeDryRunLockSnapshot(): WorkspaceRunLockSnapshot {
	return {
		enabled: false,
		acquired: false,
		released: false,
		blockedByActiveRun: false,
		blockingTaskId: null,
		blockingPid: null,
		blockingTask: null,
		acquiredAt: null,
		staleLockCleared: false,
	}
}

export function formatWorkspaceRunLockBlockMessage(snapshot: WorkspaceRunLockSnapshot): string {
	const taskId = snapshot.blockingTaskId ?? "unknown"
	const pidText = snapshot.blockingPid !== null ? `, pid ${snapshot.blockingPid}` : ""
	const acquiredText = snapshot.acquiredAt ? `, acquired ${snapshot.acquiredAt}` : ""
	return `Workspace already has an active live run lock (task ${taskId}${pidText}${acquiredText}). Wait for that run to finish before starting another live run.`
}

export function acquireWorkspaceRunLock(
	db: DatabaseService,
	workspace: string,
	input: { taskId: string; task: string; pid?: number },
): { acquired: true; record: WorkspaceRunLockRecord; snapshot: WorkspaceRunLockSnapshot } | { acquired: false; snapshot: WorkspaceRunLockSnapshot } {
	let staleLockCleared = false
	const pid = typeof input.pid === "number" && input.pid > 0 ? input.pid : process.pid
	const acquiredAt = nowIso()

	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			db.run(
				"INSERT INTO workspace_run_locks (lock_key, task_id, pid, task, acquired_at, updated_at) VALUES (?,?,?,?,?,?)",
				[LIVE_RUN_LOCK_KEY, input.taskId, pid, input.task, acquiredAt, acquiredAt],
			)
			const record: WorkspaceRunLockRecord = {
				lockKey: "live_run",
				taskId: input.taskId,
				pid,
				task: input.task,
				acquiredAt,
			}
			return {
				acquired: true,
				record,
				snapshot: makeLockSnapshot({
					acquired: true,
					acquiredAt,
					staleLockCleared,
				}),
			}
		} catch (err) {
			const existing = readWorkspaceRunLock(db)
			if (!existing) {
				const message = err instanceof Error ? err.message : String(err)
				throw new Error(`Failed to acquire workspace live-run lock: ${message}`)
			}
			if (existing.taskId === input.taskId && existing.pid === pid) {
				return {
					acquired: true,
					record: existing,
					snapshot: makeLockSnapshot({
						acquired: true,
						acquiredAt: existing.acquiredAt,
						staleLockCleared,
					}),
				}
			}
			if (isWorkspaceRunLockStale(workspace, existing)) {
				db.run("DELETE FROM workspace_run_locks WHERE lock_key = ? AND task_id = ? AND pid = ?", [
					LIVE_RUN_LOCK_KEY,
					existing.taskId,
					existing.pid,
				])
				staleLockCleared = true
				continue
			}
			return {
				acquired: false,
				snapshot: makeLockSnapshot({
					blockedByActiveRun: true,
					blockingTaskId: existing.taskId,
					blockingPid: existing.pid,
					blockingTask: existing.task,
					acquiredAt: existing.acquiredAt,
					staleLockCleared,
				}),
			}
		}
	}

	throw new Error("Failed to acquire workspace live-run lock after clearing stale state.")
}

export function releaseWorkspaceRunLock(db: DatabaseService, record: WorkspaceRunLockRecord | null): boolean {
	if (!record) return false
	const result = db.run("DELETE FROM workspace_run_locks WHERE lock_key = ? AND task_id = ? AND pid = ?", [
		record.lockKey,
		record.taskId,
		record.pid,
	])
	return result.changes > 0
}

export function readRunGuardrailUsage(db: DatabaseService, taskId: string): RunGuardrailUsage | null {
	const row = db.get<{
		task_id: string
		max_model_calls: number
		model_calls_used: number
		max_estimated_tokens: number
		estimated_tokens_used: number
	}>(
		"SELECT task_id, max_model_calls, model_calls_used, max_estimated_tokens, estimated_tokens_used FROM run_guardrails WHERE task_id = ?",
		[taskId],
	)

	if (!row) return null
	return {
		taskId: row.task_id,
		maxModelCalls: row.max_model_calls,
		modelCallsUsed: row.model_calls_used,
		maxEstimatedTokens: row.max_estimated_tokens,
		estimatedTokensUsed: row.estimated_tokens_used,
	}
}

export function initializeRunGuardrails(db: DatabaseService, taskId: string, limits: RunGuardrailLimits): void {
	const timestamp = nowIso()
	db.run(
		"INSERT OR REPLACE INTO run_guardrails (task_id, max_model_calls, model_calls_used, max_estimated_tokens, estimated_tokens_used, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
		[taskId, limits.maxModelCalls, 0, limits.maxEstimatedTokens, 0, timestamp, timestamp],
	)
}

export function updateRunGuardrailLimits(db: DatabaseService, taskId: string, limits: RunGuardrailLimits): void {
	db.run(
		"UPDATE run_guardrails SET max_model_calls = ?, max_estimated_tokens = ?, updated_at = ? WHERE task_id = ?",
		[limits.maxModelCalls, limits.maxEstimatedTokens, nowIso(), taskId],
	)
}

export function reservePromptBudgetAndModelCall(
	db: DatabaseService,
	taskId: string,
	promptTokens: number,
): RunGuardrailUsage {
	const result = db.run(
		`UPDATE run_guardrails
		   SET model_calls_used = model_calls_used + 1,
		       estimated_tokens_used = estimated_tokens_used + ?,
		       updated_at = ?
		 WHERE task_id = ?
		   AND model_calls_used < max_model_calls
		   AND estimated_tokens_used + ? <= max_estimated_tokens`,
		[promptTokens, nowIso(), taskId, promptTokens],
	)

	const snapshot = readRunGuardrailUsage(db, taskId)
	if (!snapshot) throw new Error(`Run guardrails missing for task ${taskId}`)
	if (result.changes > 0) return snapshot

	if (snapshot.modelCallsUsed >= snapshot.maxModelCalls) {
		throw new GuardrailError(
			"model_call_ceiling",
			buildModelCallCeilingMessage(snapshot.modelCallsUsed, snapshot.maxModelCalls),
			{
				taskId,
				used: snapshot.modelCallsUsed,
				limit: snapshot.maxModelCalls,
			},
		)
	}

	throw new GuardrailError(
		"usage_budget_ceiling",
		buildUsageBudgetMessage(snapshot.estimatedTokensUsed, snapshot.maxEstimatedTokens),
		{
			taskId,
			used: snapshot.estimatedTokensUsed,
			limit: snapshot.maxEstimatedTokens,
		},
	)
}

export function recordResponseUsage(db: DatabaseService, taskId: string, responseTokens: number): RunGuardrailUsage {
	if (responseTokens > 0) {
		db.run(
			"UPDATE run_guardrails SET estimated_tokens_used = estimated_tokens_used + ?, updated_at = ? WHERE task_id = ?",
			[responseTokens, nowIso(), taskId],
		)
	}

	const snapshot = readRunGuardrailUsage(db, taskId)
	if (!snapshot) throw new Error(`Run guardrails missing for task ${taskId}`)
	if (snapshot.estimatedTokensUsed > snapshot.maxEstimatedTokens) {
		throw new GuardrailError(
			"usage_budget_ceiling",
			buildUsageBudgetMessage(snapshot.estimatedTokensUsed, snapshot.maxEstimatedTokens),
			{
				taskId,
				used: snapshot.estimatedTokensUsed,
				limit: snapshot.maxEstimatedTokens,
			},
		)
	}

	return snapshot
}
