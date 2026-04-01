import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { bootstrapTree, compileSource, parseProgram } from "../bootstrap/runtime.js";

test("parseProgram accepts line and block segments", () => {
  const program = parseProgram(
    [
      "# comment",
      'js: console.log("hello");',
      "```rs greet",
      "fn greet(name: &str) -> String {",
      '    format!("hi, {name}")',
      "}",
      "```",
      'go: fmt.Println("hello from go")',
      "",
    ].join("\n"),
  );

  assert.equal(program.segments.length, 3);
  assert.deepEqual(
    program.segments.map((segment) => segment.language),
    ["javascript", "rust", "go"],
  );
  assert.equal(program.segments[1].label, "greet");
});

test("compileSource writes manifest and lane outputs", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jizzrug-compile-"));
  const sourcePath = path.join(tmpDir, "demo.jizz");
  await fs.writeFile(
    sourcePath,
    [
      'js: console.log("alpha");',
      "```go main",
      "package main",
      "",
      'import "fmt"',
      "",
      "func main() {",
      '    fmt.Println("beta")',
      "}",
      "```",
      'zig: std.debug.print("gamma\\n", .{});',
      "",
    ].join("\n"),
    "utf8",
  );

  const outDir = path.join(tmpDir, "dist");
  const manifest = await compileSource(sourcePath, outDir);

  assert.deepEqual(
    manifest.outputs.map((output) => output.path),
    ["main.go", "main.js", "main.zig"],
  );
  assert.match(await fs.readFile(path.join(outDir, "main.go"), "utf8"), /fmt\.Println\("beta"\)/);
  assert.match(await fs.readFile(path.join(outDir, "plan.json"), "utf8"), /"language": "jizzrug"/);
});

test("bootstrapTree compiles the repository jizz source tree", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jizzrug-bootstrap-"));
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const manifest = await bootstrapTree(tmpDir, repoRoot);

  assert.ok(manifest.units.length >= 6);
  const sources = manifest.units.map((unit) => unit.source);
  assert.ok(sources.includes("rizz/cli.jizz"));
  assert.ok(sources.includes("examples/hello.jizz"));
  assert.match(await fs.readFile(path.join(tmpDir, "bootstrap-plan.json"), "utf8"), /"mode": "bootstrap"/);
});
