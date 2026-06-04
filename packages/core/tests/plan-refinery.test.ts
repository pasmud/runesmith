import { describe, expect, test } from "bun:test"

import { createRunicPlanRefinementTaskPlan } from "../src/index"

describe("plan refinery", () => {
  test("synthesizes install and runtime slices for direct OpenCode orchestration goals", () => {
    const plan = createRunicPlanRefinementTaskPlan("Build install-direct orchestration for the OpenCode plugin")

    expect(plan.map((task) => task.key)).toEqual([
      "pathfinder-plan",
      "runtime-forge",
      "install-forge",
      "proof-review",
      "seal-handoff",
    ])
    expect(plan.find((task) => task.key === "runtime-forge")).toMatchObject({
      title: "Forge: orchestration engine path",
      requiredCapabilities: ["typescript", "testing"],
      requiredEvidence: ["file-change", "test-result"],
      dependsOn: ["pathfinder-plan"],
    })
    expect(plan.find((task) => task.key === "install-forge")).toMatchObject({
      title: "Forge: direct install surface",
      requiredCapabilities: ["typescript", "testing", "repository-maintenance"],
      requiredEvidence: ["file-change", "test-result"],
      dependsOn: ["pathfinder-plan"],
    })
    expect(plan.find((task) => task.key === "proof-review")).toMatchObject({
      dependsOn: ["runtime-forge", "install-forge"],
    })
  })

  test("synthesizes repair and interface slices for dashboard bugfix goals", () => {
    const plan = createRunicPlanRefinementTaskPlan("Fix dashboard clicks and make the UI white theme crisp")

    expect(plan.map((task) => task.key)).toEqual([
      "pathfinder-plan",
      "repair-forge",
      "interface-forge",
      "proof-review",
      "seal-handoff",
    ])
    expect(plan.find((task) => task.key === "repair-forge")).toMatchObject({
      title: "Forge: focused repair path",
      requiredCapabilities: ["typescript", "testing"],
      requiredEvidence: ["file-change", "test-result"],
      dependsOn: ["pathfinder-plan"],
    })
    expect(plan.find((task) => task.key === "interface-forge")).toMatchObject({
      title: "Forge: operator interface path",
      requiredCapabilities: ["typescript", "ui", "accessibility"],
      requiredEvidence: ["file-change", "test-result"],
      dependsOn: ["pathfinder-plan"],
    })
    expect(plan.find((task) => task.key === "proof-review")).toMatchObject({
      dependsOn: ["repair-forge", "interface-forge"],
    })
  })

  test("turns simple app build goals into scout research WBS and shadcn UI slices", () => {
    const plan = createRunicPlanRefinementTaskPlan("Build me a polished 2048 game")

    expect(plan.map((task) => task.key)).toEqual([
      "pathfinder-plan",
      "interface-forge",
      "proof-review",
      "seal-handoff",
    ])
    expect(plan.find((task) => task.key === "pathfinder-plan")).toMatchObject({
      title: "Plan: Build me a polished 2048 game",
      requiredCapabilities: ["research", "repository-maintenance"],
      requiredEvidence: ["decision"],
    })
    expect(plan.find((task) => task.key === "pathfinder-plan")?.description).toContain("runesmith-scout")
    expect(plan.find((task) => task.key === "pathfinder-plan")?.description).toContain("Lead-blended WBS")
    expect(plan.find((task) => task.key === "pathfinder-plan")?.description).toContain("acceptance criteria")
    expect(plan.find((task) => task.key === "interface-forge")).toMatchObject({
      title: "Forge: operator interface path",
      requiredCapabilities: ["typescript", "ui", "accessibility"],
      requiredEvidence: ["file-change", "test-result"],
      dependsOn: ["pathfinder-plan"],
    })
    expect(plan.find((task) => task.key === "interface-forge")?.description).toContain("shadcn/ui")
    expect(plan.find((task) => task.key === "interface-forge")?.description).toContain("clean spacing")
    expect(plan.find((task) => task.key === "interface-forge")?.description).toContain("rounded")
    expect(plan.find((task) => task.key === "interface-forge")?.description).toContain("motion")
  })

  test("keeps documentation goals focused instead of inventing runtime and interface work", () => {
    const plan = createRunicPlanRefinementTaskPlan("Document the Runesmith install and recovery flow")

    expect(plan.map((task) => task.key)).toEqual([
      "pathfinder-plan",
      "docs-forge",
      "proof-review",
      "seal-handoff",
    ])
    expect(plan.find((task) => task.key === "docs-forge")).toMatchObject({
      title: "Forge: documentation and handoff path",
      requiredCapabilities: ["documentation", "repository-maintenance"],
      requiredEvidence: ["file-change", "test-result"],
      dependsOn: ["pathfinder-plan"],
    })
    expect(plan.some((task) => task.key === "runtime-forge")).toBe(false)
    expect(plan.some((task) => task.key === "interface-forge")).toBe(false)
  })
})
