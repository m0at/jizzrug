import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  extractImports,
  resolveModulePath,
  buildDependencyGraph,
  topologicalOrder,
  CircularImportError,
  ModuleNotFoundError,
} from "../bootstrap/modules.js";

function tmpDir() {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), "jizzrug-modules-"));
}

test("extractImports finds @import directives", () => {
  const source = [
    '# comment',
    '@import "stdlib/io.jizz"',
    'js: console.log("hi");',
    '@import "stdlib/math.jizz"',
    '',
  ].join("\n");
  const imports = extractImports(source);
  assert.deepEqual(imports, ["stdlib/io.jizz", "stdlib/math.jizz"]);
});

test("extractImports returns empty for no imports", () => {
  assert.deepEqual(extractImports('js: console.log("hi");'), []);
});

test("resolveModulePath resolves relative paths", () => {
  const dir = tmpDir();
  const moduleFile = path.join(dir, "lib.jizz");
  fsSync.writeFileSync(moduleFile, "js: 1;");
  const fromFile = path.join(dir, "main.jizz");
  const resolved = resolveModulePath("lib.jizz", fromFile, dir);
  assert.equal(resolved, moduleFile);
});

test("resolveModulePath adds .jizz extension if missing", () => {
  const dir = tmpDir();
  const moduleFile = path.join(dir, "lib.jizz");
  fsSync.writeFileSync(moduleFile, "js: 1;");
  const fromFile = path.join(dir, "main.jizz");
  const resolved = resolveModulePath("lib", fromFile, dir);
  assert.equal(resolved, moduleFile);
});

test("resolveModulePath resolves stdlib paths from root", () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const resolved = resolveModulePath("stdlib/io.jizz", "/fake/main.jizz", root);
  assert.equal(resolved, path.join(root, "stdlib/io.jizz"));
});

test("resolveModulePath throws on missing module", () => {
  const dir = tmpDir();
  assert.throws(
    () => resolveModulePath("nonexistent.jizz", path.join(dir, "main.jizz"), dir),
    ModuleNotFoundError,
  );
});

test("buildDependencyGraph builds a simple graph", () => {
  const dir = tmpDir();
  fsSync.writeFileSync(path.join(dir, "a.jizz"), 'js: "a";');
  fsSync.writeFileSync(
    path.join(dir, "b.jizz"),
    '@import "a.jizz"\njs: "b";',
  );

  const graph = buildDependencyGraph(path.join(dir, "b.jizz"), dir);
  assert.equal(graph.size, 2);

  const bEntry = graph.get(path.resolve(dir, "b.jizz"));
  assert.equal(bEntry.imports.length, 1);
  assert.equal(bEntry.imports[0], path.resolve(dir, "a.jizz"));
});

test("buildDependencyGraph detects circular imports", () => {
  const dir = tmpDir();
  fsSync.writeFileSync(path.join(dir, "x.jizz"), '@import "y.jizz"\njs: 1;');
  fsSync.writeFileSync(path.join(dir, "y.jizz"), '@import "x.jizz"\njs: 2;');

  assert.throws(
    () => buildDependencyGraph(path.join(dir, "x.jizz"), dir),
    CircularImportError,
  );
});

test("buildDependencyGraph handles diamond dependencies", () => {
  const dir = tmpDir();
  fsSync.writeFileSync(path.join(dir, "base.jizz"), 'js: "base";');
  fsSync.writeFileSync(path.join(dir, "left.jizz"), '@import "base.jizz"\njs: "left";');
  fsSync.writeFileSync(path.join(dir, "right.jizz"), '@import "base.jizz"\njs: "right";');
  fsSync.writeFileSync(
    path.join(dir, "top.jizz"),
    '@import "left.jizz"\n@import "right.jizz"\njs: "top";',
  );

  const graph = buildDependencyGraph(path.join(dir, "top.jizz"), dir);
  assert.equal(graph.size, 4);
});

test("topologicalOrder returns correct compilation order", () => {
  const dir = tmpDir();
  fsSync.writeFileSync(path.join(dir, "a.jizz"), 'js: "a";');
  fsSync.writeFileSync(path.join(dir, "b.jizz"), '@import "a.jizz"\njs: "b";');
  fsSync.writeFileSync(path.join(dir, "c.jizz"), '@import "b.jizz"\njs: "c";');

  const graph = buildDependencyGraph(path.join(dir, "c.jizz"), dir);
  const order = topologicalOrder(graph);

  const aIdx = order.indexOf(path.resolve(dir, "a.jizz"));
  const bIdx = order.indexOf(path.resolve(dir, "b.jizz"));
  const cIdx = order.indexOf(path.resolve(dir, "c.jizz"));

  assert.ok(aIdx < bIdx, "a must come before b");
  assert.ok(bIdx < cIdx, "b must come before c");
});

