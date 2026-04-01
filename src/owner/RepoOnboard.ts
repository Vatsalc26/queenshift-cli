import fs from "node:fs"
import path from "node:path"

import { formatQueenshiftCommand, formatQueenshiftWorkspaceCommand } from "../cli/CommandSurface"
import { evaluateRepoReadiness, type RepoReadinessResult } from "../run/AdmissionGate"
import { loadRepoVerificationProfile } from "../run/VerificationProfile"
import { buildVerificationProfileManifest, type SupportedVerificationProfileClass } from "../run/VerificationProfileCatalog"
import { buildRepoMapArtifact, type RepoMapArtifact } from "../planning/RepoMap"
import { type RepoDiscoveryPackSource } from "../planning/DiscoveryPack"
import {
	buildSuggestedKnowledgePackDocs,
	loadKnowledgePack,
	writeDefaultKnowledgePack,
} from "../planning/KnowledgePack"

export type RepoOnboardResult = {
	workspace: string
	readiness: RepoReadinessResult
	profileStatus: "present" | "missing" | "invalid"
	profilePath: string | null
	profileIssue: string | null
	suggestedTasks: string[]
	outOfBounds: string[]
	scaffoldedProfile: boolean
	scaffoldPath: string | null
	knowledgePackStatus: "present" | "missing" | "invalid"
	knowledgePackPath: string | null
	knowledgePackIssue: string | null
	knowledgePackSuggestedDocs: string[]
	discoveryPackSource: RepoDiscoveryPackSource | null
	discoveryPackSummary: string[]
	scaffoldedKnowledgePack: boolean
	knowledgePackScaffoldPath: string | null
	firstRunStudyGuidePath: string
	pilotBatchGuidePath: string
	frictionLogTemplatePath: string
	recommendedNextSteps: string[]
}

const DEFAULT_PROFILE_PATH = ".swarmcoder.json"
export const STRANGER_FIRST_RUN_STUDY_RELATIVE_PATH = "STRANGER_FIRST_RUN_STUDY.md"
export const STRANGER_USE_PILOT_BATCH_RELATIVE_PATH = "STRANGER_USE_PILOT_BATCH.md"
export const STRANGER_FIRST_RUN_FRICTION_LOG_TEMPLATE_RELATIVE_PATH = "STRANGER_FIRST_RUN_FRICTION_LOG_TEMPLATE.md"

const SUGGESTED_TASKS = [
	"add a brief comment to hello.ts",
	"update utils.ts and hello.ts together",
	"rename greet to greetUser and update direct importers",
]

function buildSuggestedTasks(readiness: RepoReadinessResult): string[] {
	if (readiness.decision === "refuse") return SUGGESTED_TASKS.slice(0, 2)
	return [...SUGGESTED_TASKS]
}

function buildOutOfBounds(readiness: RepoReadinessResult, profileIssue: string | null): string[] {
	const reasons = [...readiness.details]
	if (profileIssue) reasons.push(profileIssue)
	return reasons
}

function buildRecommendedNextSteps(
	workspace: string,
	readiness: RepoReadinessResult,
	profileStatus: RepoOnboardResult["profileStatus"],
	knowledgePackStatus: RepoOnboardResult["knowledgePackStatus"],
	discoveryPackSource: RepoOnboardResult["discoveryPackSource"],
): string[] {
	const steps: string[] = []

	if (readiness.decision === "refuse") {
		return [
			"Fix the readiness blockers above, then rerun repo:onboard before launching the shell.",
			`Use ${STRANGER_FIRST_RUN_STUDY_RELATIVE_PATH} to keep the retry loop bounded and honest.`,
			`Record confusion or blockers in ${STRANGER_FIRST_RUN_FRICTION_LOG_TEMPLATE_RELATIVE_PATH} instead of relying on memory.`,
		]
	}

	steps.push(`Run ${formatQueenshiftCommand(["demo:gallery"])} if you want one proven first-task example before touching your repo.`)
	steps.push(`Run ${formatQueenshiftCommand(["owner:guided:demo"])} first if provider setup or shell flow still feels uncertain.`)
	steps.push("Use CONTRIBUTOR_SOURCE_CHECKOUT.md and CONTRIBUTING.md for the contributor-safe proof-first loop on source checkout.")
	steps.push("Run npm.cmd run verify:pr before you call the contributor path green.")

	if (profileStatus === "missing") {
		steps.push(
			`Optional verification scaffold: ${formatQueenshiftWorkspaceCommand(["repo:onboard", "--scaffoldProfile"], workspace)}`,
		)
	}
	steps.push("Run npm.cmd run verify:profiles after you confirm or scaffold the repo verification profile.")
	if (knowledgePackStatus === "missing") {
		steps.push(
			`Optional knowledge-pack scaffold: ${formatQueenshiftWorkspaceCommand(["repo:onboard", "--scaffoldKnowledgePack"], workspace)}`,
		)
	}
	if (discoveryPackSource === "repo_map_fallback") {
		steps.push("Discovery pack is currently using repo-map fallback docs only; add a knowledge pack if you want a stable first-read set.")
	}

	steps.push(`Use ${STRANGER_FIRST_RUN_STUDY_RELATIVE_PATH} for the baseline first-run checklist.`)
	steps.push(`Use ${STRANGER_USE_PILOT_BATCH_RELATIVE_PATH} when you want the current stranger-use batch rows for setup, task completion, confusion, and failure evidence.`)
	steps.push(`Copy ${STRANGER_FIRST_RUN_FRICTION_LOG_TEMPLATE_RELATIVE_PATH} when you want to log friction step by step.`)
	return steps
}

