import { fileURLToPath } from "node:url"

export function resolveDashboardServerScript(): string {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js"

  return fileURLToPath(new URL(`./dashboard-server.${extension}`, import.meta.url))
}

export function resolveDashboardDistDir(): string {
  return fileURLToPath(new URL("../../dashboard/dist", import.meta.url))
}

export function resolveDashboardDistIndexPath(): string {
  return fileURLToPath(new URL("../../dashboard/dist/index.html", import.meta.url))
}

export function resolveDashboardSourceDir(): string {
  return fileURLToPath(new URL("../../dashboard", import.meta.url))
}
