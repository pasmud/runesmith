import { describe, expect, test } from "bun:test"

import { createId, err, isErr, isOk, ok, runtimeError } from "../src/index"

describe("runtime result primitives", () => {
  test("creates success results with a stable discriminant", () => {
    const result = ok({ missionId: "mission_alpha" })

    expect(isOk(result)).toBe(true)
    expect(isErr(result)).toBe(false)
    expect(result).toEqual({
      ok: true,
      value: { missionId: "mission_alpha" },
    })
  })

  test("creates failure results with stable error codes", () => {
    const error = runtimeError("MISSION_NOT_FOUND", "Mission does not exist", {
      missionId: "mission_missing",
    })
    const result = err(error)

    expect(isOk(result)).toBe(false)
    expect(isErr(result)).toBe(true)
    expect(result).toEqual({
      ok: false,
      error: {
        code: "MISSION_NOT_FOUND",
        message: "Mission does not exist",
        details: { missionId: "mission_missing" },
      },
    })
  })

  test("creates readable ids with caller supplied entropy", () => {
    expect(createId("task", "alpha")).toBe("task_alpha")
  })
})
