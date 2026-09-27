import { createShareLink } from "./create-share-link.js";
import { deletePath } from "./delete.js";
import { downloadFile } from "./download-file.js";
import { listDirectory } from "./list-directory.js";
import { mkdir } from "./mkdir.js";
import { move } from "./move.js";
import { readFile } from "./read-file.js";
import { searchFiles } from "./search.js";
import { statFile } from "./stat.js";
import type { Capability } from "./types.js";
import { uploadFile } from "./upload-file.js";
import { writeFile } from "./write-file.js";

export const capabilities: readonly Capability[] = [
  listDirectory,
  statFile,
  readFile,
  downloadFile,
  writeFile,
  uploadFile,
  mkdir,
  move,
  deletePath,
  createShareLink,
  searchFiles,
];

export function capabilityByName(name: string): Capability {
  const found = capabilities.find((capability) => capability.name === name);
  if (!found) {
    throw new Error(`Unknown capability: ${name}`);
  }
  return found;
}
