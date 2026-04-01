import fs from "node:fs"
import path from "node:path"

import { listRunDirs, readReplayArtifact, readRunSummary } from "../run/RunArtifacts"
import {
	buildReplayLearnedImprovement,
	type ReplayLearningSource,
} from "../run/ReplayLearning"
import type { TaskContract } from "../run/TaskContract"
import { selectKnowledgePackDocs } from "./KnowledgePack"
import { getMemoryLayerBoundary, type MemoryLayerBoundary } from "./MemoryLayers"
import type { RepoMapArtifact, RepoMapImportStyle } from "./RepoMap"

type SummaryLike = Record<string, unknown>

export type PatternMemoryEntry = {
	patternId: string
	runId: string
	recordedAt: string
	task: string
	pathChosen: string | null
	scopeSize: number
	dominantCodeExtension: string | null
	importStyle: RepoMapImportStyle | null
	changedFiles: string[]
	verificationProfile: string | null
	learningSource: ReplayLearningSource
	learningSummary: string
	learnedLessons: string[]
	replayHighlights: string[]
}

export type PatternMemoryMatch = {
	patternId: string
	runId: string
	score: number
	reasons: string[]
	rationale: string
	pathChosen: string | null
	scopeSize: number
	task: string
	learningSummary: string
	learnedLessons: string[]
}

