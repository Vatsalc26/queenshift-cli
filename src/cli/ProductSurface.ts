import fs from "node:fs"
import path from "node:path"

import type { OwnerProviderDiagnostic } from "../owner/ProviderResolution"
import { formatOwnerProviderDiagnostic } from "../owner/ProviderResolution"
import {
	QUEENSHIFT_CLI_DISPLAY_NAME,
	QUEENSHIFT_COMMAND,
	QUEENSHIFT_PRODUCT_NAME,
	formatCompiledCliEntry,
	formatQueenshiftCommand,
} from "./CommandSurface"
import {
	QUEENSHIFT_EXIT_ACTION_REQUIRED,
	QUEENSHIFT_EXIT_FAILURE,
	QUEENSHIFT_EXIT_SUCCESS,
} from "./ExitCodes"

type QueenshiftPackageInfo = {
	version: string
}

export function resolveQueenshiftRepoRoot(startDir: string): string {
	const direct = path.resolve(startDir)
	if (fs.existsSync(path.join(direct, "package.json"))) return direct
	const parent = path.resolve(direct, "..")
	if (fs.existsSync(path.join(parent, "package.json"))) return parent
	return direct
}

function readQueenshiftPackageInfo(startDir: string): QueenshiftPackageInfo {
	const repoRoot = resolveQueenshiftRepoRoot(startDir)
	const raw = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
	const parsed = JSON.parse(raw) as Partial<QueenshiftPackageInfo>
	return {
		version: typeof parsed.version === "string" && parsed.version.trim().length > 0 ? parsed.version.trim() : "0.0.0-dev",
	}
}

export function resolveQueenshiftVersion(startDir: string): string {
	return readQueenshiftPackageInfo(startDir).version
}

export function formatQueenshiftVersion(startDir: string): string {
	return `${QUEENSHIFT_CLI_DISPLAY_NAME} ${resolveQueenshiftVersion(startDir)}`
}

export function formatQueenshiftHelp(startDir: string): string {
	return [
		formatQueenshiftVersion(startDir),
		"",
		"Shipped bounded engine: swarmengine",
		"Experimental engine candidate: queenbee",
		"",
		"Usage:",
		`  ${formatQueenshiftCommand(["<task>", "--workspace", "<repo>"])}`,
		`  ${formatQueenshiftCommand(["--task", "<task>", "--workspace", "<repo>"])}`,
		`  ${formatQueenshiftCommand(["<command>"])}`,
		"",
		"Core commands:",
		"  doctor               Check provider setup and config truth",
		"  demo:run             Run the disposable demo lane",
		"  demo:gallery         Show bounded demo examples",
		"  owner:guided:demo    Run the known-good guided owner demo",
		"  repo:onboard         Check repo readiness and suggested verification defaults",
		"  replay:latest        Show the latest replay artifact for a workspace",
		"  incident:latest      Show the latest incident pack for a workspace",
		"  review:list          Show pending review items for a workspace",
		"",
		"Common options:",
		"  --task <text>        Alternate explicit task form for automation and wrappers",
		"  --workspace <path>   Target Git repo workspace",
		"  --admitOnly          Preflight repo/task admission without running",
		"  --dryRun             Produce artifacts without writing files",
		"  --provider <name>    Override provider for this run",
		"  --model <id>         Override model for this run",
		"  --json               Emit JSON for artifact, status, and diagnosis commands",
		"  --help               Show this help",
		"  --version            Show the Queenshift CLI version",
		"",
		"Automation contract:",
		`  exit ${QUEENSHIFT_EXIT_SUCCESS}                Success or requested artifact found`,
		`  exit ${QUEENSHIFT_EXIT_ACTION_REQUIRED}                Action required, bounded refusal, or no latest artifact found`,
		`  exit ${QUEENSHIFT_EXIT_FAILURE}                Command or runtime failure`,
		`  ${formatQueenshiftCommand(["--task", "<task>", "--workspace", "<repo>", "--admitOnly", "--json"])}`,
		`  ${formatQueenshiftCommand(["replay:latest", "--workspace", "<repo>", "--json"])}`,
		`  ${formatQueenshiftCommand(["incident:latest", "--workspace", "<repo>", "--json"])}`,
		"",
		"First steps:",
		`  1. ${formatQueenshiftCommand(["doctor"])}`,
		`  2. ${formatQueenshiftCommand(["owner:guided:demo"])}`,
		`  3. ${formatQueenshiftCommand(["demo:run"])}`,
		"",
		"First coding task:",
		`  1. ${formatQueenshiftCommand(["repo:onboard", "--workspace", "<repo>"])}`,
		`  2. ${formatQueenshiftCommand(["add a brief comment to hello.ts", "--workspace", "<repo>", "--admitOnly"])}`,
		`  3. ${formatQueenshiftCommand(["add a brief comment to hello.ts", "--workspace", "<repo>"])}`,
		"",
		"When a run stops:",
		`  1. ${formatQueenshiftCommand(["incident:latest", "--workspace", "<repo>"])}  Show what failed`,
		`  2. ${formatQueenshiftCommand(["owner:quick-actions", "--workspace", "<repo>"])}  Show the safest next command`,
		`  3. ${formatQueenshiftCommand(["replay:latest", "--workspace", "<repo>"])}  Show the recorded timeline`,
		"",
		`Compiled entry: ${formatCompiledCliEntry()}`,
	].join("\n")
}

export function formatQueenshiftDoctorReport(diagnostic: OwnerProviderDiagnostic, startDir: string): string {
	return [
		`${QUEENSHIFT_PRODUCT_NAME} doctor`,
		`Version: ${resolveQueenshiftVersion(startDir)}`,
		"",
		formatOwnerProviderDiagnostic(diagnostic),
		"",
		"Config truth:",
		"- Provider selection comes from `SWARM_PROVIDER` when it is set, otherwise from detected local credentials.",
		"- Model override comes from `SWARM_MODEL`; otherwise the provider default stays explicit.",
		"- Gemini auth mode comes from `SWARM_GEMINI_AUTH` when the provider is `gemini`.",
		"",
		"Next commands:",
		`- ${formatQueenshiftCommand(["owner:guided:demo"])}`,
		`- ${formatQueenshiftCommand(["demo:run"])}`,
		`- ${formatQueenshiftCommand(["repo:onboard", "--workspace", "<repo>"])}`,
	].join("\n")
}
