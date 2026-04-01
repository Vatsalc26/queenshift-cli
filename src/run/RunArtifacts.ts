import fs from "node:fs"
import path from "node:path"

export type RunEvent = {
	type: string
	timestamp?: string
	[key: string]: unknown
}

export function ensureRunDir(workspace: string, taskId: string): string {
	const runDir = path.join(workspace, ".swarm", "runs", taskId)
	fs.mkdirSync(runDir, { recursive: true })
	return runDir
}

export function resolveRunsDir(workspace: string): string {
	return path.join(workspace, ".swarm", "runs")
}

export function resolveRunDir(workspace: string, taskId: string): string {
	return path.join(resolveRunsDir(workspace), taskId)
}

export function resolveRunSummaryPath(runDir: string): string {
	return path.join(runDir, "summary.json")
}

export function resolveReviewPackPath(runDir: string): string {
	return path.join(runDir, "review-pack.json")
}

export function resolveIncidentPackPath(runDir: string): string {
	return path.join(runDir, "incident-pack.json")
}

export function resolveCheckpointArtifactPath(runDir: string): string {
	return path.join(runDir, "checkpoints.json")
}

export function resolveRepoMapArtifactPath(runDir: string): string {
	return path.join(runDir, "repo-map.json")
}

export function resolveContextPackArtifactPath(runDir: string): string {
	return path.join(runDir, "context-pack.json")
}

function sanitizeArtifactId(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_")
}

export function resolveSubtaskContextPackDir(runDir: string): string {
	return path.join(runDir, "context-packs")
}

export function resolveSubtaskContextPackArtifactPath(runDir: string, workItemId: string): string {
	return path.join(resolveSubtaskContextPackDir(runDir), `${sanitizeArtifactId(workItemId)}.json`)
}

export function resolveReplayArtifactPath(runDir: string): string {
	return path.join(runDir, "replay.json")
}

export function appendRunEvent(runDir: string, event: RunEvent): void {
	const eventPath = path.join(runDir, "events.ndjson")
	const payload = {
		timestamp: new Date().toISOString(),
		...event,
	}
	fs.appendFileSync(eventPath, `${JSON.stringify(payload)}\n`, "utf8")
}

export function appendRunEventFromEnv(event: RunEvent): void {
	const runDir = (process.env["SWARM_RUN_ARTIFACT_DIR"] ?? "").trim()
	if (!runDir) return
	try {
		appendRunEvent(runDir, event)
	} catch {
		// ignore best-effort artifact logging failures
	}
}

export function readRunEvents(runDir: string): RunEvent[] {
	const eventPath = path.join(runDir, "events.ndjson")
	if (!fs.existsSync(eventPath)) return []

	const raw = fs.readFileSync(eventPath, "utf8")
	return raw
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as RunEvent]
			} catch {
				return []
			}
		})
}

export function writeRunSummary(runDir: string, summary: Record<string, unknown>): string {
	const summaryPath = resolveRunSummaryPath(runDir)
	fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
	return summaryPath
}

