import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

import type { ChatMessage, IModelClient, ModelCallOptions } from "./IModelClient.ts"

type GeminiCliPayload = {
	response?: unknown
	error?: unknown
}

function tryExtractFirstJsonObject(text: string): string | null {
	const start = text.indexOf("{")
	if (start === -1) return null

	let depth = 0
	let inString = false
	let escaped = false

	for (let i = start; i < text.length; i++) {
		const ch = text[i] ?? ""

		if (inString) {
			if (escaped) {
				escaped = false
				continue
			}
			if (ch === "\\") {
				escaped = true
				continue
			}
			if (ch === '"') inString = false
			continue
		}

		if (ch === '"') {
			inString = true
			continue
		}

		if (ch === "{") depth++
		if (ch === "}") {
			depth--
			if (depth === 0) return text.slice(start, i + 1)
		}
	}

	return null
}

function expandHomePath(rawPath: string): string {
	const trimmed = rawPath.trim()
	if (!trimmed) return ""
	if (trimmed === "~") return os.homedir()
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return path.join(os.homedir(), trimmed.slice(2))
	}
	return path.resolve(trimmed)
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function normalizeUnknown(value: unknown): string {
	if (typeof value === "string") return value
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

function buildConversationPrompt(messages: ChatMessage[]): string {
	return (
		messages
			.map((m) => {
				const role = m.role.toUpperCase()
				return `${role}:\n${m.content.trim()}`
			})
			.join("\n\n") + "\n"
	)
}

export class GeminiCliModelClient implements IModelClient {
	private model: string
	private oauthPath: string
	private command: string
	private timeoutMs: number

	constructor(options: { model: string; oauthPath?: string; command?: string; timeoutMs?: number }) {
		this.model = options.model
		this.oauthPath = expandHomePath(options.oauthPath ?? "~/.gemini/oauth_creds.json")
		this.command = (options.command ?? "gemini").trim() || "gemini"
		this.timeoutMs = options.timeoutMs ?? 300_000
	}

	async chat(messages: ChatMessage[], _options?: ModelCallOptions): Promise<string> {
		const prompt = buildConversationPrompt(messages)
		return await this.invokeGeminiCli(prompt, this.model)
	}

	private getIsolatedGeminiHome(): string {
		const hash = createHash("sha1").update(path.resolve(this.oauthPath)).digest("hex").slice(0, 16)
		// Include pid so parallel builders (separate processes) do not fight over the same isolated HOME.
		return path.join(os.tmpdir(), "swarmcoder-gemini-cli-home", hash, String(process.pid))
	}

	private async prepareIsolatedGeminiHome(): Promise<{ homeDir: string; stagedOauthPath: string }> {
		// Gemini CLI stores its state in "~/.gemini". We isolate by overriding HOME/USERPROFILE so the CLI
		// reads/writes to a temp home instead of the user's real profile (which may include MCP config).
		const homeDir = this.getIsolatedGeminiHome()
		const geminiDir = path.join(homeDir, ".gemini")
		const stagedOauthPath = path.join(geminiDir, "oauth_creds.json")

		await fs.mkdir(geminiDir, { recursive: true })
		await fs.copyFile(this.oauthPath, stagedOauthPath)

		// Best-effort copy of adjacent files (Gemini CLI sometimes stores extra state).
		const sourceDir = path.dirname(this.oauthPath)
		try {
			const entries = await fs.readdir(sourceDir, { withFileTypes: true })
			for (const entry of entries) {
				if (!entry.isFile()) continue
				if (entry.name === path.basename(this.oauthPath)) continue
				// Avoid inheriting user MCP server configuration (can hang/slow in headless automation).
				if (entry.name === "settings.json" || entry.name === "settings.json.orig") continue
				const sourcePath = path.join(sourceDir, entry.name)
				const targetPath = path.join(geminiDir, entry.name)
				try {
					await fs.copyFile(sourcePath, targetPath)
				} catch {
					// ignore
				}
			}
		} catch {
			// ignore
		}

		// Minimal settings to ensure we stay in OAuth personal mode without pulling in user MCP config.
		try {
			await fs.writeFile(
				path.join(geminiDir, "settings.json"),
				JSON.stringify({ security: { auth: { selectedType: "oauth-personal" } } }, null, 2) + "\n",
				"utf8",
			)
		} catch {
			// ignore
		}

		return { homeDir, stagedOauthPath }
	}

	private async syncStagedOauthToSource(stagedOauthPath: string): Promise<void> {
		try {
			await fs.copyFile(stagedOauthPath, this.oauthPath)
		} catch {
			// Best effort: if we can't sync back, the user can still re-login.
		}
	}

	private parseJsonPayload(text: string): GeminiCliPayload | null {
		const trimmed = text.trim()
		if (!trimmed) return null
		try {
			return JSON.parse(trimmed) as GeminiCliPayload
		} catch {
			const extracted = tryExtractFirstJsonObject(trimmed)
			if (!extracted) return null
			try {
				return JSON.parse(extracted) as GeminiCliPayload
			} catch {
				return null
			}
		}
	}

	private async invokeGeminiCli(prompt: string, modelId: string): Promise<string> {
		try {
			await fs.access(this.oauthPath)
		} catch {
			throw new Error(
				`Gemini CLI OAuth credentials not found at ${this.oauthPath}. ` +
					`Run \`${this.command}\` to login or set GEMINI_CLI_OAUTH_PATH.`,
			)
		}

		const { homeDir, stagedOauthPath } = await this.prepareIsolatedGeminiHome()

		const args = ["--model", modelId, "--approval-mode", "plan", "--output-format", "json", "--prompt", "."]
		const env: NodeJS.ProcessEnv = {
			...process.env,
			HOME: homeDir,
			USERPROFILE: homeDir,
			GEMINI_CLI_HOME: homeDir,
		}

		const ioDir = path.join(homeDir, ".swarm-io")
		await fs.mkdir(ioDir, { recursive: true })

		const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
		const promptPath = path.join(ioDir, `prompt-${stamp}.txt`)
		const stdoutPath = path.join(ioDir, `stdout-${stamp}.txt`)
		const stderrPath = path.join(ioDir, `stderr-${stamp}.txt`)

		await fs.writeFile(promptPath, prompt, "utf8")

		let exitCode = 1

		try {
			await new Promise<void>((resolve, reject) => {
				let settled = false

				const tailFromFile = async (filePath: string, max = 2_000): Promise<string> => {
					try {
						const text = await fs.readFile(filePath, "utf8")
						const trimmed = text.trim()
						if (!trimmed) return ""
						return trimmed.length > max ? trimmed.slice(-max) : trimmed
					} catch {
						return ""
					}
				}

				const settleResolve = () => {
					if (settled) return
					settled = true
					resolve()
				}

				const settleReject = (error: Error) => {
					if (settled) return
					settled = true
					reject(error)
				}

				let childPid: number | null = null
				let childClosed = false

				const promptHandlePromise = fs.open(promptPath, "r")
				const stdoutHandlePromise = fs.open(stdoutPath, "w")
				const stderrHandlePromise = fs.open(stderrPath, "w")

				const killTree = () => {
					if (!childPid) return
					const pid = childPid

					if (process.platform === "win32") {
						try {
							spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
						} catch {
							// ignore
						}
						return
					}
					// Best-effort: without pipes we can't reliably stream output, so just terminate.
					// (Non-Windows) attempt graceful kill first, then hard kill.
					try {
						process.kill(pid, "SIGTERM")
					} catch {
						// ignore
					}
					setTimeout(() => {
						try {
							process.kill(pid, "SIGKILL")
						} catch {
							// ignore
						}
					}, 5_000).unref?.()
				}

				const timeout = setTimeout(() => {
					killTree()

					void (async () => {
						const stdoutTail = await tailFromFile(stdoutPath)
						const stderrTail = await tailFromFile(stderrPath)
						const details =
							`Gemini CLI timed out after ${this.timeoutMs}ms` +
							(stdoutTail ? `\n--- stdout (tail) ---\n${stdoutTail}` : "") +
							(stderrTail ? `\n--- stderr (tail) ---\n${stderrTail}` : "")
						settleReject(new Error(details))
					})()
				}, this.timeoutMs)
				timeout.unref?.()

				void (async () => {
					let promptHandle: Awaited<ReturnType<typeof fs.open>> | null = null
					let stdoutHandle: Awaited<ReturnType<typeof fs.open>> | null = null
					let stderrHandle: Awaited<ReturnType<typeof fs.open>> | null = null

					try {
						promptHandle = await promptHandlePromise
						stdoutHandle = await stdoutHandlePromise
						stderrHandle = await stderrHandlePromise
					} catch (error) {
						clearTimeout(timeout)
						settleReject(error instanceof Error ? error : new Error(String(error)))
						return
					}

					const child = spawn(this.command, args, {
						env,
						cwd: homeDir,
						windowsHide: true,
						shell: process.platform === "win32",
						stdio: [promptHandle.fd, stdoutHandle.fd, stderrHandle.fd],
					})

					childPid = child.pid ?? null

					child.on("error", (error) => {
						clearTimeout(timeout)
						settleReject(error instanceof Error ? error : new Error(String(error)))
					})

					child.on("close", (code) => {
						childClosed = true
						clearTimeout(timeout)
						exitCode = typeof code === "number" ? code : 1
						settleResolve()
					})
				})()

				const handles = [promptHandlePromise, stdoutHandlePromise, stderrHandlePromise]

				// Ensure handles are closed eventually.
				void (async () => {
					try {
						await new Promise<void>((r) => {
							const check = () => {
								if (childClosed || settled) {
									r()
									return
								}
								setTimeout(check, 100).unref?.()
							}
							check()
						})
					} finally {
						for (const p of handles) {
							try {
								const h = await p
								await h.close()
							} catch {
								// ignore
							}
						}
					}
				})()
			})
		} catch (error) {
			const details = error instanceof Error ? error.message : String(error)
			throw new Error(`Gemini CLI invocation failed: ${details}`)
		} finally {
			await this.syncStagedOauthToSource(stagedOauthPath)
		}

		const stdout = (await fs.readFile(stdoutPath, "utf8").catch(() => "")).trim()
		const stderr = (await fs.readFile(stderrPath, "utf8").catch(() => "")).trim()

		try {
			await fs.unlink(promptPath)
		} catch {
			// ignore
		}
		try {
			await fs.unlink(stdoutPath)
		} catch {
			// ignore
		}
		try {
			await fs.unlink(stderrPath)
		} catch {
			// ignore
		}

		const combined = `${stdout}\n${stderr}`.trim()
		const payload = this.parseJsonPayload(stdout) ?? this.parseJsonPayload(combined)

		const payloadError = asRecord(payload?.error)
		const payloadErrorMessage =
			(typeof payloadError?.message === "string" && payloadError.message.trim()) ||
			(typeof payload?.error === "string" && payload.error.trim()) ||
			""

		if (exitCode !== 0 || payloadError) {
			throw new Error(`Gemini CLI error: ${payloadErrorMessage || combined || `exit code ${exitCode}`}`)
		}

		if (!payload && combined) {
			throw new Error(`Provider returned malformed JSON payload: ${combined.slice(0, 400)}`)
		}

		if (payload && payload.response !== undefined) return normalizeUnknown(payload.response).trim()
		const result = stdout.trim()
		if (!result) {
			throw new Error("Provider returned empty response")
		}
		return result
	}
}
