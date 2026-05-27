import type { RuntimeCapsule } from "@runesmith/core"
import type { DashboardRuntimeAction } from "./runtime-control-plane"

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

export async function runDashboardRuntimeAction(
  action: DashboardRuntimeAction,
  fetcher: DashboardCapsuleFetcher = fetch,
): Promise<RuntimeCapsule> {
  const response = await fetcher("/api/runtime-control", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(action),
  })

  if (!response.ok) {
    throw new Error(`Runtime control request failed with ${response.status}`)
  }

  const body = await response.json() as RuntimeControlResponse
  if (!body.ok) {
    throw new Error(body.error.message)
  }

  return body.value.capsule
}

type RuntimeControlResponse =
  | {
      ok: true
      value: {
        capsule: RuntimeCapsule
      }
    }
  | {
      ok: false
      error: {
        message: string
      }
    }
