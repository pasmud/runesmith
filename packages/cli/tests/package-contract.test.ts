import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

type PackageJson = {
  name: string
  version: string
  main?: string
  types?: string
  bin?: Record<string, string>
  exports?: Record<string, {
    types?: string
    bun?: string
    import?: string
  }>
  files?: string[]
  dependencies?: Record<string, string>
  scripts?: Record<string, string>
}

const rootDir = fileURLToPath(new URL("../../../", import.meta.url))

function readPackage(path: string): PackageJson {
  return JSON.parse(readFileSync(join(rootDir, path), "utf8")) as PackageJson
}

function listTypeScriptSourceFiles(path: string): string[] {
  const absolutePath = join(rootDir, path)
  const stat = statSync(absolutePath)
  if (stat.isFile()) return path.endsWith(".ts") ? [path] : []

  return readdirSync(absolutePath)
    .flatMap((entry) => listTypeScriptSourceFiles(join(path, entry)))
}

function findExtensionlessRelativeSpecifiers(path: string): string[] {
  const source = readFileSync(join(rootDir, path), "utf8")
  const specifierPattern = /(?:\bfrom\s+|\bimport\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g
  const violations: string[] = []

  for (const match of source.matchAll(specifierPattern)) {
    const specifier = match[1]
    if (!specifier) continue
    const bareSpecifier = specifier.split(/[?#]/, 1)[0] ?? specifier
    if (!/\.[cm]?js$/.test(bareSpecifier)) {
      violations.push(`${relative(rootDir, join(rootDir, path))}: ${specifier}`)
    }
  }

  return violations
}

describe("package publish contracts", () => {
  test("repo root is installable as an OpenCode git plugin package", () => {
    const pkg = readPackage("package.json")

    expect(pkg.name).toBe("runesmith")
    expect(pkg.main).toBe("./packages/opencode-adapter/dist/plugin.js")
    expect(pkg.bin).toEqual({
      runesmith: "./packages/cli/dist/index.js",
    })
    expect(pkg.exports?.["."]).toEqual({
      types: "./packages/opencode-adapter/dist/plugin.d.ts",
      bun: "./packages/opencode-adapter/src/plugin.ts",
      import: "./packages/opencode-adapter/dist/plugin.js",
    })
    expect(pkg.scripts?.prepare).toBe("bun run build")
    expect(pkg.dependencies?.["@runesmith/core"]).toBe("file:packages/core")
    expect(pkg.dependencies?.["jsonc-parser"]).toBe("^3.3.1")
    expect(pkg.files).toEqual([
      ".opencode/INSTALL.md",
      ".opencode/skills",
      "packages/cli/dist",
      "packages/cli/src",
      "packages/cli/package.json",
      "packages/core/dist",
      "packages/core/src",
      "packages/core/package.json",
      "packages/dashboard/dist",
      "packages/opencode-adapter/dist",
      "packages/opencode-adapter/src",
      "packages/opencode-adapter/package.json",
      "README.md",
      "LICENSE",
    ])
  })

  test("published packages expose built entrypoints while keeping Bun source imports available", () => {
    const packages = [
      {
        path: "packages/core/package.json",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        bun: "./src/index.ts",
      },
      {
        path: "packages/opencode-adapter/package.json",
        main: "./dist/plugin.js",
        types: "./dist/plugin.d.ts",
        bun: "./src/plugin.ts",
      },
      {
        path: "packages/cli/package.json",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        bun: "./src/index.ts",
      },
      {
        path: "packages/testbench/package.json",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        bun: "./src/index.ts",
      },
    ]

    for (const expectation of packages) {
      const pkg = readPackage(expectation.path)

      expect(pkg.main).toBe(expectation.main)
      expect(pkg.types).toBe(expectation.types)
      expect(pkg.exports?.["."]).toEqual({
        types: expectation.types,
        bun: expectation.bun,
        import: expectation.main,
      })
      expect(pkg.files).toEqual(["dist", "src"])
      expect(pkg.scripts?.prepack).toBe("bun run build")
    }
  })

  test("cli package installs a built runesmith binary", () => {
    const pkg = readPackage("packages/cli/package.json")

    expect(pkg.bin).toEqual({
      runesmith: "./dist/index.js",
    })
  })

  test("workspace packages use publishable internal dependency ranges", () => {
    for (const path of [
      "packages/cli/package.json",
      "packages/opencode-adapter/package.json",
      "packages/testbench/package.json",
    ]) {
      const pkg = readPackage(path)

      expect(pkg.dependencies?.["@runesmith/core"]).toBe(pkg.version)
    }
  })

  test("publishable source uses Node-resolvable relative ESM specifiers", () => {
    const violations = [
      "packages/core/src",
      "packages/cli/src",
      "packages/opencode-adapter/src",
      "packages/testbench/src",
    ].flatMap((path) => listTypeScriptSourceFiles(path))
      .flatMap(findExtensionlessRelativeSpecifiers)

    expect(violations).toEqual([])
  })
})
