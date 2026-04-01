export const QUEENSHIFT_PRODUCT_NAME = "Queenshift"
export const QUEENSHIFT_CLI_DISPLAY_NAME = "Queenshift CLI"
export const QUEENSHIFT_COMMAND = "queenshift"
export const QUEENSHIFT_COMPILED_ENTRY = "dist/swarm.js"

function quoteCliArgument(value: string): string {
	return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

export function formatQueenshiftCommand(args: readonly string[]): string {
	return [QUEENSHIFT_COMMAND, ...args.map((arg) => quoteCliArgument(arg))].join(" ")
}

export function formatQueenshiftWorkspaceCommand(args: readonly string[], workspace: string): string {
	return formatQueenshiftCommand([...args, "--workspace", workspace])
}

export function formatCompiledCliEntry(): string {
	return `node ${QUEENSHIFT_COMPILED_ENTRY}`
}
