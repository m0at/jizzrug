import path from "node:path";
import fsSync from "node:fs";

export class CircularImportError extends Error {
  constructor(cycle) {
    super(`Circular import detected: ${cycle.join(" -> ")}`);
    this.cycle = cycle;
  }
}

export class ModuleNotFoundError extends Error {
  constructor(specifier, from) {
    super(`Module not found: '${specifier}' (imported from '${from}')`);
    this.specifier = specifier;
    this.from = from;
  }
}

const IMPORT_RE = /^@import\s+"([^"]+)"\s*$/;

export function extractImports(source) {
  const imports = [];
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    const m = trimmed.match(IMPORT_RE);
    if (m) {
      imports.push(m[1]);
    }
  }
  return imports;
}

export function resolveModulePath(specifier, fromFile, rootDir) {
  if (specifier.startsWith("stdlib/")) {
    const resolved = path.join(rootDir, specifier);
    if (fsSync.existsSync(resolved)) return resolved;
    const withExt = resolved.endsWith(".jizz") ? resolved : resolved + ".jizz";
    if (fsSync.existsSync(withExt)) return withExt;
    throw new ModuleNotFoundError(specifier, fromFile);
  }

  const dir = path.dirname(fromFile);
  const resolved = path.resolve(dir, specifier);
  if (fsSync.existsSync(resolved)) return resolved;
  const withExt = resolved.endsWith(".jizz") ? resolved : resolved + ".jizz";
  if (fsSync.existsSync(withExt)) return withExt;
  throw new ModuleNotFoundError(specifier, fromFile);
}

export function buildDependencyGraph(entryFile, rootDir) {
  const graph = new Map();

  function visit(filePath, chain) {
    const canonical = path.resolve(filePath);

    if (chain.includes(canonical)) {
      throw new CircularImportError([...chain, canonical].map(p => path.relative(rootDir, p)));
    }

    if (graph.has(canonical)) return;

    const source = fsSync.readFileSync(canonical, "utf8");
    const imports = extractImports(source);
    const resolvedDeps = [];

    for (const spec of imports) {
      const dep = resolveModulePath(spec, canonical, rootDir);
      resolvedDeps.push(dep);
      visit(dep, [...chain, canonical]);
    }

    graph.set(canonical, { file: canonical, imports: resolvedDeps, source });
  }

  visit(entryFile, []);
  return graph;
}

export function topologicalOrder(graph) {
  const visited = new Set();
  const order = [];

  function dfs(node) {
    if (visited.has(node)) return;
    visited.add(node);
    const entry = graph.get(node);
    if (entry) {
      for (const dep of entry.imports) {
        dfs(dep);
      }
    }
    order.push(node);
  }

  for (const key of graph.keys()) {
    dfs(key);
  }
  return order;
}
