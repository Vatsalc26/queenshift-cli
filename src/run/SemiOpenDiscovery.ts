import fs from "node:fs"
import path from "node:path"

import {
	buildBoundedTaskContract,
	extractTaskFileRefs,
	matchesSafeTaskTemplate,
	normalizeRelPath,
	type ContentSnippetExpectation,
	type SemiOpenTaskClass,
	type TaskContract,
} from "./TaskContract"

const IGNORED_DIRS = new Set([".git", ".next", ".swarm", "build", "coverage", "dist", "node_modules", "out"])
const CONFIG_EXTENSIONS = new Set([".ini", ".json", ".toml", ".yaml", ".yml"])
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt"])
const TESTABLE_CODE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".py", ".ts", ".tsx"])
const IMPORTABLE_CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]
const TEST_FILE_PATTERN = /(^|\/)__tests__(\/|$)|(?:\.|_)test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/u
const UI_PATH_CUE_PATTERN = /(^|\/)(components?|screens?|ui|views?)(\/|$)/u
const UI_BASENAME_CUE_PATTERN =
	/(card|component|controller|dialog|drawer|form|hook|layout|logic|menu|modal|nav|panel|screen|sidebar|state|toolbar|view|widget)/u

type WorkspaceIndex = {
	files: string[]
	filesByLowerPath: Map<string, string>
	filesByLowerBasename: Map<string, string[]>
	docFiles: string[]
	configFiles: string[]
	importableFiles: string[]
}

export type SemiOpenDiscoveryResult = {
	taskClass: SemiOpenTaskClass
	targetFiles: string[]
	taskContract: TaskContract
	summary: string
	details: string[]
}

export type SemiOpenDiscoveryFailureCode =
	| "missing_anchor_file"
	| "ambiguous_anchor_file"
	| "ambiguous_test_candidate"
	| "missing_test_candidate"
	| "ambiguous_doc_candidate"
	| "missing_doc_candidate"
	| "ambiguous_config_candidate"
	| "missing_config_candidate"
	| "missing_direct_callsite"
	| "too_many_discovered_files"

export type SemiOpenDiscoveryFailure = {
	taskClass: SemiOpenTaskClass
	code: SemiOpenDiscoveryFailureCode
	summary: string
	details: string[]
}

export function listWorkspaceFilesForDiscovery(workspace: string, maxDepth = 6): string[] {
	const results: string[] = []

	const walk = (dir: string, depth: number) => {
		if (depth > maxDepth) return
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (IGNORED_DIRS.has(entry.name)) continue
			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				walk(fullPath, depth + 1)
				continue
			}
			results.push(normalizeRelPath(path.relative(workspace, fullPath)))
		}
	}

	walk(workspace, 0)
	return Array.from(new Set(results.filter(Boolean))).sort((left, right) => left.localeCompare(right))
}

function createWorkspaceIndex(fileList: string[]): WorkspaceIndex {
	const files = Array.from(new Set(fileList.map((file) => normalizeRelPath(file)).filter(Boolean))).sort((left, right) =>
		left.localeCompare(right),
	)
	const filesByLowerPath = new Map<string, string>()
	const filesByLowerBasename = new Map<string, string[]>()
	const docFiles: string[] = []
	const configFiles: string[] = []
	const importableFiles: string[] = []

	for (const file of files) {
		const lowerFile = file.toLowerCase()
		if (!filesByLowerPath.has(lowerFile)) filesByLowerPath.set(lowerFile, file)

		const basename = path.posix.basename(file).toLowerCase()
		const existingBasenameEntries = filesByLowerBasename.get(basename) ?? []
		existingBasenameEntries.push(file)
		filesByLowerBasename.set(basename, existingBasenameEntries)

		const extension = path.posix.extname(file).toLowerCase()
		if (DOC_EXTENSIONS.has(extension)) docFiles.push(file)
		if (isConfigCandidateFile(file)) configFiles.push(file)
		if (IMPORTABLE_CODE_EXTENSIONS.includes(extension)) importableFiles.push(file)
	}

	return {
		files,
		filesByLowerPath,
		filesByLowerBasename,
		docFiles,
		configFiles,
		importableFiles,
	}
}

