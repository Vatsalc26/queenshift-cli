import fs from "node:fs"
import path from "node:path"

import { DatabaseService } from "../src/db/DatabaseService"
import { BuilderAgent } from "../src/agents/BuilderAgent"
import { SupervisorAgent } from "../src/agents/SupervisorAgent"
import type { ChatMessage, IModelClient, ModelCallOptions } from "../src/model/IModelClient"
import {
	buildContextPackArtifact,
	buildSubtaskContextPackArtifacts,
	formatContextPackPromptSummary,
	type ContextPackArtifact,
} from "../src/planning/ContextPacks"
import { buildRepoDiscoveryPack } from "../src/planning/DiscoveryPack"
import { writeDefaultKnowledgePack } from "../src/planning/KnowledgePack"
import { buildScoutLaneEvidence } from "../src/planning/ScoutLane"
import { resolveSubtaskContextPackArtifactPath, writeContextPackArtifact, writeSubtaskContextPackArtifact } from "../src/run/RunArtifacts"
import type { TaskContract } from "../src/run/TaskContract"
import type { RepoMapArtifact } from "../src/planning/RepoMap"

export type ContextPackHarnessResult = {
	selectedTargetsVisible: boolean
	budgetAndOmissionsVisible: boolean
	knowledgeDocsVisible: boolean
	knowledgePackPriorityVisible: boolean
	discoveryPackVisible: boolean
	largeTierPolicyVisible: boolean
	scoutHintsVisible: boolean
	roleViewsVisible: boolean
	plannerPromptInjectionVisible: boolean
	builderPromptInjectionVisible: boolean
	runArtifactVisible: boolean
	subtaskSlicesVisible: boolean
	details: string[]
}

class CaptureModelClient implements IModelClient {
	public lastMessages: ChatMessage[] = []
	private readonly response: string

	constructor(response: string) {
		this.response = response
	}

