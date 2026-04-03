import test from "node:test";
import assert from "node:assert/strict";

import {
  removeEmptySegments,
  stripComments,
  consolidateLanes,
  eliminateDeadSegments,
  optimize,
} from "../bootstrap/optimizer.js";

import {
  generateFFIStubs,
  generateMakefile,
  generateInteropTypes,
} from "../bootstrap/codegen.js";

function makeProgram(segments) {
  return { segments };
}

function seg(id, language, source, opts = {}) {
  return {
    id,
    language,
    kind: opts.kind || "line",
    label: opts.label || null,
    lineStart: opts.lineStart || id,
    source,
  };
}

// --- removeEmptySegments ---

test("removeEmptySegments drops segments with empty source", () => {
  const program = makeProgram([
    seg(1, "javascript", 'console.log("a")'),
    seg(2, "go", ""),
    seg(3, "rust", "   "),
    seg(4, "zig", 'std.debug.print("b"\\n, .{})'),
  ]);
  const result = removeEmptySegments(program);
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].id, 1);
  assert.equal(result.segments[1].id, 4);
});

test("removeEmptySegments preserves non-empty segments", () => {
  const program = makeProgram([
    seg(1, "javascript", "x = 1"),
    seg(2, "go", "y := 2"),
  ]);
  const result = removeEmptySegments(program);
  assert.equal(result.segments.length, 2);
});

// --- stripComments ---

test("stripComments removes comment-only lines from segment source", () => {
  const program = makeProgram([
    seg(1, "javascript", "// this is a comment\nconst x = 1;\n// another comment\nconst y = 2;"),
  ]);
  const result = stripComments(program);
  assert.equal(result.segments[0].source, "const x = 1;\nconst y = 2;");
});

test("stripComments preserves lines containing !", () => {
  const program = makeProgram([
    seg(1, "rust", '//! Module doc\n// remove this\nfn main() {}'),
  ]);
  const result = stripComments(program);
  assert.match(result.segments[0].source, /\/\/! Module doc/);
  assert.ok(!result.segments[0].source.includes("remove this"));
});

// --- consolidateLanes ---

test("consolidateLanes merges adjacent same-lane line segments", () => {
  const program = makeProgram([
    seg(1, "javascript", "const a = 1;"),
    seg(2, "javascript", "const b = 2;"),
    seg(3, "go", 'fmt.Println("c")'),
  ]);
  const result = consolidateLanes(program);
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].source, "const a = 1;\nconst b = 2;");
  assert.equal(result.segments[1].language, "go");
});

test("consolidateLanes does not merge block segments", () => {
  const program = makeProgram([
    seg(1, "javascript", "const a = 1;", { kind: "block", label: "foo" }),
    seg(2, "javascript", "const b = 2;", { kind: "block", label: "bar" }),
  ]);
  const result = consolidateLanes(program);
  assert.equal(result.segments.length, 2);
});

test("consolidateLanes does not merge segments with labels", () => {
  const program = makeProgram([
    seg(1, "javascript", "const a = 1;", { label: "first" }),
    seg(2, "javascript", "const b = 2;"),
  ]);
  const result = consolidateLanes(program);
  assert.equal(result.segments.length, 2);
});

test("consolidateLanes does not merge different lanes", () => {
  const program = makeProgram([
    seg(1, "javascript", "a"),
    seg(2, "go", "b"),
    seg(3, "javascript", "c"),
  ]);
  const result = consolidateLanes(program);
  assert.equal(result.segments.length, 3);
});

// --- eliminateDeadSegments ---

test("eliminateDeadSegments removes labeled segments not referenced", () => {
  const program = makeProgram([
    seg(1, "javascript", 'console.log("used")'),
    seg(2, "rust", "fn unused() {}", { kind: "block", label: "dead_code" }),
    seg(3, "go", 'fmt.Println("also used")'),
  ]);
  const result = eliminateDeadSegments(program);
  assert.equal(result.segments.length, 2);
  assert.ok(!result.segments.find((s) => s.label === "dead_code"));
});

test("eliminateDeadSegments keeps labeled segments that are referenced", () => {
  const program = makeProgram([
    seg(1, "javascript", "// @ref greet"),
    seg(2, "rust", "fn greet() {}", { kind: "block", label: "greet" }),
  ]);
  const result = eliminateDeadSegments(program);
  assert.equal(result.segments.length, 2);
});

