import fs from "node:fs"
import path from "node:path"

import type { RepoMapArtifact } from "./RepoMap"
import type { TaskContract } from "../run/TaskContract"
import { normalizeTaskContract } from "../run/TaskContract"
import { selectKnowledgePackDocs } from "./KnowledgePack"

export type ContextPackReason =
	| "task_target"
	| "task_context"
	| "scout_context"
	| "repo_key_file"
	| "knowledge_doc"
	| "entry_point"
	| "nearby_neighbor"
	| "git_hint"

export type ContextPackSelectedFile = {
	path: string
	reason: ContextPackReason
	preview: string
	previewBytes: number
	truncated: boolean
}

export type ContextPackOmittedFile = {
	path: string
	reason: ContextPackReason
	omissionReason: "missing" | "duplicate" | "budget"
}

export type ContextPackScope = {
	kind: "run" | "subtask"
	workItemId: string | null
	assignedBuilder: string | null
	ownedFiles: string[]
}

export type ContextPackRole = "planner" | "builder" | "critic" | "reviewer"

export type ContextPackRoleView = {
	summary: string[]
	focusFiles: string[]
}

export type ContextPackArtifact = {
	schemaVersion: 1
	generatedAt: string
	scope: ContextPackScope
	maxFiles: number
	maxPreviewBytes: number
	previewBytesUsed: number
	taskAnchors: string[]
	scoutNotes: string[]
	discoverySummary: string[]
	selectedFiles: ContextPackSelectedFile[]
	omittedFiles: ContextPackOmittedFile[]
	roleViews: Record<ContextPackRole, ContextPackRoleView>
	plannerSummary: string[]
	workerSummary: string[]
}

type Candidate = {
	path: string
	reason: ContextPackReason
	priority: number
}

function normalizeRelPath(input: string): string {
	return input.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => normalizeRelPath(value)).filter(Boolean)))
}

function listWorkspaceFiles(workspace: string, dir = workspace, results: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === ".git" || entry.name === ".swarm" || entry.name === "node_modules" || entry.name === "dist") continue
		const fullPath = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			listWorkspaceFiles(workspace, fullPath, results)
			continue
		}
		results.push(normalizeRelPath(path.relative(workspace, fullPath)))
	}
	return uniqueStrings(results)
}

function addCandidate(candidates: Candidate[], pathValue: string, reason: ContextPackReason, priority: number): void {
	const normalized = normalizeRelPath(pathValue)
	if (!normalized) return
	candidates.push({ path: normalized, reason, priority })
}

function sameDirNeighbors(targetFiles: string[], allFiles: string[]): string[] {
	const neighbors = new Set<string>()
	const targetSet = new Set(targetFiles)
	for (const targetFile of targetFiles) {
		const dirName = path.posix.dirname(targetFile)
		if (!dirName || dirName === ".") continue
		for (const file of allFiles) {
			if (targetSet.has(file)) continue
			if (!file.startsWith(`${dirName}/`)) continue
			neighbors.add(file)
			if (neighbors.size >= 2) return Array.from(neighbors)
		}
	}
	return Array.from(neighbors)
}

function pickKnowledgeDocs(workspace: string, allFiles: string[], repoMap?: RepoMapArtifact | null, limit = 3): string[] {
	const prioritizedDocs = [
		"README.md",
		"CONTRIBUTING.md",
		"ARCHITECTURE_DECISIONS.md",
		"LANGUAGE_PACKS.md",
		"OWNER_OVERSIGHT_GUIDE.md",
	]
	const knowledgePack = selectKnowledgePackDocs(workspace, prioritizedDocs)
	const fileSet = new Set(allFiles)
	const selected = new Set<string>()
	for (const candidate of repoMap?.discoveryPack?.docs ?? []) {
		if (fileSet.has(candidate)) selected.add(candidate)
		if (selected.size >= limit) return Array.from(selected)
	}
	for (const candidate of knowledgePack.docs) {
		if (fileSet.has(candidate)) selected.add(candidate)
		if (selected.size >= limit) return Array.from(selected)
	}
	for (const candidate of prioritizedDocs) {
		if (fileSet.has(candidate)) selected.add(candidate)
		if (selected.size >= limit) return Array.from(selected)
	}
	for (const file of allFiles) {
		if (selected.size >= limit) break
		if (!/^(docs\/.+|.+\.md)$/u.test(file)) continue
		selected.add(file)
	}
	return Array.from(selected)
}

