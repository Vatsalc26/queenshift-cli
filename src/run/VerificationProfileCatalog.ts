import crypto from "node:crypto"

export type SupportedVerificationProfileClass =
	| "local_npm_test_v1"
	| "local_node_verify_script_v1"
	| "local_npx_tsc_v1"
	| "local_python_pytest_v1"
	| "local_npx_vitest_v1"
	| "local_npx_jest_v1"
	| "local_npx_eslint_v1"
	| "local_python_unittest_v1"
	| "local_go_test_v1"
	| "local_cargo_test_v1"

export type SupportedExecutorAdapterId =
	| "npm_test"
	| "node_verify_script"
	| "typescript_no_emit"
	| "python_pytest"
	| "vitest_run"
	| "jest_run_in_band"
	| "eslint_repo"
	| "python_unittest"
	| "go_test"
	| "cargo_test"

export type SupportedPolicyPackId = "oss_default_v1" | "ci_safe_v1" | "enterprise_strict_v1"

export type ExecutorAdapterCommandFamily =
	| "npm_script"
	| "node_script"
	| "npx_direct_tool"
	| "python_module"
	| "go_package"
	| "cargo_test"

export type ExecutorAdapterExecutionMode = "repo_script" | "direct_tool"
export type ExecutorAdapterWorkspacePolicy = "repo_local_only"
export type ExecutorAdapterExtensibility = "named_catalog_only"

export type VerificationProfileClassDefinition = {
	profileClass: SupportedVerificationProfileClass
	adapterId: SupportedExecutorAdapterId
	label: string
	description: string
	allowedCommands: string[]
	policyPacks: SupportedPolicyPackId[]
	recommendedFor: string[]
}

export type VerificationProfileManifestCore = {
	version: 1
	profileClass: SupportedVerificationProfileClass
	name: string
	command: string
	cwd: string
	timeoutMs: number
	fileScopeHint: string[]
}

export type VerificationProfileManifest = VerificationProfileManifestCore & {
	manifestHash: string
}

export type ExecutorAdapterDefinition = {
	adapterId: SupportedExecutorAdapterId
	label: string
	description: string
	profileClasses: SupportedVerificationProfileClass[]
	exampleCommands: string[]
	contractVersion: 1
	executionMode: ExecutorAdapterExecutionMode
	commandFamily: ExecutorAdapterCommandFamily
	workspacePolicy: ExecutorAdapterWorkspacePolicy
	shellOperatorsAllowed: false
	hiddenInstallAllowed: false
	networkAccessAllowed: false
	manifestBackedProfileRequired: true
	allowedPolicyPacks: SupportedPolicyPackId[]
	extensibility: ExecutorAdapterExtensibility
}

export type PolicyPackDefinition = {
	packId: SupportedPolicyPackId
	label: string
	description: string
	allowedProfileClasses: SupportedVerificationProfileClass[]
	notes: string[]
}

