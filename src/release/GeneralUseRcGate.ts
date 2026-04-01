import fs from "node:fs"
import path from "node:path"

import { evaluateRecordedProofGate, type RecordedProofGateDefinition } from "./Rc1Gate"

export type GeneralUseRcGateDecision = "GO" | "HOLD" | "NO_GO"

export type GeneralUseRcGateCheck = {
	label: string
	passed: boolean
	details: string[]
}

export type GeneralUseRcGateResult = {
	statusPasses: boolean
	currentDecision: GeneralUseRcGateDecision
	summary: string
	checks: GeneralUseRcGateCheck[]
	blockers: string[]
}

const RECORDED_PROOF_GATES: RecordedProofGateDefinition[] = [
	{
		key: "bundle_experience",
		label: "Bundle experience proof",
		proofLabel: "Current bundle-experience verification",
		maxAgeDays: 7,
	},
	{
		key: "owner_surface",
		label: "Owner surface proof",
		proofLabel: "Current owner surface verification",
		maxAgeDays: 7,
	},
	{
		key: "fuller_v2",
		label: "Fuller V2 release proof",
		proofLabel: "Current fuller V2 release gate",
		maxAgeDays: 7,
	},
	{
		key: "beta_live",
		label: "Live beta proof",
		proofLabel: "Current beta verification",
		maxAgeDays: 7,
	},
]

function readText(rootDir: string, relativePath: string): string {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8")
}

function hasAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

function hasAny(text: string, snippets: string[]): boolean {
	return snippets.some((snippet) => text.includes(snippet))
}

function evaluateRecordedProofChecks(rootDir: string, now: Date): GeneralUseRcGateCheck[] {
	const readmeText = readText(rootDir, "Readme.md")
	return RECORDED_PROOF_GATES.map((definition) => {
		const result = evaluateRecordedProofGate(readmeText, definition, now)
		return {
			label: definition.label,
			passed: result.status === "PASS",
			details: result.details,
		}
	})
}

