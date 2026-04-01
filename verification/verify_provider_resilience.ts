import type { ChatMessage, IModelClient, ModelCallOptions } from "../src/model/IModelClient"
import { ProviderError, normalizeProviderError } from "../src/model/ProviderFailure"
import { ResilientModelClient } from "../src/model/ResilientModelClient"

type ProviderFixtureResult = {
	label: string
	passed: boolean
	details: string
}

class SequenceClient implements IModelClient {
	private readonly steps: Array<() => Promise<string>>
	private index = 0

	constructor(steps: Array<() => Promise<string>>) {
		this.steps = steps
	}

	async chat(_messages: ChatMessage[], _options?: ModelCallOptions): Promise<string> {
		const step = this.steps[Math.min(this.index, this.steps.length - 1)]
		if (!step) throw new Error("SequenceClient ran out of steps")
		this.index += 1
		return await step()
	}
}

export async function runProviderResilienceFixtures(): Promise<ProviderFixtureResult[]> {
	const results: ProviderFixtureResult[] = []

	const slowHealthy = new ResilientModelClient(
		new SequenceClient([
			async () => {
				await new Promise((resolve) => setTimeout(resolve, 50))
				return '{"ok":true}'
			},
		]),
		{ maxRetries: 1 },
	)
	results.push({
		label: "slow-healthy-response",
		passed: (await slowHealthy.chat([{ role: "user", content: "hello" }])) === '{"ok":true}',
		details: "slow healthy response returned successfully",
	})

	const timeoutClient = new ResilientModelClient(
		new SequenceClient([async () => Promise.reject(new Error("Provider call timeout after 100ms"))]),
		{ maxRetries: 0 },
	)
	try {
		await timeoutClient.chat([{ role: "user", content: "timeout" }])
		results.push({ label: "timeout-bucket", passed: false, details: "expected timeout to throw" })
	} catch (err) {
		const normalized = normalizeProviderError(err)
		results.push({
			label: "timeout-bucket",
			passed: normalized.bucket === "provider_timeout",
			details: normalized.bucket,
		})
	}

	const malformedClient = new ResilientModelClient(
		new SequenceClient([async () => Promise.reject(new Error("Provider returned malformed JSON payload: bad json"))]),
		{ maxRetries: 0 },
	)
	try {
		await malformedClient.chat([{ role: "user", content: "malformed" }])
		results.push({ label: "malformed-bucket", passed: false, details: "expected malformed response to throw" })
	} catch (err) {
		const normalized = normalizeProviderError(err)
		results.push({
			label: "malformed-bucket",
			passed: normalized.bucket === "provider_malformed_response",
			details: normalized.bucket,
		})
	}

	const emptyClient = new ResilientModelClient(new SequenceClient([async () => "   "]), { maxRetries: 0 })
	try {
		await emptyClient.chat([{ role: "user", content: "empty" }])
		results.push({ label: "empty-bucket", passed: false, details: "expected empty response to throw" })
	} catch (err) {
		const normalized = normalizeProviderError(err)
		results.push({
			label: "empty-bucket",
			passed: normalized.bucket === "provider_empty_response",
			details: normalized.bucket,
		})
	}

	let emptyRetryAttempts = 0
	const emptyRetryClient = new ResilientModelClient(
		new SequenceClient([
			async () => {
				emptyRetryAttempts += 1
				return "   "
			},
			async () => {
				emptyRetryAttempts += 1
				return '{"ok":"after-empty-retry"}'
			},
		]),
		{ maxRetries: 1, baseDelayMs: 0 },
	)
	const emptyRetryResult = await emptyRetryClient.chat([{ role: "user", content: "empty-retry" }])
	results.push({
		label: "empty-retry",
		passed: emptyRetryResult === '{"ok":"after-empty-retry"}' && emptyRetryAttempts === 2,
		details: `attempts=${emptyRetryAttempts}`,
	})

	let attempts = 0
	const transientClient = new ResilientModelClient(
		new SequenceClient([
			async () => {
				attempts += 1
				return Promise.reject(new Error("fetch failed"))
			},
			async () => {
				attempts += 1
				return '{"ok":"after-retry"}'
			},
		]),
		{ maxRetries: 1 },
	)
	const transientResult = await transientClient.chat([{ role: "user", content: "retry" }])
	results.push({
		label: "transient-retry",
		passed: transientResult === '{"ok":"after-retry"}' && attempts === 2,
		details: `attempts=${attempts}`,
	})

	let authAttempts = 0
	const authFailureClient = new ResilientModelClient(
		new SequenceClient([
			async () => {
				authAttempts += 1
				return Promise.reject(new Error("Missing GEMINI_API_KEY for SWARM_PROVIDER=gemini"))
			},
		]),
		{ maxRetries: 2, baseDelayMs: 0 },
	)
	try {
		await authFailureClient.chat([{ role: "user", content: "auth" }])
		results.push({ label: "auth-no-retry", passed: false, details: "expected auth failure to throw" })
	} catch (err) {
		const normalized = normalizeProviderError(err)
		results.push({
			label: "auth-no-retry",
			passed: normalized.bucket === "provider_auth_failure" && authAttempts === 1,
			details: `bucket=${normalized.bucket} attempts=${authAttempts}`,
		})
	}

	let delayedAttempts = 0
	const delays: number[] = []
	const delayedTransientClient = new ResilientModelClient(
		new SequenceClient([
			async () => {
				delayedAttempts += 1
				return Promise.reject(new Error("fetch failed"))
			},
			async () => {
				delayedAttempts += 1
				return '{"ok":"after-backoff"}'
			},
		]),
		{
			maxRetries: 1,
			baseDelayMs: 25,
			sleep: async (ms) => {
				delays.push(ms)
			},
		},
	)
	const delayedTransientResult = await delayedTransientClient.chat([{ role: "user", content: "delayed-retry" }])
	results.push({
		label: "retry-backoff",
		passed: delayedTransientResult === '{"ok":"after-backoff"}' && delayedAttempts === 2 && delays[0] === 25,
		details: `attempts=${delayedAttempts} delays=${delays.join(",")}`,
	})

	return results
}

export function formatProviderResilienceResults(results: ProviderFixtureResult[]): string {
	const lines = ["Fixture | Result | Details", "--- | --- | ---"]
	for (const result of results) {
		lines.push(`${result.label} | ${result.passed ? "PASS" : "FAIL"} | ${result.details}`)
	}
	return lines.join("\n")
}

async function main(): Promise<void> {
	const results = await runProviderResilienceFixtures()
	console.log(formatProviderResilienceResults(results))
	process.exit(results.every((result) => result.passed) ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		const normalized = err instanceof ProviderError ? err : normalizeProviderError(err)
		console.error(`[verify:provider:resilience] ${normalized.bucket}: ${normalized.rawMessage}`)
		process.exit(1)
	})
}
