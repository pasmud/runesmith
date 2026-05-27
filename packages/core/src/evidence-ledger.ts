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

export function missingRequiredEvidence(ledger: EvidenceLedger, input: RequiredEvidenceInput): EvidenceType[] {
  const taskEvidence = evidenceForTask(ledger, input.taskId)
  const missingEvidence = input.requiredEvidence.filter((type) => {
    return !taskEvidence.some((evidence, index) => evidenceSatisfiesRequiredType(evidence, type, taskEvidence, index))
  })

  if (hasUnresolvedRisk(taskEvidence) && !missingEvidence.includes("decision")) {
    missingEvidence.push("decision")
  }

  return missingEvidence
}

export function assertRequiredEvidence(ledger: EvidenceLedger, input: RequiredEvidenceInput) {
  const missingEvidence = missingRequiredEvidence(ledger, input)
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

function evidenceSatisfiesRequiredType(
  evidence: Evidence,
  requiredType: EvidenceType,
  taskEvidence: Evidence[],
  evidenceIndex: number,
): boolean {
  if (evidence.type !== requiredType) return false
  if (requiredType === "test-result") return isPassingTestResult(evidence) && isFreshProof(taskEvidence, evidenceIndex)

  return true
}

function isFreshProof(taskEvidence: Evidence[], proofIndex: number): boolean {
  const orderedEvidence = sortEvidenceOldest(taskEvidence)
  const proof = taskEvidence[proofIndex]
  const orderedProofIndex = proof ? orderedEvidence.indexOf(proof) : proofIndex
  const latestInvalidatingIndex = orderedEvidence.reduce((latestIndex, evidence, index) => {
    if (evidence.type !== "file-change" && evidence.type !== "diagnostic") return latestIndex

    return Math.max(latestIndex, index)
  }, -1)

  return latestInvalidatingIndex < 0 || orderedProofIndex >= latestInvalidatingIndex
}

function hasUnresolvedRisk(taskEvidence: Evidence[]): boolean {
  const orderedEvidence = sortEvidenceOldest(taskEvidence)
  let latestRiskIndex = -1
  let latestDecisionIndex = -1

  orderedEvidence.forEach((evidence, index) => {
    if (evidence.type === "risk") latestRiskIndex = index
    if (evidence.type === "decision") latestDecisionIndex = index
  })

  return latestRiskIndex >= 0 && latestRiskIndex > latestDecisionIndex
}

function sortEvidenceOldest(evidence: Evidence[]): Evidence[] {
  return [...evidence].sort((left, right) => {
    return left.createdAt.localeCompare(right.createdAt)
  })
}

function isPassingTestResult(evidence: Evidence): boolean {
  const exitCode = evidence.payload.exitCode
  if (typeof exitCode === "number") return exitCode === 0

  const status = evidence.payload.status ?? evidence.payload.outcome ?? evidence.payload.verdict
  if (typeof status !== "string") return false

  return ["ok", "pass", "passed", "success", "successful"].includes(status.toLowerCase())
}
