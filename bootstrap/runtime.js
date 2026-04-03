import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { typecheck } from "./typechecker.js";
import { ParseError, parseProgram as parserParseProgram } from "./parser.js";
import { watchDir } from "./watcher.js";
import { startRepl } from "./repl.js";
import { formatSource } from "./fmt.js";

let runtimeSpecPromise = null;
let runtimeSpecSync = null;

export { ParseError };

function toPlainData(value) {
  return JSON.parse(JSON.stringify(value));
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function transformJavascriptModule(source) {
  return source
    .replace(/export\s+const\s+([A-Za-z0-9_]+)\s*=/g, "exports.$1 =")
    .replace(/export\s+function\s+([A-Za-z0-9_]+)\s*\(/g, "exports.$1 = function $1(")
    .replace(/export\s+default\s+/g, "exports.default = ");
}

function evaluateJavascriptSegments(segments, filename) {
  const javascript = segments
    .filter((segment) => segment.language === "javascript")
    .map((segment) => segment.source)
    .join("\n\n");
  const exports = {};
  const context = vm.createContext({ exports });
  const script = new vm.Script(transformJavascriptModule(javascript), { filename });
  script.runInContext(context);
  return exports;
}

async function loadJizzModule(relativePath, treeRoot = repoRoot()) {
  const absolutePath = path.join(treeRoot, relativePath);
  const source = await fs.readFile(absolutePath, "utf8");
  const program = bootstrapParseProgram(source);
  return evaluateJavascriptSegments(program.segments, absolutePath);
}

function loadJizzModuleSync(relativePath, treeRoot = repoRoot()) {
  const absolutePath = path.join(treeRoot, relativePath);
  const source = fsSync.readFileSync(absolutePath, "utf8");
  const program = bootstrapParseProgram(source);
  return evaluateJavascriptSegments(program.segments, absolutePath);
}

async function loadRuntimeSpec(treeRoot = repoRoot()) {
  if (runtimeSpecPromise) {
    return runtimeSpecPromise;
  }

  runtimeSpecPromise = Promise.all([
    loadJizzModule("jizzrug/source_model.jizz", treeRoot),
    loadJizzModule("jizzrug/parser.jizz", treeRoot),
    loadJizzModule("jizzrug/manifest.jizz", treeRoot),
    loadJizzModule("jizzrug/transpiler.jizz", treeRoot),
    loadJizzModule("rizz/cli.jizz", treeRoot),
    loadJizzModule("rizz/bootstrap.jizz", treeRoot),
    loadJizzModule("squirt/flush.jizz", treeRoot),
    loadJizzModule("squirt/stream.jizz", treeRoot),
  ]).then(([sourceModel, parser, manifest, transpiler, cli, bootstrap, squirtFlush, squirtStream]) => ({
    sourceModel,
    parser,
    manifest,
    transpiler,
    cli,
    bootstrap,
    squirtFlush,
    squirtStream,
  }));

  return runtimeSpecPromise;
}

function loadRuntimeSpecSync(treeRoot = repoRoot()) {
  if (runtimeSpecSync) {
    return runtimeSpecSync;
  }

  const [sourceModel, parser, manifest, transpiler, cli, bootstrap, squirtFlush, squirtStream] = [
    loadJizzModuleSync("jizzrug/source_model.jizz", treeRoot),
    loadJizzModuleSync("jizzrug/parser.jizz", treeRoot),
    loadJizzModuleSync("jizzrug/manifest.jizz", treeRoot),
    loadJizzModuleSync("jizzrug/transpiler.jizz", treeRoot),
    loadJizzModuleSync("rizz/cli.jizz", treeRoot),
    loadJizzModuleSync("rizz/bootstrap.jizz", treeRoot),
    loadJizzModuleSync("squirt/flush.jizz", treeRoot),
    loadJizzModuleSync("squirt/stream.jizz", treeRoot),
  ];
  runtimeSpecSync = {
    sourceModel,
    parser,
    manifest,
    transpiler,
    cli,
    bootstrap,
    squirtFlush,
    squirtStream,
  };
  return runtimeSpecSync;
}

function canonicalLaneFromSpec(rawLane, sourceModel) {
  const canonical = sourceModel.LANGUAGE_ALIASES?.[rawLane.trim().toLowerCase()];
  if (!canonical) {
    throw new ParseError(`Unsupported lane '${rawLane}'.`);
  }
  return canonical;
}

export async function parseProgramWithSpec(source, treeRoot = repoRoot()) {
  const spec = await loadRuntimeSpec(treeRoot);
  return toPlainData(spec.parser.parseProgram(source, spec.sourceModel, ParseError));
}

function bootstrapParseProgram(source, sourceModel = { LANGUAGE_ALIASES: {
  js: "javascript", javascript: "javascript", node: "javascript", go: "go", golang: "go", rust: "rust", rs: "rust", zig: "zig",
} }) {
  return parserParseProgram(source, sourceModel, ParseError);
}

export function parseProgram(source) {
  const spec = loadRuntimeSpecSync();
  if (typeof spec.parser.parseProgram === "function") {
    return toPlainData(spec.parser.parseProgram(source, spec.sourceModel, ParseError));
  }
  return bootstrapParseProgram(source, spec.sourceModel);
}

export async function compileSource(sourcePath, outDir, treeRoot = repoRoot()) {
  const spec = await loadRuntimeSpec(treeRoot);
  const source = await fs.readFile(sourcePath, "utf8");
  const program = toPlainData(spec.parser.parseProgram(source, spec.sourceModel, ParseError));
  await fs.mkdir(outDir, { recursive: true });

  const grouped = new Map();
  const manifest = {
    language: "jizzrug",
    version: spec.manifest.MANIFEST_VERSION,
    source: path.basename(sourcePath),
    outputs: [],
    segments: [],
  };

  for (const segment of program.segments) {
    const laneSegments = grouped.get(segment.language) ?? [];
    laneSegments.push(segment);
    grouped.set(segment.language, laneSegments);
    manifest.segments.push({
      id: segment.id,
      language: segment.language,
      kind: segment.kind,
      label: segment.label,
      lineStart: segment.lineStart,
    });
  }

  for (const language of [...grouped.keys()].sort()) {
    const outputName = spec.transpiler.outputNameForLane(language, spec.transpiler);
    const outputPath = path.join(outDir, outputName);
    await fs.writeFile(outputPath, spec.transpiler.renderLane(language, grouped.get(language), spec.transpiler), "utf8");
    manifest.outputs.push({ language, path: outputName });
  }

  await fs.writeFile(
    path.join(outDir, spec.manifest.MANIFEST_FILE_NAME ?? spec.squirtFlush.DEFAULT_PLAN_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

async function listSourceFiles(rootDir, acceptedExtensions) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(entryPath, acceptedExtensions)));
      continue;
    }
    if (acceptedExtensions.some((ext) => entry.name.endsWith(ext))) {
      files.push(entryPath);
    }
  }

  return files;
}