export function writeReviewPack(runDir: string, pack: Record<string, unknown>): string {
	const reviewPackPath = resolveReviewPackPath(runDir)
	fs.writeFileSync(reviewPackPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8")
	return reviewPackPath
}

export function writeIncidentPack(runDir: string, pack: Record<string, unknown>): string {
	const incidentPackPath = resolveIncidentPackPath(runDir)
	fs.writeFileSync(incidentPackPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8")
	return incidentPackPath
}

export function writeCheckpointArtifact(runDir: string, artifact: Record<string, unknown>): string {
	const checkpointArtifactPath = resolveCheckpointArtifactPath(runDir)
	fs.writeFileSync(checkpointArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
	return checkpointArtifactPath
}

export function writeRepoMapArtifact(runDir: string, artifact: Record<string, unknown>): string {
	const repoMapArtifactPath = resolveRepoMapArtifactPath(runDir)
	fs.writeFileSync(repoMapArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
	return repoMapArtifactPath
}

export function writeContextPackArtifact(runDir: string, artifact: Record<string, unknown>): string {
	const contextPackArtifactPath = resolveContextPackArtifactPath(runDir)
	fs.writeFileSync(contextPackArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
	return contextPackArtifactPath
}

export function writeSubtaskContextPackArtifact(runDir: string, workItemId: string, artifact: Record<string, unknown>): string {
	const contextPackArtifactPath = resolveSubtaskContextPackArtifactPath(runDir, workItemId)
	fs.mkdirSync(path.dirname(contextPackArtifactPath), { recursive: true })
	fs.writeFileSync(contextPackArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
	return contextPackArtifactPath
}

export function writeReplayArtifact(runDir: string, artifact: Record<string, unknown>): string {
	const replayArtifactPath = resolveReplayArtifactPath(runDir)
	fs.writeFileSync(replayArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
	return replayArtifactPath
}

export function readJsonFile<T>(filePath: string): T | null {
	if (!fs.existsSync(filePath)) return null
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8")) as T
	} catch {
		return null
	}
}

export function readRunSummary<T extends Record<string, unknown> = Record<string, unknown>>(runDir: string): T | null {
	return readJsonFile<T>(resolveRunSummaryPath(runDir))
}

export function readReviewPack<T extends Record<string, unknown> = Record<string, unknown>>(runDir: string): T | null {
	return readJsonFile<T>(resolveReviewPackPath(runDir))
}

export function readIncidentPack<T extends Record<string, unknown> = Record<string, unknown>>(runDir: string): T | null {
	return readJsonFile<T>(resolveIncidentPackPath(runDir))
}

export function readCheckpointArtifact<T extends Record<string, unknown> = Record<string, unknown>>(
	runDir: string,
): T | null {
	return readJsonFile<T>(resolveCheckpointArtifactPath(runDir))
}

export function readRepoMapArtifact<T extends Record<string, unknown> = Record<string, unknown>>(runDir: string): T | null {
	return readJsonFile<T>(resolveRepoMapArtifactPath(runDir))
}

export function readContextPackArtifact<T extends Record<string, unknown> = Record<string, unknown>>(
	runDir: string,
): T | null {
	return readJsonFile<T>(resolveContextPackArtifactPath(runDir))
}

export function readSubtaskContextPackArtifact<T extends Record<string, unknown> = Record<string, unknown>>(
	runDir: string,
	workItemId: string,
): T | null {
	return readJsonFile<T>(resolveSubtaskContextPackArtifactPath(runDir, workItemId))
}

export function readReplayArtifact<T extends Record<string, unknown> = Record<string, unknown>>(runDir: string): T | null {
	return readJsonFile<T>(resolveReplayArtifactPath(runDir))
}

export function listRunDirs(workspace: string): string[] {
	const runsDir = resolveRunsDir(workspace)
	if (!fs.existsSync(runsDir)) return []
	return fs
		.readdirSync(runsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(runsDir, entry.name))
}

export function updateRunSummary(
	runDir: string,
	updater: (summary: Record<string, unknown>) => Record<string, unknown>,
): string | null {
	const current = readRunSummary(runDir)
	if (!current) return null
	return writeRunSummary(runDir, updater(current))
}

export function findLatestRunSummary(workspace: string): string | null {
	const candidates = listRunDirs(workspace)
		.map((entry) => {
			const summaryPath = resolveRunSummaryPath(entry)
			if (!fs.existsSync(summaryPath)) return null
			const stat = fs.statSync(summaryPath)
			return { summaryPath, mtimeMs: stat.mtimeMs }
		})
		.filter((entry): entry is { summaryPath: string; mtimeMs: number } => entry !== null)
		.sort((a, b) => b.mtimeMs - a.mtimeMs)

	return candidates[0]?.summaryPath ?? null
}