const SUPPORTED_PROFILE_CLASSES: VerificationProfileClassDefinition[] = [
	{
		profileClass: "local_npm_test_v1",
		adapterId: "npm_test",
		label: "Local npm test",
		description: "Runs the repo's checked-in npm test script through the verification profile path.",
		allowedCommands: ["npm test"],
		policyPacks: ["oss_default_v1", "ci_safe_v1"],
		recommendedFor: ["JavaScript / TypeScript repos with a trusted package.json test script"],
	},
	{
		profileClass: "local_node_verify_script_v1",
		adapterId: "node_verify_script",
		label: "Local node verify script",
		description: "Runs a checked-in node verification script at scripts/verify.js.",
		allowedCommands: ["node scripts/verify.js"],
		policyPacks: ["oss_default_v1", "ci_safe_v1", "enterprise_strict_v1"],
		recommendedFor: ["Repos that expose one checked-in deterministic verify entry point"],
	},
	{
		profileClass: "local_npx_tsc_v1",
		adapterId: "typescript_no_emit",
		label: "Local TypeScript no-emit check",
		description: "Runs a local TypeScript compile check without emitting files.",
		allowedCommands: ["npx tsc --noEmit"],
		policyPacks: ["oss_default_v1", "ci_safe_v1", "enterprise_strict_v1"],
		recommendedFor: ["TypeScript repos that should prove compilation without file output"],
	},
	{
		profileClass: "local_python_pytest_v1",
		adapterId: "python_pytest",
		label: "Local Python pytest",
		description: "Runs a local Python pytest verification command.",
		allowedCommands: ["python -m pytest"],
		policyPacks: ["oss_default_v1", "ci_safe_v1", "enterprise_strict_v1"],
		recommendedFor: ["Python repos that already use pytest"],
	},
	{
		profileClass: "local_npx_vitest_v1",
		adapterId: "vitest_run",
		label: "Local Vitest run",
		description: "Runs a checked-in Vitest suite through one bounded npx command.",
		allowedCommands: ["npx vitest run"],
		policyPacks: ["oss_default_v1", "ci_safe_v1"],
		recommendedFor: ["JavaScript / TypeScript repos with an explicit Vitest lane"],
	},
	{
		profileClass: "local_npx_jest_v1",
		adapterId: "jest_run_in_band",
		label: "Local Jest run",
		description: "Runs a checked-in Jest suite in one process for bounded verification.",
		allowedCommands: ["npx jest --runInBand"],
		policyPacks: ["oss_default_v1", "ci_safe_v1"],
		recommendedFor: ["JavaScript / TypeScript repos with an explicit Jest lane"],
	},
	{
		profileClass: "local_npx_eslint_v1",
		adapterId: "eslint_repo",
		label: "Local ESLint repo check",
		description: "Runs a repo-local ESLint pass without widening shell freedom.",
		allowedCommands: ["npx eslint ."],
		policyPacks: ["oss_default_v1", "ci_safe_v1"],
		recommendedFor: ["JavaScript / TypeScript repos that gate changes on lint"],
	},
	{
		profileClass: "local_python_unittest_v1",
		adapterId: "python_unittest",
		label: "Local Python unittest",
		description: "Runs the standard-library Python unittest discovery command.",
		allowedCommands: ["python -m unittest"],
		policyPacks: ["oss_default_v1", "ci_safe_v1", "enterprise_strict_v1"],
		recommendedFor: ["Python repos that do not use pytest"],
	},
	{
		profileClass: "local_go_test_v1",
		adapterId: "go_test",
		label: "Local Go test",
		description: "Runs the bounded Go package test command.",
		allowedCommands: ["go test ./..."],
		policyPacks: ["oss_default_v1", "ci_safe_v1", "enterprise_strict_v1"],
		recommendedFor: ["Go repos with a conventional module-wide test lane"],
	},
	{
		profileClass: "local_cargo_test_v1",
		adapterId: "cargo_test",
		label: "Local Cargo test",
		description: "Runs the bounded Rust cargo test command.",
		allowedCommands: ["cargo test"],
		policyPacks: ["oss_default_v1", "ci_safe_v1", "enterprise_strict_v1"],
		recommendedFor: ["Rust repos with a conventional cargo test lane"],
	},
]