function buildPreview(content: string, maxPreviewCharsPerFile: number): { preview: string; previewBytes: number; truncated: boolean } {
	const preview = content.length > maxPreviewCharsPerFile ? `${content.slice(0, maxPreviewCharsPerFile)}\n...(truncated)...\n` : content
	return {
		preview,
		previewBytes: Buffer.byteLength(preview, "utf8"),
		truncated: preview.length !== content.length,
	}
}

function clipSnippet(snippet: string, maxChars = 72): string {
	return snippet.length <= maxChars ? snippet : `${snippet.slice(0, maxChars - 3)}...`
}

function buildBuilderContractSummaries(taskContract: TaskContract | null | undefined): {
	scopeSummary: string
	literalSummary: string
} {
	const contract = normalizeTaskContract(taskContract)
	const scopeBits: string[] = []
	const literalBits: string[] = []

	if (contract?.scope?.allowedFiles.length) {
		scopeBits.push(`allowed=${contract.scope.allowedFiles.join(", ")}`)
	}
	if (contract?.scope?.requiredTargetFiles.length) {
		scopeBits.push(`required=${contract.scope.requiredTargetFiles.join(", ")}`)
	}
	if (contract?.acceptance?.expectedChangedFiles?.length) {
		scopeBits.push(`expected=${contract.acceptance.expectedChangedFiles.join(", ")}`)
	}
	if (contract?.acceptance?.requiredCreatedFiles?.length) {
		scopeBits.push(`create=${contract.acceptance.requiredCreatedFiles.join(", ")}`)
	}
	if (contract?.acceptance?.requiredContentSnippets?.length) {
		literalBits.push(
			`required=${contract.acceptance.requiredContentSnippets
				.slice(0, 2)
				.map((expectation) => `${expectation.path} => "${clipSnippet(expectation.snippet)}"`)
				.join(" | ")}${contract.acceptance.requiredContentSnippets.length > 2 ? " | ..." : ""}`,
		)
	}
	if (contract?.acceptance?.forbiddenContentSnippets?.length) {
		literalBits.push(
			`forbidden=${contract.acceptance.forbiddenContentSnippets
				.slice(0, 2)
				.map((expectation) => `${expectation.path} => "${clipSnippet(expectation.snippet)}"`)
				.join(" | ")}${contract.acceptance.forbiddenContentSnippets.length > 2 ? " | ..." : ""}`,
		)
	}

	return {
		scopeSummary: `Builder contract: ${scopeBits.join(" | ") || "(none)"}`,
		literalSummary: `Builder literals: ${literalBits.join(" | ") || "(none)"}`,
	}
}

function pickRoleFocusFiles(
	role: ContextPackRole,
	selectedFiles: ContextPackSelectedFile[],
	taskAnchors: string[],
	scope: ContextPackScope,
): string[] {
	const selectedPaths = selectedFiles.map((file) => file.path)
	const selectedSet = new Set(selectedPaths)
	const byReason = (reasons: ContextPackReason[]) =>
		selectedFiles.filter((file) => reasons.includes(file.reason)).map((file) => file.path)

	const fallback = selectedPaths.slice(0, 4)
	if (role === "planner") {
		return uniqueStrings(byReason(["task_target", "task_context", "scout_context", "knowledge_doc"])).slice(0, 4)
	}
	if (role === "builder") {
		return uniqueStrings(scope.ownedFiles.concat(taskAnchors).concat(byReason(["task_context", "scout_context"])))
			.filter((file) => selectedSet.has(file))
			.slice(0, 4)
	}
	if (role === "critic") {
		return uniqueStrings(byReason(["task_target", "scout_context", "knowledge_doc"])).slice(0, 4)
	}
	if (role === "reviewer") {
		return uniqueStrings(byReason(["task_target", "task_context", "scout_context"])).slice(0, 4)
	}
	return fallback
}

