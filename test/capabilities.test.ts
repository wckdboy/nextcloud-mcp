import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capabilityByName, capabilities } from "../src/capabilities/index.js";
import { createNextcloudMcpServer } from "../src/server.js";
import { fileInfo, mockFiles, resultText, toolContext } from "./helpers.js";

describe("capabilities", () => {
  it("registers the agent file tools", () => {
    assert.deepEqual(
      capabilities.map((capability) => capability.name),
      [
        "list_directory",
        "stat",
        "read_file",
        "write_file",
        "mkdir",
        "move",
        "delete",
        "create_share_link",
        "search",
      ],
    );
    createNextcloudMcpServer(mockFiles(), { maxReadBytes: 10, maxWriteBytes: 10 });
  });

  it("refuses delete unless confirm is true, and refuses the root and unconfirmed folder deletes", async () => {
    const calls: string[] = [];
    const client = mockFiles({
      stat: async (path) => {
        calls.push(`stat:${path}`);
        return fileInfo({ path, name: path, isDirectory: path.endsWith("/") || path === "dir" });
      },
      delete: async (path) => {
        calls.push(`delete:${path}`);
      },
    });
    const ctx = toolContext(client);
    const remove = capabilityByName("delete");

    const unconfirmed = await remove.handle({ path: "notes.txt", confirm: false }, ctx);
    assert.equal(unconfirmed.isError, true);
    assert.match(resultText(unconfirmed), /confirm: true/);

    const root = await remove.handle({ path: "/", confirm: true }, ctx);
    assert.equal(root.isError, true);
    assert.match(resultText(root), /files root/);

    const folder = await remove.handle({ path: "dir", confirm: true }, ctx);
    assert.equal(folder.isError, true);
    assert.match(resultText(folder), /recursive: true/);

    const file = await remove.handle({ path: "notes.txt", confirm: true }, ctx);
    assert.equal(file.isError, undefined);
    assert.deepEqual(calls, ["stat:dir", "stat:notes.txt", "delete:notes.txt"]);
  });

  it("blocks traversal before any client call", async () => {
    let called = false;
    const client = mockFiles({
      listDirectory: async () => {
        called = true;
        return [];
      },
    });
    const result = await capabilityByName("list_directory").handle({ path: "foo/%2e%2e/etc" }, toolContext(client));
    assert.equal(result.isError, true);
    assert.match(resultText(result), /traversal/i);
    assert.equal(called, false);
  });

  it("returns text and refuses binary unless base64 is requested", async () => {
    const client = mockFiles({
      stat: async () => fileInfo(),
      readFile: async () => ({
        bytes: Buffer.from("hello"),
        contentType: "text/plain",
        byteLength: 5,
      }),
    });
    const text = await capabilityByName("read_file").handle({ path: "notes.txt" }, toolContext(client));
    assert.equal(text.isError, undefined);
    assert.match(resultText(text), /hello/);

    const binaryClient = mockFiles({
      stat: async () => fileInfo({ contentType: "image/png", path: "a.png", name: "a.png" }),
      readFile: async () => ({
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
        contentType: "image/png",
        byteLength: 5,
      }),
    });
    const refused = await capabilityByName("read_file").handle({ path: "a.png" }, toolContext(binaryClient));
    assert.equal(refused.isError, true);
    assert.match(resultText(refused), /base64/);

    const encoded = await capabilityByName("read_file").handle(
      { path: "a.png", encoding: "base64" },
      toolContext(binaryClient),
    );
    assert.equal(encoded.isError, undefined);
    assert.match(resultText(encoded), /"encoding": "base64"/);
  });

  it("passes overwrite false through to write_file", async () => {
    let overwrite: boolean | undefined;
    const client = mockFiles({
      writeFile: async (_path, _body, options) => {
        overwrite = options.overwrite;
      },
    });
    const result = await capabilityByName("write_file").handle(
      { path: "notes.txt", content: "hello" },
      toolContext(client),
    );
    assert.equal(result.isError, undefined);
    assert.equal(overwrite, false);
  });

  it("refuses a public link for the files root", async () => {
    const client = mockFiles();
    const result = await capabilityByName("create_share_link").handle({ path: "/" }, toolContext(client));
    assert.equal(result.isError, true);
    assert.match(resultText(result), /files root/);
  });
});
