import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
	buildRc1SupportedNodeRange,
	createRc1Bundle,
	readRc1SupportedNodeVersion,
	validateRc1Prerequisites,
} from "../src/package/Rc1Packaging"
import { findLatestRunSummary } from "../src/run/RunArtifacts"

export type PackageRc1HarnessResult = {
	bundleArtifactsBuilt: boolean
	runtimeContractAligned: boolean
	licenseIncluded: boolean
	cleanInstallSmoke: boolean
	installDiagnosticsVisible: boolean
	launchSmoke: boolean
	safeTaskThroughPackagedPath: boolean
	bundleDocsPresent: boolean
	demoPackIncluded: boolean
	demoScriptsPresent: boolean
	guidedDemoAndProviderScriptsPresent: boolean
	replayAndGalleryScriptsPresent: boolean
	missingPrerequisiteMessage: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

async function runCommandCapture(
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs?: number } = { cwd: process.cwd() },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	const timeoutMs = options.timeoutMs ?? 120_000
	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
	const stdoutPath = path.join(options.cwd, `.tmp-rc1-cmd-${stamp}.stdout.log`)
	const stderrPath = path.join(options.cwd, `.tmp-rc1-cmd-${stamp}.stderr.log`)
	const stdoutFd = fs.openSync(stdoutPath, "w")
	const stderrFd = fs.openSync(stderrPath, "w")

	const readFile = (filePath: string): string => {
		try {
			return fs.readFileSync(filePath, "utf8")
		} catch {
			return ""
		}
	}

	try {
		return await new Promise((resolve, reject) => {
			const child = spawn(command, args, {
				cwd: options.cwd,
				windowsHide: true,
				stdio: ["ignore", stdoutFd, stderrFd],
			})

			const timeout = setTimeout(() => {
				if (process.platform === "win32" && child.pid) {
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
			}, timeoutMs)
			timeout.unref?.()

			child.once("error", (err) => {
				clearTimeout(timeout)
				reject(err)
			})
			child.once("close", (code) => {
				clearTimeout(timeout)
				resolve({
					code: typeof code === "number" ? code : null,
					stdout: readFile(stdoutPath),
					stderr: readFile(stderrPath),
				})
			})
		})
	} finally {
		try {
			fs.closeSync(stdoutFd)
		} catch {
			// ignore
		}
		try {
			fs.closeSync(stderrFd)
		} catch {
			// ignore
		}
		try {
			fs.unlinkSync(stdoutPath)
		} catch {
			// ignore
		}
		try {
			fs.unlinkSync(stderrPath)
		} catch {
			// ignore
		}
	}
}

async function runPowerShellScript(
	bundleDir: string,
	relativeScriptPath: string,
	extraArgs: string[] = [],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return runCommandCapture(
		"powershell.exe",
		["-ExecutionPolicy", "Bypass", "-File", path.join(bundleDir, relativeScriptPath), ...extraArgs],
		{
			cwd: process.cwd(),
			timeoutMs: 120_000,
		},
	)
}

export async function runPackageRc1Harness(rootDir = resolveRootDir()): Promise<PackageRc1HarnessResult> {
	const details: string[] = []
	const bundle = createRc1Bundle(rootDir)
	const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcoder-v2-rc1-install-"))

	try {
		fs.cpSync(bundle.bundleDir, installDir, { recursive: true, force: true })
		const packagedWorkspace = path.join(installDir, "verification", "test_workspace")
		const supportedNodeVersion = readRc1SupportedNodeVersion(rootDir)
		const supportedNodeRange = buildRc1SupportedNodeRange(supportedNodeVersion)
		const packagedPackage = JSON.parse(fs.readFileSync(path.join(installDir, "package.json"), "utf8")) as {
			engines?: { node?: string }
			license?: string
		}
		const installCheckText = fs.readFileSync(path.join(installDir, "scripts", "rc1_install_check.ps1"), "utf8")

		const installCheck = await runPowerShellScript(installDir, "scripts/rc1_install_check.ps1")
		const safeTask = await runPowerShellScript(installDir, "scripts/rc1_safe_task_dry_run.ps1")
		const latestIncident = await runPowerShellScript(installDir, "scripts/rc1_latest_incident.ps1")
		const latestReplay = await runPowerShellScript(installDir, "scripts/rc1_latest_replay.ps1", ["-Workspace", packagedWorkspace])
		const demoGallery = await runPowerShellScript(installDir, "scripts/rc1_demo_gallery.ps1")
		const latestSummaryPath = findLatestRunSummary(packagedWorkspace)
		const licenseText = fs.readFileSync(path.join(installDir, "LICENSE"), "utf8")
		const bundleStartHereText = fs.readFileSync(path.join(installDir, "BUNDLE_START_HERE.md"), "utf8")

		const bundleArtifactsBuilt =
			fs.existsSync(bundle.manifestPath) &&
			fs.existsSync(path.join(bundle.bundleDir, "dist", "swarm.js")) &&
			fs.existsSync(path.join(bundle.bundleDir, "vscode_shell", "package.json")) &&
			fs.existsSync(path.join(bundle.bundleDir, "node_modules"))
		const runtimeContractAligned =
			bundle.manifest.supportedNodeVersion === supportedNodeVersion &&
			bundle.manifest.builtWithNodeVersion === process.version &&
			packagedPackage.engines?.node === supportedNodeRange &&
			packagedPackage.license === "MIT" &&
			installCheckText.includes(bundle.manifest.supportedNodeVersion) &&
			installCheckText.includes("Supported Node:")
		const installDiagnosticsVisible =
			installCheck.code === 0 &&
			installCheck.stdout.includes("Detected Node:") &&
			installCheck.stdout.includes("Detected Git:") &&
			installCheck.stdout.includes("rc1_provider_diagnose.ps1") &&
			installCheck.stdout.includes("rc1_owner_guided_demo.ps1")
		const licenseIncluded =
			fs.existsSync(path.join(bundle.bundleDir, "LICENSE")) &&
			fs.existsSync(path.join(installDir, "LICENSE")) &&
			licenseText.includes("MIT License") &&
			licenseText.includes("Permission is hereby granted")
		const cleanInstallSmoke = installCheck.code === 0 && installCheck.stdout.includes("RC1 bundle check: PASS")
		const launchSmoke = safeTask.code === 2 && safeTask.stdout.includes("[Swarm] Final status: review_required")
		const safeTaskThroughPackagedPath =
			launchSmoke &&
			Boolean(latestSummaryPath) &&
			latestIncident.code === 0 &&
			latestIncident.stdout.includes("Failure bucket:") &&
			latestIncident.stdout.includes("Recovery action:")
		const bundleDocsPresent =
			fs.existsSync(path.join(installDir, "BOUNDED_1_0_RELEASE_CHECKLIST.md")) &&
			fs.existsSync(path.join(installDir, "BOUNDED_1_0_SUPPORT_RUNBOOK.md")) &&
			fs.existsSync(path.join(installDir, "SUPPORTED_INSTALL_SURFACES.md")) &&
			fs.existsSync(path.join(installDir, "CONTRIBUTOR_SOURCE_CHECKOUT.md")) &&
			fs.existsSync(path.join(installDir, "PROVIDER_SETUP_GUIDE.md")) &&
			fs.existsSync(path.join(installDir, "REPO_SUPPORT_TIERS.md")) &&
			fs.existsSync(path.join(installDir, "LANGUAGE_PACKS.md")) &&
			fs.existsSync(path.join(installDir, "LANGUAGE_RELIABILITY_MATRIX.md")) &&
			fs.existsSync(path.join(installDir, "KNOWLEDGE_PACK_SETUP.md")) &&
			fs.existsSync(path.join(installDir, "BACKGROUND_QUEUE_CANDIDATE.md")) &&
			fs.existsSync(path.join(installDir, "IDE_SURFACES.md")) &&
			fs.existsSync(path.join(installDir, "PUBLIC_BETA_OPERATIONS.md")) &&
			fs.existsSync(path.join(installDir, "SHIP_FIRST_READINESS_GATE.md")) &&
			fs.existsSync(path.join(installDir, "BUNDLE_START_HERE.md")) &&
			fs.existsSync(path.join(installDir, "STRANGER_FIRST_RUN_STUDY.md")) &&
			fs.existsSync(path.join(installDir, "STRANGER_USE_PILOT_BATCH.md")) &&
			fs.existsSync(path.join(installDir, "STRANGER_FIRST_RUN_FRICTION_LOG_TEMPLATE.md")) &&
			fs.existsSync(path.join(installDir, "DEMO_GALLERY.md")) &&
			fs.existsSync(path.join(installDir, "CONTRIBUTING.md")) &&
			bundleStartHereText.includes("BOUNDED_1_0_RELEASE_CHECKLIST.md") &&
			bundleStartHereText.includes("BOUNDED_1_0_SUPPORT_RUNBOOK.md") &&
			bundleStartHereText.includes("SUPPORTED_INSTALL_SURFACES.md") &&
			bundleStartHereText.includes("CONTRIBUTOR_SOURCE_CHECKOUT.md") &&
			bundleStartHereText.includes("PUBLIC_BETA_OPERATIONS.md") &&
			bundleStartHereText.includes("SHIP_FIRST_READINESS_GATE.md") &&
			bundleStartHereText.includes("STRANGER_FIRST_RUN_STUDY.md") &&
			bundleStartHereText.includes("STRANGER_USE_PILOT_BATCH.md") &&
			bundleStartHereText.includes("STRANGER_FIRST_RUN_FRICTION_LOG_TEMPLATE.md") &&
			bundleStartHereText.includes("PROVIDER_SETUP_GUIDE.md") &&
			bundleStartHereText.includes("LANGUAGE_RELIABILITY_MATRIX.md") &&
			bundleStartHereText.includes("KNOWLEDGE_PACK_SETUP.md") &&
			bundleStartHereText.includes("BACKGROUND_QUEUE_CANDIDATE.md") &&
			bundleStartHereText.includes("IDE_SURFACES.md") &&
			bundleStartHereText.includes("rc1_install_check.ps1") &&
			bundleStartHereText.includes("rc1_provider_diagnose.ps1") &&
			bundleStartHereText.includes("rc1_owner_guided_demo.ps1") &&
			bundleStartHereText.includes("rc1_demo_gallery.ps1") &&
			bundleStartHereText.includes("rc1_latest_replay.ps1")
		const demoPackIncluded =
			fs.existsSync(path.join(bundle.bundleDir, "verification", "demo_repo_pack", "hello.ts")) &&
			fs.existsSync(path.join(installDir, "verification", "demo_repo_pack", "README.md")) &&
			fs.existsSync(path.join(bundle.bundleDir, "owner_profiles", "canonical-guided-demo.profile.json")) &&
			fs.existsSync(path.join(installDir, "owner_profiles", "canonical-guided-demo.profile.json"))
		const demoScriptsPresent =
			fs.existsSync(path.join(installDir, "scripts", "rc1_demo_run.ps1")) &&
			fs.existsSync(path.join(installDir, "scripts", "rc1_demo_reset.ps1")) &&
			bundle.manifest.entryPoints.demoRun === "scripts/rc1_demo_run.ps1" &&
			bundle.manifest.entryPoints.demoReset === "scripts/rc1_demo_reset.ps1" &&
			installCheckText.includes("rc1_demo_run.ps1")
		const guidedDemoAndProviderScriptsPresent =
			fs.existsSync(path.join(installDir, "scripts", "rc1_provider_diagnose.ps1")) &&
			fs.existsSync(path.join(installDir, "scripts", "rc1_owner_guided_demo.ps1")) &&
			bundle.manifest.entryPoints.providerDiagnose === "scripts/rc1_provider_diagnose.ps1" &&
			bundle.manifest.entryPoints.ownerGuidedDemo === "scripts/rc1_owner_guided_demo.ps1" &&
			installCheckText.includes("rc1_provider_diagnose.ps1") &&
			installCheckText.includes("rc1_owner_guided_demo.ps1")
		const replayAndGalleryScriptsPresent =
			fs.existsSync(path.join(installDir, "scripts", "rc1_latest_replay.ps1")) &&
			fs.existsSync(path.join(installDir, "scripts", "rc1_demo_gallery.ps1")) &&
			bundle.manifest.entryPoints.latestReplay === "scripts/rc1_latest_replay.ps1" &&
			bundle.manifest.entryPoints.demoGallery === "scripts/rc1_demo_gallery.ps1" &&
			demoGallery.code === 0 &&
			demoGallery.stdout.includes("Queenshift Demo Gallery") &&
			latestReplay.code === 0 &&
			latestReplay.stdout.includes("Replay export:")
		const missingPrerequisiteMessage =
			(validateRc1Prerequisites({
				currentNodeVersion: "v18.20.0",
				supportedNodeVersion: bundle.manifest.supportedNodeVersion,
				gitAvailable: true,
				bundleHasCli: true,
				bundleHasNodeModules: true,
			}) ?? "").includes(bundle.manifest.supportedNodeVersion)

		details.push(
			`runtime contract supported=${bundle.manifest.supportedNodeVersion} builtWith=${bundle.manifest.builtWithNodeVersion} engines=${packagedPackage.engines?.node ?? "(missing)"}`,
		)
		details.push(
			`installCheck=${installCheck.code} safeTask=${safeTask.code} latestIncident=${latestIncident.code} latestReplay=${latestReplay.code} demoGallery=${demoGallery.code}`,
		)

		return {
			bundleArtifactsBuilt,
			runtimeContractAligned,
			licenseIncluded,
			cleanInstallSmoke,
			installDiagnosticsVisible,
			launchSmoke,
			safeTaskThroughPackagedPath,
			bundleDocsPresent,
			demoPackIncluded,
			demoScriptsPresent,
			guidedDemoAndProviderScriptsPresent,
			replayAndGalleryScriptsPresent,
			missingPrerequisiteMessage,
			details,
		}
	} finally {
		if (fs.existsSync(installDir)) fs.rmSync(installDir, { recursive: true, force: true })
	}
}

export function formatPackageRc1HarnessResult(result: PackageRc1HarnessResult): string {
	return [
		`Bundle artifacts built: ${result.bundleArtifactsBuilt ? "PASS" : "FAIL"}`,
		`Runtime contract aligned: ${result.runtimeContractAligned ? "PASS" : "FAIL"}`,
		`License included: ${result.licenseIncluded ? "PASS" : "FAIL"}`,
		`Clean-install smoke: ${result.cleanInstallSmoke ? "PASS" : "FAIL"}`,
		`Install diagnostics visible: ${result.installDiagnosticsVisible ? "PASS" : "FAIL"}`,
		`Launch smoke: ${result.launchSmoke ? "PASS" : "FAIL"}`,
		`Safe task through packaged path: ${result.safeTaskThroughPackagedPath ? "PASS" : "FAIL"}`,
		`Bundle docs present: ${result.bundleDocsPresent ? "PASS" : "FAIL"}`,
		`Demo pack included: ${result.demoPackIncluded ? "PASS" : "FAIL"}`,
		`Demo scripts present: ${result.demoScriptsPresent ? "PASS" : "FAIL"}`,
		`Guided-demo and provider scripts present: ${result.guidedDemoAndProviderScriptsPresent ? "PASS" : "FAIL"}`,
		`Replay and gallery scripts present: ${result.replayAndGalleryScriptsPresent ? "PASS" : "FAIL"}`,
		`Missing prerequisite message: ${result.missingPrerequisiteMessage ? "PASS" : "FAIL"}`,
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runPackageRc1Harness()
	console.log(formatPackageRc1HarnessResult(result))
	process.exit(
		result.bundleArtifactsBuilt &&
			result.runtimeContractAligned &&
			result.licenseIncluded &&
			result.cleanInstallSmoke &&
			result.installDiagnosticsVisible &&
			result.launchSmoke &&
			result.safeTaskThroughPackagedPath &&
			result.bundleDocsPresent &&
			result.demoPackIncluded &&
			result.demoScriptsPresent &&
			result.guidedDemoAndProviderScriptsPresent &&
			result.replayAndGalleryScriptsPresent &&
			result.missingPrerequisiteMessage
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:package:rc1] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
