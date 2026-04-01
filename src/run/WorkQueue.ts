import fs from "node:fs"
import path from "node:path"

import { normalizeTaskContract, type TaskContract } from "./TaskContract"

export type WorkQueueItemStatus = "queued" | "cancelled" | "claimed"
export type WorkQueueExecutionMode = "manual" | "background_candidate"
export type WorkQueueApprovalState = "not_required" | "awaiting_owner" | "approved"

export type WorkQueueItem = {
	queueId: string
	task: string
	createdAt: string
	scheduledAt: string | null
	status: WorkQueueItemStatus
	note: string | null
	campaignId: string | null
	originRunId: string | null
	taskContract: TaskContract | null
	executionMode: WorkQueueExecutionMode
	approvalState: WorkQueueApprovalState
	approvedAt: string | null
	approvedBy: string | null
}

export type WorkQueueArtifact = {
	schemaVersion: 1
	generatedAt: string
	workspaceName: string
	items: WorkQueueItem[]
}

export type WorkQueueSummary = {
	pendingCount: number
	readyCount: number
	awaitingApprovalCount: number
	scheduledCount: number
	nextReadyItem: WorkQueueItem | null
	nextScheduledItem: WorkQueueItem | null
	nextAwaitingApprovalItem: WorkQueueItem | null
	state: "empty" | "ready" | "awaiting_owner" | "scheduled"
	statusMessage: string
	nextCommandHint: string | null
}

export type QueueEnqueueResult = {
	artifactPath: string
	item: WorkQueueItem
}

export type QueueCancelResult = {
	artifactPath: string
	found: boolean
	cancelled: boolean
	item: WorkQueueItem | null
}

export type QueueApprovalResult = {
	artifactPath: string
	found: boolean
	approved: boolean
	item: WorkQueueItem | null
}

function defaultArtifact(workspace: string, generatedAt = new Date().toISOString()): WorkQueueArtifact {
	return {
		schemaVersion: 1,
		generatedAt,
		workspaceName: path.basename(workspace),
		items: [],
	}
}

