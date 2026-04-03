export class ParseError extends Error {
  constructor(message, loc) {
    super(message);
    this.loc = loc ?? null;
  }
}

const DEFAULT_ALIASES = {
  js: "javascript", javascript: "javascript", node: "javascript",
  go: "go", golang: "go",
  rust: "rust", rs: "rust",
  zig: "zig",
};

function canonicalLane(rawLane, aliases, errors, loc) {
  const canonical = aliases[rawLane.trim().toLowerCase()];
  if (!canonical) {
    const err = new ParseError(`Unsupported lane '${rawLane}'.`, loc);
    if (errors) { errors.push(err); return null; }
    throw err;
  }
  return canonical;
}

export function parseProgram(source, sourceModel, ErrorCtor, opts = {}) {
  const aliases = sourceModel?.LANGUAGE_ALIASES ?? DEFAULT_ALIASES;
  const recover = opts.recover ?? false;
  const lines = source.split(/\r?\n/);
  const segments = [];
  const imports = [];
  const meta = {};
  const refs = new Set();
  const errors = recover ? [] : null;
  let index = 0;
  let nextId = 1;
  const Err = ErrorCtor ?? ParseError;

  function makeLoc(line, col) {
    return { line, column: col };
  }

  function pushError(msg, line, col) {
    const err = new (Err)(msg, makeLoc(line, col));
    if (errors) { errors.push(err); return; }
    throw err;
  }

  while (index < lines.length) {
    const rawLine = lines[index];
    const stripped = rawLine.trim();
    const lineNum = index + 1;

    if (!stripped || stripped.startsWith("#")) {
      index += 1;
      continue;
    }

    if (stripped.startsWith("@import ")) {
      const pathMatch = stripped.match(/^@import\s+"([^"]+)"\s*$/);
      if (!pathMatch) {
        pushError(`Malformed @import on line ${lineNum}.`, lineNum, 1);
        index += 1;
        continue;
      }
      imports.push({ path: pathMatch[1], line: lineNum, column: 1 });
      index += 1;
      continue;
    }

    if (stripped === "@meta" || stripped.startsWith("@meta ")) {
      const metaMatch = stripped.match(/^@meta\s+(\S+)\s+(.+)$/);
      if (!metaMatch) {
        pushError(`Malformed @meta on line ${lineNum}.`, lineNum, 1);
        index += 1;
        continue;
      }
      meta[metaMatch[1]] = metaMatch[2];
      index += 1;
      continue;
    }

    if (stripped === "@ref" || stripped.startsWith("@ref ")) {
      const refMatch = stripped.match(/^@ref\s+(\S+)\s*$/);
      if (!refMatch) {
        pushError(`Malformed @ref on line ${lineNum}.`, lineNum, 1);
        index += 1;
        continue;
      }
      refs.add(refMatch[1]);
      index += 1;
      continue;
    }

    const fenceMatch = stripped.match(/^```([A-Za-z0-9_+\-,]+)(?:\s+(.*))?$/);
    if (fenceMatch) {
      const rawLanes = fenceMatch[1];
      const label = fenceMatch[2] ? fenceMatch[2].trim() : null;
      const blockStart = index + 1;
      index += 1;
      const blockLines = [];
      while (index < lines.length && lines[index].trim() !== "```") {
        blockLines.push(lines[index]);
        index += 1;
      }
      if (index >= lines.length) {
        pushError(`Unterminated fenced block starting on line ${blockStart}.`, blockStart, 1);
        break;
      }
      const blockSource = blockLines.join("\n").replace(/\s+$/, "");
      const laneNames = rawLanes.split(",");
      for (const rawLane of laneNames) {
        const lane = canonicalLane(rawLane, aliases, errors, makeLoc(lineNum, 1));
        if (!lane) continue;
        segments.push({
          id: nextId,
          language: lane,
          kind: "block",
          label,
          lineStart: blockStart,
          columnStart: 1,
          source: blockSource,
        });
        nextId += 1;
      }
      index += 1;
      continue;
    }

    const colonIndex = rawLine.indexOf(":");
    if (colonIndex !== -1) {
      const lanesPart = rawLine.slice(0, colonIndex);
      const laneNames = lanesPart.split(",");
      const afterColon = rawLine.slice(colonIndex + 1);
      const trimmed = afterColon.trimStart();
      const colStart = colonIndex + 1 + (afterColon.length - trimmed.length) + 1;
      let anyValid = false;
      let anyAttempted = false;
      for (const rawLane of laneNames) {
        anyAttempted = true;
        const lane = canonicalLane(rawLane, aliases, errors, makeLoc(lineNum, 1));
        if (!lane) continue;
        anyValid = true;
        segments.push({
          id: nextId,
          language: lane,
          kind: "line",
          label: null,
          lineStart: lineNum,
          columnStart: colStart,
          source: trimmed,
        });
        nextId += 1;
      }
      if (anyValid || anyAttempted) {
        index += 1;
        continue;
      }
    }

    pushError(`Could not parse line ${lineNum}: '${rawLine}'.`, lineNum, 1);
    index += 1;
  }

  const result = { segments, imports, meta, refs: [...refs] };
  if (errors) result.errors = errors;
  return result;
}
