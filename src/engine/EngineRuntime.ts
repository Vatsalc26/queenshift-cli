import type { EngineSelection } from "./EngineSelection"
import type { TaskEngineRunContext, TaskEngineRunResult } from "./EngineRuntimeTypes"
import { runQueenBeeRuntime } from "../queenbee/QueenBeeRuntime"
import { runSwarmEngineRuntime } from "../swarmengine/SwarmEngineRuntime"

export async function runSelectedTaskEngine(selection: EngineSelection, context: TaskEngineRunContext): Promise<TaskEngineRunResult> {
	switch (selection.engine) {
		case "queenbee":
			return await runQueenBeeRuntime({
				...context,
				engine: selection.engine,
			})
		case "swarmengine":
		default:
			return await runSwarmEngineRuntime({
				...context,
				engine: selection.engine,
			})
	}
}