function isConfigCandidateFile(file: string): boolean {
	const normalized = normalizeRelPath(file).toLowerCase()
	const basename = path.posix.basename(normalized)
	if (normalized.startsWith("config/")) return true
	if (basename === ".env" || basename === ".env.example") return true
	if (basename.includes("defaults") || basename.includes("settings")) return true
	return CONFIG_EXTENSIONS.has(path.posix.extname(normalized))
}

function basenameWithoutExtension(file: string): string {
	return path.posix.basename(file, path.posix.extname(file)).toLowerCase()
}

function extractExactQuotedLiteral(task: string, label: "comment" | "sentence" | "property"): string | null {
	if (label === "property") {
		const propertyMatch = /exact\s+property\s+(.+?)(?=\.\s|\.?$|\s+(?:Keep|keep)\b)/iu.exec(task)
		const propertyLiteral = typeof propertyMatch?.[1] === "string" ? propertyMatch[1].trim() : ""
		if (propertyLiteral) return propertyLiteral
	}
	const patterns = [
		new RegExp(`exact\\s+${label}\\s+"([^"\\r\\n]+)"`, "iu"),
		new RegExp(`exact\\s+${label}\\s+'([^'\\r\\n]+)'`, "iu"),
	]
	for (const pattern of patterns) {
		const match = pattern.exec(task)
		const literal = typeof match?.[1] === "string" ? match[1].trim() : ""
		if (literal) return literal
	}
	return null
}

function buildRepeatedSnippetExpectations(files: string[], snippet: string | null): ContentSnippetExpectation[] {
	if (!snippet) return []
	return uniqueSorted(files).map((file) => ({
		path: file,
		snippet,
	}))
}

function buildSingleSnippetExpectation(file: string, snippet: string | null): ContentSnippetExpectation[] {
	if (!file || !snippet) return []
	return [{ path: file, snippet }]
}

function uniqueSorted(files: string[]): string[] {
	return Array.from(new Set(files.map((file) => normalizeRelPath(file)).filter(Boolean))).sort((left, right) =>
		left.localeCompare(right),
	)
}

function resolveWorkspaceFileRef(
	fileRef: string,
	index: WorkspaceIndex,
): { resolved: string | null; ambiguousCandidates: string[] } {
	const normalizedRef = normalizeRelPath(fileRef)
	const exact = index.filesByLowerPath.get(normalizedRef.toLowerCase())
	if (exact) {
		return { resolved: exact, ambiguousCandidates: [] }
	}

	const basename = path.posix.basename(normalizedRef).toLowerCase()
	const basenameMatches = index.filesByLowerBasename.get(basename) ?? []
	if (basenameMatches.length === 1) {
		return { resolved: basenameMatches[0] ?? null, ambiguousCandidates: [] }
	}

	return { resolved: null, ambiguousCandidates: basenameMatches }
}

function looksLikeHelperTestTask(taskLower: string): boolean {
	return (
		/\btest(s)?\b/u.test(taskLower) &&
		(/\bits test\b/u.test(taskLower) ||
			/\bthe test\b/u.test(taskLower) ||
			/\bmatching test\b/u.test(taskLower) ||
			/\bcorresponding test\b/u.test(taskLower) ||
			/\btest aligned\b/u.test(taskLower) ||
			/\btests aligned\b/u.test(taskLower) ||
			/\bkeep\b/u.test(taskLower) ||
			/\bsync\b/u.test(taskLower) ||
			/\bupdate\b/u.test(taskLower))
	)
}

function looksLikeRetryCallerTask(taskLower: string): boolean {
	return (
		(/\bretry\b/u.test(taskLower) || /\bbackoff\b/u.test(taskLower) || /\btimeout\b/u.test(taskLower)) &&
		(/\bdirect caller\b/u.test(taskLower) ||
			/\bcaller(s)?\b/u.test(taskLower) ||
			/\bcall site\b/u.test(taskLower) ||
			/\bcall sites\b/u.test(taskLower)) &&
		(/\bkeep\b/u.test(taskLower) || /\balign\b/u.test(taskLower) || /\bupdate\b/u.test(taskLower) || /\btogether\b/u.test(taskLower))
	)
}

