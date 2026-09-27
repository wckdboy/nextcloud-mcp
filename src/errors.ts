export class ConfigError extends Error {
  readonly missing: readonly string[];

  constructor(message: string, missing: readonly string[] = []) {
    super(message);
    this.name = "ConfigError";
    this.missing = missing;
  }
}

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

export type FileSizeLimit = "read" | "download";

export class FileTooLargeError extends Error {
  readonly size: number | null;
  readonly maxBytes: number;

  constructor(size: number | null, maxBytes: number, limit: FileSizeLimit = "read") {
    super(fileTooLargeMessage(size, maxBytes, limit));
    this.name = "FileTooLargeError";
    this.size = size;
    this.maxBytes = maxBytes;
  }
}

function fileTooLargeMessage(size: number | null, maxBytes: number, limit: FileSizeLimit): string {
  switch (limit) {
    case "read": {
      const detail =
        size === null
          ? `File exceeds the read limit of ${maxBytes} bytes.`
          : `File is ${size} bytes, which exceeds the read limit of ${maxBytes} bytes.`;
      return `${detail} Raise NEXTCLOUD_MAX_READ_BYTES (ceiling 8 MiB) or read a smaller file.`;
    }
    case "download": {
      const detail =
        size === null
          ? `File exceeds the download limit of ${maxBytes} bytes.`
          : `File is ${size} bytes, which exceeds the download limit of ${maxBytes} bytes.`;
      return `${detail} The download-to-disk ceiling is NEXTCLOUD_MAX_WRITE_BYTES (hard max 32 MiB). The file was not saved.`;
    }
    default: {
      const unexpected: never = limit;
      return unexpected;
    }
  }
}

export class NextcloudError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;

  constructor(
    message: string,
    options: { status: number; method: string; path: string; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "NextcloudError";
    this.status = options.status;
    this.method = options.method;
    this.path = options.path;
  }
}
