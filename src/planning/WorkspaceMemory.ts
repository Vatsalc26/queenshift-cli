import fs from "node:fs"
import path from "node:path"

import { readOwnerCache, resolveOwnerCachePath } from "../owner/OwnerCache"
import { loadKnowledgePack, resolveKnowledgePackPath } from "./KnowledgePack"
import { getMemoryLayerBoundary, type MemoryLayerBoundary, type MemoryLayerId } from "./MemoryLayers"
import { readPatternMemoryArtifact, resolvePatternMemoryArtifactPath } from "./PatternMemory"
import { readRepoIndexStateArtifact, resolveRepoIndexStatePath } from "./RepoMap"

export type WorkspaceMemoryLayerState = "active" | "missing" | "invalid" | "empty"
export type WorkspaceMemoryLayerScope = "workspace" | "product_root"

export type WorkspaceMemoryLayerSummary = {
	id: MemoryLayerId
	scope: WorkspaceMemoryLayerScope
	state: WorkspaceMemoryLayerState
	boundary: MemoryLayerBoundary
	sourcePath: string | null
	summary: string
}

export type WorkspaceMemoryOverview = {
	schemaVersion: 1
	generatedAt: string
	workspaceName: string
	precedence: string[]
	layers: WorkspaceMemoryLayerSummary[]
	repeatedUseBenefits: string[]
}

function formatDisplayPath(workspace: string, input: string | null): string | null {
	if (!input) return null
	const relative = path.relative(workspace, input)
	if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
		return relative.replace(/[\\/]+/g, "/")
	}
	return input
}

function summarizeKnowledgePack(workspace: string): WorkspaceMemoryLayerSummary {
	const boundary = getMemoryLayerBoundary("knowledge_pack_docs")
	const resolvedPath = resolveKnowledgePackPath(workspace)
	const loaded = loadKnowledgePack(workspace)
	if (loaded.issue) {
		return {
			id: "knowledge_pack_docs",
			scope: "workspace",
			state: "invalid",
			boundary,
			sourcePath: formatDisplayPath(workspace, loaded.sourcePath ?? resolvedPath),
			summary: loaded.issue,
		}
	}
	if (!loaded.manifest) {
		return {
			id: "knowledge_pack_docs",
			scope: "workspace",
			state: "missing",
			boundary,
			sourcePath: formatDisplayPath(workspace, resolvedPath),
			summary: "No checked-in knowledge pack is present yet.",
		}
	}
	if (loaded.manifest.docs.length === 0 && loaded.manifest.notes.length === 0) {
		return {
			id: "knowledge_pack_docs",
			scope: "workspace",
			state: "empty",
			boundary,
			sourcePath: formatDisplayPath(workspace, loaded.sourcePath ?? resolvedPath),
			summary: "Knowledge pack exists but does not prioritize any docs yet.",
		}
	}
	const docsSummary = loaded.manifest.docs.length > 0 ? loaded.manifest.docs.join(", ") : "(none)"
	return {
		id: "knowledge_pack_docs",
		scope: "workspace",
		state: "active",
		boundary,
		sourcePath: formatDisplayPath(workspace, loaded.sourcePath ?? resolvedPath),
		summary: `Docs=${docsSummary}${loaded.manifest.notes.length > 0 ? ` | notes=${loaded.manifest.notes.length}` : ""}`,
	}
}

function summarizeRepoIndexCache(workspace: string): WorkspaceMemoryLayerSummary {
	const boundary = getMemoryLayerBoundary("repo_index_cache")
	const resolvedPath = resolveRepoIndexStatePath(workspace)
	const state = readRepoIndexStateArtifact(workspace)
	if (!state) {
		return {
			id: "repo_index_cache",
			scope: "workspace",
			state: fs.existsSync(resolvedPath) ? "invalid" : "missing",
			boundary,
			sourcePath: formatDisplayPath(workspace, resolvedPath),
			summary: fs.existsSync(resolvedPath)
				? "Repo index cache exists but could not be read."
				: "No cached repo-index snapshot is recorded yet.",
		}
	}
	return {
		id: "repo_index_cache",
		scope: "workspace",
		state: "active",
		boundary,
		sourcePath: formatDisplayPath(workspace, resolvedPath),
		summary: `Fingerprint=${state.fingerprint.slice(0, 12)} | files=${state.files.length} | snapshot=${state.generatedAt}`,
	}
}

function summarizePatternMemory(workspace: string): WorkspaceMemoryLayerSummary {
	const boundary = getMemoryLayerBoundary("pattern_memory_advisory")
	const resolvedPath = resolvePatternMemoryArtifactPath(workspace)
	const artifact = readPatternMemoryArtifact(workspace)
	if (!artifact) {
		return {
			id: "pattern_memory_advisory",
			scope: "workspace",
			state: fs.existsSync(resolvedPath) ? "invalid" : "missing",
			boundary,
			sourcePath: formatDisplayPath(workspace, resolvedPath),
			summary: fs.existsSync(resolvedPath)
				? "Pattern memory exists but could not be read."
				: "No accepted-run advisory memory is recorded yet.",
		}
	}
	return {
		id: "pattern_memory_advisory",
		scope: "workspace",
		state: artifact.acceptedRunCount > 0 ? "active" : "empty",
		boundary,
		sourcePath: formatDisplayPath(workspace, resolvedPath),
		summary: `Accepted=${artifact.acceptedRunCount} | retained=${artifact.compactionPolicy.retainedPatternCount} | suggested=${artifact.suggestedPatterns.length}`,
	}
}

