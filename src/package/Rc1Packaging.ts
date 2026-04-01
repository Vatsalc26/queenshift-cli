import fs from "node:fs"
import path from "node:path"

export type Rc1BundleManifest = {
	version: string
	releaseChannel: "rc1"
	supportedInstallPath: string
	builtAt: string
	supportedNodeVersion: string
	builtWithNodeVersion: string
	bundleRootName: string
	entryPoints: {
		installCheck: string
		providerDiagnose: string
		ownerGuidedDemo: string
		openThinShell: string
		safeTaskDryRun: string
		latestIncident: string
		latestReplay: string
		demoGallery: string
		demoRun: string
		demoReset: string
	}
}

export type Rc1BundleResult = {
	bundleDir: string
	manifestPath: string
	manifest: Rc1BundleManifest
}

export type Rc1PrerequisiteState = {
	currentNodeVersion: string | null
	supportedNodeVersion: string | null
	gitAvailable: boolean
	bundleHasCli: boolean
	bundleHasNodeModules: boolean
}

function resolveRootDir(fromDir = __dirname): string {
	const candidates = [path.resolve(fromDir, "../.."), path.resolve(fromDir, "../../..")]
	for (const candidate of candidates) {
		if (fs.existsSync(path.join(candidate, "package.json"))) return candidate
	}
	return path.resolve(fromDir, "../..")
}

function readPackageVersion(rootDir: string): string {
	const raw = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version?: string }
	return raw.version ?? "0.1.0-rc1"
}

function readPackageNodeEngine(rootDir: string): string | null {
	const raw = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as {
		engines?: { node?: string }
	}
	return raw.engines?.node?.trim() ?? null
}

export function readRc1SupportedNodeVersion(rootDir = resolveRootDir()): string {
	const supportedNodeVersion = fs.readFileSync(path.join(rootDir, ".nvmrc"), "utf8").trim()
	if (!supportedNodeVersion) {
		throw new Error("RC1 packaging requires a non-empty .nvmrc supported Node version.")
	}
	return supportedNodeVersion
}

function ensureDir(dirPath: string): void {
	fs.mkdirSync(dirPath, { recursive: true })
}

function clearReadonlyBitRecursive(targetPath: string): void {
	if (!fs.existsSync(targetPath)) return

	let stat: fs.Stats
	try {
		stat = fs.lstatSync(targetPath)
	} catch {
		return
	}

	try {
		fs.chmodSync(targetPath, stat.isDirectory() ? 0o777 : 0o666)
	} catch {
		// best effort only
	}

	if (!stat.isDirectory()) return

	for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
		clearReadonlyBitRecursive(path.join(targetPath, entry.name))
	}
}

function removePathRobust(targetPath: string): void {
	if (!fs.existsSync(targetPath)) return

	const attemptRemove = () =>
		fs.rmSync(targetPath, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		})

	try {
		attemptRemove()
	} catch {
		clearReadonlyBitRecursive(targetPath)
		attemptRemove()
	}
}

function copyVerificationTestWorkspace(rootDir: string, destinationRoot: string): void {
	const sourcePath = path.join(rootDir, "verification", "test_workspace")
	const destinationPath = path.join(destinationRoot, "verification", "test_workspace")
	if (!fs.existsSync(sourcePath)) {
		throw new Error(`RC1 packaging source is missing: ${sourcePath}`)
	}

	ensureDir(path.dirname(destinationPath))
	fs.cpSync(sourcePath, destinationPath, {
		recursive: true,
		force: true,
		filter: (src) => {
			const relative = path.relative(sourcePath, src)
			if (!relative) return true
			const segments = relative.split(/[\\/]+/g)
			return !segments.includes(".git") && !segments.includes(".swarm")
		},
	})
}

