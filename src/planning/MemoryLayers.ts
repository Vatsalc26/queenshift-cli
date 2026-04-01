export type MemoryLayerId = "knowledge_pack_docs" | "pattern_memory_advisory" | "repo_index_cache" | "owner_cache_defaults"

export type MemoryLayerBoundary = {
	id: MemoryLayerId
	label: string
	purpose: string
	retentionRule: string
	resetSurface: string
	planningVisibility: string
}

const MEMORY_LAYER_BOUNDARIES: Record<MemoryLayerId, MemoryLayerBoundary> = {
	knowledge_pack_docs: {
		id: "knowledge_pack_docs",
		label: "Knowledge pack",
		purpose: "Repo-owned checked-in docs and notes for repeated planning and review.",
		retentionRule: "Keep one checked-in manifest per repo and update it through normal versioned file edits.",
		resetSurface: "Edit or delete .swarmcoder.knowledge-pack.json",
		planningVisibility: "Planner and context packs may prefer these docs before repo-map fallback docs.",
	},
	pattern_memory_advisory: {
		id: "pattern_memory_advisory",
		label: "Pattern memory",
		purpose: "Advisory accepted-run patterns only.",
		retentionRule: "Keep a compact bounded set of recent distinct accepted patterns; never override current evidence.",
		resetSurface: "resetPatternMemoryArtifact(workspace)",
		planningVisibility: "Planner may read advisory matches and convention hints only.",
	},
	repo_index_cache: {
		id: "repo_index_cache",
		label: "Repo index cache",
		purpose: "One fingerprinted repo-structure snapshot for bounded reuse.",
		retentionRule: "Keep one cached snapshot per workspace and replace it when the fingerprint changes.",
		resetSurface: "Delete .swarm/cache/repo-index-state.json",
		planningVisibility: "Planner may read the current repo summary only, never run history.",
	},
	owner_cache_defaults: {
		id: "owner_cache_defaults",
		label: "Owner cache",
		purpose: "Remember owner launch defaults only.",
		retentionRule: "Keep one current record and replace it on each remember operation.",
		resetSurface: "resetOwnerCache(rootDir)",
		planningVisibility: "Owner shell may reuse defaults, but no task or run memory is stored here.",
	},
}

export function getMemoryLayerBoundary(layerId: MemoryLayerId): MemoryLayerBoundary {
	return MEMORY_LAYER_BOUNDARIES[layerId]
}

export function formatMemoryLayerBoundary(boundary: MemoryLayerBoundary): string {
	return `${boundary.label}: ${boundary.purpose} Retention=${boundary.retentionRule} Reset=${boundary.resetSurface}.`
}