function buildRoleView(input: {
	role: ContextPackRole
	scope: ContextPackScope
	taskAnchors: string[]
	scoutNotes: string[]
	selectedFiles: ContextPackSelectedFile[]
	omittedFiles: ContextPackOmittedFile[]
	previewBytesUsed: number
	maxPreviewBytes: number
	builderContractScopeSummary: string
	builderContractLiteralSummary: string
	discoverySummary: string[]
}): ContextPackRoleView {
	const focusFiles = (() => {
		const preferred = pickRoleFocusFiles(input.role, input.selectedFiles, input.taskAnchors, input.scope)
		return preferred.length > 0 ? preferred : input.selectedFiles.map((file) => file.path).slice(0, 4)
	})()
	const knowledgeDocs = input.selectedFiles.filter((file) => file.reason === "knowledge_doc").map((file) => file.path)
	const scoutContext = input.selectedFiles.filter((file) => file.reason === "scout_context").map((file) => file.path)
	const omissionSummary = input.omittedFiles.map((file) => `${file.path}:${file.omissionReason}`).join(", ") || "(none)"

	if (input.role === "planner") {
		return {
			summary: [
				`Planner focus: anchors=${input.taskAnchors.join(", ") || "(none)"}`,
				`Planner context files: ${focusFiles.join(", ") || "(none)"}`,
				`Planner discovery pack: ${input.discoverySummary[0]?.replace(/^Discovery pack:\s*/, "") ?? "(none)"}`,
				`Planner scout notes: ${input.scoutNotes.join(" | ") || "(none)"}`,
				`Planner omissions: ${omissionSummary}`,
			],
			focusFiles,
		}
	}
	if (input.role === "builder") {
		return {
			summary: [
				`Builder focus: owned=${input.scope.ownedFiles.join(", ") || "(none)"}`,
				`Builder context files: ${focusFiles.join(", ") || "(none)"}`,
				`Builder discovery pack: ${input.discoverySummary[0]?.replace(/^Discovery pack:\s*/, "") ?? "(none)"}`,
				`Builder scout context: ${scoutContext.join(", ") || "(none)"}`,
				input.builderContractScopeSummary,
				input.builderContractLiteralSummary,
				`Builder preview budget: ${input.previewBytesUsed}/${input.maxPreviewBytes}`,
			],
			focusFiles,
		}
	}
	if (input.role === "critic") {
		return {
			summary: [
				`Critic focus: bounded files=${focusFiles.join(", ") || "(none)"}`,
				`Critic scout notes: ${input.scoutNotes.join(" | ") || "(none)"}`,
				`Critic omissions: ${omissionSummary}`,
				`Critic knowledge docs: ${knowledgeDocs.join(", ") || "(none)"}`,
			],
			focusFiles,
		}
	}
	return {
		summary: [
			`Reviewer focus: validate changed anchors against ${focusFiles.join(", ") || "(none)"}`,
			`Reviewer scout context: ${scoutContext.join(", ") || "(none)"}`,
			`Reviewer knowledge docs: ${knowledgeDocs.join(", ") || "(none)"}`,
			`Reviewer omissions: ${omissionSummary}`,
		],
		focusFiles,
	}
}

function buildSubtaskScopedTaskContract(taskContract: TaskContract | null | undefined, ownedFiles: string[]): TaskContract | null | undefined {
	if (!taskContract?.scope) return taskContract
	const normalizedOwnedFiles = uniqueStrings(ownedFiles)
	if (normalizedOwnedFiles.length === 0) return taskContract
	const ownedSet = new Set(normalizedOwnedFiles)
	return {
		...taskContract,
		scope: {
			...taskContract.scope,
			allowedFiles: normalizedOwnedFiles,
			requiredTargetFiles: normalizedOwnedFiles,
			maxEditedFileCount: Math.max(1, Math.min(taskContract.scope.maxEditedFileCount, normalizedOwnedFiles.length)),
			readOnlyContextFiles: uniqueStrings((taskContract.scope.readOnlyContextFiles ?? []).filter((file) => !ownedSet.has(normalizeRelPath(file)))),
		},
	}
}

