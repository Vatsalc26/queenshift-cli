import type { ChatMessage, IModelClient, ModelCallOptions } from "./IModelClient"

export class ModelClient implements IModelClient {
	private apiKey: string | (() => Promise<string>)
	private model: string
	private baseUrl: string
	private extraHeaders: Record<string, string>
	private timeoutMs: number

	constructor(
		apiKey: string | (() => Promise<string>),
		model: string,
		options: { baseUrl?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
	) {
		this.apiKey = apiKey
		this.model = model
		this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")
		this.extraHeaders = options.headers ?? {}
		this.timeoutMs = typeof options.timeoutMs === "number" && options.timeoutMs > 0 ? options.timeoutMs : 120_000
	}

	private async resolveApiKey(): Promise<string> {
		return typeof this.apiKey === "function" ? await this.apiKey() : this.apiKey
	}

	async chat(messages: ChatMessage[], options?: ModelCallOptions): Promise<string> {
		const apiKey = await this.resolveApiKey()

		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				...this.extraHeaders,
			}
			if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

			const response = await fetch(`${this.baseUrl}/chat/completions`, {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: this.model,
					messages,
					max_tokens: options?.maxTokens ?? 4096,
					temperature: options?.temperature ?? 0.2,
				}),
				signal: controller.signal,
			})

			if (!response.ok) {
				const err = await response.text().catch(() => "")
				throw new Error(
					`ModelClient: API error ${response.status} ${response.statusText}${err ? ` - ${err.slice(0, 400)}` : ""}`,
				)
			}

			let data: { choices: Array<{ message: { content: string } }> }
			try {
				data = (await response.json()) as {
					choices: Array<{ message: { content: string } }>
				}
			} catch (err) {
				throw new Error(`Provider returned malformed JSON payload: ${err instanceof Error ? err.message : String(err)}`)
			}

			const content = data.choices[0]?.message?.content
			if (!content) throw new Error("ModelClient: empty response from API")
			return content
		} catch (err) {
			if (controller.signal.aborted) {
				throw new Error(`Provider call timeout after ${this.timeoutMs}ms`)
			}
			throw err
		} finally {
			clearTimeout(timeout)
		}
	}
}
