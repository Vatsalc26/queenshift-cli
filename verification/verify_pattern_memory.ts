import fs from "node:fs"
import path from "node:path"

import { SupervisorAgent } from "../src/agents/SupervisorAgent"
import type { ChatMessage, IModelClient, ModelCallOptions } from "../src/model/IModelClient"
import {
	buildPatternMemoryArtifact,
	formatPatternMemoryArtifact,
	formatPatternMemoryPromptSummary,
	readPatternMemoryArtifact,
	resetPatternMemoryArtifact,
	writePatternMemoryArtifact,
} from "../src/planning/PatternMemory"
import { buildRepoMapArtifact, type RepoMapArtifact } from "../src/planning/RepoMap"
import { buildWorkspaceMemoryOverview, formatWorkspaceMemoryOverview, formatWorkspaceMemoryPromptSummary } from "../src/planning/WorkspaceMemory"
import { buildReplayArtifact } from "../src/run/ReplayExport"
import type { TaskContract } from "../src/run/TaskContract"
import { ensureRunDir, updateRunSummary, writeReplayArtifact, writeRunSummary } from "../src/run/RunArtifacts"

export type PatternMemoryHarnessResult = {
	acceptedRunsTracked: boolean
	compactionVisible: boolean
	advisoryMatchesVisible: boolean
	replayLearnedVisible: boolean
	conventionMemoryVisible: boolean
	layeredMemoryOverviewVisible: boolean
	plannerSuggestionsInjected: boolean
	resetClearsArtifact: boolean
	details: string[]
}

class CaptureModelClient implements IModelClient {
	public lastMessages: ChatMessage[] = []

	async chat(messages: ChatMessage[], _options?: ModelCallOptions): Promise<string> {
		this.lastMessages = messages
		return "[]"
	}
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function writeFile(workspace: string, relPath: string, content: string): void {
	const filePath = path.join(workspace, relPath)
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, content, "utf8")
}