export function buildContextPackArtifact(
	workspace: string,
	input: {
		taskFiles: string[]
		repoMap?: RepoMapArtifact | null
		taskContract?: TaskContract | null
		scope?: Partial<ContextPackScope>
		scoutNotes?: string[]
		scoutContextFiles?: string[]
		generatedAt?: string
		maxFiles?: number
		maxPreviewBytes?: number
		maxPreviewCharsPerFile?: number
	},
): ContextPackArtifact {
	const allFiles = listWorkspaceFiles(workspace)
	const allFileSet = new Set(allFiles)
	const maxFiles = Math.max(1, input.maxFiles ?? 6)
	const maxPreviewBytes = Math.max(512, input.maxPreviewBytes ?? 24_000)
	const maxPreviewCharsPerFile = Math.max(120, input.maxPreviewCharsPerFile ?? 1_200)
	const scope: ContextPackScope = {
		kind: input.scope?.kind === "subtask" ? "subtask" : "run",
		workItemId: typeof input.scope?.workItemId === "string" && input.scope.workItemId.trim() ? input.scope.workItemId.trim() : null,
		assignedBuilder:
			typeof input.scope?.assignedBuilder === "string" && input.scope.assignedBuilder.trim()
				? input.scope.assignedBuilder.trim()
				: null,
		ownedFiles: uniqueStrings(input.scope?.ownedFiles ?? input.taskFiles ?? []),
	}
	const taskAnchors = uniqueStrings(
		scope.ownedFiles
			.concat(input.taskFiles ?? [])
			.concat(input.taskContract?.scope?.requiredTargetFiles ?? [])
			.concat(input.taskContract?.scope?.allowedFiles ?? []),
	)

	const candidates: Candidate[] = []
	const scoutNotes = uniqueStrings(input.scoutNotes ?? [])
	const discoverySummary = input.repoMap?.discoveryPack?.summary.slice(0, 3) ?? []
	const discoveryPolicy = input.repoMap?.discoveryPack?.contextPolicy
	for (const taskFile of taskAnchors) addCandidate(candidates, taskFile, "task_target", 0)
	for (const contextFile of input.taskContract?.scope?.readOnlyContextFiles ?? []) addCandidate(candidates, contextFile, "task_context", 1)
	for (const scoutContextFile of input.scoutContextFiles ?? []) addCandidate(candidates, scoutContextFile, "scout_context", 2)

	for (const keyFile of input.repoMap?.keyFiles ?? []) {
		if (["package.json", "tsconfig.json", ".swarmcoder.json", "README.md"].includes(path.posix.basename(keyFile))) {
			addCandidate(candidates, keyFile, "repo_key_file", 3)
		}
	}
	for (const knowledgeDoc of pickKnowledgeDocs(workspace, allFiles, input.repoMap)) addCandidate(candidates, knowledgeDoc, "knowledge_doc", 4)

	for (const entryPoint of input.repoMap?.likelyEntryPoints ?? []) addCandidate(candidates, entryPoint, "entry_point", 5)
	if (scope.kind === "run") {
		if (discoveryPolicy?.includeNearbyNeighbors !== false) {
			for (const neighbor of sameDirNeighbors(taskAnchors, allFiles)) addCandidate(candidates, neighbor, "nearby_neighbor", 6)
		}
		if (discoveryPolicy?.includeGitHints !== false) {
			for (const hintFile of [...(input.repoMap?.gitHints.changedFiles ?? []), ...(input.repoMap?.gitHints.recentFiles ?? [])]) {
				addCandidate(candidates, hintFile, "git_hint", 7)
			}
		}
	}

	const selectedFiles: ContextPackSelectedFile[] = []
	const omittedFiles: ContextPackOmittedFile[] = []
	const seenPaths = new Set<string>()
	let previewBytesUsed = 0

	for (const candidate of candidates.sort((left, right) => left.priority - right.priority || left.path.localeCompare(right.path))) {
		if (seenPaths.has(candidate.path)) {
			omittedFiles.push({ path: candidate.path, reason: candidate.reason, omissionReason: "duplicate" })
			continue
		}
		seenPaths.add(candidate.path)
		if (!allFileSet.has(candidate.path)) {
			omittedFiles.push({ path: candidate.path, reason: candidate.reason, omissionReason: "missing" })
			continue
		}
		if (selectedFiles.length >= maxFiles) {
			omittedFiles.push({ path: candidate.path, reason: candidate.reason, omissionReason: "budget" })
			continue
		}

		const filePath = path.join(workspace, candidate.path)
		const content = fs.readFileSync(filePath, "utf8")
		const preview = buildPreview(content, maxPreviewCharsPerFile)
		if (selectedFiles.length > 0 && previewBytesUsed + preview.previewBytes > maxPreviewBytes) {
			omittedFiles.push({ path: candidate.path, reason: candidate.reason, omissionReason: "budget" })
			continue
		}

		selectedFiles.push({
			path: candidate.path,
			reason: candidate.reason,
			preview: preview.preview,
			previewBytes: preview.previewBytes,
			truncated: preview.truncated,
		})
		previewBytesUsed += preview.previewBytes
	}

	const builderContractSummaries = buildBuilderContractSummaries(input.taskContract)
	const roleViews: Record<ContextPackRole, ContextPackRoleView> = {
		planner: buildRoleView({
			role: "planner",
			scope,
			taskAnchors,
			scoutNotes,
			selectedFiles,
			omittedFiles,
			previewBytesUsed,
			maxPreviewBytes,
			builderContractScopeSummary: builderContractSummaries.scopeSummary,
			builderContractLiteralSummary: builderContractSummaries.literalSummary,
			discoverySummary,
		}),
		builder: buildRoleView({
			role: "builder",
			scope,
			taskAnchors,
			scoutNotes,
			selectedFiles,
			omittedFiles,
			previewBytesUsed,
			maxPreviewBytes,
			builderContractScopeSummary: builderContractSummaries.scopeSummary,
			builderContractLiteralSummary: builderContractSummaries.literalSummary,
			discoverySummary,
		}),
		critic: buildRoleView({
			role: "critic",
			scope,
			taskAnchors,
			scoutNotes,
			selectedFiles,
			omittedFiles,
			previewBytesUsed,
			maxPreviewBytes,
			builderContractScopeSummary: builderContractSummaries.scopeSummary,
			builderContractLiteralSummary: builderContractSummaries.literalSummary,
			discoverySummary,
		}),
		reviewer: buildRoleView({
			role: "reviewer",
			scope,
			taskAnchors,
			scoutNotes,
			selectedFiles,
			omittedFiles,
			previewBytesUsed,
			maxPreviewBytes,
			builderContractScopeSummary: builderContractSummaries.scopeSummary,
			builderContractLiteralSummary: builderContractSummaries.literalSummary,
			discoverySummary,
		}),
	}

	const plannerSummary = [
		...roleViews.planner.summary,
		...discoverySummary,
		`Context pack: ${selectedFiles.length} file(s), ${previewBytesUsed}/${maxPreviewBytes} preview bytes.`,
		`Scope: ${scope.kind}${scope.workItemId ? ` (${scope.workItemId})` : ""}.`,
		`Anchors: ${taskAnchors.join(", ") || "(none)"}.`,
		...(scoutNotes.length > 0 ? [`Scout notes: ${scoutNotes.join(" | ")}`] : []),
		...(selectedFiles.some((file) => file.reason === "knowledge_doc")
			? [`Knowledge docs: ${selectedFiles.filter((file) => file.reason === "knowledge_doc").map((file) => file.path).join(", ")}`]
			: []),
		...selectedFiles.slice(0, 4).map((file) => `Include ${file.path} (${file.reason}${file.truncated ? ", truncated" : ""}).`),
		...(omittedFiles.length > 0 ? [`Omitted: ${omittedFiles.map((file) => `${file.path}:${file.omissionReason}`).join(", ")}`] : []),
	]

	const workerSummary = [
		...roleViews.builder.summary,
		...discoverySummary.slice(0, 1),
		`Context scope: ${scope.kind}${scope.assignedBuilder ? ` -> ${scope.assignedBuilder}` : ""}`,
		`Context pack files: ${selectedFiles.map((file) => file.path).join(", ") || "(none)"}`,
		`Scout context: ${selectedFiles.filter((file) => file.reason === "scout_context").map((file) => file.path).join(", ") || "(none)"}`,
		`Preview budget used: ${previewBytesUsed}/${maxPreviewBytes} bytes`,
	]

	return {
		schemaVersion: 1,
		generatedAt: input.generatedAt ?? new Date().toISOString(),
		scope,
		maxFiles,
		maxPreviewBytes,
		previewBytesUsed,
		taskAnchors,
		scoutNotes,
		discoverySummary,
		selectedFiles,
		omittedFiles,
		roleViews,
		plannerSummary,
		workerSummary,
	}
}