function copyIntoBundle(rootDir: string, destinationRoot: string, relativePath: string): void {
	if (relativePath === "verification/test_workspace") {
		copyVerificationTestWorkspace(rootDir, destinationRoot)
		return
	}

	const sourcePath = path.join(rootDir, relativePath)
	const destinationPath = path.join(destinationRoot, relativePath)
	if (!fs.existsSync(sourcePath)) {
		throw new Error(`RC1 packaging source is missing: ${sourcePath}`)
	}
	ensureDir(path.dirname(destinationPath))
	fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true })
}

function getNodeMajor(version: string | null): string | null {
	if (!version) return null
	const match = /^v?(\d+)\./u.exec(version.trim())
	return match?.[1] ?? null
}

export function buildRc1SupportedNodeRange(version: string): string {
	const normalizedVersion = version.trim().replace(/^v/u, "")
	const major = Number.parseInt(getNodeMajor(version) ?? "", 10)
	if (!normalizedVersion || !Number.isInteger(major)) {
		throw new Error(`Cannot derive RC1 supported Node range from version: ${version}`)
	}
	return `>=${normalizedVersion} <${major + 1}`
}

function validateRc1RuntimeContract(rootDir: string, supportedNodeVersion: string): void {
	const expectedRange = buildRc1SupportedNodeRange(supportedNodeVersion)
	const declaredRange = readPackageNodeEngine(rootDir)
	if (declaredRange !== expectedRange) {
		throw new Error(
			`package.json engines.node must be ${expectedRange} to match .nvmrc (${supportedNodeVersion}), got ${declaredRange ?? "(missing)"}.`,
		)
	}

	const supportedMajor = getNodeMajor(supportedNodeVersion)
	const buildMajor = getNodeMajor(process.version)
	if (supportedMajor && buildMajor && supportedMajor !== buildMajor) {
		throw new Error(
			`RC1 bundle must be built on Node ${supportedNodeVersion} major ${supportedMajor}, but the current build runtime is ${process.version}.`,
		)
	}
}

export function validateRc1Prerequisites(state: Rc1PrerequisiteState): string | null {
	if (!state.currentNodeVersion) {
		return "Node.js is required on PATH before this RC1 bundle can run."
	}
	if (!state.gitAvailable) {
		return "Git is required on PATH before this RC1 bundle can run."
	}
	if (!state.bundleHasCli) {
		return "The bundled dist/swarm.js entry is missing. Rebuild the RC1 bundle."
	}
	if (!state.bundleHasNodeModules) {
		return "The bundled node_modules directory is missing. Rebuild the RC1 bundle."
	}

	const expectedMajor = getNodeMajor(state.supportedNodeVersion)
	const currentMajor = getNodeMajor(state.currentNodeVersion)
	if (expectedMajor && currentMajor && expectedMajor !== currentMajor) {
		return `This RC1 bundle supports Node ${state.supportedNodeVersion}, but the current runtime is ${state.currentNodeVersion}. Use the same supported Node major for the bundled native modules.`
	}

	return null
}

