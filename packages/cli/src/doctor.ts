import {
  createCovenantDecisionDraft,
  createCovenantTaskPlan,
  createRuntime,
  defaultRuntimeCapsulePath,
  deriveLoopPulse,
  loadRuntimeCapsule,
  type AgentContract,
  type IdFactory,
  type MissionTask,
} from "@runesmith/core"
import { parse, type ParseError } from "jsonc-parser"

import type { CliHost, CliResult } from "./index"
import {
  getDefaultOpenCodeConfigPath,
  getDefaultOpenCodePluginDir,
  isRunesmithPluginEntry,
  parseOptions,
  type ParsedOptions,
} from "./options"

type DoctorCheck = {
  label: string
  path?: string
  status: "found" | "missing" | "valid" | "invalid" | "passed" | "failed"
  detail?: string
  ok: boolean
}

export async function runDoctor(args: string[], host: CliHost): Promise<CliResult> {
  const options = parseOptions(args)
  const checks: DoctorCheck[] = [
    await checkProjectConfig(host),
    await checkRuntimeCapsule(host),
    await checkOpenCodePlugin(host, options),
    runLoopSmokeCheck(),
  ]
  const ready = checks.every((check) => check.ok)
  const lines = [
    "Runesmith doctor",
    ...checks.map(formatDoctorCheck),
    `status: ${ready ? "ready" : "incomplete"}`,
  ]

  if (!ready) {
    lines.push("next: run `runesmith up` to initialize config, runtime, and OpenCode plugin wiring.")
  }

  return {
    exitCode: ready ? 0 : 1,
    stdout: `${lines.join("\n")}\n`,
    stderr: "",
  }
}

async function checkProjectConfig(host: CliHost): Promise<DoctorCheck> {
  const path = ".runesmith/config.json"
  const found = await host.exists(path)

  return {
    label: "config",
    path,
    status: found ? "found" : "missing",
    ok: found,
  }
}

async function checkRuntimeCapsule(host: CliHost): Promise<DoctorCheck> {
  const capsule = await loadRuntimeCapsule(host, defaultRuntimeCapsulePath)

  if (!capsule.ok) {
    return {
      label: "runtime capsule",
      path: defaultRuntimeCapsulePath,
      status: "invalid",
      detail: capsule.error.message,
      ok: false,
    }
  }

  if (!capsule.value) {
    return {
      label: "runtime capsule",
      path: defaultRuntimeCapsulePath,
      status: "missing",
      ok: false,
    }
  }

  return {
    label: "runtime capsule",
    path: defaultRuntimeCapsulePath,
    status: "valid",
    ok: true,
  }
}

async function checkOpenCodePlugin(host: CliHost, options: ParsedOptions): Promise<DoctorCheck> {
  const mode = options.mode ?? "local"

  if (mode === "npm") {
    return checkOpenCodeNpmPlugin(host, options.config ?? getDefaultOpenCodeConfigPath())
  }

  if (mode !== "local") {
    return {
      label: "opencode plugin",
      status: "invalid",
      detail: `unknown install mode: ${mode}`,
      ok: false,
    }
  }

  const pluginDir = options.pluginDir ?? getDefaultOpenCodePluginDir()
  const pluginPath = `${pluginDir.replace(/[\\/]$/, "")}/runesmith.ts`
  return checkOpenCodeLocalPlugin(host, pluginPath)
}

async function checkOpenCodeLocalPlugin(host: CliHost, pluginPath: string): Promise<DoctorCheck> {
  if (!(await host.exists(pluginPath))) {
    return {
      label: "opencode plugin",
      path: pluginPath,
      status: "missing",
      ok: false,
    }
  }

  const source = await host.readText(pluginPath)
  const valid = source.includes("opencode-adapter") || source.includes("@runesmith/opencode-adapter")

  return {
    label: "opencode plugin",
    path: pluginPath,
    status: valid ? "found" : "invalid",
    detail: valid ? undefined : "shim does not reference the Runesmith OpenCode adapter",
    ok: valid,
  }
}

async function checkOpenCodeNpmPlugin(host: CliHost, configPath: string): Promise<DoctorCheck> {
  if (!(await host.exists(configPath))) {
    return {
      label: "opencode plugin",
      path: configPath,
      status: "missing",
      ok: false,
    }
  }

  const current = await host.readText(configPath)
  const errors: ParseError[] = []
  const parsed = parse(current, errors, { allowTrailingComma: true }) as { plugin?: unknown } | undefined
  if (errors.length > 0 || !parsed || typeof parsed !== "object") {
    return {
      label: "opencode plugin",
      path: configPath,
      status: "invalid",
      detail: "OpenCode config is not valid JSONC",
      ok: false,
    }
  }

  const entries = Array.isArray(parsed.plugin)
    ? parsed.plugin.filter((entry): entry is string => typeof entry === "string")
    : []
  const found = entries.some(isRunesmithPluginEntry)

  return {
    label: "opencode plugin",
    path: configPath,
    status: found ? "found" : "missing",
    detail: found ? undefined : "Runesmith plugin entry is not configured",
    ok: found,
  }
}

function runLoopSmokeCheck(): DoctorCheck {
  const smoke = runLoopSmokeTest()

  return {
    label: "loop smoke",
    status: smoke.ok ? "passed" : "failed",
    detail: smoke.message,
    ok: smoke.ok,
  }
}

function formatDoctorCheck(check: DoctorCheck): string {
  const path = check.path ? ` (${check.path})` : ""
  const detail = check.detail ? check.path ? ` - ${check.detail}` : ` (${check.detail})` : ""

  return `${check.label}: ${check.status}${path}${detail}`
}

