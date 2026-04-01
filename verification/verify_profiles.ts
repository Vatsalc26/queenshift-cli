import fs from "node:fs"
import path from "node:path"

import { buildModeSelectorDecision } from "../src/run/ModeSelector"
import { runRepoVerificationProfile } from "../src/run/VerificationProfile"
import {
	buildVerificationProfileManifest,
	listSupportedExecutorAdapterContracts,
	validateExecutorAdapterCatalog,
} from "../src/run/VerificationProfileCatalog"
import { copyBuiltInTestWorkspace } from "./test_workspace_baseline"

export type ProfilesHarnessResult = {
	matchingProfilePasses: boolean
	manifestBackedScriptPasses: boolean
	typescriptProfilePasses: boolean
	pythonProfilePasses: boolean
	vitestProfilePasses: boolean
	eslintProfilePasses: boolean
	pythonUnittestPasses: boolean
	goProfilePasses: boolean
	cargoProfilePasses: boolean
	matchingProfileFails: boolean
	noApplicableProfileReported: boolean
	blockedCommandRefused: boolean
	manifestDriftBlocked: boolean
	policyPackBlocksNpmTest: boolean
	timeoutSurfaced: boolean
	adapterContractsExplicit: boolean
	adapterCatalogDocsAligned: boolean
	languageMatrixDocsAligned: boolean
	frameworkConfidenceDocsAligned: boolean
	contributorProofLoopDocsAligned: boolean
	modeSelectorVisible: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function removePathRobust(targetPath: string): void {
	if (!fs.existsSync(targetPath)) return
	try {
		fs.rmSync(targetPath, {
			recursive: true,
			force: true,
			maxRetries: 20,
			retryDelay: 100,
		})
	} catch {
		// ignore best-effort cleanup failures on Windows temp dirs
	}
}

function createTempRepoCopy(rootDir: string, label: string): { repoPath: string; cleanup: () => void } {
	const repoPath = path.join(rootDir, "verification", `.tmp-profile-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	copyBuiltInTestWorkspace(rootDir, repoPath)
	const swarmDir = path.join(repoPath, ".swarm")
	removePathRobust(swarmDir)
	return {
		repoPath,
		cleanup: () => {
			removePathRobust(repoPath)
		},
	}
}

function writeJson(filePath: string, payload: Record<string, unknown>): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

function writePackageWithTestScript(repoPath: string, scriptBody: string): void {
	writeJson(path.join(repoPath, "package.json"), {
		name: "swarmcoder-v2-profile-fixture",
		private: true,
		type: "module",
		scripts: {
			test: `node ${scriptBody}`,
		},
	})
}

function writeProfile(
	repoPath: string,
	payload: {
		name: string
		profileClass?: string
		manifestHash?: string
		command: string
		cwd?: string
		timeoutMs?: number
		fileScopeHint?: string[]
	},
): void {
	writeJson(path.join(repoPath, ".swarmcoder.json"), {
		verificationProfile: payload,
	})
}

function writeManifestBackedProfile(
	repoPath: string,
	payload: {
		profileClass:
			| "local_npm_test_v1"
			| "local_node_verify_script_v1"
			| "local_npx_tsc_v1"
			| "local_python_pytest_v1"
			| "local_npx_vitest_v1"
			| "local_npx_eslint_v1"
			| "local_python_unittest_v1"
			| "local_go_test_v1"
			| "local_cargo_test_v1"
		name: string
		command: string
		cwd?: string
		timeoutMs?: number
		fileScopeHint?: string[]
		manifestHashOverride?: string
		policyPackId?: "oss_default_v1" | "ci_safe_v1" | "enterprise_strict_v1"
	},
): void {
	const manifest = buildVerificationProfileManifest({
		profileClass: payload.profileClass,
		name: payload.name,
		command: payload.command,
		cwd: payload.cwd ?? ".",
		timeoutMs: payload.timeoutMs ?? 60_000,
		fileScopeHint: payload.fileScopeHint ?? [],
	})
	writeProfile(repoPath, {
		name: manifest.name,
		profileClass: manifest.profileClass,
		manifestHash: payload.manifestHashOverride ?? manifest.manifestHash,
		command: manifest.command,
		cwd: manifest.cwd,
		timeoutMs: manifest.timeoutMs,
		fileScopeHint: manifest.fileScopeHint,
	})
	if (payload.policyPackId) {
		const current = JSON.parse(fs.readFileSync(path.join(repoPath, ".swarmcoder.json"), "utf8")) as Record<string, unknown>
		current["policyPack"] = { packId: payload.policyPackId }
		fs.writeFileSync(path.join(repoPath, ".swarmcoder.json"), `${JSON.stringify(current, null, 2)}\n`, "utf8")
	}
}

export async function runProfilesHarness(rootDir = resolveRootDir()): Promise<ProfilesHarnessResult> {
	const details: string[] = []
	const languagePacksText = fs.readFileSync(path.join(rootDir, "LANGUAGE_PACKS.md"), "utf8")
	const reliabilityMatrixText = fs.readFileSync(path.join(rootDir, "LANGUAGE_RELIABILITY_MATRIX.md"), "utf8")
	const verificationCatalogText = fs.readFileSync(path.join(rootDir, "VERIFICATION_CATALOG.md"), "utf8")
	const contributingText = fs.readFileSync(path.join(rootDir, "CONTRIBUTING.md"), "utf8")
	const contributorSourceCheckoutText = fs.readFileSync(path.join(rootDir, "CONTRIBUTOR_SOURCE_CHECKOUT.md"), "utf8")
	const supportedInstallText = fs.readFileSync(path.join(rootDir, "SUPPORTED_INSTALL_SURFACES.md"), "utf8")

	const passRepo = createTempRepoCopy(rootDir, "pass")
	const scriptRepo = createTempRepoCopy(rootDir, "script")
	const tsRepo = createTempRepoCopy(rootDir, "ts")
	const pythonRepo = createTempRepoCopy(rootDir, "python")
	const vitestRepo = createTempRepoCopy(rootDir, "vitest")
	const eslintRepo = createTempRepoCopy(rootDir, "eslint")
	const unittestRepo = createTempRepoCopy(rootDir, "unittest")
	const goRepo = createTempRepoCopy(rootDir, "go")
	const cargoRepo = createTempRepoCopy(rootDir, "cargo")
	const failRepo = createTempRepoCopy(rootDir, "fail")
	const scopedRepo = createTempRepoCopy(rootDir, "scope")
	const blockedRepo = createTempRepoCopy(rootDir, "blocked")
	const driftRepo = createTempRepoCopy(rootDir, "drift")
	const policyRepo = createTempRepoCopy(rootDir, "policy")
	const timeoutRepo = createTempRepoCopy(rootDir, "timeout")

	try {
		fs.writeFileSync(path.join(passRepo.repoPath, "test-pass.js"), "process.exit(0)\n", "utf8")
		writePackageWithTestScript(passRepo.repoPath, "test-pass.js")
		writeManifestBackedProfile(passRepo.repoPath, {
			profileClass: "local_npm_test_v1",
			name: "local-npm-test",
			command: "npm test",
			timeoutMs: 5_000,
		})
		const passResult = await runRepoVerificationProfile(passRepo.repoPath, passRepo.repoPath, ["hello.ts"], {
			isCodeChangingTask: true,
		})
		const matchingProfilePasses = passResult.status === "passed" && passResult.applied && passResult.exitCode === 0
		details.push(`pass status=${passResult.status}`)

		fs.mkdirSync(path.join(scriptRepo.repoPath, "scripts"), { recursive: true })
		fs.writeFileSync(path.join(scriptRepo.repoPath, "scripts", "verify.js"), "process.exit(0)\n", "utf8")
		writeManifestBackedProfile(scriptRepo.repoPath, {
			profileClass: "local_node_verify_script_v1",
			name: "local-node-verify-script",
			command: "node scripts/verify.js",
			timeoutMs: 5_000,
			fileScopeHint: ["hello.ts"],
		})
		const scriptResult = await runRepoVerificationProfile(scriptRepo.repoPath, scriptRepo.repoPath, ["hello.ts"], {
			isCodeChangingTask: true,
		})
		const manifestBackedScriptPasses =
			scriptResult.status === "passed" &&
			scriptResult.applied &&
			scriptResult.exitCode === 0 &&
			scriptResult.profileClass === "local_node_verify_script_v1"
		details.push(`script status=${scriptResult.status} class=${scriptResult.profileClass ?? "none"}`)

		fs.writeFileSync(
			path.join(tsRepo.repoPath, "npx.cmd"),
			"@echo off\r\nif /I \"%1\"==\"tsc\" exit /b 0\r\nexit /b 1\r\n",
			"utf8",
		)
		writeJson(path.join(tsRepo.repoPath, "tsconfig.json"), {
			compilerOptions: { target: "ES2022", module: "ESNext" },
		})
		writeManifestBackedProfile(tsRepo.repoPath, {
			profileClass: "local_npx_tsc_v1",
			name: "local-typescript-no-emit",
			command: "npx tsc --noEmit",
			timeoutMs: 5_000,
			fileScopeHint: ["hello.ts"],
		})
		const tsResult = await runRepoVerificationProfile(tsRepo.repoPath, tsRepo.repoPath, ["hello.ts"], {
			isCodeChangingTask: true,
		})
		const typescriptProfilePasses =
			tsResult.status === "passed" && tsResult.applied && tsResult.exitCode === 0 && tsResult.profileClass === "local_npx_tsc_v1"
		details.push(`ts status=${tsResult.status} class=${tsResult.profileClass ?? "none"}`)

		fs.writeFileSync(
			path.join(pythonRepo.repoPath, "python.cmd"),
			"@echo off\r\nif /I \"%1\"==\"-m\" if /I \"%2\"==\"pytest\" exit /b 0\r\nexit /b 1\r\n",
			"utf8",
		)
		fs.writeFileSync(path.join(pythonRepo.repoPath, "hello.py"), "def greet() -> str:\n    return 'hi'\n", "utf8")
		writeManifestBackedProfile(pythonRepo.repoPath, {
			profileClass: "local_python_pytest_v1",
			name: "local-python-pytest",
			command: "python -m pytest",
			timeoutMs: 5_000,
			fileScopeHint: ["hello.py"],
		})
		const pythonResult = await runRepoVerificationProfile(pythonRepo.repoPath, pythonRepo.repoPath, ["hello.py"], {
			isCodeChangingTask: true,
		})
		const pythonProfilePasses =
			pythonResult.status === "passed" &&
			pythonResult.applied &&
			pythonResult.exitCode === 0 &&
			pythonResult.profileClass === "local_python_pytest_v1"
		details.push(`python status=${pythonResult.status} class=${pythonResult.profileClass ?? "none"}`)

		fs.writeFileSync(
			path.join(vitestRepo.repoPath, "npx.cmd"),
			"@echo off\r\nif /I \"%1\"==\"vitest\" if /I \"%2\"==\"run\" exit /b 0\r\nexit /b 1\r\n",
			"utf8",
		)
		writeManifestBackedProfile(vitestRepo.repoPath, {
			profileClass: "local_npx_vitest_v1",
			name: "local-vitest-run",
			command: "npx vitest run",
			timeoutMs: 5_000,
			fileScopeHint: ["hello.ts"],
		})
		const vitestResult = await runRepoVerificationProfile(vitestRepo.repoPath, vitestRepo.repoPath, ["hello.ts"], {
			isCodeChangingTask: true,
		})
		const vitestProfilePasses =
			vitestResult.status === "passed" &&
			vitestResult.applied &&
			vitestResult.exitCode === 0 &&
			vitestResult.profileClass === "local_npx_vitest_v1"
		details.push(`vitest status=${vitestResult.status} class=${vitestResult.profileClass ?? "none"}`)

		fs.writeFileSync(
			path.join(eslintRepo.repoPath, "npx.cmd"),
			"@echo off\r\nif /I \"%1\"==\"eslint\" if \"%2\"==\".\" exit /b 0\r\nexit /b 1\r\n",
			"utf8",
		)
		writeManifestBackedProfile(eslintRepo.repoPath, {
			profileClass: "local_npx_eslint_v1",
			name: "local-eslint-repo",
			command: "npx eslint .",
			timeoutMs: 5_000,
			fileScopeHint: ["hello.ts"],
		})
		const eslintResult = await runRepoVerificationProfile(eslintRepo.repoPath, eslintRepo.repoPath, ["hello.ts"], {
			isCodeChangingTask: true,
		})
		const eslintProfilePasses =
			eslintResult.status === "passed" &&
			eslintResult.applied &&
			eslintResult.exitCode === 0 &&
			eslintResult.profileClass === "local_npx_eslint_v1"
		details.push(`eslint status=${eslintResult.status} class=${eslintResult.profileClass ?? "none"}`)

		fs.writeFileSync(
			path.join(unittestRepo.repoPath, "python.cmd"),
			"@echo off\r\nif /I \"%1\"==\"-m\" if /I \"%2\"==\"unittest\" exit /b 0\r\nexit /b 1\r\n",
			"utf8",
		)
		fs.writeFileSync(path.join(unittestRepo.repoPath, "hello.py"), "def greet() -> str:\n    return 'hi'\n", "utf8")
		writeManifestBackedProfile(unittestRepo.repoPath, {
			profileClass: "local_python_unittest_v1",
			name: "local-python-unittest",
			command: "python -m unittest",
			timeoutMs: 5_000,
			fileScopeHint: ["hello.py"],
		})
		const unittestResult = await runRepoVerificationProfile(unittestRepo.repoPath, unittestRepo.repoPath, ["hello.py"], {
			isCodeChangingTask: true,
		})
		const pythonUnittestPasses =
			unittestResult.status === "passed" &&
			unittestResult.applied &&
			unittestResult.exitCode === 0 &&
			unittestResult.profileClass === "local_python_unittest_v1"
		details.push(`unittest status=${unittestResult.status} class=${unittestResult.profileClass ?? "none"}`)

		fs.writeFileSync(path.join(goRepo.repoPath, "go.cmd"), "@echo off\r\nif \"%1\"==\"test\" exit /b 0\r\nexit /b 1\r\n", "utf8")
		fs.writeFileSync(path.join(goRepo.repoPath, "go.mod"), "module fixture\n\ngo 1.22\n", "utf8")
		writeManifestBackedProfile(goRepo.repoPath, {
			profileClass: "local_go_test_v1",
			name: "local-go-test",
			command: "go test ./...",
			timeoutMs: 5_000,
			fileScopeHint: ["hello.ts"],
		})
		const goResult = await runRepoVerificationProfile(goRepo.repoPath, goRepo.repoPath, ["hello.ts"], {
			isCodeChangingTask: true,
		})
		const goProfilePasses =
			goResult.status === "passed" &&
			goResult.applied &&
			goResult.exitCode === 0 &&
			goResult.profileClass === "local_go_test_v1"
		details.push(`go status=${goResult.status} class=${goResult.profileClass ?? "none"}`)

		fs.writeFileSync(path.join(cargoRepo.repoPath, "cargo.cmd"), "@echo off\r\nif \"%1\"==\"test\" exit /b 0\r\nexit /b 1\r\n", "utf8")
		fs.writeFileSync(path.join(cargoRepo.repoPath, "Cargo.toml"), "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\n", "utf8")
		writeManifestBackedProfile(cargoRepo.repoPath, {
			profileClass: "local_cargo_test_v1",
			name: "local-cargo-test",
			command: "cargo test",
			timeoutMs: 5_000,
			fileScopeHint: ["hello.ts"],
		})
		const cargoResult = await runRepoVerificationProfile(cargoRepo.repoPath, cargoRepo.repoPath, ["hello.ts"], {
			isCodeChangingTask: true,
		})
		const cargoProfilePasses =
			cargoResult.status === "passed" &&
			cargoResult.applied &&
			cargoResult.exitCode === 0 &&
			cargoResult.profileClass === "local_cargo_test_v1"
		details.push(`cargo status=${cargoResult.status} class=${cargoResult.profileClass ?? "none"}`)

		fs.writeFileSync(path.join(failRepo.repoPath, "test-fail.js"), "process.exit(3)\n", "utf8")
		writePackageWithTestScript(failRepo.repoPath, "test-fail.js")
		writeManifestBackedProfile(failRepo.repoPath, {
			profileClass: "local_npm_test_v1",
			name: "local-npm-test",
			command: "npm test",
			timeoutMs: 5_000,
		})
		const failResult = await runRepoVerificationProfile(failRepo.repoPath, failRepo.repoPath, ["hello.ts"], {
			isCodeChangingTask: true,
		})
		const matchingProfileFails = failResult.status === "failed" && failResult.applied && failResult.exitCode !== 0
		details.push(`fail status=${failResult.status} code=${String(failResult.exitCode)}`)

		writeProfile(scopedRepo.repoPath, {
			name: "docs-only-check",
			command: "npm test",
			timeoutMs: 5_000,
			fileScopeHint: ["docs/"],
		})
		const scopedResult = await runRepoVerificationProfile(scopedRepo.repoPath, scopedRepo.repoPath, ["hello.ts"], {
			isCodeChangingTask: true,
		})
		const noApplicableProfileReported =
			scopedResult.status === "not_applicable" && scopedResult.applicability === "scope_hint_miss"
		details.push(`scope status=${scopedResult.status} applicability=${scopedResult.applicability}`)

		writeProfile(blockedRepo.repoPath, { name: "unsafe-install", command: "npm install", timeoutMs: 5_000 })
		const blockedResult = await runRepoVerificationProfile(blockedRepo.repoPath, blockedRepo.repoPath, ["hello.ts"], {
			isCodeChangingTask: true,
		})
		const blockedCommandRefused = blockedResult.status === "blocked" && blockedResult.message.includes("CommandGate")
		details.push(`blocked status=${blockedResult.status}`)

		fs.writeFileSync(path.join(driftRepo.repoPath, "test-pass.js"), "process.exit(0)\n", "utf8")
		writePackageWithTestScript(driftRepo.repoPath, "test-pass.js")
		writeManifestBackedProfile(driftRepo.repoPath, {
			profileClass: "local_npm_test_v1",
			name: "local-npm-test",
			command: "npm test",
			timeoutMs: 5_000,
			manifestHashOverride: "stale-manifest-hash",
		})
		const driftResult = await runRepoVerificationProfile(driftRepo.repoPath, driftRepo.repoPath, ["hello.ts"], {
			isCodeChangingTask: true,
		})
		const manifestDriftBlocked = driftResult.status === "blocked" && driftResult.message.includes("manifestHash drifted")
		details.push(`drift status=${driftResult.status}`)

		fs.writeFileSync(path.join(policyRepo.repoPath, "test-pass.js"), "process.exit(0)\n", "utf8")
		writePackageWithTestScript(policyRepo.repoPath, "test-pass.js")
		writeManifestBackedProfile(policyRepo.repoPath, {
			profileClass: "local_npm_test_v1",
			name: "local-npm-test",
			command: "npm test",
			timeoutMs: 5_000,
			policyPackId: "enterprise_strict_v1",
		})
		const policyResult = await runRepoVerificationProfile(policyRepo.repoPath, policyRepo.repoPath, ["hello.ts"], {
			isCodeChangingTask: true,
		})
		const policyPackBlocksNpmTest = policyResult.status === "blocked" && policyResult.message.includes("enterprise_strict_v1")
		details.push(`policy status=${policyResult.status}`)

		fs.writeFileSync(path.join(timeoutRepo.repoPath, "test-timeout.js"), "setTimeout(() => process.exit(0), 10000)\n", "utf8")
		writePackageWithTestScript(timeoutRepo.repoPath, "test-timeout.js")
		writeManifestBackedProfile(timeoutRepo.repoPath, {
			profileClass: "local_npm_test_v1",
			name: "slow-test",
			command: "npm test",
			timeoutMs: 200,
		})
		const timeoutResult = await runRepoVerificationProfile(timeoutRepo.repoPath, timeoutRepo.repoPath, ["hello.ts"], {
			isCodeChangingTask: true,
		})
		const timeoutSurfaced = timeoutResult.status === "timed_out"
		details.push(`timeout status=${timeoutResult.status}`)

		const adapterContracts = listSupportedExecutorAdapterContracts()
		const adapterCatalogIssues = validateExecutorAdapterCatalog()
		const adapterContractsExplicit =
			adapterCatalogIssues.length === 0 &&
			adapterContracts.length >= 10 &&
			adapterContracts.every(
				(contract) =>
					contract.contractVersion === 1 &&
					contract.workspacePolicy === "repo_local_only" &&
					contract.shellOperatorsAllowed === false &&
					contract.hiddenInstallAllowed === false &&
					contract.networkAccessAllowed === false &&
					contract.manifestBackedProfileRequired === true &&
					contract.extensibility === "named_catalog_only" &&
					contract.allowedPolicyPacks.length > 0,
			)
		details.push(`adapter contracts explicit=${String(adapterContractsExplicit)}`)
		if (adapterCatalogIssues.length > 0) {
			details.push(`adapter catalog issues=${adapterCatalogIssues.join(" | ")}`)
		}

		const adapterCatalogDocsAligned =
			verificationCatalogText.includes("profiles:adapter-contracts") &&
			verificationCatalogText.includes("Adapter Contract Candidate") &&
			verificationCatalogText.includes("local workspace only") &&
			verificationCatalogText.includes("no shell chaining") &&
			verificationCatalogText.includes("no hidden installs") &&
			verificationCatalogText.includes("named catalog")
		details.push(`adapter catalog docs aligned=${String(adapterCatalogDocsAligned)}`)

		const languageMatrixDocsAligned =
			languagePacksText.includes("LANGUAGE_RELIABILITY_MATRIX.md") &&
			languagePacksText.includes("verification-only repo-map pack") &&
			languagePacksText.includes("local_go_test_v1") &&
			languagePacksText.includes("local_cargo_test_v1") &&
			reliabilityMatrixText.includes("JavaScript / TypeScript") &&
			reliabilityMatrixText.includes("Python") &&
			reliabilityMatrixText.includes("Go") &&
			reliabilityMatrixText.includes("Rust") &&
			reliabilityMatrixText.includes("verify:profiles") &&
			reliabilityMatrixText.includes("verify:live:beta") &&
			reliabilityMatrixText.includes("verification-only")
		details.push(`language docs aligned=${String(languageMatrixDocsAligned)}`)

		const frameworkConfidenceDocsAligned =
			languagePacksText.includes("framework hints") &&
			languagePacksText.includes("Vitest") &&
			languagePacksText.includes("Jest") &&
			languagePacksText.includes("ESLint") &&
			languagePacksText.includes("pytest") &&
			languagePacksText.includes("unittest") &&
			verificationCatalogText.includes("Language / framework evidence") &&
			verificationCatalogText.includes("JavaScript / TypeScript") &&
			verificationCatalogText.includes("Go") &&
			verificationCatalogText.includes("Rust")
		details.push(`framework docs aligned=${String(frameworkConfidenceDocsAligned)}`)

		const contributorProofLoopDocsAligned =
			verificationCatalogText.includes("Contributor-Safe Proof Loop") &&
			verificationCatalogText.includes("verify:pr") &&
			verificationCatalogText.includes("verify:profiles") &&
			verificationCatalogText.includes("verify:bundle:experience") &&
			contributingText.includes("Contributor-safe proof-first loop") &&
			contributingText.includes("CONTRIBUTOR_SOURCE_CHECKOUT.md") &&
			contributingText.includes("SUPPORT_ISSUE_INTAKE.md") &&
			contributorSourceCheckoutText.includes("Contributor Proof-First Loop") &&
			contributorSourceCheckoutText.includes("verify:pr") &&
			contributorSourceCheckoutText.includes("verify:profiles") &&
			contributorSourceCheckoutText.includes("verify:bundle:experience") &&
			supportedInstallText.includes("verify:pr") &&
			supportedInstallText.includes("verify:profiles") &&
			supportedInstallText.includes("verify:bundle:experience") &&
			supportedInstallText.includes("CONTRIBUTING.md") &&
			supportedInstallText.includes("CONTRIBUTOR_SOURCE_CHECKOUT.md")
		details.push(`contributor proof loop docs aligned=${String(contributorProofLoopDocsAligned)}`)

		const lowCostSelector = buildModeSelectorDecision({
			routing: {
				complexity: "SIMPLE",
				path: "small_task",
				usedModel: false,
				targetFiles: ["hello.ts"],
				selectorSource: "safe_single_file_template",
				reasonCodes: ["explicit_single_file", "safe_template_match", "prefer_low_cost_small_lane"],
				taskContract: null,
			},
			guardrailLimits: {
				maxModelCalls: 6,
				maxEstimatedTokens: 25_000,
			},
		})
		const mediumSelector = buildModeSelectorDecision({
			routing: {
				complexity: "COMPLEX",
				path: "medium",
				usedModel: false,
				targetFiles: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"],
				selectorSource: "explicit_targets",
				reasonCodes: ["explicit_file_targets", "medium_target_count", "prefer_deterministic_coordination"],
				taskContract: null,
			},
			guardrailLimits: {
				maxModelCalls: 9,
				maxEstimatedTokens: 42_500,
			},
		})
		const heavySelector = buildModeSelectorDecision({
			routing: {
				complexity: "COMPLEX",
				path: "complex",
				usedModel: true,
				targetFiles: [],
				selectorSource: "model_complex",
				reasonCodes: ["ambiguous_task_needs_classifier", "model_selected_complex", "reserve_heavier_swarm"],
				taskContract: null,
			},
			guardrailLimits: {
				maxModelCalls: 10,
				maxEstimatedTokens: 50_000,
			},
		})
		const modeSelectorVisible =
			lowCostSelector.modeId === "low_cost_small_lane" &&
			lowCostSelector.costTier === "low" &&
			lowCostSelector.reasonCodes.includes("guardrail_budget_low") &&
			mediumSelector.modeId === "high_context_medium_lane" &&
			mediumSelector.costTier === "high" &&
			mediumSelector.maxModelCalls === 9 &&
			mediumSelector.maxEstimatedTokens === 42_500 &&
			mediumSelector.reasonCodes.includes("guardrail_budget_high") &&
			heavySelector.modeId === "heavy_complex_lane" &&
			heavySelector.costTier === "high" &&
			heavySelector.maxModelCalls === 10 &&
			heavySelector.maxEstimatedTokens === 50_000 &&
			heavySelector.reasonCodes.includes("guardrail_budget_high")
		details.push(`mode selector visible=${String(modeSelectorVisible)}`)

		return {
			matchingProfilePasses,
			manifestBackedScriptPasses,
			typescriptProfilePasses,
			pythonProfilePasses,
			vitestProfilePasses,
			eslintProfilePasses,
			pythonUnittestPasses,
			goProfilePasses,
			cargoProfilePasses,
			matchingProfileFails,
			noApplicableProfileReported,
			blockedCommandRefused,
			manifestDriftBlocked,
			policyPackBlocksNpmTest,
			timeoutSurfaced,
			adapterContractsExplicit,
			adapterCatalogDocsAligned,
			languageMatrixDocsAligned,
			frameworkConfidenceDocsAligned,
			contributorProofLoopDocsAligned,
			modeSelectorVisible,
			details,
		}
	} finally {
		passRepo.cleanup()
		scriptRepo.cleanup()
		tsRepo.cleanup()
		pythonRepo.cleanup()
		vitestRepo.cleanup()
		eslintRepo.cleanup()
		unittestRepo.cleanup()
		goRepo.cleanup()
		cargoRepo.cleanup()
		failRepo.cleanup()
		scopedRepo.cleanup()
		blockedRepo.cleanup()
		driftRepo.cleanup()
		policyRepo.cleanup()
		timeoutRepo.cleanup()
	}
}

export function formatProfilesHarnessResult(result: ProfilesHarnessResult): string {
	return [
		`Matching profile runs and passes: ${result.matchingProfilePasses ? "PASS" : "FAIL"}`,
		`Manifest-backed verify script passes: ${result.manifestBackedScriptPasses ? "PASS" : "FAIL"}`,
		`TypeScript profile passes: ${result.typescriptProfilePasses ? "PASS" : "FAIL"}`,
		`Python profile passes: ${result.pythonProfilePasses ? "PASS" : "FAIL"}`,
		`Vitest profile passes: ${result.vitestProfilePasses ? "PASS" : "FAIL"}`,
		`ESLint profile passes: ${result.eslintProfilePasses ? "PASS" : "FAIL"}`,
		`Python unittest profile passes: ${result.pythonUnittestPasses ? "PASS" : "FAIL"}`,
		`Go profile passes: ${result.goProfilePasses ? "PASS" : "FAIL"}`,
		`Cargo profile passes: ${result.cargoProfilePasses ? "PASS" : "FAIL"}`,
		`Matching profile runs and fails: ${result.matchingProfileFails ? "PASS" : "FAIL"}`,
		`No applicable profile reported cleanly: ${result.noApplicableProfileReported ? "PASS" : "FAIL"}`,
		`Blocked command is refused: ${result.blockedCommandRefused ? "PASS" : "FAIL"}`,
		`Manifest drift is blocked: ${result.manifestDriftBlocked ? "PASS" : "FAIL"}`,
		`Policy pack blocks unsupported class: ${result.policyPackBlocksNpmTest ? "PASS" : "FAIL"}`,
		`Timeout is surfaced: ${result.timeoutSurfaced ? "PASS" : "FAIL"}`,
		`Adapter contracts stay explicit: ${result.adapterContractsExplicit ? "PASS" : "FAIL"}`,
		`Adapter catalog docs aligned: ${result.adapterCatalogDocsAligned ? "PASS" : "FAIL"}`,
		`Language matrix docs aligned: ${result.languageMatrixDocsAligned ? "PASS" : "FAIL"}`,
		`Framework confidence docs aligned: ${result.frameworkConfidenceDocsAligned ? "PASS" : "FAIL"}`,
		`Contributor proof-loop docs aligned: ${result.contributorProofLoopDocsAligned ? "PASS" : "FAIL"}`,
		`Mode selector visible: ${result.modeSelectorVisible ? "PASS" : "FAIL"}`,
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runProfilesHarness()
	console.log(formatProfilesHarnessResult(result))
	process.exit(
		result.matchingProfilePasses &&
			result.manifestBackedScriptPasses &&
			result.typescriptProfilePasses &&
			result.pythonProfilePasses &&
			result.vitestProfilePasses &&
			result.eslintProfilePasses &&
			result.pythonUnittestPasses &&
			result.goProfilePasses &&
			result.cargoProfilePasses &&
			result.matchingProfileFails &&
			result.noApplicableProfileReported &&
			result.blockedCommandRefused &&
			result.manifestDriftBlocked &&
			result.policyPackBlocksNpmTest &&
			result.timeoutSurfaced &&
			result.adapterContractsExplicit &&
			result.adapterCatalogDocsAligned &&
			result.languageMatrixDocsAligned &&
			result.frameworkConfidenceDocsAligned &&
			result.contributorProofLoopDocsAligned &&
			result.modeSelectorVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:profiles] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
