import path from "node:path"

import type { AcceptanceGateResult } from "../run/AcceptanceGate"
import type { VerificationProfileResult } from "../run/VerificationProfile"
import type { TaskContract } from "../run/TaskContract"
import type { RepoMapArtifact, RepoMapLanguagePackId } from "./RepoMap"
import type { SwarmPlanArtifact } from "./PlanSchema"

export type TargetedEvaluatorId =
	| "rename_symbol_consistency"
	| "cross_language_sync"
	| "verification_coverage"

export type TargetedEvaluatorStatus = "not_applicable" | "passed" | "concern"

export type TargetedEvaluatorFinding = {
	category: "rename_consistency" | "cross_language_scope" | "verification_coverage"
	evidence: string
	recommendedAction: string
}

export type TargetedEvaluatorResult = {
	evaluatorId: TargetedEvaluatorId
	label: string
	applicable: boolean
	status: TargetedEvaluatorStatus
	summary: string
	findings: TargetedEvaluatorFinding[]
}

export type TargetedEvaluatorsArtifact = {
	schemaVersion: 1
	enabled: boolean
	status: TargetedEvaluatorStatus
	applicableEvaluatorCount: number
	concernCount: number
	summary: string
	evaluators: TargetedEvaluatorResult[]
}

type LanguageSurface = RepoMapLanguagePackId | "docs_markdown" | "json_config" | "other"

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)))
}

function allCoveredFiles(input: {
	plan: SwarmPlanArtifact | null
	taskContract?: TaskContract | null
	changedFiles?: string[]
}): string[] {
	return uniqueStrings([
		...(input.plan?.scoutCoverage.coveredFiles ?? []),
		...(input.taskContract?.scope?.allowedFiles ?? []),
		...(input.changedFiles ?? []),
	])
}

function classifyLanguageSurface(filePath: string): LanguageSurface {
	const extension = path.posix.extname(filePath).toLowerCase()
	if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"].includes(extension)) return "javascript_typescript"
	if (extension === ".py") return "python"
	if (extension === ".go") return "go"
	if (extension === ".rs") return "rust"
	if (extension === ".md" || extension === ".mdx") return "docs_markdown"
	if (extension === ".json" || extension === ".jsonc" || extension === ".yaml" || extension === ".yml") return "json_config"
	return "other"
}

function describeSurface(surface: LanguageSurface): string {
	switch (surface) {
		case "javascript_typescript":
			return "JavaScript/TypeScript"
		case "python":
			return "Python"
		case "go":
			return "Go"
		case "rust":
			return "Rust"
		case "docs_markdown":
			return "Markdown/docs"
		case "json_config":
			return "JSON/config"
		default:
			return "other"
	}
}

function formatVerificationResult(result: VerificationProfileResult | null | undefined): string {
	if (!result) return "No verification profile result was recorded."
	if (result.message?.trim()) return result.message.trim()
	if (result.profileName?.trim()) return `${result.profileName} -> ${result.status}`
	return `Verification status: ${result.status}`
}

function buildRenameEvaluator(input: {
	plan: SwarmPlanArtifact | null
	acceptanceGate?: AcceptanceGateResult | null
	changedFiles?: string[]
}): TargetedEvaluatorResult {
	const refactorIntent = input.plan?.refactorIntent ?? null
	if (!refactorIntent) {
		return {
			evaluatorId: "rename_symbol_consistency",
			label: "Rename symbol consistency",
			applicable: false,
			status: "not_applicable",
			summary: "Rename-specific evaluator is not applicable for this run.",
			findings: [],
		}
	}

	const findings: TargetedEvaluatorFinding[] = []
	const changedFiles = uniqueStrings(input.changedFiles ?? [])

	if (refactorIntent.anchorSymbolPresent === false) {
		findings.push({
			category: "rename_consistency",
			evidence: `Rename ${refactorIntent.sourceSymbol} -> ${refactorIntent.targetSymbol} could not confirm the anchor symbol in ${refactorIntent.anchorFile ?? "the anchor file"}.`,
			recommendedAction: "Keep the rename bounded and verify the anchor before treating downstream edits as trustworthy.",
		})
	}

	if (changedFiles.length === 0) {
		findings.push({
			category: "rename_consistency",
			evidence: `Rename ${refactorIntent.sourceSymbol} -> ${refactorIntent.targetSymbol} has no changed-file evidence yet for scope ${refactorIntent.relatedFiles.join(", ") || "(none)"}.`,
			recommendedAction: "Preserve review bias until changed files show the anchor and bounded related call sites.",
		})
	} else {
		const missingRelatedFiles = refactorIntent.relatedFiles.filter((file) => !changedFiles.includes(file))
		if (missingRelatedFiles.length > 0) {
			findings.push({
				category: "rename_consistency",
				evidence: `Rename ${refactorIntent.sourceSymbol} -> ${refactorIntent.targetSymbol} covered ${refactorIntent.relatedFiles.join(", ")}, but changed files were ${changedFiles.join(", ")} and missed ${missingRelatedFiles.join(", ")}.`,
				recommendedAction: "Confirm whether the remaining related files should stay unchanged or whether another bounded rename attempt is needed.",
			})
		}
	}

	if (input.acceptanceGate && !input.acceptanceGate.passed) {
		findings.push({
			category: "rename_consistency",
			evidence: `Acceptance gate did not pass for the rename lane (${input.acceptanceGate.failedChecks.map((check) => check.message).join(" ") || "no details"}).`,
			recommendedAction: "Keep rename evidence explicit in the artifact trail and do not treat the rename as complete yet.",
		})
	}

	return {
		evaluatorId: "rename_symbol_consistency",
		label: "Rename symbol consistency",
		applicable: true,
		status: findings.length > 0 ? "concern" : "passed",
		summary:
			findings.length > 0
				? `Rename evaluator recorded ${findings.length} concern(s).`
				: "Rename evaluator confirmed bounded rename evidence with no specialist concerns.",
		findings,
	}
}

