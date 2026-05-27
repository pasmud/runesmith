import react from "@vitejs/plugin-react"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { defineConfig, type Plugin } from "vite"
import type { RuntimeCapsule, RuntimeSnapshot, RuntimeStoreHost } from "@runesmith/core"
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
          const capsule = await loadRuntimeCapsule(host, path)
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

          const saved = await saveRuntimeCapsule(host, path, result.value.snapshot)

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

const defaultRuntimeCapsulePath = ".runesmith/runtime/capsule.json"

const emptySnapshot: RuntimeSnapshot = {
  graphs: {},
  ledgers: {},
  leases: { leases: {} },
  contracts: {},
}

async function readFirstRuntimeCapsule(): Promise<string | undefined> {
  for (const path of getRuntimeCapsuleCandidates()) {
    try {
      return await readFile(path, "utf8")
    } catch {
      // Try the next likely project root. Missing capsules should not break the dashboard.
    }
  }

  return undefined
}

function getRuntimeCapsuleCandidates(): string[] {
  const candidates = [
    process.env.RUNESMITH_RUNTIME_CAPSULE,
    resolve(process.cwd(), ".runesmith/runtime/capsule.json"),
    fileURLToPath(new URL("../../.runesmith/runtime/capsule.json", import.meta.url)),
  ].filter((path): path is string => Boolean(path))

  return [...new Set(candidates)]
}

async function resolveRuntimeCapsulePath(host: RuntimeStoreHost): Promise<string> {
  for (const path of getRuntimeCapsuleCandidates()) {
    if (await host.exists(path)) return path
  }

  return getRuntimeCapsuleCandidates()[0] ?? defaultRuntimeCapsulePath
}

async function loadRuntimeCapsule(
  host: RuntimeStoreHost,
  path: string,
): Promise<
  | {
      ok: true
      value: RuntimeCapsule | undefined
    }
  | {
      ok: false
      error: {
        code: "SNAPSHOT_INVALID"
        message: string
        details: Record<string, unknown>
      }
    }
> {
  if (!(await host.exists(path))) {
    return { ok: true, value: undefined }
  }

  try {
    const parsed = JSON.parse(await host.readText(path)) as RuntimeCapsule
    if (!isRuntimeCapsule(parsed)) {
      return {
        ok: false,
        error: {
          code: "SNAPSHOT_INVALID",
          message: "Runtime capsule is missing required snapshot records",
          details: { path },
        },
      }
    }

    return { ok: true, value: parsed }
  } catch {
    return {
      ok: false,
      error: {
        code: "SNAPSHOT_INVALID",
        message: "Runtime capsule is not valid JSON",
        details: { path },
      },
    }
  }
}

async function saveRuntimeCapsule(
  host: RuntimeStoreHost,
  path: string,
  snapshot: RuntimeSnapshot,
): Promise<RuntimeCapsule> {
  const capsule: RuntimeCapsule = {
    version: 1,
    updatedAt: new Date().toISOString(),
    runtime: snapshot,
  }

  await host.writeText(path, `${JSON.stringify(capsule, null, 2)}\n`)
  return capsule
}

function isRuntimeCapsule(value: unknown): value is RuntimeCapsule {
  if (!value || typeof value !== "object") return false
  const capsule = value as Partial<RuntimeCapsule>
  const runtime = capsule.runtime

  return (
    capsule.version === 1
    && typeof capsule.updatedAt === "string"
    && isRecord(runtime)
    && isRecord(runtime.graphs)
    && isRecord(runtime.ledgers)
    && isRecord(runtime.contracts)
    && isRecord(runtime.leases)
    && isRecord((runtime.leases as { leases?: unknown }).leases)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
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
