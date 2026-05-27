import { runtimeError } from "./errors"
import { err, ok, type AgentContract, type MissionTask } from "./types"

export function validateAgentForTask(contract: AgentContract, task: MissionTask) {
  const missingCapabilities = task.requiredCapabilities.filter((capability) => {
    return !contract.capabilities.includes(capability)
  })

  if (missingCapabilities.length > 0) {
    return err(
      runtimeError("CAPABILITY_MISSING", "Agent is missing required task capabilities", {
        agentId: contract.id,
        taskId: task.id,
        missingCapabilities,
      }),
    )
  }

  return ok(undefined)
}
