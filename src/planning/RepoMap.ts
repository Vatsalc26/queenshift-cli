import crypto from "node:crypto"
import { spawn } from "child_process"
import fs from "node:fs"
import path from "node:path"
import type { SupportedVerificationProfileClass } from "../run/VerificationProfileCatalog"
import { evaluateRepoReadiness, type RepoSupportTier } from "../run/AdmissionGate"
import { selectKnowledgePackDocs } from "./KnowledgePack"
import {
	buildRepoDiscoveryPack,
	formatRepoDiscoveryPackSummary,
	resolveRepoDiscoveryContextPolicy,
	type RepoDiscoveryPack,
	type RepoDiscoveryContextPolicy,
} from "./DiscoveryPack"
import { getMemoryLayerBoundary, type MemoryLayerBoundary } from "./MemoryLayers"

const IGNORED_DIRS = new Set([".git", ".next", ".swarm", "build", "coverage", "dist", "node_modules", "out"])
const CODE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".py", ".ts", ".tsx"])
const LIKELY_ENTRY_POINT_PRIORITY = [
	"swarm.ts",
	"src/index.ts",
	"src/main.ts",
	"src/app.ts",
	"src/cli.ts",
	"src/server.ts",
	"index.ts",
	"index.js",
	"main.ts",
	"main.js",
	"main.py",
]
const KEY_FILE_PRIORITY = [
	"package.json",
	"README.md",
	"QUICKSTART.md",
	".swarmcoder.json",
	"tsconfig.json",
	"swarm.ts",
	"src/index.ts",
	"src/main.ts",
	"src/app.ts",
	"src/cli.ts",
]

export type RepoMapTopLevelRole = "source" | "tests" | "docs" | "scripts" | "config" | "readme" | "other"
export type RepoMapImportStyle = "esm" | "cjs" | "mixed" | "none"
export type RepoMapWorkingTreeState = "not_repo" | "clean" | "dirty"

export type RepoMapTopLevelEntry = {
	path: string
	kind: "dir" | "file"
	role: RepoMapTopLevelRole
	fileCount?: number
}

export type RepoMapFileTypeSummary = {
	extension: string
	count: number
}

export type RepoMapStyleHints = {
	dominantCodeExtension: string | null
	importStyle: RepoMapImportStyle
	fileNameStyles: string[]
}

export type RepoMapLanguagePackId = "javascript_typescript" | "python" | "go" | "rust"
export type RepoMapLanguagePackDepth = "starter" | "deep" | "verification_only"
export type RepoMapFrameworkHintId = "vitest" | "jest" | "eslint" | "pytest" | "unittest"

export type RepoMapVerificationLane = {
	profileClass: SupportedVerificationProfileClass
	command: string
	reason: string
	level: "primary" | "secondary"
}

export type RepoMapFrameworkHint = {
	id: RepoMapFrameworkHintId
	label: string
	evidence: string[]
}

export type RepoMapLanguagePack = {
	id: RepoMapLanguagePackId
	label: string
	depth: RepoMapLanguagePackDepth
	fileCount: number
	sampleFiles: string[]
	symbolHints: string[]
	recommendedVerificationProfileClass: SupportedVerificationProfileClass | null
	recommendedVerificationCommand: string | null
	verificationLanes: RepoMapVerificationLane[]
	frameworkHints: RepoMapFrameworkHint[]
	evidence: string[]
}

export type RepoMapScoutPack = {
	docs: string[]
	configs: string[]
	entryPoints: string[]
	verificationLanes: string[]
	handoffSummary: string[]
}

export type RepoMapGitHints = {
	available: boolean
	branch: string | null
	workingTree: RepoMapWorkingTreeState
	changedFiles: string[]
	recentFiles: string[]
}

export type RepoMapCacheStatus = {
	mode: "fresh" | "reused"
	fingerprint: string | null
	statePath: string | null
	retainedSnapshotCount?: number
}

export type RepoMapSupportSummary = {
	tier: RepoSupportTier
	label: string
	decision: "allow" | "allow_with_review_bias" | "refuse"
	reviewBias: boolean
	fileCount: number
	totalBytes: number
	dirtyEntryCount: number
}

export type RepoMapArtifact = {
	schemaVersion: 1
	workspaceName: string
	generatedAt: string
	totalFiles: number
	topLevelEntries: RepoMapTopLevelEntry[]
	keyFiles: string[]
	likelyEntryPoints: string[]
	ignoredAreas: string[]
	fileTypeBreakdown: RepoMapFileTypeSummary[]
	styleHints: RepoMapStyleHints
	languagePacks?: RepoMapLanguagePack[]
	scoutPack?: RepoMapScoutPack
	discoveryPack?: RepoDiscoveryPack
	gitHints: RepoMapGitHints
	repoSupport?: RepoMapSupportSummary
	cacheStatus?: RepoMapCacheStatus
	memoryBoundary?: MemoryLayerBoundary
	compactionPolicy?: {
		mode: "single_snapshot_replace"
		retainedSnapshotCount: 1
	}
	plannerSummary: string[]
}

export type RepoIndexFileSnapshot = {
	path: string
	size: number
	mtimeMs: number
}

export type RepoIndexStateArtifact = {
	schemaVersion: 1
	workspaceName: string
	generatedAt: string
	fingerprint: string
	files: RepoIndexFileSnapshot[]
	memoryBoundary?: MemoryLayerBoundary
	compactionPolicy?: {
		mode: "single_snapshot_replace"
		retainedSnapshotCount: 1
	}
	repoMap: RepoMapArtifact
}

function normalizeRelPath(input: string): string {
	return input.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

function uniqueSorted(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => normalizeRelPath(value)).filter(Boolean))).sort((left, right) =>
		left.localeCompare(right),
	)
}

function listWorkspaceFiles(workspace: string, maxDepth = 8): string[] {
	const results: string[] = []

	const walk = (dir: string, depth: number) => {
		if (depth > maxDepth) return
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (IGNORED_DIRS.has(entry.name)) continue
			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				walk(fullPath, depth + 1)
				continue
			}
			results.push(normalizeRelPath(path.relative(workspace, fullPath)))
		}
	}

	walk(workspace, 0)
	return uniqueSorted(results)
}

