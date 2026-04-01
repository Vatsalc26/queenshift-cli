import { BaseAgent } from "./BaseAgent"
import type { DatabaseService } from "../db/DatabaseService"
import { MergeResolver, type MergeAttempt } from "../merge/MergeResolver"
import type { IModelClient } from "../model/IModelClient"

export class MergerAgent extends BaseAgent {
	private branches: string[]
	private merged = false

	constructor(
		agentId: string,
		taskId: string,
		task: string,
		workspace: string,
		branches: string[],
		db: DatabaseService,
		modelClient: IModelClient,
	) {
		super(agentId, taskId, task, workspace, db, modelClient)
		this.branches = branches
	}

	async executeIteration(): Promise<"continue" | "done" | "error"> {
		if (this.merged) return "done"
		this.sendHeartbeat()

		const resolver = new MergeResolver(this.workspace)
		const results: MergeAttempt[] = []

		for (const branch of this.branches) {
			console.log(`[${this.agentId}] Merging branch: ${branch}`)
			const attempt = await resolver.mergeNoFF(branch, `swarm: merge ${branch}`)
			results.push(attempt)

			if (attempt.success) console.log(`[${this.agentId}] Merged cleanly: ${branch}`)
			else console.warn(`[${this.agentId}] Merge failed: ${branch}`)
		}

		const conflictedBranches = results.filter((r) => r.conflict).map((r) => r.branch)

		await this.bus.send({
			from: this.agentId,
			to: "orchestrator",
			type: "worker_done",
			payload: {
				agentId: this.agentId,
				taskId: this.taskId,
				mergeResults: results,
				conflictedBranches,
			},
		})

		this.merged = true
		return "done"
	}
}
