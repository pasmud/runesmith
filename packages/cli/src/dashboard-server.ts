#!/usr/bin/env bun

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, normalize } from "node:path"
import {
  applyRuntimeControlAction,
  loadRuntimeCapsule,
  saveRuntimeCapsule,
  type Clock,
  type IdFactory,
  type ProofCommandExecution,
  type ProofPlanCommand,
  type ProofPlanOptions,
  type RuntimeControlAction,
  type RuntimeSnapshot,
  type RuntimeStoreHost,
} from "@runesmith/core"

export type DashboardServerOptions = {
  distDir: string
  host: RuntimeStoreHost
  idFactory?: IdFactory
  now?: Clock
  proofPlanOptions?: ProofPlanOptions
  runProofCommand?: (command: ProofPlanCommand) => Promise<ProofCommandExecution> | ProofCommandExecution
  runtimePath: string
}

const emptySnapshot: RuntimeSnapshot = {
  graphs: {},
  ledgers: {},
  leases: { leases: {} },
  contracts: {},
}

const shellProofCaptureLimit = 64_000

export function createDashboardRequestHandler(options: DashboardServerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url)

    if (url.pathname === "/api/runtime-capsule") {
      if (request.method !== "GET") {
        return methodNotAllowed()
      }

      const capsule = await loadRuntimeCapsule(options.host, options.runtimePath)
      if (!capsule.ok) {
        return jsonResponse(400, { ok: false, error: capsule.error })
      }
      if (!capsule.value) {
        return new Response(null, { status: 204 })
      }

      return jsonResponse(200, capsule.value)
    }

    if (url.pathname === "/api/runtime-control") {
      if (request.method !== "POST") {
        return methodNotAllowed()
      }

      try {
        const action = await request.json() as RuntimeControlAction
        const capsule = await loadRuntimeCapsule(options.host, options.runtimePath)
        if (!capsule.ok) {
          return jsonResponse(400, { ok: false, error: capsule.error })
        }

        const result = await applyRuntimeControlAction(capsule.value?.runtime ?? emptySnapshot, action, {
          idFactory: options.idFactory,
          now: options.now,
          proofPlanOptions: options.proofPlanOptions,
          runProofCommand: options.runProofCommand ?? runDashboardShellCommand,
        })
        if (!result.ok) {
          return jsonResponse(400, result)
        }

        const saved = await saveRuntimeCapsule(options.host, {
          path: options.runtimePath,
          snapshot: result.value.snapshot,
          now: options.now,
        })

        return jsonResponse(200, {
          ok: true,
          value: {
            ...result.value,
            capsule: saved,
          },
        })
      } catch (error) {
        return jsonResponse(400, {
          ok: false,
          error: {
            code: "RUNTIME_CONTROL_INVALID",
            message: error instanceof Error ? error.message : "Runtime control request failed",
          },
        })
      }
    }

    return serveDashboardAsset(options.distDir, url.pathname)
  }
}

function createNodeRuntimeStoreHost(): RuntimeStoreHost {
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

async function serveDashboardAsset(distDir: string, pathname: string): Promise<Response> {
  const resolved = resolveDashboardAssetPath(distDir, pathname)
  if (!resolved) {
    return new Response("Not found", { status: 404 })
  }

  const asset = Bun.file(resolved.path)
  if (await asset.exists()) {
    return new Response(asset, {
      headers: {
        "content-type": contentTypeForPath(resolved.path),
      },
    })
  }

  if (resolved.fallbackPath) {
    const fallback = Bun.file(resolved.fallbackPath)
    if (await fallback.exists()) {
      return new Response(fallback, {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      })
    }
  }

  return new Response("Dashboard assets not found. Run `bun run build` before starting the packaged dashboard.", {
    status: 404,
  })
}

function resolveDashboardAssetPath(distDir: string, pathname: string): { path: string; fallbackPath?: string } | undefined {
  const requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname.replace(/^\/+/, ""))
  const normalized = normalize(requested)
  if (normalized.startsWith("..") || isAbsolute(normalized)) return undefined

  const path = join(distDir, normalized)
  const fallbackPath = normalized.includes(".") ? undefined : join(distDir, "index.html")

  return { path, fallbackPath }
}

