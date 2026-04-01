import { spawn } from "child_process"
import fs from "node:fs"
import path from "node:path"

export type ValidationResult = { allowed: boolean; reason?: string }
export type CommandExecutionResult = { stdout: string; stderr: string; code: number; timedOut: boolean }

export class CommandExecutionError extends Error {
	readonly stdout: string
	readonly stderr: string
	readonly code: number | null
	readonly timedOut: boolean
	readonly command: string

	constructor(options: {
		command: string
		message: string
		stdout: string
		stderr: string
		code: number | null
		timedOut: boolean
	}) {
		super(options.message)
		this.name = "CommandExecutionError"
		this.command = options.command
		this.stdout = options.stdout
		this.stderr = options.stderr
		this.code = options.code
		this.timedOut = options.timedOut
	}
}

const ALLOWED_COMMAND_PREFIXES = [
	// === Git (read-only only; orchestrator owns repo topology) ===
	"git status",
	"git diff",
	"git show",
	"git log",
	"git rev-parse",

	// === Node / JS / TS (verification only; no installs/dynamic scripting) ===
	"npm run",
	"npm test",
	"npx tsc",
	"npx eslint",
	"npx prettier",
	"npx vitest",
	"npx jest",
	"npx playwright",
	"npx cypress",
	"bun run",
	"bun test",
	"pnpm run",
	"pnpm test",
	"yarn run",
	"yarn test",
	"node --version",
	"node scripts/verify.js",
	"pytest",
	"python -m pytest",
	"python -m unittest",
	"cargo test",
	"go test",

	// === Search / Read ===
	"rg ",
	"grep ",
	"find ",
	"ls",
	"cat ",
	"type ",
	"echo ",
	"head ",
	"tail ",
	"wc ",
	"dir",
	"cls",
	"clear",
]

export class CommandGate {
	private static readonly CONTROL_SEPARATOR_PATTERN = /[\r\n\u2028\u2029]/
	private static readonly DANGEROUS_SEPARATORS_PATTERN = /(\|\||&&|[|;&<>])/

	static validate(command: string): ValidationResult {
		const trimmed = command.trim().toLowerCase()

		if (CommandGate.CONTROL_SEPARATOR_PATTERN.test(command)) {
			return { allowed: false, reason: "Command contains forbidden control separators" }
		}

		// Without V1's PolicyEngine, block chaining/redirection entirely.
		if (CommandGate.DANGEROUS_SEPARATORS_PATTERN.test(command)) {
			return { allowed: false, reason: "Command contains forbidden shell separators or redirection" }
		}

		const isAllowed = ALLOWED_COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix.toLowerCase()))
		if (!isAllowed) {
			return { allowed: false, reason: `Command "${command}" is not in the allowlist.` }
		}

		return { allowed: true }
	}

	static run(
		command: string,
		cwd: string,
		options: { timeoutMs?: number; maxOutputChars?: number } = {},
	): Promise<CommandExecutionResult> {
		const validation = CommandGate.validate(command)
		if (!validation.allowed) {
			return Promise.reject(new Error(`[SECURITY] Command blocked: ${validation.reason ?? "unknown"}`))
		}

		const timeoutMs = options.timeoutMs ?? 30_000
		const maxOutputChars = options.maxOutputChars ?? 10_000

		return new Promise((resolve, reject) => {
			const swarmDir = path.join(cwd, ".swarm")
			const tmpDir = path.join(swarmDir, "tmp")
			try {
				if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
			} catch {
				// ignore
			}

			const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
			const stdoutPath = path.join(tmpDir, `cmd-${stamp}.stdout.log`)
			const stderrPath = path.join(tmpDir, `cmd-${stamp}.stderr.log`)

			let stdoutFd: number | null = null
			let stderrFd: number | null = null

			const cleanup = () => {
				if (stdoutFd !== null) {
					try {
						fs.closeSync(stdoutFd)
					} catch {
						// ignore
					}
				}
				if (stderrFd !== null) {
					try {
						fs.closeSync(stderrFd)
					} catch {
						// ignore
					}
				}
			}

			try {
				stdoutFd = fs.openSync(stdoutPath, "w")
				stderrFd = fs.openSync(stderrPath, "w")
			} catch (err) {
				cleanup()
				reject(err instanceof Error ? err : new Error(String(err)))
				return
			}

			const platform = process.platform
			const child =
				platform === "win32"
					? spawn("cmd.exe", ["/d", "/s", "/c", command], { cwd, windowsHide: true, stdio: ["ignore", stdoutFd, stderrFd] })
					: spawn("sh", ["-lc", command], { cwd, stdio: ["ignore", stdoutFd, stderrFd] })
			let timedOut = false

			const readTail = (filePath: string): string => {
				try {
					const raw = fs.readFileSync(filePath, "utf8")
					if (raw.length <= maxOutputChars) return raw
					return raw.slice(-maxOutputChars)
				} catch {
					return ""
				}
			}

			const killTree = () => {
				if (!child.pid) return
				if (platform === "win32") {
					try {
						spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
					} catch {
						// ignore
					}
					return
				}

				try {
					child.kill("SIGTERM")
				} catch {
					// ignore
				}
				setTimeout(() => {
					try {
						child.kill("SIGKILL")
					} catch {
						// ignore
					}
				}, 5_000).unref?.()
			}

			const timeout = setTimeout(() => {
				timedOut = true
				killTree()
			}, timeoutMs)
			timeout.unref?.()

			child.once("error", (err) => {
				clearTimeout(timeout)
				cleanup()
				reject(err)
			})

			child.once("close", (code) => {
				clearTimeout(timeout)
				cleanup()

				const stdout = readTail(stdoutPath)
				const stderr = readTail(stderrPath)

				try {
					fs.unlinkSync(stdoutPath)
				} catch {
					// ignore
				}
				try {
					fs.unlinkSync(stderrPath)
				} catch {
					// ignore
				}

				if (timedOut || code !== 0) {
					const baseMessage = timedOut
						? `Command timed out after ${timeoutMs}ms: ${command}`
						: `Command failed (exit ${code ?? "null"}): ${command}`
					reject(
						new CommandExecutionError({
							command,
							message: `${baseMessage}\n${stderr || stdout}`.trim(),
							stdout,
							stderr,
							code,
							timedOut,
						}),
					)
					return
				}

				resolve({ stdout, stderr, code: 0, timedOut: false })
			})
		})
	}
}