function buildInstallCheckScript(manifest: Rc1BundleManifest): string {
	return [
		"$ErrorActionPreference = 'Stop'",
		"$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path",
		"$bundleRoot = Resolve-Path (Join-Path $scriptRoot '..')",
		`$supportedNode = '${manifest.supportedNodeVersion}'`,
		`$builtWithNode = '${manifest.builtWithNodeVersion}'`,
		"Write-Output \"SwarmCoder V2 RC1\"",
		`Write-Output \"Version: ${manifest.version}\"`,
		"Write-Output \"Supported Node: $supportedNode\"",
		"Write-Output \"Bundle built with: $builtWithNode\"",
		"if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'Node.js is required on PATH before this RC1 bundle can run.'; exit 1 }",
		"if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Error 'Git is required on PATH before this RC1 bundle can run.'; exit 1 }",
		"$currentNode = (node -v).Trim()",
		"$gitVersion = ((git --version) | Select-Object -First 1).Trim()",
		"$expectedMajor = ($supportedNode -replace '^v?(\\d+)\\..*$', '$1')",
		"$currentMajor = ($currentNode -replace '^v?(\\d+)\\..*$', '$1')",
		"if ($expectedMajor -and $currentMajor -and $expectedMajor -ne $currentMajor) {",
		"  Write-Error \"This RC1 bundle supports Node $supportedNode, but the current runtime is $currentNode. Use the same supported Node major for the bundled native modules.\"",
		"  exit 1",
		"}",
		"if (-not (Test-Path (Join-Path $bundleRoot 'dist\\swarm.js'))) { Write-Error 'The bundled dist/swarm.js entry is missing. Rebuild the RC1 bundle.'; exit 1 }",
		"if (-not (Test-Path (Join-Path $bundleRoot 'node_modules'))) { Write-Error 'The bundled node_modules directory is missing. Rebuild the RC1 bundle.'; exit 1 }",
		"Write-Output \"Detected Node: $currentNode\"",
		"Write-Output \"Detected Git: $gitVersion\"",
		"Write-Output 'RC1 bundle check: PASS'",
		"Write-Output 'Next steps:'",
		"Write-Output '  powershell -ExecutionPolicy Bypass -File scripts\\rc1_provider_diagnose.ps1'",
		"Write-Output '  powershell -ExecutionPolicy Bypass -File scripts\\rc1_owner_guided_demo.ps1'",
		"Write-Output '  powershell -ExecutionPolicy Bypass -File scripts\\rc1_open_thin_shell.ps1'",
		"Write-Output '  powershell -ExecutionPolicy Bypass -File scripts\\rc1_safe_task_dry_run.ps1'",
		"Write-Output '  powershell -ExecutionPolicy Bypass -File scripts\\rc1_demo_gallery.ps1'",
		"Write-Output '  powershell -ExecutionPolicy Bypass -File scripts\\rc1_demo_run.ps1'",
		"Write-Output '  powershell -ExecutionPolicy Bypass -File scripts\\rc1_latest_replay.ps1'",
	].join("\n")
}

function buildOpenThinShellScript(manifest: Rc1BundleManifest): string {
	return [
		"$ErrorActionPreference = 'Stop'",
		"$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path",
		"$bundleRoot = Resolve-Path (Join-Path $scriptRoot '..')",
		"if (-not (Get-Command code -ErrorAction SilentlyContinue)) { Write-Error \"VS Code's 'code' command is required on PATH to open the thin shell.\"; exit 1 }",
		"Write-Output \"Opening SwarmCoder V2 Thin Shell...\"",
		"& code --new-window --extensionDevelopmentPath (Join-Path $bundleRoot 'vscode_shell')",
	].join("\n")
}

function buildProviderDiagnoseScript(): string {
	return [
		"$ErrorActionPreference = 'Stop'",
		"$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path",
		"$bundleRoot = Resolve-Path (Join-Path $scriptRoot '..')",
		"& node (Join-Path $bundleRoot 'dist\\swarm.js') owner:provider:diagnose",
		"exit $LASTEXITCODE",
	].join("\n")
}

function buildOwnerGuidedDemoScript(): string {
	return [
		"param([switch]$Debug)",
		"$ErrorActionPreference = 'Stop'",
		"$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path",
		"$bundleRoot = Resolve-Path (Join-Path $scriptRoot '..')",
		"$args = @('owner:guided:demo')",
		"if ($Debug) { $args += '--debug' }",
		"& node (Join-Path $bundleRoot 'dist\\swarm.js') @args",
		"exit $LASTEXITCODE",
	].join("\n")
}

