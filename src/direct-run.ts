import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * True when `moduleUrl` is this process's entry script.
 * Package bins are symlinks (`node_modules/.bin/nextcloud-mcp` → `dist/index.js`).
 * `import.meta.url` is the real file, so the argv path has to be resolved first.
 */
export function isDirectRun(moduleUrl: string, entry: string | undefined): boolean {
  if (!entry) {
    return false;
  }
  try {
    return moduleUrl === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return moduleUrl === pathToFileURL(entry).href;
  }
}
