import type { CliHost } from "./index.js"

export const openCodeCommand = "opencode"

export async function findOpenCodeCli(host: CliHost): Promise<string | undefined> {
  const found = await host.findCommand?.(openCodeCommand)
  const trimmed = found?.trim()

  return trimmed ? trimmed : undefined
}