function looksLikeUiLogicTask(taskLower: string): boolean {
	return (
		(/\bui\b/u.test(taskLower) ||
			/\bcomponent\b/u.test(taskLower) ||
			/\blogic\b/u.test(taskLower) ||
			/\bview\b/u.test(taskLower) ||
			/\brender\b/u.test(taskLower) ||
			/\bpanel\b/u.test(taskLower)) &&
		(/\bkeep\b/u.test(taskLower) ||
			/\balign\b/u.test(taskLower) ||
			/\bupdate\b/u.test(taskLower) ||
			/\btighten\b/u.test(taskLower) ||
			/\btogether\b/u.test(taskLower))
	)
}

function looksLikeDocsSyncTask(taskLower: string): boolean {
	return (
		(/\breadme\b/u.test(taskLower) ||
			/\bdocs\b/u.test(taskLower) ||
			/\bdocumentation\b/u.test(taskLower) ||
			/\bfaq\b/u.test(taskLower) ||
			/\bguide\b/u.test(taskLower)) &&
		(/\bsync\b/u.test(taskLower) || /\balign\b/u.test(taskLower) || /\bupdate\b/u.test(taskLower) || /\bdocument\b/u.test(taskLower))
	)
}

function looksLikeRenameExportTask(taskLower: string): boolean {
	return (
		/\brename\b/u.test(taskLower) &&
		(/\bexport\b/u.test(taskLower) ||
			/\bcall site\b/u.test(taskLower) ||
			/\bcall sites\b/u.test(taskLower) ||
			/\bcallsite\b/u.test(taskLower) ||
			/\bcallsites\b/u.test(taskLower) ||
			/\bimport\b/u.test(taskLower) ||
			/\bimports\b/u.test(taskLower) ||
			/\bimport site\b/u.test(taskLower) ||
			/\bimport sites\b/u.test(taskLower) ||
			/\bimporter(s)?\b/u.test(taskLower) ||
			/\breference(s)?\b/u.test(taskLower))
	)
}

function looksLikeConfigSyncTask(taskLower: string): boolean {
	return (
		(/\bconfig\b/u.test(taskLower) ||
			/\bdefaults\b/u.test(taskLower) ||
			/\bsettings\b/u.test(taskLower) ||
			/\bjson\b/u.test(taskLower) ||
			/\byaml\b/u.test(taskLower) ||
			/\byml\b/u.test(taskLower) ||
			/\btoml\b/u.test(taskLower) ||
			/\.env\b/u.test(taskLower)) &&
		(/\bsync\b/u.test(taskLower) || /\balign\b/u.test(taskLower) || /\bupdate\b/u.test(taskLower))
	)
}

function detectSemiOpenTaskClass(taskLower: string): SemiOpenTaskClass | null {
	if (looksLikeRenameExportTask(taskLower)) return "rename_export"
	if (looksLikeDocsSyncTask(taskLower)) return "docs_sync"
	if (looksLikeRetryCallerTask(taskLower)) return "retry_caller"
	if (looksLikeUiLogicTask(taskLower)) return "ui_logic"
	if (looksLikeHelperTestTask(taskLower)) return "helper_test"
	if (looksLikeConfigSyncTask(taskLower)) return "config_sync"
	return null
}

function buildFailure(
	taskClass: SemiOpenTaskClass,
	code: SemiOpenDiscoveryFailureCode,
	summary: string,
	details: string[],
): { match: null; refusal: SemiOpenDiscoveryFailure } {
	return {
		match: null,
		refusal: {
			taskClass,
			code,
			summary,
			details,
		},
	}
}

function buildMatch(
	taskClass: SemiOpenTaskClass,
	targetFiles: string[],
	taskContract: TaskContract,
	summary: string,
	details: string[],
): { match: SemiOpenDiscoveryResult; refusal: null } {
	return {
		match: {
			taskClass,
			targetFiles,
			taskContract,
			summary,
			details,
		},
		refusal: null,
	}
}

