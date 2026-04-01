import { selectKnowledgePackDocs } from "./KnowledgePack"
import type { RepoSupportTier } from "../run/AdmissionGate"

export type RepoDiscoveryPackSource = "knowledge_pack" | "repo_map_fallback"
export type RepoDiscoveryStageId = "stable_docs" | "entry_and_config" | "verification"
export type RepoDiscoveryContextPolicyProfile = "default_bounded" | "large_repo_tier_2"

export type RepoDiscoveryContextPolicy = {
	profile: RepoDiscoveryContextPolicyProfile
	maxDocs: number
	maxConfigs: number
	maxEntryPoints: number
	maxVerificationLanes: number
	maxScoutContextFiles: number
	includeNearbyNeighbors: boolean
	includeGitHints: boolean
	requireExplicitTargets: boolean
	notes: string[]
}

export type RepoDiscoveryStage = {
	stage: 1 | 2 | 3
	id: RepoDiscoveryStageId
	label: string
	purpose: string
	targets: string[]
}

export type RepoDiscoveryPack = {
	mode: "progressive_bounded"
	source: RepoDiscoveryPackSource
	docs: string[]
	notes: string[]
	entryPoints: string[]
	configs: string[]
	verificationLanes: string[]
	contextPolicy: RepoDiscoveryContextPolicy
	stages: RepoDiscoveryStage[]
	summary: string[]
}

function normalizeRelPath(input: string): string {
	return input.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

function uniqueLimited(values: string[], limit: number): string[] {
	const unique = Array.from(new Set(values.map((value) => normalizeRelPath(value)).filter(Boolean)))
	return unique.slice(0, Math.max(0, limit))
}

function formatTargets(targets: string[]): string {
	return targets.join(", ") || "(none)"
}

export function resolveRepoDiscoveryContextPolicy(supportTier: RepoSupportTier | null | undefined): RepoDiscoveryContextPolicy {
	if (supportTier === "large_supported_tier_2") {
		return {
			profile: "large_repo_tier_2",
			maxDocs: 2,
			maxConfigs: 1,
			maxEntryPoints: 1,
			maxVerificationLanes: 2,
			maxScoutContextFiles: 2,
			includeNearbyNeighbors: false,
			includeGitHints: false,
			requireExplicitTargets: true,
			notes: [
				"Tier-2 large repos stay anchored to explicit targets plus a tiny stable-doc and config budget.",
				"Nearby siblings and git-recency hints stay off to reduce noisy context on bigger trees.",
			],
		}
	}

	return {
		profile: "default_bounded",
		maxDocs: 4,
		maxConfigs: 2,
		maxEntryPoints: 2,
		maxVerificationLanes: 3,
		maxScoutContextFiles: 4,
		includeNearbyNeighbors: true,
		includeGitHints: true,
		requireExplicitTargets: true,
		notes: ["Discovery stays bounded and explicit-target-first even on the default scout tier."],
	}
}

function buildSummary(pack: RepoDiscoveryPack): string[] {
	return [
		`Discovery pack: mode=${pack.mode} source=${pack.source} docs=${formatTargets(pack.docs)}`,
		`Discovery stages: ${pack.stages.map((stage) => `${stage.stage}=${stage.id}(${formatTargets(stage.targets)})`).join(" | ")}`,
		`Discovery policy: profile=${pack.contextPolicy.profile} docs<=${pack.contextPolicy.maxDocs} configs<=${pack.contextPolicy.maxConfigs} entryPoints<=${pack.contextPolicy.maxEntryPoints} scoutContext<=${pack.contextPolicy.maxScoutContextFiles} nearbyNeighbors=${pack.contextPolicy.includeNearbyNeighbors ? "on" : "off"} gitHints=${pack.contextPolicy.includeGitHints ? "on" : "off"} explicitTargets=${pack.contextPolicy.requireExplicitTargets ? "required" : "optional"}`,
		`Discovery guardrail: start with stable docs, then entry/config hints, then verification lanes; discovery stays bounded and does not widen edit scope.`,
		...(pack.notes.length > 0 || pack.contextPolicy.notes.length > 0
			? [`Discovery notes: ${pack.notes.concat(pack.contextPolicy.notes).join(" | ")}`]
			: []),
	]
}

export function buildRepoDiscoveryPack(input: {
	workspace: string
	fallbackDocs: string[]
	configs: string[]
	entryPoints: string[]
	verificationLanes: string[]
	supportTier?: RepoSupportTier | null
}): RepoDiscoveryPack {
	const contextPolicy = resolveRepoDiscoveryContextPolicy(input.supportTier)
	const selectedDocs = selectKnowledgePackDocs(input.workspace, input.fallbackDocs)
	const docs = uniqueLimited(selectedDocs.docs, contextPolicy.maxDocs)
	const entryPoints = uniqueLimited(input.entryPoints, contextPolicy.maxEntryPoints)
	const configs = uniqueLimited(input.configs, contextPolicy.maxConfigs)
	const verificationLanes = uniqueLimited(input.verificationLanes, contextPolicy.maxVerificationLanes)
	const stageTwoTargets = uniqueLimited(entryPoints.concat(configs), 4)
	const pack: RepoDiscoveryPack = {
		mode: "progressive_bounded",
		source: selectedDocs.source === "knowledge_pack" ? "knowledge_pack" : "repo_map_fallback",
		docs,
		notes: selectedDocs.notes,
		entryPoints,
		configs,
		verificationLanes,
		contextPolicy,
		stages: [
			{
				stage: 1,
				id: "stable_docs",
				label: "Stable docs first",
				purpose: "Start with checked-in repo guides before source previews.",
				targets: docs,
			},
			{
				stage: 2,
				id: "entry_and_config",
				label: "Entry points and config",
				purpose: "Read likely entry files and one or two configs after the stable docs pass.",
				targets: stageTwoTargets,
			},
			{
				stage: 3,
				id: "verification",
				label: "Verification hints",
				purpose: "Keep likely proof lanes visible before edits begin.",
				targets: verificationLanes,
			},
		],
		summary: [],
	}
	pack.summary = buildSummary(pack)
	return pack
}

export function formatRepoDiscoveryPackSummary(pack: RepoDiscoveryPack | null | undefined, maxLines = 3): string {
	if (!pack) return "Discovery pack: (none)"
	return pack.summary.slice(0, Math.max(1, maxLines)).join("\n")
}