function listWorkspaceFileSnapshots(workspace: string, maxDepth = 8): RepoIndexFileSnapshot[] {
	const results: RepoIndexFileSnapshot[] = []

	const walk = (dir: string, depth: number) => {
		if (depth > maxDepth) return
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (IGNORED_DIRS.has(entry.name)) continue
			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				walk(fullPath, depth + 1)
				continue
			}
			try {
				const stat = fs.statSync(fullPath)
				if (!stat.isFile()) continue
				results.push({
					path: normalizeRelPath(path.relative(workspace, fullPath)),
					size: stat.size,
					mtimeMs: stat.mtimeMs,
				})
			} catch {
				// ignore transient file races
			}
		}
	}

	walk(workspace, 0)
	return results.sort((left, right) => left.path.localeCompare(right.path))
}

function computeRepoIndexFingerprint(files: RepoIndexFileSnapshot[]): string {
	return crypto
		.createHash("sha256")
		.update(
			JSON.stringify(
				files.map((file) => ({
					path: file.path,
					size: file.size,
					mtimeMs: Math.trunc(file.mtimeMs),
				})),
			),
		)
		.digest("hex")
}

export function resolveRepoIndexStatePath(workspace: string): string {
	return path.join(workspace, ".swarm", "cache", "repo-index-state.json")
}

export function readRepoIndexStateArtifact(workspace: string): RepoIndexStateArtifact | null {
	const statePath = resolveRepoIndexStatePath(workspace)
	if (!fs.existsSync(statePath)) return null
	try {
		return JSON.parse(fs.readFileSync(statePath, "utf8")) as RepoIndexStateArtifact
	} catch {
		return null
	}
}

function writeRepoIndexStateArtifact(workspace: string, artifact: RepoIndexStateArtifact): string {
	const statePath = resolveRepoIndexStatePath(workspace)
	fs.mkdirSync(path.dirname(statePath), { recursive: true })
	fs.writeFileSync(statePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
	return statePath
}

function classifyTopLevelRole(relPath: string, kind: "dir" | "file"): RepoMapTopLevelRole {
	const basename = path.posix.basename(relPath).toLowerCase()
	if (kind === "dir") {
		if (basename === "src" || basename === "lib" || basename === "app") return "source"
		if (basename === "test" || basename === "tests" || basename === "__tests__") return "tests"
		if (basename === "docs" || basename === "doc") return "docs"
		if (basename === "scripts" || basename === "script") return "scripts"
		if (basename === "config" || basename === "configs") return "config"
		return "other"
	}

	if (basename === "readme.md" || basename === "quickstart.md") return "readme"
	if (basename === "package.json" || basename === "tsconfig.json" || basename === ".swarmcoder.json") return "config"
	if (basename === "swarm.ts") return "source"
	return "other"
}

function roleSortKey(role: RepoMapTopLevelRole): number {
	switch (role) {
		case "source":
			return 0
		case "tests":
			return 1
		case "docs":
			return 2
		case "scripts":
			return 3
		case "config":
			return 4
		case "readme":
			return 5
		default:
			return 6
	}
}

function buildTopLevelEntries(workspace: string, fileList: string[], limit = 12): RepoMapTopLevelEntry[] {
	const entries = fs
		.readdirSync(workspace, { withFileTypes: true })
		.filter((entry) => !IGNORED_DIRS.has(entry.name))
		.map((entry) => {
			const relPath = normalizeRelPath(entry.name)
			const kind: "dir" | "file" = entry.isDirectory() ? "dir" : "file"
			const role = classifyTopLevelRole(relPath, kind)
			const fileCount =
				kind === "dir"
					? fileList.filter((file) => file === relPath || file.startsWith(`${relPath}/`)).length
					: undefined
			return {
				path: relPath,
				kind,
				role,
				fileCount,
			}
		})
		.sort((left, right) => {
			const roleOrder = roleSortKey(left.role) - roleSortKey(right.role)
			if (roleOrder !== 0) return roleOrder
			if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1
			const leftCount = left.fileCount ?? -1
			const rightCount = right.fileCount ?? -1
			if (leftCount !== rightCount) return rightCount - leftCount
			return left.path.localeCompare(right.path)
		})

	return entries.slice(0, limit)
}

function buildFileTypeBreakdown(fileList: string[], limit = 8): RepoMapFileTypeSummary[] {
	const counts = new Map<string, number>()

	for (const file of fileList) {
		const extension = path.posix.extname(file).toLowerCase() || "[no_ext]"
		counts.set(extension, (counts.get(extension) ?? 0) + 1)
	}

	return Array.from(counts.entries())
		.map(([extension, count]) => ({ extension, count }))
		.sort((left, right) => {
			if (left.count !== right.count) return right.count - left.count
			return left.extension.localeCompare(right.extension)
		})
		.slice(0, limit)
}

function detectImportStyle(workspace: string, fileList: string[], sampleLimit = 16): RepoMapImportStyle {
	let sawEsm = false
	let sawCjs = false

	const sampleFiles = fileList.filter((file) => CODE_EXTENSIONS.has(path.posix.extname(file).toLowerCase())).slice(0, sampleLimit)
	for (const file of sampleFiles) {
		let content = ""
		try {
			content = fs.readFileSync(path.join(workspace, file), "utf8")
		} catch {
			continue
		}

		if (/(?:^|\n)\s*(?:import|export)\s/u.test(content)) sawEsm = true
		if (/\brequire\(/u.test(content) || /\bmodule\.exports\b/u.test(content)) sawCjs = true
		if (sawEsm && sawCjs) return "mixed"
	}

	if (sawEsm) return "esm"
	if (sawCjs) return "cjs"
	return "none"
}

function detectFileNameStyles(fileList: string[]): string[] {
	const counts = new Map<string, number>()

	for (const file of fileList) {
		const extension = path.posix.extname(file).toLowerCase()
		if (!CODE_EXTENSIONS.has(extension)) continue
		const stem = path.posix.basename(file, extension)
		let style = "flat"
		if (stem.includes("-")) style = "kebab"
		else if (stem.includes("_")) style = "snake"
		else if (/^[A-Z]/u.test(stem)) style = "pascal"
		else if (/[A-Z]/u.test(stem)) style = "camel"
		counts.set(style, (counts.get(style) ?? 0) + 1)
	}

	return Array.from(counts.entries())
		.sort((left, right) => {
			if (left[1] !== right[1]) return right[1] - left[1]
			return left[0].localeCompare(right[0])
		})
		.map(([style]) => style)
		.slice(0, 3)
}

function detectDominantCodeExtension(fileList: string[]): string | null {
	const counts = new Map<string, number>()
	for (const file of fileList) {
		const extension = path.posix.extname(file).toLowerCase()
		if (!CODE_EXTENSIONS.has(extension)) continue
		counts.set(extension, (counts.get(extension) ?? 0) + 1)
	}

	const winner = Array.from(counts.entries()).sort((left, right) => {
		if (left[1] !== right[1]) return right[1] - left[1]
		return left[0].localeCompare(right[0])
	})[0]
	return winner?.[0] ?? null
}

function pickLikelyEntryPoints(fileList: string[], limit = 6): string[] {
	const matches = new Set<string>()
	const fileSet = new Set(fileList)

	for (const candidate of LIKELY_ENTRY_POINT_PRIORITY) {
		if (fileSet.has(candidate)) matches.add(candidate)
	}

	for (const file of fileList) {
		if (/\/(?:index|main|app|cli|server)\.(?:ts|tsx|js|jsx|py)$/u.test(file)) matches.add(file)
	}

	for (const file of fileList) {
		if (matches.size >= limit) break
		if ((file.startsWith("src/") || !file.includes("/")) && CODE_EXTENSIONS.has(path.posix.extname(file).toLowerCase())) {
			matches.add(file)
		}
	}

	return Array.from(matches).slice(0, limit)
}

function pickKeyFiles(fileList: string[], likelyEntryPoints: string[], limit = 8): string[] {
	const matches = new Set<string>()
	const fileSet = new Set(fileList)

	for (const candidate of KEY_FILE_PRIORITY) {
		if (fileSet.has(candidate)) matches.add(candidate)
	}

	for (const entryPoint of likelyEntryPoints) matches.add(entryPoint)

	for (const file of fileList) {
		if (matches.size >= limit) break
		const basename = path.posix.basename(file).toLowerCase()
		if (basename === "readme.md" || basename === "package.json" || basename === "tsconfig.json") {
			matches.add(file)
		}
	}

	return Array.from(matches).slice(0, limit)
}

async function runCommandCapture(
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs: number },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		})

		let stdout = ""
		let stderr = ""
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk)
		})
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk)
		})

		const killTree = () => {
			if (!child.pid) return
			if (process.platform === "win32") {
				try {
					spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
				} catch {
					// ignore
				}
				return
			}
			try {
				child.kill("SIGTERM")
			} catch {
				// ignore
			}
		}

		const timeout = setTimeout(() => killTree(), options.timeoutMs)
		timeout.unref?.()

		child.once("error", reject)
		child.once("close", (code) => {
			clearTimeout(timeout)
			resolve({ stdout, stderr, code: typeof code === "number" ? code : null })
		})
	})
}