function contentTypeForPath(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8"
  if (path.endsWith(".css")) return "text/css; charset=utf-8"
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8"
  if (path.endsWith(".svg")) return "image/svg+xml"
  if (path.endsWith(".json")) return "application/json; charset=utf-8"

  return "application/octet-stream"
}

function methodNotAllowed(): Response {
  return jsonResponse(405, {
    ok: false,
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Dashboard API method is not allowed.",
    },
  })
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status,
  })
}

async function runDashboardShellCommand(command: ProofPlanCommand): Promise<ProofCommandExecution> {
  const shellCommand = process.platform === "win32"
    ? ["powershell", "-NoProfile", "-Command", command.command]
    : ["sh", "-lc", command.command]
  const child = Bun.spawn(shellCommand, {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    readTextBounded(child.stdout, shellProofCaptureLimit),
    readTextBounded(child.stderr, shellProofCaptureLimit),
    child.exited,
  ])

  return { exitCode, stdout, stderr }
}

async function readTextBounded(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxLength: number,
): Promise<string> {
  if (!stream) return ""

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || output.length >= maxLength) continue

      const text = decoder.decode(value, { stream: true })
      const remaining = maxLength - output.length
      output = `${output}${text.slice(0, remaining)}`
    }

    if (output.length < maxLength) {
      const tail = decoder.decode()
      const remaining = maxLength - output.length
      output = `${output}${tail.slice(0, remaining)}`
    }
  } finally {
    reader.releaseLock()
  }

  return output
}

function parseServerArgs(args: string[]): { distDir: string; host: string; port: number; runtimePath: string } {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]
    if (!arg?.startsWith("--") || !next) continue

    values.set(arg.slice(2), next)
    index += 1
  }

  return {
    distDir: values.get("dist") ?? "packages/dashboard/dist",
    host: values.get("host") ?? "127.0.0.1",
    port: Number(values.get("port") ?? 4177),
    runtimePath: values.get("runtime") ?? ".runesmith/runtime/capsule.json",
  }
}

async function readProofPlanOptions(host: RuntimeStoreHost): Promise<ProofPlanOptions> {
  if (!(await host.exists("package.json"))) return {}

  try {
    const manifest = JSON.parse(await host.readText("package.json")) as {
      packageManager?: unknown
      scripts?: unknown
    }

    return {
      packageManager: typeof manifest.packageManager === "string" ? manifest.packageManager : undefined,
      scripts: isStringRecord(manifest.scripts) ? manifest.scripts : undefined,
      repositoryFiles: await collectRepositoryFiles("."),
    }
  } catch {
    return {}
  }
}

async function collectRepositoryFiles(root: string): Promise<string[]> {
  const files: string[] = []
  await collectRepositoryFilesInto(root, "", files)

  return files
}

async function collectRepositoryFilesInto(root: string, relativePath: string, files: string[]): Promise<void> {
  if (files.length >= 10_000) return

  const directory = relativePath ? `${root}/${relativePath}` : root
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const entryName = String(entry.name)
    if (ignoredRepositoryEntry(entryName)) continue

    const child = relativePath ? `${relativePath}/${entryName}` : entryName
    if (entry.isDirectory()) {
      await collectRepositoryFilesInto(root, child, files)
    } else if (entry.isFile()) {
      files.push(normalizeRepositoryPath(child))
    }
  }
}

function ignoredRepositoryEntry(name: string): boolean {
  return [
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".runesmith",
  ].includes(name)
}

function normalizeRepositoryPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "")
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  return Object.values(value).every((entry) => typeof entry === "string")
}

if (import.meta.main) {
  const parsed = parseServerArgs(Bun.argv.slice(2))
  const host = createNodeRuntimeStoreHost()
  const proofPlanOptions = await readProofPlanOptions(host)
  const server = Bun.serve({
    fetch: createDashboardRequestHandler({
      distDir: parsed.distDir,
      host,
      proofPlanOptions,
      runtimePath: parsed.runtimePath,
    }),
    hostname: parsed.host,
    port: parsed.port,
  })

  console.log("Runesmith dashboard")
  console.log(`url: ${server.url}`)
  console.log(`runtime: ${parsed.runtimePath}`)
  console.log(`dist: ${parsed.distDir}`)
  await new Promise(() => {})
}
