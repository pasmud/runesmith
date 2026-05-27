import { runtimeError } from "./errors.js"
import { err, ok, type AgentContract, type EvidenceType, type MissionTask } from "./types.js"

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

export function getRequiredEvidenceForTask(task: MissionTask, contract: AgentContract): EvidenceType[] {
  return task.requiredEvidence ?? contract.requiredEvidence
}