async function runGitCapture(workspace: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
	let result: { stdout: string; stderr: string; code: number | null }
	try {
		result = await runCommandCapture("git", ["-c", `safe.directory=${workspace}`, ...args], {
			cwd: workspace,
			timeoutMs: 15_000,
		})
	} catch {
		return { ok: false, stdout: "" }
	}
	if (result.code !== 0) {
		return { ok: false, stdout: "" }
	}

	return { ok: true, stdout: result.stdout }
}

function parseStatusPath(line: string): string | null {
	const raw = line.replace(/\r?\n?$/u, "")
	if (!raw.trim()) return null
	const body = raw.length > 3 ? raw.slice(3).trim() : raw.trim()
	const candidate = body.includes(" -> ") ? (body.split(" -> ").at(-1) ?? "") : body
	return candidate ? normalizeRelPath(candidate.replace(/^"+|"+$/g, "")) : null
}

async function readGitHints(workspace: string, changedLimit = 6, recentLimit = 6): Promise<RepoMapGitHints> {
	const insideRepo = await runGitCapture(workspace, ["rev-parse", "--is-inside-work-tree"])
	if (!insideRepo.ok || insideRepo.stdout.trim() !== "true") {
		return {
			available: false,
			branch: null,
			workingTree: "not_repo",
			changedFiles: [],
			recentFiles: [],
		}
	}

	const branch = await runGitCapture(workspace, ["rev-parse", "--abbrev-ref", "HEAD"])
	const status = await runGitCapture(workspace, ["status", "--short"])
	const latestFiles = await runGitCapture(workspace, ["log", "-1", "--name-only", "--pretty=format:"])
	const changedFiles = uniqueSorted(
		status.stdout
			.split(/\r?\n/g)
			.map((line) => parseStatusPath(line))
			.filter((value): value is string => Boolean(value)),
	).slice(0, changedLimit)
	const recentFiles = uniqueSorted(
		latestFiles.stdout
			.split(/\r?\n/g)
			.map((line) => normalizeRelPath(line))
			.filter(Boolean),
	).slice(0, recentLimit)

	return {
		available: true,
		branch: branch.ok && branch.stdout.trim() ? branch.stdout.trim() : null,
		workingTree: changedFiles.length > 0 ? "dirty" : "clean",
		changedFiles,
		recentFiles,
	}
}

function uniqueLimited(values: string[], limit: number): string[] {
	return Array.from(new Set(values.filter(Boolean))).slice(0, limit)
}

function collectFileSetMatches(fileSet: Set<string>, candidates: string[]): string[] {
	return candidates.filter((candidate) => fileSet.has(candidate))
}

function fileListHasPattern(fileList: string[], pattern: RegExp): boolean {
	return fileList.some((file) => pattern.test(file))
}

function readFileTextSafe(workspace: string, relPath: string): string {
	try {
		const fullPath = path.join(workspace, relPath)
		return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : ""
	} catch {
		return ""
	}
}

function extractSymbolHints(workspace: string, files: string[], patterns: RegExp[], limit = 6): string[] {
	const hints: string[] = []
	for (const file of files) {
		let content = ""
		try {
			content = fs.readFileSync(path.join(workspace, file), "utf8")
		} catch {
			continue
		}
		for (const pattern of patterns) {
			for (const match of content.matchAll(pattern)) {
				const symbol = typeof match[1] === "string" ? match[1].trim() : ""
				if (!symbol) continue
				hints.push(symbol)
				if (hints.length >= limit) return uniqueLimited(hints, limit)
			}
		}
	}
	return uniqueLimited(hints, limit)
}

