import * as z from "zod/v4";
import { normalizeNextcloudPath } from "../paths.js";
import { toolJson } from "../tool-result.js";
import { defineCapability } from "./types.js";

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe("Filename substring. % _ and \\ are removed so they are not LIKE wildcards. This does not search file contents."),
  path: z
    .string()
    .optional()
    .describe("Folder to search under, relative to the files root. Omit for the whole files tree."),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum results. Default 25."),
});

export const searchFiles = defineCapability({
  name: "search",
  title: "Search file names",
  description:
    "Search file and folder names with Nextcloud WebDAV SEARCH (RFC 5323) on /remote.php/dav/. This is a filename substring match inside one folder scope (default: the user's files), not full-text content search. The server must allow SEARCH. Results are capped.",
  inputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async handle(input, ctx) {
    const limit = input.limit ?? 25;
    const path = normalizeNextcloudPath(input.path ?? "");
    const entries = await ctx.client.search({ query: input.query, path, limit });
    return toolJson({
      query: input.query,
      path,
      entries,
      truncated: entries.length >= limit,
    });
  },
});
