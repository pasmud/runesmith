import type { ProofPlan, ProofPlanCommand } from "./proof-plan"
import type { RunesmithRuntime } from "./runtime"
import type { EvidenceType } from "./types"

export type ProofCommandExecution = {
  exitCode: number
  stdout?: string
  stderr?: string
}

export type ProofCommandRunner = (command: ProofPlanCommand) => Promise<ProofCommandExecution> | ProofCommandExecution

export type ProofRunCommandResult = {
  evidenceId: string
  command: string
  kind: ProofPlanCommand["kind"]
  label: string
  exitCode: number
  evidenceType: EvidenceType
  stdout?: string
  stderr?: string
  stdoutTruncated?: boolean
  stderrTruncated?: boolean
}

export type ProofRunStatus = "idle" | "passed" | "failed"

export type ProofRunResult = {
  status: ProofRunStatus
  missionId?: string
  taskId?: string
  commands: ProofRunCommandResult[]
}

export type RunProofPlanOptions = {
  nextEvidenceId: () => string
  now?: () => Date
  runCommand: ProofCommandRunner
  maxOutputLength?: number
}

const defaultProofOutputLimit = 4_000

export async function runProofPlan(
  runtime: RunesmithRuntime,
  plan: ProofPlan,
  options: RunProofPlanOptions,
): Promise<ProofRunResult> {
  if (!plan.missionId || !plan.taskId || plan.commands.length === 0) {
    return {
      status: "idle",
      missionId: plan.missionId,
      taskId: plan.taskId,
      commands: [],
    }
  }

  const results: ProofRunCommandResult[] = []
  const maxOutputLength = normalizeOutputLimit(options.maxOutputLength)
  for (const command of plan.commands) {
    const execution = await options.runCommand(command)
    const passed = execution.exitCode === 0
    const evidenceType: EvidenceType = passed ? "test-result" : "diagnostic"
    const evidenceId = options.nextEvidenceId()
    const stdout = truncateProofOutput(execution.stdout, maxOutputLength)
    const stderr = truncateProofOutput(execution.stderr, maxOutputLength)
    const result: ProofRunCommandResult = {
      evidenceId,
      command: command.command,
      kind: command.kind,
      label: command.label,
      exitCode: execution.exitCode,
      evidenceType,
      stdout: stdout.value,
      stderr: stderr.value,
      stdoutTruncated: stdout.truncated || undefined,
      stderrTruncated: stderr.truncated || undefined,
    }

    const recorded = runtime.addTaskEvidence({
      missionId: plan.missionId,
      evidence: {
        id: evidenceId,
        taskId: plan.taskId,
        type: evidenceType,
        summary: `${command.label} ${passed ? "passed" : "failed"}: ${command.command}`,
        payload: {
          command: command.command,
          kind: command.kind,
          label: command.label,
          exitCode: execution.exitCode,
          mode: "runesmith-proof-runner",
          stdout: stdout.value,
          stderr: stderr.value,
          stdoutTruncated: stdout.truncated || undefined,
          stderrTruncated: stderr.truncated || undefined,
        },
        createdAt: (options.now?.() ?? new Date()).toISOString(),
      },
    })
    if (!recorded.ok) {
      return {
        status: "failed",
        missionId: plan.missionId,
        taskId: plan.taskId,
        commands: results,
      }
    }

    results.push(result)
    if (!passed) {
      return {
        status: "failed",
        missionId: plan.missionId,
        taskId: plan.taskId,
        commands: results,
      }
    }
  }

  return {
    status: "passed",
    missionId: plan.missionId,
    taskId: plan.taskId,
    commands: results,
  }
}

function normalizeOutputLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return defaultProofOutputLimit
  }

  return value
}

function truncateProofOutput(value: string | undefined, maxLength: number): { value?: string; truncated: boolean } {
  if (value === undefined || value.length <= maxLength) {
    return { value, truncated: false }
  }

  return {
    value: `${value.slice(0, maxLength)}...`,
    truncated: true,
  }
}
