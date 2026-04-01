import { shout } from "./utils"

export function greet(name: string): string {
	return `Hello, ${shout(name)}!`
}
