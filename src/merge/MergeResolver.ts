import { spawn } from "child_process"
import fs from "fs"
import path from "path"

export type MergeAttempt = {
	branch: string
	success: boolean
	conflict: boolean
	error?: string
}

type GitResult = { stdout: string; stderr: string }

export class MergeResolver {
	private repoPath: string

	constructor(repoPath: string) {
		this.repoPath = repoPath
	}

	private runGit(args: string[]): Promise<GitResult> {
		return new Promise((resolve, reject) => {
			const swarmDir = path.join(this.repoPath, ".swarm")
			const tmpDir = path.join(swarmDir, "tmp")
			try {
				if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
			} catch {
				// ignore
			}

			const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
			const stdoutPath = path.join(tmpDir, `git-${stamp}.stdout.log`)
			const stderrPath = path.join(tmpDir, `git-${stamp}.stderr.log`)

			const stdoutFd = fs.openSync(stdoutPath, "w")
			const stderrFd = fs.openSync(stderrPath, "w")

			const readTail = (filePath: string, maxChars = 200_000): string => {
				try {
					const raw = fs.readFileSync(filePath, "utf8")
					if (raw.length <= maxChars) return raw
					return raw.slice(-maxChars)
				} catch {
					return ""
				}
			}

			const cleanup = () => {
				try {
					fs.closeSync(stdoutFd)
				} catch {
					// ignore
				}
				try {
					fs.closeSync(stderrFd)
				} catch {
					// ignore
				}
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
			}

			const child = spawn("git", ["-c", `safe.directory=${this.repoPath}`, ...args], {
				cwd: this.repoPath,
				windowsHide: true,
				// Avoid stdio pipes (some sandboxed environments reject them with EPERM).
				stdio: ["ignore", stdoutFd, stderrFd],
			})

			child.once("error", (err) => {
				cleanup()
				reject(err)
			})
			child.once("close", (code) => {
				const stdout = readTail(stdoutPath)
				const stderr = readTail(stderrPath)
				cleanup()

				if (code === 0) resolve({ stdout, stderr })
				else reject(new Error(`git ${args.join(" ")} failed (exit ${code ?? "null"})\n${(stderr || stdout).trim()}`.trim()))
			})
		})
	}

	async mergeNoFF(branch: string, message: string): Promise<MergeAttempt> {
		try {
			await this.runGit(["merge", "--no-ff", branch, "-m", message])
			return { branch, success: true, conflict: false }
		} catch (err) {
			try {
				await this.runGit(["merge", "--abort"])
			} catch {
				// ignore
			}
			return {
				branch,
				success: false,
				conflict: true,
				error: err instanceof Error ? err.message : String(err),
			}
		}
	}
}