function selectDefaultVerificationProfile(workspace: string, repoMap: RepoMapArtifact): {
	profileClass: SupportedVerificationProfileClass
	name: string
	command: string
} {
	const fileSet = new Set([
		...repoMap.keyFiles,
		...repoMap.likelyEntryPoints,
		...repoMap.topLevelEntries.map((entry) => entry.path),
	])
	const jsTsPack = (repoMap.languagePacks ?? []).find((pack) => pack.id === "javascript_typescript")
	const pythonPack = (repoMap.languagePacks ?? []).find((pack) => pack.id === "python")
	const goPack = (repoMap.languagePacks ?? []).find((pack) => pack.id === "go")
	const rustPack = (repoMap.languagePacks ?? []).find((pack) => pack.id === "rust")

	if (fs.existsSync(path.join(workspace, "scripts", "verify.js"))) {
		return {
			profileClass: "local_node_verify_script_v1",
			name: "local-node-verify-script",
			command: "node scripts/verify.js",
		}
	}

	if (
		fs.existsSync(path.join(workspace, "vitest.config.ts")) ||
		fs.existsSync(path.join(workspace, "vitest.config.js")) ||
		fs.existsSync(path.join(workspace, "vitest.config.mts")) ||
		fs.existsSync(path.join(workspace, "vitest.config.cjs"))
	) {
		return {
			profileClass: "local_npx_vitest_v1",
			name: "local-vitest-run",
			command: "npx vitest run",
		}
	}

	if (fs.existsSync(path.join(workspace, "jest.config.js")) || fs.existsSync(path.join(workspace, "jest.config.ts"))) {
		return {
			profileClass: "local_npx_jest_v1",
			name: "local-jest-run-in-band",
			command: "npx jest --runInBand",
		}
	}

	if (fileSet.has("package.json")) {
		return {
			profileClass: "local_npm_test_v1",
			name: "local-npm-test",
			command: "npm test",
		}
	}

	if (jsTsPack?.recommendedVerificationProfileClass === "local_npx_tsc_v1") {
		return {
			profileClass: "local_npx_tsc_v1",
			name: "local-typescript-no-emit",
			command: "npx tsc --noEmit",
		}
	}

	if (pythonPack) {
		if (fs.existsSync(path.join(workspace, "pytest.ini")) || fs.existsSync(path.join(workspace, "conftest.py"))) {
			return {
				profileClass: "local_python_pytest_v1",
				name: "local-python-pytest",
				command: "python -m pytest",
			}
		}
		return {
			profileClass: "local_python_unittest_v1",
			name: "local-python-unittest",
			command: "python -m unittest",
		}
	}

	if (goPack?.recommendedVerificationProfileClass === "local_go_test_v1" || fileSet.has("go.mod")) {
		return {
			profileClass: "local_go_test_v1",
			name: "local-go-test",
			command: "go test ./...",
		}
	}

	if (rustPack?.recommendedVerificationProfileClass === "local_cargo_test_v1" || fileSet.has("Cargo.toml")) {
		return {
			profileClass: "local_cargo_test_v1",
			name: "local-cargo-test",
			command: "cargo test",
		}
	}

	return {
		profileClass: "local_npm_test_v1",
		name: "local-npm-test",
		command: "npm test",
	}
}

