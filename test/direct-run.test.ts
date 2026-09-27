import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { isDirectRun } from "../src/direct-run.js";

describe("isDirectRun", () => {
  it("treats an npm bin symlink as the real module", () => {
    const root = mkdtempSync(path.join(tmpdir(), "nextcloud-mcp-bin-"));
    try {
      const packageDir = path.join(root, "node_modules", "nextcloud-mcp", "dist");
      const binDir = path.join(root, "node_modules", ".bin");
      mkdirSync(packageDir, { recursive: true });
      mkdirSync(binDir, { recursive: true });
      const realEntry = path.join(packageDir, "index.js");
      writeFileSync(realEntry, "#!/usr/bin/env node\n");
      const link = path.join(binDir, "nextcloud-mcp");
      symlinkSync(path.relative(binDir, realEntry), link);

      const moduleUrl = pathToFileURL(realEntry).href;
      assert.notEqual(pathToFileURL(link).href, moduleUrl);
      assert.equal(isDirectRun(moduleUrl, link), true);
      assert.equal(isDirectRun(moduleUrl, realEntry), true);
      assert.equal(isDirectRun(pathToFileURL(path.join(packageDir, "other.js")).href, link), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns false when there is no entry path", () => {
    assert.equal(isDirectRun("file:///tmp/index.js", undefined), false);
  });

  it("compares the path literally when it cannot be resolved", () => {
    const missing = path.join(tmpdir(), "nextcloud-mcp-missing-entry.js");
    const moduleUrl = pathToFileURL(missing).href;
    assert.equal(isDirectRun(moduleUrl, missing), true);
    assert.equal(isDirectRun("file:///other.js", missing), false);
  });
});

describe("package bin entry", () => {
  it("prints help when launched through a bin symlink", () => {
    const root = mkdtempSync(path.join(tmpdir(), "nextcloud-mcp-entry-"));
    const binDir = path.join(root, "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    const link = path.join(binDir, "nextcloud-mcp");
    symlinkSync(path.relative(binDir, path.resolve("src/index.ts")), link);
    try {
      const result = spawnSync(process.execPath, ["--import", "tsx", link, "--help"], {
        cwd: path.resolve("."),
        encoding: "utf8",
        timeout: 20_000,
        env: process.env,
      });
      const stderr = typeof result.stderr === "string" ? result.stderr : "";
      const failure = stderr || result.error?.message || "entrypoint exited without help text";
      assert.equal(result.status, 0, failure);
      assert.match(stderr, /nextcloud-mcp/);
      assert.match(stderr, /NEXTCLOUD_URL/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