function normalizeScheduledAt(value: string | null | undefined): string | null {
	if (typeof value !== "string" || !value.trim()) return null
	const parsed = Date.parse(value)
	return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

function normalizeItem(item: WorkQueueItem): WorkQueueItem {
	const executionMode: WorkQueueExecutionMode = item.executionMode === "background_candidate" ? "background_candidate" : "manual"
	const approvalState: WorkQueueApprovalState =
		executionMode === "background_candidate"
			? item.approvalState === "approved"
				? "approved"
				: "awaiting_owner"
			: "not_required"
	return {
		queueId: item.queueId.trim(),
		task: item.task.trim(),
		createdAt: item.createdAt,
		scheduledAt: normalizeScheduledAt(item.scheduledAt),
		status: item.status === "cancelled" || item.status === "claimed" ? item.status : "queued",
		note: typeof item.note === "string" && item.note.trim() ? item.note.trim() : null,
		campaignId: typeof item.campaignId === "string" && item.campaignId.trim() ? item.campaignId.trim() : null,
		originRunId: typeof item.originRunId === "string" && item.originRunId.trim() ? item.originRunId.trim() : null,
		taskContract: normalizeTaskContract(item.taskContract),
		executionMode,
		approvalState,
		approvedAt: approvalState === "approved" && typeof item.approvedAt === "string" && item.approvedAt.trim() ? item.approvedAt : null,
		approvedBy: approvalState === "approved" && typeof item.approvedBy === "string" && item.approvedBy.trim() ? item.approvedBy.trim() : null,
	}
}

function itemSortKey(left: WorkQueueItem, right: WorkQueueItem): number {
	const leftScheduled = left.scheduledAt ?? left.createdAt
	const rightScheduled = right.scheduledAt ?? right.createdAt
	return leftScheduled.localeCompare(rightScheduled) || left.createdAt.localeCompare(right.createdAt) || left.queueId.localeCompare(right.queueId)
}

export function resolveWorkQueuePath(workspace: string): string {
	return path.join(workspace, ".swarm", "work-queue.json")
}

export function readWorkQueueArtifact(workspace: string): WorkQueueArtifact {
	const artifactPath = resolveWorkQueuePath(workspace)
	if (!fs.existsSync(artifactPath)) return defaultArtifact(workspace)
	try {
		const raw = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as Partial<WorkQueueArtifact>
		return {
			schemaVersion: 1,
			generatedAt: typeof raw.generatedAt === "string" && raw.generatedAt.trim() ? raw.generatedAt : new Date().toISOString(),
			workspaceName: typeof raw.workspaceName === "string" && raw.workspaceName.trim() ? raw.workspaceName : path.basename(workspace),
			items: Array.isArray(raw.items)
				? raw.items
						.filter((item): item is WorkQueueItem => Boolean(item && typeof item === "object"))
						.map((item) => normalizeItem(item))
						.sort(itemSortKey)
				: [],
		}
	} catch {
		return defaultArtifact(workspace)
	}
}

export function writeWorkQueueArtifact(workspace: string, artifact: WorkQueueArtifact): string {
	const artifactPath = resolveWorkQueuePath(workspace)
	fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
	fs.writeFileSync(
		artifactPath,
		`${JSON.stringify(
			{
				...artifact,
				items: [...artifact.items].map((item) => normalizeItem(item)).sort(itemSortKey),
			},
			null,
			2,
		)}\n`,
		"utf8",
	)
	return artifactPath
}

export function enqueueWorkItem(
	workspace: string,
	input: {
		task: string
		scheduledAt?: string | null
		note?: string | null
		campaignId?: string | null
		originRunId?: string | null
		taskContract?: TaskContract | null
		executionMode?: WorkQueueExecutionMode | null
		now?: string
	},
): QueueEnqueueResult {
	const artifact = readWorkQueueArtifact(workspace)
	const createdAt = input.now ?? new Date().toISOString()
	const item: WorkQueueItem = normalizeItem({
		queueId: `queue-${Date.now()}-${Math.random().toString(16).slice(2)}`,
		task: input.task,
		createdAt,
		scheduledAt: input.scheduledAt ?? null,
		status: "queued",
		note: input.note ?? null,
		campaignId: input.campaignId ?? null,
		originRunId: input.originRunId ?? null,
		taskContract: input.taskContract ?? null,
		executionMode: input.executionMode === "background_candidate" ? "background_candidate" : "manual",
		approvalState: input.executionMode === "background_candidate" ? "awaiting_owner" : "not_required",
		approvedAt: null,
		approvedBy: null,
	})
	const nextArtifact: WorkQueueArtifact = {
		...artifact,
		generatedAt: createdAt,
		items: [...artifact.items, item].sort(itemSortKey),
	}
	return {
		artifactPath: writeWorkQueueArtifact(workspace, nextArtifact),
		item,
	}
}

export function cancelQueuedWorkItem(workspace: string, queueId: string, now = new Date().toISOString()): QueueCancelResult {
	const artifact = readWorkQueueArtifact(workspace)
	let found = false
	let cancelled = false
	let resolvedItem: WorkQueueItem | null = null
	const items = artifact.items.map((item) => {
		if (item.queueId !== queueId) return item
		found = true
		resolvedItem = item
		if (item.status !== "queued") return item
		cancelled = true
		resolvedItem = { ...item, status: "cancelled" }
		return resolvedItem
	})
	const artifactPath = writeWorkQueueArtifact(workspace, {
		...artifact,
		generatedAt: now,
		items,
	})
	return {
		artifactPath,
		found,
		cancelled,
		item: resolvedItem,
	}
}

export function approveQueuedWorkItem(
	workspace: string,
	queueId: string,
	options: { approvedBy?: string | null; now?: string } = {},
): QueueApprovalResult {
	const artifact = readWorkQueueArtifact(workspace)
	const approvedAt = options.now ?? new Date().toISOString()
	let found = false
	let approved = false
	let resolvedItem: WorkQueueItem | null = null
	const items = artifact.items.map((item) => {
		if (item.queueId !== queueId) return item
		found = true
		if (item.status !== "queued" || item.executionMode !== "background_candidate" || item.approvalState !== "awaiting_owner") {
			resolvedItem = item
			return item
		}
		approved = true
		resolvedItem = {
			...item,
			approvalState: "approved",
			approvedAt,
			approvedBy: typeof options.approvedBy === "string" && options.approvedBy.trim() ? options.approvedBy.trim() : null,
		}
		return resolvedItem
	})
	const artifactPath = writeWorkQueueArtifact(workspace, {
		...artifact,
		generatedAt: approvedAt,
		items,
	})
	return {
		artifactPath,
		found,
		approved,
		item: resolvedItem,
	}
}

export function listQueuedWorkItems(
	workspace: string,
	options: { includeResolved?: boolean } = {},
): WorkQueueItem[] {
	const artifact = readWorkQueueArtifact(workspace)
	return artifact.items.filter((item) => options.includeResolved || item.status === "queued")
}

function itemIsReady(item: WorkQueueItem, nowMs: number): boolean {
	if (item.status !== "queued") return false
	if (item.approvalState === "awaiting_owner") return false
	if (!item.scheduledAt) return true
	const scheduledMs = Date.parse(item.scheduledAt)
	return !Number.isNaN(scheduledMs) && scheduledMs <= nowMs
}

function buildQueueSummaryFromItems(items: WorkQueueItem[], nowMs: number): WorkQueueSummary {
	const queuedItems = items.filter((item) => item.status === "queued")
	const readyItems = queuedItems.filter((item) => itemIsReady(item, nowMs)).sort(itemSortKey)
	const awaitingApprovalItems = queuedItems.filter((item) => item.approvalState === "awaiting_owner").sort(itemSortKey)
	const scheduledItems = queuedItems
		.filter((item) => item.scheduledAt && !itemIsReady(item, nowMs))
		.sort(itemSortKey)
	const nextReadyItem = readyItems[0] ?? null
	const nextAwaitingApprovalItem = awaitingApprovalItems[0] ?? null
	const nextScheduledItem = scheduledItems[0] ?? null
	const nextAdditionalScheduledItem =
		scheduledItems.find(
			(item) => item.queueId !== nextReadyItem?.queueId && item.queueId !== nextAwaitingApprovalItem?.queueId,
		) ?? null
	const scheduledCount = scheduledItems.length

	const summaryBase = {
		pendingCount: queuedItems.length,
		readyCount: readyItems.length,
		awaitingApprovalCount: awaitingApprovalItems.length,
		scheduledCount,
		nextReadyItem,
		nextScheduledItem,
		nextAwaitingApprovalItem,
	}

	if (queuedItems.length === 0) {
		return {
			...summaryBase,
			state: "empty",
			statusMessage: "No queued follow-up work is recorded.",
			nextCommandHint: null,
		}
	}

	if (nextReadyItem) {
		const extra: string[] = []
		if (nextAwaitingApprovalItem) {
			extra.push(`Background candidate ${nextAwaitingApprovalItem.queueId} is still waiting on owner approval.`)
		}
		if (nextAdditionalScheduledItem) {
			extra.push(`Another queued task is scheduled for ${nextAdditionalScheduledItem.scheduledAt}.`)
		}
		return {
			...summaryBase,
			state: "ready",
			statusMessage: `Queued work is ready now: ${nextReadyItem.queueId} -> ${nextReadyItem.task}.${extra.length > 0 ? ` ${extra.join(" ")}` : ""}`,
			nextCommandHint: "queue:next",
		}
	}

	if (nextAwaitingApprovalItem) {
		const extra = nextAdditionalScheduledItem ? ` Another queued task is scheduled for ${nextAdditionalScheduledItem.scheduledAt}.` : ""
		return {
			...summaryBase,
			state: "awaiting_owner",
			statusMessage: `Queued background candidate ${nextAwaitingApprovalItem.queueId} is paused until the owner explicitly approves it.${extra}`,
			nextCommandHint: `queue:approve ${nextAwaitingApprovalItem.queueId}`,
		}
	}

	return {
		...summaryBase,
		state: "scheduled",
		statusMessage: nextScheduledItem
			? `Queued work is scheduled for later: ${nextScheduledItem.queueId} becomes ready at ${nextScheduledItem.scheduledAt}. Nothing self-runs before then.`
			: "Queued work exists, but none is ready yet.",
		nextCommandHint: "queue:list",
	}
}

export function buildWorkQueueSummary(workspace: string, nowMs = Date.now()): WorkQueueSummary {
	return buildQueueSummaryFromItems(listQueuedWorkItems(workspace), nowMs)
}

export function findNextReadyQueuedWorkItem(workspace: string, nowMs = Date.now()): WorkQueueItem | null {
	return buildWorkQueueSummary(workspace, nowMs).nextReadyItem
}

export function formatWorkQueueArtifact(artifact: WorkQueueArtifact, nowMs = Date.now()): string {
	if (artifact.items.length === 0) return "Work queue: no queued items."
	const summary = buildQueueSummaryFromItems(artifact.items, nowMs)
	return [
		`Work queue: ${summary.pendingCount} pending item(s).`,
		`State: ${summary.state}`,
		`Queue note: ${summary.statusMessage}`,
		`Next queue command: ${summary.nextCommandHint ?? "(none)"}`,
		...artifact.items.map((item) => {
			const ready = itemIsReady(item, nowMs)
			const campaign =
				item.campaignId || item.originRunId
					? ` campaign=${item.campaignId ?? "(none)"}${item.originRunId ? ` origin=${item.originRunId}` : ""}`
					: ""
			const approval =
				item.approvalState === "awaiting_owner"
					? " awaiting_owner_approval"
					: item.approvalState === "approved"
						? ` approved${item.approvedBy ? ` by ${item.approvedBy}` : ""}`
						: ""
			const mode = item.executionMode === "background_candidate" ? " background_candidate" : ""
			return `- ${item.queueId} [${item.status}${mode}] ${ready ? "ready" : item.scheduledAt ? `scheduled ${item.scheduledAt}` : "pending"}${approval}${campaign} -> ${item.task}`
		}),
	].join("\n")
}

export function formatWorkQueueSummary(summary: WorkQueueSummary): string {
	return [
		`Pending items: ${summary.pendingCount}`,
		`Ready now: ${summary.readyCount}`,
		`Awaiting owner approval: ${summary.awaitingApprovalCount}`,
		`Scheduled later: ${summary.scheduledCount}`,
		`State: ${summary.state}`,
		`Queue note: ${summary.statusMessage}`,
		`Next queue command: ${summary.nextCommandHint ?? "(none)"}`,
		`Next ready: ${summary.nextReadyItem ? `${summary.nextReadyItem.queueId} -> ${summary.nextReadyItem.task}` : "(none)"}`,
		`Next awaiting approval: ${
			summary.nextAwaitingApprovalItem ? `${summary.nextAwaitingApprovalItem.queueId} -> ${summary.nextAwaitingApprovalItem.task}` : "(none)"
		}`,
		`Next scheduled: ${
			summary.nextScheduledItem ? `${summary.nextScheduledItem.queueId} @ ${summary.nextScheduledItem.scheduledAt}` : "(none)"
		}`,
	].join("\n")
}