function findNearbyTestCandidates(anchorFile: string, index: WorkspaceIndex): string[] {
	const anchorDir = path.posix.dirname(anchorFile)
	const anchorExt = path.posix.extname(anchorFile).toLowerCase()
	if (!TESTABLE_CODE_EXTENSIONS.has(anchorExt)) return []

	const anchorStem = basenameWithoutExtension(anchorFile)
	const anchorParentDir = anchorDir === "." ? "" : path.posix.dirname(anchorDir)
	const candidates = uniqueSorted([
		path.posix.join(anchorDir, `${anchorStem}.test${anchorExt}`),
		path.posix.join(anchorDir, `${anchorStem}.spec${anchorExt}`),
		path.posix.join(anchorDir, `test_${anchorStem}${anchorExt}`),
		path.posix.join(anchorDir, `${anchorStem}_test${anchorExt}`),
		path.posix.join(anchorDir, "__tests__", `${anchorStem}.test${anchorExt}`),
		path.posix.join(anchorDir, "__tests__", `${anchorStem}.spec${anchorExt}`),
		path.posix.join(anchorDir, "tests", `${anchorStem}.test${anchorExt}`),
		path.posix.join(anchorDir, "tests", `${anchorStem}.spec${anchorExt}`),
		path.posix.join(anchorParentDir, "tests", `${anchorStem}.test${anchorExt}`),
		path.posix.join(anchorParentDir, "tests", `${anchorStem}.spec${anchorExt}`),
		path.posix.join(anchorParentDir, "tests", `test_${anchorStem}${anchorExt}`),
		path.posix.join(anchorParentDir, "tests", `${anchorStem}_test${anchorExt}`),
	])

	return candidates.filter((candidate) => index.filesByLowerPath.has(candidate.toLowerCase()))
}

function pickDocCandidate(taskLower: string, anchorFile: string, index: WorkspaceIndex): string[] {
	const anchorStem = basenameWithoutExtension(anchorFile)

	if (/\breadme\b/u.test(taskLower)) {
		return index.docFiles.filter((file) => path.posix.basename(file).toLowerCase() === "readme.md")
	}
	if (/\bfaq\b/u.test(taskLower)) {
		return index.docFiles.filter((file) => basenameWithoutExtension(file) === "faq")
	}
	if (/\bguide\b/u.test(taskLower)) {
		return index.docFiles.filter((file) => basenameWithoutExtension(file) === "guide")
	}

	const basenameMatches = index.docFiles.filter((file) => basenameWithoutExtension(file).includes(anchorStem))
	if (basenameMatches.length > 0) return basenameMatches
	return index.docFiles
}

function pickConfigCandidate(taskLower: string, anchorFile: string, index: WorkspaceIndex): string[] {
	const anchorStem = basenameWithoutExtension(anchorFile)

	if (/\.env\b/u.test(taskLower)) {
		return index.configFiles.filter((file) => {
			const basename = path.posix.basename(file).toLowerCase()
			return basename === ".env" || basename === ".env.example"
		})
	}
	if (/\bdefaults\b/u.test(taskLower)) {
		return index.configFiles.filter((file) => path.posix.basename(file).toLowerCase().includes("defaults"))
	}
	if (/\bsettings\b/u.test(taskLower)) {
		return index.configFiles.filter((file) => path.posix.basename(file).toLowerCase().includes("settings"))
	}
	if (/\byaml\b/u.test(taskLower) || /\byml\b/u.test(taskLower)) {
		return index.configFiles.filter((file) => [".yaml", ".yml"].includes(path.posix.extname(file).toLowerCase()))
	}
	if (/\btoml\b/u.test(taskLower)) {
		return index.configFiles.filter((file) => path.posix.extname(file).toLowerCase() === ".toml")
	}
	if (/\bjson\b/u.test(taskLower)) {
		return index.configFiles.filter((file) => path.posix.extname(file).toLowerCase() === ".json")
	}

	const basenameMatches = index.configFiles.filter((file) => path.posix.basename(file).toLowerCase().includes(anchorStem))
	if (basenameMatches.length > 0) return basenameMatches
	return index.configFiles
}

