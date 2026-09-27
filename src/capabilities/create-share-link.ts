import * as z from "zod/v4";
import { UserInputError } from "../errors.js";
import { isFilesRoot, normalizeNextcloudPath } from "../paths.js";
import { toolJson } from "../tool-result.js";
import { defineCapability } from "./types.js";

const inputSchema = z.object({
  path: z.string().describe("File or folder to share, relative to the files root. The files root itself is refused."),
  permissions: z
    .number()
    .int()
    .min(1)
    .max(31)
    .optional()
    .describe("Bit mask. 1 read, 2 update, 4 create, 8 delete, 16 share. Default 1 (read)."),
  password: z.string().optional().describe("Optional password for the public link. Not echoed back."),
  expireDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Optional expiry date YYYY-MM-DD."),
  label: z.string().max(255).optional().describe("Optional label stored on the share."),
});

export const createShareLink = defineCapability({
  name: "create_share_link",
  title: "Create share link",
  description:
    "Create a public Nextcloud share link via the OCS Share API (shareType 3). Default permission is read-only. Does not send email. The password is not included in the result. Some Nextcloud versions rewrite link permissions on create; the result reports the permissions the server stored.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async handle(input, ctx) {
    if (input.expireDate !== undefined && !isRealIsoDate(input.expireDate)) {
      throw new UserInputError("expireDate must be a real calendar date in YYYY-MM-DD form.");
    }
    const path = normalizeNextcloudPath(input.path);
    if (isFilesRoot(path)) {
      throw new UserInputError("Refusing to create a public link for the files root. Pass a specific file or folder.");
    }
    const share = await ctx.client.createShareLink({
      path,
      permissions: input.permissions ?? 1,
      ...(input.password === undefined ? {} : { password: input.password }),
      ...(input.expireDate === undefined ? {} : { expireDate: input.expireDate }),
      ...(input.label === undefined ? {} : { label: input.label }),
    });
    return toolJson({
      id: share.id,
      url: share.url,
      path: share.path,
      permissions: share.permissions,
      expiration: share.expiration,
    });
  },
});

function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
