import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_INSTRUCTIONS_BYTES, SERVER_INSTRUCTIONS } from "./instructions.js";

describe("server instructions", () => {
  it("stays under the byte ceiling a host may cut it at", () => {
    // yaw-mcp cuts upstream instructions at 2000 bytes; past that, guidance is
    // silently lost. Measured in UTF-8 bytes, not characters.
    const bytes = Buffer.byteLength(SERVER_INSTRUCTIONS, "utf8");
    assert.ok(bytes < MAX_INSTRUCTIONS_BYTES, `instructions are ${bytes} bytes, ceiling ${MAX_INSTRUCTIONS_BYTES}`);
    assert.equal(MAX_INSTRUCTIONS_BYTES, 2000);
  });

  it("is plain printable ASCII", () => {
    // No em-dashes or smart quotes: a host may sanitise non-ASCII away, and a
    // terminal may render it as mojibake.
    assert.match(SERVER_INSTRUCTIONS, /^[\x20-\x7e\n]+$/);
  });

  it("names every tool it routes to by a name that exists", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const toolsDir = join(dirname(fileURLToPath(import.meta.url)), "tools");
    const names = new Set<string>();
    for (const file of readdirSync(toolsDir)) {
      if (!file.endsWith(".js") || file.includes(".test.")) continue;
      for (const m of readFileSync(join(toolsDir, file), "utf8").matchAll(/name: "(ls_[a-z_]+)"/g)) names.add(m[1]);
    }
    assert.ok(names.size > 0, "found no tool names -- did the tools directory move?");
    for (const m of SERVER_INSTRUCTIONS.matchAll(/\bls_[a-z_]*[a-z]\b/g)) {
      if (m[0] === "ls_sink" || m[0].endsWith("_")) continue;
      assert.ok(names.has(m[0]), `instructions name ${m[0]}, which is not a registered tool`);
    }
  });
});