function extractRelativeImportSpecifiers(sourceText: string): string[] {
	const specifiers = new Set<string>()
	const patterns = [
		/(?:import|export)\s[\s\S]*?from\s+["']([^"']+)["']/gu,
		/require\(\s*["']([^"']+)["']\s*\)/gu,
		/import\(\s*["']([^"']+)["']\s*\)/gu,
	]

	for (const pattern of patterns) {
		for (const match of sourceText.matchAll(pattern)) {
			const specifier = (match[1] ?? "").trim()
			if (specifier.startsWith("./") || specifier.startsWith("../")) {
				specifiers.add(specifier)
			}
		}
	}

	return Array.from(specifiers)
}

function resolveImportSpecifier(importerFile: string, specifier: string): string[] {
	const importerDir = path.posix.dirname(importerFile)
	const joined = normalizeRelPath(path.posix.join(importerDir, specifier))
	const candidates = [joined]
	if (!path.posix.extname(joined)) {
		for (const extension of IMPORTABLE_CODE_EXTENSIONS) {
			candidates.push(`${joined}${extension}`)
			candidates.push(path.posix.join(joined, `index${extension}`))
		}
	}
	return uniqueSorted(candidates)
}

function findDirectImporters(anchorFile: string, workspace: string, index: WorkspaceIndex): string[] {
	const anchorLower = anchorFile.toLowerCase()
	const importers: string[] = []

	for (const file of index.importableFiles) {
		if (file.toLowerCase() === anchorLower) continue

		let content = ""
		try {
			content = fs.readFileSync(path.join(workspace, file), "utf8")
		} catch {
			continue
		}

		const matchesAnchor = extractRelativeImportSpecifiers(content).some((specifier) =>
			resolveImportSpecifier(file, specifier).some((candidate) => candidate.toLowerCase() === anchorLower),
		)
		if (matchesAnchor) importers.push(file)
	}

	return uniqueSorted(importers)
}

function isLikelyTestFile(file: string): boolean {
	return TEST_FILE_PATTERN.test(normalizeRelPath(file).toLowerCase())
}

function isLikelyUiFile(file: string): boolean {
	const normalized = normalizeRelPath(file).toLowerCase()
	const basename = basenameWithoutExtension(normalized)
	const extension = path.posix.extname(normalized)
	return (
		IMPORTABLE_CODE_EXTENSIONS.includes(extension) &&
		(UI_PATH_CUE_PATTERN.test(normalized) || extension === ".tsx" || UI_BASENAME_CUE_PATTERN.test(basename))
	)
}

function findDirectImportedFiles(anchorFile: string, workspace: string, index: WorkspaceIndex): string[] {
	let content = ""
	try {
		content = fs.readFileSync(path.join(workspace, anchorFile), "utf8")
	} catch {
		return []
	}

	const candidates = extractRelativeImportSpecifiers(content).flatMap((specifier) => resolveImportSpecifier(anchorFile, specifier))
	return uniqueSorted(candidates.filter((candidate) => index.filesByLowerPath.has(candidate.toLowerCase())))
}

function findUiCompanionCandidates(anchorFile: string, workspace: string, index: WorkspaceIndex): string[] {
	const anchorLower = anchorFile.toLowerCase()
	const anchorDir = path.posix.dirname(anchorFile)
	const relatedFiles = uniqueSorted([
		...findDirectImportedFiles(anchorFile, workspace, index),
		...findDirectImporters(anchorFile, workspace, index),
	])

	return relatedFiles.filter((candidate) => {
		if (candidate.toLowerCase() === anchorLower) return false
		if (isLikelyTestFile(candidate)) return false
		if (path.posix.dirname(candidate) !== anchorDir) return false
		return isLikelyUiFile(anchorFile) || isLikelyUiFile(candidate)
	})
}

