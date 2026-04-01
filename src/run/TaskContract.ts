export type ScopeContract = {
	allowedFiles: string[]
	requiredTargetFiles: string[]
	maxEditedFileCount: number
	readOnlyContextFiles?: string[]
}

export type ContentSnippetExpectation = {
	path: string
	snippet: string
}

export type AcceptanceExpectations = {
	expectedChangedFiles?: string[]
	forbiddenChangedFiles?: string[]
	requiredCreatedFiles?: string[]
	requiredContentSnippets?: ContentSnippetExpectation[]
	forbiddenContentSnippets?: ContentSnippetExpectation[]
	expectedStopClass?: "pass" | "review_required" | "failed" | "infra_blocked"
}

export type SemiOpenTaskClass = "helper_test" | "retry_caller" | "ui_logic" | "docs_sync" | "rename_export" | "config_sync"

export type RefactorLanguagePackId = "javascript_typescript" | "python"

export type RefactorIntent = {
	kind: "rename_symbol"
	sourceSymbol: string
	targetSymbol: string
	anchorFile: string | null
	relatedFiles: string[]
	languagePackId: RefactorLanguagePackId | null
	anchorSymbolPresent: boolean | null
}

export type ScopeDerivation = {
	mode: "explicit" | "semi_open"
	taskClass?: SemiOpenTaskClass
	summary?: string
	details?: string[]
	anchorFiles?: string[]
}

export type TaskContract = {
	scope?: ScopeContract
	acceptance?: AcceptanceExpectations
	derivation?: ScopeDerivation
	refactorIntent?: RefactorIntent
}