function createWorkspace(rootDir: string): { workspace: string; cleanup: () => void } {
	const workspace = path.join(rootDir, "verification", `.tmp-pattern-memory-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.mkdirSync(workspace, { recursive: true })
	writeFile(workspace, "package.json", `${JSON.stringify({ name: "pattern-memory-fixture", type: "module" }, null, 2)}\n`)
	writeFile(workspace, "README.md", "# Pattern memory fixture\n")
	writeFile(workspace, "QUICKSTART.md", "# Quickstart\n\nUse the bounded path first.\n")
	writeFile(
		workspace,
		".swarmcoder.knowledge-pack.json",
		`${JSON.stringify({ schemaVersion: 1, docs: ["QUICKSTART.md", "README.md"], notes: ["Prefer the quickstart first."] }, null, 2)}\n`,
	)
	writeFile(workspace, "src/main.ts", 'export function main(): string {\n\treturn "ok"\n}\n')
	writeFile(workspace, "src/utils.ts", 'export function helper(): string {\n\treturn "ok"\n}\n')
	return {
		workspace,
		cleanup: () => {
			if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true })
		},
	}
}

function seedRun(
	workspace: string,
	runId: string,
	input: {
		status: "done" | "failed"
		pathChosen: string
		task: string
		allowedFiles: string[]
		changedFiles: string[]
		dominantCodeExtension?: string
		importStyle?: "esm" | "cjs" | "mixed" | "none"
		acceptancePassed?: boolean
	},
): void {
	const runDir = ensureRunDir(workspace, runId)
	const summary = {
		taskId: runId,
		task: input.task,
		workspace,
		status: input.status,
		stopReason: input.status === "done" ? "success" : "verification_failed",
		pathChosen: input.pathChosen,
		endedAt: `2026-03-22T00:00:0${runId.slice(-1)}.000Z`,
		taskContract: {
			scope: {
				allowedFiles: input.allowedFiles,
				requiredTargetFiles: input.allowedFiles,
				maxEditedFileCount: input.allowedFiles.length,
			},
		},
		changedFiles: input.changedFiles,
		acceptanceGate: { passed: input.acceptancePassed !== false },
		repoMap: {
			styleHints: {
				dominantCodeExtension: input.dominantCodeExtension ?? ".ts",
				importStyle: input.importStyle ?? "esm",
			},
		},
		verificationProfile: {
			profileName: "local_npm_test_v1",
		},
	}
	const summaryPath = writeRunSummary(runDir, summary)
	if (input.status === "done" && input.acceptancePassed !== false) {
		const replayArtifact = buildReplayArtifact(runDir, summaryPath, summary, [])
		const replayArtifactPath = writeReplayArtifact(runDir, replayArtifact)
		updateRunSummary(runDir, (current) => ({
			...current,
			replayArtifactPath,
			replayOverview: {
				gateMode: replayArtifact.gateMode,
				eventCount: replayArtifact.eventCount,
				stageCounts: replayArtifact.stageCounts,
				planningSummary: replayArtifact.overview.planningSummary,
				coordinationSummary: replayArtifact.overview.coordinationSummary,
				reviewSummary: replayArtifact.overview.reviewSummary,
				artifactSummary: replayArtifact.overview.artifactSummary,
				highlightCount: replayArtifact.overview.highlights.length,
				highlights: replayArtifact.overview.highlights,
			},
		}))
	}
}

function fixtureTaskContract(): TaskContract {
	return {
		scope: {
			allowedFiles: ["src/main.ts", "src/utils.ts"],
			requiredTargetFiles: ["src/main.ts", "src/utils.ts"],
			maxEditedFileCount: 2,
		},
	}
}

function readUserMessage(messages: ChatMessage[]): string {
	return messages.find((message) => message.role === "user")?.content ?? ""
}

export async function runPatternMemoryHarness(rootDir = resolveRootDir()): Promise<PatternMemoryHarnessResult> {
	const details: string[] = []
	const fixture = createWorkspace(rootDir)

	try {
		seedRun(fixture.workspace, "run-1", {
			status: "done",
			pathChosen: "medium",
			task: "update src/main.ts and src/utils.ts together",
			allowedFiles: ["src/main.ts", "src/utils.ts"],
			changedFiles: ["src/main.ts", "src/utils.ts"],
		})
		seedRun(fixture.workspace, "run-2", {
			status: "done",
			pathChosen: "small_task",
			task: "add a brief comment to src/main.ts",
			allowedFiles: ["src/main.ts"],
			changedFiles: ["src/main.ts"],
		})
		seedRun(fixture.workspace, "run-3", {
			status: "failed",
			pathChosen: "medium",
			task: "failed multi-file attempt",
			allowedFiles: ["src/main.ts", "src/utils.ts"],
			changedFiles: ["src/main.ts"],
			acceptancePassed: false,
		})
		seedRun(fixture.workspace, "run-4", {
			status: "done",
			pathChosen: "small_task",
			task: "add another brief comment to src/main.ts",
			allowedFiles: ["src/main.ts"],
			changedFiles: ["src/main.ts"],
		})
		seedRun(fixture.workspace, "run-5", {
			status: "done",
			pathChosen: "medium",
			task: "repeat update for src/main.ts and src/utils.ts together",
			allowedFiles: ["src/main.ts", "src/utils.ts"],
			changedFiles: ["src/main.ts", "src/utils.ts"],
		})

		const repoMap = await buildRepoMapArtifact(fixture.workspace, {
			generatedAt: "2026-03-22T00:00:00.000Z",
		})
		const artifact = buildPatternMemoryArtifact(fixture.workspace, {
			pathChosen: "medium",
			taskContract: fixtureTaskContract(),
			repoMap,
			verificationProfile: "local_npm_test_v1",
			generatedAt: "2026-03-22T00:00:00.000Z",
			maxStoredPatterns: 2,
		})
		const artifactPath = writePatternMemoryArtifact(fixture.workspace, artifact)
		const artifactText = formatPatternMemoryArtifact(artifact)
		const storedArtifact = readPatternMemoryArtifact(fixture.workspace)
		const memoryOverview = buildWorkspaceMemoryOverview(fixture.workspace, {
			generatedAt: "2026-03-22T00:00:00.000Z",
		})
		const memoryOverviewText = formatWorkspaceMemoryOverview(memoryOverview)

		const acceptedRunsTracked =
			artifact.sourceRunCount === 5 &&
			artifact.acceptedRunCount === 4 &&
			artifact.storedPatterns.length === 2 &&
			artifact.storedPatterns.every((entry) => entry.runId !== "run-3")
		const compactionVisible =
			artifact.compactionPolicy.retainedPatternCount === 2 &&
			artifact.compactionPolicy.evictedPatternCount === 2 &&
			artifact.memoryBoundary.id === "pattern_memory_advisory" &&
			artifact.storedPatterns.map((entry) => entry.runId).join(",") === "run-5,run-4"
		const advisoryMatchesVisible =
			artifact.suggestedPatterns.length >= 1 &&
			artifact.suggestedPatterns[0]?.runId === "run-5" &&
			artifact.suggestedPatterns[0]?.reasons.some((reason) => reason.includes("same lane")) === true &&
			Boolean(storedArtifact?.suggestedPatterns.length)
		const replayLearnedVisible =
			artifact.replayLearnedPatternCount === 2 &&
			artifact.storedPatterns.every((entry) => entry.learningSource === "replay_artifact") &&
			artifact.suggestedPatterns.some((entry) => entry.learnedLessons.length > 0) &&
			artifactText.includes("Replay-learned patterns: 2/2")
		const conventionMemoryVisible =
			artifact.conventionSummary.some((line) => line.includes("Dominant code extension")) &&
			artifact.knowledgeSources.includes("QUICKSTART.md") &&
			artifact.knowledgeSources.includes("README.md")
		const layeredMemoryOverviewVisible =
			memoryOverview.layers.some((layer) => layer.id === "knowledge_pack_docs" && layer.state === "active") &&
			memoryOverview.layers.some((layer) => layer.id === "repo_index_cache" && layer.state === "active") &&
			memoryOverview.layers.some((layer) => layer.id === "pattern_memory_advisory" && layer.state === "active") &&
			memoryOverview.precedence[0]?.includes("Current task contract") === true &&
			memoryOverviewText.includes("Knowledge pack")

		const supervisorClient = new CaptureModelClient()
		const supervisor = new SupervisorAgent(supervisorClient)
		await supervisor.plan("update src/main.ts and src/utils.ts together", ["src/main.ts", "src/utils.ts"], 2, {
			memorySummary: formatWorkspaceMemoryPromptSummary(memoryOverview),
			patternMemorySummary: formatPatternMemoryPromptSummary(artifact),
		})
		const plannerMessage = readUserMessage(supervisorClient.lastMessages)
		const plannerSuggestionsInjected =
			plannerMessage.includes("Workspace memory:\nMemory precedence:") &&
			plannerMessage.includes("Pattern memory:\nPattern memory:") &&
			plannerMessage.includes("Replay-learned patterns: 2/2") &&
			plannerMessage.includes("Knowledge pack:") &&
			plannerMessage.includes("Repo index cache:") &&
			plannerMessage.includes("Convention memory:") &&
			plannerMessage.includes("Knowledge sources:")

		const resetClearsArtifact = resetPatternMemoryArtifact(fixture.workspace) && readPatternMemoryArtifact(fixture.workspace) === null

		details.push(`artifact=${artifactPath}`)
		details.push(`stored=${artifact.storedPatterns.map((entry) => entry.runId).join(",")}`)
		details.push(`matches=${artifact.suggestedPatterns.map((entry) => `${entry.runId}:${entry.score}`).join(",")}`)
		details.push(`memory=${memoryOverview.layers.map((layer) => `${layer.id}:${layer.state}`).join(",")}`)

		return {
			acceptedRunsTracked,
			compactionVisible,
			advisoryMatchesVisible,
			replayLearnedVisible,
			conventionMemoryVisible,
			layeredMemoryOverviewVisible,
			plannerSuggestionsInjected,
			resetClearsArtifact,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatPatternMemoryHarnessResult(result: PatternMemoryHarnessResult): string {
	return [
		`Accepted runs tracked: ${result.acceptedRunsTracked ? "PASS" : "FAIL"}`,
		`Compaction visible: ${result.compactionVisible ? "PASS" : "FAIL"}`,
		`Advisory matches visible: ${result.advisoryMatchesVisible ? "PASS" : "FAIL"}`,
		`Replay-learned guidance visible: ${result.replayLearnedVisible ? "PASS" : "FAIL"}`,
		`Convention memory visible: ${result.conventionMemoryVisible ? "PASS" : "FAIL"}`,
		`Layered memory overview visible: ${result.layeredMemoryOverviewVisible ? "PASS" : "FAIL"}`,
		`Planner suggestions injected: ${result.plannerSuggestionsInjected ? "PASS" : "FAIL"}`,
		`Reset clears artifact: ${result.resetClearsArtifact ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runPatternMemoryHarness()
	console.log(formatPatternMemoryHarnessResult(result))
	process.exit(
			result.acceptedRunsTracked &&
			result.compactionVisible &&
			result.advisoryMatchesVisible &&
			result.replayLearnedVisible &&
			result.conventionMemoryVisible &&
			result.layeredMemoryOverviewVisible &&
			result.plannerSuggestionsInjected &&
			result.resetClearsArtifact
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:pattern-memory] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
