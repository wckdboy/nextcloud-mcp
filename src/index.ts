#!/usr/bin/env node
import dotenv from "dotenv";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { isDirectRun } from "./direct-run.js";
import { startHttpServer } from "./http.js";
import { createNextcloudClient } from "./nextcloud/client.js";
import { createNextcloudMcpServer } from "./server.js";

const HELP = `nextcloud-mcp

Environment:
  NEXTCLOUD_URL            Base URL, no trailing slash required
  NEXTCLOUD_USERNAME       Nextcloud user id
  NEXTCLOUD_APP_PASSWORD   App token (Settings → Security → Devices & sessions)

Commands:
  nextcloud-mcp            stdio MCP (default)
  nextcloud-mcp --http     Streamable HTTP on 127.0.0.1:8787/mcp
`;

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.error(HELP);
    return;
  }
  const config = loadConfig(env);
  const client = createNextcloudClient(config);
  if (argv.includes("--http")) {
    await startHttpServer(config, client);
    return;
  }
  console.error("nextcloud-mcp listening on stdio");
  serveStdio(() => createNextcloudMcpServer(client, config.limits));
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  dotenv.config({ quiet: true });
  main(process.argv, process.env).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Failed to start nextcloud-mcp";
    console.error(message);
    process.exitCode = 1;
  });
}
