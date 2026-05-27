import react from "@vitejs/plugin-react"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { defineConfig, type Plugin } from "vite"
import {
  loadRuntimeCapsule as loadCoreRuntimeCapsule,
  saveRuntimeCapsule as saveCoreRuntimeCapsule,
  type Clock,
  type RuntimeCapsule,
  type RuntimeSnapshot,
  type RuntimeStoreHost,
} from "@runesmith/core"
import type { DashboardRuntimeAction } from "./src/runtime-control-plane"
import type * as RuntimeControlPlane from "./src/runtime-control-plane"

export default defineConfig({
  plugins: [react(), runtimeCapsuleApi()],
})

function runtimeCapsuleApi(): Plugin {
  return {
    name: "runesmith-runtime-capsule-api",
    configureServer(server) {
      server.middlewares.use("/api/runtime-capsule", async (request, response, next) => {
        if (request.method !== "GET") {
          next()
          return
        }

        const capsule = await readFirstRuntimeCapsule()
        if (!capsule) {
          response.statusCode = 204
          response.end()
          return
        }

        response.statusCode = 200
        response.setHeader("content-type", "application/json; charset=utf-8")
        response.end(capsule)
      })

      server.middlewares.use("/api/runtime-control", async (request, response, next) => {
        if (request.method !== "POST") {
          next()
          return
        }

        try {
          const action = JSON.parse(await readRequestBody(request)) as DashboardRuntimeAction
          const host = createNodeRuntimeStoreHost()
          const path = await resolveRuntimeCapsulePath(host)
          const capsule = await loadCoreRuntimeCapsule(host, path)
          if (!capsule.ok) {
            sendJson(response, 400, {
              ok: false,
              error: capsule.error,
            })
            return
          }

          const controlPlane = await server.ssrLoadModule("/src/runtime-control-plane.ts") as typeof RuntimeControlPlane
          const result = await controlPlane.applyDashboardRuntimeAction(capsule.value?.runtime ?? emptySnapshot, action)
          if (!result.ok) {
            sendJson(response, 400, result)
            return
          }

          const saved = await saveDashboardRuntimeCapsule(host, path, result.value.snapshot)

          sendJson(response, 200, {
            ok: true,
            value: {
              ...result.value,
              capsule: saved,
            },
          })
        } catch (error) {
          sendJson(response, 400, {
            ok: false,
            error: {
              code: "RUNTIME_CONTROL_INVALID",
              message: error instanceof Error ? error.message : "Runtime control request failed",
            },
          })
        }
      })
    },
  }
}

const emptySnapshot: RuntimeSnapshot = {
  graphs: {},
  ledgers: {},
  leases: { leases: {} },
  contracts: {},
}

const defaultProjectConfigPath = ".runesmith/config.json"
const defaultRuntimeCapsulePath = ".runesmith/runtime/capsule.json"

type ProjectConfig = {
  version: 1
  runtimeDir: string
  defaultStaleAfterMs: number
}

async function readFirstRuntimeCapsule(): Promise<string | undefined> {
  const host = createNodeRuntimeStoreHost()
  const path = await resolveRuntimeCapsulePath(host)
  try {
    return await host.readText(path)
  } catch {
    // Missing capsules should not break the dashboard.
  }

  return undefined
}

function getRuntimeCapsuleCandidates(): string[] {
  const candidates = [
    resolve(process.cwd(), defaultRuntimeCapsulePath),
    fileURLToPath(new URL("../../.runesmith/runtime/capsule.json", import.meta.url)),
  ].filter((path): path is string => Boolean(path))

  return [...new Set(candidates)]
}

export async function resolveRuntimeCapsulePath(host: RuntimeStoreHost): Promise<string> {
  if (process.env.RUNESMITH_RUNTIME_CAPSULE) {
    return process.env.RUNESMITH_RUNTIME_CAPSULE
  }

  const config = await loadProjectConfig(host)
  if (config) {
    return runtimeCapsulePathFromConfig(config)
  }

  for (const path of getRuntimeCapsuleCandidates()) {
    if (await host.exists(path)) return path
  }

  return getRuntimeCapsuleCandidates()[0] ?? defaultRuntimeCapsulePath
}

async function loadProjectConfig(host: RuntimeStoreHost): Promise<ProjectConfig | undefined> {
  if (!(await host.exists(defaultProjectConfigPath))) return undefined

  try {
    const parsed = JSON.parse(await host.readText(defaultProjectConfigPath)) as unknown

    return isProjectConfig(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function runtimeCapsulePathFromConfig(config: ProjectConfig): string {
  const runtimeDir = normalizeRuntimeDir(config.runtimeDir) || ".runesmith/runtime"

  return `${runtimeDir}/capsule.json`
}

function normalizeRuntimeDir(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/\/+$/, "")
}

function isProjectConfig(value: unknown): value is ProjectConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const config = value as Partial<ProjectConfig>

  return config.version === 1
    && typeof config.runtimeDir === "string"
    && typeof config.defaultStaleAfterMs === "number"
}

export async function saveDashboardRuntimeCapsule(
  host: RuntimeStoreHost,
  path: string,
  snapshot: RuntimeSnapshot,
  options: { now?: Clock } = {},
): Promise<RuntimeCapsule> {
  return saveCoreRuntimeCapsule(host, {
    path,
    snapshot,
    now: options.now,
  })
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

function readRequestBody(request: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on("end", () => {
      resolveBody(Buffer.concat(chunks).toString("utf8"))
    })
    request.on("error", reject)
  })
}

function sendJson(response: NodeJS.WritableStream & { statusCode?: number; setHeader(name: string, value: string): void }, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader("content-type", "application/json; charset=utf-8")
  response.end(JSON.stringify(body))
}
