import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

import type { QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { runVerificationGit } from "./test_workspace_baseline"

export type CandidateProgressSnapshot = {
	engine?: string
	status?: string
	stopReason?: string
	taskFamilyHint?: string | null
	allowedFiles?: string[]
	activeQueue?: string
	currentStage?: string
	selectedSpecialist?: string | null
	confidenceOutcome?: string | null
	executionAttempted?: boolean
	missionId?: string | null
	assignmentId?: string | null
	lastEventAt?: string | null
	nextTimeoutAt?: string | null
	nextExpectedHandoff?: string | null
}

export function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

export function readText(rootDir: string, relativePath: string): string {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8")
}

export function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

export function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function readAssignmentPacket(envelope: QueenBeeEnvelope | null): QueenBeeEnvelope | null {
	const payload = asRecord(envelope?.payload)
	if (!payload || !Array.isArray(payload["assignmentPackets"])) return null
	const first = payload["assignmentPackets"][0]
	return first && typeof first === "object" && !Array.isArray(first) ? (first as QueenBeeEnvelope) : null
}

export function normalizeFilePath(value: string): string {
	return value.replace(/[\\/]+/g, "/").trim()
}

export function hasSameFileSet(left: string[], right: string[]): boolean {
	const leftSet = new Set(left.map(normalizeFilePath).filter(Boolean))
	const rightSet = new Set(right.map(normalizeFilePath).filter(Boolean))
	if (leftSet.size !== rightSet.size) return false
	for (const value of leftSet) {
		if (!rightSet.has(value)) return false
	}
	return true
}

export async function runCli(
	rootDir: string,
	args: string[],
	env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return await new Promise((resolve, reject) => {
		const tmpDir = path.join(rootDir, ".swarm", "tmp")
		fs.mkdirSync(tmpDir, { recursive: true })
		const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
		const stdoutPath = path.join(tmpDir, `queenbee-gateway-${stamp}.stdout.log`)
		const stderrPath = path.join(tmpDir, `queenbee-gateway-${stamp}.stderr.log`)
		const stdoutFd = fs.openSync(stdoutPath, "w")
		const stderrFd = fs.openSync(stderrPath, "w")
		const readFile = (filePath: string): string => {
			try {
				return fs.readFileSync(filePath, "utf8")
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

		const child = spawn(process.execPath, ["dist/swarm.js", ...args], {
			cwd: rootDir,
			env,
			windowsHide: true,
			stdio: ["ignore", stdoutFd, stderrFd],
		})

		child.once("error", (err) => {
			cleanup()
			reject(err)
		})
		child.once("close", (code) => {
			const stdout = readFile(stdoutPath)
			const stderr = readFile(stderrPath)
			cleanup()
			resolve({ code, stdout, stderr })
		})
	})
}

export async function commitFixtureChanges(repoPath: string, message: string): Promise<void> {
	const status = await runVerificationGit(repoPath, ["status", "--porcelain", "--untracked-files=all"])
	if (!status.trim()) return
	await runVerificationGit(repoPath, ["add", "-A"])
	await runVerificationGit(repoPath, ["commit", "-m", message])
}
