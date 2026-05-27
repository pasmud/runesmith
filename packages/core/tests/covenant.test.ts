import { describe, expect, test } from "bun:test"

import {
  buildCovenantPrompt,
  createRunicCovenant,
  getNextCovenantStage,
} from "../src/covenant"

describe("runic covenant", () => {
  test("defines an autonomous end-to-end coding loop", () => {
    const covenant = createRunicCovenant()

    expect(covenant.name).toBe("Runic Covenant")
    expect(covenant.installMode).toBe("automatic")
    expect(covenant.stages.map((stage) => stage.id)).toEqual([
      "frame",
      "map",
      "claim",
      "forge",
      "prove",
      "review",
      "seal",
      "recover",
    ])
    expect(covenant.stages.every((stage) => stage.gates.length > 0)).toBe(true)
    expect(covenant.stages.every((stage) => stage.evidence.length > 0)).toBe(true)
  })

  test("builds a branded system prompt without external workflow naming", () => {
    const prompt = buildCovenantPrompt(createRunicCovenant())

    expect(prompt).toContain("Runic Covenant")
    expect(prompt).toContain("operate end to end")
    expect(prompt).toContain("required evidence")
    expect(prompt).toContain("recover stale or blocked work")
    expect(prompt).not.toContain("Superpowers")
  })

  test("advances through the covenant stages and loops recovery back to framing", () => {
    const covenant = createRunicCovenant()

    expect(getNextCovenantStage(covenant, "frame")?.id).toBe("map")
    expect(getNextCovenantStage(covenant, "seal")?.id).toBe("recover")
    expect(getNextCovenantStage(covenant, "recover")?.id).toBe("frame")
  })
})