function buildSafeTaskDryRunScript(): string {
	return [
		"param([string]$Workspace = '')",
		"$ErrorActionPreference = 'Stop'",
		"$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path",
		"$bundleRoot = Resolve-Path (Join-Path $scriptRoot '..')",
		"function Initialize-SmokeWorkspace([string]$TargetWorkspace) {",
		"  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Error 'Git is required on PATH before this RC1 bundle can run.'; exit 1 }",
		"  $gitDir = Join-Path $TargetWorkspace '.git'",
		"  if (Test-Path $gitDir) {",
		"    & git -c \"safe.directory=$TargetWorkspace\" -C $TargetWorkspace reset --hard HEAD | Out-Null",
		"    & git -c \"safe.directory=$TargetWorkspace\" -C $TargetWorkspace clean -fdx | Out-Null",
		"    return",
		"  }",
		"  if (Test-Path (Join-Path $TargetWorkspace '.swarm')) { Remove-Item -Recurse -Force (Join-Path $TargetWorkspace '.swarm') }",
		"  & git -c \"safe.directory=$TargetWorkspace\" -C $TargetWorkspace init | Out-Null",
		"  & git -c \"safe.directory=$TargetWorkspace\" -C $TargetWorkspace config user.name 'SwarmCoder RC1' | Out-Null",
		"  & git -c \"safe.directory=$TargetWorkspace\" -C $TargetWorkspace config user.email 'rc1@local.invalid' | Out-Null",
		"  & git -c \"safe.directory=$TargetWorkspace\" -C $TargetWorkspace add --all | Out-Null",
		"  & git -c \"safe.directory=$TargetWorkspace\" -C $TargetWorkspace commit -m 'rc1 smoke baseline' | Out-Null",
		"}",
		"if (-not $Workspace) {",
		"  $Workspace = Join-Path $bundleRoot 'verification\\test_workspace'",
		"  Write-Output 'Using the bundled starter workspace for dry-run smoke only. RC1 streak credit requires a real non-verification repo.'",
		"  Initialize-SmokeWorkspace $Workspace",
		"}",
		"& node (Join-Path $bundleRoot 'dist\\swarm.js') --task \"add a brief comment to hello.ts\" --workspace $Workspace --dryRun",
		"exit $LASTEXITCODE",
	].join("\n")
}

function buildLatestIncidentScript(): string {
	return [
		"param([string]$Workspace = '')",
		"$ErrorActionPreference = 'Stop'",
		"$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path",
		"$bundleRoot = Resolve-Path (Join-Path $scriptRoot '..')",
		"if (-not $Workspace) {",
		"  $Workspace = Join-Path $bundleRoot 'verification\\test_workspace'",
		"  Write-Output 'Using the bundled starter workspace for dry-run smoke only. RC1 streak credit requires a real non-verification repo.'",
		"}",
		"& node (Join-Path $bundleRoot 'dist\\swarm.js') incident:latest --workspace $Workspace",
		"exit $LASTEXITCODE",
	].join("\n")
}

function buildLatestReplayScript(): string {
	return [
		"param([string]$Workspace = '')",
		"$ErrorActionPreference = 'Stop'",
		"$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path",
		"$bundleRoot = Resolve-Path (Join-Path $scriptRoot '..')",
		"if (-not $Workspace) {",
		"  $Workspace = Join-Path $bundleRoot 'verification\\.demo_repo_workspace'",
		"  Write-Output 'Using the bundled disposable demo workspace. Run rc1_demo_run.ps1 first if you want a fresh replay artifact there.'",
		"}",
		"& node (Join-Path $bundleRoot 'dist\\swarm.js') replay:latest --workspace $Workspace",
		"exit $LASTEXITCODE",
	].join("\n")
}

function buildDemoGalleryScript(): string {
	return [
		"$ErrorActionPreference = 'Stop'",
		"$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path",
		"$bundleRoot = Resolve-Path (Join-Path $scriptRoot '..')",
		"& node (Join-Path $bundleRoot 'dist\\swarm.js') demo:gallery",
		"exit $LASTEXITCODE",
	].join("\n")
}

