import fs from "node:fs"
import path from "node:path"

import { buildSwarmPlanArtifact } from "../src/planning/PlanSchema"
import {
	buildRepoMapArtifact,
	formatRepoMapArtifact,
	readRepoIndexStateArtifact,
	resolveRepoIndexStatePath,
	type RepoMapArtifact,
} from "../src/planning/RepoMap"
import { ensureRunDir, readRepoMapArtifact, writeRepoMapArtifact, writeRunSummary } from "../src/run/RunArtifacts"

export type RepoMapHarnessResult = {
	structureVisible: boolean
	entryPointsVisible: boolean
	styleHintsVisible: boolean
	gitHintsVisible: boolean
	languagePacksVisible: boolean
	frameworkHintsVisible: boolean
	scoutPackVisible: boolean
	discoveryPackVisible: boolean
	supportTierVisible: boolean
	largeTierPolicyVisible: boolean
	cacheStateVisible: boolean
	memoryBoundaryVisible: boolean
	planningArtifactVisible: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function writeFile(repoPath: string, relPath: string, content: string): void {
	const filePath = path.join(repoPath, relPath)
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, content, "utf8")
}

async function createRepoMapFixture(rootDir: string): Promise<{ repoPath: string; cleanup: () => void }> {
	const repoPath = path.join(rootDir, "verification", `.tmp-repo-map-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.mkdirSync(repoPath, { recursive: true })

	writeFile(
		repoPath,
		"package.json",
		`${JSON.stringify(
			{
				name: "repo-map-fixture",
				version: "1.0.0",
				scripts: { test: "node scripts/check-build.js" },
				devDependencies: {
					vitest: "^1.0.0",
					jest: "^29.0.0",
					eslint: "^9.0.0",
				},
			},
			null,
			2,
		)}\n`,
	)
	writeFile(repoPath, "README.md", "# Repo Map Fixture\n")
	writeFile(repoPath, "tsconfig.json", `${JSON.stringify({ compilerOptions: { target: "ES2022" } }, null, 2)}\n`)
	writeFile(repoPath, "vitest.config.ts", 'export default { test: { include: ["tests/**/*.test.ts"] } }\n')
	writeFile(repoPath, "jest.config.ts", 'export default { testMatch: ["**/__tests__/**/*.ts"] }\n')
	writeFile(repoPath, "eslint.config.js", "export default []\n")
	writeFile(repoPath, "pytest.ini", "[pytest]\npython_files = test_*.py\n")
	writeFile(repoPath, "go.mod", "module fixture\n\ngo 1.22\n")
	writeFile(repoPath, "Cargo.toml", "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\n")
	writeFile(repoPath, "src/index.ts", 'import { main } from "./main"\n\nexport const run = () => main()\n')
	writeFile(repoPath, "src/main.ts", 'export function main(): string {\n\treturn "hello"\n}\n')
	writeFile(repoPath, "docs/guide.md", "# Guide\n")
	writeFile(repoPath, "tests/main.test.ts", 'import { main } from "../src/main"\n\nexport const result = main()\n')
	writeFile(repoPath, "tests/test_report.py", "import unittest\n\nclass ReportTest(unittest.TestCase):\n\tdef test_ok(self) -> None:\n\t\tself.assertTrue(True)\n")
	writeFile(repoPath, "scripts/check-build.js", 'console.log("ok")\n')
	writeFile(repoPath, "scripts/report.py", 'def build_report() -> str:\n\treturn "ok"\n')
	writeFile(repoPath, "cmd/app/main.go", "package main\n\nfunc main() {}\n")
	writeFile(repoPath, "rust/lib.rs", "pub fn build_rust_report() -> &'static str {\n    \"ok\"\n}\n")

	return {
		repoPath,
		cleanup: () => {
			if (fs.existsSync(repoPath)) fs.rmSync(repoPath, { recursive: true, force: true })
		},
	}
}

function readSummary(summaryPath: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>
}

export async function runRepoMapHarness(rootDir = resolveRootDir()): Promise<RepoMapHarnessResult> {
	const details: string[] = []
	const fixture = await createRepoMapFixture(rootDir)

	try {
		const repoMap = await buildRepoMapArtifact(fixture.repoPath, {
			generatedAt: "2026-03-22T00:00:00.000Z",
			gitHintsOverride: {
				available: true,
				branch: "main",
				workingTree: "dirty",
				changedFiles: ["src/main.ts"],
				recentFiles: ["src/index.ts", "src/main.ts"],
			},
		})
		const repoMapOutput = formatRepoMapArtifact(repoMap)
		const structureVisible =
			repoMap.totalFiles === 18 &&
			repoMap.topLevelEntries.some((entry) => entry.path === "src" && entry.fileCount === 2) &&
			repoMap.topLevelEntries.some((entry) => entry.path === "docs" && entry.fileCount === 1) &&
			repoMap.topLevelEntries.some((entry) => entry.path === "tests" && entry.fileCount === 2) &&
			repoMap.topLevelEntries.some((entry) => entry.path === "scripts" && entry.fileCount === 2) &&
			repoMap.topLevelEntries.some((entry) => entry.path === "cmd" && entry.fileCount === 1) &&
			repoMap.topLevelEntries.some((entry) => entry.path === "rust" && entry.fileCount === 1) &&
			repoMap.fileTypeBreakdown.some((entry) => entry.extension === ".ts" && entry.count === 5)
		const entryPointsVisible =
			repoMap.likelyEntryPoints.includes("src/index.ts") &&
			repoMap.keyFiles.includes("package.json") &&
			repoMapOutput.includes("Likely entry points: src/index.ts")
		const styleHintsVisible =
			repoMap.styleHints.importStyle === "esm" &&
			repoMap.styleHints.dominantCodeExtension === ".ts" &&
			repoMap.plannerSummary.some((line) => line.includes("Style hints:"))
		const gitHintsVisible =
			repoMap.gitHints.available &&
			Boolean(repoMap.gitHints.branch) &&
			repoMap.gitHints.workingTree === "dirty" &&
			repoMap.gitHints.changedFiles.includes("src/main.ts") &&
			repoMap.plannerSummary.some((line) => line.includes("Git hints:"))
		const jsTsPack = repoMap.languagePacks?.find((pack) => pack.id === "javascript_typescript") ?? null
		const pythonPack = repoMap.languagePacks?.find((pack) => pack.id === "python") ?? null
		const goPack = repoMap.languagePacks?.find((pack) => pack.id === "go") ?? null
		const rustPack = repoMap.languagePacks?.find((pack) => pack.id === "rust") ?? null
		const languagePacksVisible =
			Boolean(jsTsPack && jsTsPack.depth === "deep" && jsTsPack.symbolHints.includes("run")) &&
			Boolean(pythonPack && pythonPack.depth === "deep" && pythonPack.symbolHints.includes("build_report")) &&
			Boolean(goPack && goPack.depth === "verification_only" && goPack.recommendedVerificationProfileClass === "local_go_test_v1") &&
			Boolean(rustPack && rustPack.depth === "verification_only" && rustPack.recommendedVerificationProfileClass === "local_cargo_test_v1") &&
			repoMapOutput.includes("Language packs:") &&
			repoMapOutput.includes("depth=verification_only")
		const frameworkHintsVisible =
			Boolean(jsTsPack && ["vitest", "jest", "eslint"].every((id) => jsTsPack.frameworkHints.some((hint) => hint.id === id))) &&
			Boolean(pythonPack && ["pytest", "unittest"].every((id) => pythonPack.frameworkHints.some((hint) => hint.id === id))) &&
			repoMap.plannerSummary.some((line) => line.includes("frameworks=vitest/jest/eslint")) &&
			repoMapOutput.includes("frameworks=vitest/jest/eslint") &&
			repoMapOutput.includes("frameworks=pytest/unittest")
		const scoutPackVisible =
			Boolean(repoMap.scoutPack?.docs.includes("README.md")) &&
			Boolean(repoMap.scoutPack?.configs.includes("package.json")) &&
			Boolean(repoMap.scoutPack?.entryPoints.includes("src/index.ts")) &&
			Boolean(repoMap.scoutPack?.verificationLanes.some((lane) => lane.includes("local_npx_tsc_v1") || lane.includes("local_npm_test_v1"))) &&
			repoMap.plannerSummary.some((line) => line.includes("Scout pack:")) &&
			repoMapOutput.includes("Scout pack:")
		const discoveryPackVisible =
			repoMap.discoveryPack?.source === "repo_map_fallback" &&
			Boolean(repoMap.discoveryPack?.docs.includes("README.md")) &&
			Boolean(repoMap.discoveryPack?.stages.some((stage) => stage.id === "entry_and_config" && stage.targets.includes("src/index.ts") && stage.targets.includes("package.json"))) &&
			Boolean(repoMap.discoveryPack?.stages.some((stage) => stage.id === "verification" && stage.targets.some((target) => target.includes("local_npx_tsc_v1") || target.includes("local_npm_test_v1")))) &&
			repoMap.plannerSummary.some((line) => line.includes("Discovery pack:")) &&
			repoMapOutput.includes("Discovery pack:")
		const supportTierVisible =
			Boolean(repoMap.repoSupport?.label) &&
			(repoMap.repoSupport?.tier === "small_supported" || repoMap.repoSupport?.tier === "medium_supported") &&
			repoMap.plannerSummary.some((line) => line.includes("Repo tier:")) &&
			repoMapOutput.includes("Repo tier:")
		const largeRepoMap = await buildRepoMapArtifact(fixture.repoPath, {
			generatedAt: "2026-03-22T00:02:00.000Z",
			gitHintsOverride: {
				available: true,
				branch: "main",
				workingTree: "clean",
				changedFiles: ["src/main.ts"],
				recentFiles: ["src/index.ts", "src/main.ts"],
			},
			repoSupportOverride: {
				tier: "large_supported_tier_2",
				label: "Large repo tier 2 candidate",
				decision: "allow_with_review_bias",
				reviewBias: true,
				fileCount: 2505,
				totalBytes: 12_500_000,
				dirtyEntryCount: 0,
			},
		})
		const largeRepoOutput = formatRepoMapArtifact(largeRepoMap)
		const largeTierPolicyVisible =
			largeRepoMap.repoSupport?.tier === "large_supported_tier_2" &&
			largeRepoMap.discoveryPack?.contextPolicy.profile === "large_repo_tier_2" &&
			largeRepoMap.discoveryPack?.contextPolicy.maxScoutContextFiles === 2 &&
			largeRepoMap.discoveryPack?.contextPolicy.includeNearbyNeighbors === false &&
			largeRepoMap.discoveryPack?.contextPolicy.includeGitHints === false &&
			(largeRepoMap.discoveryPack?.configs.length ?? 0) <= 1 &&
			(largeRepoMap.discoveryPack?.entryPoints.length ?? 0) <= 1 &&
			largeRepoMap.plannerSummary.some((line) => line.includes("Discovery policy: profile=large_repo_tier_2")) &&
			largeRepoOutput.includes("Discovery policy: profile=large_repo_tier_2")
		const secondRepoMap = await buildRepoMapArtifact(fixture.repoPath, {
			generatedAt: "2026-03-22T00:01:00.000Z",
			gitHintsOverride: {
				available: true,
				branch: "main",
				workingTree: "clean",
				changedFiles: [],
				recentFiles: ["src/index.ts"],
			},
		})
		const indexStatePath = resolveRepoIndexStatePath(fixture.repoPath)
		const indexState = readRepoIndexStateArtifact(fixture.repoPath)
		const cacheStateVisible =
			Boolean(repoMap.cacheStatus?.statePath && fs.existsSync(indexStatePath)) &&
			secondRepoMap.cacheStatus?.mode === "reused" &&
			indexState?.fingerprint === repoMap.cacheStatus?.fingerprint &&
			secondRepoMap.plannerSummary.some((line) => line.includes("Repo index cache: reused"))
		const memoryBoundaryVisible =
			repoMap.memoryBoundary?.id === "repo_index_cache" &&
			repoMap.cacheStatus?.retainedSnapshotCount === 1 &&
			indexState?.memoryBoundary?.id === "repo_index_cache" &&
			repoMap.plannerSummary.some((line) => line.includes("Memory boundary: repo_index_cache")) &&
			repoMapOutput.includes("Memory boundary: repo_index_cache")

		const runDir = ensureRunDir(fixture.repoPath, "repo-map-proof")
		const repoMapArtifactPath = writeRepoMapArtifact(runDir, repoMap)
		const plan = buildSwarmPlanArtifact({
			task: "update src/index.ts and src/main.ts together",
			routing: {
				complexity: "COMPLEX",
				path: "medium",
				usedModel: false,
				targetFiles: ["src/index.ts", "src/main.ts"],
				selectorSource: "explicit_targets",
				reasonCodes: ["explicit_file_targets", "medium_target_count", "prefer_deterministic_coordination"],
				taskContract: null,
			},
			subtasks: [
				{
					id: "subtask-1",
					description: "update src/index.ts and src/main.ts together",
					files: ["src/index.ts", "src/main.ts"],
					assignedBuilder: "builder-1",
				},
			],
			builderCountRequested: 2,
			repoMap,
			createdAt: "2026-03-22T00:00:00.000Z",
		})
		const summaryPath = writeRunSummary(runDir, {
			taskId: "repo-map-proof",
			task: "update src/index.ts and src/main.ts together",
			workspace: fixture.repoPath,
			status: "done",
			stopReason: "success",
			pathChosen: "medium",
			repoMapArtifactPath,
			repoMap,
			plan,
		})
		const summary = readSummary(summaryPath)
		const summaryRepoMapPath = typeof summary["repoMapArtifactPath"] === "string" ? summary["repoMapArtifactPath"] : null
		const summaryRepoMap = summary["repoMap"] as RepoMapArtifact | null
		const summaryPlan = (summary["plan"] as Record<string, unknown> | null) ?? null
		const writtenRepoMap = readRepoMapArtifact<RepoMapArtifact>(runDir)
		const planRepoMap = (summaryPlan?.["repoMap"] as RepoMapArtifact | null) ?? null
		const planningArtifactVisible =
			Boolean(summaryRepoMapPath && fs.existsSync(summaryRepoMapPath)) &&
			Boolean(writtenRepoMap?.plannerSummary.length) &&
			Boolean(summaryRepoMap?.likelyEntryPoints.includes("src/index.ts")) &&
			Boolean(planRepoMap?.keyFiles.includes("package.json"))

		details.push(`repoMap=${repoMap.likelyEntryPoints.join(",")}`)
		details.push(`gitHints=${JSON.stringify(repoMap.gitHints)}`)
		details.push(
			`languagePacks=${
				(repoMap.languagePacks ?? [])
					.map((pack) => `${pack.id}:${pack.depth}:${pack.frameworkHints.map((hint) => hint.id).join("/") || "(none)"}:${pack.symbolHints.join("/") || "(none)"}`)
					.join(",") || "(none)"
			}`,
		)
		details.push(`discovery=${repoMap.discoveryPack?.source ?? "(none)"}:${repoMap.discoveryPack?.docs.join(",") || "(none)"}`)
		details.push(`largePolicy=${largeRepoMap.discoveryPack?.contextPolicy.profile ?? "(none)"}:${largeRepoMap.discoveryPack?.summary.at(2) ?? "(none)"}`)
		details.push(`indexState=${indexStatePath}`)
		details.push(`summary=${summaryPath}`)

		return {
			structureVisible,
			entryPointsVisible,
			styleHintsVisible,
			gitHintsVisible,
			languagePacksVisible,
			frameworkHintsVisible,
			scoutPackVisible,
			discoveryPackVisible,
			supportTierVisible,
			largeTierPolicyVisible,
			cacheStateVisible,
			memoryBoundaryVisible,
			planningArtifactVisible,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatRepoMapHarnessResult(result: RepoMapHarnessResult): string {
	return [
		`Structure visible: ${result.structureVisible ? "PASS" : "FAIL"}`,
		`Entry points visible: ${result.entryPointsVisible ? "PASS" : "FAIL"}`,
		`Style hints visible: ${result.styleHintsVisible ? "PASS" : "FAIL"}`,
		`Git hints visible: ${result.gitHintsVisible ? "PASS" : "FAIL"}`,
		`Language packs visible: ${result.languagePacksVisible ? "PASS" : "FAIL"}`,
		`Framework hints visible: ${result.frameworkHintsVisible ? "PASS" : "FAIL"}`,
		`Scout pack visible: ${result.scoutPackVisible ? "PASS" : "FAIL"}`,
		`Discovery pack visible: ${result.discoveryPackVisible ? "PASS" : "FAIL"}`,
		`Support tier visible: ${result.supportTierVisible ? "PASS" : "FAIL"}`,
		`Large-tier scout policy visible: ${result.largeTierPolicyVisible ? "PASS" : "FAIL"}`,
		`Cache state visible: ${result.cacheStateVisible ? "PASS" : "FAIL"}`,
		`Memory boundary visible: ${result.memoryBoundaryVisible ? "PASS" : "FAIL"}`,
		`Planning artifact visible: ${result.planningArtifactVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runRepoMapHarness()
	console.log(formatRepoMapHarnessResult(result))
	process.exit(
		result.structureVisible &&
		result.entryPointsVisible &&
			result.styleHintsVisible &&
			result.gitHintsVisible &&
			result.languagePacksVisible &&
			result.frameworkHintsVisible &&
		result.scoutPackVisible &&
		result.discoveryPackVisible &&
		result.supportTierVisible &&
		result.largeTierPolicyVisible &&
		result.cacheStateVisible &&
		result.memoryBoundaryVisible &&
		result.planningArtifactVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:repo-map] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
