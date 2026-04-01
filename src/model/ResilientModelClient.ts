import type { ChatMessage, IModelClient, ModelCallOptions } from "./IModelClient"
import { appendRunEventFromEnv } from "../run/RunArtifacts"
import { normalizeProviderError, ProviderError, shouldRetryProviderError } from "./ProviderFailure"

export class ResilientModelClient implements IModelClient {
	private readonly delegate: IModelClient
	private readonly maxRetries: number
	private readonly baseDelayMs: number
	private readonly sleep: (ms: number) => Promise<void>

	constructor(delegate: IModelClient, options: { maxRetries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {
		this.delegate = delegate
		this.maxRetries = typeof options.maxRetries === "number" && options.maxRetries >= 0 ? Math.floor(options.maxRetries) : 1
		this.baseDelayMs = typeof options.baseDelayMs === "number" && options.baseDelayMs >= 0 ? Math.floor(options.baseDelayMs) : 0
		this.sleep = options.sleep ?? (async (ms: number) => {
			if (ms <= 0) return
			await new Promise((resolve) => setTimeout(resolve, ms))
		})
	}

	private resolveRetryDelayMs(attempt: number, error: ProviderError): number {
		if (!error.retryable || this.baseDelayMs <= 0) return 0
		const multiplier = error.bucket === "provider_timeout" ? attempt : Math.max(1, attempt - 1)
		return this.baseDelayMs * multiplier
	}

	async chat(messages: ChatMessage[], options?: ModelCallOptions): Promise<string> {
		let attempt = 0
		let lastError: ProviderError | null = null

		while (attempt <= this.maxRetries) {
			attempt++
			try {
				const response = await this.delegate.chat(messages, options)
				if (!response.trim()) {
					throw new ProviderError("Provider returned an empty response.", {
						bucket: "provider_empty_response",
						retryable: true,
						attemptsUsed: attempt,
					})
				}
				if (attempt > 1) {
					appendRunEventFromEnv({
						type: "provider_recovered",
						attempt,
					})
				}
				return response
			} catch (error) {
				const normalized = normalizeProviderError(error)
				lastError = new ProviderError(normalized.message, {
					bucket: normalized.bucket,
					retryable: normalized.retryable,
					rawMessage: normalized.rawMessage,
					attemptsUsed: attempt,
				})

				appendRunEventFromEnv({
					type: "provider_failure",
					attempt,
					bucket: lastError.bucket,
					retryable: lastError.retryable,
					message: lastError.rawMessage,
				})

				if (!shouldRetryProviderError(lastError, attempt, this.maxRetries)) {
					throw lastError
				}

				appendRunEventFromEnv({
					type: "provider_retry",
					attempt,
					bucket: lastError.bucket,
					delayMs: this.resolveRetryDelayMs(attempt, lastError),
				})

				const delayMs = this.resolveRetryDelayMs(attempt, lastError)
				if (delayMs > 0) {
					await this.sleep(delayMs)
				}
			}
		}

		throw lastError ?? normalizeProviderError(new Error("Provider failed with no captured error."))
	}
}
