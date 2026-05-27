import type { AgentContract } from "./types.js"

export type ToolRouteContext = {
  availableTools: string[]
  requiredCapabilities: string[]
}

export function routeTools(contract: AgentContract, context: ToolRouteContext): string[] {
  const contractSupportsTask = context.requiredCapabilities.every((capability) => {
    return contract.capabilities.includes(capability)
  })

  if (!contractSupportsTask) return []

  const available = new Set(context.availableTools)
  return contract.allowedTools.filter((tool) => available.has(tool))
}
