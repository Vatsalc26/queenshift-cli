import { discoverSemiOpenTask, listWorkspaceFilesForDiscovery } from "../run/SemiOpenDiscovery"
import { extractTaskFileRefs, normalizeRelPath } from "../run/TaskContract"
import type { QueenBeeTaskFamily } from "./QueenBeeProtocol"

const TEST_FILE_PATTERN = /(^|\/)__tests__(\/|$)|(?:\.|_)test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/u
const NODE_TASK_SIGNAL_PATTERN =
	/(package\.json|process\.env|process\.argv|child_process|\bnpm run\b|\bcli\b|\bargv\b|\bstdin\b|\bstdout\b|\bstderr\b|commander|yargs)/iu

export type QueenBeeScopeDerivationMode = "explicit" | "semi_open"

export type QueenBeeNaturalLanguageScopeReason =
	| "natural_language_scope_missing_anchor_file"
	| "natural_language_scope_ambiguous_anchor_file"
	| "natural_language_scope_requires_scout_resolution"
	| "natural_language_scope_unsupported_lane"
	| "natural_language_scope_unsupported_task_shape"
	| "natural_language_scope_target_count_out_of_bounds"
	| "natural_language_task_family_not_derived"
	| "natural_language_task_family_scope_mismatch"

export type QueenBeeNaturalLanguageScopeResult = {
	accepted: boolean
	reason: QueenBeeNaturalLanguageScopeReason | null
	taskFamily: QueenBeeTaskFamily | null
	targetFiles: string[]
	derivationMode: QueenBeeScopeDerivationMode | null
	summary: string
	details: string[]
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => normalizeRelPath(value)).filter(Boolean)))
}

function isLikelyTestFile(filePath: string): boolean {
	return TEST_FILE_PATTERN.test(normalizeRelPath(filePath).toLowerCase())
}

function orderSourceBeforeTest(files: string[]): string[] {
	return [...files].sort((left, right) => {
		const leftRank = isLikelyTestFile(left) ? 1 : 0
		const rightRank = isLikelyTestFile(right) ? 1 : 0
		return leftRank - rightRank || left.localeCompare(right)
	})
}