function readPackageManifestHints(workspace: string): { hasPackageJson: boolean; scripts: Set<string>; dependencies: Set<string> } {
	const packageJsonPath = path.join(workspace, "package.json")
	if (!fs.existsSync(packageJsonPath)) {
		return {
			hasPackageJson: false,
			scripts: new Set(),
			dependencies: new Set(),
		}
	}

	try {
		const raw = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>
		const scripts = raw["scripts"]
		const dependencies = raw["dependencies"]
		const devDependencies = raw["devDependencies"]
		return {
			hasPackageJson: true,
			scripts:
				scripts && typeof scripts === "object" && !Array.isArray(scripts)
					? new Set(Object.keys(scripts))
					: new Set<string>(),
			dependencies: new Set(
				[dependencies, devDependencies]
					.flatMap((entry) =>
						entry && typeof entry === "object" && !Array.isArray(entry) ? Object.keys(entry as Record<string, unknown>) : [],
					)
					.filter(Boolean),
			),
		}
	} catch {
		return {
			hasPackageJson: true,
			scripts: new Set(),
			dependencies: new Set(),
		}
	}
}

function dedupeVerificationLanes(lanes: RepoMapVerificationLane[]): RepoMapVerificationLane[] {
	const seen = new Set<string>()
	return lanes.filter((lane) => {
		if (seen.has(lane.profileClass)) return false
		seen.add(lane.profileClass)
		return true
	})
}

