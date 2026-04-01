import type { RoutingDecision } from "../agents/CoordinatorAgent"
import { buildTaskCorpusCatalog, classifyTaskTextToCorpusId } from "../owner/TaskCorpus"
import type { TaskCorpusCatalogEntry } from "../owner/TaskCorpus"
import type { TaskContract } from "../run/TaskContract"
import type { RepoMapArtifact } from "./RepoMap"

export type ScoutLaneEvidence = {
	corpusTaskId: string | null
	corpusLabel: string | null
	corpusLane: string | null
	contextFiles: string[]
	heuristicsUsed: string[]
	notes: string[]
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)))
}

function findCatalogEntry(task: string): TaskCorpusCatalogEntry | null {
	const corpusTaskId = classifyTaskTextToCorpusId(task)
	if (!corpusTaskId) return null
	return buildTaskCorpusCatalog().find((entry) => entry.id === corpusTaskId) ?? null
}

function pickRepoMapFiles(repoMap: RepoMapArtifact | null | undefined, candidates: string[]): string[] {
	if (!repoMap) return []
	const available = new Set([...repoMap.keyFiles, ...repoMap.likelyEntryPoints])
	return candidates.filter((candidate) => available.has(candidate))
}

export function buildScoutLaneEvidence(input: {
	task: string
	routing: RoutingDecision
	repoMap?: RepoMapArtifact | null
	taskContract?: TaskContract | null
}): ScoutLaneEvidence {
	const catalogEntry = findCatalogEntry(input.task)
	const coveredTargets = uniqueStrings(
		(input.taskContract?.scope?.allowedFiles ?? []).concat(input.routing.targetFiles ?? []),
	)
	const coveredSet = new Set(coveredTargets)
	const contextCandidates = [...(input.taskContract?.scope?.readOnlyContextFiles ?? [])]
	const heuristicsUsed: string[] = []
	const notes: string[] = []

	if (catalogEntry) {
		heuristicsUsed.push("task_corpus_match")
		notes.push(`Task corpus match: ${catalogEntry.id} (${catalogEntry.label}) lane=${catalogEntry.lane}.`)
		notes.push(`Corpus proofs: ${catalogEntry.proofCommands.join(" | ")}`)
		for (const playbookStep of catalogEntry.scoutPlaybook.slice(0, 3)) {
			notes.push(`Scout playbook: ${playbookStep}`)
		}
	} else {
		heuristicsUsed.push("task_corpus_unmatched")
		notes.push("Task corpus match: none. Keep scout evidence anchored to explicit targets and repo-map hints only.")
	}

	const scoutPack = input.repoMap?.scoutPack
	const discoveryPolicy = input.repoMap?.discoveryPack?.contextPolicy
	const maxScoutContextFiles = Math.max(1, discoveryPolicy?.maxScoutContextFiles ?? 4)

	if (input.taskContract?.refactorIntent?.anchorFile) {
		contextCandidates.push(input.taskContract.refactorIntent.anchorFile)
		heuristicsUsed.push("refactor_anchor_context")
	}

	const shouldAddDocsContext =
		Boolean(catalogEntry?.lane.includes("docs")) || coveredTargets.some((file) => file.toLowerCase().endsWith(".md"))
	const shouldAddKnowledgeDocContext =
		catalogEntry?.id === "bounded_two_file_update" || catalogEntry?.id === "medium_multi_file_update"
	if (shouldAddDocsContext) {
		contextCandidates.push(...(scoutPack?.docs ?? pickRepoMapFiles(input.repoMap, ["README.md", "QUICKSTART.md", "CONTRIBUTING.md"])))
		heuristicsUsed.push("docs_context")
	}
	if (shouldAddKnowledgeDocContext) {
		contextCandidates.push(...((scoutPack?.docs ?? pickRepoMapFiles(input.repoMap, ["README.md", "CONTRIBUTING.md"])).slice(0, 2)))
		heuristicsUsed.push("knowledge_doc_context")
	}

	if (input.routing.path === "medium" || input.routing.path === "scoped" || input.routing.path === "semi_open") {
		const repoKeyFiles = (scoutPack?.configs ?? pickRepoMapFiles(input.repoMap, ["package.json", "tsconfig.json", ".swarmcoder.json"])).slice(0, 1)
		if (repoKeyFiles.length > 0) {
			contextCandidates.push(repoKeyFiles[0] ?? "")
			heuristicsUsed.push("repo_scout_config")
		}
	}

	if (input.routing.path === "medium" || input.routing.path === "semi_open") {
		const likelyEntryPoint = (scoutPack?.entryPoints ?? input.repoMap?.likelyEntryPoints ?? []).find((file) => !coveredSet.has(file))
		if (likelyEntryPoint) {
			contextCandidates.push(likelyEntryPoint)
			heuristicsUsed.push("repo_scout_entry_point")
		}
	}
	if (scoutPack?.verificationLanes.length) {
		notes.push(`Scout verification hints: ${scoutPack.verificationLanes.join(" | ")}.`)
		heuristicsUsed.push("repo_scout_verification")
	}
	if (scoutPack?.handoffSummary.length) {
		notes.push(`Scout handoff: ${scoutPack.handoffSummary.join(" | ")}.`)
		heuristicsUsed.push("repo_scout_handoff")
	}
	if (input.repoMap?.repoSupport?.tier === "large_supported_tier_2") {
		notes.push(
			"Large repo tier-2 scout stays explicit-target-first: stable docs plus one config or entry-point hint, with nearby-neighbor and git-recency expansion suppressed.",
		)
		heuristicsUsed.push("large_repo_tier_policy")
	}

	if (input.routing.path === "medium") {
		notes.push("Medium scout stays bounded to task-corpus hints plus repo-map context. It does not reopen repo-wide discovery.")
	}
	if (input.routing.path === "semi_open") {
		notes.push("Semi-open scout stays anchored to one named source file plus one bounded derived peer or direct call-site set.")
	}

	const contextFiles = uniqueStrings(contextCandidates).filter((file) => !coveredSet.has(file)).slice(0, maxScoutContextFiles)
	if (contextFiles.length > 0) {
		notes.push(`Scout context: ${contextFiles.join(", ")}.`)
	}

	return {
		corpusTaskId: catalogEntry?.id ?? null,
		corpusLabel: catalogEntry?.label ?? null,
		corpusLane: catalogEntry?.lane ?? null,
		contextFiles,
		heuristicsUsed: uniqueStrings(heuristicsUsed),
		notes,
	}
}