export async function bootstrapTree(outDir, treeRoot = repoRoot()) {
  const spec = await loadRuntimeSpec(treeRoot);
  const sourceRoots = spec.bootstrap.SOURCE_ROOTS;
  const units = [];

  await fs.mkdir(outDir, { recursive: true });

  for (const sourceRoot of sourceRoots) {
    const absoluteRoot = path.join(treeRoot, sourceRoot);
    const files = await listSourceFiles(absoluteRoot, spec.sourceModel.ACCEPTED_EXTENSIONS);
    files.sort();
    for (const file of files) {
      const relativeSource = path.relative(treeRoot, file);
      const unitDir = path.join(
        outDir,
        relativeSource.replace(/\.(jizz|jizzrug|jr)$/, "").replaceAll(path.sep, "__"),
      );
      const manifest = await compileSource(file, unitDir, treeRoot);
      units.push({
        source: relativeSource,
        outDir: path.relative(outDir, unitDir) || ".",
        outputs: manifest.outputs,
      });
    }
  }

  const bootstrapManifest = {
    language: "jizzrug",
    mode: "bootstrap",
    units,
  };
  await fs.writeFile(
    path.join(outDir, "bootstrap-plan.json"),
    `${JSON.stringify(bootstrapManifest, null, 2)}\n`,
    "utf8",
  );
  return bootstrapManifest;
}

async function printHelp(treeRoot = repoRoot()) {
  const spec = await loadRuntimeSpec(treeRoot);
  console.log(spec.cli.helpText());
}

function parseFlags(args) {
  let outDir = null;
  let json = false;
  let check = false;
  let verbose = false;
  let dryRun = false;
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--out") {
      outDir = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    positional.push(arg);
  }

  return { outDir, json, check, verbose, dryRun, positional };
}