const SUPPORTED_EXECUTOR_ADAPTERS: ExecutorAdapterDefinition[] = [
	{
		adapterId: "npm_test",
		label: "npm test adapter",
		description: "Runs one repo-owned npm test entry through the bounded verification path.",
		profileClasses: ["local_npm_test_v1"],
		exampleCommands: ["npm test"],
		contractVersion: 1,
		executionMode: "repo_script",
		commandFamily: "npm_script",
		workspacePolicy: "repo_local_only",
		shellOperatorsAllowed: false,
		hiddenInstallAllowed: false,
		networkAccessAllowed: false,
		manifestBackedProfileRequired: true,
		allowedPolicyPacks: ["oss_default_v1", "ci_safe_v1"],
		extensibility: "named_catalog_only",
	},
	{
		adapterId: "node_verify_script",
		label: "node verify script adapter",
		description: "Runs one checked-in node verification script with no extra shell chaining.",
		profileClasses: ["local_node_verify_script_v1"],
		exampleCommands: ["node scripts/verify.js"],
		contractVersion: 1,
		executionMode: "repo_script",
		commandFamily: "node_script",
		workspacePolicy: "repo_local_only",
		shellOperatorsAllowed: false,
		hiddenInstallAllowed: false,
		networkAccessAllowed: false,
		manifestBackedProfileRequired: true,
		allowedPolicyPacks: ["oss_default_v1", "ci_safe_v1", "enterprise_strict_v1"],
		extensibility: "named_catalog_only",
	},
	{
		adapterId: "typescript_no_emit",
		label: "TypeScript no-emit adapter",
		description: "Runs a repo-local TypeScript compile check without file output.",
		profileClasses: ["local_npx_tsc_v1"],
		exampleCommands: ["npx tsc --noEmit"],
		contractVersion: 1,
		executionMode: "direct_tool",
		commandFamily: "npx_direct_tool",
		workspacePolicy: "repo_local_only",
		shellOperatorsAllowed: false,
		hiddenInstallAllowed: false,
		networkAccessAllowed: false,
		manifestBackedProfileRequired: true,
		allowedPolicyPacks: ["oss_default_v1", "ci_safe_v1", "enterprise_strict_v1"],
		extensibility: "named_catalog_only",
	},
	{
		adapterId: "python_pytest",
		label: "Python pytest adapter",
		description: "Runs pytest through the bounded executor surface.",
		profileClasses: ["local_python_pytest_v1"],
		exampleCommands: ["python -m pytest"],
		contractVersion: 1,
		executionMode: "direct_tool",
		commandFamily: "python_module",
		workspacePolicy: "repo_local_only",
		shellOperatorsAllowed: false,
		hiddenInstallAllowed: false,
		networkAccessAllowed: false,
		manifestBackedProfileRequired: true,
		allowedPolicyPacks: ["oss_default_v1", "ci_safe_v1", "enterprise_strict_v1"],
		extensibility: "named_catalog_only",
	},
	{
		adapterId: "vitest_run",
		label: "Vitest adapter",
		description: "Runs a checked-in Vitest suite through one explicit command.",
		profileClasses: ["local_npx_vitest_v1"],
		exampleCommands: ["npx vitest run"],
		contractVersion: 1,
		executionMode: "direct_tool",
		commandFamily: "npx_direct_tool",
		workspacePolicy: "repo_local_only",
		shellOperatorsAllowed: false,
		hiddenInstallAllowed: false,
		networkAccessAllowed: false,
		manifestBackedProfileRequired: true,
		allowedPolicyPacks: ["oss_default_v1", "ci_safe_v1"],
		extensibility: "named_catalog_only",
	},
	{
		adapterId: "jest_run_in_band",
		label: "Jest adapter",
		description: "Runs a checked-in Jest suite serially through one explicit command.",
		profileClasses: ["local_npx_jest_v1"],
		exampleCommands: ["npx jest --runInBand"],
		contractVersion: 1,
		executionMode: "direct_tool",
		commandFamily: "npx_direct_tool",
		workspacePolicy: "repo_local_only",
		shellOperatorsAllowed: false,
		hiddenInstallAllowed: false,
		networkAccessAllowed: false,
		manifestBackedProfileRequired: true,
		allowedPolicyPacks: ["oss_default_v1", "ci_safe_v1"],
		extensibility: "named_catalog_only",
	},
	{
		adapterId: "eslint_repo",
		label: "ESLint adapter",
		description: "Runs a repo-local ESLint pass as a bounded static-analysis adapter.",
		profileClasses: ["local_npx_eslint_v1"],
		exampleCommands: ["npx eslint ."],
		contractVersion: 1,
		executionMode: "direct_tool",
		commandFamily: "npx_direct_tool",
		workspacePolicy: "repo_local_only",
		shellOperatorsAllowed: false,
		hiddenInstallAllowed: false,
		networkAccessAllowed: false,
		manifestBackedProfileRequired: true,
		allowedPolicyPacks: ["oss_default_v1", "ci_safe_v1"],
		extensibility: "named_catalog_only",
	},
	{
		adapterId: "python_unittest",
		label: "Python unittest adapter",
		description: "Runs Python's standard-library unittest discovery path.",
		profileClasses: ["local_python_unittest_v1"],
		exampleCommands: ["python -m unittest"],
		contractVersion: 1,
		executionMode: "direct_tool",
		commandFamily: "python_module",
		workspacePolicy: "repo_local_only",
		shellOperatorsAllowed: false,
		hiddenInstallAllowed: false,
		networkAccessAllowed: false,
		manifestBackedProfileRequired: true,
		allowedPolicyPacks: ["oss_default_v1", "ci_safe_v1", "enterprise_strict_v1"],
		extensibility: "named_catalog_only",
	},
	{
		adapterId: "go_test",
		label: "Go test adapter",
		description: "Runs the standard bounded Go package test lane.",
		profileClasses: ["local_go_test_v1"],
		exampleCommands: ["go test ./..."],
		contractVersion: 1,
		executionMode: "direct_tool",
		commandFamily: "go_package",
		workspacePolicy: "repo_local_only",
		shellOperatorsAllowed: false,
		hiddenInstallAllowed: false,
		networkAccessAllowed: false,
		manifestBackedProfileRequired: true,
		allowedPolicyPacks: ["oss_default_v1", "ci_safe_v1", "enterprise_strict_v1"],
		extensibility: "named_catalog_only",
	},
	{
		adapterId: "cargo_test",
		label: "Cargo test adapter",
		description: "Runs the standard bounded Rust cargo test lane.",
		profileClasses: ["local_cargo_test_v1"],
		exampleCommands: ["cargo test"],
		contractVersion: 1,
		executionMode: "direct_tool",
		commandFamily: "cargo_test",
		workspacePolicy: "repo_local_only",
		shellOperatorsAllowed: false,
		hiddenInstallAllowed: false,
		networkAccessAllowed: false,
		manifestBackedProfileRequired: true,
		allowedPolicyPacks: ["oss_default_v1", "ci_safe_v1", "enterprise_strict_v1"],
		extensibility: "named_catalog_only",
	},
]