function buildDemoRunScript(): string {
	return [
		"param([switch]$Debug)",
		"$ErrorActionPreference = 'Stop'",
		"$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path",
		"$bundleRoot = Resolve-Path (Join-Path $scriptRoot '..')",
		"$args = @('demo:run')",
		"if ($Debug) { $args += '--debug' }",
		"& node (Join-Path $bundleRoot 'dist\\swarm.js') @args",
		"exit $LASTEXITCODE",
	].join("\n")
}

function buildDemoResetScript(): string {
	return [
		"$ErrorActionPreference = 'Stop'",
		"$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path",
		"$bundleRoot = Resolve-Path (Join-Path $scriptRoot '..')",
		"& node (Join-Path $bundleRoot 'dist\\swarm.js') demo:reset",
		"exit $LASTEXITCODE",
	].join("\n")
}

function writeRc1Scripts(bundleDir: string, manifest: Rc1BundleManifest): void {
	const scriptsDir = path.join(bundleDir, "scripts")
	ensureDir(scriptsDir)
	fs.writeFileSync(path.join(scriptsDir, "rc1_install_check.ps1"), `${buildInstallCheckScript(manifest)}\n`, "utf8")
	fs.writeFileSync(path.join(scriptsDir, "rc1_provider_diagnose.ps1"), `${buildProviderDiagnoseScript()}\n`, "utf8")
	fs.writeFileSync(path.join(scriptsDir, "rc1_owner_guided_demo.ps1"), `${buildOwnerGuidedDemoScript()}\n`, "utf8")
	fs.writeFileSync(path.join(scriptsDir, "rc1_open_thin_shell.ps1"), `${buildOpenThinShellScript(manifest)}\n`, "utf8")
	fs.writeFileSync(path.join(scriptsDir, "rc1_safe_task_dry_run.ps1"), `${buildSafeTaskDryRunScript()}\n`, "utf8")
	fs.writeFileSync(path.join(scriptsDir, "rc1_latest_incident.ps1"), `${buildLatestIncidentScript()}\n`, "utf8")
	fs.writeFileSync(path.join(scriptsDir, "rc1_latest_replay.ps1"), `${buildLatestReplayScript()}\n`, "utf8")
	fs.writeFileSync(path.join(scriptsDir, "rc1_demo_gallery.ps1"), `${buildDemoGalleryScript()}\n`, "utf8")
	fs.writeFileSync(path.join(scriptsDir, "rc1_demo_run.ps1"), `${buildDemoRunScript()}\n`, "utf8")
	fs.writeFileSync(path.join(scriptsDir, "rc1_demo_reset.ps1"), `${buildDemoResetScript()}\n`, "utf8")
}

