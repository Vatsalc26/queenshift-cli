import { formatQueenshiftCommand, formatQueenshiftWorkspaceCommand } from "../cli/CommandSurface"

function workspaceTarget(workspace?: string | null): string {
	const normalized = workspace?.trim()
	return normalized ? normalized : "<repo>"
}

export function buildLowSteeringOwnerLoop(workspace?: string | null): string[] {
	const targetWorkspace = workspaceTarget(workspace)
	return [
		`known-good demo -> ${formatQueenshiftCommand(["owner:guided:demo"])}`,
		`disposable practice -> ${formatQueenshiftCommand(["demo:run"])}`,
		`real repo start -> ${formatQueenshiftWorkspaceCommand(["repo:onboard"], targetWorkspace)}`,
		`follow latest run -> ${formatQueenshiftWorkspaceCommand(["owner:life-signal"], targetWorkspace)}`,
		`follow-up actions -> ${formatQueenshiftWorkspaceCommand(["owner:quick-actions"], targetWorkspace)}`,
	]
}

export function formatLowSteeringOwnerLoop(workspace?: string | null): string {
	return `Low-steering loop: ${buildLowSteeringOwnerLoop(workspace).join(" | ")}`
}
