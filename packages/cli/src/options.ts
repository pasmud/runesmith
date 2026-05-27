import { homedir } from "node:os"

export type ParsedOptions = {
  config?: string
  mode?: string
  package?: string
  pluginDir?: string
  source?: string
}

export function parseOptions(args: string[]): ParsedOptions {
  const options: ParsedOptions = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]
    if (arg === "--mode" && next) {
      options.mode = next
      index += 1
    } else if (arg === "--config" && next) {
      options.config = next
      index += 1
    } else if (arg === "--package" && next) {
      options.package = next
      index += 1
    } else if (arg === "--plugin-dir" && next) {
      options.pluginDir = next
      index += 1
    } else if (arg === "--source" && next) {
      options.source = next
      index += 1
    }
  }

  return options
}

export function isRunesmithPluginEntry(entry: string): boolean {
  return entry === "runesmith" || entry.startsWith("runesmith@") || entry === "@runesmith/opencode-adapter"
}

export function getDefaultOpenCodeConfigPath(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? `${homedir()}\\AppData\\Roaming`
    return `${appData}\\opencode\\opencode.json`
  }

  const configHome = process.env.XDG_CONFIG_HOME ?? `${homedir()}/.config`
  return `${configHome}/opencode/opencode.json`
}

export function getDefaultOpenCodePluginDir(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? `${homedir()}\\AppData\\Roaming`
    return `${appData}\\opencode\\plugins`
  }

  const configHome = process.env.XDG_CONFIG_HOME ?? `${homedir()}/.config`
  return `${configHome}/opencode/plugins`
}
