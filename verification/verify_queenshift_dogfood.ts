import fs from "node:fs"
import path from "node:path"

import { formatQueenshiftCommand, formatQueenshiftWorkspaceCommand } from "../src/cli/CommandSurface"
import { formatOwnerGuidedDemoResult, type OwnerGuidedDemoResult } from "../src/owner/OwnerGuidedDemo"
import { formatRepoOnboardResult, runRepoOnboard } from "../src/owner/RepoOnboard"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenshiftDogfoodHarnessResult = {
	packageScriptPresent: boolean
	repoOnboardRunbookUsesQueenshift: boolean
	canonicalOwnerDocsUseQueenshift: boolean
	failureNarrativeUsesQueenshift: boolean
	supportIntakeUsesQueenshift: boolean
	strangerStudyUsesQueenshift: boolean
	guidedDemoFailureSurfaceUsesDoctor: boolean
	productReadinessRecordsDogfoodState: boolean
	verificationCatalogRecordsDogfoodProof: boolean
	architectureDecisionRecorded: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function readText(rootDir: string, relativePath: string): string {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8")
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

function excludesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => !text.includes(snippet))
}

function extractSection(text: string, heading: string): string {
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const match = new RegExp(`^## ${escapedHeading}\\b.*$`, "m").exec(text)
	if (!match || typeof match.index !== "number") return ""

	const sectionStart = match.index
	const afterHeading = text.slice(sectionStart)
	const remainder = afterHeading.slice(match[0].length)
	const nextHeadingIndex = remainder.search(/\n##\s/u)
	if (nextHeadingIndex === -1) return afterHeading.trimEnd()
	return afterHeading.slice(0, match[0].length + nextHeadingIndex).trimEnd()
}

function buildGuidedDemoFailureFixture(workspace: string): OwnerGuidedDemoResult {
	return {
		passed: false,
		failingStep: "provider_defaults",
		workspace,
		task: "add a brief comment to hello.ts",
		provider: "gemini",
		authMode: "cli",
		model: "gemini-2.5-flash",
		timeoutMs: 420000,
		profileId: "canonical-guided-demo",
		manifestPath: path.join("owner_profiles", "canonical-guided-demo.profile.json"),
		manifestHash: "fixture-manifest-hash",
		displayCommand: formatQueenshiftCommand(["owner:guided:demo"]),
		summaryPath: null,
		incidentPackPath: null,
		status: "failed",
		stopReason: "provider_not_ready",
		reviewerVerdict: "missing",
		acceptancePassed: false,
		creditEligible: false,
		creditReason: "non-credit fixture",
		nextAction: `Run ${formatQueenshiftCommand(["doctor"])}, sign in to Gemini CLI once if needed, and retry ${formatQueenshiftCommand(["owner:guided:demo"])}.`,
		nextActionRationale: "The frozen launcher profile uses one known-good provider path only.",
		error: "fixture provider not ready",
		rawOutput: "",
	}
}

export async function runQueenshiftDogfoodHarness(rootDir = resolveRootDir()): Promise<QueenshiftDogfoodHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const readmeText = readText(rootDir, "Readme.md")
	const quickstartText = readText(rootDir, "QUICKSTART.md")
	const oversightText = readText(rootDir, "OWNER_OVERSIGHT_GUIDE.md")
	const releaseNotesText = readText(rootDir, "RC1_RELEASE_NOTES.md")
	const supportIntakeText = readText(rootDir, "SUPPORT_ISSUE_INTAKE.md")
	const strangerStudyText = readText(rootDir, "STRANGER_FIRST_RUN_STUDY.md")
	const readinessText = readText(rootDir, "QUEENSHIFT_PRODUCT_READINESS_STACK.md")
	const verificationText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")

	const readmeSection = extractSection(readmeText, "Canonical Owner Path")
	const quickstartSection = extractSection(quickstartText, "Canonical Owner Path")
	const oversightSection = extractSection(oversightText, "Canonical Owner Path")
	const releaseNotesSection = extractSection(releaseNotesText, "Canonical Owner Path")
	const tempRepo = await createTempTestRepoCopy(rootDir, "queenshift-dogfood")

	try {
		const repoOnboard = await runRepoOnboard(tempRepo.repoPath)
		const repoOnboardText = formatRepoOnboardResult(repoOnboard)
		const guidedDemoFailureText = formatOwnerGuidedDemoResult(buildGuidedDemoFailureFixture(tempRepo.repoPath))

		const packageScriptPresent =
			packageJson.scripts?.["verify:queenshift:dogfood"] ===
			"npm run build && node dist/verification/verify_queenshift_dogfood.js"
		const repoOnboardRunbookUsesQueenshift =
			includesAll(repoOnboardText, [
				formatQueenshiftCommand(["demo:gallery"]),
				formatQueenshiftCommand(["owner:guided:demo"]),
				formatQueenshiftWorkspaceCommand(["repo:onboard", "--scaffoldProfile"], tempRepo.repoPath),
				formatQueenshiftWorkspaceCommand(["repo:onboard", "--scaffoldKnowledgePack"], tempRepo.repoPath),
			]) && !repoOnboardText.includes("npm.cmd run owner:guided:demo")

		const canonicalSections = [readmeSection, quickstartSection, oversightSection, releaseNotesSection]
		const canonicalOwnerDocsUseQueenshift =
			canonicalSections.every((section) =>
				includesAll(section, [
					"npm.cmd exec -- queenshift owner:guided:demo",
					"npm.cmd exec -- queenshift repo:onboard --workspace <repo>",
					"npm.cmd exec -- queenshift owner:quick-actions --workspace <repo>",
					"npm.cmd exec -- queenshift owner:life-signal --workspace <repo>",
				]),
			) &&
			includesAll(readmeSection, [
				"npm.cmd exec -- queenshift --task \"<task>\" --workspace <repo> --admitOnly",
				"npm.cmd exec -- queenshift review:list --workspace <repo>",
				"npm.cmd exec -- queenshift incident:latest --workspace <repo>",
				"npm.cmd exec -- queenshift replay:latest --workspace <repo>",
			]) &&
			includesAll(quickstartSection, [
				"npm.cmd exec -- queenshift --task \"<task>\" --workspace <repo> --admitOnly",
				"npm.cmd exec -- queenshift review:list --workspace <repo>",
				"npm.cmd exec -- queenshift incident:latest --workspace <repo>",
				"npm.cmd exec -- queenshift replay:latest --workspace <repo>",
			]) &&
			includesAll(oversightSection, [
				"npm.cmd exec -- queenshift --task \"<task>\" --workspace <repo> --admitOnly",
				"npm.cmd exec -- queenshift doctor",
				"npm.cmd exec -- queenshift review:list --workspace <repo>",
				"npm.cmd exec -- queenshift incident:latest --workspace <repo>",
				"npm.cmd exec -- queenshift replay:latest --workspace <repo>",
			]) &&
			excludesAll(readmeSection, ["node dist/swarm.js"]) &&
			excludesAll(quickstartSection, ["node dist/swarm.js"]) &&
			excludesAll(oversightSection, ["node dist/swarm.js"]) &&
			excludesAll(releaseNotesSection, ["node dist/swarm.js"])

		const failureNarrativeUsesQueenshift = canonicalSections.every((section) =>
			includesAll(section, [
				"npm.cmd exec -- queenshift incident:latest --workspace <repo>",
				"npm.cmd exec -- queenshift resume:latest --workspace <repo>",
				"Failure narrative:",
			]),
		)
		const supportIntakeUsesQueenshift = includesAll(supportIntakeText, [
			"npm.cmd exec -- queenshift incident:latest --workspace <repo>",
			"npm.cmd exec -- queenshift replay:latest --workspace <repo>",
			"npm.cmd exec -- queenshift owner:quick-actions --workspace <repo>",
			"npm.cmd exec -- queenshift resume:latest --workspace <repo>",
		])
		const strangerStudyUsesQueenshift = includesAll(strangerStudyText, [
			"`npm.cmd exec -- queenshift repo:onboard --workspace <repo>`",
			"`npm.cmd exec -- queenshift demo:gallery`",
			"`npm.cmd exec -- queenshift owner:guided:demo`",
		])
		const guidedDemoFailureSurfaceUsesDoctor = includesAll(guidedDemoFailureText, [
			"Provider diagnose: queenshift doctor",
			"Next action: Run queenshift doctor, sign in to Gemini CLI once if needed, and retry queenshift owner:guided:demo.",
		])
		const productReadinessRecordsDogfoodState = includesAll(readinessText, [
			"one truthful owner/noncoder run path now exists",
			"thin-shell parity and the final readiness gate",
			"dogfood path are now proof-backed enough",
		])
		const verificationCatalogRecordsDogfoodProof = includesAll(verificationText, [
			"`npm.cmd run verify:queenshift:dogfood`",
			"owner/noncoder dogfood loop now stays on one truthful `queenshift` command story",
		])
		const architectureDecisionRecorded = includesAll(architectureText, [
			"## Decision: Session 248 hardens one truthful owner/noncoder run path around the Queenshift surface",
			"use `queenshift` for onboarding, admit-only preflight, guided demo, review and incident follow-up, replay, and support intake guidance",
			"dogfood verifier",
		])

		details.push(
			`repoOnboardHasQueenshift=${repoOnboardText.includes("queenshift repo:onboard") ? "yes" : "no"}`,
			`guidedDemoHasDoctor=${guidedDemoFailureText.includes("Provider diagnose: queenshift doctor") ? "yes" : "no"}`,
			`canonicalDocsHaveQueenshift=${readmeSection.includes("npm.cmd exec -- queenshift") ? "yes" : "no"}`,
		)

		return {
			packageScriptPresent,
			repoOnboardRunbookUsesQueenshift,
			canonicalOwnerDocsUseQueenshift,
			failureNarrativeUsesQueenshift,
			supportIntakeUsesQueenshift,
			strangerStudyUsesQueenshift,
			guidedDemoFailureSurfaceUsesDoctor,
			productReadinessRecordsDogfoodState,
			verificationCatalogRecordsDogfoodProof,
			architectureDecisionRecorded,
			details,
		}
	} finally {
		tempRepo.cleanup()
	}
}