export function discoverSemiOpenTask(
	task: string,
	workspace: string,
	fileList: string[],
	options: { maxFiles?: number } = {},
): { match: SemiOpenDiscoveryResult | null; refusal: SemiOpenDiscoveryFailure | null } {
	const maxFiles = Math.max(1, options.maxFiles ?? 4)
	const normalizedTask = task.trim()
	const taskLower = normalizedTask.toLowerCase()
	const taskClass = detectSemiOpenTaskClass(taskLower)
	if (!taskClass || !matchesSafeTaskTemplate(normalizedTask)) {
		return { match: null, refusal: null }
	}

	const explicitRefs = extractTaskFileRefs(normalizedTask)
	if (explicitRefs.length === 0) {
		return buildFailure(taskClass, "missing_anchor_file", "Semi-open tasks must name exactly one anchor file.", [
			`Task matched the ${taskClass} semi-open lane but did not name a source file to anchor discovery.`,
		])
	}
	if (explicitRefs.length > 1) {
		return { match: null, refusal: null }
	}

	const index = createWorkspaceIndex(fileList)
	const anchorResolution = resolveWorkspaceFileRef(explicitRefs[0] ?? "", index)
	if (!anchorResolution.resolved) {
		if (anchorResolution.ambiguousCandidates.length > 0) {
			return buildFailure(taskClass, "ambiguous_anchor_file", "The named anchor file was ambiguous inside the workspace.", [
				`The task named ${explicitRefs[0]}, which matched multiple files: ${anchorResolution.ambiguousCandidates.join(", ")}.`,
			])
		}
		return buildFailure(taskClass, "missing_anchor_file", "The named anchor file was not found inside the workspace.", [
			`The task named ${explicitRefs[0]}, but no matching workspace file was found.`,
		])
	}

	const anchorFile = anchorResolution.resolved
	if (taskClass === "helper_test") {
		const testCandidates = findNearbyTestCandidates(anchorFile, index)
		if (testCandidates.length === 0) {
			return buildFailure(taskClass, "missing_test_candidate", "No nearby test file could be derived safely.", [
				`The helper/test lane needs one nearby test file for ${anchorFile}, but none matched the bounded naming patterns.`,
			])
		}
		if (testCandidates.length !== 1) {
			return buildFailure(taskClass, "ambiguous_test_candidate", "More than one nearby test file matched the helper/test lane.", [
				`The helper/test lane found multiple nearby test candidates for ${anchorFile}: ${testCandidates.join(", ")}.`,
			])
		}

		const targetFiles = uniqueSorted([anchorFile, testCandidates[0] ?? ""])
		const exactComment = extractExactQuotedLiteral(task, "comment")
		const summary = `Semi-open helper/test scope: ${anchorFile} with ${testCandidates[0]}`
		return buildMatch(
			taskClass,
			targetFiles,
			buildBoundedTaskContract(targetFiles, {
				requiredTargetFiles: targetFiles,
				expectedChangedFiles: targetFiles,
				readOnlyContextFiles: targetFiles,
				maxEditedFileCount: targetFiles.length,
				requiredContentSnippets: buildRepeatedSnippetExpectations(targetFiles, exactComment),
				derivation: {
					mode: "semi_open",
					taskClass,
					summary,
					details: [
						`Anchor file ${anchorFile} was named in the task.`,
						`Derived ${testCandidates[0]} from nearby test naming patterns.`,
					],
					anchorFiles: [anchorFile],
				},
			}),
			summary,
			[
				`Anchor file ${anchorFile} was named in the task.`,
				`Derived ${testCandidates[0]} from nearby test naming patterns.`,
			],
		)
	}

	if (taskClass === "retry_caller") {
		const directImporters = findDirectImporters(anchorFile, workspace, index)
		if (directImporters.length === 0) {
			return buildFailure(taskClass, "missing_direct_callsite", "No direct local caller could be derived safely.", [
				`The retry/caller lane found no direct relative importers for ${anchorFile}.`,
			])
		}
		if (directImporters.length !== 1) {
			return buildFailure(taskClass, "too_many_discovered_files", "More than one direct caller matched the bounded retry/caller lane.", [
				`The retry/caller lane found multiple direct callers for ${anchorFile}: ${directImporters.join(", ")}.`,
			])
		}

		const directCaller = directImporters[0] ?? ""
		const targetFiles = uniqueSorted([anchorFile, directCaller])
		const exactComment = extractExactQuotedLiteral(task, "comment")
		const summary = `Semi-open retry/caller scope: ${anchorFile} with direct caller ${directCaller}`
		return buildMatch(
			taskClass,
			targetFiles,
			buildBoundedTaskContract(targetFiles, {
				requiredTargetFiles: targetFiles,
				expectedChangedFiles: targetFiles,
				readOnlyContextFiles: targetFiles,
				maxEditedFileCount: targetFiles.length,
				requiredContentSnippets: buildRepeatedSnippetExpectations(targetFiles, exactComment),
				derivation: {
					mode: "semi_open",
					taskClass,
					summary,
					details: [
						`Anchor file ${anchorFile} was named in the task.`,
						`Derived ${directCaller} from one direct relative import of the retry helper.`,
					],
					anchorFiles: [anchorFile],
				},
			}),
			summary,
			[
				`Anchor file ${anchorFile} was named in the task.`,
				`Derived ${directCaller} from one direct relative import of the retry helper.`,
			],
		)
	}

	if (taskClass === "ui_logic") {
		const uiCompanions = findUiCompanionCandidates(anchorFile, workspace, index)
		if (uiCompanions.length === 0) {
			return buildFailure(taskClass, "missing_direct_callsite", "No direct local UI companion could be derived safely.", [
				`The UI logic lane found no direct same-directory JS/TS companion for ${anchorFile}.`,
			])
		}
		if (uiCompanions.length !== 1) {
			return buildFailure(taskClass, "too_many_discovered_files", "More than one direct UI companion matched the bounded UI lane.", [
				`The UI logic lane found multiple direct same-directory companions for ${anchorFile}: ${uiCompanions.join(", ")}.`,
			])
		}

		const uiCompanion = uiCompanions[0] ?? ""
		const targetFiles = uniqueSorted([anchorFile, uiCompanion])
		const exactComment = extractExactQuotedLiteral(task, "comment")
		const summary = `Semi-open ui_logic scope: ${anchorFile} with direct UI companion ${uiCompanion}`
		return buildMatch(
			taskClass,
			targetFiles,
			buildBoundedTaskContract(targetFiles, {
				requiredTargetFiles: targetFiles,
				expectedChangedFiles: targetFiles,
				readOnlyContextFiles: targetFiles,
				maxEditedFileCount: targetFiles.length,
				requiredContentSnippets: buildRepeatedSnippetExpectations(targetFiles, exactComment),
				derivation: {
					mode: "semi_open",
					taskClass,
					summary,
					details: [
						`Anchor file ${anchorFile} was named in the task.`,
						`Derived ${uiCompanion} from one direct same-directory UI import or importer link.`,
					],
					anchorFiles: [anchorFile],
				},
			}),
			summary,
			[
				`Anchor file ${anchorFile} was named in the task.`,
				`Derived ${uiCompanion} from one direct same-directory UI import or importer link.`,
			],
		)
	}

	if (taskClass === "docs_sync") {
		const docCandidates = uniqueSorted(pickDocCandidate(taskLower, anchorFile, index))
		if (docCandidates.length === 0) {
			return buildFailure(taskClass, "missing_doc_candidate", "No documentation file could be derived safely.", [
				`The docs-sync lane could not find a bounded documentation file to pair with ${anchorFile}.`,
			])
		}
		if (docCandidates.length !== 1) {
			return buildFailure(taskClass, "ambiguous_doc_candidate", "More than one documentation file matched the docs-sync lane.", [
				`The docs-sync lane found multiple candidates for ${anchorFile}: ${docCandidates.join(", ")}.`,
			])
		}

		const targetFiles = uniqueSorted([anchorFile, docCandidates[0] ?? ""])
		const requiredDocFile = docCandidates[0] ?? ""
		const exactSentence = extractExactQuotedLiteral(task, "sentence")
		const summary = `Semi-open docs-sync scope: ${anchorFile} with ${requiredDocFile}`
		return buildMatch(
			taskClass,
			targetFiles,
			buildBoundedTaskContract(targetFiles, {
				requiredTargetFiles: [requiredDocFile],
				expectedChangedFiles: [requiredDocFile],
				readOnlyContextFiles: targetFiles,
				maxEditedFileCount: targetFiles.length,
				requiredContentSnippets: buildSingleSnippetExpectation(requiredDocFile, exactSentence),
				derivation: {
					mode: "semi_open",
					taskClass,
					summary,
					details: [
						`Anchor file ${anchorFile} was named in the task.`,
						`Derived ${requiredDocFile} from the documentation hint in the task text.`,
					],
					anchorFiles: [anchorFile],
				},
			}),
			summary,
			[
				`Anchor file ${anchorFile} was named in the task.`,
				`Derived ${requiredDocFile} from the documentation hint in the task text.`,
			],
		)
	}

	if (taskClass === "config_sync") {
		// If the task already names a concrete config file, keep it in the explicit scoped lane.
		// The semi-open config-sync expansion is only for code-anchor tasks that need a derived config peer.
		if (isConfigCandidateFile(anchorFile)) {
			return { match: null, refusal: null }
		}

		const configCandidates = uniqueSorted(
			pickConfigCandidate(taskLower, anchorFile, index).filter((candidate) => candidate.toLowerCase() !== anchorFile.toLowerCase()),
		)
		if (configCandidates.length === 0) {
			return buildFailure(taskClass, "missing_config_candidate", "No config file could be derived safely.", [
				`The config-sync lane could not find a bounded config file to pair with ${anchorFile}.`,
			])
		}
		if (configCandidates.length !== 1) {
			return buildFailure(taskClass, "ambiguous_config_candidate", "More than one config file matched the config-sync lane.", [
				`The config-sync lane found multiple candidates for ${anchorFile}: ${configCandidates.join(", ")}.`,
			])
		}

		const requiredConfigFile = configCandidates[0] ?? ""
		const targetFiles = uniqueSorted([anchorFile, requiredConfigFile])
		const exactProperty = extractExactQuotedLiteral(task, "property")
		const summary = `Semi-open config-sync scope: ${anchorFile} with ${requiredConfigFile}`
		return buildMatch(
			taskClass,
			targetFiles,
			buildBoundedTaskContract(targetFiles, {
				requiredTargetFiles: [requiredConfigFile],
				expectedChangedFiles: [requiredConfigFile],
				readOnlyContextFiles: targetFiles,
				maxEditedFileCount: targetFiles.length,
				requiredContentSnippets: buildSingleSnippetExpectation(requiredConfigFile, exactProperty),
				derivation: {
					mode: "semi_open",
					taskClass,
					summary,
					details: [
						`Anchor file ${anchorFile} was named in the task.`,
						`Derived ${requiredConfigFile} from the config hint in the task text.`,
					],
					anchorFiles: [anchorFile],
				},
			}),
			summary,
			[
				`Anchor file ${anchorFile} was named in the task.`,
				`Derived ${requiredConfigFile} from the config hint in the task text.`,
			],
		)
	}

	const directImporters = findDirectImporters(anchorFile, workspace, index)
	if (directImporters.length === 0) {
		return buildFailure(taskClass, "missing_direct_callsite", "No direct local call sites could be derived safely.", [
			`The rename lane found no direct relative importers for ${anchorFile}.`,
		])
	}

	const targetFiles = uniqueSorted([anchorFile, ...directImporters])
	if (targetFiles.length > maxFiles) {
		return buildFailure(taskClass, "too_many_discovered_files", "The derived rename scope exceeded the bounded file limit.", [
			`The rename lane found ${targetFiles.length} files (${targetFiles.join(", ")}), above the supported limit of ${maxFiles}.`,
		])
	}

	const summary = `Semi-open rename scope: ${anchorFile} with direct call sites ${directImporters.join(", ")}`
	return buildMatch(
		taskClass,
		targetFiles,
		buildBoundedTaskContract(targetFiles, {
			requiredTargetFiles: targetFiles,
			expectedChangedFiles: targetFiles,
			readOnlyContextFiles: targetFiles,
			maxEditedFileCount: targetFiles.length,
			derivation: {
				mode: "semi_open",
				taskClass,
				summary,
				details: [
					`Anchor file ${anchorFile} was named in the task.`,
					`Derived direct importers from relative import links: ${directImporters.join(", ")}.`,
				],
				anchorFiles: [anchorFile],
			},
		}),
		summary,
		[
			`Anchor file ${anchorFile} was named in the task.`,
			`Derived direct importers from relative import links: ${directImporters.join(", ")}.`,
		],
	)
}
