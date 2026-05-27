import type { RuntimeCapsule } from "@runesmith/core"

export type DashboardCapsuleFetcher = typeof fetch

export async function loadDashboardRuntimeCapsule(
  fetcher: DashboardCapsuleFetcher = fetch,
): Promise<RuntimeCapsule | undefined> {
  const response = await fetcher("/api/runtime-capsule")

  if (response.status === 204 || response.status === 404) {
    return undefined
  }

  if (!response.ok) {
    throw new Error(`Runtime capsule request failed with ${response.status}`)
  }

  return await response.json() as RuntimeCapsule
}