test("eliminateDeadSegments keeps unlabeled segments", () => {
  const program = makeProgram([
    seg(1, "javascript", "const x = 1;"),
    seg(2, "go", "y := 2"),
  ]);
  const result = eliminateDeadSegments(program);
  assert.equal(result.segments.length, 2);
});

// --- optimize (combined) ---

test("optimize applies all passes", () => {
  const program = makeProgram([
    seg(1, "javascript", "// comment\nconst a = 1;"),
    seg(2, "javascript", "const b = 2;"),
    seg(3, "go", ""),
    seg(4, "rust", "fn dead() {}", { kind: "block", label: "dead" }),
  ]);
  const result = optimize(program, { stripComments: true });
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].language, "javascript");
  assert.equal(result.segments[0].source, "const a = 1;\nconst b = 2;");
});

test("optimize without stripComments preserves comments", () => {
  const program = makeProgram([
    seg(1, "javascript", "// keep this\nconst a = 1;"),
  ]);
  const result = optimize(program);
  assert.match(result.segments[0].source, /\/\/ keep this/);
});

// --- codegen: generateFFIStubs ---

test("generateFFIStubs creates rust-js stubs", () => {
  const stubs = generateFFIStubs(["rust", "javascript"]);
  assert.ok("ffi_rust_js.rs" in stubs);
  assert.match(stubs["ffi_rust_js.rs"], /wasm_bindgen/);
});

test("generateFFIStubs creates go-rust stubs", () => {
  const stubs = generateFFIStubs(["go", "rust"]);
  assert.ok("ffi_go_rust.go" in stubs);
  assert.match(stubs["ffi_go_rust.go"], /cgo/);
});

test("generateFFIStubs creates zig-rust stubs", () => {
  const stubs = generateFFIStubs(["zig", "rust"]);
  assert.ok("ffi_zig_rust.zig" in stubs);
  assert.match(stubs["ffi_zig_rust.zig"], /cImport/);
});

test("generateFFIStubs returns empty for single lane", () => {
  const stubs = generateFFIStubs(["javascript"]);
  assert.deepEqual(stubs, {});
});

// --- codegen: generateMakefile ---

test("generateMakefile includes targets for present lanes", () => {
  const makefile = generateMakefile(["javascript", "go", "rust", "zig"], "build");
  assert.match(makefile, /all:/);
  assert.match(makefile, /go build/);
  assert.match(makefile, /rustc/);
  assert.match(makefile, /zig build-exe/);
  assert.match(makefile, /OUT_DIR := build/);
});

test("generateMakefile with single lane", () => {
  const makefile = generateMakefile(["javascript"], "dist");
  assert.match(makefile, /js:/);
  assert.ok(!makefile.includes("rustc"));
});

// --- codegen: generateInteropTypes ---

test("generateInteropTypes creates .d.ts for JS lane", () => {
  const program = makeProgram([
    seg(1, "javascript", "function hello() {}", { kind: "block", label: "hello" }),
    seg(2, "javascript", "function world() {}", { kind: "block", label: "world" }),
  ]);
  const types = generateInteropTypes(program);
  assert.ok("jizzrug.d.ts" in types);
  assert.match(types["jizzrug.d.ts"], /export function hello/);
  assert.match(types["jizzrug.d.ts"], /export function world/);
});

test("generateInteropTypes creates header for Rust lane", () => {
  const program = makeProgram([
    seg(1, "rust", "fn greet() {}", { kind: "block", label: "greet" }),
  ]);
  const types = generateInteropTypes(program);
  assert.ok("jizzrug_rust_ffi.h" in types);
  assert.match(types["jizzrug_rust_ffi.h"], /void greet/);
});

test("generateInteropTypes returns empty for lanes without labels", () => {
  const program = makeProgram([
    seg(1, "go", 'fmt.Println("hi")'),
  ]);
  const types = generateInteropTypes(program);
  assert.ok(!("jizzrug.d.ts" in types));
});

// --- immutability ---

test("optimizer passes do not mutate the original program", () => {
  const original = makeProgram([
    seg(1, "javascript", "const a = 1;"),
    seg(2, "javascript", "const b = 2;"),
    seg(3, "go", ""),
  ]);
  const origLength = original.segments.length;
  const origSource = original.segments[0].source;
  optimize(original, { stripComments: true });
  assert.equal(original.segments.length, origLength);
  assert.equal(original.segments[0].source, origSource);
});