export function buildSubtaskContextPackArtifacts(
	workspace: string,
	input: {
		subtasks: Array<{ id: string; files: string[]; assignedBuilder: string }>
		repoMap?: RepoMapArtifact | null
		taskContract?: TaskContract | null
		scoutNotes?: string[]
		scoutContextFiles?: string[]
		generatedAt?: string
		maxFiles?: number
		maxPreviewBytes?: number
		maxPreviewCharsPerFile?: number
	},
): Record<string, ContextPackArtifact> {
	const packs: Record<string, ContextPackArtifact> = {}
	for (const subtask of input.subtasks) {
		const scopedTaskContract = buildSubtaskScopedTaskContract(input.taskContract, subtask.files)
		packs[subtask.id] = buildContextPackArtifact(workspace, {
			taskFiles: subtask.files,
			repoMap: input.repoMap,
			taskContract: scopedTaskContract,
			scoutNotes: input.scoutNotes,
			scoutContextFiles: input.scoutContextFiles,
			scope: {
				kind: "subtask",
				workItemId: subtask.id,
				assignedBuilder: subtask.assignedBuilder,
				ownedFiles: subtask.files,
			},
			generatedAt: input.generatedAt,
			maxFiles: input.maxFiles,
			maxPreviewBytes: input.maxPreviewBytes,
			maxPreviewCharsPerFile: input.maxPreviewCharsPerFile,
		})
	}
	return packs
}

