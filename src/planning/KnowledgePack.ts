import fs from "node:fs"
import path from "node:path"

import type { RepoMapArtifact } from "./RepoMap"

export type KnowledgePackManifest = {
	schemaVersion: 1
	docs: string[]
	notes: string[]
}

export type LoadedKnowledgePack = {
	manifest: KnowledgePackManifest | null
	sourcePath: string | null
	issue: string | null
}

export type SelectedKnowledgePackDocs = {
	docs: string[]
	sourcePath: string | null
	notes: string[]
	source: "knowledge_pack" | "fallback"
}

const KNOWLEDGE_PACK_FILE = ".swarmcoder.knowledge-pack.json"

function normalizeRelPath(value: string): string {
	return value.replace(/[\\/]+/g, "/").replace(/^\.\/+/u, "").trim()
}

function uniqueSorted(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => normalizeRelPath(value)).filter(Boolean))).sort((left, right) =>
		left.localeCompare(right),
	)
}

export function resolveKnowledgePackPath(workspace: string): string {
	return path.join(workspace, KNOWLEDGE_PACK_FILE)
}

export function loadKnowledgePack(workspace: string): LoadedKnowledgePack {
	const sourcePath = resolveKnowledgePackPath(workspace)
	if (!fs.existsSync(sourcePath)) {
		return {
			manifest: null,
			sourcePath: null,
			issue: null,
		}
	}

	try {
		const raw = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as Partial<KnowledgePackManifest>
		if (raw.schemaVersion !== 1) {
			return {
				manifest: null,
				sourcePath,
				issue: `Knowledge pack at ${KNOWLEDGE_PACK_FILE} must declare schemaVersion: 1.`,
			}
		}
		return {
			manifest: {
				schemaVersion: 1,
				docs: uniqueSorted(Array.isArray(raw.docs) ? raw.docs.filter((entry): entry is string => typeof entry === "string") : []),
				notes: Array.isArray(raw.notes) ? raw.notes.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [],
			},
			sourcePath,
			issue: null,
		}
	} catch {
		return {
			manifest: null,
			sourcePath,
			issue: `Knowledge pack at ${KNOWLEDGE_PACK_FILE} is not valid JSON.`,
		}
	}
}

export function buildSuggestedKnowledgePackDocs(repoMap: RepoMapArtifact): string[] {
	const preferredDocs = [
		"README.md",
		"QUICKSTART.md",
		"CONTRIBUTING.md",
		"ARCHITECTURE_DECISIONS.md",
		"LANGUAGE_PACKS.md",
		"OWNER_OVERSIGHT_GUIDE.md",
	]
	const repoFiles = new Set([...repoMap.keyFiles, ...repoMap.topLevelEntries.filter((entry) => entry.kind === "file").map((entry) => entry.path)])
	const selected = preferredDocs.filter((doc) => repoFiles.has(doc))
	return uniqueSorted(selected).slice(0, 5)
}

export function writeDefaultKnowledgePack(workspace: string, repoMap: RepoMapArtifact): string {
	const sourcePath = resolveKnowledgePackPath(workspace)
	const docs = buildSuggestedKnowledgePackDocs(repoMap)
	const payload: KnowledgePackManifest = {
		schemaVersion: 1,
		docs,
		notes: [
			"Keep this pack checked in and bounded to the docs contributors actually use during planning and review.",
			"Prefer stable repo guides over generated output or per-run artifacts.",
		],
	}
	fs.writeFileSync(sourcePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
	return sourcePath
}

export function selectKnowledgePackDocs(workspace: string, fallbackDocs: string[]): SelectedKnowledgePackDocs {
	const loaded = loadKnowledgePack(workspace)
	const docsFromManifest =
		loaded.manifest?.docs.filter((doc) => fs.existsSync(path.join(workspace, normalizeRelPath(doc)))) ?? []
	return {
		docs: docsFromManifest.length > 0 ? docsFromManifest : uniqueSorted(fallbackDocs),
		sourcePath: loaded.sourcePath,
		notes: loaded.manifest?.notes ?? [],
		source: docsFromManifest.length > 0 ? "knowledge_pack" : "fallback",
	}
}