function summarizeOwnerCache(workspace: string, rootDir: string): WorkspaceMemoryLayerSummary {
	const boundary = getMemoryLayerBoundary("owner_cache_defaults")
	const resolvedPath = resolveOwnerCachePath(rootDir)
	const cache = readOwnerCache(rootDir)
	if (!cache) {
		return {
			id: "owner_cache_defaults",
			scope: "product_root",
			state: fs.existsSync(resolvedPath) ? "invalid" : "missing",
			boundary,
			sourcePath: formatDisplayPath(workspace, resolvedPath),
			summary: fs.existsSync(resolvedPath)
				? "Owner cache exists but could not be read."
				: "No remembered owner defaults are stored.",
		}
	}
	const defaultParts = [
		cache.defaults.workspace ? `workspace=${cache.defaults.workspace}` : null,
		cache.defaults.provider ? `provider=${cache.defaults.provider}` : null,
		cache.defaults.composerMode ? `starter=${cache.defaults.composerMode}` : null,
		cache.profile.profileId ? `profile=${cache.profile.profileId}` : null,
	]
		.filter((value): value is string => Boolean(value))
		.join(" | ")
	return {
		id: "owner_cache_defaults",
		scope: "product_root",
		state: defaultParts.length > 0 ? "active" : "empty",
		boundary,
		sourcePath: formatDisplayPath(workspace, resolvedPath),
		summary: defaultParts || "Owner cache is present but currently empty.",
	}
}

export function buildWorkspaceMemoryOverview(
	workspace: string,
	options: {
		rootDir?: string
		generatedAt?: string
	} = {},
): WorkspaceMemoryOverview {
	const layers: WorkspaceMemoryLayerSummary[] = [
		summarizeKnowledgePack(workspace),
		summarizeRepoIndexCache(workspace),
		summarizePatternMemory(workspace),
	]
	if (options.rootDir) {
		layers.push(summarizeOwnerCache(workspace, options.rootDir))
	}

	const repeatedUseBenefits: string[] = []
	if (layers.some((layer) => layer.id === "knowledge_pack_docs" && layer.state === "active")) {
		repeatedUseBenefits.push("Knowledge-pack docs reduce rediscovery of stable repo conventions on later runs.")
	}
	if (layers.some((layer) => layer.id === "repo_index_cache" && layer.state === "active")) {
		repeatedUseBenefits.push("Repo-index cache reuses bounded structure when the workspace fingerprint has not changed.")
	}
	if (layers.some((layer) => layer.id === "pattern_memory_advisory" && layer.state === "active")) {
		repeatedUseBenefits.push("Accepted-run pattern memory suggests prior successful bounded shapes without overriding current truth.")
	}
	if (repeatedUseBenefits.length === 0) {
		repeatedUseBenefits.push("No repeated-use memory layers are active yet; current-run truth remains the only guidance.")
	}

	return {
		schemaVersion: 1,
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		workspaceName: path.basename(workspace),
		precedence: [
			"Current task contract, context pack, and current-run artifacts win over every memory layer.",
			"Knowledge-pack docs are preferred before repo-map fallback docs when stable repo guidance is needed.",
			"Repo-index cache may reuse structure and language hints, but it never widens edit scope or overrides explicit targets.",
			"Pattern memory stays accepted-run-only and advisory; it cannot override current evidence or acceptance truth.",
			"Owner cache stores launch defaults only and does not feed repo planning or task truth.",
		],
		layers,
		repeatedUseBenefits,
	}
}

export function formatWorkspaceMemoryPromptSummary(overview: WorkspaceMemoryOverview): string {
	const layerById = new Map(overview.layers.map((layer) => [layer.id, layer] as const))
	const knowledgePack = layerById.get("knowledge_pack_docs")
	const repoIndex = layerById.get("repo_index_cache")
	const patternMemory = layerById.get("pattern_memory_advisory")
	return [
		"Memory precedence: current task contract/context pack -> knowledge-pack docs -> repo-index structure hints -> accepted-run pattern memory.",
		`Knowledge pack: ${knowledgePack?.summary ?? "No checked-in knowledge pack is present yet."}`,
		`Repo index cache: ${repoIndex?.summary ?? "No cached repo-index snapshot is recorded yet."}`,
		`Pattern memory: ${patternMemory?.summary ?? "No accepted-run advisory memory is recorded yet."}`,
		"Memory guardrail: current-run truth wins; memory stays bounded, inspectable, and may not widen edit scope.",
	].join("\n")
}

export function formatWorkspaceMemoryOverview(overview: WorkspaceMemoryOverview): string {
	return [
		`Workspace memory: ${overview.workspaceName}`,
		"Precedence:",
		...overview.precedence.map((rule, index) => `${index + 1}. ${rule}`),
		"Layers:",
		...overview.layers.map((layer) => {
			const location = layer.sourcePath ? ` | Source=${layer.sourcePath}` : ""
			return `- ${layer.boundary.label}: ${layer.state.toUpperCase()} | ${layer.summary}${location} | Reset=${layer.boundary.resetSurface}`
		}),
		"Repeated-use value:",
		...overview.repeatedUseBenefits.map((benefit) => `- ${benefit}`),
	].join("\n")
}