const SUPPORTED_POLICY_PACKS: PolicyPackDefinition[] = [
	{
		packId: "oss_default_v1",
		label: "OSS default",
		description: "Default open-source-safe executor mix for local contributor and owner repos.",
		allowedProfileClasses: SUPPORTED_PROFILE_CLASSES.map((entry) => entry.profileClass),
		notes: [
			"Allows the full bounded executor catalog.",
			"Best fit for trusted local repos that already use the supported command shapes.",
		],
	},
	{
		packId: "ci_safe_v1",
		label: "CI-safe",
		description: "Keeps the same bounded local command families but prefers deterministic single-command proof lanes.",
		allowedProfileClasses: [
			"local_npm_test_v1",
			"local_node_verify_script_v1",
			"local_npx_tsc_v1",
			"local_python_pytest_v1",
			"local_npx_vitest_v1",
			"local_npx_jest_v1",
			"local_npx_eslint_v1",
			"local_python_unittest_v1",
			"local_go_test_v1",
			"local_cargo_test_v1",
		],
		notes: [
			"Use this when you want one contributor-safe or PR-safe command path.",
			"Still refuses unsupported shell expansion and hidden install steps.",
		],
	},
	{
		packId: "enterprise_strict_v1",
		label: "Enterprise strict",
		description: "Restricts verification to direct tool invocations and checked-in verify scripts.",
		allowedProfileClasses: [
			"local_node_verify_script_v1",
			"local_npx_tsc_v1",
			"local_python_pytest_v1",
			"local_python_unittest_v1",
			"local_go_test_v1",
			"local_cargo_test_v1",
		],
		notes: [
			"Excludes package-manager test wrappers such as npm test.",
			"Useful when policy prefers direct checked-in tooling over package-script indirection.",
		],
	},
]

function normalizeRelPath(value: string): string {
	return value.replace(/[\\/]+/g, "/").replace(/^\.\/+/u, "").trim()
}

function uniqueSorted(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => normalizeRelPath(value)).filter(Boolean))).sort((left, right) =>
		left.localeCompare(right),
	)
}

