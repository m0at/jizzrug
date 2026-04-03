// Optimization passes for jizzrug AST programs.
// Each pass is a pure function: takes a program, returns a new program.

export function removeEmptySegments(program) {
  return {
    ...program,
    segments: program.segments.filter(
      (seg) => seg.source && seg.source.trim().length > 0,
    ),
  };
}

export function stripComments(program) {
  const commentPrefix = { javascript: "//", go: "//", rust: "//", zig: "//" };
  return {
    ...program,
    segments: program.segments.map((seg) => {
      const prefix = commentPrefix[seg.language];
      if (!prefix) return seg;
      const lines = seg.source.split("\n").filter(
        (line) => !line.trimStart().startsWith(prefix) || line.includes("!"),
      );
      return { ...seg, source: lines.join("\n") };
    }),
  };
}

export function consolidateLanes(program) {
  const segments = [];
  for (const seg of program.segments) {
    const prev = segments[segments.length - 1];
    if (
      prev &&
      prev.language === seg.language &&
      prev.kind === "line" &&
      seg.kind === "line" &&
      !prev.label &&
      !seg.label
    ) {
      segments[segments.length - 1] = {
        ...prev,
        source: prev.source + "\n" + seg.source,
      };
    } else {
      segments.push({ ...seg });
    }
  }
  return { ...program, segments };
}

function collectReferencedLabels(program) {
  const refs = new Set();
  for (const seg of program.segments) {
    const matches = seg.source.matchAll(/@ref\s+(\S+)/g);
    for (const m of matches) {
      refs.add(m[1]);
    }
  }
  return refs;
}

export function eliminateDeadSegments(program) {
  const refs = collectReferencedLabels(program);
  return {
    ...program,
    segments: program.segments.filter(
      (seg) => !seg.label || refs.has(seg.label),
    ),
  };
}

export function optimize(program, options = {}) {
  let result = program;
  if (options.stripComments) {
    result = stripComments(result);
  }
  result = removeEmptySegments(result);
  result = eliminateDeadSegments(result);
  result = consolidateLanes(result);
  return result;
}
