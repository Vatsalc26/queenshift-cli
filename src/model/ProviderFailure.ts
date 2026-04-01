export type ProviderFailureBucket =
	| "provider_auth_failure"
	| "provider_launch_failure"
	| "provider_timeout"
	| "provider_malformed_response"
	| "provider_empty_response"
	| "provider_transport_failure"
	| "provider_ceiling_reached"
	| "provider_unknown_failure"

export class ProviderError extends Error {
	readonly bucket: ProviderFailureBucket
	readonly retryable: boolean
	readonly rawMessage: string
	readonly attemptsUsed: number

	constructor(
		message: string,
		options: { bucket: ProviderFailureBucket; retryable?: boolean; rawMessage?: string; attemptsUsed?: number },
	) {
		super(message)
		this.name = "ProviderError"
		this.bucket = options.bucket
		this.retryable = options.retryable === true
		this.rawMessage = options.rawMessage ?? message
		this.attemptsUsed = options.attemptsUsed ?? 1
	}
}

function messageFromError(error: unknown): string {
	if (error instanceof Error) return error.message
	return String(error)
}

export function normalizeProviderError(error: unknown): ProviderError {
	if (error instanceof ProviderError) return error

	const rawMessage = messageFromError(error)
	const lower = rawMessage.toLowerCase()

	if (
		lower.includes("missing openai_api_key") ||
		lower.includes("missing gemini credentials") ||
		lower.includes("missing gemini_api_key") ||
		lower.includes("missing gemini_access_token") ||
		lower.includes("oauth credentials not found") ||
		lower.includes("requires a user project") ||
		lower.includes("application-default login")
	) {
		return new ProviderError("Provider auth/config is missing or invalid.", {
			bucket: "provider_auth_failure",
			rawMessage,
		})
	}

	if (
		lower.includes("spawn ") ||
		lower.includes("enoent") ||
		lower.includes("eacces") ||
		lower.includes("createprocess") ||
		lower.includes("gemini cli invocation failed") ||
		lower.includes("reviewer runner failed before verdict")
	) {
		return new ProviderError("Provider launch failed before a usable response was produced.", {
			bucket: "provider_launch_failure",
			rawMessage,
		})
	}

	if (
		lower.includes("timed out") ||
		lower.includes("aborterror") ||
		lower.includes("the operation was aborted") ||
		lower.includes("provider call timeout")
	) {
		return new ProviderError("Provider timed out before returning a usable response.", {
			bucket: "provider_timeout",
			rawMessage,
			retryable: true,
		})
	}

	if (
		lower.includes("provider returned malformed") ||
		lower.includes("non-json") ||
		lower.includes("invalid json") ||
		lower.includes("must be a json") ||
		lower.includes("unparseable")
	) {
		return new ProviderError("Provider returned a malformed or unparseable response.", {
			bucket: "provider_malformed_response",
			rawMessage,
		})
	}

	if (lower.includes("empty response")) {
		return new ProviderError("Provider returned an empty response.", {
			bucket: "provider_empty_response",
			rawMessage,
			retryable: true,
		})
	}

	if (
		lower.includes("fetch failed") ||
		lower.includes("econnreset") ||
		lower.includes("eai_again") ||
		lower.includes("429") ||
		lower.includes("503") ||
		lower.includes("transport") ||
		lower.includes("temporar") ||
		lower.includes("rate limit")
	) {
		return new ProviderError("Provider transport failed before a stable response was returned.", {
			bucket: "provider_transport_failure",
			rawMessage,
			retryable: true,
		})
	}

	if (lower.includes("model_call_ceiling_exceeded") || lower.includes("hard ceiling")) {
		return new ProviderError("A provider-side ceiling was reached.", {
			bucket: "provider_ceiling_reached",
			rawMessage,
		})
	}

	return new ProviderError("Provider failed for an unknown reason.", {
		bucket: "provider_unknown_failure",
		rawMessage,
	})
}

export function shouldRetryProviderError(error: unknown, attemptNumber: number, maxRetries: number): boolean {
	if (attemptNumber > maxRetries) return false
	const normalized = normalizeProviderError(error)
	return normalized.retryable
}