test("stdlib io.jizz is parseable", async () => {
  const { parseProgram } = await import("../bootstrap/runtime.js");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const source = fsSync.readFileSync(path.join(root, "stdlib/io.jizz"), "utf8");
  const program = parseProgram(source);
  const lanes = new Set(program.segments.map(s => s.language));
  assert.ok(lanes.has("javascript"));
  assert.ok(lanes.has("rust"));
  assert.ok(lanes.has("go"));
  assert.ok(lanes.has("zig"));
});

test("stdlib fmt.jizz is parseable", async () => {
  const { parseProgram } = await import("../bootstrap/runtime.js");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const source = fsSync.readFileSync(path.join(root, "stdlib/fmt.jizz"), "utf8");
  const program = parseProgram(source);
  const lanes = new Set(program.segments.map(s => s.language));
  assert.ok(lanes.has("javascript"));
  assert.ok(lanes.has("rust"));
  assert.ok(lanes.has("go"));
  assert.ok(lanes.has("zig"));
});

test("stdlib math.jizz is parseable", async () => {
  const { parseProgram } = await import("../bootstrap/runtime.js");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const source = fsSync.readFileSync(path.join(root, "stdlib/math.jizz"), "utf8");
  const program = parseProgram(source);
  const lanes = new Set(program.segments.map(s => s.language));
  assert.ok(lanes.has("javascript"));
  assert.ok(lanes.has("rust"));
  assert.ok(lanes.has("go"));
  assert.ok(lanes.has("zig"));
});

test("stdlib collections.jizz is parseable", async () => {
  const { parseProgram } = await import("../bootstrap/runtime.js");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const source = fsSync.readFileSync(path.join(root, "stdlib/collections.jizz"), "utf8");
  const program = parseProgram(source);
  const lanes = new Set(program.segments.map(s => s.language));
  assert.ok(lanes.has("javascript"));
  assert.ok(lanes.has("rust"));
  assert.ok(lanes.has("go"));
  assert.ok(lanes.has("zig"));
});

test("stdlib JS segments are evaluable", async () => {
  const { parseProgram } = await import("../bootstrap/runtime.js");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const vm = await import("node:vm");

  for (const mod of ["io", "fmt", "math", "collections"]) {
    const source = fsSync.readFileSync(path.join(root, `stdlib/${mod}.jizz`), "utf8");
    const program = parseProgram(source);
    const jsSegments = program.segments.filter(s => s.language === "javascript");
    assert.ok(jsSegments.length > 0, `${mod} should have JS segments`);

    const code = jsSegments.map(s => s.source).join("\n\n")
      .replace(/export\s+const\s+([A-Za-z0-9_]+)\s*=/g, "exports.$1 =")
      .replace(/export\s+function\s+([A-Za-z0-9_]+)\s*\(/g, "exports.$1 = function $1(")
      .replace(/export\s+default\s+/g, "exports.default = ");

    const exports = {};
    const ctx = vm.createContext({ exports, process, require: (m) => { throw new Error("no require"); } });
    assert.doesNotThrow(() => new vm.Script(code).runInContext(ctx), `${mod} JS should evaluate`);
  }
});

test("modules.jizz declares module system", async () => {
  const { parseProgram } = await import("../bootstrap/runtime.js");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const source = fsSync.readFileSync(path.join(root, "jizzrug/modules.jizz"), "utf8");
  const program = parseProgram(source);
  const lanes = new Set(program.segments.map(s => s.language));
  assert.ok(lanes.has("javascript"));
  assert.ok(lanes.has("rust"));
  assert.ok(lanes.has("go"));
  assert.ok(lanes.has("zig"));
});

test("circular import error includes cycle path", () => {
  const dir = tmpDir();
  fsSync.writeFileSync(path.join(dir, "a.jizz"), '@import "b.jizz"\njs: 1;');
  fsSync.writeFileSync(path.join(dir, "b.jizz"), '@import "c.jizz"\njs: 2;');
  fsSync.writeFileSync(path.join(dir, "c.jizz"), '@import "a.jizz"\njs: 3;');

  try {
    buildDependencyGraph(path.join(dir, "a.jizz"), dir);
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(err instanceof CircularImportError);
    assert.ok(err.cycle.length >= 3, "cycle should include at least 3 nodes");
    assert.ok(err.message.includes("Circular import"));
  }
});
