import test from "node:test";
import assert from "node:assert/strict";
import { parseProgram, ParseError } from "../bootstrap/parser.js";

const MODEL = {
  LANGUAGE_ALIASES: {
    js: "javascript", javascript: "javascript", node: "javascript",
    go: "go", golang: "go",
    rust: "rust", rs: "rust",
    zig: "zig",
  },
};

test("parses line segments", () => {
  const r = parseProgram('js: console.log("hi");', MODEL);
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].language, "javascript");
  assert.equal(r.segments[0].kind, "line");
  assert.equal(r.segments[0].source, 'console.log("hi");');
  assert.equal(r.segments[0].lineStart, 1);
  assert.ok(r.segments[0].columnStart > 0);
});

test("parses fenced block segments", () => {
  const src = "```rust greet\nfn greet() {}\n```";
  const r = parseProgram(src, MODEL);
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].language, "rust");
  assert.equal(r.segments[0].kind, "block");
  assert.equal(r.segments[0].label, "greet");
  assert.equal(r.segments[0].source, "fn greet() {}");
  assert.equal(r.segments[0].lineStart, 1);
});

test("skips blank lines and comments", () => {
  const src = "# comment\n\njs: x\n\n# another\ngo: y";
  const r = parseProgram(src, MODEL);
  assert.equal(r.segments.length, 2);
});

test("@import directive", () => {
  const src = '@import "stdlib/io.jizz"\njs: x';
  const r = parseProgram(src, MODEL);
  assert.equal(r.imports.length, 1);
  assert.equal(r.imports[0].path, "stdlib/io.jizz");
  assert.equal(r.imports[0].line, 1);
  assert.equal(r.imports[0].column, 1);
  assert.equal(r.segments.length, 1);
});

test("@import malformed throws", () => {
  assert.throws(() => parseProgram("@import badpath", MODEL), /Malformed @import/);
});

test("@meta directive", () => {
  const src = "@meta author andy\n@meta version 1.0\njs: x";
  const r = parseProgram(src, MODEL);
  assert.equal(r.meta.author, "andy");
  assert.equal(r.meta.version, "1.0");
});

test("@meta malformed throws", () => {
  assert.throws(() => parseProgram("@meta", MODEL), /Malformed @meta/);
});

test("@ref directive", () => {
  const src = "@ref greet\n@ref utils\njs: x";
  const r = parseProgram(src, MODEL);
  assert.deepEqual(r.refs, ["greet", "utils"]);
});

test("@ref malformed throws", () => {
  assert.throws(() => parseProgram("@ref", MODEL), /Malformed @ref/);
});

test("multi-lane inline syntax", () => {
  const src = "js,go: shared()";
  const r = parseProgram(src, MODEL);
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].language, "javascript");
  assert.equal(r.segments[1].language, "go");
  assert.equal(r.segments[0].source, "shared()");
  assert.equal(r.segments[1].source, "shared()");
});

test("multi-lane fenced block syntax", () => {
  const src = "```js,rust shared\ncode here\n```";
  const r = parseProgram(src, MODEL);
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].language, "javascript");
  assert.equal(r.segments[1].language, "rust");
  assert.equal(r.segments[0].label, "shared");
  assert.equal(r.segments[1].label, "shared");
});

test("column tracking on line segments", () => {
  const src = "js: code";
  const r = parseProgram(src, MODEL);
  assert.equal(r.segments[0].columnStart, 5);
});

test("column tracking on block segments", () => {
  const src = "```go main\nfmt.Println()\n```";
  const r = parseProgram(src, MODEL);
  assert.equal(r.segments[0].columnStart, 1);
});

test("error recovery collects multiple errors", () => {
  const src = "badlane: x\nanotherbad: y\njs: ok";
  const r = parseProgram(src, MODEL, ParseError, { recover: true });
  assert.equal(r.errors.length, 2);
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].language, "javascript");
});

test("error recovery on unterminated block", () => {
  const src = "```rust foo\ncode";
  const r = parseProgram(src, MODEL, ParseError, { recover: true });
  assert.ok(r.errors.length >= 1);
  assert.match(r.errors[0].message, /Unterminated/);
});

test("error recovery on malformed directives", () => {
  const src = "@import bad\n@meta\n@ref\njs: ok";
  const r = parseProgram(src, MODEL, ParseError, { recover: true });
  assert.equal(r.errors.length, 3);
  assert.equal(r.segments.length, 1);
});

test("unsupported lane throws without recovery", () => {
  assert.throws(() => parseProgram("python: x", MODEL), /Unsupported lane/);
});

test("unterminated block throws without recovery", () => {
  assert.throws(() => parseProgram("```js foo\ncode", MODEL), /Unterminated/);
});

test("unparseable line throws without recovery", () => {
  assert.throws(() => parseProgram("just some text without colon", MODEL), /Could not parse/);
});

test("ParseError has loc property", () => {
  try {
    parseProgram("badlane: x", MODEL);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e.loc);
    assert.equal(e.loc.line, 1);
    assert.equal(e.loc.column, 1);
  }
});

test("lane aliases work", () => {
  const src = "rs: let x = 1;\ngolang: var y = 2\nnode: const z = 3";
  const r = parseProgram(src, MODEL);
  assert.equal(r.segments[0].language, "rust");
  assert.equal(r.segments[1].language, "go");
  assert.equal(r.segments[2].language, "javascript");
});

test("segments get sequential ids", () => {
  const src = "js: a\ngo: b\nrust: c";
  const r = parseProgram(src, MODEL);
  assert.deepEqual(r.segments.map(s => s.id), [1, 2, 3]);
});

test("block label is null when omitted", () => {
  const src = "```js\ncode\n```";
  const r = parseProgram(src, MODEL);
  assert.equal(r.segments[0].label, null);
});

test("empty source returns empty result", () => {
  const r = parseProgram("", MODEL);
  assert.equal(r.segments.length, 0);
  assert.equal(r.imports.length, 0);
  assert.deepEqual(r.meta, {});
  assert.equal(r.refs.length, 0);
});

test("comments-only source returns empty segments", () => {
  const r = parseProgram("# just a comment\n# another one\n", MODEL);
  assert.equal(r.segments.length, 0);
});

test("multiple imports are collected in order", () => {
  const src = '@import "a.jizz"\n@import "b.jizz"\njs: x';
  const r = parseProgram(src, MODEL);
  assert.equal(r.imports.length, 2);
  assert.equal(r.imports[0].path, "a.jizz");
  assert.equal(r.imports[1].path, "b.jizz");
});

test("refs are deduplicated", () => {
  const src = "@ref foo\n@ref foo\njs: x";
  const r = parseProgram(src, MODEL);
  assert.deepEqual(r.refs, ["foo"]);
});

test("block trailing whitespace is stripped from source", () => {
  const src = "```js main\ncode  \n  \n```";
  const r = parseProgram(src, MODEL);
  assert.equal(r.segments[0].source, "code");
});

test("mixed directives and segments", () => {
  const src = [
    '@import "lib.jizz"',
    "@meta name test",
    "# comment",
    "@ref helper",
    'js: console.log("hi");',
    "```go main",
    "package main",
    "```",
  ].join("\n");
  const r = parseProgram(src, MODEL);
  assert.equal(r.imports.length, 1);
  assert.equal(r.meta.name, "test");
  assert.deepEqual(r.refs, ["helper"]);
  assert.equal(r.segments.length, 2);
});
