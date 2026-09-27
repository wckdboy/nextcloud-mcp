import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { VERSION } from "../src/version.js";

interface PluginManifest {
  name: string;
  version: string;
  mcpServers: string;
  variables: {
    required: string[];
    properties: Record<string, { type: string }>;
  };
}

interface McpConfig {
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
}

interface PackageJson {
  version: string;
}

const plugin = JSON.parse(readFileSync(new URL("../.cursor-plugin/plugin.json", import.meta.url), "utf8")) as PluginManifest;
const mcp = JSON.parse(readFileSync(new URL("../mcp.json", import.meta.url), "utf8")) as McpConfig;
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as PackageJson;

const setupVariables = ["NEXTCLOUD_URL", "NEXTCLOUD_USERNAME", "NEXTCLOUD_APP_PASSWORD"] as const;

describe("cursor plugin manifest", () => {
  it("keeps the package version, plugin version, and server version together", () => {
    assert.equal(plugin.name, "nextcloud-mcp");
    assert.equal(plugin.mcpServers, "./mcp.json");
    assert.equal(plugin.version, pkg.version);
    assert.equal(plugin.version, VERSION);
  });

  it("declares only ${VAR} placeholders for the three setup variables", () => {
    assert.deepEqual(plugin.variables.required, [...setupVariables]);
    for (const name of setupVariables) {
      assert.equal(plugin.variables.properties[name]?.type, "string");
    }

    const server = mcp.mcpServers["nextcloud-mcp"];
    assert.ok(server);
    assert.equal(server.command, "npx");
    assert.deepEqual(server.args, ["-y", "--package", "github:wckdboy/nextcloud-mcp", "nextcloud-mcp"]);
    assert.deepEqual(Object.keys(server.env).sort(), [...setupVariables].sort());
    for (const name of setupVariables) {
      assert.equal(server.env[name], `\${${name}}`);
    }
  });
});