function hasHelperTestCue(taskLower: string): boolean {
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

function hasRetryCallerCue(taskLower: string): boolean {
	return (
		(/\bretry\b/u.test(taskLower) || /\bbackoff\b/u.test(taskLower) || /\btimeout\b/u.test(taskLower)) &&
		(/\bdirect caller\b/u.test(taskLower) ||
			/\bcaller(s)?\b/u.test(taskLower) ||
			/\bcall site\b/u.test(taskLower) ||
			/\bcall sites\b/u.test(taskLower))
	)
}

function hasUiLogicCue(taskLower: string): boolean {
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

function hasRenameExportCue(taskLower: string): boolean {
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

function hasCreateCue(taskLower: string): boolean {
	return /\bcreate\b/u.test(taskLower) || /\bnew file\b/u.test(taskLower)
}

function hasCommentCue(taskLower: string): boolean {
	return /\bcomment\b/u.test(taskLower)
}

function normalizeNamedFileRefs(task: string, explicitTargetFiles: string[]): string[] {
	const directRefs = explicitTargetFiles.length > 0 ? explicitTargetFiles : extractTaskFileRefs(task)
	return uniqueStrings(directRefs)
}

function resolveWorkspaceFileRef(
	fileRef: string,
	fileList: string[],
): { resolved: string; ambiguous: boolean } {
	const normalizedRef = normalizeRelPath(fileRef)
	const lowerRef = normalizedRef.toLowerCase()
	const exact = fileList.find((file) => file.toLowerCase() === lowerRef)
	if (exact) return { resolved: exact, ambiguous: false }

	const basename = normalizedRef.split("/").pop()?.toLowerCase() ?? lowerRef
	const basenameMatches = fileList.filter((file) => file.split("/").pop()?.toLowerCase() === basename)
	if (basenameMatches.length === 1) {
		return { resolved: basenameMatches[0] ?? normalizedRef, ambiguous: false }
	}
	if (basenameMatches.length > 1) {
		return { resolved: normalizedRef, ambiguous: true }
	}
	return { resolved: normalizedRef, ambiguous: false }
}

export function inferQueenBeeTaskFamily(task: string, targetFiles: string[]): QueenBeeTaskFamily | null {
	const normalizedTargets = uniqueStrings(targetFiles)
	const taskLower = task.trim().toLowerCase()

	if (hasRenameExportCue(taskLower) && normalizedTargets.length >= 2 && normalizedTargets.length <= 3) {
		return "rename_export"
	}
	if (normalizedTargets.length === 2 && normalizedTargets.filter((filePath) => isLikelyTestFile(filePath)).length === 1) {
		return "update_file_and_test"
	}
	if (NODE_TASK_SIGNAL_PATTERN.test(`${task}\n${normalizedTargets.join("\n")}`) && normalizedTargets.length >= 1 && normalizedTargets.length <= 2) {
		return "bounded_node_cli_task"
	}
	if (normalizedTargets.length === 1 && hasCreateCue(taskLower)) {
		return "create_tiny_file"
	}
	if (normalizedTargets.length === 1 && hasCommentCue(taskLower)) {
		return "comment_file"
	}
	if (normalizedTargets.length === 2) {
		return "bounded_two_file_update"
	}
	if (normalizedTargets.length === 1) {
		return "update_named_file"
	}
	return null
}

export function reasonForQueenBeeTargetCount(taskFamily: QueenBeeTaskFamily, targetFiles: string[]): string | null {
	if (taskFamily === "bounded_two_file_update") {
		return targetFiles.length === 2 ? null : "bounded_two_file_update_requires_two_targets"
	}
	if (taskFamily === "update_file_and_test") {
		if (targetFiles.length !== 2) {
			return "update_file_and_test_requires_two_targets"
		}
		const testFileCount = targetFiles.filter((targetFile) => isLikelyTestFile(targetFile)).length
		return testFileCount === 1 ? null : "update_file_and_test_requires_one_source_and_one_test"
	}
	if (taskFamily === "bounded_node_cli_task") {
		return targetFiles.length >= 1 && targetFiles.length <= 2 ? null : "bounded_node_cli_task_requires_one_or_two_targets"
	}
	if (taskFamily === "rename_export") {
		return targetFiles.length >= 2 && targetFiles.length <= 3 ? null : "rename_export_requires_two_or_three_targets"
	}
	return targetFiles.length === 1 ? null : "single_file_task_family_requires_one_target"
}

function acceptedScope(
	taskFamily: QueenBeeTaskFamily | null,
	targetFiles: string[],
	derivationMode: QueenBeeScopeDerivationMode,
	summary: string,
	details: string[],
): QueenBeeNaturalLanguageScopeResult {
	return {
		accepted: true,
		reason: null,
		taskFamily,
		targetFiles,
		derivationMode,
		summary,
		details,
	}
}

function refusedScope(
	reason: QueenBeeNaturalLanguageScopeReason,
	targetFiles: string[],
	summary: string,
	details: string[],
	taskFamily: QueenBeeTaskFamily | null = null,
): QueenBeeNaturalLanguageScopeResult {
	return {
		accepted: false,
		reason,
		taskFamily,
		targetFiles,
		derivationMode: null,
		summary,
		details,
	}
}

export function compileQueenBeeScoutScope(options: {
	task: string
	workspace: string
	explicitTargetFiles?: string[]
}): QueenBeeNaturalLanguageScopeResult {
	const task = options.task.trim()
	const explicitTargetFiles = uniqueStrings(options.explicitTargetFiles ?? [])
	const fileList = listWorkspaceFilesForDiscovery(options.workspace)
	if (explicitTargetFiles.length > 0) {
		const resolvedTargets = explicitTargetFiles.map((targetFile) => resolveWorkspaceFileRef(targetFile, fileList))
		if (resolvedTargets.some((result) => result.ambiguous)) {
			return refusedScope(
				"natural_language_scope_ambiguous_anchor_file",
				explicitTargetFiles,
				"ScoutBee refused the request because one named target file was ambiguous inside the workspace.",
				["At least one explicit target file matched more than one workspace path."],
			)
		}
		const targetFiles = uniqueStrings(resolvedTargets.map((result) => result.resolved))
		const taskFamily = inferQueenBeeTaskFamily(task, targetFiles)
		if (!taskFamily) {
			return refusedScope(
				"natural_language_scope_unsupported_task_shape",
				targetFiles,
				"ScoutBee refused the request because the named targets did not map to a bounded QueenBee family.",
				["Explicit target files were present, but the task text did not map cleanly to a bounded QueenBee family."],
			)
		}
		const targetCountReason = reasonForQueenBeeTargetCount(taskFamily, targetFiles)
		if (targetCountReason) {
			return refusedScope(
				"natural_language_scope_target_count_out_of_bounds",
				targetFiles,
				`ScoutBee refused ${taskFamily} because the compiled target count was out of bounds.`,
				[`Compiled target files: ${targetFiles.join(", ")}.`],
				taskFamily,
			)
		}
		return acceptedScope(
			taskFamily,
			taskFamily === "update_file_and_test" ? orderSourceBeforeTest(targetFiles) : targetFiles,
			"explicit",
			`ScoutBee accepted explicit scope for ${taskFamily} over ${targetFiles.join(", ")}.`,
			["Target files were already explicit in the scout request or task text."],
		)
	}

	const semiOpenDiscovery = discoverSemiOpenTask(task, options.workspace, fileList, { maxFiles: 3 })
	if (semiOpenDiscovery.match) {
		if (semiOpenDiscovery.match.taskClass === "helper_test") {
			return acceptedScope(
				"update_file_and_test",
				orderSourceBeforeTest(semiOpenDiscovery.match.targetFiles),
				"semi_open",
				`ScoutBee compiled helper/test scope to ${orderSourceBeforeTest(semiOpenDiscovery.match.targetFiles).join(", ")}.`,
				semiOpenDiscovery.match.details,
			)
		}
		if (semiOpenDiscovery.match.taskClass === "retry_caller") {
			return acceptedScope(
				"bounded_two_file_update",
				semiOpenDiscovery.match.targetFiles,
				"semi_open",
				`ScoutBee compiled retry/caller scope to ${semiOpenDiscovery.match.targetFiles.join(", ")}.`,
				semiOpenDiscovery.match.details,
			)
		}
		if (semiOpenDiscovery.match.taskClass === "ui_logic") {
			return acceptedScope(
				"bounded_two_file_update",
				semiOpenDiscovery.match.targetFiles,
				"semi_open",
				`ScoutBee compiled ui_logic scope to ${semiOpenDiscovery.match.targetFiles.join(", ")}.`,
				semiOpenDiscovery.match.details,
			)
		}
		if (semiOpenDiscovery.match.taskClass === "rename_export") {
			return acceptedScope(
				"rename_export",
				semiOpenDiscovery.match.targetFiles,
				"semi_open",
				`ScoutBee compiled rename scope to ${semiOpenDiscovery.match.targetFiles.join(", ")}.`,
				semiOpenDiscovery.match.details,
			)
		}
		return refusedScope(
			"natural_language_scope_unsupported_lane",
			semiOpenDiscovery.match.targetFiles,
			"ScoutBee refused the request because the matched semi-open lane is outside the current QueenBee family set.",
			semiOpenDiscovery.match.details,
		)
	}
	if (semiOpenDiscovery.refusal) {
		if (
			semiOpenDiscovery.refusal.taskClass === "helper_test" ||
			semiOpenDiscovery.refusal.taskClass === "retry_caller" ||
			semiOpenDiscovery.refusal.taskClass === "ui_logic" ||
			semiOpenDiscovery.refusal.taskClass === "rename_export"
		) {
			const refusalReason =
				semiOpenDiscovery.refusal.code === "missing_anchor_file"
					? "natural_language_scope_missing_anchor_file"
					: semiOpenDiscovery.refusal.code === "ambiguous_anchor_file"
						? "natural_language_scope_ambiguous_anchor_file"
						: "natural_language_scope_requires_scout_resolution"
			return refusedScope(refusalReason, [], semiOpenDiscovery.refusal.summary, semiOpenDiscovery.refusal.details)
		}
		return refusedScope(
			"natural_language_scope_unsupported_lane",
			[],
			"ScoutBee refused the request because the matched semi-open lane is outside the current QueenBee family set.",
			semiOpenDiscovery.refusal.details,
		)
	}

	const namedRefs = normalizeNamedFileRefs(task, [])
	if (namedRefs.length === 0) {
		return refusedScope(
			"natural_language_scope_missing_anchor_file",
			[],
			"ScoutBee refused the request because no bounded file anchor was named.",
			["Bounded natural-language scope still requires at least one named file anchor."],
		)
	}
	const resolvedTargets = namedRefs.map((targetFile) => resolveWorkspaceFileRef(targetFile, fileList))
	if (resolvedTargets.some((result) => result.ambiguous)) {
		return refusedScope(
			"natural_language_scope_ambiguous_anchor_file",
			namedRefs,
			"ScoutBee refused the request because one named file anchor was ambiguous inside the workspace.",
			["At least one task-named file matched more than one workspace path."],
		)
	}
	const targetFiles = uniqueStrings(resolvedTargets.map((result) => result.resolved))
	const taskFamily = inferQueenBeeTaskFamily(task, targetFiles)
	if (!taskFamily) {
		return refusedScope(
			"natural_language_scope_unsupported_task_shape",
			targetFiles,
			"ScoutBee refused the request because the task did not map to a bounded QueenBee family.",
			["Named file anchors were present, but the task text still did not compile to a bounded QueenBee family."],
		)
	}
	const targetCountReason = reasonForQueenBeeTargetCount(taskFamily, targetFiles)
	if (targetCountReason) {
		return refusedScope(
			"natural_language_scope_target_count_out_of_bounds",
			targetFiles,
			`ScoutBee refused ${taskFamily} because the compiled target count was out of bounds.`,
			[`Compiled target files: ${targetFiles.join(", ")}.`],
			taskFamily,
		)
	}
	return acceptedScope(
		taskFamily,
		taskFamily === "update_file_and_test" ? orderSourceBeforeTest(targetFiles) : targetFiles,
		"explicit",
		`ScoutBee compiled explicit scope for ${taskFamily} over ${targetFiles.join(", ")}.`,
		["Target files were compiled directly from task-named file refs."],
	)
}

export function compileQueenBeePlanScope(options: {
	task: string
	explicitTargetFiles?: string[]
	explicitTaskFamily?: QueenBeeTaskFamily
}): QueenBeeNaturalLanguageScopeResult {
	const task = options.task.trim()
	const taskLower = task.toLowerCase()
	const explicitTargetFiles = uniqueStrings(options.explicitTargetFiles ?? [])
	const targetFiles = normalizeNamedFileRefs(task, explicitTargetFiles)
	const explicitTaskFamily = options.explicitTaskFamily ?? null

	if (explicitTargetFiles.length === 0 && targetFiles.length === 0) {
		return refusedScope(
			"natural_language_scope_missing_anchor_file",
			[],
			"PlannerBee refused the request because no bounded target files were available for planning.",
			["PlannerBee needs explicit target files from the request or direct file refs in the task text."],
		)
	}

	if (
		explicitTargetFiles.length === 0 &&
		targetFiles.length === 1 &&
		(hasHelperTestCue(taskLower) || hasRetryCallerCue(taskLower) || hasUiLogicCue(taskLower) || hasRenameExportCue(taskLower))
	) {
		return refusedScope(
			"natural_language_scope_requires_scout_resolution",
			targetFiles,
			"PlannerBee refused the request because this anchored natural-language row still needs ScoutBee to compile explicit scope first.",
			[
				"Helper/test, retry/caller, UI logic, and rename rows may start from one anchor file, but PlannerBee requires ScoutBee to expand them into explicit target files first.",
			],
		)
	}

	const taskFamily = explicitTaskFamily ?? inferQueenBeeTaskFamily(task, targetFiles)
	if (!taskFamily) {
		return refusedScope(
			"natural_language_task_family_not_derived",
			targetFiles,
			"PlannerBee refused the request because the task family could not be derived from the bounded natural-language scope.",
			["PlannerBee only derives task families for the current bounded QueenBee rows."],
		)
	}

	const inferredTaskFamily = inferQueenBeeTaskFamily(task, targetFiles)
	if (explicitTaskFamily && inferredTaskFamily && explicitTaskFamily !== inferredTaskFamily) {
		return refusedScope(
			"natural_language_task_family_scope_mismatch",
			targetFiles,
			`PlannerBee refused the request because explicit family ${explicitTaskFamily} did not match the compiled task shape ${inferredTaskFamily}.`,
			[`Compiled target files: ${targetFiles.join(", ")}.`],
			explicitTaskFamily,
		)
	}

	return acceptedScope(
		taskFamily,
		taskFamily === "update_file_and_test" ? orderSourceBeforeTest(targetFiles) : targetFiles,
		explicitTargetFiles.length > 0 ? "explicit" : "explicit",
		explicitTaskFamily
			? `PlannerBee accepted explicit family ${taskFamily} over ${targetFiles.join(", ")}.`
			: `PlannerBee compiled ${taskFamily} over ${targetFiles.join(", ")} from the bounded task text.`,
		[
			explicitTargetFiles.length > 0
				? "Target files were explicit when the planner request arrived."
				: "Target files were compiled directly from task-named file refs or prior scout scope.",
		],
	)
}
