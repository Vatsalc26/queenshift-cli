import fs from "node:fs"
import path from "node:path"

import { buildCriticArtifact } from "../src/planning/CriticLane"
import { buildContextPackArtifact, formatContextPackPromptSummary } from "../src/planning/ContextPacks"
import { buildSwarmPlanArtifact } from "../src/planning/PlanSchema"
import type { RepoMapArtifact } from "../src/planning/RepoMap"
import {
	formatRoleManualCatalog,
	formatWorkerSpecializationCatalog,
	formatRoleManualPrompt,
	getRoleManual,
	listRoleManualReferences,
	type RoleManualReference,
} from "../src/planning/RoleManuals"
import { buildScopedTaskContract } from "../src/run/TaskContract"

export type RoleManualHarnessResult = {
	catalogVisible: boolean
	specializationCatalogVisible: boolean
	promptInjectionVisible: boolean
	specializationPromptVisible: boolean
	roleContextDifferentiated: boolean
	planArtifactCarriesVersions: boolean
	planTeamShapeVisible: boolean
	criticManualVersionVisible: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function fixtureRepoMap(): RepoMapArtifact {
	return {
		schemaVersion: 1,
		workspaceName: "role-manual-fixture",
		generatedAt: "2026-03-22T00:00:00.000Z",
		totalFiles: 2,
		topLevelEntries: [{ path: "src", kind: "dir", role: "source", fileCount: 2 }],
		keyFiles: ["src/hello.ts"],
		likelyEntryPoints: ["src/hello.ts"],
		ignoredAreas: [".git", ".swarm", "node_modules"],
		fileTypeBreakdown: [{ extension: ".ts", count: 2 }],
		styleHints: {
			dominantCodeExtension: ".ts",
			importStyle: "esm",
			fileNameStyles: ["flat"],
		},
		gitHints: {
			available: false,
			branch: null,
			workingTree: "not_repo",
			changedFiles: [],
			recentFiles: [],
		},
		plannerSummary: ["Role manual fixture repo map."],
	}
}

export async function runRoleManualHarness(rootDir = resolveRootDir()): Promise<RoleManualHarnessResult> {
	const details: string[] = []
	const references = listRoleManualReferences(["supervisor", "builder", "critic", "reviewer"])
	const catalogText = formatRoleManualCatalog()
	const specializationCatalogText = formatWorkerSpecializationCatalog()
	const catalogVisible =
		references.length === 4 &&
		catalogText.includes("supervisor: v1") &&
		catalogText.includes("builder: v1") &&
		catalogText.includes("critic: v1") &&
		catalogText.includes("reviewer: v1")
	const specializationCatalogVisible =
		specializationCatalogText.includes("rename_anchor_owner") &&
		specializationCatalogText.includes("follow_on_owner") &&
		specializationCatalogText.includes("medium_bucket_owner")

	const promptInjectionVisible =
		formatRoleManualPrompt("supervisor").includes("stable subtask ids") &&
		formatRoleManualPrompt("builder").includes("Touch only the files explicitly assigned") &&
		formatRoleManualPrompt("reviewer").includes("Fail closed when evidence or output formatting is unclear")
	const specializationPromptVisible =
		formatRoleManualPrompt("builder", {
			specializationId: "rename_anchor_owner",
			teamShapeSummary: "Team shape: staged_handoff_lane.",
		}).includes("Worker specialization: Rename anchor owner") &&
		formatRoleManualPrompt("builder", {
			specializationId: "rename_anchor_owner",
			teamShapeSummary: "Team shape: staged_handoff_lane.",
		}).includes("Team shape guidance:")
	const fixtureWorkspace = path.join(rootDir, "verification", "test_workspace")
	const contextPack = buildContextPackArtifact(fixtureWorkspace, {
		taskFiles: ["hello.ts", "utils.ts"],
		repoMap: fixtureRepoMap(),
		generatedAt: "2026-03-24T00:00:00.000Z",
		maxFiles: 4,
		maxPreviewBytes: 800,
		maxPreviewCharsPerFile: 200,
	})
	const plannerSummary = formatContextPackPromptSummary(contextPack, "planner")
	const builderSummary = formatContextPackPromptSummary(contextPack, "builder")
	const reviewerSummary = formatContextPackPromptSummary(contextPack, "reviewer")
	const roleContextDifferentiated =
		plannerSummary.includes("Planner focus:") &&
		builderSummary.includes("Builder focus:") &&
		reviewerSummary.includes("Reviewer focus:") &&
		plannerSummary !== builderSummary

	const plan = buildSwarmPlanArtifact({
		task: "rename helper to formatHelper in hello.ts and utils.ts together",
		routing: {
			complexity: "COMPLEX",
			path: "scoped",
			usedModel: false,
			targetFiles: ["hello.ts", "utils.ts"],
			selectorSource: "explicit_targets",
			reasonCodes: ["explicit_file_targets", "bounded_target_count", "prefer_deterministic_coordination"],
			taskContract: null,
		},
		subtasks: [
			{
				id: "subtask-1",
				description: "update hello.ts first",
				files: ["hello.ts"],
				assignedBuilder: "builder-1",
				stage: 1,
				ownershipRule: "Anchor owner.",
				dependencyReason: null,
			},
			{
				id: "subtask-2",
				description: "update utils.ts after hello.ts",
				files: ["utils.ts"],
				assignedBuilder: "builder-2",
				dependsOn: ["subtask-1"],
				stage: 2,
				ownershipRule: "Follow-on owner.",
				dependencyReason: "Wait for subtask-1 before updating utils.ts.",
			},
		],
		builderCountRequested: 3,
		repoMap: fixtureRepoMap(),
		taskContract: {
			...buildScopedTaskContract(["hello.ts", "utils.ts"]),
			refactorIntent: {
				kind: "rename_symbol",
				sourceSymbol: "helper",
				targetSymbol: "formatHelper",
				anchorFile: "hello.ts",
				relatedFiles: ["hello.ts", "utils.ts"],
				languagePackId: "javascript_typescript",
				anchorSymbolPresent: true,
			},
		},
		createdAt: "2026-03-22T00:00:00.000Z",
	})
	const critic = buildCriticArtifact({
		plan,
		assignments: null,
		finalStatus: "review_required",
		stopReason: "review_blocked",
		reviewerVerdict: "NEEDS_WORK",
		changedFiles: ["hello.ts", "utils.ts"],
	})
	const planRoleManuals = plan.roleManuals as RoleManualReference[]

	const planArtifactCarriesVersions =
		planRoleManuals.length === 4 &&
		planRoleManuals.some((manual) => manual.role === "supervisor" && manual.version === "v1") &&
		planRoleManuals.some((manual) => manual.role === "builder" && manual.version === "v1") &&
		planRoleManuals.some((manual) => manual.role === "critic" && manual.version === "v1") &&
		planRoleManuals.some((manual) => manual.role === "reviewer" && manual.version === "v1")
	const planTeamShapeVisible =
		plan.teamShape?.shapeId === "staged_handoff_lane" &&
		plan.teamShape.builderProfiles.some((profile) => profile.specializationId === "rename_anchor_owner") &&
		plan.teamShape.builderProfiles.some((profile) => profile.specializationId === "follow_on_owner")
	const criticManualVersionVisible = critic.manualVersion === getRoleManual("critic").version

	details.push(`catalog=${catalogText}`)
	details.push(`specializations=${specializationCatalogText}`)
	details.push(`plannerContext=${plannerSummary.split(/\r?\n/g)[0] ?? "(none)"}`)
	details.push(`planRoles=${planRoleManuals.map((manual) => `${manual.role}@${manual.version}`).join(",")}`)
	details.push(`teamShape=${plan.teamShape?.shapeId ?? "(missing)"}`)
	details.push(`criticManual=${critic.manualVersion}`)

	return {
		catalogVisible,
		specializationCatalogVisible,
		promptInjectionVisible,
		specializationPromptVisible,
		roleContextDifferentiated,
		planArtifactCarriesVersions,
		planTeamShapeVisible,
		criticManualVersionVisible,
		details,
	}
}

export function formatRoleManualHarnessResult(result: RoleManualHarnessResult): string {
	return [
		`Catalog visible: ${result.catalogVisible ? "PASS" : "FAIL"}`,
		`Specialization catalog visible: ${result.specializationCatalogVisible ? "PASS" : "FAIL"}`,
		`Prompt injection visible: ${result.promptInjectionVisible ? "PASS" : "FAIL"}`,
		`Specialization prompt visible: ${result.specializationPromptVisible ? "PASS" : "FAIL"}`,
		`Role context differentiated: ${result.roleContextDifferentiated ? "PASS" : "FAIL"}`,
		`Plan artifact carries versions: ${result.planArtifactCarriesVersions ? "PASS" : "FAIL"}`,
		`Plan team shape visible: ${result.planTeamShapeVisible ? "PASS" : "FAIL"}`,
		`Critic manual version visible: ${result.criticManualVersionVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runRoleManualHarness()
	console.log(formatRoleManualHarnessResult(result))
	process.exit(
		result.catalogVisible &&
			result.specializationCatalogVisible &&
			result.promptInjectionVisible &&
			result.specializationPromptVisible &&
			result.roleContextDifferentiated &&
			result.planArtifactCarriesVersions &&
			result.planTeamShapeVisible &&
			result.criticManualVersionVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:role-manuals] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