export function formatQueenshiftDogfoodHarnessResult(result: QueenshiftDogfoodHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Repo onboard runbook uses Queenshift: ${result.repoOnboardRunbookUsesQueenshift ? "PASS" : "FAIL"}`,
		`Canonical owner docs use Queenshift: ${result.canonicalOwnerDocsUseQueenshift ? "PASS" : "FAIL"}`,
		`Failure narrative uses Queenshift: ${result.failureNarrativeUsesQueenshift ? "PASS" : "FAIL"}`,
		`Support intake uses Queenshift: ${result.supportIntakeUsesQueenshift ? "PASS" : "FAIL"}`,
		`Stranger study uses Queenshift: ${result.strangerStudyUsesQueenshift ? "PASS" : "FAIL"}`,
		`Guided demo failure surface uses doctor: ${result.guidedDemoFailureSurfaceUsesDoctor ? "PASS" : "FAIL"}`,
		`Product readiness records dogfood state: ${result.productReadinessRecordsDogfoodState ? "PASS" : "FAIL"}`,
		`Verification catalog records dogfood proof: ${result.verificationCatalogRecordsDogfoodProof ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenshiftDogfoodHarness()
	console.log(formatQueenshiftDogfoodHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.repoOnboardRunbookUsesQueenshift &&
			result.canonicalOwnerDocsUseQueenshift &&
			result.failureNarrativeUsesQueenshift &&
			result.supportIntakeUsesQueenshift &&
			result.strangerStudyUsesQueenshift &&
			result.guidedDemoFailureSurfaceUsesDoctor &&
			result.productReadinessRecordsDogfoodState &&
			result.verificationCatalogRecordsDogfoodProof &&
			result.architectureDecisionRecorded
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenshift:dogfood] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
