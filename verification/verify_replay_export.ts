import fs from "node:fs"
import path from "node:path"

import { Orchestrator } from "../src/Orchestrator"
import { DatabaseService } from "../src/db/DatabaseService"
import { buildReplayArtifact, compareReplayArtifacts, formatReplayExport, resolveReplayExport } from "../src/run/ReplayExport"
import { appendRunEvent, ensureRunDir, readRunEvents, writeReplayArtifact, writeRunSummary } from "../src/run/RunArtifacts"

export type ReplayExportHarnessResult = {
	replayArtifactPersisted: boolean
	stageSequenceVisible: boolean
	manifestMetadataVisible: boolean
	overviewVisible: boolean
	campaignVisible: boolean
	learningLoopVisible: boolean
	reproducibilityVisible: boolean
	divergenceComparisonVisible: boolean
	replayLocationVisible: boolean
	recoveryLoopVisible: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function buildReproducibilityOverview(replayArtifact: ReturnType<typeof buildReplayArtifact>): Record<string, unknown> {
	return {
		comparisonKey: replayArtifact.reproducibility.comparisonKey,
		outcomeKey: replayArtifact.reproducibility.outcomeKey,
		facts: replayArtifact.reproducibility.facts,
		summary: replayArtifact.reproducibility.summary,
		guidance: replayArtifact.reproducibility.guidance,
	}
}

function createTempRepoCopy(rootDir: string, name: string): { repoPath: string; cleanup: () => void } {
	const repoPath = path.join(rootDir, "verification", `.tmp-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.cpSync(path.join(rootDir, "verification", "test_workspace"), repoPath, { recursive: true, force: true })
	const swarmDir = path.join(repoPath, ".swarm")
	if (fs.existsSync(swarmDir)) fs.rmSync(swarmDir, { recursive: true, force: true })
	return {
		repoPath,
		cleanup: () => {
			if (fs.existsSync(repoPath)) fs.rmSync(repoPath, { recursive: true, force: true })
		},
	}
}

export async function runReplayExportHarness(rootDir = resolveRootDir()): Promise<ReplayExportHarnessResult> {
	const details: string[] = []
	const repoHarness = createTempRepoCopy(rootDir, "replay-export")
	DatabaseService.reset()
	const dbPath = path.join(rootDir, "verification", `.tmp-replay-export-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)
	const db = DatabaseService.getInstance(dbPath)

	try {
		const orchestrator = new Orchestrator(repoHarness.repoPath, db, true)
		const runResult = await orchestrator.run("update hello.ts and utils.ts together")
		const summary = JSON.parse(fs.readFileSync(runResult.summaryPath, "utf8")) as Record<string, unknown>
		const replayResult = resolveReplayExport(repoHarness.repoPath, "latest")
		const replayArtifactPath = typeof summary["replayArtifactPath"] === "string" ? summary["replayArtifactPath"] : null
		const latestReproducibilityOverview = asRecord(summary["reproducibilityOverview"])
		const latestReproducibilityFacts = asRecord(latestReproducibilityOverview?.["facts"])

		const sequenceRunId = "task-replay-sequence"
		const sequenceRunDir = ensureRunDir(repoHarness.repoPath, sequenceRunId)
		appendRunEvent(sequenceRunDir, {
			type: "guardrails_initialized",
			taskId: sequenceRunId,
			maxModelCalls: 10,
			maxEstimatedTokens: 50000,
		})
		appendRunEvent(sequenceRunDir, {
			type: "repo_map_built",
			taskId: sequenceRunId,
			totalFiles: 6,
			entryPointCount: 2,
		})
		appendRunEvent(sequenceRunDir, {
			type: "plan_built",
			taskId: sequenceRunId,
			pathChosen: "scoped",
			workItemCount: 2,
		})
		appendRunEvent(sequenceRunDir, {
			type: "agent_start",
			taskId: sequenceRunId,
			agentId: "builder-1",
			role: "builder",
		})
		appendRunEvent(sequenceRunDir, {
			type: "agent_iteration",
			taskId: sequenceRunId,
			agentId: "builder-1",
			role: "builder",
			iteration: 1,
		})
		appendRunEvent(sequenceRunDir, {
			type: "model_call",
			taskId: sequenceRunId,
			actor: "builder-1",
			success: true,
			durationMs: 120,
		})
		appendRunEvent(sequenceRunDir, {
			type: "critic_evaluated",
			taskId: sequenceRunId,
			status: "pass",
			concernCount: 0,
		})
		appendRunEvent(sequenceRunDir, {
			type: "run_end",
			taskId: sequenceRunId,
			status: "done",
			stopReason: "success",
		})
		const sequenceSummaryRecord = {
			taskId: sequenceRunId,
			task: "update hello.ts and utils.ts together",
			workspace: repoHarness.repoPath,
			dryRun: true,
			status: "done",
			stopReason: "success",
			pathChosen: "scoped",
			surface: "cli_artifact",
			profileManifestHash: "manifest-sequence-fixture",
			reviewerVerdict: "PASS",
			acceptanceGate: { passed: true, failedChecks: [] },
			verificationProfile: { status: "passed", profileName: "local-npm-test" },
			taskContract: {
				scope: {
					allowedFiles: ["hello.ts", "utils.ts"],
					requiredTargetFiles: ["hello.ts", "utils.ts"],
					maxEditedFileCount: 2,
				},
			},
			changedFiles: ["hello.ts", "utils.ts"],
			campaign: {
				schemaVersion: 1,
				campaignId: "campaign-task-replay-sequence",
				originRunId: sequenceRunId,
				currentRunId: sequenceRunId,
				previousRunId: null,
				attemptNumber: 1,
				nextAttemptNumber: 2,
				sourceRunIds: [sequenceRunId],
			},
			plan: {
				workItems: [{ id: "subtask-1" }, { id: "subtask-2" }],
			},
			mergeOrder: {
				status: "planned",
				negotiation: {
					mode: "integration_branch_review",
					readiness: "ready_for_review",
					reviewStages: [
						{ id: "source_order", label: "Source order", status: "ready", summary: "Review the ordered source branches." },
						{ id: "integration_branch", label: "Integration branch", status: "ready", summary: "Inspect the integration branch." },
						{ id: "human_approval", label: "Human approval", status: "ready", summary: "Human approval can proceed once the recorded order still matches." },
					],
					handoffSummary: "Ordered handoff: swarm/task-replay-sequence/subtask-1 (hello.ts) -> swarm/task-replay-sequence/subtask-2 after subtask-1 (utils.ts).",
					summary: "Integration branch swarm/task-replay-sequence/integration should absorb 2 source branches before human approval.",
				},
			},
			progressMap: {
				readyAssignmentIds: ["assign-subtask-1"],
				blockedAssignmentIds: ["assign-subtask-2"],
				releasedAssignmentIds: [],
				stageCount: 2,
			},
			criticLane: {
				status: "pass",
				summary: "Critic lane recorded no blocking concerns for this bounded run.",
			},
			retryPlanner: {
				decision: "retryable",
			},
			contextPackArtifactPath: "context-pack.json",
			subtaskContextPackArtifactPaths: {
				"subtask-1": "context-packs/subtask-1.json",
				"subtask-2": "context-packs/subtask-2.json",
			},
			checkpointArtifactPath: "checkpoints.json",
			patternMemoryArtifactPath: "pattern-memory.json",
		}
		const sequenceSummaryPath = writeRunSummary(sequenceRunDir, sequenceSummaryRecord)
		const sequenceReplayArtifact = buildReplayArtifact(
			sequenceRunDir,
			sequenceSummaryPath,
			sequenceSummaryRecord,
			readRunEvents(sequenceRunDir),
		)
		const sequenceReplayPath = writeReplayArtifact(sequenceRunDir, sequenceReplayArtifact)
		const sequenceSummaryPathFinal =
			writeRunSummary(sequenceRunDir, {
				...sequenceSummaryRecord,
				replayArtifactPath: sequenceReplayPath,
				replayOverview: {
					gateMode: sequenceReplayArtifact.gateMode,
					eventCount: sequenceReplayArtifact.eventCount,
					stageCounts: sequenceReplayArtifact.stageCounts,
					planningSummary: sequenceReplayArtifact.overview.planningSummary,
					coordinationSummary: sequenceReplayArtifact.overview.coordinationSummary,
					reviewSummary: sequenceReplayArtifact.overview.reviewSummary,
					artifactSummary: sequenceReplayArtifact.overview.artifactSummary,
					highlightCount: sequenceReplayArtifact.overview.highlights.length,
					highlights: sequenceReplayArtifact.overview.highlights,
				},
				reproducibilityOverview: buildReproducibilityOverview(sequenceReplayArtifact),
			}) ?? sequenceSummaryPath
		const sequenceReplayResult = resolveReplayExport(repoHarness.repoPath, sequenceRunId)
		const latestReplayText = formatReplayExport(replayResult)
		const sequenceReplayText = formatReplayExport(sequenceReplayResult)
		const sequenceSummaryFinal = JSON.parse(fs.readFileSync(sequenceSummaryPathFinal, "utf8")) as Record<string, unknown>
		const replayOverview = asRecord(sequenceSummaryFinal["replayOverview"])
		const sequenceReproducibilityOverview = asRecord(sequenceSummaryFinal["reproducibilityOverview"])
		const sequenceReproducibilityFacts = asRecord(sequenceReproducibilityOverview?.["facts"])
		const replay = sequenceReplayResult.replay

		const divergentRunId = "task-replay-sequence-divergent"
		const divergentRunDir = ensureRunDir(repoHarness.repoPath, divergentRunId)
		appendRunEvent(divergentRunDir, {
			type: "run_end",
			taskId: divergentRunId,
			status: "review_required",
			stopReason: "review_blocked",
		})
		const divergentSummaryRecord = {
			...sequenceSummaryRecord,
			taskId: divergentRunId,
			status: "review_required",
			stopReason: "review_blocked",
			reviewerVerdict: "NEEDS_WORK",
			acceptanceGate: { passed: false, failedChecks: ["scope_drift"] },
			verificationProfile: { status: "failed", profileName: "local-npm-test" },
			changedFiles: ["README.md", "hello.ts"],
			campaign: {
				...sequenceSummaryRecord.campaign,
				campaignId: "campaign-task-replay-sequence-divergent",
				originRunId: divergentRunId,
				currentRunId: divergentRunId,
				sourceRunIds: [divergentRunId],
			},
		}
		const divergentSummaryPath = writeRunSummary(divergentRunDir, divergentSummaryRecord)
		const divergentReplayArtifact = buildReplayArtifact(
			divergentRunDir,
			divergentSummaryPath,
			divergentSummaryRecord,
			readRunEvents(divergentRunDir),
		)
		writeReplayArtifact(divergentRunDir, divergentReplayArtifact)
		const divergenceComparison = compareReplayArtifacts(sequenceReplayResult.replay, divergentReplayArtifact)

		const replayArtifactPersisted =
			replayResult.found &&
			Boolean(replayArtifactPath) &&
			replayArtifactPath === replayResult.replayPath &&
			Boolean(replayResult.replayPath && fs.existsSync(replayResult.replayPath))
		const stageSequenceVisible = replay
			? replay.entries.some((entry) => entry.stage === "planning") &&
				replay.entries.some((entry) => entry.stage === "execution") &&
				replay.entries.at(-1)?.stage === "outcome"
			: false
		const manifestMetadataVisible = replay
			? replay.gateMode === "deterministic" &&
				replay.pathChosen === "scoped" &&
				replay.profileManifestHash === "manifest-sequence-fixture" &&
				Boolean(asRecord(replayOverview?.stageCounts))
			: false
		const overviewVisible = replay
			? replay.overview.planningSummary.includes("lane=scoped") &&
				replay.overview.coordinationSummary.includes("ready=assign-subtask-1") &&
				replay.overview.reviewSummary.includes("critic=pass") &&
				replay.overview.artifactSummary.includes("checkpoints=yes") &&
				replay.overview.highlights.length > 0
			: false
		const campaignVisible = replay
			? replay.overview.planningSummary.includes("campaign=campaign-task-replay-sequence#1") &&
				replay.overview.artifactSummary.includes("evaluators=")
			: false
		const learningLoopVisible = replay
			? replay.learning.eligible &&
				replay.learning.source === "replay_artifact" &&
				replay.learning.summary.includes("Accepted bounded run") &&
				replay.learning.lessons.some((lesson) => lesson.includes("verification profile local-npm-test"))
			: false
		const reproducibilityVisible =
			Boolean(
				replayResult.replay &&
					latestReproducibilityOverview &&
					latestReproducibilityFacts &&
					latestReproducibilityOverview["summary"] === replayResult.replay.reproducibility.summary &&
					Array.isArray(latestReproducibilityOverview["guidance"]) &&
					Array.isArray(latestReproducibilityFacts["scopeFiles"]) &&
					replayResult.replay.reproducibility.facts.gateMode === replayResult.replay.gateMode &&
					replayResult.replay.reproducibility.facts.status === replayResult.replay.status &&
					replayResult.replay.reproducibility.guidance.length > 0,
			) &&
			Boolean(
				replay &&
					sequenceReproducibilityOverview &&
					sequenceReproducibilityFacts &&
					asRecord(sequenceReproducibilityOverview["facts"]) &&
					sequenceReplayText.includes("Reproducibility:") &&
					sequenceReplayText.includes("Comparison key:") &&
					sequenceReplayText.includes("Outcome key:") &&
					sequenceReplayText.includes("Guidance:") &&
					Array.isArray(sequenceReproducibilityFacts["scopeFiles"]) &&
					Array.isArray(sequenceReproducibilityFacts["changedFiles"]) &&
					replay.reproducibility.facts.scopeFiles.join(",") === "hello.ts,utils.ts",
			)
		const divergenceComparisonVisible =
			divergenceComparison.comparable &&
			!divergenceComparison.outcomeMatch &&
			divergenceComparison.alignedSignals.includes("scopeFiles") &&
			divergenceComparison.divergentSignals.includes("status") &&
			divergenceComparison.divergentSignals.includes("stopReason") &&
			divergenceComparison.divergentSignals.includes("reviewerVerdict") &&
			divergenceComparison.divergentSignals.includes("acceptance") &&
			divergenceComparison.divergentSignals.includes("verification") &&
			divergenceComparison.divergentSignals.includes("changedFiles") &&
			divergenceComparison.summary.includes("diverged")
		const replayLocationVisible =
			sequenceReplayText.includes("Replay export: PASS") &&
			sequenceReplayText.includes("Summary:") &&
			sequenceReplayText.includes("Replay:") &&
			sequenceReplayText.includes("Overview:") &&
			sequenceReplayText.includes("Learning:") &&
			sequenceReplayText.includes("Highlights:") &&
			sequenceReplayText.includes("Timeline:") &&
			latestReplayText.includes("Reproducibility:")
		const recoveryLoopVisible =
			sequenceReplayText.includes("Use this replay: inspect the recorded timeline and bounded artifacts before rerunning, reviewing, or reporting the run.") &&
			sequenceReplayText.includes("Recovery loop: incident:latest -> owner:quick-actions -> replay:latest")

		details.push(`summary=${runResult.summaryPath}`)
		details.push(`replay=${replayResult.replayPath ?? "(missing)"}`)
		details.push(`sequenceSummary=${sequenceSummaryPathFinal}`)
		details.push(`sequenceReplay=${sequenceReplayResult.replayPath ?? "(missing)"}`)
		details.push(`divergenceSummary=${divergentSummaryPath}`)
		details.push(`divergence=${divergenceComparison.summary}`)

		return {
			replayArtifactPersisted,
			stageSequenceVisible,
			manifestMetadataVisible,
			overviewVisible,
			campaignVisible,
			learningLoopVisible,
			reproducibilityVisible,
			divergenceComparisonVisible,
			replayLocationVisible,
			recoveryLoopVisible,
			details,
		}
	} finally {
		db.close()
		DatabaseService.reset()
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
		repoHarness.cleanup()
	}
}

export function formatReplayExportHarnessResult(result: ReplayExportHarnessResult): string {
	return [
		`Replay artifact persisted: ${result.replayArtifactPersisted ? "PASS" : "FAIL"}`,
		`Stage sequence visible: ${result.stageSequenceVisible ? "PASS" : "FAIL"}`,
		`Manifest metadata visible: ${result.manifestMetadataVisible ? "PASS" : "FAIL"}`,
		`Overview visible: ${result.overviewVisible ? "PASS" : "FAIL"}`,
		`Campaign visible: ${result.campaignVisible ? "PASS" : "FAIL"}`,
		`Learning loop visible: ${result.learningLoopVisible ? "PASS" : "FAIL"}`,
		`Reproducibility visible: ${result.reproducibilityVisible ? "PASS" : "FAIL"}`,
		`Divergence comparison visible: ${result.divergenceComparisonVisible ? "PASS" : "FAIL"}`,
		`Replay location visible: ${result.replayLocationVisible ? "PASS" : "FAIL"}`,
		`Recovery loop visible: ${result.recoveryLoopVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runReplayExportHarness()
	console.log(formatReplayExportHarnessResult(result))
	process.exit(
		result.replayArtifactPersisted &&
			result.stageSequenceVisible &&
			result.manifestMetadataVisible &&
			result.overviewVisible &&
			result.campaignVisible &&
			result.learningLoopVisible &&
			result.reproducibilityVisible &&
			result.divergenceComparisonVisible &&
			result.replayLocationVisible &&
			result.recoveryLoopVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:replay-export] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
