import react from "@vitejs/plugin-react"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { defineConfig, type Plugin } from "vite"

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
    },
  }
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
