#!/usr/bin/env bun

import { dirname } from "node:path"
import { pathToFileURL } from "node:url"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { defaultRuntimeCapsulePath, loadRuntimeCapsule, saveRuntimeCapsule, type RuntimeSnapshot } from "@runesmith/core"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { runDoctor } from "./doctor"
import {
  getDefaultOpenCodeConfigPath,
  getDefaultOpenCodePluginDir,
  isRunesmithPluginEntry,
  parseOptions,
} from "./options"

export type CliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type CliHost = {
  exists(path: string): boolean | Promise<boolean>
  readText(path: string): string | Promise<string>
  writeText(path: string, text: string): void | Promise<void>
}

export function createMemoryHost(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles))

  return {
    exists(path: string): boolean {
      return files.has(path)
    },
    readText(path: string): string {
      const value = files.get(path)
      if (value === undefined) {
        throw new Error(`File not found: ${path}`)
      }

      return value
    },
    writeText(path: string, text: string): void {
      files.set(path, text)
    },
  }
}

export function createNodeHost(): CliHost {
  return {
    async exists(path: string): Promise<boolean> {
      try {
        await readFile(path, "utf8")
        return true
      } catch {
        return false
      }
    },
    readText(path: string): Promise<string> {
      return readFile(path, "utf8")
    },
    async writeText(path: string, text: string): Promise<void> {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, text, "utf8")
    },
  }
}

export async function runCli(args: string[], host: CliHost = createNodeHost()): Promise<CliResult> {
  const [command, subcommand, maybeId, ...rest] = args

  if (command === "install") {
    return installRunesmith(args.slice(1), host)
  }

  if (command === "up") {
    return runesmithUp(args.slice(1), host)
  }

  if (command === "init") {
    await writeProjectConfig(host)

    return success("Created .runesmith/config.json\n")
  }

  if (command === "doctor") {
    return runDoctor(args.slice(1), host)
  }

  if (command === "mission" && subcommand === "list") {
    const snapshot = await readSnapshot(host, [maybeId, ...rest].filter((value): value is string => Boolean(value)))
    if (!snapshot.ok) return snapshot.result

    const lines = Object.values(snapshot.value.graphs).map((graph) => {
      return `${graph.mission.id} ${graph.mission.status} ${graph.mission.goal}`
    })

    return success(`${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`)
  }

  if (command === "mission" && subcommand === "inspect" && maybeId) {
    const snapshot = await readSnapshot(host, rest)
    if (!snapshot.ok) return snapshot.result

    const graph = snapshot.value.graphs[maybeId]
    if (!graph) {
      return failure(`Mission not found: ${maybeId}\n`)
    }

    const taskLines = Object.values(graph.tasks).map((task) => {
      return `- ${task.id} ${task.status} ${task.assignedAgentId ?? "unassigned"} ${task.title}`
    })

    return success([
      `Mission ${graph.mission.id}`,
      `Status: ${graph.mission.status}`,
      `Goal: ${graph.mission.goal}`,
      "Tasks:",
      ...taskLines,
      "",
    ].join("\n"))
  }

  return failure("Usage: runesmith <up|install|init|doctor|mission list|mission inspect>\n")
}

function success(stdout: string): CliResult {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
  }
}

function failure(stderr: string): CliResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr,
  }
}

type SnapshotReadResult =
  | {
      ok: true
      value: RuntimeSnapshot
    }
  | {
      ok: false
      result: CliResult
    }

const emptySnapshot: RuntimeSnapshot = {
  graphs: {},
  ledgers: {},
  leases: { leases: {} },
  contracts: {},
}

async function writeProjectConfig(host: CliHost): Promise<void> {
  await host.writeText(".runesmith/config.json", JSON.stringify({
    version: 1,
    runtimeDir: ".runesmith/runtime",
    defaultStaleAfterMs: 120_000,
  }, null, 2))
}

async function ensureRuntimeCapsule(host: CliHost): Promise<void> {
  if (await host.exists(defaultRuntimeCapsulePath)) return

  await saveRuntimeCapsule(host, {
    path: defaultRuntimeCapsulePath,
    snapshot: emptySnapshot,
  })
}

