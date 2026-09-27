import * as z from "zod/v4";
import { isFilesRoot, normalizeNextcloudPath } from "../paths.js";
import { UserInputError } from "../errors.js";
import { toolJson } from "../tool-result.js";
import { defineCapability } from "./types.js";

const inputSchema = z.object({
  path: z.string().describe("File or folder path relative to the Nextcloud files root."),
  confirm: z.boolean().describe("Must be true. The tool refuses to delete otherwise."),
  recursive: z
    .boolean()
    .optional()
    .describe("Must be true to delete a folder. Nextcloud DELETE on a folder removes everything inside it."),
});

export const deletePath = defineCapability({
  name: "delete",
  title: "Delete file or folder",
  description:
    "Delete one file or one folder. Requires confirm: true. Deleting a folder also requires recursive: true because Nextcloud removes the folder's contents. Refuses the files root. There is no recursive account wipe and no multi-path delete.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async handle(input, ctx) {
    if (input.confirm !== true) {
      throw new UserInputError("Refusing to delete without confirm: true.");
    }
    const path = normalizeNextcloudPath(input.path);
    if (isFilesRoot(path)) {
      throw new UserInputError("Refusing to delete the Nextcloud files root.");
    }
    const info = await ctx.client.stat(path);
    if (info.isDirectory && input.recursive !== true) {
      throw new UserInputError(
        `Refusing to delete folder ${path}. Nextcloud DELETE removes the folder and everything inside it. Pass confirm: true and recursive: true to delete this one folder.`,
      );
    }
    await ctx.client.delete(path);
    return toolJson({ deleted: true, path, wasDirectory: info.isDirectory });
  },
});
