import fs from "node:fs"
import path from "node:path"

import { formatRepoOnboardResult, runRepoOnboard } from "../src/owner/RepoOnboard"
import { createTempTestRepoCopy, runVerificationGit } from "./test_workspace_baseline"

export type OwnerOnboardingHarnessResult = {
	readyRepoSummary: boolean
	missingProfileGuidance: boolean
	missingKnowledgePackGuidance: boolean
	refusedRepoSummary: boolean
	scaffoldProfileWorks: boolean
	scaffoldKnowledgePackWorks: boolean
	discoveryPackVisible: boolean
	firstRunStudySurfaced: boolean
	pilotBatchVisible: boolean
	contributorProofLoopVisible: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

async function createTempRepoCopy(rootDir: string, label: string): Promise<{ repoPath: string; cleanup: () => void }> {
	const repo = await createTempTestRepoCopy(rootDir, `owner-onboard-${label}`)
	const profilePath = path.join(repo.repoPath, ".swarmcoder.json")
	if (fs.existsSync(profilePath)) fs.rmSync(profilePath, { force: true })
	return repo
}

export async function runOwnerOnboardingHarness(rootDir = resolveRootDir()): Promise<OwnerOnboardingHarnessResult> {
	const readyRepo = await createTempRepoCopy(rootDir, "ready")
	const dirtyRepo = await createTempRepoCopy(rootDir, "dirty")
	const profileRepo = await createTempRepoCopy(rootDir, "profile")
	const knowledgeRepo = await createTempRepoCopy(rootDir, "knowledge")
	const details: string[] = []

	try {
		fs.appendFileSync(path.join(dirtyRepo.repoPath, "DIRTY_ONBOARDING.txt"), "dirty\n", "utf8")
		fs.writeFileSync(path.join(knowledgeRepo.repoPath, "README.md"), "# Knowledge Fixture\n", "utf8")
		await runVerificationGit(knowledgeRepo.repoPath, ["add", "README.md"])
		await runVerificationGit(knowledgeRepo.repoPath, ["commit", "-m", "add knowledge fixture readme"])

		const ready = await runRepoOnboard(readyRepo.repoPath)
		const readyText = formatRepoOnboardResult(ready)
		const readyRepoSummary =
			ready.readiness.decision !== "refuse" &&
			readyText.includes("Recommended next steps:") &&
			readyText.includes("Suggested first tasks:")
		const missingProfileGuidance =
			ready.profileStatus === "missing" &&
			readyText.includes("Profile: missing") &&
			readyText.includes("--scaffoldProfile")
		const missingKnowledgePackGuidance =
			ready.knowledgePackStatus === "missing" &&
			readyText.includes("Knowledge pack: missing") &&
			readyText.includes("--scaffoldKnowledgePack")
		const discoveryPackVisible =
			ready.discoveryPackSource === "repo_map_fallback" &&
			readyText.includes("Discovery pack: mode=progressive_bounded source=repo_map_fallback") &&
			readyText.includes("Discovery stages:")
		const firstRunStudySurfaced =
			readyText.includes("First-run study guide: STRANGER_FIRST_RUN_STUDY.md") &&
			readyText.includes("Friction log template: STRANGER_FIRST_RUN_FRICTION_LOG_TEMPLATE.md")
		const pilotBatchVisible =
			readyText.includes("Pilot batch guide: STRANGER_USE_PILOT_BATCH.md") &&
			readyText.includes("STRANGER_USE_PILOT_BATCH.md")
		const contributorProofLoopVisible =
			readyText.includes("CONTRIBUTOR_SOURCE_CHECKOUT.md") &&
			readyText.includes("CONTRIBUTING.md") &&
			readyText.includes("npm.cmd run verify:pr") &&
			readyText.includes("npm.cmd run verify:profiles")

		const refused = await runRepoOnboard(dirtyRepo.repoPath)
		const refusedText = formatRepoOnboardResult(refused)
		const refusedRepoSummary =
			refused.readiness.decision === "refuse" &&
			refusedText.includes("dirty") &&
			refusedText.includes("Fix the readiness blockers above")

		const scaffolded = await runRepoOnboard(profileRepo.repoPath, { scaffoldProfile: true })
		const scaffoldProfileWorks =
			scaffolded.scaffoldedProfile === true &&
			Boolean(scaffolded.scaffoldPath) &&
			fs.existsSync(scaffolded.scaffoldPath ?? "")
		const knowledgeScaffolded = await runRepoOnboard(knowledgeRepo.repoPath, { scaffoldKnowledgePack: true })
		const scaffoldKnowledgePackWorks =
			knowledgeScaffolded.scaffoldedKnowledgePack === true &&
			Boolean(knowledgeScaffolded.knowledgePackScaffoldPath) &&
			fs.existsSync(knowledgeScaffolded.knowledgePackScaffoldPath ?? "") &&
			knowledgeScaffolded.discoveryPackSource === "knowledge_pack"

		details.push(
			`ready=${ready.readiness.decision}`,
			`profile=${ready.profileStatus}`,
			`knowledgePack=${ready.knowledgePackStatus}`,
			`refused=${refused.readiness.decision}`,
			`scaffolded=${scaffolded.scaffoldedProfile ? "yes" : "no"}`,
			`knowledgeScaffolded=${knowledgeScaffolded.scaffoldedKnowledgePack ? "yes" : "no"}`,
		)

		return {
			readyRepoSummary,
			missingProfileGuidance,
			missingKnowledgePackGuidance,
			refusedRepoSummary,
			scaffoldProfileWorks,
			scaffoldKnowledgePackWorks,
			discoveryPackVisible,
			firstRunStudySurfaced,
			pilotBatchVisible,
			contributorProofLoopVisible,
			details,
		}
	} finally {
		readyRepo.cleanup()
		dirtyRepo.cleanup()
		profileRepo.cleanup()
		knowledgeRepo.cleanup()
	}
}

export function formatOwnerOnboardingHarnessResult(result: OwnerOnboardingHarnessResult): string {
	return [
		`Ready repo summary: ${result.readyRepoSummary ? "PASS" : "FAIL"}`,
		`Missing profile guidance: ${result.missingProfileGuidance ? "PASS" : "FAIL"}`,
		`Missing knowledge-pack guidance: ${result.missingKnowledgePackGuidance ? "PASS" : "FAIL"}`,
		`Refused repo summary: ${result.refusedRepoSummary ? "PASS" : "FAIL"}`,
		`Scaffold profile works: ${result.scaffoldProfileWorks ? "PASS" : "FAIL"}`,
		`Scaffold knowledge pack works: ${result.scaffoldKnowledgePackWorks ? "PASS" : "FAIL"}`,
		`Discovery pack visible: ${result.discoveryPackVisible ? "PASS" : "FAIL"}`,
		`First-run study surfaced: ${result.firstRunStudySurfaced ? "PASS" : "FAIL"}`,
		`Pilot batch surfaced: ${result.pilotBatchVisible ? "PASS" : "FAIL"}`,
		`Contributor proof loop visible: ${result.contributorProofLoopVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runOwnerOnboardingHarness()
	console.log(formatOwnerOnboardingHarnessResult(result))
	process.exit(
		result.readyRepoSummary &&
			result.missingProfileGuidance &&
			result.missingKnowledgePackGuidance &&
			result.refusedRepoSummary &&
			result.scaffoldProfileWorks &&
			result.scaffoldKnowledgePackWorks &&
			result.discoveryPackVisible &&
			result.firstRunStudySurfaced &&
			result.pilotBatchVisible &&
			result.contributorProofLoopVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:owner:onboarding] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