function buildCrossLanguageEvaluator(input: {
	plan: SwarmPlanArtifact | null
	taskContract?: TaskContract | null
	changedFiles?: string[]
	acceptanceGate?: AcceptanceGateResult | null
}): TargetedEvaluatorResult {
	const scopeFiles = allCoveredFiles(input)
	const scopeSurfaces = uniqueStrings(scopeFiles.map((file) => classifyLanguageSurface(file)))
	const meaningfulSurfaces = scopeSurfaces.filter((surface) => surface !== "other")

	if (meaningfulSurfaces.length < 2) {
		return {
			evaluatorId: "cross_language_sync",
			label: "Cross-language sync",
			applicable: false,
			status: "not_applicable",
			summary: "Cross-language evaluator is not applicable for this bounded run.",
			findings: [],
		}
	}

	const findings: TargetedEvaluatorFinding[] = []
	const changedFiles = uniqueStrings(input.changedFiles ?? [])
	const changedSurfaces = uniqueStrings(changedFiles.map((file) => classifyLanguageSurface(file))).filter((surface) => surface !== "other")
	const missingSurfaces = meaningfulSurfaces.filter((surface) => !changedSurfaces.includes(surface))

	if (changedFiles.length === 0) {
		findings.push({
			category: "cross_language_scope",
			evidence: `Targeted surfaces span ${meaningfulSurfaces.map((surface) => describeSurface(surface as LanguageSurface)).join(", ")}, but no changed-file evidence was recorded yet.`,
			recommendedAction: "Keep the run review-biased until code, docs, or helper surfaces show concrete bounded changes.",
		})
	} else if (missingSurfaces.length > 0) {
		findings.push({
			category: "cross_language_scope",
			evidence: `Scoped surfaces expected ${meaningfulSurfaces.map((surface) => describeSurface(surface as LanguageSurface)).join(", ")}, but changed files only covered ${changedSurfaces.map((surface) => describeSurface(surface as LanguageSurface)).join(", ") || "(none)"}.`,
			recommendedAction: "Recheck whether every named surface should remain in scope before treating the cross-language task as aligned.",
		})
	}

	if (input.acceptanceGate && !input.acceptanceGate.passed) {
		findings.push({
			category: "cross_language_scope",
			evidence: `Acceptance evidence for the cross-language lane did not pass (${input.acceptanceGate.failedChecks.map((check) => check.message).join(" ") || "no details"}).`,
			recommendedAction: "Keep the artifact trail explicit across the named surfaces before accepting the mixed-language change.",
		})
	}

	return {
		evaluatorId: "cross_language_sync",
		label: "Cross-language sync",
		applicable: true,
		status: findings.length > 0 ? "concern" : "passed",
		summary:
			findings.length > 0
				? `Cross-language evaluator recorded ${findings.length} concern(s).`
				: "Cross-language evaluator confirmed the named surfaces stayed aligned.",
		findings,
	}
}

