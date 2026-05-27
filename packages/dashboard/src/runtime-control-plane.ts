import {
  applyRuntimeControlAction,
  type ProofCommandExecution,
  type ProofPlanCommand,
  type RuntimeControlAction,
  type RuntimeControlActionOptions,
  type RuntimeControlActionResult,
  type RuntimeControlActionValue,
  type RuntimeSnapshot,
} from "@runesmith/core"
import { spawn } from "node:child_process"

export type DashboardRuntimeAction = RuntimeControlAction
export type DashboardRuntimeActionValue = RuntimeControlActionValue
export type DashboardRuntimeActionResult = RuntimeControlActionResult
export type DashboardRuntimeActionOptions = RuntimeControlActionOptions

const shellProofCaptureLimit = 64_000

export async function applyDashboardRuntimeAction(
  snapshot: RuntimeSnapshot,
  action: DashboardRuntimeAction,
  options: DashboardRuntimeActionOptions = {},
): Promise<DashboardRuntimeActionResult> {
  return applyRuntimeControlAction(snapshot, action, {
    ...options,
    runProofCommand: options.runProofCommand ?? runDashboardShellCommand,
  })
}

async function runDashboardShellCommand(command: ProofPlanCommand): Promise<ProofCommandExecution> {
  return new Promise((resolve) => {
    const child = spawn(command.command, {
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    const settle = (execution: ProofCommandExecution) => {
      if (settled) return
      settled = true
      resolve(execution)
    }

    child.stdout?.on("data", (chunk) => {
      stdout = appendBoundedOutput(stdout, chunk, shellProofCaptureLimit)
    })
    child.stderr?.on("data", (chunk) => {
      stderr = appendBoundedOutput(stderr, chunk, shellProofCaptureLimit)
    })
    child.on("error", (error) => {
      settle({
        exitCode: 1,
        stdout,
        stderr: appendBoundedOutput(stderr, error.message, shellProofCaptureLimit),
      })
    })
    child.on("close", (code) => {
      settle({
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      })
    })
  })
}

function appendBoundedOutput(current: string, chunk: unknown, maxLength: number): string {
  if (current.length >= maxLength) return current

  const text = String(chunk)
  const remaining = maxLength - current.length

  return `${current}${text.slice(0, remaining)}`
}