export function evaluateGeneralUseRcGate(rootDir: string, now = new Date()): GeneralUseRcGateResult {
	const adapterDocs = readText(rootDir, "ADAPTER_ECOSYSTEM_CANDIDATE.md")
	const betaDocs = readText(rootDir, "LARGE_REPO_BETA_MATRIX_V2.md")
	const benchmarkReport = readText(rootDir, "COMPARATIVE_BENCHMARK_REPORT.md")
	const gateDocs = readText(rootDir, "GENERAL_USE_RELEASE_CANDIDATE_GATE.md")
	const decisionDocs = readText(rootDir, "GENERAL_USE_READINESS_DECISION.md")
	const installDocs = readText(rootDir, "SUPPORTED_INSTALL_SURFACES.md")
	const languageDocs = readText(rootDir, "LANGUAGE_RELIABILITY_MATRIX.md")
	const supportDocs = readText(rootDir, "SUPPORT_ISSUE_INTAKE.md")
	const repoTierDocs = readText(rootDir, "REPO_SUPPORT_TIERS.md")

	const recordedProofChecks = evaluateRecordedProofChecks(rootDir, now)
	const docsAlignedCheck: GeneralUseRcGateCheck = {
		label: "Candidate-band docs are explicit",
		passed:
			hasAll(adapterDocs, ["profiles:adapter-contracts", "named catalog", "verify:profiles", "verify:guardrails"]) &&
			hasAll(betaDocs, ["verify:live:beta", "forensics:beta:latest", "Large repo tier 2 candidate", "12 rows"]) &&
			hasAll(benchmarkReport, ["Roo Code", "Cline", "not_run", "No evidence-backed overall better/equal call yet"]) &&
			hasAll(gateDocs, ["verify:bundle:experience", "verify:live:beta", "verify:release:fuller-v2", "verify:release:general-use-rc"]) &&
			hasAll(decisionDocs, ["ADAPTER_ECOSYSTEM_CANDIDATE.md", "LARGE_REPO_BETA_MATRIX_V2.md", "COMPARATIVE_BENCHMARK_REPORT.md", "GENERAL_USE_RELEASE_CANDIDATE_GATE.md"]) &&
			hasAll(installDocs, ["local Windows RC1 bundle", "Contributor source-checkout candidate"]) &&
			hasAll(languageDocs, ["verify:profiles", "verify:live:beta"]) &&
			hasAll(supportDocs, ["owner:quick-actions", "incident-pack.json"]) &&
			hasAll(repoTierDocs, ["Large repo tier 2 candidate", "review bias"]),
		details: [
			"Adapter, large-repo beta, comparative benchmark, RC gate, install, language, support, and repo-tier docs must all stay shipped.",
		],
	}
	const decisionAlignmentCheck: GeneralUseRcGateCheck = {
		label: "Final decision docs stay aligned with the gate",
		passed:
			hasAll(gateDocs, ["Current gate answer"]) &&
			hasAny(gateDocs, ["`HOLD`", "`NO_GO`"]) &&
			hasAll(decisionDocs, ["## Current Decision", "`NO`", "Current public narrative"]),
		details: ["The release-candidate gate and final readiness decision must stay explicitly non-GO until the evidence changes."],
	}

	const blockers: string[] = []
	const failingRecordedProofs = recordedProofChecks.filter((check) => !check.passed).map((check) => check.label)
	if (failingRecordedProofs.length > 0) {
		blockers.push(`Required recorded proof is missing, stale, or red: ${failingRecordedProofs.join(", ")}.`)
	}
	if (benchmarkReport.includes("not_run") || benchmarkReport.includes("No evidence-backed overall better/equal call yet")) {
		blockers.push("Same-day cross-tool benchmark evidence is still incomplete because competitor rows remain not_run.")
	}
	if (installDocs.includes("local Windows RC1 bundle") && installDocs.includes("Broad cross-platform bundle parity claims")) {
		blockers.push("The verified stranger install surface is still the local Windows bundle only.")
	}
	if (repoTierDocs.includes("Large repo tier 2 candidate")) {
		blockers.push("Large-repo support remains a tier-2 review-biased candidate, not a broad default promise.")
	}
	if (adapterDocs.includes("candidate") || adapterDocs.includes("named catalog only")) {
		blockers.push("The adapter ecosystem is still a named-catalog candidate, not an open integration marketplace.")
	}

	const checks = [...recordedProofChecks, docsAlignedCheck, decisionAlignmentCheck]
	const statusPasses = checks.every((check) => check.passed)
	const currentDecision: GeneralUseRcGateDecision =
		!statusPasses ? "HOLD" : blockers.length === 0 ? "GO" : "NO_GO"
	const summary =
		currentDecision === "GO"
			? "General-use release-candidate gate is explicit and currently has no blockers."
			: currentDecision === "HOLD"
				? "General-use release-candidate gate is not trustworthy yet because one or more required proof surfaces are missing or stale."
				: "General-use release-candidate gate is explicit and truthfully says NO-GO."

	return {
		statusPasses,
		currentDecision,
		summary,
		checks,
		blockers,
	}
}

export function formatGeneralUseRcGateResult(result: GeneralUseRcGateResult): string {
	const lines = [
		"General-use release-candidate gate",
		`Status: ${result.statusPasses ? "PASS" : "FAIL"}`,
		`Current gate answer: ${result.currentDecision}`,
		result.summary,
		"Checks:",
		...result.checks.map((check) => `- ${check.label}: ${check.passed ? "PASS" : "FAIL"}`),
		...result.checks.flatMap((check) =>
			check.passed || check.details.length === 0 ? [] : check.details.map((detail) => `  detail: ${detail}`),
		),
	]

	if (result.blockers.length === 0) {
		lines.push("Blockers: none")
	} else {
		lines.push("Blockers:")
		lines.push(...result.blockers.map((blocker) => `- ${blocker}`))
	}

	return lines.join("\n")
}

function resolveRootDirFromCurrentFile(): string {
	const candidate = path.resolve(__dirname, "..", "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.resolve(candidate, "..")
}

async function main(): Promise<void> {
	const result = evaluateGeneralUseRcGate(resolveRootDirFromCurrentFile())
	console.log(formatGeneralUseRcGateResult(result))
	process.exit(result.statusPasses ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:release:general-use-rc] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
