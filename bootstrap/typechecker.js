// Post-parse validation pass for jizzrug programs.
// Validates cross-lane contracts, references, labels, and lane tags.

const VALID_LANES = ["javascript", "go", "rust", "zig"];
const TYPE_ANNOTATION_RE = /^@type\s+(\w+)\s*:\s*(.+)$/;
const REF_RE = /@ref\s+(\w+)/g;

function parseTypeSignature(sig) {
  const parts = sig.split("->").map(s => s.trim());
  if (parts.length < 2) return { params: [], ret: parts[0] || "void" };
  const ret = parts.pop();
  return { params: parts, ret };
}

class TypecheckError {
  constructor(message, line) {
    this.message = message;
    this.line = line ?? null;
  }
}

export function typecheck(program) {
  const errors = [];
  const segments = program.segments ?? [];

  const labelMap = new Map();
  const refs = [];
  const typeContracts = new Map();

  for (const seg of segments) {
    // Validate lane tags
    if (!VALID_LANES.includes(seg.language)) {
      errors.push(new TypecheckError(
        `Invalid lane '${seg.language}'.`,
        seg.lineStart,
      ));
    }

    // Collect labels, detect duplicates
    if (seg.label) {
      if (labelMap.has(seg.label)) {
        errors.push(new TypecheckError(
          `Duplicate label '${seg.label}' (first at line ${labelMap.get(seg.label).lineStart}).`,
          seg.lineStart,
        ));
      } else {
        labelMap.set(seg.label, seg);
      }
    }

    // Scan source for @ref usage
    if (seg.source) {
      let m;
      const re = new RegExp(REF_RE.source, REF_RE.flags);
      while ((m = re.exec(seg.source)) !== null) {
        refs.push({ name: m[1], line: seg.lineStart, segmentId: seg.id });
      }

      // Scan for @type declarations
      for (const line of seg.source.split("\n")) {
        const tm = line.trim().match(TYPE_ANNOTATION_RE);
        if (tm) {
          const name = tm[1];
          const sig = parseTypeSignature(tm[2]);
          if (typeContracts.has(name)) {
            errors.push(new TypecheckError(
              `Duplicate type contract '${name}'.`,
              seg.lineStart,
            ));
          } else {
            typeContracts.set(name, { ...sig, segment: seg.id });
          }
        }
      }
    }
  }

  // Validate @ref targets exist
  for (const ref of refs) {
    if (!labelMap.has(ref.name)) {
      errors.push(new TypecheckError(
        `Reference '@ref ${ref.name}' targets nonexistent label.`,
        ref.line,
      ));
    }
  }

  // Detect unreachable segments: if two adjacent segments share the same lane
  // and the first contains a terminating statement, the second is unreachable.
  const terminators = /\b(return|process\.exit|os\.Exit|std\.process\.exit|panic!)\b/;
  for (let i = 0; i < segments.length - 1; i++) {
    const curr = segments[i];
    const next = segments[i + 1];
    if (curr.language === next.language && curr.source && terminators.test(curr.source)) {
      const lastLine = curr.source.split("\n").pop().trim();
      if (terminators.test(lastLine)) {
        errors.push(new TypecheckError(
          `Segment ${next.id} may be unreachable after terminating statement in segment ${curr.id}.`,
          next.lineStart,
        ));
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    labels: [...labelMap.keys()],
    refs: refs.map(r => r.name),
    typeContracts: Object.fromEntries(
      [...typeContracts.entries()].map(([k, v]) => [k, { params: v.params, ret: v.ret }]),
    ),
  };
}