export function listSupportedVerificationProfileClasses(): VerificationProfileClassDefinition[] {
	return SUPPORTED_PROFILE_CLASSES.map((entry) => ({
		...entry,
		allowedCommands: [...entry.allowedCommands],
		policyPacks: [...entry.policyPacks],
		recommendedFor: [...entry.recommendedFor],
	}))
}

export function getSupportedVerificationProfileClass(
	profileClass: string | null | undefined,
): VerificationProfileClassDefinition | null {
	if (!profileClass) return null
	return SUPPORTED_PROFILE_CLASSES.find((entry) => entry.profileClass === profileClass) ?? null
}

export function listSupportedExecutorAdapters(): ExecutorAdapterDefinition[] {
	return SUPPORTED_EXECUTOR_ADAPTERS.map((entry) => ({
		...entry,
		profileClasses: [...entry.profileClasses],
		exampleCommands: [...entry.exampleCommands],
		allowedPolicyPacks: [...entry.allowedPolicyPacks],
	}))
}

export function listSupportedExecutorAdapterContracts(): ExecutorAdapterDefinition[] {
	return listSupportedExecutorAdapters()
}

export function getSupportedExecutorAdapter(
	adapterId: string | null | undefined,
): ExecutorAdapterDefinition | null {
	if (!adapterId) return null
	return SUPPORTED_EXECUTOR_ADAPTERS.find((entry) => entry.adapterId === adapterId) ?? null
}

export function listSupportedPolicyPacks(): PolicyPackDefinition[] {
	return SUPPORTED_POLICY_PACKS.map((entry) => ({
		...entry,
		allowedProfileClasses: [...entry.allowedProfileClasses],
		notes: [...entry.notes],
	}))
}

export function getSupportedPolicyPack(packId: string | null | undefined): PolicyPackDefinition | null {
	if (!packId) return null
	return SUPPORTED_POLICY_PACKS.find((entry) => entry.packId === packId) ?? null
}

export function formatSupportedVerificationProfileClasses(): string {
	return SUPPORTED_PROFILE_CLASSES.map((entry) => `${entry.profileClass} (${entry.allowedCommands.join(" | ")})`).join(", ")
}

export function formatSupportedExecutorAdapters(): string {
	return SUPPORTED_EXECUTOR_ADAPTERS.map((entry) => `${entry.adapterId} (${entry.exampleCommands.join(" | ")})`).join(", ")
}

export function formatSupportedExecutorAdapterContracts(): string {
	return SUPPORTED_EXECUTOR_ADAPTERS.map((entry) =>
		`${entry.adapterId} [v${entry.contractVersion}] mode=${entry.executionMode} family=${entry.commandFamily} workspace=${entry.workspacePolicy} shell=forbidden hiddenInstall=forbidden network=forbidden packs=${entry.allowedPolicyPacks.join("/")}`,
	).join("\n")
}

