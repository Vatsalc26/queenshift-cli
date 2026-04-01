import path from "path"

import { DatabaseService } from "../db/DatabaseService"
import { Orchestrator } from "../Orchestrator"
import type { TaskEngineRunContext, TaskEngineRunResult } from "../engine/EngineRuntimeTypes"

export async function runSwarmEngineRuntime(context: TaskEngineRunContext): Promise<TaskEngineRunResult> {
	const dbPath = path.join(context.workspace, ".swarm", "swarmcoder.db")
	const db = DatabaseService.getInstance(dbPath)
	console.log(`[Swarm] Database: ${dbPath}`)

	try {
		const orchestrator = new Orchestrator(context.workspace, db, context.dryRun, {
			allowDirty: context.allowDirty,
		})
		const result = await orchestrator.run(context.task, { taskContract: context.taskContract })
		return {
			engine: "swarmengine",
			status: result.status,
			stopReason: result.stopReason,
			message: result.message,
			summaryPath: result.summaryPath,
		}
	} finally {
		db.close()
	}
}