	async chat(messages: ChatMessage[], _options?: ModelCallOptions): Promise<string> {
		this.lastMessages = messages
		return this.response
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

function buildFixtureRepoMap(
	workspace: string,
	options: { supportTier?: "small_supported" | "large_supported_tier_2" } = {},
): RepoMapArtifact {
	const scoutPack = {
		docs: ["README.md", "CONTRIBUTING.md", "QUICKSTART.md"],
		configs: ["package.json"],
		entryPoints: ["src/main.ts"],
		verificationLanes: ["local_npm_test_v1 -> npm test"],
		handoffSummary: [
			"docs=README.md, CONTRIBUTING.md, QUICKSTART.md",
			"configs=package.json",
			"entryPoints=src/main.ts",
			"verification=local_npm_test_v1 -> npm test",
		],
	}
	return {
		schemaVersion: 1,
		workspaceName: "context-pack-fixture",
		generatedAt: "2026-03-22T00:00:00.000Z",
		totalFiles: 7,
		topLevelEntries: [
			{ path: "src", kind: "dir", role: "source", fileCount: 3 },
			{ path: "package.json", kind: "file", role: "config" },
		],
		keyFiles: ["package.json", "README.md", "QUICKSTART.md", "CONTRIBUTING.md", "src/main.ts", "src/utils.ts"],
		likelyEntryPoints: ["src/main.ts"],
		ignoredAreas: [".git", ".swarm", "node_modules"],
		fileTypeBreakdown: [{ extension: ".ts", count: 3 }],
		styleHints: {
			dominantCodeExtension: ".ts",
			importStyle: "esm",
			fileNameStyles: ["flat"],
		},
		repoSupport: {
			tier: options.supportTier ?? "small_supported",
			label: options.supportTier === "large_supported_tier_2" ? "Large repo tier 2 candidate" : "Small supported repo",
			decision: options.supportTier === "large_supported_tier_2" ? "allow_with_review_bias" : "allow",
			reviewBias: options.supportTier === "large_supported_tier_2",
			fileCount: options.supportTier === "large_supported_tier_2" ? 2505 : 7,
			totalBytes: options.supportTier === "large_supported_tier_2" ? 12_500_000 : 2_048,
			dirtyEntryCount: 1,
		},
		scoutPack,
		discoveryPack: buildRepoDiscoveryPack({
			workspace,
			fallbackDocs: scoutPack.docs,
			configs: scoutPack.configs,
			entryPoints: scoutPack.entryPoints,
			verificationLanes: scoutPack.verificationLanes,
			supportTier: options.supportTier ?? "small_supported",
		}),
		gitHints: {
			available: true,
			branch: "main",
			workingTree: "dirty",
			changedFiles: ["src/main.ts"],
			recentFiles: ["src/helpers.ts"],
		},
		plannerSummary: ["Context pack fixture repo map."],
	}
}

function buildFixtureTaskContract(): TaskContract {
	return {
		scope: {
			allowedFiles: ["src/main.ts", "src/utils.ts"],
			requiredTargetFiles: ["src/main.ts", "src/utils.ts"],
			maxEditedFileCount: 2,
			readOnlyContextFiles: ["package.json"],
		},
		acceptance: {
			expectedChangedFiles: ["src/main.ts", "src/utils.ts"],
			requiredContentSnippets: [{ path: "src/utils.ts", snippet: 'return input.trim()' }],
		},
	}
}

function createWorkspace(rootDir: string): { workspace: string; cleanup: () => void } {
	const workspace = path.join(rootDir, "verification", `.tmp-context-pack-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.mkdirSync(workspace, { recursive: true })
	writeFile(workspace, "package.json", `${JSON.stringify({ name: "context-pack-fixture", type: "module" }, null, 2)}\n`)
	writeFile(workspace, "src/main.ts", 'import { helper } from "./helpers"\n\nexport function main(): string {\n\treturn helper()\n}\n')
	writeFile(workspace, "src/utils.ts", 'export function formatValue(input: string): string {\n\treturn input.trim()\n}\n')
	writeFile(workspace, "src/helpers.ts", 'export function helper(): string {\n\treturn "hello"\n}\n')
	writeFile(workspace, "README.md", "# Context pack fixture\n")
	writeFile(workspace, "QUICKSTART.md", "# Quickstart\n\nRun the bounded path first.\n")
	writeFile(workspace, "CONTRIBUTING.md", "# Contributing\n\nKeep changes bounded.\n")
	return {
		workspace,
		cleanup: () => {
			if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true })
		},
	}
}

function readUserMessage(messages: ChatMessage[]): string {
	return messages.find((message) => message.role === "user")?.content ?? ""
}

export async function runContextPackHarness(rootDir = resolveRootDir()): Promise<ContextPackHarnessResult> {
	const details: string[] = []
	const fixture = createWorkspace(rootDir)
	const taskContract = buildFixtureTaskContract()
	const seedRepoMap = buildFixtureRepoMap(fixture.workspace)
	writeDefaultKnowledgePack(fixture.workspace, seedRepoMap)
	const repoMap = buildFixtureRepoMap(fixture.workspace)
	const largeRepoMap = buildFixtureRepoMap(fixture.workspace, { supportTier: "large_supported_tier_2" })
	const scoutEvidence = buildScoutLaneEvidence({
		task: "update src/main.ts and src/utils.ts together",
		routing: {
			complexity: "COMPLEX",
			path: "scoped",
			usedModel: false,
			targetFiles: ["src/main.ts", "src/utils.ts"],
			selectorSource: "explicit_targets",
			reasonCodes: ["explicit_file_targets", "bounded_target_count", "prefer_deterministic_coordination"],
			taskContract,
		},
		repoMap,
		taskContract,
	})
	const largeRepoScoutEvidence = buildScoutLaneEvidence({
		task: "update src/main.ts and src/utils.ts together",
		routing: {
			complexity: "COMPLEX",
			path: "scoped",
			usedModel: false,
			targetFiles: ["src/main.ts", "src/utils.ts"],
			selectorSource: "explicit_targets",
			reasonCodes: ["explicit_file_targets", "bounded_target_count", "prefer_deterministic_coordination"],
			taskContract,
		},
		repoMap: largeRepoMap,
		taskContract,
	})
	const pack = buildContextPackArtifact(fixture.workspace, {
		taskFiles: ["src/main.ts", "src/utils.ts"],
		repoMap,
		taskContract,
		scoutNotes: scoutEvidence.notes,
		scoutContextFiles: scoutEvidence.contextFiles,
		generatedAt: "2026-03-22T00:00:00.000Z",
		maxFiles: 6,
		maxPreviewBytes: 340,
		maxPreviewCharsPerFile: 120,
	})
	const largeRepoPack = buildContextPackArtifact(fixture.workspace, {
		taskFiles: ["src/main.ts", "src/utils.ts"],
		repoMap: largeRepoMap,
		taskContract,
		scoutNotes: largeRepoScoutEvidence.notes,
		scoutContextFiles: largeRepoScoutEvidence.contextFiles,
		generatedAt: "2026-03-22T00:00:00.000Z",
		maxFiles: 6,
		maxPreviewBytes: 340,
		maxPreviewCharsPerFile: 120,
	})

	DatabaseService.reset()
	const dbPath = path.join(rootDir, "verification", `.tmp-context-pack-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)
	const db = DatabaseService.getInstance(dbPath)
	const runDir = path.join(fixture.workspace, ".swarm", "runs", "context-pack-fixture")
	fs.mkdirSync(runDir, { recursive: true })
	const contextPackPath = writeContextPackArtifact(runDir, pack)
	const subtaskPacks = buildSubtaskContextPackArtifacts(fixture.workspace, {
		subtasks: [
			{ id: "subtask-1", files: ["src/main.ts"], assignedBuilder: "builder-1" },
			{ id: "subtask-2", files: ["src/utils.ts"], assignedBuilder: "builder-2" },
		],
		repoMap,
		taskContract,
			scoutNotes: scoutEvidence.notes,
			scoutContextFiles: scoutEvidence.contextFiles,
			generatedAt: "2026-03-22T00:00:00.000Z",
			maxFiles: 6,
			maxPreviewBytes: 340,
			maxPreviewCharsPerFile: 120,
		})
	const primarySubtaskPack = subtaskPacks["subtask-1"]
	if (!primarySubtaskPack) {
		throw new Error("Expected a subtask context pack for subtask-1.")
	}
	const subtaskContextPackPath = writeSubtaskContextPackArtifact(runDir, "subtask-1", primarySubtaskPack)

	try {
		const selectedTargetsVisible =
			pack.selectedFiles.some((file) => file.path === "src/main.ts" && file.reason === "task_target") &&
			pack.selectedFiles.some((file) => file.path === "src/utils.ts" && file.reason === "task_target") &&
			pack.selectedFiles.some((file) => file.path === "package.json" && file.reason === "task_context")
		const scoutHintsVisible =
			pack.scoutNotes.some((note) => note.includes("bounded_two_file_update")) &&
			pack.selectedFiles.some((file) => file.path === "README.md" && file.reason === "scout_context") &&
			pack.plannerSummary.some((line) => line.includes("Scout notes:"))

		const budgetAndOmissionsVisible =
			pack.previewBytesUsed <= pack.maxPreviewBytes &&
			pack.omittedFiles.some((file) => file.omissionReason === "budget") &&
			pack.plannerSummary.some((line) => line.includes("Omitted:")) &&
			pack.workerSummary.some((line) => line.includes("Preview budget used:"))
		const knowledgeDocsVisible =
			pack.selectedFiles.some((file) => file.path === "QUICKSTART.md" && file.reason === "knowledge_doc") &&
			pack.plannerSummary.some((line) => line.includes("Knowledge docs: QUICKSTART.md"))
		const knowledgePackPriorityVisible =
			fs.readFileSync(path.join(fixture.workspace, ".swarmcoder.knowledge-pack.json"), "utf8").includes("QUICKSTART.md") &&
			pack.selectedFiles.some((file) => file.path === "QUICKSTART.md" && file.reason === "knowledge_doc")
		const discoveryPackVisible =
			pack.discoverySummary.some((line) => line.includes("source=knowledge_pack")) &&
			pack.discoverySummary.some((line) => line.includes("Discovery stages:")) &&
			pack.discoverySummary.some((line) => line.includes("Discovery policy:")) &&
			pack.roleViews.planner.summary.some((line) => line.includes("Planner discovery pack:")) &&
			pack.roleViews.builder.summary.some((line) => line.includes("Builder discovery pack:")) &&
			pack.plannerSummary.some((line) => line.includes("Discovery pack:"))
		const largeTierPolicyVisible =
			largeRepoPack.discoverySummary.some((line) => line.includes("profile=large_repo_tier_2")) &&
			largeRepoPack.selectedFiles.every((file) => file.reason !== "nearby_neighbor" && file.reason !== "git_hint") &&
			largeRepoPack.selectedFiles.some((file) => file.path === "README.md" && file.reason === "scout_context") &&
			largeRepoPack.plannerSummary.some((line) => line.includes("Discovery policy: profile=large_repo_tier_2"))
		const roleViewsVisible =
			pack.roleViews.planner.summary.some((line) => line.includes("Planner focus:")) &&
			pack.roleViews.builder.summary.some((line) => line.includes("Builder focus:")) &&
			pack.roleViews.critic.summary.some((line) => line.includes("Critic focus:")) &&
			pack.roleViews.reviewer.summary.some((line) => line.includes("Reviewer focus:")) &&
			pack.roleViews.planner.summary.join("|") !== pack.roleViews.builder.summary.join("|")

		const supervisorClient = new CaptureModelClient("[]")
		const supervisor = new SupervisorAgent(supervisorClient)
		await supervisor.plan("update src/main.ts and src/utils.ts together", ["src/main.ts", "src/utils.ts", "package.json"], 2, {
			repoMapSummary: "Repo map summary fixture",
			contextPackSummary: formatContextPackPromptSummary(pack, "planner"),
		})
		const plannerPromptInjectionVisible =
			readUserMessage(supervisorClient.lastMessages).includes("Planner focus:") &&
			!readUserMessage(supervisorClient.lastMessages).includes("Builder focus:")

		const builderClient = new CaptureModelClient('{"files":[],"summary":"no-op"}')
		const builder = new BuilderAgent(
			"builder-1",
			"context-pack-task",
			"update src/main.ts and src/utils.ts together",
			fixture.workspace,
			db,
			builderClient,
			{
				dryRun: true,
				mode: "direct_files",
				allowedFiles: ["src/main.ts", "src/utils.ts"],
				contextFiles: ["package.json"],
				contextPackPath,
			},
		)
		const builderMessages = (
			builder as unknown as {
				buildDirectEditMessages: () => ChatMessage[]
			}
		).buildDirectEditMessages()
		const builderUserMessage = readUserMessage(builderMessages)
		const builderPromptInjectionVisible =
			builderUserMessage.includes("Context pack summary:") &&
			builderUserMessage.includes("Builder focus:") &&
			builderUserMessage.includes("Builder contract:") &&
			builderUserMessage.includes('Builder literals: required=src/utils.ts => "return input.trim()"') &&
			!builderUserMessage.includes("Planner focus:") &&
			builderUserMessage.includes("--- src/main.ts (task_target") &&
			builderUserMessage.includes("--- package.json (task_context")
		const subtaskSlicesVisible =
			primarySubtaskPack.scope.kind === "subtask" &&
			primarySubtaskPack.selectedFiles.some((file) => file.path === "src/main.ts") &&
			!primarySubtaskPack.selectedFiles.some((file) => file.path === "src/utils.ts") &&
			fs.existsSync(resolveSubtaskContextPackArtifactPath(runDir, "subtask-1")) &&
			JSON.parse(fs.readFileSync(subtaskContextPackPath, "utf8")).scope.kind === "subtask"

		const runArtifactVisible =
			fs.existsSync(contextPackPath) &&
			JSON.parse(fs.readFileSync(contextPackPath, "utf8")).selectedFiles.length === pack.selectedFiles.length

		details.push(`selected=${pack.selectedFiles.map((file) => `${file.path}:${file.reason}`).join(",")}`)
		details.push(`omitted=${pack.omittedFiles.map((file) => `${file.path}:${file.omissionReason}`).join(",") || "(none)"}`)
		details.push(`artifact=${contextPackPath}`)
		details.push(`subtaskArtifact=${subtaskContextPackPath}`)

		return {
			selectedTargetsVisible,
			budgetAndOmissionsVisible,
			knowledgeDocsVisible,
			knowledgePackPriorityVisible,
			discoveryPackVisible,
			largeTierPolicyVisible,
			scoutHintsVisible,
			roleViewsVisible,
			plannerPromptInjectionVisible,
			builderPromptInjectionVisible,
			runArtifactVisible,
			subtaskSlicesVisible,
			details,
		}
	} finally {
		db.close()
		DatabaseService.reset()
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
		fixture.cleanup()
	}
}

export function formatContextPackHarnessResult(result: ContextPackHarnessResult): string {
	return [
		`Selected targets visible: ${result.selectedTargetsVisible ? "PASS" : "FAIL"}`,
		`Budget and omissions visible: ${result.budgetAndOmissionsVisible ? "PASS" : "FAIL"}`,
		`Knowledge docs visible: ${result.knowledgeDocsVisible ? "PASS" : "FAIL"}`,
		`Knowledge-pack priority visible: ${result.knowledgePackPriorityVisible ? "PASS" : "FAIL"}`,
		`Discovery pack visible: ${result.discoveryPackVisible ? "PASS" : "FAIL"}`,
		`Large-tier scout policy visible: ${result.largeTierPolicyVisible ? "PASS" : "FAIL"}`,
		`Scout hints visible: ${result.scoutHintsVisible ? "PASS" : "FAIL"}`,
		`Role views visible: ${result.roleViewsVisible ? "PASS" : "FAIL"}`,
		`Planner prompt injection visible: ${result.plannerPromptInjectionVisible ? "PASS" : "FAIL"}`,
		`Builder prompt injection visible: ${result.builderPromptInjectionVisible ? "PASS" : "FAIL"}`,
		`Run artifact visible: ${result.runArtifactVisible ? "PASS" : "FAIL"}`,
		`Subtask slices visible: ${result.subtaskSlicesVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runContextPackHarness()
	console.log(formatContextPackHarnessResult(result))
	process.exit(
			result.selectedTargetsVisible &&
			result.budgetAndOmissionsVisible &&
			result.knowledgeDocsVisible &&
			result.knowledgePackPriorityVisible &&
			result.discoveryPackVisible &&
			result.largeTierPolicyVisible &&
			result.scoutHintsVisible &&
			result.roleViewsVisible &&
			result.plannerPromptInjectionVisible &&
			result.builderPromptInjectionVisible &&
			result.runArtifactVisible &&
			result.subtaskSlicesVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:context-packs] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
