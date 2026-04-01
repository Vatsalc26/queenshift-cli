import type { ChatMessage, IModelClient, ModelCallOptions } from "./IModelClient"
import type { DatabaseService } from "../db/DatabaseService"
import { appendRunEvent, readRunEvents } from "../run/RunArtifacts"
import { ProviderError } from "./ProviderFailure"
import {
	GuardrailError,
	recordResponseUsage,
	reservePromptBudgetAndModelCall,
} from "../run/RunGuardrails"

function estimateTokens(text: string): number {
	const chars = text.trim().length
	if (chars === 0) return 0
	return Math.ceil(chars / 4)
}

export class TelemetryModelClient implements IModelClient {
	private readonly delegate: IModelClient
	private readonly runDir: string
	private readonly actor: string
	private readonly maxCalls: number | null
	private readonly maxEstimatedTokens: number | null
	private readonly db: DatabaseService | null
	private readonly taskId: string | null

	constructor(
		delegate: IModelClient,
		options: {
			runDir: string
			actor: string
			maxCalls?: number
			maxEstimatedTokens?: number
			db?: DatabaseService
			taskId?: string
		},
	) {
		this.delegate = delegate
		this.runDir = options.runDir
		this.actor = options.actor
		this.maxCalls = typeof options.maxCalls === "number" && options.maxCalls > 0 ? options.maxCalls : null
		this.maxEstimatedTokens =
			typeof options.maxEstimatedTokens === "number" && options.maxEstimatedTokens > 0 ? options.maxEstimatedTokens : null
		this.db = options.db ?? null
		this.taskId = options.taskId?.trim() ? options.taskId.trim() : null
	}

	async chat(messages: ChatMessage[], options?: ModelCallOptions): Promise<string> {
		const startedAt = Date.now()
		const promptText = messages.map((message) => `${message.role}:${message.content}`).join("\n")
		const estimatedPromptTokens = estimateTokens(promptText)
		const usesDbGuardrails =
			this.db !== null && this.taskId !== null && (this.maxCalls !== null || this.maxEstimatedTokens !== null)

		if (usesDbGuardrails) {
			try {
				reservePromptBudgetAndModelCall(this.db!, this.taskId!, estimatedPromptTokens)
			} catch (err) {
				if (err instanceof GuardrailError) {
					appendRunEvent(this.runDir, {
						type: "ceiling_reached",
						actor: this.actor,
						ceiling: err.code === "model_call_ceiling" ? "model_calls" : "estimated_usage_tokens",
						limit: err.details?.["limit"] ?? null,
						used: err.details?.["used"] ?? null,
					})
				}
				throw err
			}
		} else if (this.maxCalls !== null) {
			const callCount = readRunEvents(this.runDir).filter((event) => event.type === "model_call").length
			if (callCount >= this.maxCalls) {
				appendRunEvent(this.runDir, {
					type: "ceiling_reached",
					actor: this.actor,
					ceiling: "model_calls",
					limit: this.maxCalls,
					used: callCount,
				})
				throw new GuardrailError(
					"model_call_ceiling",
					`Model-call ceiling reached for this run (${callCount}/${this.maxCalls}).`,
					{ limit: this.maxCalls, used: callCount },
				)
			}
		}

		if (!usesDbGuardrails && this.maxEstimatedTokens !== null) {
			const usedTokens = readRunEvents(this.runDir)
				.filter((event) => event.type === "model_call")
				.reduce(
					(sum, event) =>
						sum +
						(typeof event.estimatedPromptTokens === "number" ? event.estimatedPromptTokens : 0) +
						(typeof event.estimatedResponseTokens === "number" ? event.estimatedResponseTokens : 0),
					0,
				)
			if (usedTokens + estimatedPromptTokens > this.maxEstimatedTokens) {
				appendRunEvent(this.runDir, {
					type: "ceiling_reached",
					actor: this.actor,
					ceiling: "estimated_usage_tokens",
					limit: this.maxEstimatedTokens,
					used: usedTokens,
				})
				throw new GuardrailError(
					"usage_budget_ceiling",
					`Estimated usage budget reached for this run (${usedTokens}/${this.maxEstimatedTokens} tokens).`,
					{ limit: this.maxEstimatedTokens, used: usedTokens },
				)
			}
		}

		try {
			const response = await this.delegate.chat(messages, options)
			const estimatedResponseTokens = estimateTokens(response)
			let postResponseGuardrailError: GuardrailError | null = null
			if (usesDbGuardrails) {
				try {
					recordResponseUsage(this.db!, this.taskId!, estimatedResponseTokens)
				} catch (err) {
					if (err instanceof GuardrailError) {
						appendRunEvent(this.runDir, {
							type: "ceiling_reached",
							actor: this.actor,
							ceiling: "estimated_usage_tokens",
							limit: err.details?.["limit"] ?? null,
							used: err.details?.["used"] ?? null,
						})
						postResponseGuardrailError = err
					} else {
						throw err
					}
				}
			} else if (this.maxEstimatedTokens !== null) {
				const usedTokens = readRunEvents(this.runDir)
					.filter((event) => event.type === "model_call")
					.reduce(
						(sum, event) =>
							sum +
							(typeof event.estimatedPromptTokens === "number" ? event.estimatedPromptTokens : 0) +
							(typeof event.estimatedResponseTokens === "number" ? event.estimatedResponseTokens : 0),
						0,
					)
				if (usedTokens + estimatedPromptTokens + estimatedResponseTokens > this.maxEstimatedTokens) {
					appendRunEvent(this.runDir, {
						type: "ceiling_reached",
						actor: this.actor,
						ceiling: "estimated_usage_tokens",
						limit: this.maxEstimatedTokens,
						used: usedTokens + estimatedPromptTokens + estimatedResponseTokens,
					})
					postResponseGuardrailError = new GuardrailError(
						"usage_budget_ceiling",
						`Estimated usage budget reached for this run (${usedTokens + estimatedPromptTokens + estimatedResponseTokens}/${this.maxEstimatedTokens} tokens).`,
						{
							limit: this.maxEstimatedTokens,
							used: usedTokens + estimatedPromptTokens + estimatedResponseTokens,
						},
					)
				}
			}

			appendRunEvent(this.runDir, {
				type: "model_call",
				actor: this.actor,
				durationMs: Date.now() - startedAt,
				promptChars: promptText.length,
				responseChars: response.length,
				estimatedPromptTokens,
				estimatedResponseTokens,
				success: true,
			})
			if (postResponseGuardrailError) throw postResponseGuardrailError
			return response
		} catch (err) {
			const providerError = err instanceof ProviderError ? err : null
			appendRunEvent(this.runDir, {
				type: "model_call",
				actor: this.actor,
				durationMs: Date.now() - startedAt,
				promptChars: promptText.length,
				estimatedPromptTokens,
				success: false,
				error: err instanceof Error ? err.message : String(err),
				providerBucket: providerError?.bucket ?? null,
				providerAttemptsUsed: providerError?.attemptsUsed ?? null,
			})
			throw err
		}
	}
}
