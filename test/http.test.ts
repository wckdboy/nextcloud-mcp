import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHttpServer } from "../src/http.js";
import { mockFiles, testConfig } from "./helpers.js";

describe("HTTP transport", () => {
  it("serves /health on loopback and requires a bearer token when one is configured", async () => {
    const open = createHttpServer(testConfig, mockFiles());
    const openPort = await listen(open);
    try {
      const health = await fetch(`http://127.0.0.1:${openPort}/health`);
      assert.equal(health.status, 200);
      const body = await health.json() as { ok: boolean; name: string };
      assert.equal(body.ok, true);
      assert.equal(body.name, "nextcloud-mcp");
    } finally {
      open.close();
    }

    const locked = createHttpServer({ ...testConfig, httpToken: "mcp-token" }, mockFiles());
    const lockedPort = await listen(locked);
    try {
      const denied = await fetch(`http://127.0.0.1:${lockedPort}/health`);
      assert.equal(denied.status, 401);
      const allowed = await fetch(`http://127.0.0.1:${lockedPort}/health`, {
        headers: { Authorization: "Bearer mcp-token" },
      });
      assert.equal(allowed.status, 200);
    } finally {
      locked.close();
    }
  });
});

function listen(server: ReturnType<typeof createHttpServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("HTTP server did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}