export function createRc1Bundle(rootDir = resolveRootDir(), outputDir?: string): Rc1BundleResult {
	const version = readPackageVersion(rootDir)
	const supportedNodeVersion = readRc1SupportedNodeVersion(rootDir)
	validateRc1RuntimeContract(rootDir, supportedNodeVersion)
	const bundleRootName = `swarmcoder-v2-${version}-windows-local-bundle`
	const bundleDir = outputDir ?? path.join(rootDir, "artifacts", "rc1", bundleRootName)
	removePathRobust(bundleDir)
	ensureDir(bundleDir)

	const manifest: Rc1BundleManifest = {
		version,
		releaseChannel: "rc1",
		supportedInstallPath: "Extract the local Windows RC1 bundle and use the included PowerShell helper scripts.",
		builtAt: new Date().toISOString(),
		supportedNodeVersion,
		builtWithNodeVersion: process.version,
		bundleRootName,
		entryPoints: {
			installCheck: "scripts/rc1_install_check.ps1",
			providerDiagnose: "scripts/rc1_provider_diagnose.ps1",
			ownerGuidedDemo: "scripts/rc1_owner_guided_demo.ps1",
			openThinShell: "scripts/rc1_open_thin_shell.ps1",
			safeTaskDryRun: "scripts/rc1_safe_task_dry_run.ps1",
			latestIncident: "scripts/rc1_latest_incident.ps1",
			latestReplay: "scripts/rc1_latest_replay.ps1",
			demoGallery: "scripts/rc1_demo_gallery.ps1",
			demoRun: "scripts/rc1_demo_run.ps1",
			demoReset: "scripts/rc1_demo_reset.ps1",
		},
	}

	const requiredPaths = [
		"dist",
		"node_modules",
		"LICENSE",
		"package.json",
		"package-lock.json",
		".nvmrc",
		"BOUNDED_1_0_RELEASE_CHECKLIST.md",
		"BOUNDED_1_0_SUPPORT_RUNBOOK.md",
		"SUPPORTED_INSTALL_SURFACES.md",
		"CONTRIBUTOR_SOURCE_CHECKOUT.md",
		"PROVIDER_SETUP_GUIDE.md",
		"REPO_SUPPORT_TIERS.md",
		"LANGUAGE_PACKS.md",
		"LANGUAGE_RELIABILITY_MATRIX.md",
		"KNOWLEDGE_PACK_SETUP.md",
		"BACKGROUND_QUEUE_CANDIDATE.md",
		"IDE_SURFACES.md",
		"VERIFICATION_CATALOG.md",
		"PUBLIC_BETA_RELEASE_CHECKLIST.md",
		"PUBLIC_BETA_OPERATIONS.md",
		"SHIP_FIRST_READINESS_GATE.md",
		"GENERAL_USE_RELEASE_CHECKLIST.md",
		"GENERAL_USE_READINESS_DECISION.md",
		"BUNDLE_START_HERE.md",
		"STRANGER_FIRST_RUN_STUDY.md",
		"STRANGER_USE_PILOT_BATCH.md",
		"STRANGER_FIRST_RUN_FRICTION_LOG_TEMPLATE.md",
		"CONTRIBUTING.md",
		"DEMO_GALLERY.md",
		"Readme.md",
		"OWNER_OVERSIGHT_GUIDE.md",
		"QUICKSTART.md",
		"RC1_RELEASE_NOTES.md",
		"owner_profiles",
		"src/db/schema.sql",
		"vscode_shell",
		"verification/demo_repo_pack",
		"verification/test_workspace",
		"verification/stub_fixtures",
	]

	for (const relativePath of requiredPaths) {
		copyIntoBundle(rootDir, bundleDir, relativePath)
	}

	writeRc1Scripts(bundleDir, manifest)
	const manifestPath = path.join(bundleDir, "RC1_BUNDLE_MANIFEST.json")
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

	return {
		bundleDir,
		manifestPath,
		manifest,
	}
}

function formatBundleResult(result: Rc1BundleResult): string {
	return [
		`SwarmCoder V2 RC1 bundle: ${result.manifest.version}`,
		`Bundle dir: ${result.bundleDir}`,
		`Manifest: ${result.manifestPath}`,
		`Supported Node: ${result.manifest.supportedNodeVersion}`,
		`Install check: ${result.manifest.entryPoints.installCheck}`,
		`Provider diagnose: ${result.manifest.entryPoints.providerDiagnose}`,
		`Owner guided demo: ${result.manifest.entryPoints.ownerGuidedDemo}`,
		`Thin shell: ${result.manifest.entryPoints.openThinShell}`,
		`Safe task dry run: ${result.manifest.entryPoints.safeTaskDryRun}`,
		`Latest incident: ${result.manifest.entryPoints.latestIncident}`,
		`Latest replay: ${result.manifest.entryPoints.latestReplay}`,
		`Demo gallery: ${result.manifest.entryPoints.demoGallery}`,
		`Demo run: ${result.manifest.entryPoints.demoRun}`,
		`Demo reset: ${result.manifest.entryPoints.demoReset}`,
	].join("\n")
}

function main(): void {
	const result = createRc1Bundle()
	console.log(formatBundleResult(result))
}

if (require.main === module) {
	try {
		main()
	} catch (err) {
		console.error(`[package:rc1] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	}
}