function buildVerificationCoverageEvaluator(input: {
	plan: SwarmPlanArtifact | null
	repoMap?: RepoMapArtifact | null
	taskContract?: TaskContract | null
	verificationProfile?: VerificationProfileResult | null
	changedFiles?: string[]
}): TargetedEvaluatorResult {
	const scopeFiles = allCoveredFiles(input)
	const codeSurfaces = uniqueStrings(scopeFiles.map((file) => classifyLanguageSurface(file))).filter(
		(surface) => surface === "javascript_typescript" || surface === "python",
	)
	const harderTask =
		(input.plan?.pathChosen === "medium") ||
		((input.plan?.workItems.length ?? 0) > 1) ||
		scopeFiles.length > 1 ||
		Boolean(input.plan?.refactorIntent)

	if (codeSurfaces.length === 0 || !harderTask) {
		return {
			evaluatorId: "verification_coverage",
			label: "Verification coverage",
			applicable: false,
			status: "not_applicable",
			summary: "Verification-coverage evaluator is not applicable for this run.",
			findings: [],
		}
	}

	const findings: TargetedEvaluatorFinding[] = []
	const verificationProfile = input.verificationProfile ?? null
	const codeSurfaceSet = new Set<string>(codeSurfaces)
	const recommendedLanes = (input.repoMap?.languagePacks ?? [])
		.filter((pack) => codeSurfaceSet.has(pack.id))
		.flatMap((pack) => pack.verificationLanes ?? [])
		.map((lane) => lane.profileClass)
	if (!verificationProfile || verificationProfile.status === "not_applicable") {
		findings.push({
			category: "verification_coverage",
			evidence:
				recommendedLanes.length > 0
					? `Code-changing surfaces ${codeSurfaces.map((surface) => describeSurface(surface as LanguageSurface)).join(", ")} had no passed verification result even though repo hints recommended ${recommendedLanes.join(", ")}.`
					: `Code-changing surfaces ${codeSurfaces.map((surface) => describeSurface(surface as LanguageSurface)).join(", ")} had no recorded verification result.`,
			recommendedAction: "Prefer a repo-backed verification lane before treating the bounded change as deeply proven.",
		})
	} else if (verificationProfile.status !== "passed") {
		findings.push({
			category: "verification_coverage",
			evidence: formatVerificationResult(verificationProfile),
			recommendedAction: "Keep the failed verification result visible and let retry planning decide whether another bounded attempt is safe.",
		})
	}

	return {
		evaluatorId: "verification_coverage",
		label: "Verification coverage",
		applicable: true,
		status: findings.length > 0 ? "concern" : "passed",
		summary:
			findings.length > 0
				? `Verification-coverage evaluator recorded ${findings.length} concern(s).`
				: "Verification-coverage evaluator confirmed the active code surfaces have a passing proof lane.",
		findings,
	}
}

export function buildTargetedEvaluatorsArtifact(input: {
	plan: SwarmPlanArtifact | null
	repoMap?: RepoMapArtifact | null
	taskContract?: TaskContract | null
	acceptanceGate?: AcceptanceGateResult | null
	verificationProfile?: VerificationProfileResult | null
	changedFiles?: string[]
}): TargetedEvaluatorsArtifact {
	const evaluators = [
		buildRenameEvaluator({
			plan: input.plan,
			acceptanceGate: input.acceptanceGate ?? null,
			changedFiles: input.changedFiles ?? [],
		}),
		buildCrossLanguageEvaluator({
			plan: input.plan,
			taskContract: input.taskContract ?? null,
			changedFiles: input.changedFiles ?? [],
			acceptanceGate: input.acceptanceGate ?? null,
		}),
		buildVerificationCoverageEvaluator({
			plan: input.plan,
			repoMap: input.repoMap ?? null,
			taskContract: input.taskContract ?? null,
			verificationProfile: input.verificationProfile ?? null,
			changedFiles: input.changedFiles ?? [],
		}),
	]

	const applicableEvaluatorCount = evaluators.filter((evaluator) => evaluator.applicable).length
	const concernCount = evaluators.reduce(
		(sum, evaluator) => sum + (evaluator.status === "concern" ? evaluator.findings.length : 0),
		0,
	)
	const status: TargetedEvaluatorStatus =
		applicableEvaluatorCount === 0 ? "not_applicable" : concernCount > 0 ? "concern" : "passed"

	return {
		schemaVersion: 1,
		enabled: applicableEvaluatorCount > 0,
		status,
		applicableEvaluatorCount,
		concernCount,
		summary:
			status === "not_applicable"
				? "No targeted evaluators were required for this bounded run."
				: concernCount > 0
					? `${applicableEvaluatorCount} targeted evaluator(s) ran and recorded ${concernCount} specialist concern(s).`
					: `${applicableEvaluatorCount} targeted evaluator(s) ran with no specialist concerns.`,
		evaluators,
	}
}

export function formatTargetedEvaluatorsArtifact(artifact: TargetedEvaluatorsArtifact): string {
	return [
		`Enabled: ${artifact.enabled ? "yes" : "no"}`,
		`Status: ${artifact.status}`,
		`Applicable evaluators: ${artifact.applicableEvaluatorCount}`,
		`Concern count: ${artifact.concernCount}`,
		`Summary: ${artifact.summary}`,
		...(artifact.evaluators.length > 0
			? artifact.evaluators.flatMap((evaluator) => [
					`- ${evaluator.label}: ${evaluator.status}`,
					`  Summary: ${evaluator.summary}`,
					...(evaluator.findings.length > 0
						? evaluator.findings.map((finding) => `  Finding: ${finding.category} -> ${finding.evidence}`)
						: []),
			  ])
			: ["- (none)"]),
	].join("\n")
}
