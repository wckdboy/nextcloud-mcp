import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { capabilityByName } from "../src/capabilities/index.js";
import { createNextcloudClient } from "../src/nextcloud/client.js";
import { fileInfo, mockFiles, recordedFetch, resultText, testConfig, toolContext } from "./helpers.js";

const FILE_STAT = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/alice/docs/a.pdf</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>a.pdf</d:displayname>
        <d:getcontenttype>application/pdf</d:getcontenttype>
        <d:getcontentlength>6</d:getcontentlength>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

describe("host file transfer", () => {
  it("describes inline write versus host upload and download", () => {
    assert.match(capabilityByName("write_file").description, /prefer upload_file with localPath/);
    assert.match(capabilityByName("upload_file").description, /WebDAV PUT/);
    assert.match(capabilityByName("upload_file").description, /NEXTCLOUD_MAX_WRITE_BYTES/);
    assert.match(capabilityByName("download_file").description, /WebDAV GET/);
    assert.match(capabilityByName("download_file").description, /NEXTCLOUD_MAX_WRITE_BYTES/);
  });

  it("uploads a local file with WebDAV PUT and does not accept inline bytes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nc-upload-"));
    try {
      const payload = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]);
      const localPath = path.join(dir, "doc.pdf");
      const linkPath = path.join(dir, "link.pdf");
      await writeFile(localPath, payload);
      await symlink(localPath, linkPath);

      const { fetchImpl, calls } = recordedFetch((call) => {
        if (call.method === "MKCOL") {
          return new Response(null, { status: 201 });
        }
        if (call.method === "PROPFIND") {
          return new Response("", { status: 404 });
        }
        return new Response(null, { status: 201 });
      });
      const client = createNextcloudClient(testConfig, { fetchImpl });
      const result = await capabilityByName("upload_file").handle(
        {
          path: "docs/doc.pdf",
          localPath: linkPath,
          contentType: "application/pdf",
          parents: true,
        },
        toolContext(client),
      );
      assert.equal(result.isError, undefined);
      const body = JSON.parse(resultText(result)) as { bytes: number; localPath: string; contentType: string };
      assert.equal(body.bytes, payload.byteLength);
      assert.equal(body.contentType, "application/pdf");
      assert.equal(body.localPath, await realpath(localPath));
      const put = calls.find((call) => call.method === "PUT");
      assert.ok(put);
      assert.deepEqual(put.rawBody, payload);
      assert.equal(put.duplex, "half");
      assert.equal(put.headers.get("content-type"), "application/pdf");
      assert.equal(calls.some((call) => call.method === "MKCOL"), true);
      assert.equal(calls.some((call) => call.body?.includes("base64")), false);

      const inlined = await capabilityByName("upload_file").handle(
        { path: "docs/doc.pdf", localPath, content: payload.toString("base64"), encoding: "base64" },
        toolContext(mockFiles()),
      );
      assert.equal(inlined.isError, true);
      assert.match(resultText(inlined), /content|encoding|Unrecognized/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses unsafe or oversized local uploads before WebDAV PUT", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nc-upload-guard-"));
    try {
      const localPath = path.join(dir, "doc.bin");
      await writeFile(localPath, Buffer.from("12345"));
      await mkdir(path.join(dir, "folder"));
      let puts = 0;
      const client = mockFiles({
        writeFile: async () => {
          puts += 1;
        },
      });
      const ctx = toolContext(client, { maxReadBytes: 1024, maxWriteBytes: 4 });
      const upload = capabilityByName("upload_file");

      const relative = await upload.handle({ path: "a.bin", localPath: "doc.bin" }, ctx);
      assert.equal(relative.isError, true);
      assert.match(resultText(relative), /absolute/);

      const traversal = await upload.handle({ path: "a.bin", localPath: `${dir}/../${path.basename(dir)}/doc.bin` }, ctx);
      assert.equal(traversal.isError, true);
      assert.match(resultText(traversal), /\.\./);

      const remoteTraversal = await upload.handle({ path: "../etc/passwd", localPath }, ctx);
      assert.equal(remoteTraversal.isError, true);
      assert.match(resultText(remoteTraversal), /traversal/i);

      const missing = await upload.handle({ path: "a.bin", localPath: path.join(dir, "missing.bin") }, ctx);
      assert.equal(missing.isError, true);
      assert.match(resultText(missing), /not found/i);

      const directory = await upload.handle({ path: "a.bin", localPath: path.join(dir, "folder") }, ctx);
      assert.equal(directory.isError, true);
      assert.match(resultText(directory), /regular file/);

      const oversized = await upload.handle({ path: "a.bin", localPath }, ctx);
      assert.equal(oversized.isError, true);
      assert.match(resultText(oversized), /NEXTCLOUD_MAX_WRITE_BYTES/);
      assert.equal(puts, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("downloads a WebDAV file to disk above the inline read limit and under the write limit", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nc-download-"));
    try {
      const payload = Buffer.alloc(1500, 0x61);
      assert.ok(payload.byteLength > testConfig.limits.maxReadBytes);
      assert.ok(payload.byteLength < testConfig.limits.maxWriteBytes);
      const { fetchImpl, calls } = recordedFetch((call) => {
        if (call.method === "PROPFIND") {
          return new Response(FILE_STAT, { status: 207, headers: { "content-type": "application/xml" } });
        }
        return new Response(payload, {
          status: 200,
          headers: { "content-type": "application/pdf", "content-length": String(payload.byteLength) },
        });
      });
      const client = createNextcloudClient(testConfig, { fetchImpl });
      const localPath = path.join(dir, "out.pdf");
      const result = await capabilityByName("download_file").handle(
        { path: "docs/a.pdf", localPath },
        toolContext(client),
      );
      assert.equal(result.isError, undefined);
      const body = JSON.parse(resultText(result)) as { bytes: number; localPath: string; contentType: string };
      assert.equal(body.bytes, payload.byteLength);
      assert.equal(body.contentType, "application/pdf");
      assert.equal(body.localPath, path.join(await realpath(dir), "out.pdf"));
      assert.deepEqual(await readFile(body.localPath), payload);
      assert.equal(calls.some((call) => call.method === "GET"), true);
      assert.equal((await readdir(dir)).some((name) => name.endsWith(".partial")), false);

      const inlined = await capabilityByName("download_file").handle(
        { path: "docs/a.pdf", localPath, encoding: "base64" },
        toolContext(mockFiles()),
      );
      assert.equal(inlined.isError, true);
      assert.match(resultText(inlined), /encoding|Unrecognized/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses unsafe download destinations and replaces a local file only when overwrite is true", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nc-download-guard-"));
    try {
      const dest = path.join(dir, "out.pdf");
      await writeFile(dest, Buffer.from("keep"));
      const target = path.join(dir, "secret.txt");
      await writeFile(target, Buffer.from("secret"));
      const link = path.join(dir, "via-link.pdf");
      await symlink(target, link);

      let downloads = 0;
      const client = mockFiles({
        stat: async () => fileInfo({ path: "docs/a.pdf", name: "a.pdf" }),
        downloadFile: async () => {
          downloads += 1;
          return { contentType: "application/pdf", byteLength: 1 };
        },
      });
      const ctx = toolContext(client);
      const download = capabilityByName("download_file");

      const relative = await download.handle({ path: "docs/a.pdf", localPath: "out.pdf" }, ctx);
      assert.equal(relative.isError, true);
      assert.match(resultText(relative), /absolute/);

      const traversal = await download.handle(
        { path: "docs/a.pdf", localPath: `${dir}/../${path.basename(dir)}/out.pdf` },
        ctx,
      );
      assert.equal(traversal.isError, true);
      assert.match(resultText(traversal), /\.\./);

      const exists = await download.handle({ path: "docs/a.pdf", localPath: dest }, ctx);
      assert.equal(exists.isError, true);
      assert.match(resultText(exists), /overwrite: true/);
      assert.equal(await readFile(dest, "utf8"), "keep");

      const replaced = path.join(dir, "replace.pdf");
      await writeFile(replaced, Buffer.from("old"));
      const writer = mockFiles({
        stat: async () => fileInfo({ path: "docs/a.pdf", name: "a.pdf", isDirectory: false }),
        downloadFile: async (_remotePath, maxBytes, destination) => {
          assert.equal(maxBytes, testConfig.limits.maxWriteBytes);
          destination.write(Buffer.from("new"));
          return { contentType: "application/pdf", byteLength: 3 };
        },
      });
      const overwritten = await download.handle(
        { path: "docs/a.pdf", localPath: replaced, overwrite: true },
        toolContext(writer),
      );
      assert.equal(overwritten.isError, undefined);
      assert.equal(await readFile(replaced, "utf8"), "new");

      const viaLink = await download.handle({ path: "docs/a.pdf", localPath: link }, ctx);
      assert.equal(viaLink.isError, true);
      assert.match(resultText(viaLink), /symlink/);
      assert.equal(await readFile(target, "utf8"), "secret");
      assert.equal(downloads, 0);

      const folder = mockFiles({
        stat: async () => fileInfo({ path: "docs", name: "docs", isDirectory: true }),
      });
      const directory = await download.handle(
        { path: "docs", localPath: path.join(dir, "fresh.pdf") },
        toolContext(folder),
      );
      assert.equal(directory.isError, true);
      assert.match(resultText(directory), /folder/);
      assert.equal(await fileExists(path.join(dir, "fresh.pdf")), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("deletes a partial download when WebDAV reports a file over the write limit", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nc-download-large-"));
    try {
      const { fetchImpl, calls } = recordedFetch((call) => {
        if (call.method === "PROPFIND") {
          return new Response(FILE_STAT, { status: 207, headers: { "content-type": "application/xml" } });
        }
        return new Response(Buffer.alloc(8), {
          status: 200,
          headers: { "content-type": "application/pdf", "content-length": String(testConfig.limits.maxWriteBytes + 1) },
        });
      });
      const client = createNextcloudClient(testConfig, { fetchImpl });
      const localPath = path.join(dir, "big.pdf");
      const result = await capabilityByName("download_file").handle({ path: "docs/a.pdf", localPath }, toolContext(client));
      assert.equal(result.isError, true);
      assert.match(resultText(result), /NEXTCLOUD_MAX_WRITE_BYTES/);
      assert.equal(await fileExists(localPath), false);
      assert.equal((await readdir(dir)).some((name) => name.endsWith(".partial")), false);
      assert.equal(calls.some((call) => call.method === "GET"), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function fileExists(localPath: string): Promise<boolean> {
  try {
    await readFile(localPath);
    return true;
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
