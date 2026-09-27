import * as z from "zod/v4";
import { normalizeNextcloudPath } from "../paths.js";
import { toolJson } from "../tool-result.js";
import { defineCapability } from "./types.js";

const inputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe("Folder path relative to the Nextcloud files root. Omit or pass an empty string for the root."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Maximum entries to return. Default 200."),
});

export const listDirectory = defineCapability({
  name: "list_directory",
  title: "List directory",
  description:
    "List the immediate children of a folder in the signed-in user's Nextcloud files. Not recursive. path is relative to the files root.",
  inputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async handle(input, ctx) {
    const path = normalizeNextcloudPath(input.path ?? "");
    const limit = input.limit ?? 200;
    const entries = await ctx.client.listDirectory(path);
    return toolJson({
      path,
      entries: entries.slice(0, limit),
      truncated: entries.length > limit,
    });
  },
});