export function validateExecutorAdapterCatalog(): string[] {
	const issues: string[] = []
	for (const adapter of SUPPORTED_EXECUTOR_ADAPTERS) {
		if (adapter.contractVersion !== 1) {
			issues.push(`Adapter ${adapter.adapterId} must keep contractVersion=1.`)
		}
		if (adapter.workspacePolicy !== "repo_local_only") {
			issues.push(`Adapter ${adapter.adapterId} widened workspace policy unexpectedly.`)
		}
		if (adapter.shellOperatorsAllowed || adapter.hiddenInstallAllowed || adapter.networkAccessAllowed) {
			issues.push(`Adapter ${adapter.adapterId} widened execution freedom unexpectedly.`)
		}
		if (!adapter.manifestBackedProfileRequired) {
			issues.push(`Adapter ${adapter.adapterId} must require a manifest-backed profile.`)
		}
		if (adapter.profileClasses.length === 0) {
			issues.push(`Adapter ${adapter.adapterId} must declare at least one profile class.`)
		}
		if (adapter.allowedPolicyPacks.length === 0) {
			issues.push(`Adapter ${adapter.adapterId} must declare at least one allowed policy pack.`)
		}
		for (const command of adapter.exampleCommands) {
			if (/[;&|><]/u.test(command)) {
				issues.push(`Adapter ${adapter.adapterId} example command widened into shell operators: ${command}`)
			}
		}
		const expectedCommands = uniqueSorted(
			adapter.profileClasses.flatMap((profileClass) => getSupportedVerificationProfileClass(profileClass)?.allowedCommands ?? []),
		)
		const actualCommands = uniqueSorted(adapter.exampleCommands)
		if (expectedCommands.join("|") !== actualCommands.join("|")) {
			issues.push(
				`Adapter ${adapter.adapterId} example commands drifted from profile-class commands. Expected ${expectedCommands.join(", ")} but found ${actualCommands.join(", ")}.`,
			)
		}
		for (const profileClass of adapter.profileClasses) {
			const profileDefinition = getSupportedVerificationProfileClass(profileClass)
			if (!profileDefinition) {
				issues.push(`Adapter ${adapter.adapterId} references unknown profile class ${profileClass}.`)
				continue
			}
			if (profileDefinition.adapterId !== adapter.adapterId) {
				issues.push(
					`Adapter ${adapter.adapterId} no longer matches profile class ${profileClass}; catalog drift detected.`,
				)
			}
			for (const packId of profileDefinition.policyPacks) {
				if (!adapter.allowedPolicyPacks.includes(packId)) {
					issues.push(
						`Adapter ${adapter.adapterId} is missing policy-pack ${packId} required by profile class ${profileClass}.`,
					)
				}
			}
		}
	}
	return issues
}

export function formatSupportedPolicyPacks(): string {
	return SUPPORTED_POLICY_PACKS.map((entry) => `${entry.packId} (${entry.allowedProfileClasses.join(" | ")})`).join(", ")
}

export function buildVerificationProfileManifestCore(input: {
	profileClass: SupportedVerificationProfileClass
	name: string
	command: string
	cwd: string
	timeoutMs: number
	fileScopeHint: string[]
}): VerificationProfileManifestCore {
	return {
		version: 1,
		profileClass: input.profileClass,
		name: input.name.trim(),
		command: input.command.trim(),
		cwd: normalizeRelPath(input.cwd) || ".",
		timeoutMs: Math.max(1, Math.floor(input.timeoutMs)),
		fileScopeHint: uniqueSorted(input.fileScopeHint),
	}
}

export function computeVerificationProfileManifestHash(core: VerificationProfileManifestCore): string {
	return crypto.createHash("sha256").update(JSON.stringify(core)).digest("hex")
}

export function buildVerificationProfileManifest(input: {
	profileClass: SupportedVerificationProfileClass
	name: string
	command: string
	cwd: string
	timeoutMs: number
	fileScopeHint: string[]
}): VerificationProfileManifest {
	const core = buildVerificationProfileManifestCore(input)
	return {
		...core,
		manifestHash: computeVerificationProfileManifestHash(core),
	}
}

export function validateVerificationProfileClassCommand(
	profileClass: SupportedVerificationProfileClass,
	command: string,
): string | null {
	const definition = getSupportedVerificationProfileClass(profileClass)
	if (!definition) {
		return `verificationProfile.profileClass must be one of: ${formatSupportedVerificationProfileClasses()}`
	}
	const normalizedCommand = command.trim()
	if (!definition.allowedCommands.includes(normalizedCommand)) {
		return `verificationProfile.command must match one of the supported commands for ${profileClass}: ${definition.allowedCommands.join(", ")}`
	}
	return null
}

export function validatePolicyPackProfileClass(
	packId: SupportedPolicyPackId,
	profileClass: SupportedVerificationProfileClass,
): string | null {
	const policyPack = getSupportedPolicyPack(packId)
	if (!policyPack) {
		return `policyPack.packId must be one of: ${formatSupportedPolicyPacks()}`
	}
	if (!policyPack.allowedProfileClasses.includes(profileClass)) {
		return `Policy pack ${packId} does not allow verificationProfile.profileClass=${profileClass}. Allowed classes: ${policyPack.allowedProfileClasses.join(", ")}`
	}
	return null
}
