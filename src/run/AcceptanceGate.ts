import type { TaskContract } from "./TaskContract"
import { normalizeRelPath, normalizeTaskContract } from "./TaskContract"

export type AcceptanceFailureCode =
	| "reviewer_not_passed"
	| "reviewer_invalid"
	| "no_meaningful_diff"
	| "scope_drift"
	| "missing_expected_change"
	| "forbidden_file_changed"
	| "required_created_file_missing"
	| "too_many_changed_files"
	| "required_snippet_missing"
	| "forbidden_snippet_present"

export type AcceptanceCheckFailure = {
	code: AcceptanceFailureCode
	message: string
	files?: string[]
}

export type AcceptanceGateInput = {
	reviewerVerdict: "PASS" | "NEEDS_WORK" | null
	reviewOutputValid: boolean
	requireMeaningfulDiff: boolean
	hasMeaningfulDiff: boolean
	changedFiles: string[]
	createdFiles: string[]
	postRunFileContents: Record<string, string | null>
	taskContract?: TaskContract | null
}

export type AcceptanceGateResult = {
	passed: boolean
	failedChecks: AcceptanceCheckFailure[]
	warnings: string[]
	evidenceSummary: {
		changedFiles: string[]
		createdFiles: string[]
		scopedFiles: string[]
		requiredTargetFiles: string[]
	}
}

function uniqueSortedFiles(files: string[]): string[] {
	return Array.from(new Set(files.map((file) => normalizeRelPath(String(file))).filter(Boolean))).sort()
}

function intersect(left: string[], right: Set<string>): string[] {
	return left.filter((entry) => right.has(entry))
}

export function evaluateAcceptanceGate(input: AcceptanceGateInput): AcceptanceGateResult {
	const contract = normalizeTaskContract(input.taskContract)
	const changedFiles = uniqueSortedFiles(input.changedFiles)
	const createdFiles = uniqueSortedFiles(input.createdFiles)
	const postRunFileContents: Record<string, string | null> = {}
	for (const [file, content] of Object.entries(input.postRunFileContents ?? {})) {
		postRunFileContents[normalizeRelPath(file)] = typeof content === "string" ? content : null
	}

	const failures: AcceptanceCheckFailure[] = []
	const warnings: string[] = []
	const scope = contract?.scope
	const acceptance = contract?.acceptance

	if (input.reviewerVerdict !== "PASS") {
		failures.push({
			code: "reviewer_not_passed",
			message: `Reviewer verdict must be PASS, got ${input.reviewerVerdict ?? "null"}.`,
		})
	}

	if (!input.reviewOutputValid) {
		failures.push({
			code: "reviewer_invalid",
			message: "Reviewer output was invalid or unreadable.",
		})
	}

	if (input.requireMeaningfulDiff && !input.hasMeaningfulDiff) {
		failures.push({
			code: "no_meaningful_diff",
			message: "No meaningful diff evidence was found for a code-changing task.",
		})
	}

	if (scope) {
		const allowedFiles = new Set(uniqueSortedFiles(scope.allowedFiles))
		const requiredTargetFiles = uniqueSortedFiles(scope.requiredTargetFiles)
		const driftFiles = allowedFiles.size > 0 ? changedFiles.filter((file) => !allowedFiles.has(file)) : []
		if (driftFiles.length > 0) {
			failures.push({
				code: "scope_drift",
				message: `Changed files outside the scoped allowlist: ${driftFiles.join(", ")}`,
				files: driftFiles,
			})
		}

		if (scope.maxEditedFileCount > 0 && changedFiles.length > scope.maxEditedFileCount) {
			failures.push({
				code: "too_many_changed_files",
				message: `Changed ${changedFiles.length} files but the scope contract allows at most ${scope.maxEditedFileCount}.`,
				files: changedFiles,
			})
		}

		const missingScopeTargets = requiredTargetFiles.filter((file) => !changedFiles.includes(file))
		if (missingScopeTargets.length > 0) {
			failures.push({
				code: "missing_expected_change",
				message: `Required scoped target files did not change: ${missingScopeTargets.join(", ")}`,
				files: missingScopeTargets,
			})
		}
	}

	if (acceptance) {
		const expectedChangedFiles = uniqueSortedFiles(acceptance.expectedChangedFiles ?? [])
		const forbiddenChangedFiles = new Set(uniqueSortedFiles(acceptance.forbiddenChangedFiles ?? []))
		const requiredCreatedFiles = uniqueSortedFiles(acceptance.requiredCreatedFiles ?? [])

		const missingExpected = expectedChangedFiles.filter((file) => !changedFiles.includes(file))
		if (missingExpected.length > 0) {
			failures.push({
				code: "missing_expected_change",
				message: `Expected files did not change: ${missingExpected.join(", ")}`,
				files: missingExpected,
			})
		}

		const forbiddenChanged = intersect(changedFiles, forbiddenChangedFiles)
		if (forbiddenChanged.length > 0) {
			failures.push({
				code: "forbidden_file_changed",
				message: `Forbidden files changed: ${forbiddenChanged.join(", ")}`,
				files: forbiddenChanged,
			})
		}

		const missingCreated = requiredCreatedFiles.filter((file) => !createdFiles.includes(file))
		if (missingCreated.length > 0) {
			failures.push({
				code: "required_created_file_missing",
				message: `Required created files were missing: ${missingCreated.join(", ")}`,
				files: missingCreated,
			})
		}

		for (const expectation of acceptance.requiredContentSnippets ?? []) {
			const content = postRunFileContents[expectation.path]
			if (typeof content !== "string" || !content.includes(expectation.snippet)) {
				failures.push({
					code: "required_snippet_missing",
					message: `Required snippet was missing from ${expectation.path}.`,
					files: [expectation.path],
				})
			}
		}

		for (const expectation of acceptance.forbiddenContentSnippets ?? []) {
			const content = postRunFileContents[expectation.path]
			if (typeof content === "string" && content.includes(expectation.snippet)) {
				failures.push({
					code: "forbidden_snippet_present",
					message: `Forbidden snippet was present in ${expectation.path}.`,
					files: [expectation.path],
				})
			}
		}
	}

	if (!scope && !acceptance) {
		warnings.push("No explicit scope or acceptance expectations were applied.")
	}

	return {
		passed: failures.length === 0,
		failedChecks: failures,
		warnings,
		evidenceSummary: {
			changedFiles,
			createdFiles,
			scopedFiles: uniqueSortedFiles(scope?.allowedFiles ?? []),
			requiredTargetFiles: uniqueSortedFiles(scope?.requiredTargetFiles ?? []),
		},
	}
}
