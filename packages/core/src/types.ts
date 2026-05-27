export type RuntimeErrorCode =
  | "MISSION_NOT_FOUND"
  | "TASK_NOT_FOUND"
  | "LEASE_CONFLICT"
  | "CONTRACT_INVALID"
  | "CAPABILITY_MISSING"
  | "EVIDENCE_REQUIRED"
  | "INVALID_TRANSITION"
  | "SNAPSHOT_INVALID"

export type RuntimeError = {
  code: RuntimeErrorCode
  message: string
  details?: Record<string, unknown>
}

export type Result<T, E = RuntimeError> =
  | {
      ok: true
      value: T
    }
  | {
      ok: false
      error: E
    }

export type IdPrefix =
  | "agent"
  | "contract"
  | "evidence"
  | "event"
  | "lease"
  | "mission"
  | "task"
  | "tool"

export type IdFactory = (prefix: IdPrefix) => string

export type MissionStatus =
  | "draft"
  | "running"
  | "blocked"
  | "verifying"
  | "complete"
  | "failed"
  | "cancelled"

export type TaskStatus =
  | "queued"
  | "running"
  | "blocked"
  | "stale"
  | "verifying"
  | "complete"
  | "failed"
  | "cancelled"

export type LeaseStatus = "active" | "released" | "expired"

export type EvidenceType =
  | "file-change"
  | "command-output"
  | "test-result"
  | "diagnostic"
  | "decision"
  | "risk"

export type MissionEvent = {
  id: string
  type: string
  at: string
  targetId: string
  message: string
  data?: Record<string, unknown>
}

export type MissionTask = {
  id: string
  missionId: string
  parentId?: string
  title: string
  description: string
  status: TaskStatus
  requiredCapabilities: string[]
  requiredEvidence?: EvidenceType[]
  dependsOn?: string[]
  assignedAgentId?: string
  createdAt: string
  updatedAt: string
  lastHeartbeatAt?: string
}

export type Mission = {
  id: string
  goal: string
  status: MissionStatus
  rootTaskId: string
  createdAt: string
  updatedAt: string
}

export type MissionGraph = {
  mission: Mission
  tasks: Record<string, MissionTask>
  events: MissionEvent[]
}

export type ModelPolicy = {
  primary: string
  fallbacks: string[]
}

export type AgentContract = {
  id: string
  displayName: string
  description: string
  capabilities: string[]
  allowedTools: string[]
  modelPolicy: ModelPolicy
  fileScope: string[]
  completionCriteria: string[]
  requiredEvidence: EvidenceType[]
  fallbacks: string[]
}

export type Evidence = {
  id: string
  taskId: string
  type: EvidenceType
  summary: string
  payload: Record<string, unknown>
  createdAt: string
}

export type Lease = {
  id: string
  targetId: string
  holder: string
  purpose: string
  idempotencyKey: string
  expiresAt: string
  status: LeaseStatus
  createdAt: string
}

export type Clock = () => Date

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<E extends RuntimeError>(error: E): Result<never, E> {
  return { ok: false, error }
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok
}

export function createId(prefix: IdPrefix, entropy = crypto.randomUUID()): string {
  return `${prefix}_${entropy}`
}