function runLoopSmokeTest(): { ok: true; message: string } | { ok: false; message: string } {
  const now = () => new Date("2026-05-27T00:00:00.000Z")
  const runtime = createRuntime({
    idFactory: createSmokeIdFactory(),
    now,
  })
  const contract: AgentContract = {
    id: "agent_runesmith_smoke",
    displayName: "Runesmith Smoke Agent",
    description: "Internal doctor contract for validating the local orchestration loop.",
    capabilities: ["typescript", "testing", "repository-maintenance"],
    allowedTools: ["read", "edit", "bash", "test"],
    modelPolicy: {
      primary: "internal/doctor",
      fallbacks: [],
    },
    fileScope: ["**/*"],
    completionCriteria: ["Mission completes"],
    requiredEvidence: ["decision"],
    fallbacks: [],
  }
  runtime.registerContract(contract)

  const mission = runtime.startMission({
    goal: "Run Runesmith doctor smoke",
    taskPlan: createCovenantTaskPlan("Run Runesmith doctor smoke"),
  })
  if (!mission.ok) return { ok: false, message: mission.error.message }

  const taskIds = [
    mission.value.rootTaskId,
    `${mission.value.rootTaskId}_review`,
    `${mission.value.rootTaskId}_seal`,
  ]
  const forge = claimSmokeTask(runtime, mission.value.missionId, taskIds[0]!, "forge")
  if (!forge.ok) return forge

  const fileEvidence = runtime.addTaskEvidence({
    missionId: mission.value.missionId,
    evidence: {
      id: "evidence_smoke_file",
      taskId: taskIds[0]!,
      type: "file-change",
      summary: "Doctor smoke produced a synthetic file-change proof.",
      payload: { mode: "doctor-smoke" },
      createdAt: now().toISOString(),
    },
  })
  if (!fileEvidence.ok) return { ok: false, message: fileEvidence.error.message }

  const testEvidence = runtime.addTaskEvidence({
    missionId: mission.value.missionId,
    evidence: {
      id: "evidence_smoke_test",
      taskId: taskIds[0]!,
      type: "test-result",
      summary: "Doctor smoke synthetic verification passed.",
      payload: { command: "runesmith doctor smoke", exitCode: 0 },
      createdAt: now().toISOString(),
    },
  })
  if (!testEvidence.ok) return { ok: false, message: testEvidence.error.message }

  const completedForge = runtime.completeTask({
    missionId: mission.value.missionId,
    taskId: taskIds[0]!,
    contractId: contract.id,
  })
  if (!completedForge.ok) return { ok: false, message: completedForge.error.message }

  const review = claimSmokeTask(runtime, mission.value.missionId, taskIds[1]!, "review")
  if (!review.ok) return review
  const reviewDecision = createCovenantDecisionDraft(review.task)
  if (!reviewDecision) return { ok: false, message: "Review decision draft was not created" }
  const reviewEvidence = runtime.addTaskEvidence({
    missionId: mission.value.missionId,
    evidence: {
      id: "evidence_smoke_review",
      taskId: taskIds[1]!,
      type: "decision",
      summary: reviewDecision.summary,
      payload: reviewDecision.payload,
      createdAt: now().toISOString(),
    },
  })
  if (!reviewEvidence.ok) return { ok: false, message: reviewEvidence.error.message }
  const completedReview = runtime.completeTask({
    missionId: mission.value.missionId,
    taskId: taskIds[1]!,
    contractId: contract.id,
  })
  if (!completedReview.ok) return { ok: false, message: completedReview.error.message }

  const seal = claimSmokeTask(runtime, mission.value.missionId, taskIds[2]!, "seal")
  if (!seal.ok) return seal
  const sealDecision = createCovenantDecisionDraft(seal.task)
  if (!sealDecision) return { ok: false, message: "Seal decision draft was not created" }
  const sealEvidence = runtime.addTaskEvidence({
    missionId: mission.value.missionId,
    evidence: {
      id: "evidence_smoke_seal",
      taskId: taskIds[2]!,
      type: "decision",
      summary: sealDecision.summary,
      payload: sealDecision.payload,
      createdAt: now().toISOString(),
    },
  })
  if (!sealEvidence.ok) return { ok: false, message: sealEvidence.error.message }
  const completedSeal = runtime.completeTask({
    missionId: mission.value.missionId,
    taskId: taskIds[2]!,
    contractId: contract.id,
  })
  if (!completedSeal.ok) return { ok: false, message: completedSeal.error.message }

  const pulse = deriveLoopPulse(runtime.snapshot())
  if (completedSeal.value.graph.mission.status !== "complete" || pulse.nextAction.id !== "wait-for-goal") {
    return { ok: false, message: "mission did not return to idle after seal" }
  }

  return { ok: true, message: "mission completed" }
}

function claimSmokeTask(
  runtime: ReturnType<typeof createRuntime>,
  missionId: string,
  taskId: string,
  stage: string,
): { ok: true; task: MissionTask } | { ok: false; message: string } {
  const claimed = runtime.claimTask({
    missionId,
    taskId,
    contractId: "agent_runesmith_smoke",
    holder: "runesmith-doctor",
    idempotencyKey: `doctor-smoke-${stage}`,
    ttlMs: 30_000,
  })

  if (!claimed.ok) return { ok: false, message: claimed.error.message }
  return { ok: true, task: claimed.value.task }
}

function createSmokeIdFactory(): IdFactory {
  const counts = new Map<string, number>()

  return (prefix) => {
    const count = (counts.get(prefix) ?? 0) + 1
    counts.set(prefix, count)

    return `${prefix}_smoke_${count}`
  }
}
