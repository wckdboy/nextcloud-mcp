const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/x-sh",
  "application/x-httpd-php",
  "image/svg+xml",
]);
const BINARY_MIME_PREFIXES = ["audio/", "video/", "font/"];
const BINARY_MIME_EXACT = new Set([
  "application/octet-stream",
  "application/pdf",
  "application/zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/wasm",
  "application/x-7z-compressed",
]);

export function decodeBase64(content: string): Uint8Array {
  const normalized = content.replace(/\s/g, "");
  if (normalized.length === 0 || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("content is not valid base64.");
  }
  return Buffer.from(normalized, "base64");
}

export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function isBinaryPayload(contentType: string | null, bytes: Uint8Array): boolean {
  const mime = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === "image/svg+xml" || mime.endsWith("+json") || mime.endsWith("+xml")) {
    return false;
  }
  if (TEXT_MIME_EXACT.has(mime) || TEXT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    return false;
  }
  if (mime.startsWith("image/") || BINARY_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix)) || BINARY_MIME_EXACT.has(mime)) {
    return true;
  }
  const sample = bytes.subarray(0, 8192);
  return sample.includes(0);
}
