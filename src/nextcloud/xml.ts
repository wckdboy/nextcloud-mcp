import { XMLParser } from "fast-xml-parser";
import { PathError, UserInputError } from "../errors.js";
import { encodeRelativePath, normalizeNextcloudPath } from "../paths.js";
import type { FileInfo } from "./types.js";

const PROPFIND_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:prop>
    <d:displayname/>
    <d:getlastmodified/>
    <d:getcontentlength/>
    <d:getcontenttype/>
    <d:resourcetype/>
    <d:getetag/>
    <oc:fileid/>
    <oc:permissions/>
    <oc:size/>
  </d:prop>
</d:propfind>`;

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (tagName) => tagName === "response" || tagName === "propstat",
});

export function propfindBody(): string {
  return PROPFIND_BODY;
}

export function filenameLikeLiteral(query: string): string {
  const cleaned = query.replace(/[%_\\]/g, "").replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    throw new UserInputError(
      "Search query is empty after removing WebDAV LIKE wildcards (% _ \\). Search matches file names, not file contents.",
    );
  }
  return `%${xmlEscape(cleaned)}%`;
}

export function buildSearchXml(options: {
  username: string;
  path: string;
  likeLiteral: string;
  limit: number;
}): string {
  const user = encodeURIComponent(options.username);
  const scope =
    options.path === "" ? `/files/${user}` : `/files/${user}/${encodeRelativePath(options.path)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:searchrequest xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:basicsearch>
    <d:select>
      <d:prop>
        <d:displayname/>
        <d:getcontenttype/>
        <d:getlastmodified/>
        <d:getcontentlength/>
        <d:resourcetype/>
        <d:getetag/>
        <oc:fileid/>
        <oc:permissions/>
        <oc:size/>
      </d:prop>
    </d:select>
    <d:from>
      <d:scope>
        <d:href>${xmlEscape(scope)}</d:href>
        <d:depth>infinity</d:depth>
      </d:scope>
    </d:from>
    <d:where>
      <d:like>
        <d:prop><d:displayname/></d:prop>
        <d:literal>${options.likeLiteral}</d:literal>
      </d:like>
    </d:where>
    <d:orderby>
      <d:order>
        <d:prop><d:displayname/></d:prop>
        <d:ascending/>
      </d:order>
    </d:orderby>
    <d:limit><d:nresults>${options.limit}</d:nresults></d:limit>
  </d:basicsearch>
</d:searchrequest>`;
}

export function parseMultiStatus(xml: string, username: string): FileInfo[] {
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch (cause) {
    throw new Error("Nextcloud returned XML that could not be parsed.", { cause });
  }
  const root = asRecord(document);
  const multistatus = asRecord(root?.multistatus);
  if (!multistatus) {
    throw new Error("Nextcloud response did not contain a WebDAV multistatus document.");
  }
  const entries: FileInfo[] = [];
  for (const response of asArray(multistatus.response)) {
    const node = asRecord(response);
    if (!node) {
      continue;
    }
    const topStatus = textOf(node.status);
    if (topStatus?.includes("404")) {
      continue;
    }
    const props = successfulProps(node);
    if (!props) {
      continue;
    }
    const href = textOf(node.href);
    if (!href) {
      continue;
    }
    const path = relativePathFromHref(href, username);
    entries.push(toFileInfo(path, props));
  }
  return entries;
}

export function relativePathFromHref(href: string, username: string): string {
  let pathname = href.trim();
  if (pathname.startsWith("http://") || pathname.startsWith("https://")) {
    pathname = new URL(pathname).pathname;
  }
  const decoded = decodeHref(pathname);
  const marker = `/dav/files/${username}/`;
  const index = decoded.indexOf(marker);
  if (index === -1) {
    const root = `/dav/files/${username}`;
    if (decoded.endsWith(root) || decoded.endsWith(`${root}/`)) {
      return "";
    }
    throw new PathError("WebDAV href is outside the signed-in user's files.");
  }
  return normalizeNextcloudPath(decoded.slice(index + marker.length));
}

export function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toFileInfo(path: string, props: Record<string, unknown>): FileInfo {
  const display = textOf(props.displayname);
  const name = display && display.length > 0 ? display : (path.split("/").at(-1) ?? "");
  const length = numberOf(props.getcontentlength);
  const size = numberOf(props.size) ?? length;
  return {
    path,
    name: path === "" ? "" : name,
    isDirectory: isCollection(props.resourcetype) || textOf(props.getcontenttype) === "httpd/unix-directory",
    size,
    contentType: textOf(props.getcontenttype),
    lastModified: textOf(props.getlastmodified),
    etag: stripQuotes(textOf(props.getetag)),
    fileId: textOf(props.fileid),
    permissions: textOf(props.permissions),
  };
}

function successfulProps(response: Record<string, unknown>): Record<string, unknown> | null {
  for (const item of asArray(response.propstat)) {
    const propstat = asRecord(item);
    if (!propstat) {
      continue;
    }
    const status = textOf(propstat.status) ?? "";
    if (!status.includes("200")) {
      continue;
    }
    return asRecord(propstat.prop) ?? {};
  }
  return null;
}

function isCollection(resourceType: unknown): boolean {
  const record = asRecord(resourceType);
  return record !== null && "collection" in record;
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function stripQuotes(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function decodeHref(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    throw new PathError("WebDAV href contains invalid percent-encoding.");
  }
}
