import { runtimeError } from "./errors"
import { err, ok, type Evidence, type EvidenceType } from "./types"

export type EvidenceLedger = {
  evidence: Record<string, Evidence>
}

export type RequiredEvidenceInput = {
  taskId: string
  requiredEvidence: EvidenceType[]
}

export function createEvidenceLedger(): EvidenceLedger {
  return { evidence: {} }
}

export function addEvidence(ledger: EvidenceLedger, evidence: Evidence) {
  return ok<EvidenceLedger>({
    evidence: {
      ...ledger.evidence,
      [evidence.id]: evidence,
    },
  })
}

export function evidenceForTask(ledger: EvidenceLedger, taskId: string): Evidence[] {
  return Object.values(ledger.evidence).filter((evidence) => evidence.taskId === taskId)
}

export function assertRequiredEvidence(ledger: EvidenceLedger, input: RequiredEvidenceInput) {
  const presentTypes = new Set(evidenceForTask(ledger, input.taskId).map((evidence) => evidence.type))
  const missingEvidence = input.requiredEvidence.filter((type) => !presentTypes.has(type))

  if (missingEvidence.length > 0) {
    return err(
      runtimeError("EVIDENCE_REQUIRED", "Task is missing required evidence", {
        taskId: input.taskId,
        missingEvidence,
      }),
    )
  }

  return ok(undefined)
}
