import type { SwarmEngineName } from "./EngineSelection"
import type { TaskContract } from "../run/TaskContract"

export type TaskEngineRunStatus = "done" | "failed" | "review_required" | "candidate_not_ready"

export type TaskEngineRunContext = {
	engine: SwarmEngineName
	workspace: string
	dryRun: boolean
	allowDirty: boolean
	task: string
	taskContract: TaskContract | null
}

export type TaskEngineRunResult = {
	engine: SwarmEngineName
	status: TaskEngineRunStatus
	stopReason: string
	message: string
	summaryPath: string | null
}