async function runesmithUp(args: string[], host: CliHost): Promise<CliResult> {
  await writeProjectConfig(host)
  await ensureRuntimeCapsule(host)

  const install = await installRunesmith(args, host)
  if (install.exitCode !== 0) return install

  const pluginPath = extractOutputValue(install.stdout, "plugin")

  return success([
    "Runesmith OS is ready",
    "config: .runesmith/config.json",
    `plugin: ${pluginPath ?? "installed"}`,
    `runtime: ${defaultRuntimeCapsulePath}`,
    "covenant: automatic",
    "dashboard: bun run dev:dashboard",
    "",
  ].join("\n"))
}

function extractOutputValue(stdout: string, key: string): string | undefined {
  const prefix = `${key}: `
  return stdout
    .split("\n")
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
}

async function readSnapshot(host: CliHost, args: string[]): Promise<SnapshotReadResult> {
  const snapshotFlagIndex = args.indexOf("--snapshot")
  const snapshotPath = snapshotFlagIndex >= 0 ? args[snapshotFlagIndex + 1] : undefined
  if (!snapshotPath) {
    const capsule = await loadRuntimeCapsule(host, defaultRuntimeCapsulePath)
    if (!capsule.ok) {
      return {
        ok: false,
        result: failure(`${capsule.error.message}\n`),
      }
    }

    return {
      ok: true,
      value: capsule.value?.runtime ?? emptySnapshot,
    }
  }

  const raw = await host.readText(snapshotPath)
  return {
    ok: true,
    value: JSON.parse(raw) as RuntimeSnapshot,
  }
}

async function installRunesmith(args: string[], host: CliHost): Promise<CliResult> {
  const options = parseOptions(args)
  const mode = options.mode ?? "local"

  if (mode === "npm") {
    return installNpmPlugin(host, {
      configPath: options.config ?? getDefaultOpenCodeConfigPath(),
      pluginEntry: options.package ?? "runesmith@latest",
    })
  }

  if (mode !== "local") {
    return failure(`Unknown install mode: ${mode}\n`)
  }

  const source = options.source ?? resolveRepoPluginSource()
  const pluginDir = options.pluginDir ?? getDefaultOpenCodePluginDir()
  const pluginPath = `${pluginDir.replace(/[\\/]$/, "")}/runesmith.ts`
  const sourceUrl = pathToFileURL(source).href

  await host.writeText(pluginPath, [
    "// Generated by Runesmith. Re-run `runesmith install` to refresh.",
    `export { default } from "${sourceUrl}"`,
    "",
  ].join("\n"))

  return success([
    "Installed Runesmith local plugin",
    `plugin: ${pluginPath}`,
    `source: ${sourceUrl}`,
    "covenant: automatic",
    "",
  ].join("\n"))
}

async function installNpmPlugin(
  host: CliHost,
  input: { configPath: string; pluginEntry: string },
): Promise<CliResult> {
  const existed = await host.exists(input.configPath)
  const backupPath = `${input.configPath}.runesmith.bak`
  const current = existed ? await host.readText(input.configPath) : "{\n}\n"
  const errors: ParseError[] = []
  const parsed = parse(current, errors, { allowTrailingComma: true }) as { plugin?: unknown } | undefined

  if (errors.length > 0 || !parsed || typeof parsed !== "object") {
    return failure(`Could not parse OpenCode config: ${input.configPath}\n`)
  }

  if (existed) {
    await host.writeText(backupPath, current)
  }

  const existingPlugins = Array.isArray(parsed.plugin)
    ? parsed.plugin.filter((entry): entry is string => typeof entry === "string")
    : []
  const normalizedPlugins = [
    ...existingPlugins.filter((entry) => !isRunesmithPluginEntry(entry)),
    input.pluginEntry,
  ]
  const edits = modify(current, ["plugin"], normalizedPlugins, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
    },
  })
  const nextConfig = applyEdits(current, edits)
  await host.writeText(input.configPath, nextConfig.endsWith("\n") ? nextConfig : `${nextConfig}\n`)

  return success([
    "Installed Runesmith npm plugin",
    `config: ${input.configPath}`,
    `plugin: ${input.pluginEntry}`,
    `backup: ${existed ? backupPath : "none"}`,
    "covenant: automatic",
    "",
  ].join("\n"))
}

function resolveRepoPluginSource(): string {
  return new URL("../../opencode-adapter/src/plugin.ts", import.meta.url).pathname
}

if (import.meta.main) {
  const result = await runCli(Bun.argv.slice(2))
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}