export function normalizeRelPath(input: string): string {
	return input.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

export function extractTaskFileRefs(task: string): string[] {
	const matches = task.match(/\b[\w./-]+\.[A-Za-z0-9]+\b/g) ?? []
	return Array.from(new Set(matches.map((entry) => normalizeRelPath(entry)).filter(Boolean)))
}

export function matchesSafeTaskTemplate(task: string): boolean {
	return /\b(add|change|comment|create|edit|fix|implement|make|modify|rename|remove|sync|update|write)\b/i.test(task)
}

function normalizeFileList(files: string[] | undefined): string[] {
	if (!Array.isArray(files)) return []
	return Array.from(new Set(files.map((file) => normalizeRelPath(String(file))).filter(Boolean)))
}

function normalizeSnippets(snippets: ContentSnippetExpectation[] | undefined): ContentSnippetExpectation[] {
	if (!Array.isArray(snippets)) return []
	return snippets
		.map((snippet) => ({
			path: normalizeRelPath(String(snippet.path ?? "")),
			snippet: typeof snippet.snippet === "string" ? snippet.snippet : "",
		}))
		.filter((snippet) => Boolean(snippet.path) && snippet.snippet.length > 0)
}

function normalizeDetails(details: string[] | undefined): string[] {
	if (!Array.isArray(details)) return []
	return details
		.map((detail) => String(detail ?? "").trim())
		.filter(Boolean)
}

function normalizeRefactorIntent(refactorIntent: RefactorIntent | undefined): RefactorIntent | undefined {
	if (!refactorIntent || refactorIntent.kind !== "rename_symbol") return undefined
	const sourceSymbol = typeof refactorIntent.sourceSymbol === "string" ? refactorIntent.sourceSymbol.trim() : ""
	const targetSymbol = typeof refactorIntent.targetSymbol === "string" ? refactorIntent.targetSymbol.trim() : ""
	if (!sourceSymbol || !targetSymbol) return undefined
	return {
		kind: "rename_symbol",
		sourceSymbol,
		targetSymbol,
		anchorFile: typeof refactorIntent.anchorFile === "string" && refactorIntent.anchorFile.trim() ? normalizeRelPath(refactorIntent.anchorFile) : null,
		relatedFiles: normalizeFileList(refactorIntent.relatedFiles),
		languagePackId:
			refactorIntent.languagePackId === "javascript_typescript" || refactorIntent.languagePackId === "python"
				? refactorIntent.languagePackId
				: null,
		anchorSymbolPresent:
			typeof refactorIntent.anchorSymbolPresent === "boolean" ? refactorIntent.anchorSymbolPresent : null,
	}
}

function normalizeDerivation(derivation: ScopeDerivation | undefined): ScopeDerivation | undefined {
	if (!derivation) return undefined
	if (derivation.mode !== "explicit" && derivation.mode !== "semi_open") return undefined
	return {
		mode: derivation.mode,
		taskClass: derivation.taskClass,
		summary: typeof derivation.summary === "string" ? derivation.summary.trim() : undefined,
		details: normalizeDetails(derivation.details),
		anchorFiles: normalizeFileList(derivation.anchorFiles),
	}
}

export function normalizeTaskContract(contract: TaskContract | null | undefined): TaskContract | null {
	if (!contract) return null

	const scope = contract.scope
		? {
				allowedFiles: normalizeFileList(contract.scope.allowedFiles),
				requiredTargetFiles: normalizeFileList(contract.scope.requiredTargetFiles),
				maxEditedFileCount:
					typeof contract.scope.maxEditedFileCount === "number" && contract.scope.maxEditedFileCount > 0
						? Math.floor(contract.scope.maxEditedFileCount)
						: normalizeFileList(contract.scope.allowedFiles).length,
				readOnlyContextFiles: normalizeFileList(contract.scope.readOnlyContextFiles),
		  }
		: undefined

	const acceptance = contract.acceptance
		? {
				expectedChangedFiles: normalizeFileList(contract.acceptance.expectedChangedFiles),
				forbiddenChangedFiles: normalizeFileList(contract.acceptance.forbiddenChangedFiles),
				requiredCreatedFiles: normalizeFileList(contract.acceptance.requiredCreatedFiles),
				requiredContentSnippets: normalizeSnippets(contract.acceptance.requiredContentSnippets),
				forbiddenContentSnippets: normalizeSnippets(contract.acceptance.forbiddenContentSnippets),
				expectedStopClass: contract.acceptance.expectedStopClass,
			  }
		: undefined

	const derivation = normalizeDerivation(contract.derivation)
	const refactorIntent = normalizeRefactorIntent(contract.refactorIntent)

	return {
		scope:
			scope && (scope.allowedFiles.length > 0 || scope.requiredTargetFiles.length > 0)
				? {
						...scope,
						maxEditedFileCount: Math.max(
							scope.maxEditedFileCount,
							scope.requiredTargetFiles.length,
							scope.allowedFiles.length > 0 ? 1 : 0,
						),
				  }
				: undefined,
		acceptance,
		derivation,
		refactorIntent,
	}
}

export type BuildBoundedTaskContractOptions = {
	requiredTargetFiles?: string[]
	readOnlyContextFiles?: string[]
	maxEditedFileCount?: number
	expectedChangedFiles?: string[]
	forbiddenChangedFiles?: string[]
	requiredCreatedFiles?: string[]
	requiredContentSnippets?: ContentSnippetExpectation[]
	forbiddenContentSnippets?: ContentSnippetExpectation[]
	derivation?: ScopeDerivation
	refactorIntent?: RefactorIntent
}

export function buildBoundedTaskContract(allowedFiles: string[], options: BuildBoundedTaskContractOptions = {}): TaskContract {
	const normalizedAllowedFiles = normalizeFileList(allowedFiles)
	const normalizedRequiredTargetFiles = normalizeFileList(options.requiredTargetFiles ?? normalizedAllowedFiles)
	const normalizedExpectedChangedFiles = normalizeFileList(options.expectedChangedFiles ?? normalizedRequiredTargetFiles)
	const normalizedForbiddenChangedFiles = normalizeFileList(options.forbiddenChangedFiles ?? [])
	const normalizedRequiredCreatedFiles = normalizeFileList(options.requiredCreatedFiles ?? [])
	const normalizedRequiredContentSnippets = normalizeSnippets(options.requiredContentSnippets ?? [])
	const normalizedForbiddenContentSnippets = normalizeSnippets(options.forbiddenContentSnippets ?? [])
	const normalizedReadOnlyContextFiles = normalizeFileList(options.readOnlyContextFiles ?? normalizedAllowedFiles)

	return (
		normalizeTaskContract({
			scope: {
				allowedFiles: normalizedAllowedFiles,
				requiredTargetFiles: normalizedRequiredTargetFiles,
				maxEditedFileCount:
					typeof options.maxEditedFileCount === "number" && options.maxEditedFileCount > 0
						? Math.floor(options.maxEditedFileCount)
						: normalizedAllowedFiles.length,
				readOnlyContextFiles: normalizedReadOnlyContextFiles,
			},
			acceptance: {
				expectedChangedFiles: normalizedExpectedChangedFiles,
				forbiddenChangedFiles: normalizedForbiddenChangedFiles,
				requiredCreatedFiles: normalizedRequiredCreatedFiles,
				requiredContentSnippets: normalizedRequiredContentSnippets,
				forbiddenContentSnippets: normalizedForbiddenContentSnippets,
			},
			derivation: options.derivation,
			refactorIntent: options.refactorIntent,
		}) ?? {}
	)
}

export function buildScopedTaskContract(targetFiles: string[], readOnlyContextFiles?: string[]): TaskContract {
	const normalizedTargets = normalizeFileList(targetFiles)
	return buildBoundedTaskContract(normalizedTargets, {
		requiredTargetFiles: normalizedTargets,
		readOnlyContextFiles: readOnlyContextFiles ?? normalizedTargets,
		expectedChangedFiles: normalizedTargets,
		derivation: {
			mode: "explicit",
			summary: normalizedTargets.length > 0 ? `Explicit file scope: ${normalizedTargets.join(", ")}` : undefined,
			anchorFiles: normalizedTargets,
		},
	})
}

export function mergeTaskContracts(
	primary: TaskContract | null | undefined,
	secondary: TaskContract | null | undefined,
): TaskContract | null {
	const normalizedPrimary = normalizeTaskContract(primary)
	const normalizedSecondary = normalizeTaskContract(secondary)
	if (!normalizedPrimary && !normalizedSecondary) return null

	const mergedScope = normalizedPrimary?.scope || normalizedSecondary?.scope
		? {
				allowedFiles: normalizeFileList([
					...(normalizedPrimary?.scope?.allowedFiles ?? []),
					...(normalizedSecondary?.scope?.allowedFiles ?? []),
				]),
				requiredTargetFiles: normalizeFileList([
					...(normalizedPrimary?.scope?.requiredTargetFiles ?? []),
					...(normalizedSecondary?.scope?.requiredTargetFiles ?? []),
				]),
				maxEditedFileCount: Math.max(
					normalizedPrimary?.scope?.maxEditedFileCount ?? 0,
					normalizedSecondary?.scope?.maxEditedFileCount ?? 0,
				),
				readOnlyContextFiles: normalizeFileList([
					...(normalizedPrimary?.scope?.readOnlyContextFiles ?? []),
					...(normalizedSecondary?.scope?.readOnlyContextFiles ?? []),
				]),
		  }
		: undefined

	const mergedAcceptance = normalizedPrimary?.acceptance || normalizedSecondary?.acceptance
		? {
				expectedChangedFiles: normalizeFileList([
					...(normalizedPrimary?.acceptance?.expectedChangedFiles ?? []),
					...(normalizedSecondary?.acceptance?.expectedChangedFiles ?? []),
				]),
				forbiddenChangedFiles: normalizeFileList([
					...(normalizedPrimary?.acceptance?.forbiddenChangedFiles ?? []),
					...(normalizedSecondary?.acceptance?.forbiddenChangedFiles ?? []),
				]),
				requiredCreatedFiles: normalizeFileList([
					...(normalizedPrimary?.acceptance?.requiredCreatedFiles ?? []),
					...(normalizedSecondary?.acceptance?.requiredCreatedFiles ?? []),
				]),
				requiredContentSnippets: normalizeSnippets([
					...(normalizedPrimary?.acceptance?.requiredContentSnippets ?? []),
					...(normalizedSecondary?.acceptance?.requiredContentSnippets ?? []),
				]),
				forbiddenContentSnippets: normalizeSnippets([
					...(normalizedPrimary?.acceptance?.forbiddenContentSnippets ?? []),
					...(normalizedSecondary?.acceptance?.forbiddenContentSnippets ?? []),
				]),
				expectedStopClass: normalizedPrimary?.acceptance?.expectedStopClass ?? normalizedSecondary?.acceptance?.expectedStopClass,
		  }
		: undefined

	return normalizeTaskContract({
		scope: mergedScope,
		acceptance: mergedAcceptance,
		derivation: normalizedPrimary?.derivation ?? normalizedSecondary?.derivation,
		refactorIntent: normalizedPrimary?.refactorIntent ?? normalizedSecondary?.refactorIntent,
	})
}

export function extractRenameSymbolIntent(task: string): { sourceSymbol: string; targetSymbol: string } | null {
	const normalizedTask = task.trim()
	const match =
		/\brename\s+(?:the\s+)?(?:(?:export|symbol|function|class|const|variable)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+to\s+([A-Za-z_][A-Za-z0-9_]*)\b/iu.exec(
			normalizedTask,
		)
	if (!match) return null
	const sourceSymbol = typeof match[1] === "string" ? match[1].trim() : ""
	const targetSymbol = typeof match[2] === "string" ? match[2].trim() : ""
	return sourceSymbol && targetSymbol ? { sourceSymbol, targetSymbol } : null
}