function buildJsTsVerificationLanes(
	fileSet: Set<string>,
	fileList: string[],
	packageHints: { hasPackageJson: boolean; scripts: Set<string>; dependencies: Set<string> },
): { lanes: RepoMapVerificationLane[]; evidence: string[]; frameworkHints: RepoMapFrameworkHint[] } {
	const lanes: RepoMapVerificationLane[] = []
	const evidence: string[] = []
	const frameworkHints: RepoMapFrameworkHint[] = []

	if (fileSet.has("tsconfig.json")) {
		lanes.push({
			profileClass: "local_npx_tsc_v1",
			command: "npx tsc --noEmit",
			reason: "tsconfig.json is present, so a no-emit TypeScript lane is the safest bounded compile proof.",
			level: "primary",
		})
		evidence.push("tsconfig.json")
	}

	if (packageHints.hasPackageJson && packageHints.scripts.has("test")) {
		lanes.push({
			profileClass: "local_npm_test_v1",
			command: "npm test",
			reason: "package.json exposes a checked-in test script for repo-owned verification.",
			level: lanes.length === 0 ? "primary" : "secondary",
		})
		evidence.push("package.json#scripts.test")
	}

	const vitestConfigMatches = collectFileSetMatches(fileSet, ["vitest.config.ts", "vitest.config.js", "vitest.config.mts", "vitest.config.mjs"])
	const hasVitestTests = fileListHasPattern(fileList, /(^|\/).+\.test\.(ts|tsx|js|jsx)$/u)
	const hasVitest =
		packageHints.dependencies.has("vitest") ||
		vitestConfigMatches.length > 0 ||
		hasVitestTests
	if (hasVitest) {
		lanes.push({
			profileClass: "local_npx_vitest_v1",
			command: "npx vitest run",
			reason: "Vitest-style config or test files were found in the repo.",
			level: "secondary",
		})
		evidence.push("vitest")
		frameworkHints.push({
			id: "vitest",
			label: "Vitest",
			evidence: uniqueLimited(
				[
					packageHints.dependencies.has("vitest") ? "dependency:vitest" : "",
					...vitestConfigMatches,
					hasVitestTests ? "test-files" : "",
				],
				3,
			),
		})
	}

	const jestConfigMatches = collectFileSetMatches(fileSet, ["jest.config.ts", "jest.config.js", "jest.config.mjs", "jest.config.cjs"])
	const hasJestTests = fileListHasPattern(fileList, /(^|\/)__tests__\//u)
	const hasJest =
		packageHints.dependencies.has("jest") ||
		jestConfigMatches.length > 0 ||
		hasJestTests
	if (hasJest) {
		lanes.push({
			profileClass: "local_npx_jest_v1",
			command: "npx jest --runInBand",
			reason: "Jest config or __tests__ layout was detected.",
			level: "secondary",
		})
		evidence.push("jest")
		frameworkHints.push({
			id: "jest",
			label: "Jest",
			evidence: uniqueLimited(
				[
					packageHints.dependencies.has("jest") ? "dependency:jest" : "",
					...jestConfigMatches,
					hasJestTests ? "__tests__ layout" : "",
				],
				3,
			),
		})
	}

	const eslintConfigMatches = collectFileSetMatches(fileSet, [
		".eslintrc",
		".eslintrc.js",
		".eslintrc.cjs",
		".eslintrc.json",
		"eslint.config.js",
		"eslint.config.mjs",
		"eslint.config.cjs",
	])
	const hasEslint =
		packageHints.dependencies.has("eslint") ||
		eslintConfigMatches.length > 0
	if (hasEslint) {
		lanes.push({
			profileClass: "local_npx_eslint_v1",
			command: "npx eslint .",
			reason: "ESLint config or dependency was found, so lint can stay inside the bounded verification surface.",
			level: "secondary",
		})
		evidence.push("eslint")
		frameworkHints.push({
			id: "eslint",
			label: "ESLint",
			evidence: uniqueLimited(
				[
					packageHints.dependencies.has("eslint") ? "dependency:eslint" : "",
					...eslintConfigMatches,
				],
				3,
			),
		})
	}

	return {
		lanes: dedupeVerificationLanes(lanes),
		evidence: uniqueLimited(evidence, 6),
		frameworkHints,
	}
}

function buildPythonVerificationLanes(
	workspace: string,
	fileSet: Set<string>,
	fileList: string[],
): { lanes: RepoMapVerificationLane[]; evidence: string[]; frameworkHints: RepoMapFrameworkHint[] } {
	const lanes: RepoMapVerificationLane[] = []
	const evidence: string[] = []
	const frameworkHints: RepoMapFrameworkHint[] = []
	const pyprojectText = readFileTextSafe(workspace, "pyproject.toml").toLowerCase()
	const hasPytestPattern = fileListHasPattern(fileList, /(^|\/)test_.+\.py$/u)
	const hasPytestSignals =
		fileSet.has("pytest.ini") ||
		fileSet.has("conftest.py") ||
		pyprojectText.includes("pytest") ||
		hasPytestPattern
	if (hasPytestSignals || fileList.some((file) => path.posix.extname(file).toLowerCase() === ".py")) {
		lanes.push({
			profileClass: "local_python_pytest_v1",
			command: "python -m pytest",
			reason: hasPytestSignals
				? "Pytest-style files were detected, so pytest stays the primary bounded Python proof lane."
				: "Python files are present, and pytest remains the default bounded Python verification lane.",
			level: "primary",
		})
		evidence.push(hasPytestSignals ? "pytest-signals" : "python-files")
		if (hasPytestSignals) {
			frameworkHints.push({
				id: "pytest",
				label: "pytest",
				evidence: uniqueLimited(
					[
						fileSet.has("pytest.ini") ? "pytest.ini" : "",
						fileSet.has("conftest.py") ? "conftest.py" : "",
						pyprojectText.includes("pytest") ? "pyproject.toml" : "",
						hasPytestPattern ? "test_*.py" : "",
					],
					4,
				),
			})
		}
	}

	const hasUnittestLayout = fileListHasPattern(fileList, /(^|\/)tests?\/.+\.py$/u)
	const hasUnittestImport = fileList.some((file) => readFileTextSafe(workspace, file).includes("unittest"))
	const hasUnittestSignals =
		hasUnittestLayout ||
		hasUnittestImport
	if (hasUnittestSignals) {
		lanes.push({
			profileClass: "local_python_unittest_v1",
			command: "python -m unittest",
			reason: "tests/ layout or unittest imports suggest the stdlib lane is also worth surfacing.",
			level: lanes.length === 0 ? "primary" : "secondary",
		})
		evidence.push("unittest-signals")
		frameworkHints.push({
			id: "unittest",
			label: "unittest",
			evidence: uniqueLimited(
				[
					hasUnittestLayout ? "tests-layout" : "",
					hasUnittestImport ? "unittest-import" : "",
				],
				2,
			),
		})
	}

	return {
		lanes: dedupeVerificationLanes(lanes),
		evidence: uniqueLimited(evidence, 6),
		frameworkHints,
	}
}

function buildGoLanguagePack(workspace: string, fileSet: Set<string>, fileList: string[]): RepoMapLanguagePack | null {
	const goFiles = fileList.filter((file) => path.posix.extname(file).toLowerCase() === ".go")
	const hasGoSignals = fileSet.has("go.mod") || goFiles.length > 0
	if (!hasGoSignals) return null

	return {
		id: "go",
		label: "Go",
		depth: "verification_only",
		fileCount: goFiles.length,
		sampleFiles: goFiles.slice(0, 3),
		symbolHints: extractSymbolHints(workspace, goFiles.slice(0, 8), [/^\s*func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gmu, /^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+struct\b/gmu]),
		recommendedVerificationProfileClass: "local_go_test_v1",
		recommendedVerificationCommand: "go test ./...",
		verificationLanes: [
			{
				profileClass: "local_go_test_v1",
				command: "go test ./...",
				reason: "go.mod or Go source files were detected, so module-wide go test stays the bounded verification lane.",
				level: "primary",
			},
		],
		frameworkHints: [],
		evidence: uniqueLimited([fileSet.has("go.mod") ? "go.mod" : "", goFiles.length > 0 ? "go-files" : ""], 4),
	}
}

function buildRustLanguagePack(workspace: string, fileSet: Set<string>, fileList: string[]): RepoMapLanguagePack | null {
	const rustFiles = fileList.filter((file) => path.posix.extname(file).toLowerCase() === ".rs")
	const hasRustSignals = fileSet.has("Cargo.toml") || rustFiles.length > 0
	if (!hasRustSignals) return null

	return {
		id: "rust",
		label: "Rust",
		depth: "verification_only",
		fileCount: rustFiles.length,
		sampleFiles: rustFiles.slice(0, 3),
		symbolHints: extractSymbolHints(
			workspace,
			rustFiles.slice(0, 8),
			[/^\s*pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gmu, /^\s*fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gmu, /^\s*pub\s+struct\s+([A-Za-z_][A-Za-z0-9_]*)\b/gmu],
		),
		recommendedVerificationProfileClass: "local_cargo_test_v1",
		recommendedVerificationCommand: "cargo test",
		verificationLanes: [
			{
				profileClass: "local_cargo_test_v1",
				command: "cargo test",
				reason: "Cargo.toml or Rust source files were detected, so cargo test stays the bounded verification lane.",
				level: "primary",
			},
		],
		frameworkHints: [],
		evidence: uniqueLimited([fileSet.has("Cargo.toml") ? "Cargo.toml" : "", rustFiles.length > 0 ? "rust-files" : ""], 4),
	}
}

function buildLanguagePacks(workspace: string, fileList: string[]): RepoMapLanguagePack[] {
	const fileSet = new Set(fileList)
	const packageHints = readPackageManifestHints(workspace)
	const jsTsFiles = fileList.filter((file) => [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"].includes(path.posix.extname(file).toLowerCase()))
	const pythonFiles = fileList.filter((file) => path.posix.extname(file).toLowerCase() === ".py")
	const packs: RepoMapLanguagePack[] = []

	if (jsTsFiles.length > 0) {
		const verification = buildJsTsVerificationLanes(fileSet, fileList, packageHints)
		const primaryLane = verification.lanes.find((lane) => lane.level === "primary") ?? verification.lanes[0] ?? null
		packs.push({
			id: "javascript_typescript",
			label: "JavaScript / TypeScript",
			depth: verification.lanes.length > 1 ? "deep" : "starter",
			fileCount: jsTsFiles.length,
			sampleFiles: jsTsFiles.slice(0, 3),
			symbolHints: extractSymbolHints(
				workspace,
				jsTsFiles.slice(0, 8),
				[
					/export\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/gu,
					/export\s+(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/gu,
					/export\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/gu,
				],
			),
			recommendedVerificationProfileClass: primaryLane?.profileClass ?? null,
			recommendedVerificationCommand: primaryLane?.command ?? null,
			verificationLanes: verification.lanes,
			frameworkHints: verification.frameworkHints,
			evidence: verification.evidence,
		})
	}

	if (pythonFiles.length > 0) {
		const verification = buildPythonVerificationLanes(workspace, fileSet, fileList)
		const primaryLane = verification.lanes.find((lane) => lane.level === "primary") ?? verification.lanes[0] ?? null
		packs.push({
			id: "python",
			label: "Python",
			depth: verification.lanes.length > 1 ? "deep" : "starter",
			fileCount: pythonFiles.length,
			sampleFiles: pythonFiles.slice(0, 3),
			symbolHints: extractSymbolHints(workspace, pythonFiles.slice(0, 8), [/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gmu, /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\b/gmu]),
			recommendedVerificationProfileClass: primaryLane?.profileClass ?? null,
			recommendedVerificationCommand: primaryLane?.command ?? null,
			verificationLanes: verification.lanes,
			frameworkHints: verification.frameworkHints,
			evidence: verification.evidence,
		})
	}

	const goPack = buildGoLanguagePack(workspace, fileSet, fileList)
	if (goPack) packs.push(goPack)

	const rustPack = buildRustLanguagePack(workspace, fileSet, fileList)
	if (rustPack) packs.push(rustPack)

	return packs
}

function formatLanguagePackSummary(pack: RepoMapLanguagePack): string {
	const profiles = pack.verificationLanes.map((lane) => lane.profileClass).join("/")
	const frameworks = pack.frameworkHints.map((hint) => hint.id).join("/")
	return `${pack.label}(${pack.fileCount}) depth=${pack.depth}${profiles ? ` profiles=${profiles}` : ""}${frameworks ? ` frameworks=${frameworks}` : ""}${pack.symbolHints.length > 0 ? ` symbols=${pack.symbolHints.join("/")}` : ""}`
}

function pickScoutConfigFiles(fileList: string[], limit = 4): string[] {
	const prioritized = ["package.json", "tsconfig.json", ".swarmcoder.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod"]
	const fileSet = new Set(fileList)
	const selected = new Set<string>()

	for (const candidate of prioritized) {
		if (fileSet.has(candidate)) selected.add(candidate)
		if (selected.size >= limit) return Array.from(selected)
	}
	for (const file of fileList) {
		if (selected.size >= limit) break
		if (file.startsWith("config/")) selected.add(file)
	}
	return Array.from(selected)
}

function buildScoutPack(
	workspace: string,
	input: {
		keyFiles: string[]
		likelyEntryPoints: string[]
		fileList: string[]
		languagePacks: RepoMapLanguagePack[]
		discoveryPolicy: RepoDiscoveryContextPolicy
	},
): RepoMapScoutPack {
	const docs = selectKnowledgePackDocs(
		workspace,
		input.keyFiles.filter((file) => path.posix.extname(file).toLowerCase() === ".md"),
	).docs.slice(0, input.discoveryPolicy.maxDocs)
	const configs = pickScoutConfigFiles(input.fileList, input.discoveryPolicy.maxConfigs)
	const entryPoints = uniqueLimited(input.likelyEntryPoints, input.discoveryPolicy.maxEntryPoints)
	const verificationLanes = uniqueLimited(
		input.languagePacks.flatMap((pack) => pack.verificationLanes.map((lane) => `${lane.profileClass} -> ${lane.command}`)),
		input.discoveryPolicy.maxVerificationLanes,
	)

	return {
		docs,
		configs,
		entryPoints,
		verificationLanes,
		handoffSummary: [
			`docs=${docs.join(", ") || "(none)"}`,
			`configs=${configs.join(", ") || "(none)"}`,
			`entryPoints=${entryPoints.join(", ") || "(none)"}`,
			`verification=${verificationLanes.join(" | ") || "(none)"}`,
			`policy=${input.discoveryPolicy.profile}`,
			`scoutContext<=${input.discoveryPolicy.maxScoutContextFiles}`,
			`neighbors=${input.discoveryPolicy.includeNearbyNeighbors ? "on" : "off"}`,
			`gitHints=${input.discoveryPolicy.includeGitHints ? "on" : "off"}`,
		],
	}
}

function buildPlannerSummary(input: {
	workspaceName: string
	totalFiles: number
	topLevelEntries: RepoMapTopLevelEntry[]
	fileTypeBreakdown: RepoMapFileTypeSummary[]
	likelyEntryPoints: string[]
	keyFiles: string[]
	ignoredAreas: string[]
	styleHints: RepoMapStyleHints
	languagePacks: RepoMapLanguagePack[]
	scoutPack: RepoMapScoutPack
	discoveryPack: RepoDiscoveryPack
	gitHints: RepoMapGitHints
	repoSupport: RepoMapSupportSummary
	cacheStatus: RepoMapCacheStatus
	memoryBoundary: MemoryLayerBoundary
}): string[] {
	const topLevelSummary = input.topLevelEntries
		.map((entry) => (entry.kind === "dir" ? `${entry.path}(${entry.fileCount ?? 0})` : entry.path))
		.join(", ")
	const fileTypes = input.fileTypeBreakdown.map((entry) => `${entry.extension}:${entry.count}`).join(", ")
	const styleSummary = [
		input.styleHints.dominantCodeExtension ? `dominant=${input.styleHints.dominantCodeExtension}` : null,
		`imports=${input.styleHints.importStyle}`,
		input.styleHints.fileNameStyles.length > 0 ? `names=${input.styleHints.fileNameStyles.join("/")}` : null,
	]
		.filter((value): value is string => Boolean(value))
		.join(", ")
	const gitSummary =
		input.gitHints.workingTree === "not_repo"
			? "Git hints: not a git repo."
			: `Git hints: branch=${input.gitHints.branch ?? "(unknown)"}, workingTree=${input.gitHints.workingTree}, changed=${input.gitHints.changedFiles.join(", ") || "(none)"}, recent=${input.gitHints.recentFiles.join(", ") || "(none)"}.`
	const supportSummary = `Repo tier: ${input.repoSupport.label} (${input.repoSupport.fileCount} files / ${input.repoSupport.totalBytes} bytes${input.repoSupport.reviewBias ? ", review bias" : ""}).`
	const languageSummary =
		input.languagePacks.length > 0
			? `Language packs: ${input.languagePacks
					.map((pack) => formatLanguagePackSummary(pack))
					.join(", ")}.`
			: "Language packs: none."
	const scoutSummary = `Scout pack: docs=${input.scoutPack.docs.join(", ") || "(none)"} | configs=${input.scoutPack.configs.join(", ") || "(none)"} | entryPoints=${input.scoutPack.entryPoints.join(", ") || "(none)"} | verification=${input.scoutPack.verificationLanes.join(" | ") || "(none)"}.`
	const discoverySummary = formatRepoDiscoveryPackSummary(input.discoveryPack, 3).split("\n")
	const cacheSummary =
		input.cacheStatus.statePath && input.cacheStatus.fingerprint
			? `Repo index cache: ${input.cacheStatus.mode} (${input.cacheStatus.fingerprint.slice(0, 12)}) at ${input.cacheStatus.statePath}.`
			: "Repo index cache: not persisted."
	const memoryBoundarySummary = `Memory boundary: ${input.memoryBoundary.id} -> ${input.memoryBoundary.retentionRule}`

	return [
		`Repo map: ${input.workspaceName} exposes ${input.totalFiles} bounded candidate files.`,
		`Likely entry points: ${input.likelyEntryPoints.join(", ") || "(none)"}.`,
		`Key files: ${input.keyFiles.join(", ") || "(none)"}.`,
		scoutSummary,
		...discoverySummary,
		`File types: ${fileTypes || "(none)"} | Style hints: ${styleSummary || "none"}.`,
		languageSummary,
		`Top-level areas: ${topLevelSummary || "(none)"}.`,
		supportSummary,
		`Ignored areas: ${input.ignoredAreas.join(", ")}.`,
		cacheSummary,
		memoryBoundarySummary,
		gitSummary,
	]
}

export async function buildRepoMapArtifact(
	workspace: string,
	options: {
		fileList?: string[]
		generatedAt?: string
		gitHintsOverride?: RepoMapGitHints
		repoSupportOverride?: RepoMapSupportSummary
	} = {},
): Promise<RepoMapArtifact> {
	const generatedAt = options.generatedAt ?? new Date().toISOString()
	const fileSnapshots = typeof options.fileList === "undefined" ? listWorkspaceFileSnapshots(workspace) : []
	const fileList = uniqueSorted(options.fileList ?? fileSnapshots.map((entry) => entry.path))
	const fingerprint = fileSnapshots.length > 0 ? computeRepoIndexFingerprint(fileSnapshots) : null
	const statePath = typeof options.fileList === "undefined" ? resolveRepoIndexStatePath(workspace) : null
	const cachedState = typeof options.fileList === "undefined" ? readRepoIndexStateArtifact(workspace) : null
	const repoReadiness =
		options.repoSupportOverride ??
		((await evaluateRepoReadiness(workspace, { allowDirty: true })) satisfies {
			supportTier: RepoSupportTier
			supportTierLabel: string
			decision: "allow" | "allow_with_review_bias" | "refuse"
			metrics: { fileCount: number; totalBytes: number; dirtyEntryCount: number }
		})
	const repoSupport: RepoMapSupportSummary =
		"tier" in repoReadiness
			? repoReadiness
			: {
					tier: repoReadiness.supportTier,
					label: repoReadiness.supportTierLabel,
					decision: repoReadiness.decision,
					reviewBias: repoReadiness.decision === "allow_with_review_bias",
					fileCount: repoReadiness.metrics.fileCount,
					totalBytes: repoReadiness.metrics.totalBytes,
					dirtyEntryCount: repoReadiness.metrics.dirtyEntryCount,
				}
	if (typeof options.fileList === "undefined" && cachedState?.fingerprint && fingerprint && cachedState.fingerprint === fingerprint) {
		const gitHints = options.gitHintsOverride ?? (await readGitHints(workspace))
		const cachedRepoMap = cachedState.repoMap
		const languagePacks = buildLanguagePacks(workspace, fileList)
		const discoveryPolicy = resolveRepoDiscoveryContextPolicy(repoSupport.tier)
		const scoutPack = buildScoutPack(workspace, {
			keyFiles: cachedRepoMap.keyFiles,
			likelyEntryPoints: cachedRepoMap.likelyEntryPoints,
			fileList,
			languagePacks,
			discoveryPolicy,
		})
		const discoveryPack = buildRepoDiscoveryPack({
			workspace,
			fallbackDocs: scoutPack.docs,
			configs: scoutPack.configs,
			entryPoints: scoutPack.entryPoints,
			verificationLanes: scoutPack.verificationLanes,
			supportTier: repoSupport.tier,
		})
		const cacheStatus: RepoMapCacheStatus = {
			mode: "reused",
			fingerprint,
			statePath,
			retainedSnapshotCount: 1,
		}
		const memoryBoundary = cachedRepoMap.memoryBoundary ?? getMemoryLayerBoundary("repo_index_cache")
		const compactionPolicy = cachedRepoMap.compactionPolicy ?? {
			mode: "single_snapshot_replace" as const,
			retainedSnapshotCount: 1 as const,
		}
		const repoMap: RepoMapArtifact = {
			...cachedRepoMap,
			generatedAt,
			languagePacks,
			scoutPack,
			discoveryPack,
			gitHints,
			repoSupport,
			cacheStatus,
			memoryBoundary,
			compactionPolicy,
			plannerSummary: buildPlannerSummary({
				workspaceName: cachedRepoMap.workspaceName,
				totalFiles: cachedRepoMap.totalFiles,
				topLevelEntries: cachedRepoMap.topLevelEntries,
				fileTypeBreakdown: cachedRepoMap.fileTypeBreakdown,
				likelyEntryPoints: cachedRepoMap.likelyEntryPoints,
				keyFiles: cachedRepoMap.keyFiles,
				ignoredAreas: cachedRepoMap.ignoredAreas,
				styleHints: cachedRepoMap.styleHints,
				languagePacks,
				scoutPack,
				discoveryPack,
				gitHints,
				repoSupport,
				cacheStatus,
				memoryBoundary,
			}),
		}
		writeRepoIndexStateArtifact(workspace, {
			schemaVersion: 1,
			workspaceName: repoMap.workspaceName,
			generatedAt,
			fingerprint,
			files: fileSnapshots,
			memoryBoundary,
			compactionPolicy,
			repoMap,
		})
		return repoMap
	}
	const languagePacks = buildLanguagePacks(workspace, fileList)
	const likelyEntryPoints = pickLikelyEntryPoints(fileList)
	const keyFiles = pickKeyFiles(fileList, likelyEntryPoints)
	const topLevelEntries = buildTopLevelEntries(workspace, fileList)
	const fileTypeBreakdown = buildFileTypeBreakdown(fileList)
	const discoveryPolicy = resolveRepoDiscoveryContextPolicy(repoSupport.tier)
	const scoutPack = buildScoutPack(workspace, {
		keyFiles,
		likelyEntryPoints,
		fileList,
		languagePacks,
		discoveryPolicy,
	})
	const discoveryPack = buildRepoDiscoveryPack({
		workspace,
		fallbackDocs: scoutPack.docs,
		configs: scoutPack.configs,
		entryPoints: scoutPack.entryPoints,
		verificationLanes: scoutPack.verificationLanes,
		supportTier: repoSupport.tier,
	})
	const styleHints: RepoMapStyleHints = {
		dominantCodeExtension: detectDominantCodeExtension(fileList),
		importStyle: detectImportStyle(workspace, fileList),
		fileNameStyles: detectFileNameStyles(fileList),
	}
	const gitHints = options.gitHintsOverride ?? (await readGitHints(workspace))
	const cacheStatus: RepoMapCacheStatus = {
		mode: cachedState?.fingerprint && fingerprint && cachedState.fingerprint === fingerprint ? "reused" : "fresh",
		fingerprint,
		statePath,
		retainedSnapshotCount: 1,
	}
	const memoryBoundary = getMemoryLayerBoundary("repo_index_cache")
	const compactionPolicy = {
		mode: "single_snapshot_replace" as const,
		retainedSnapshotCount: 1 as const,
	}
	const plannerSummary = buildPlannerSummary({
		workspaceName: path.basename(workspace),
		totalFiles: fileList.length,
		topLevelEntries,
		fileTypeBreakdown,
		likelyEntryPoints,
		keyFiles,
		ignoredAreas: Array.from(IGNORED_DIRS).sort((left, right) => left.localeCompare(right)),
		styleHints,
		languagePacks,
		scoutPack,
		discoveryPack,
		gitHints,
		repoSupport,
		cacheStatus,
		memoryBoundary,
	})
	const repoMap: RepoMapArtifact = {
		schemaVersion: 1,
		workspaceName: path.basename(workspace),
		generatedAt,
		totalFiles: fileList.length,
		topLevelEntries,
		keyFiles,
		likelyEntryPoints,
		ignoredAreas: Array.from(IGNORED_DIRS).sort((left, right) => left.localeCompare(right)),
		fileTypeBreakdown,
		styleHints,
		languagePacks,
		scoutPack,
		discoveryPack,
		gitHints,
		repoSupport,
		cacheStatus,
		memoryBoundary,
		compactionPolicy,
		plannerSummary,
	}

	if (typeof options.fileList === "undefined" && fingerprint) {
		writeRepoIndexStateArtifact(workspace, {
			schemaVersion: 1,
			workspaceName: path.basename(workspace),
			generatedAt,
			fingerprint,
			files: fileSnapshots,
			memoryBoundary,
			compactionPolicy,
			repoMap,
		})
	}

	return repoMap
}

export function formatRepoMapArtifact(map: RepoMapArtifact): string {
	return [
		`Workspace: ${map.workspaceName}`,
		`Total files: ${map.totalFiles}`,
		`Top-level areas: ${
			map.topLevelEntries
				.map((entry) => (entry.kind === "dir" ? `${entry.path}(${entry.fileCount ?? 0})` : entry.path))
				.join(", ") || "(none)"
		}`,
		`Likely entry points: ${map.likelyEntryPoints.join(", ") || "(none)"}`,
		`Key files: ${map.keyFiles.join(", ") || "(none)"}`,
		`File types: ${map.fileTypeBreakdown.map((entry) => `${entry.extension}:${entry.count}`).join(", ") || "(none)"}`,
		`Style hints: dominant=${map.styleHints.dominantCodeExtension ?? "(none)"} imports=${map.styleHints.importStyle} names=${map.styleHints.fileNameStyles.join("/") || "(none)"}`,
		`Language packs: ${
			(map.languagePacks ?? []).map((pack) => formatLanguagePackSummary(pack)).join(", ") || "(none)"
		}`,
		`Scout pack: docs=${map.scoutPack?.docs.join(", ") || "(none)"} configs=${map.scoutPack?.configs.join(", ") || "(none)"} entryPoints=${map.scoutPack?.entryPoints.join(", ") || "(none)"} verification=${map.scoutPack?.verificationLanes.join(" | ") || "(none)"}`,
		...formatRepoDiscoveryPackSummary(map.discoveryPack, 3).split("\n"),
		map.repoSupport
			? `Repo tier: ${map.repoSupport.label} decision=${map.repoSupport.decision} files=${map.repoSupport.fileCount} bytes=${map.repoSupport.totalBytes}`
			: "Repo tier: (none)",
		map.cacheStatus?.fingerprint
			? `Repo index cache: ${map.cacheStatus.mode} ${map.cacheStatus.fingerprint.slice(0, 12)} retained=${map.cacheStatus.retainedSnapshotCount ?? 1}`
			: "Repo index cache: (none)",
		map.memoryBoundary ? `Memory boundary: ${map.memoryBoundary.id} retention=${map.memoryBoundary.retentionRule}` : "Memory boundary: (none)",
		map.gitHints.workingTree === "not_repo"
			? "Git hints: not a git repo"
			: `Git hints: branch=${map.gitHints.branch ?? "(unknown)"} workingTree=${map.gitHints.workingTree} changed=${map.gitHints.changedFiles.join(", ") || "(none)"} recent=${map.gitHints.recentFiles.join(", ") || "(none)"}`,
	]
		.filter(Boolean)
		.join("\n")
}

export function formatRepoMapPromptSummary(map: RepoMapArtifact, maxLines = 6): string {
	return map.plannerSummary.slice(0, Math.max(1, maxLines)).join("\n")
}