export function listContextPackFiles(pack: ContextPackArtifact | null): string[] {
	return pack?.selectedFiles.map((file) => file.path) ?? []
}

export function listContextPackPreviewSelections(
	pack: ContextPackArtifact | null,
	role: ContextPackRole,
	maxFiles = 4,
): ContextPackSelectedFile[] {
	if (!pack) return []
	const focusFiles = pack.roleViews?.[role]?.focusFiles ?? []
	const focusSet = new Set(focusFiles)
	const preferred = pack.selectedFiles.filter((file) => focusSet.has(file.path))
	return (preferred.length > 0 ? preferred : pack.selectedFiles).slice(0, Math.max(1, maxFiles))
}

export function formatContextPackPromptPreview(pack: ContextPackArtifact, role: ContextPackRole, maxFiles = 4): string {
	return listContextPackPreviewSelections(pack, role, maxFiles)
		.map((file) => `--- ${file.path} (${file.reason}${file.truncated ? ", truncated" : ""}) ---\n${file.preview}`)
		.join("\n\n")
}

export function formatContextPackPromptSummary(pack: ContextPackArtifact, role: ContextPackRole = "planner", maxLines = 6): string {
	const roleSummary = pack.roleViews?.[role]?.summary
	const fallback = role === "builder" ? pack.workerSummary : pack.plannerSummary
	return (roleSummary && roleSummary.length > 0 ? roleSummary : fallback).slice(0, Math.max(1, maxLines)).join("\n")
}

export function formatContextPackArtifact(pack: ContextPackArtifact): string {
	return [
		`Scope: ${pack.scope.kind}${pack.scope.workItemId ? ` (${pack.scope.workItemId})` : ""}`,
		`Anchors: ${pack.taskAnchors.join(", ") || "(none)"}`,
		...(pack.scoutNotes.length > 0 ? [`Scout notes: ${pack.scoutNotes.join(" | ")}`] : []),
		...pack.discoverySummary,
		`Role views: planner=${pack.roleViews?.planner?.focusFiles.join(", ") || "(none)"} | builder=${pack.roleViews?.builder?.focusFiles.join(", ") || "(none)"} | critic=${pack.roleViews?.critic?.focusFiles.join(", ") || "(none)"} | reviewer=${pack.roleViews?.reviewer?.focusFiles.join(", ") || "(none)"}`,
		`Selected files: ${pack.selectedFiles.length}`,
		`Preview budget: ${pack.previewBytesUsed}/${pack.maxPreviewBytes}`,
		...pack.selectedFiles.map((file) => `- ${file.path} (${file.reason}${file.truncated ? ", truncated" : ""})`),
		...(pack.omittedFiles.length > 0 ? ["Omitted:", ...pack.omittedFiles.map((file) => `- ${file.path} (${file.reason}:${file.omissionReason})`)] : []),
	].join("\n")
}