async function runCum(args) {
  const spec = await loadRuntimeSpec();
  const { outDir, json, check, positional } = parseFlags(args);
  const source = positional[0];
  if (!source) {
    throw new Error("cum requires a source path.");
  }
  if (!spec.sourceModel.ACCEPTED_EXTENSIONS.some((ext) => source.endsWith(ext))) {
    throw new Error("source must end in .jizz, .jizzrug, or .jr");
  }
  if (check) {
    const sourceText = await fs.readFile(source, "utf8");
    const program = toPlainData(spec.parser.parseProgram(sourceText, spec.sourceModel, ParseError));
    const result = typecheck(program);
    if (!result.valid) {
      for (const err of result.errors) {
        const loc = err.line ? `:${err.line}` : "";
        console.error(`${source}${loc}: ${err.message}`);
      }
      throw new Error("Typecheck failed.");
    }
  }
  const manifest = await compileSource(source, outDir ?? spec.cli.COMMANDS.cum.defaultOutDir);
  if (json) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    const outputs = manifest.outputs.map((item) => item.path).join(", ");
    console.log(`Compiled ${source} into ${outDir ?? spec.cli.COMMANDS.cum.defaultOutDir}: ${outputs}`);
  }
}

async function runBootstrap(args) {
  const spec = await loadRuntimeSpec();
  const { outDir, json } = parseFlags(args);
  const manifest = await bootstrapTree(outDir ?? spec.bootstrap.DEFAULT_BOOTSTRAP_OUT_DIR);
  if (json) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    console.log(`Bootstrapped ${manifest.units.length} jizzrug source units into ${outDir ?? spec.bootstrap.DEFAULT_BOOTSTRAP_OUT_DIR}`);
  }
}

async function runWatch(args) {
  const spec = await loadRuntimeSpec();
  const { outDir, verbose } = parseFlags(args);
  const out = outDir ?? spec.cli.COMMANDS.watch.defaultOutDir;
  const roots = spec.bootstrap.SOURCE_ROOTS.map((r) => path.join(repoRoot(), r));
  console.log(`Watching ${roots.join(", ")} for changes...`);
  watchDir(roots, spec.sourceModel.ACCEPTED_EXTENSIONS, async (_event, filePath) => {
    if (verbose) console.log(`Change detected: ${filePath}`);
    try {
      const unitDir = path.join(out, path.basename(filePath, path.extname(filePath)));
      await compileSource(filePath, unitDir);
      console.log(`Recompiled ${filePath}`);
    } catch (err) {
      console.error(`Error compiling ${filePath}: ${err.message}`);
    }
  });
  await new Promise(() => {});
}

async function runRepl() {
  startRepl(parseProgram);
  await new Promise(() => {});
}

async function runCheck(args) {
  const spec = await loadRuntimeSpec();
  const { json, positional, verbose } = parseFlags(args);
  const source = positional[0];
  if (!source) throw new Error("check requires a source path.");
  const content = await fs.readFile(source, "utf8");
  const program = toPlainData(spec.parser.parseProgram(content, spec.sourceModel, ParseError));
  if (verbose) {
    console.log(`Parsed ${program.segments.length} segments from ${source}`);
    for (const seg of program.segments) {
      console.log(`  [${seg.id}] ${seg.language} ${seg.kind}${seg.label ? ` (${seg.label})` : ""} line ${seg.lineStart}`);
    }
  }
  const result = typecheck(program);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.valid) {
    console.log(`${source}: no errors (${result.labels.length} labels, ${result.refs.length} refs)`);
  } else {
    for (const err of result.errors) {
      const loc = err.line ? `:${err.line}` : "";
      console.error(`${source}${loc}: ${err.message}`);
    }
    process.exitCode = 1;
  }
}

async function runFmt(args) {
  const { positional, dryRun, verbose } = parseFlags(args);
  const source = positional[0];
  if (!source) throw new Error("fmt requires a source path.");
  const content = await fs.readFile(source, "utf8");
  const formatted = formatSource(content);
  if (dryRun) {
    if (content !== formatted) {
      console.log(`${source}: would be reformatted`);
    } else {
      console.log(`${source}: already formatted`);
    }
    return;
  }
  if (content !== formatted) {
    await fs.writeFile(source, formatted, "utf8");
    if (verbose) console.log(`Formatted ${source}`);
  } else if (verbose) {
    console.log(`${source}: already formatted`);
  }
}

export async function main(argv) {
  const [command, ...args] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    await printHelp();
    return 0;
  }

  if (command === "cum") {
    await runCum(args);
    return 0;
  }

  if (command === "bootstrap") {
    await runBootstrap(args);
    return 0;
  }

  if (command === "watch") {
    await runWatch(args);
    return 0;
  }

  if (command === "repl") {
    await runRepl();
    return 0;
  }

  if (command === "check") {
    await runCheck(args);
    return 0;
  }

  if (command === "fmt") {
    await runFmt(args);
    return 0;
  }

  throw new Error(`Unknown command: ${command}`);
}
