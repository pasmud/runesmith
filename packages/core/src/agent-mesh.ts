import type { AgentContract } from "./types.js"

const runesmithAgentContracts = [
  {
    id: "agent_atlas",
    displayName: "Atlas",
    description: "Primary implementation agent for TypeScript, tests, and repository edits.",
    capabilities: ["typescript", "testing", "repository-maintenance"],
    allowedTools: ["read", "edit", "bash", "test"],
    modelPolicy: {
      primary: "anthropic/claude-sonnet-4.5",
      fallbacks: ["openai/gpt-5.1-codex"],
    },
    fileScope: ["packages/**", "docs/**", "examples/**"],
    completionCriteria: ["Relevant files changed", "Verification command recorded"],
    requiredEvidence: ["file-change", "test-result"],
    fallbacks: ["agent_oracle", "agent_artificer"],
  },
  {
    id: "agent_oracle",
    displayName: "Oracle",
    description: "Verification and review agent for proof, risk, and completion gates.",
    capabilities: ["testing", "review", "risk-analysis"],
    allowedTools: ["read", "bash", "test"],
    modelPolicy: {
      primary: "openai/gpt-5.1-codex",
      fallbacks: ["anthropic/claude-sonnet-4.5"],
    },
    fileScope: ["packages/**", "docs/**", "examples/**"],
    completionCriteria: ["Proof reviewed", "Risk and completion decision recorded"],
    requiredEvidence: ["test-result", "decision"],
    fallbacks: ["agent_atlas"],
  },
  {
    id: "agent_artificer",
    displayName: "Artificer",
    description: "Interface agent for dashboard, UX, accessibility, and frontend implementation.",
    capabilities: ["typescript", "ui", "accessibility"],
    allowedTools: ["read", "edit", "bash", "test"],
    modelPolicy: {
      primary: "anthropic/claude-sonnet-4.5",
      fallbacks: ["openai/gpt-5.1-codex"],
    },
    fileScope: ["packages/dashboard/**", "examples/**"],
    completionCriteria: ["Rendered UI verified", "Frontend proof recorded"],
    requiredEvidence: ["file-change", "test-result"],
    fallbacks: ["agent_atlas", "agent_oracle"],
  },
  {
    id: "agent_scout",
    displayName: "Scout",
    description: "Diagnostics and recovery agent for shell, paths, stale leases, and environment state.",
    capabilities: ["diagnostics", "recovery", "windows"],
    allowedTools: ["read", "bash", "test"],
    modelPolicy: {
      primary: "openai/gpt-5.1-codex-mini",
      fallbacks: ["openai/gpt-5.1-codex"],
    },
    fileScope: ["packages/**", ".runesmith/**"],
    completionCriteria: ["Diagnostic captured", "Recovery decision recorded"],
    requiredEvidence: ["diagnostic", "risk"],
    fallbacks: ["agent_atlas"],
  },
  {
    id: "agent_steward",
    displayName: "Steward",
    description: "Release and repository steward for packaging, docs, git, and handoff checkpoints.",
    capabilities: ["repository-maintenance", "release", "documentation"],
    allowedTools: ["read", "edit", "bash", "git"],
    modelPolicy: {
      primary: "openai/gpt-5.1-codex",
      fallbacks: ["anthropic/claude-sonnet-4.5"],
    },
    fileScope: ["README.md", ".opencode/**", "docs/**", "packages/*/package.json", "package.json"],
    completionCriteria: ["Install path documented", "Release checkpoint decision recorded"],
    requiredEvidence: ["decision"],
    fallbacks: ["agent_atlas", "agent_oracle"],
  },
] satisfies AgentContract[]

export const defaultRunesmithAgentContract: AgentContract = cloneAgentContract(runesmithAgentContracts[0]!)

export function createRunesmithAgentContracts(): AgentContract[] {
  return runesmithAgentContracts.map(cloneAgentContract)
}

export function createRunesmithAgentContractMap(): Record<string, AgentContract> {
  return Object.fromEntries(createRunesmithAgentContracts().map((contract) => [contract.id, contract]))
}

function cloneAgentContract(contract: AgentContract): AgentContract {
  return {
    ...contract,
    capabilities: [...contract.capabilities],
    allowedTools: [...contract.allowedTools],
    modelPolicy: {
      primary: contract.modelPolicy.primary,
      fallbacks: [...contract.modelPolicy.fallbacks],
    },
    fileScope: [...contract.fileScope],
    completionCriteria: [...contract.completionCriteria],
    requiredEvidence: [...contract.requiredEvidence],
    fallbacks: [...contract.fallbacks],
  }
}
