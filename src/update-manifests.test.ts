import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// scripts/update-manifests.mjs writes package.json's description (and the
// homepage, version, license and download URLs) into Ruby double-quoted strings
// in the Homebrew formula. These tests pin the escaping that keeps each value a
// plain string (CodeQL js/incomplete-sanitization).
//
// The file lives one level below the repo root in both layouts -- src/ and the
// compiled dist/ -- so the same hop reaches the root.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts", "update-manifests.mjs");

interface FormulaInput {
  className: string;
  cmd: string;
  description?: string;
  homepage: string;
  version: string;
  license?: string;
  assets: Record<"macArm64" | "macX64" | "linuxX64", { url: string; sha256: string }>;
}
interface ManifestModule {
  rubyString: (value: unknown) => string;
  renderFormula: (input: FormulaInput) => string;
  isEntrypoint: (argv1: string | undefined, moduleUrl?: string) => boolean;
}

let mod: ManifestModule;

before(async () => {
  // A computed specifier keeps tsc from resolving the untyped .mjs. Importing
  // it must not run the release (gh release download): the entrypoint guard.
  mod = (await import(pathToFileURL(scriptPath).href)) as ManifestModule;
});

// Read the body of a Ruby double-quoted literal the way Ruby does, failing on
// anything that would end the string early or interpolate code.
function parseRubyDq(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") {
      const next = body[++i];
      if (next === undefined) throw new Error("dangling backslash escapes the closing quote");
      out += next === "n" ? "\n" : next === "r" ? "\r" : next;
    } else if (c === '"') {
      throw new Error(`unescaped quote at ${i} ends the string early`);
    } else if (c === "#" && /[{@$]/.test(body[i + 1] ?? "")) {
      throw new Error(`unescaped interpolation at ${i}`);
    } else if (c === "\n" || c === "\r") {
      throw new Error(`raw line break at ${i}`);
    } else {
      out += c;
    }
  }
  return out;
}

const HOSTILE = [
  "Lemon Squeezy MCP server: stores, orders, subscriptions, license keys, refunds, and webhooks.",
  'He said "hi"',
  "trailing backslash \\",
  'backslash then quote \\"',
  "C:\\path\\to\\thing",
  '#{system("rm -rf ~")}',
  "#@ivar and #$global",
  "line one\nline two\r\n",
  "C# support",
  "",
];

describe("update-manifests rubyString", () => {
  for (const input of HOSTILE) {
    it(`round-trips ${JSON.stringify(input)}`, () => {
      assert.equal(parseRubyDq(mod.rubyString(input)), input);
    });
  }

  it("escapes the backslash before the quote", () => {
    // The old `.replace(/"/g, '\\"')` turned `\"` into `\\"`, which Ruby reads
    // as an escaped backslash followed by a closing quote.
    assert.equal(mod.rubyString('a\\"b'), 'a\\\\\\"b');
  });

  it("escapes # only where it starts interpolation", () => {
    // brew style flags `\#` that is not followed by {, @ or $ as redundant.
    assert.equal(mod.rubyString("C# support, issue #12"), "C# support, issue #12");
    assert.equal(mod.rubyString("#{x} #@y #$z"), "\\#{x} \\#@y \\#$z");
  });

  it("treats null and undefined as empty", () => {
    assert.equal(mod.rubyString(undefined), "");
    assert.equal(mod.rubyString(null), "");
  });
});

describe("update-manifests renderFormula", () => {
  const base: FormulaInput = {
    className: "LemonsqueezyMcp",
    cmd: "lemonsqueezy-mcp",
    homepage: "https://yaw.sh/mcp-servers/lemonsqueezy-mcp/",
    version: "1.0.1",
    license: "MIT",
    assets: {
      macArm64: { url: "https://example.test/a", sha256: "aa" },
      macX64: { url: "https://example.test/b", sha256: "bb" },
      linuxX64: { url: "https://example.test/c", sha256: "cc" },
    },
  };

  function descLine(formula: string): string {
    const lines = formula.split("\n").filter((l) => l.startsWith("  desc "));
    assert.equal(lines.length, 1, `expected one desc line in:\n${formula}`);
    const m = /^ {2}desc "(.*)"$/.exec(lines[0]);
    assert.ok(m, `desc line is not one double-quoted string: ${lines[0]}`);
    return m[1];
  }

  for (const description of HOSTILE) {
    it(`desc carries ${JSON.stringify(description)} as a plain string`, () => {
      const formula = mod.renderFormula({ ...base, description });
      assert.equal(parseRubyDq(descLine(formula)), description);
      // The rest of the formula is untouched by the hostile value.
      assert.match(formula, /^class LemonsqueezyMcp < Formula\n/);
      assert.match(formula, /\n {2}homepage "https:\/\/yaw\.sh\/mcp-servers\/lemonsqueezy-mcp\/"\n/);
      assert.ok(formula.endsWith("  end\nend\n"));
    });
  }

  it("escapes homepage, version and license too", () => {
    const formula = mod.renderFormula({
      ...base,
      description: "d",
      homepage: 'https://x.test/"#{1}',
      version: '1.0.0"',
      license: 'MIT" #{2}',
    });
    assert.ok(formula.includes('  homepage "https://x.test/\\"\\#{1}"\n'));
    assert.ok(formula.includes('  version "1.0.0\\""\n'));
    assert.ok(formula.includes('  license "MIT\\" \\#{2}"\n'));
  });

  it("writes license :cannot_represent for UNLICENSED or no license", () => {
    assert.ok(mod.renderFormula({ ...base, license: "UNLICENSED" }).includes("  license :cannot_represent\n"));
    assert.ok(mod.renderFormula({ ...base, license: undefined }).includes("  license :cannot_represent\n"));
  });

  it("refuses a class name that is not a Ruby constant", () => {
    assert.throws(() => mod.renderFormula({ ...base, className: "Foo; system('x')" }), /not a valid Ruby class name/);
    assert.throws(() => mod.renderFormula({ ...base, className: "lowercase" }), /not a valid Ruby class name/);
  });
});

describe("update-manifests isEntrypoint", () => {
  it("is false for a missing argv[1] and for another file", () => {
    assert.equal(mod.isEntrypoint(undefined), false);
    assert.equal(mod.isEntrypoint(""), false);
    assert.equal(mod.isEntrypoint(join(repoRoot, "package.json"), pathToFileURL(scriptPath).href), false);
    assert.equal(mod.isEntrypoint(join(repoRoot, "no-such-file.mjs"), pathToFileURL(scriptPath).href), false);
  });

  it("is true for the script itself and through a junction or symlink", () => {
    assert.equal(mod.isEntrypoint(scriptPath, pathToFileURL(scriptPath).href), true);
    // Link to a throwaway copy inside the temp dir, never to the repo, so the
    // cleanup cannot reach real files whatever it does with the link.
    const tmp = mkdtempSync(join(tmpdir(), "lsq-mf-"));
    try {
      const real = join(tmp, "real");
      mkdirSync(real);
      const copy = join(real, "update-manifests.mjs");
      copyFileSync(scriptPath, copy);
      const link = join(tmp, "link");
      // "junction" needs no privilege on Windows and is ignored elsewhere.
      symlinkSync(real, link, "junction");
      assert.equal(mod.isEntrypoint(join(link, "update-manifests.mjs"), pathToFileURL(copy).href), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
