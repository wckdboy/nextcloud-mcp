import { Readable } from "node:stream";
import type { NextcloudConfig } from "../src/config.js";
import type { FileInfo, NextcloudFiles } from "../src/nextcloud/types.js";
import type { ToolContext } from "../src/capabilities/types.js";
import type { ToolResult } from "../src/tool-result.js";

export const testConfig: NextcloudConfig = {
  baseUrl: "https://cloud.example.com",
  username: "alice",
  appPassword: "app-secret",
  timeoutMs: 5_000,
  limits: { maxReadBytes: 1024, maxWriteBytes: 2048 },
  httpHost: "127.0.0.1",
  httpPort: 8787,
  httpToken: null,
  httpAllowedHosts: [],
};

export function fileInfo(overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    path: "notes.txt",
    name: "notes.txt",
    isDirectory: false,
    size: 5,
    contentType: "text/plain",
    lastModified: "Thu, 21 Jul 2022 05:12:23 GMT",
    etag: "file-etag",
    fileId: "11",
    permissions: "RGDNVW",
    ...overrides,
  };
}

export function mockFiles(overrides: Partial<NextcloudFiles> = {}): NextcloudFiles {
  const unexpected = async (): Promise<never> => {
    throw new Error("unexpected Nextcloud call");
  };
  return {
    listDirectory: unexpected,
    stat: unexpected,
    readFile: unexpected,
    downloadFile: unexpected,
    writeFile: unexpected,
    mkdir: unexpected,
    move: unexpected,
    delete: unexpected,
    createShareLink: unexpected,
    search: unexpected,
    ...overrides,
  };
}

export function toolContext(client: NextcloudFiles, limits = testConfig.limits): ToolContext {
  return { client, limits };
}

export function resultText(result: ToolResult): string {
  const block = result.content[0];
  if (!block || block.type !== "text") {
    throw new Error("tool result had no text content");
  }
  return block.text;
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
  rawBody: Buffer | null;
  duplex: string | null;
}

export function recordedFetch(handler: (call: RecordedCall) => Response): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const rawBody = await readRawBody(init?.body);
    const body = rawBody === null ? null : rawBody.toString("utf8");
    const duplex = duplexOf(init);
    const call: RecordedCall = { url, method: init?.method ?? "GET", headers, body, rawBody, duplex };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
}

function duplexOf(init: RequestInit | undefined): string | null {
  if (init === undefined) {
    return null;
  }
  const record = init as RequestInit & { duplex?: unknown };
  return typeof record.duplex === "string" ? record.duplex : null;
}

async function readRawBody(body: BodyInit | Readable | null | undefined): Promise<Buffer | null> {
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }
  return null;
}
