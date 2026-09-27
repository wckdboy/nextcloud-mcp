import { McpServer } from "@modelcontextprotocol/server";
import type { Limits } from "./config.js";
import { capabilities } from "./capabilities/index.js";
import type { ToolContext } from "./capabilities/types.js";
import type { NextcloudFiles } from "./nextcloud/types.js";
import { VERSION } from "./version.js";

const INSTRUCTIONS = [
  "Nextcloud file tools for the signed-in user.",
  "Paths are relative to that user's files root. Empty path is the root.",
  "delete requires confirm true, and folder delete also requires recursive true, because Nextcloud folder DELETE removes everything inside that one folder.",
  "The files root cannot be deleted. There is no multi-path or account wipe.",
  "search matches file names only, not file contents.",
  "Authentication is already configured with an app password. Do not ask for the Nextcloud account password or the app password.",
  "Do not put passwords or tokens into tool arguments except the optional share-link password.",
].join(" ");

export function createNextcloudMcpServer(client: NextcloudFiles, limits: Limits): McpServer {
  const server = new McpServer(
    { name: "nextcloud-mcp", version: VERSION },
    { instructions: INSTRUCTIONS },
  );
  const ctx: ToolContext = { client, limits };
  for (const capability of capabilities) {
    capability.register(server, ctx);
  }
  return server;
}
