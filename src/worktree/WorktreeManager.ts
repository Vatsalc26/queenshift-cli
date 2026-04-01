import { spawn } from "child_process"
import fs from "fs"
import path from "path"

type GitResult = { stdout: string; stderr: string }

export class WorktreeManager {
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

	async create(branchName: string, worktreePath: string, baseRef: string): Promise<void> {
		if (worktreePath.length > 200) {
			throw new Error(
				`Worktree path too long (${worktreePath.length} chars): ${worktreePath}. Use a shorter base path.`,
			)
		}

		const parent = path.dirname(worktreePath)
		if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })

		if (fs.existsSync(worktreePath)) {
			throw new Error(`Worktree path already exists: ${worktreePath}`)
		}

		await this.runGit(["worktree", "add", "-b", branchName, worktreePath, baseRef])
	}

	async remove(worktreePath: string, force = false): Promise<void> {
		const args = ["worktree", "remove"]
		if (force) args.push("--force")
		args.push(worktreePath)
		await this.runGit(args)
	}

	async prune(): Promise<void> {
		await this.runGit(["worktree", "prune"])
	}
}
