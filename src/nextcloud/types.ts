import type { Readable, Writable } from "node:stream";

export interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number | null;
  contentType: string | null;
  lastModified: string | null;
  etag: string | null;
  fileId: string | null;
  permissions: string | null;
}

export interface FileBody {
  bytes: Uint8Array;
  contentType: string | null;
  byteLength: number;
}

export interface WriteOptions {
  contentType: string;
  overwrite: boolean;
  parents: boolean;
}

/** Local file opened only after size, path, and overwrite checks succeed. */
export interface StreamingUpload {
  byteLength: number;
  open(): Readable;
}

/** Inline bytes for write_file, or a host file stream for upload_file. */
export type WriteBody = Uint8Array | StreamingUpload;

export interface DownloadedFile {
  contentType: string | null;
  byteLength: number;
}

export interface ShareLinkRequest {
  path: string;
  permissions: number;
  password?: string;
  expireDate?: string;
  label?: string;
}

export interface ShareLink {
  id: number;
  url: string;
  token: string | null;
  path: string;
  permissions: number | null;
  expiration: string | null;
}

export interface SearchRequest {
  query: string;
  path: string;
  limit: number;
}

export interface NextcloudFiles {
  listDirectory(path: string): Promise<FileInfo[]>;
  stat(path: string): Promise<FileInfo>;
  readFile(path: string, maxBytes: number): Promise<FileBody>;
  /** Stream a WebDAV GET to a host writable. Refuses bodies over maxBytes instead of truncating. */
  downloadFile(path: string, maxBytes: number, destination: Writable): Promise<DownloadedFile>;
  writeFile(path: string, body: WriteBody, options: WriteOptions): Promise<void>;
  mkdir(path: string, parents: boolean): Promise<void>;
  move(from: string, to: string, overwrite: boolean): Promise<void>;
  delete(path: string): Promise<void>;
  createShareLink(input: ShareLinkRequest): Promise<ShareLink>;
  search(input: SearchRequest): Promise<FileInfo[]>;
}