function writeDefaultVerificationProfile(workspace: string, repoMap: RepoMapArtifact): string {
	const scaffoldPath = path.join(workspace, DEFAULT_PROFILE_PATH)
	const selected = selectDefaultVerificationProfile(workspace, repoMap)
	const manifest = buildVerificationProfileManifest({
		profileClass: selected.profileClass,
		name: selected.name,
		command: selected.command,
		cwd: ".",
		timeoutMs: 120000,
		fileScopeHint: [],
	})
	const payload = {
		verificationProfile: {
			name: manifest.name,
			profileClass: manifest.profileClass,
			manifestHash: manifest.manifestHash,
			command: manifest.command,
			cwd: manifest.cwd,
			timeoutMs: manifest.timeoutMs,
			fileScopeHint: manifest.fileScopeHint,
		},
	}
	fs.writeFileSync(scaffoldPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
	return scaffoldPath
}

export async function runRepoOnboard(
	workspace: string,
	options: { scaffoldProfile?: boolean; scaffoldKnowledgePack?: boolean } = {},
): Promise<RepoOnboardResult> {
	const readiness = await evaluateRepoReadiness(workspace)
	const initialRepoMap = await buildRepoMapArtifact(workspace)
	const profile = loadRepoVerificationProfile(workspace)
	const knowledgePack = loadKnowledgePack(workspace)
	const shouldScaffold =
		options.scaffoldProfile === true &&
		profile.profile === null &&
		profile.issue === null &&
		readiness.decision !== "refuse"
	const shouldScaffoldKnowledgePack =
		options.scaffoldKnowledgePack === true &&
		knowledgePack.manifest === null &&
		knowledgePack.issue === null &&
		readiness.decision !== "refuse"

	const scaffoldPath = shouldScaffold ? writeDefaultVerificationProfile(workspace, initialRepoMap) : null
	const knowledgePackScaffoldPath = shouldScaffoldKnowledgePack ? writeDefaultKnowledgePack(workspace, initialRepoMap) : null
	const repoMap = scaffoldPath || knowledgePackScaffoldPath ? await buildRepoMapArtifact(workspace) : initialRepoMap
	const resolvedKnowledgePack = knowledgePackScaffoldPath ? loadKnowledgePack(workspace) : knowledgePack
	const knowledgePackStatus = resolvedKnowledgePack.issue
		? "invalid"
		: resolvedKnowledgePack.manifest
			? "present"
			: "missing"

	return {
		workspace,
		readiness,
		profileStatus: profile.issue ? "invalid" : profile.profile ? "present" : "missing",
		profilePath: scaffoldPath ?? profile.sourcePath,
		profileIssue: profile.issue,
		suggestedTasks: buildSuggestedTasks(readiness),
		outOfBounds: buildOutOfBounds(readiness, profile.issue),
		scaffoldedProfile: Boolean(scaffoldPath),
		scaffoldPath,
		knowledgePackStatus,
		knowledgePackPath: knowledgePackScaffoldPath ?? resolvedKnowledgePack.sourcePath,
		knowledgePackIssue: resolvedKnowledgePack.issue,
		knowledgePackSuggestedDocs: buildSuggestedKnowledgePackDocs(repoMap),
		discoveryPackSource: repoMap.discoveryPack?.source ?? null,
		discoveryPackSummary: repoMap.discoveryPack?.summary.slice(0, 3) ?? [],
		scaffoldedKnowledgePack: Boolean(knowledgePackScaffoldPath),
		knowledgePackScaffoldPath,
		firstRunStudyGuidePath: STRANGER_FIRST_RUN_STUDY_RELATIVE_PATH,
		pilotBatchGuidePath: STRANGER_USE_PILOT_BATCH_RELATIVE_PATH,
		frictionLogTemplatePath: STRANGER_FIRST_RUN_FRICTION_LOG_TEMPLATE_RELATIVE_PATH,
		recommendedNextSteps: buildRecommendedNextSteps(
			workspace,
			readiness,
			profile.issue ? "invalid" : profile.profile ? "present" : "missing",
			knowledgePackStatus,
			repoMap.discoveryPack?.source ?? null,
		),
	}
}

export function formatRepoOnboardResult(result: RepoOnboardResult): string {
	return [
		`Repo onboarding: ${result.readiness.decision.toUpperCase()}`,
		`Workspace: ${result.workspace}`,
		`Support tier: ${result.readiness.supportTierLabel}`,
		`Profile: ${result.profileStatus}${result.profilePath ? ` (${result.profilePath})` : ""}`,
		...(result.scaffoldedProfile && result.scaffoldPath ? [`Scaffolded profile: ${result.scaffoldPath}`] : []),
		`Knowledge pack: ${result.knowledgePackStatus}${result.knowledgePackPath ? ` (${result.knowledgePackPath})` : ""}`,
		...(result.scaffoldedKnowledgePack && result.knowledgePackScaffoldPath
			? [`Scaffolded knowledge pack: ${result.knowledgePackScaffoldPath}`]
			: []),
		...(result.knowledgePackSuggestedDocs.length > 0
			? [`Knowledge pack suggestions: ${result.knowledgePackSuggestedDocs.join(", ")}`]
			: []),
		...result.discoveryPackSummary,
		`First-run study guide: ${result.firstRunStudyGuidePath}`,
		`Pilot batch guide: ${result.pilotBatchGuidePath}`,
		`Friction log template: ${result.frictionLogTemplatePath}`,
		"Recommended next steps:",
		...result.recommendedNextSteps.map((step) => `- ${step}`),
		"Suggested first tasks:",
		...result.suggestedTasks.map((task) => `- ${task}`),
		"Out-of-bounds / readiness notes:",
		...(result.outOfBounds.length > 0 ? result.outOfBounds.map((detail) => `- ${detail}`) : ["- none"]),
	].join("\n")
}
