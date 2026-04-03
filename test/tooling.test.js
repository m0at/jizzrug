import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

import { contentHash, isCached, writeCache, invalidateCache } from "../bootstrap/cache.js";
import { formatSource, sortImports } from "../bootstrap/fmt.js";
import { main } from "../bootstrap/runtime.js";

// --- cache tests ---

test("contentHash returns consistent sha256 hex", () => {
  const h1 = contentHash("hello world");
  const h2 = contentHash("hello world");
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
});

test("contentHash differs for different inputs", () => {
  assert.notEqual(contentHash("a"), contentHash("b"));
});

test("isCached returns false for uncached file", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jizzrug-cache-"));
  const srcFile = path.join(tmpDir, "test.jizz");
  await fs.writeFile(srcFile, "js: 1+1", "utf8");
  assert.equal(isCached(srcFile, tmpDir), false);
});

test("writeCache then isCached returns true", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jizzrug-cache-"));
  const srcFile = path.join(tmpDir, "test.jizz");
  await fs.writeFile(srcFile, "js: 1+1", "utf8");
  writeCache(srcFile, tmpDir);
  assert.equal(isCached(srcFile, tmpDir), true);
});

test("isCached returns false after source change", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jizzrug-cache-"));
  const srcFile = path.join(tmpDir, "test.jizz");
  await fs.writeFile(srcFile, "js: 1+1", "utf8");
  writeCache(srcFile, tmpDir);
  await fs.writeFile(srcFile, "js: 2+2", "utf8");
  assert.equal(isCached(srcFile, tmpDir), false);
});

test("invalidateCache clears the cache entry", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jizzrug-cache-"));
  const srcFile = path.join(tmpDir, "test.jizz");
  await fs.writeFile(srcFile, "js: 1+1", "utf8");
  writeCache(srcFile, tmpDir);
  invalidateCache(srcFile, tmpDir);
  assert.equal(isCached(srcFile, tmpDir), false);
});

// --- formatter tests ---

test("formatSource normalizes lane prefix spacing", () => {
  const input = "JS :   console.log(1)\ngo:fmt.Println(2)\n";
  const out = formatSource(input);
  assert.match(out, /^js: console\.log\(1\)\n/);
  assert.match(out, /go: fmt\.Println\(2\)/);
});

test("formatSource collapses multiple blank lines", () => {
  const input = "js: a\n\n\n\njs: b\n";
  const out = formatSource(input);
  assert.equal(out, "js: a\n\njs: b\n");
});

test("formatSource trims trailing whitespace", () => {
  const input = "js: foo   \ngo: bar   \n";
  const out = formatSource(input);
  assert.ok(!out.match(/  \n/));
});

test("formatSource ensures single trailing newline", () => {
  const input = "js: a\n\n\n";
  const out = formatSource(input);
  assert.ok(out.endsWith("js: a\n"));
});

test("formatSource preserves fenced blocks", () => {
  const input = "```js test\nconsole.log(1)\n```\n";
  const out = formatSource(input);
  assert.match(out, /```js test/);
  assert.match(out, /console\.log\(1\)/);
});

test("sortImports sorts consecutive @import lines", () => {
  const input = '@import "b.jizz"\n@import "a.jizz"\njs: code\n';
  const out = sortImports(input);
  const lines = out.split("\n");
  assert.equal(lines[0], '@import "a.jizz"');
  assert.equal(lines[1], '@import "b.jizz"');
});

// --- CLI routing tests ---

test("rizz check validates a source file", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jizzrug-check-"));
  const srcFile = path.join(tmpDir, "test.jizz");
  await fs.writeFile(srcFile, 'js: console.log("hi")\n', "utf8");
  const lines = [];
  const orig = console.log;
  console.log = (v) => lines.push(String(v));
  try {
    const code = await main(["check", srcFile]);
    assert.equal(code, 0);
    assert.match(lines.join("\n"), /no errors|OK/);
  } finally {
    console.log = orig;
  }
});

test("rizz check --verbose shows segment details", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jizzrug-check-"));
  const srcFile = path.join(tmpDir, "test.jizz");
  await fs.writeFile(srcFile, 'js: console.log("hi")\ngo: fmt.Println("hi")\n', "utf8");
  const lines = [];
  const orig = console.log;
  console.log = (v) => lines.push(String(v));
  try {
    await main(["check", srcFile, "--verbose"]);
    const output = lines.join("\n");
    assert.match(output, /Parsed 2 segments/);
    assert.match(output, /javascript/);
  } finally {
    console.log = orig;
  }
});

test("rizz fmt --dry-run does not modify files", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jizzrug-fmt-"));
  const srcFile = path.join(tmpDir, "test.jizz");
  const original = "JS :  code\n";
  await fs.writeFile(srcFile, original, "utf8");
  const lines = [];
  const orig = console.log;
  console.log = (v) => lines.push(String(v));
  try {
    await main(["fmt", srcFile, "--dry-run"]);
    const content = await fs.readFile(srcFile, "utf8");
    assert.equal(content, original);
    assert.match(lines.join("\n"), /would be reformatted/);
  } finally {
    console.log = orig;
  }
});

test("rizz fmt reformats a file in place", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jizzrug-fmt-"));
  const srcFile = path.join(tmpDir, "test.jizz");
  await fs.writeFile(srcFile, "JS :  code\n", "utf8");
  await main(["fmt", srcFile]);
  const content = await fs.readFile(srcFile, "utf8");
  assert.equal(content, "js: code\n");
});

test("rizz help includes new commands", async () => {
  const lines = [];
  const orig = console.log;
  console.log = (v) => lines.push(String(v));
  try {
    await main(["help"]);
    const output = lines.join("\n");
    assert.match(output, /watch/);
    assert.match(output, /repl/);
    assert.match(output, /check/);
    assert.match(output, /fmt/);
    assert.match(output, /--verbose/);
    assert.match(output, /--dry-run/);
  } finally {
    console.log = orig;
  }
});
