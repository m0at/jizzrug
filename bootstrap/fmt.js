export function formatSource(source) {
  const lines = source.split(/\r?\n/);
  const result = [];
  let prevBlank = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // collapse multiple blank lines into one
    if (!trimmed) {
      if (!prevBlank) result.push("");
      prevBlank = true;
      continue;
    }
    prevBlank = false;

    // normalize lane prefix lines: exactly one space after colon
    const laneMatch = trimmed.match(/^([A-Za-z0-9_+-]+)\s*:\s*(.*)$/);
    if (laneMatch && !trimmed.startsWith("```") && !trimmed.startsWith("#")) {
      const lane = laneMatch[1].toLowerCase();
      const code = laneMatch[2];
      result.push(`${lane}: ${code}`);
      continue;
    }

    // sort @import lines that appear consecutively
    if (trimmed.startsWith("@import")) {
      const importBlock = [trimmed];
      // look ahead handled below by the main loop; just push this one
      result.push(trimmed);
      continue;
    }

    result.push(trimmed);
  }

  // remove trailing blank lines, ensure single trailing newline
  while (result.length > 0 && result[result.length - 1] === "") {
    result.pop();
  }
  return result.join("\n") + "\n";
}

export function sortImports(source) {
  const lines = source.split(/\r?\n/);
  const result = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].trim().startsWith("@import")) {
      const importLines = [];
      while (i < lines.length && lines[i].trim().startsWith("@import")) {
        importLines.push(lines[i].trim());
        i++;
      }
      importLines.sort();
      result.push(...importLines);
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join("\n");
}
