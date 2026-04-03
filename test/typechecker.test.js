import test from "node:test";
import assert from "node:assert/strict";
import { typecheck } from "../bootstrap/typechecker.js";

function makeProgram(segments) {
  return { segments };
}

function seg(id, language, kind, source, label, lineStart) {
  return { id, language, kind, label: label ?? null, lineStart: lineStart ?? id, source };
}

test("typecheck passes for valid program", () => {
  const result = typecheck(makeProgram([
    seg(1, "javascript", "line", 'console.log("hi");'),
    seg(2, "go", "block", 'fmt.Println("hi")', "main", 3),
    seg(3, "rust", "block", "fn greet() {}", "greet", 8),
  ]));
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.labels, ["main", "greet"]);
});

test("typecheck detects invalid lane", () => {
  const result = typecheck(makeProgram([
    seg(1, "python", "line", "print('hi')"),
  ]));
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /Invalid lane 'python'/);
});

test("typecheck detects duplicate labels", () => {
  const result = typecheck(makeProgram([
    seg(1, "javascript", "block", "code1", "shared", 1),
    seg(2, "go", "block", "code2", "shared", 5),
  ]));
  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /Duplicate label 'shared'/);
});

test("typecheck detects missing @ref target", () => {
  const result = typecheck(makeProgram([
    seg(1, "javascript", "block", "use @ref missing_label here"),
  ]));
  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /nonexistent label/);
  assert.deepEqual(result.refs, ["missing_label"]);
});

test("typecheck accepts valid @ref", () => {
  const result = typecheck(makeProgram([
    seg(1, "javascript", "block", "fn foo() {}", "foo", 1),
    seg(2, "go", "block", "uses @ref foo here", null, 5),
  ]));
  assert.equal(result.valid, true);
  assert.deepEqual(result.refs, ["foo"]);
});

test("typecheck detects unreachable segment after return", () => {
  const result = typecheck(makeProgram([
    seg(1, "javascript", "block", "function f() {\nreturn", null, 1),
    seg(2, "javascript", "block", "console.log('dead')", null, 4),
  ]));
  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /unreachable/);
});

test("typecheck does not flag unreachable across different lanes", () => {
  const result = typecheck(makeProgram([
    seg(1, "javascript", "block", "return", null, 1),
    seg(2, "go", "block", 'fmt.Println("ok")', null, 3),
  ]));
  assert.equal(result.valid, true);
});

test("typecheck parses @type declarations", () => {
  const result = typecheck(makeProgram([
    seg(1, "javascript", "block", "@type greet: string -> string", "greet", 1),
  ]));
  assert.equal(result.valid, true);
  assert.deepEqual(result.typeContracts, {
    greet: { params: ["string"], ret: "string" },
  });
});

test("typecheck detects duplicate @type contracts", () => {
  const result = typecheck(makeProgram([
    seg(1, "javascript", "block", "@type foo: int -> int", null, 1),
    seg(2, "go", "block", "@type foo: string -> string", null, 3),
  ]));
  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /Duplicate type contract 'foo'/);
});

test("typecheck handles empty program", () => {
  const result = typecheck(makeProgram([]));
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("typecheck handles multiple @ref in one segment", () => {
  const result = typecheck(makeProgram([
    seg(1, "javascript", "block", "code", "alpha", 1),
    seg(2, "go", "block", "code", "beta", 3),
    seg(3, "rust", "block", "uses @ref alpha and @ref beta", null, 5),
  ]));
  assert.equal(result.valid, true);
  assert.deepEqual(result.refs, ["alpha", "beta"]);
});

test("typecheck multi-param type signature", () => {
  const result = typecheck(makeProgram([
    seg(1, "javascript", "block", "@type add: int -> int -> int", null, 1),
  ]));
  assert.deepEqual(result.typeContracts, {
    add: { params: ["int", "int"], ret: "int" },
  });
});
