import { VERSION } from "../version.js";
import type { NextcloudConfig } from "../config.js";
import { FileTooLargeError, NextcloudError, UserInputError } from "../errors.js";
import { encodeRelativePath, isFilesRoot, normalizeNextcloudPath, parentPath } from "../paths.js";
import type {
  FileBody,
  FileInfo,
  NextcloudFiles,
  SearchRequest,
  ShareLink,
  ShareLinkRequest,
  WriteOptions,
} from "./types.js";
import { appPasswordAuthorization, withAppPasswordAuth } from "./auth.js";
import { buildSearchXml, filenameLikeLiteral, parseMultiStatus, propfindBody } from "./xml.js";

const XML_BODY_LIMIT = 8 * 1024 * 1024;

export interface NextcloudClientOptions {
  fetchImpl?: typeof fetch;
}

export function createNextcloudClient(
  config: NextcloudConfig,
  options: NextcloudClientOptions = {},
): NextcloudFiles {
  const fetchImpl = options.fetchImpl ?? fetch;
  const authorization = appPasswordAuthorization(config.username, config.appPassword);

  function filesRoot(): string {
    // Every file operation stays on this WebDAV tree. Public share links are the OCS exception.
    return `${config.baseUrl}/remote.php/dav/files/${encodeURIComponent(config.username)}`;
  }

  function fileUrl(path: string): string {
    const normalized = normalizeNextcloudPath(path);
    if (normalized === "") {
      return `${filesRoot()}/`;
    }
    return `${filesRoot()}/${encodeRelativePath(normalized)}`;
  }

  async function request(
    method: string,
    url: string,
    path: string,
    init: { headers?: Record<string, string>; body?: BodyInit; accept: (status: number) => boolean },
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(config.timeoutMs),
        headers: withAppPasswordAuth(authorization, {
          "User-Agent": `nextcloud-mcp/${VERSION}`,
          ...init.headers,
        }),
        body: init.body,
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
      throw new NextcloudError(
        timedOut
          ? `Nextcloud ${method} timed out after ${config.timeoutMs}ms.`
          : `Could not reach Nextcloud at ${config.baseUrl}.`,
        { status: 0, method, path, cause },
      );
    }

    if (response.status >= 300 && response.status < 400) {
      throw new NextcloudError(
        `Refused to follow an HTTP ${response.status} redirect from Nextcloud. Check NEXTCLOUD_URL.`,
        { status: response.status, method, path },
      );
    }
    if (!init.accept(response.status)) {
      const detail = await errorDetail(response);
      throw new NextcloudError(explainStatus(response.status, method, path, detail), {
        status: response.status,
        method,
        path,
      });
    }
    return response;
  }

  async function propfind(path: string, depth: "0" | "1"): Promise<FileInfo[]> {
    const normalized = normalizeNextcloudPath(path);
    const response = await request("PROPFIND", fileUrl(normalized), normalized, {
      accept: (status) => status === 207,
      headers: {
        Depth: depth,
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: propfindBody(),
    });
    const xml = await readTextLimited(response, XML_BODY_LIMIT, "PROPFIND", normalized);
    return parseMultiStatus(xml, config.username);
  }

  async function statOptional(path: string): Promise<FileInfo | null> {
    try {
      return await stat(path);
    } catch (error) {
      if (error instanceof NextcloudError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async function stat(path: string): Promise<FileInfo> {
    const normalized = normalizeNextcloudPath(path);
    const entries = await propfind(normalized, "0");
    const match = entries.find((entry) => entry.path === normalized) ?? entries[0];
    if (!match) {
      throw new NextcloudError(`Nextcloud path not found (HTTP 404): ${displayPath(normalized)}`, {
        status: 404,
        method: "PROPFIND",
        path: normalized,
      });
    }
    return match;
  }

  async function mkcol(path: string): Promise<"created" | "exists"> {
    const normalized = normalizeNextcloudPath(path);
    if (normalized === "") {
      throw new UserInputError("The files root already exists.");
    }
    const response = await request("MKCOL", fileUrl(normalized), normalized, {
      accept: (status) => status === 201 || status === 200 || status === 405,
    });
    if (response.status === 405) {
      await response.body?.cancel();
      return "exists";
    }
    await response.body?.cancel();
    return "created";
  }

  async function ensureCollection(path: string): Promise<void> {
    const normalized = normalizeNextcloudPath(path);
    if (normalized === "") {
      return;
    }
    let current = "";
    for (const segment of normalized.split("/")) {
      current = current === "" ? segment : `${current}/${segment}`;
      const outcome = await mkcol(current);
      if (outcome === "created") {
        continue;
      }
      const info = await stat(current);
      if (!info.isDirectory) {
        throw new UserInputError(`${displayPath(current)} exists and is not a folder.`);
      }
    }
  }

  return {
    async listDirectory(path: string): Promise<FileInfo[]> {
      const normalized = normalizeNextcloudPath(path);
      const entries = await propfind(normalized, "1");
      return entries
        .filter((entry) => entry.path !== normalized)
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
    },

    stat,

    async readFile(path: string, maxBytes: number): Promise<FileBody> {
      const normalized = normalizeNextcloudPath(path);
      if (normalized === "") {
        throw new UserInputError("Refusing to read the files root. Pass a file path.");
      }
      const response = await request("GET", fileUrl(normalized), normalized, {
        accept: (status) => status === 200,
      });
      const contentType = response.headers.get("content-type");
      const advertised = contentLength(response);
      if (advertised !== null && advertised > maxBytes) {
        await response.body?.cancel();
        throw new FileTooLargeError(advertised, maxBytes);
      }
      const downloaded = await readCapped(response, maxBytes);
      if (downloaded.truncated) {
        throw new FileTooLargeError(advertised, maxBytes);
      }
      const bytes = downloaded.bytes;
      return { bytes, contentType, byteLength: bytes.byteLength };
    },

    async writeFile(path: string, body: Uint8Array, options: WriteOptions): Promise<void> {
      const normalized = normalizeNextcloudPath(path);
      if (normalized === "") {
        throw new UserInputError("Refusing to write the files root. Pass a file path.");
      }
      if (body.byteLength > config.limits.maxWriteBytes) {
        throw new UserInputError(
          `Refusing to upload ${body.byteLength} bytes. The write limit is ${config.limits.maxWriteBytes} bytes (NEXTCLOUD_MAX_WRITE_BYTES).`,
        );
      }
      assertSafeHeader(options.contentType);
      if (options.parents) {
        const parent = parentPath(normalized);
        if (parent !== "") {
          await ensureCollection(parent);
        }
      }
      const existing = await statOptional(normalized);
      if (existing?.isDirectory) {
        throw new UserInputError(`${displayPath(normalized)} is a folder. Refusing to overwrite it with a file.`);
      }
      if (existing && !options.overwrite) {
        throw new UserInputError(
          `${displayPath(normalized)} already exists. Pass overwrite: true to replace it.`,
        );
      }
      const response = await request("PUT", fileUrl(normalized), normalized, {
        accept: (status) => status === 200 || status === 201 || status === 204,
        headers: { "Content-Type": options.contentType },
        body: Buffer.from(body),
      });
      await response.body?.cancel();
    },

    async mkdir(path: string, parents: boolean): Promise<void> {
      const normalized = normalizeNextcloudPath(path);
      if (normalized === "") {
        throw new UserInputError("The files root already exists.");
      }
      if (parents) {
        await ensureCollection(normalized);
        return;
      }
      const outcome = await mkcol(normalized);
      if (outcome === "exists") {
        const info = await stat(normalized);
        if (info.isDirectory) {
          throw new UserInputError(`${displayPath(normalized)} already exists.`);
        }
        throw new UserInputError(`${displayPath(normalized)} exists and is not a folder.`);
      }
    },

    async move(from: string, to: string, overwrite: boolean): Promise<void> {
      const source = normalizeNextcloudPath(from);
      const destination = normalizeNextcloudPath(to);
      if (source === "" || destination === "") {
        throw new UserInputError("Refusing to move the files root.");
      }
      if (source === destination) {
        throw new UserInputError("Source and destination are the same path.");
      }
      if (destination.startsWith(`${source}/`)) {
        throw new UserInputError("Refusing to move a folder into itself.");
      }
      const response = await request("MOVE", fileUrl(source), source, {
        accept: (status) => status === 200 || status === 201 || status === 204,
        headers: {
          Destination: fileUrl(destination),
          Overwrite: overwrite ? "T" : "F",
        },
      });
      await response.body?.cancel();
    },

    async delete(path: string): Promise<void> {
      const normalized = normalizeNextcloudPath(path);
      if (isFilesRoot(normalized)) {
        throw new UserInputError("Refusing to delete the Nextcloud files root.");
      }
      const response = await request("DELETE", fileUrl(normalized), normalized, {
        accept: (status) => status === 200 || status === 204,
      });
      await response.body?.cancel();
    },

    async createShareLink(input: ShareLinkRequest): Promise<ShareLink> {
      const normalized = normalizeNextcloudPath(input.path);
      if (normalized === "") {
        throw new UserInputError("Refusing to create a public link for the files root. Pass a specific file or folder.");
      }
      const params = new URLSearchParams();
      params.set("path", `/${normalized}`);
      params.set("shareType", "3");
      params.set("permissions", String(input.permissions));
      if (input.password !== undefined) {
        params.set("password", input.password);
      }
      if (input.expireDate !== undefined) {
        params.set("expireDate", input.expireDate);
      }
      if (input.label !== undefined) {
        params.set("label", input.label);
      }
      const response = await request(
        "POST",
        `${config.baseUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`,
        normalized,
        {
          accept: (status) => status === 200 || status === 201,
          headers: {
            "OCS-APIRequest": "true",
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        },
      );
      const payload = await response.json() as unknown;
      return parseShare(payload, config.baseUrl, normalized);
    },

    async search(input: SearchRequest): Promise<FileInfo[]> {
      const normalized = normalizeNextcloudPath(input.path);
      const likeLiteral = filenameLikeLiteral(input.query);
      const response = await request("SEARCH", `${config.baseUrl}/remote.php/dav/`, normalized, {
        accept: (status) => status === 207,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
        body: buildSearchXml({
          username: config.username,
          path: normalized,
          likeLiteral,
          limit: input.limit,
        }),
      });
      const xml = await readTextLimited(response, XML_BODY_LIMIT, "SEARCH", normalized);
      return parseMultiStatus(xml, config.username).slice(0, input.limit);
    },
  };
}

function parseShare(payload: unknown, baseUrl: string, path: string): ShareLink {
  const root = asRecord(payload);
  const ocs = asRecord(root?.ocs);
  const meta = asRecord(ocs?.meta);
  const status = textOf(meta?.status);
  const statusCode = numberOf(meta?.statuscode);
  const ok = status === "ok" || statusCode === 100 || statusCode === 200;
  if (!ok) {
    const message = textOf(meta?.message) ?? "OCS share creation failed.";
    throw new NextcloudError(message, { status: statusCode ?? 0, method: "POST", path });
  }
  const dataValue = ocs?.data;
  const data = asRecord(Array.isArray(dataValue) ? dataValue[0] : dataValue);
  if (!data) {
    throw new NextcloudError("OCS share response did not include share data.", {
      status: statusCode ?? 200,
      method: "POST",
      path,
    });
  }
  const token = textOf(data.token);
  const url = textOf(data.url) ?? (token ? `${baseUrl}/s/${encodeURIComponent(token)}` : "");
  if (url === "") {
    throw new NextcloudError("OCS share response did not include a URL.", {
      status: statusCode ?? 200,
      method: "POST",
      path,
    });
  }
  const id = numberOf(data.id);
  if (id === null) {
    throw new NextcloudError("OCS share response did not include a share id.", {
      status: statusCode ?? 200,
      method: "POST",
      path,
    });
  }
  return {
    id,
    url,
    token,
    path: textOf(data.path)?.replace(/^\//, "") || path,
    permissions: numberOf(data.permissions),
    expiration: textOf(data.expiration),
  };
}

function explainStatus(status: number, method: string, path: string, detail: string): string {
  const where = displayPath(path);
  let summary: string;
  if (status === 401) {
    summary = "Nextcloud rejected the app password (HTTP 401). Check NEXTCLOUD_USERNAME and NEXTCLOUD_APP_PASSWORD. Use an app token from Settings → Security → Devices & sessions, not the account password, a session cookie, or OAuth.";
  } else if (status === 403) {
    summary = `Nextcloud refused ${method} (HTTP 403) for ${where}.`;
  } else if (status === 404) {
    summary = `Nextcloud path not found (HTTP 404): ${where}.`;
  } else if (status === 405 && method === "SEARCH") {
    summary = "This Nextcloud server does not allow WebDAV SEARCH (HTTP 405). Filename search is unavailable.";
  } else if (status === 409) {
    summary = `Nextcloud conflict (HTTP 409) for ${where}. A parent folder may be missing. Pass parents: true to create it.`;
  } else if (status === 412) {
    summary = `Destination exists and overwrite is false (HTTP 412): ${where}.`;
  } else if (status === 423) {
    summary = `The file is locked (HTTP 423): ${where}.`;
  } else if (status === 501 && method === "SEARCH") {
    summary = "This Nextcloud server does not implement WebDAV SEARCH (HTTP 501). Filename search is unavailable.";
  } else if (status === 507) {
    summary = "Nextcloud storage is full (HTTP 507).";
  } else {
    summary = `Nextcloud ${method} failed (HTTP ${status}) for ${where}.`;
  }
  return detail.length > 0 ? `${summary} ${detail}` : summary;
}

async function errorDetail(response: Response): Promise<string> {
  const text = await response.text();
  const message = text.match(/<(?:[\w.-]+:)?message>([^<]+)<\//)?.[1]?.trim();
  if (message) {
    return message.slice(0, 300);
  }
  if (text.trimStart().startsWith("<") && /<html[\s>]/i.test(text)) {
    return "The server returned an HTML page instead of WebDAV or OCS. Check NEXTCLOUD_URL.";
  }
  const compact = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return compact.slice(0, 300);
}

function contentLength(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function readCapped(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      return { bytes: buffer.subarray(0, maxBytes), truncated: true };
    }
    return { bytes: buffer, truncated: false };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value || value.byteLength === 0) {
      continue;
    }
    if (total + value.byteLength > maxBytes) {
      await reader.cancel();
      return { bytes: concat(chunks, total), truncated: true };
    }
    chunks.push(value);
    total += value.byteLength;
  }
  return { bytes: concat(chunks, total), truncated: false };
}

async function readTextLimited(response: Response, maxBytes: number, method: string, path: string): Promise<string> {
  const downloaded = await readCapped(response, maxBytes);
  if (downloaded.truncated) {
    throw new NextcloudError(`Nextcloud ${method} response exceeded ${maxBytes} bytes.`, {
      status: response.status,
      method,
      path,
    });
  }
  return new TextDecoder().decode(downloaded.bytes);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function assertSafeHeader(value: string): void {
  if (value.length === 0 || value.length > 200 || /[\r\n]/.test(value)) {
    throw new UserInputError("contentType is empty or contains invalid characters.");
  }
}

function displayPath(path: string): string {
  return path === "" ? "/" : path;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}
