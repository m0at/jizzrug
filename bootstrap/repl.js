import readline from "node:readline";
import vm from "node:vm";

export function startRepl(parseProgram) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "jizz> ",
  });

  const ctx = vm.createContext({ console, require: undefined });
  let blockBuffer = null;

  rl.prompt();

  rl.on("line", (line) => {
    const trimmed = line.trim();

    if (blockBuffer !== null) {
      if (trimmed === "```") {
        const source = blockBuffer.lines.join("\n");
        evalJsSegment(source, blockBuffer.lane, ctx, parseProgram);
        blockBuffer = null;
      } else {
        blockBuffer.lines.push(line);
      }
      rl.prompt();
      return;
    }

    const fenceMatch = trimmed.match(/^```([A-Za-z0-9_+-]+)(?:\s+(.*))?$/);
    if (fenceMatch) {
      blockBuffer = { lane: fenceMatch[1].toLowerCase(), lines: [] };
      rl.prompt();
      return;
    }

    if (!trimmed || trimmed.startsWith("#")) {
      rl.prompt();
      return;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex !== -1) {
      const lane = line.slice(0, colonIndex).trim().toLowerCase();
      const code = line.slice(colonIndex + 1).trimStart();
      evalJsSegment(code, lane, ctx, parseProgram);
    } else {
      console.log("Parse error: expected <lane>: <code>");
    }

    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

function evalJsSegment(code, lane, ctx, _parseProgram) {
  const jsLanes = ["js", "javascript", "node"];
  if (!jsLanes.includes(lane)) {
    console.log(`[${lane}] ${code}`);
    return;
  }
  try {
    const result = vm.runInContext(code, ctx);
    if (result !== undefined) console.log(result);
  } catch (err) {
    console.error(err.message);
  }
}