export type PatternMemoryArtifact = {
	schemaVersion: 1
	generatedAt: string
	workspaceName: string
	sourceRunCount: number
	acceptedRunCount: number
	advisoryOnly: true
	memoryBoundary: MemoryLayerBoundary
	replayLearnedPatternCount: number
	compactionPolicy: {
		maxStoredPatterns: number
		sourceAcceptedCount: number
		retainedPatternCount: number
		evictedPatternCount: number
		dedupeBySignature: true
	}
	conventionSummary: string[]
	knowledgeSources: string[]
	storedPatterns: PatternMemoryEntry[]
	suggestedPatterns: PatternMemoryMatch[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : []
}

function acceptedRun(summary: SummaryLike | null): boolean {
	if (!summary) return false
	if (asString(summary["status"]) !== "done") return false
	const acceptanceGate = asRecord(summary["acceptanceGate"])
	if (acceptanceGate && acceptanceGate["passed"] !== true) return false
	return true
}

function extractScopeSize(summary: SummaryLike | null): number {
	const taskContract = asRecord(summary?.["taskContract"])
	const scope = asRecord(taskContract?.["scope"])
	const allowedFiles = asStringArray(scope?.["allowedFiles"])
	const requiredTargetFiles = asStringArray(scope?.["requiredTargetFiles"])
	const changedFiles = asStringArray(summary?.["changedFiles"])
	return Math.max(allowedFiles.length, requiredTargetFiles.length, changedFiles.length)
}

function extractVerificationProfile(summary: SummaryLike | null): string | null {
	const verificationProfile = asRecord(summary?.["verificationProfile"])
	return asString(verificationProfile?.["profileName"]) ?? asString(verificationProfile?.["message"])
}

function extractPatternEntry(runDir: string, summary: SummaryLike | null): PatternMemoryEntry | null {
	if (!acceptedRun(summary)) return null
	const runId = asString(summary?.["taskId"])
	const task = asString(summary?.["task"])
	if (!runId || !task) return null
	const repoMap = asRecord(summary?.["repoMap"])
	const styleHints = asRecord(repoMap?.["styleHints"])
	const learning = buildReplayLearnedImprovement(summary, readReplayArtifact(runDir))
	return {
		patternId: `pattern-${runId}`,
		runId,
		recordedAt: asString(summary?.["endedAt"]) ?? asString(summary?.["startedAt"]) ?? new Date(0).toISOString(),
		task,
		pathChosen: asString(summary?.["pathChosen"]),
		scopeSize: extractScopeSize(summary),
		dominantCodeExtension: asString(styleHints?.["dominantCodeExtension"]),
		importStyle: (asString(styleHints?.["importStyle"]) as RepoMapImportStyle | null) ?? null,
		changedFiles: asStringArray(summary?.["changedFiles"]),
		verificationProfile: extractVerificationProfile(summary),
		learningSource: learning.source,
		learningSummary: learning.summary,
		learnedLessons: learning.lessons,
		replayHighlights: learning.highlights,
	}
}

function scopeBucket(size: number): "tiny" | "small" | "medium" | "large" {
	if (size <= 1) return "tiny"
	if (size <= 5) return "small"
	if (size <= 10) return "medium"
	return "large"
}

function buildPatternSignature(entry: PatternMemoryEntry): string {
	return JSON.stringify({
		pathChosen: entry.pathChosen,
		scopeBucket: scopeBucket(entry.scopeSize),
		dominantCodeExtension: entry.dominantCodeExtension,
		importStyle: entry.importStyle,
		verificationProfile: entry.verificationProfile,
		changedFiles: [...entry.changedFiles].sort((left, right) => left.localeCompare(right)),
	})
}

function compactStoredPatterns(entries: PatternMemoryEntry[], maxStoredPatterns: number): PatternMemoryEntry[] {
	const retained: PatternMemoryEntry[] = []
	const seenSignatures = new Set<string>()
	for (const entry of entries) {
		const signature = buildPatternSignature(entry)
		if (seenSignatures.has(signature)) continue
		seenSignatures.add(signature)
		retained.push(entry)
		if (retained.length >= maxStoredPatterns) break
	}
	return retained
}

function buildMatchReasons(
	entry: PatternMemoryEntry,
	input: {
		pathChosen: string | null
		scopeSize: number
		repoMap: RepoMapArtifact | null
		verificationProfile: string | null
	},
): { score: number; reasons: string[] } {
	const reasons: string[] = []
	let score = 0

	if (input.pathChosen && entry.pathChosen === input.pathChosen) {
		reasons.push(`same lane (${entry.pathChosen})`)
		score += 3
	}

	if (input.scopeSize > 0 && entry.scopeSize === input.scopeSize) {
		reasons.push(`same file-touch count (${entry.scopeSize})`)
		score += 2
	} else if (input.scopeSize > 0 && scopeBucket(entry.scopeSize) === scopeBucket(input.scopeSize)) {
		reasons.push(`same scope bucket (${scopeBucket(entry.scopeSize)})`)
		score += 1
	}

	const dominantExtension = input.repoMap?.styleHints.dominantCodeExtension ?? null
	if (dominantExtension && entry.dominantCodeExtension === dominantExtension) {
		reasons.push(`same dominant extension (${dominantExtension})`)
		score += 2
	}

	const importStyle = input.repoMap?.styleHints.importStyle ?? null
	if (importStyle && importStyle !== "none" && entry.importStyle === importStyle) {
		reasons.push(`same import style (${importStyle})`)
		score += 1
	}

	if (input.verificationProfile && entry.verificationProfile === input.verificationProfile) {
		reasons.push(`same verification profile (${input.verificationProfile})`)
		score += 2
	}

	return { score, reasons }
}

function buildConventionSummary(workspace: string, repoMap: RepoMapArtifact | null): { conventionSummary: string[]; knowledgeSources: string[] } {
	const conventionSummary: string[] = []
	const knowledgeSources: string[] = []
	if (!repoMap) {
		return { conventionSummary, knowledgeSources }
	}
	if (repoMap.styleHints.dominantCodeExtension) {
		conventionSummary.push(`Dominant code extension: ${repoMap.styleHints.dominantCodeExtension}.`)
	}
	if (repoMap.styleHints.importStyle !== "none") {
		conventionSummary.push(`Import style: ${repoMap.styleHints.importStyle}.`)
	}
	if (repoMap.styleHints.fileNameStyles.length > 0) {
		conventionSummary.push(`File naming styles: ${repoMap.styleHints.fileNameStyles.join(", ")}.`)
	}
	const fallbackKnowledgeDocs = repoMap.keyFiles.filter((keyFile) =>
		["README.md", "CONTRIBUTING.md", "ARCHITECTURE_DECISIONS.md", "LANGUAGE_PACKS.md", "QUICKSTART.md", "OWNER_OVERSIGHT_GUIDE.md"].includes(
			path.posix.basename(keyFile),
		),
	)
	knowledgeSources.push(...selectKnowledgePackDocs(workspace, fallbackKnowledgeDocs).docs)
	const readmePath = path.join(workspace, "README.md")
	if (knowledgeSources.length === 0 && fs.existsSync(readmePath)) knowledgeSources.push("README.md")
	return {
		conventionSummary: conventionSummary.slice(0, 4),
		knowledgeSources: knowledgeSources.slice(0, 4),
	}
}

export function resolvePatternMemoryArtifactPath(workspace: string): string {
	return path.join(workspace, ".swarm", "pattern-memory.json")
}

export function readPatternMemoryArtifact(workspace: string): PatternMemoryArtifact | null {
	const artifactPath = resolvePatternMemoryArtifactPath(workspace)
	if (!fs.existsSync(artifactPath)) return null
	try {
		return JSON.parse(fs.readFileSync(artifactPath, "utf8")) as PatternMemoryArtifact
	} catch {
		return null
	}
}

export function writePatternMemoryArtifact(workspace: string, artifact: PatternMemoryArtifact): string {
	const artifactPath = resolvePatternMemoryArtifactPath(workspace)
	fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
	fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
	return artifactPath
}

export function resetPatternMemoryArtifact(workspace: string): boolean {
	const artifactPath = resolvePatternMemoryArtifactPath(workspace)
	if (!fs.existsSync(artifactPath)) return false
	fs.unlinkSync(artifactPath)
	return true
}

export function buildPatternMemoryArtifact(
	workspace: string,
	input: {
		pathChosen?: string | null
		taskContract?: TaskContract | null
		repoMap?: RepoMapArtifact | null
		verificationProfile?: string | null
		generatedAt?: string
		maxMatches?: number
		maxStoredPatterns?: number
	},
): PatternMemoryArtifact {
	const runRecords = listRunDirs(workspace).map((runDir) => ({
		runDir,
		summary: readRunSummary(runDir),
	}))
	const summaries = runRecords.map((record) => record.summary)
	const acceptedPatterns = runRecords
		.map(({ runDir, summary }) => extractPatternEntry(runDir, summary))
		.filter((entry): entry is PatternMemoryEntry => entry !== null)
		.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
	const maxStoredPatterns = Math.max(1, input.maxStoredPatterns ?? 5)
	const storedPatterns = compactStoredPatterns(acceptedPatterns, maxStoredPatterns)

	const currentScopeSize = Math.max(
		input.taskContract?.scope?.allowedFiles.length ?? 0,
		input.taskContract?.scope?.requiredTargetFiles.length ?? 0,
	)
	const { conventionSummary, knowledgeSources } = buildConventionSummary(workspace, input.repoMap ?? null)
	const suggestedPatterns = storedPatterns
		.map((entry) => {
			const match = buildMatchReasons(entry, {
				pathChosen: input.pathChosen ?? null,
				scopeSize: currentScopeSize,
				repoMap: input.repoMap ?? null,
				verificationProfile: input.verificationProfile ?? null,
			})
			if (match.score <= 0 || match.reasons.length === 0) return null
			return {
				patternId: entry.patternId,
				runId: entry.runId,
				score: match.score,
				reasons: match.reasons,
				rationale: `Matched because ${match.reasons.join(", ")}.`,
				pathChosen: entry.pathChosen,
				scopeSize: entry.scopeSize,
				task: entry.task,
				learningSummary: entry.learningSummary,
				learnedLessons: entry.learnedLessons,
			}
		})
		.filter((entry): entry is PatternMemoryMatch => entry !== null)
		.sort((left, right) => right.score - left.score || left.runId.localeCompare(right.runId))
		.slice(0, Math.max(1, input.maxMatches ?? 3))

	return {
		schemaVersion: 1,
		generatedAt: input.generatedAt ?? new Date().toISOString(),
		workspaceName: path.basename(workspace),
		sourceRunCount: summaries.length,
		acceptedRunCount: acceptedPatterns.length,
		advisoryOnly: true,
		memoryBoundary: getMemoryLayerBoundary("pattern_memory_advisory"),
		replayLearnedPatternCount: storedPatterns.filter((entry) => entry.learningSource === "replay_artifact").length,
		compactionPolicy: {
			maxStoredPatterns,
			sourceAcceptedCount: acceptedPatterns.length,
			retainedPatternCount: storedPatterns.length,
			evictedPatternCount: Math.max(0, acceptedPatterns.length - storedPatterns.length),
			dedupeBySignature: true,
		},
		conventionSummary,
		knowledgeSources,
		storedPatterns,
		suggestedPatterns,
	}
}

export function formatPatternMemoryPromptSummary(artifact: PatternMemoryArtifact, maxMatches = 3): string {
	return [
		`Pattern memory: ${artifact.acceptedRunCount} accepted run(s) recorded.`,
		`Layer boundary: ${artifact.memoryBoundary.purpose} Compaction=${artifact.compactionPolicy.retainedPatternCount}/${artifact.compactionPolicy.sourceAcceptedCount} retained (cap ${artifact.compactionPolicy.maxStoredPatterns}).`,
		`Replay-learned patterns: ${artifact.replayLearnedPatternCount}/${artifact.storedPatterns.length || 0}.`,
		...(artifact.conventionSummary.length > 0 ? [`Convention memory: ${artifact.conventionSummary.join(" ")}`] : []),
		...(artifact.knowledgeSources.length > 0 ? [`Knowledge sources: ${artifact.knowledgeSources.join(", ")}`] : []),
		...(artifact.suggestedPatterns.length > 0
			? [
					`Advisory matches: ${artifact.suggestedPatterns.length}.`,
					...artifact.suggestedPatterns.slice(0, Math.max(1, maxMatches)).map((match) =>
						`- ${match.runId}: ${match.rationale} Replay lesson: ${match.learnedLessons[0] ?? match.learningSummary} Prior task: ${match.task}`,
					),
			  ]
			: ["Advisory matches: none."]),
	].join("\n")
}

export function formatPatternMemoryArtifact(artifact: PatternMemoryArtifact): string {
	return [
		`Accepted runs: ${artifact.acceptedRunCount}/${artifact.sourceRunCount}`,
		`Layer boundary: ${artifact.memoryBoundary.id} retained=${artifact.compactionPolicy.retainedPatternCount}/${artifact.compactionPolicy.sourceAcceptedCount} cap=${artifact.compactionPolicy.maxStoredPatterns}`,
		`Replay-learned patterns: ${artifact.replayLearnedPatternCount}/${artifact.storedPatterns.length}`,
		`Convention memory: ${artifact.conventionSummary.join(" ") || "(none)"}`,
		`Knowledge sources: ${artifact.knowledgeSources.join(", ") || "(none)"}`,
		`Suggested patterns: ${artifact.suggestedPatterns.length}`,
		...artifact.suggestedPatterns.map(
			(match) =>
				`- ${match.runId} score=${match.score} reasons=${match.reasons.join("; ")} lesson=${match.learnedLessons[0] ?? match.learningSummary} task=${match.task}`,
		),
	].join("\n")
}
