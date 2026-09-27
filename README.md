# nextcloud-mcp

MCP server for one Nextcloud account. Agents list, read, write, create, move, and delete files over WebDAV, create public share links over the OCS Share API, and search file names with WebDAV SEARCH. Credentials stay in environment variables. This repository does not ship secrets.

Nextcloud auth is HTTP Basic with the user id and an **app password** (an app token). The server does not use browser login, session cookies, or Login Flow v2/OAuth.

## Protocols

| Work | Protocol | Endpoint |
| --- | --- | --- |
| List, stat, read, write, mkdir, move, delete | WebDAV | `/remote.php/dav/files/<username>/…` |
| Filename search | WebDAV `SEARCH` | `/remote.php/dav/` |
| Public share link | OCS Share API | `/ocs/v2.php/apps/files_sharing/api/v1/shares` |

OCS is used only for share links, which WebDAV does not create. File bytes and folders never go through the browser or the OCS files API. `delete` requires `confirm: true` (and `recursive: true` for a folder). Paths that contain `..` are rejected before any request.

CI runs mocked WebDAV and OCS responses. It does not call a live Nextcloud, so a LAN-only instance is fine.

The server speaks [stdio](https://modelcontextprotocol.io) for Cursor and Grok Bot, and optional Streamable HTTP (JSON, with SSE when a response streams) for a remote client.

## Tools

| Tool | What it does |
| --- | --- |
| `list_directory` | Immediate children of a folder. Not recursive. |
| `stat` | Metadata for one file or folder (file info). |
| `read_file` | UTF-8 text, or base64 when you ask. Refuses binary text and files over the read limit. |
| `write_file` | Upload a file. Refuses to replace an existing file unless `overwrite` is true. |
| `mkdir` | Create a folder. `parents: true` creates missing ancestors. |
| `move` | Move or rename. `overwrite` defaults to false. |
| `delete` | Delete one path. Requires `confirm: true`. A folder also requires `recursive: true`. |
| `create_share_link` | Public link (OCS `shareType` 3). Default permission is read. |
| `search` | Filename substring via WebDAV SEARCH. Not full-text content search. |

Paths are relative to the signed-in user's files. `""` and `"/"` are the files root. `..`, encoded `..`, backslashes, and URLs are rejected.

`delete` never removes the files root. There is no multi-path delete and no account wipe. Nextcloud's own `DELETE` on a folder removes that folder's contents, so a folder delete stays gated behind `recursive: true`.

`write_file` and `mkdir` accept `parents: true` to create missing parent folders. They do not delete anything to do it.

## Requirements

- Node.js 20 or newer
- A Nextcloud account and an app password

## Install and run locally

```bash
git clone https://github.com/wckdboy/nextcloud-mcp.git
cd nextcloud-mcp
npm ci
npm run build
cp .env.example .env
# edit .env — see below
npm run mcp
```

`npm run mcp` and `npm start` are the stdio server (`node dist/index.js`). A `.env` file in the working directory is loaded for local runs and does not override variables that are already set. MCP hosts should pass the variables themselves.

Check the project without a Nextcloud server:

```bash
npm run typecheck
npm test
npm run build
```

`npm test` uses mocked WebDAV and OCS responses.

## Environment

Required:

| Name | Example | Purpose |
| --- | --- | --- |
| `NEXTCLOUD_URL` | `https://cloud.example.com` | Base URL. A trailing slash is removed. No user, password, query, or fragment. |
| `NEXTCLOUD_USERNAME` | `ada` | Nextcloud user id. |
| `NEXTCLOUD_APP_PASSWORD` | *(app token)* | App password from Settings → Security → Devices & sessions. Not the account password. |

Optional:

| Name | Default | Purpose |
| --- | --- | --- |
| `NEXTCLOUD_MAX_READ_BYTES` | `1048576` | Read ceiling. Hard max `8388608` (8 MiB). Oversized files are refused, not truncated. |
| `NEXTCLOUD_MAX_WRITE_BYTES` | `10485760` | Upload ceiling. Hard max `33554432` (32 MiB). |
| `NEXTCLOUD_TIMEOUT_MS` | `30000` | Per-request timeout. |
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind address for `--http`. |
| `MCP_HTTP_PORT` | `8787` | Bind port for `--http`. |
| `MCP_HTTP_TOKEN` | unset | If set, HTTP requests must send `Authorization: Bearer <token>`. Required when the bind address is not loopback. |
| `MCP_HTTP_ALLOWED_HOSTS` | unset | Comma-separated `Host` names. Required when the bind address is not loopback. |

Copy [`.env.example`](.env.example). Do not commit `.env`.

If any of the three required variables is missing, the process exits before it listens. The error names the missing variables and does not ask for a password.

## Authentication

Every WebDAV call (`/remote.php/dav/files/<user>/…`) and every OCS call sends:

```http
Authorization: Basic base64(NEXTCLOUD_USERNAME:NEXTCLOUD_APP_PASSWORD)
```

`NEXTCLOUD_APP_PASSWORD` is the app token Nextcloud shows once when you create an app password. The server never reads a session cookie, never starts Login Flow v2, and never performs an OAuth login. Redirects are not followed, so a login page cannot become a session.

Do not paste the Nextcloud account password or the app token into chat. Put the app token in the MCP server environment as `NEXTCLOUD_APP_PASSWORD`. Agents should ask only for that secret name if it is unset.

## Create a Nextcloud app password

1. Sign in to Nextcloud in a browser.
2. Open the avatar menu and choose **Personal settings** (or **Settings**).
3. Open **Security**.
4. Find **Devices & sessions** (also labeled **App passwords** on some versions).
5. Type an app name such as `MCP`.
6. Choose **Create new app password**.
7. Copy that app token into `NEXTCLOUD_APP_PASSWORD`. Nextcloud shows it once. This is not your account password.
8. Set `NEXTCLOUD_USERNAME` to the account user id (the id used to sign in, not necessarily the display name).
9. Set `NEXTCLOUD_URL` to the site origin, for example `https://cloud.example.com`. If Nextcloud lives in a subdirectory, include it: `https://cloud.example.com/nextcloud`.

WebDAV is then `NEXTCLOUD_URL/remote.php/dav/files/NEXTCLOUD_USERNAME/`. Share links use `NEXTCLOUD_URL/ocs/v2.php/apps/files_sharing/api/v1/shares`. Both use the same Basic header.

## Cursor

Put this in the user file `~/.cursor/mcp.json`, or in the project file `.cursor/mcp.json` if that file is gitignored. Use an absolute path. Keep the password out of the repository.

```json
{
  "mcpServers": {
    "nextcloud": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/nextcloud-mcp/dist/index.js"],
      "env": {
        "NEXTCLOUD_URL": "https://cloud.example.com",
        "NEXTCLOUD_USERNAME": "your-user-id",
        "NEXTCLOUD_APP_PASSWORD": "your-app-password"
      }
    }
  }
}
```

Secret names: `NEXTCLOUD_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_APP_PASSWORD`.

Reload MCP servers in Cursor after saving. The stdio process is how Cursor launches the server. A URL on your laptop is not required.

From a machine that can `npm install` this public repo, the same server can be started without a local clone:

```json
{
  "mcpServers": {
    "nextcloud": {
      "command": "npx",
      "args": ["-y", "--package", "github:wckdboy/nextcloud-mcp", "nextcloud-mcp"],
      "env": {
        "NEXTCLOUD_URL": "https://cloud.example.com",
        "NEXTCLOUD_USERNAME": "your-user-id",
        "NEXTCLOUD_APP_PASSWORD": "your-app-password"
      }
    }
  }
}
```

`npm` runs `prepare`, which compiles TypeScript, then runs the `nextcloud-mcp` binary.

## Grok Bot

Grok Bot runs the MCP process on its cloud computer. It cannot reach `localhost` on your laptop. Add a **custom** stdio server and store the three secrets on that server entry.

In the bot chat:

```text
Add a custom MCP server called nextcloud that runs:
npx -y --package github:wckdboy/nextcloud-mcp nextcloud-mcp

Set these environment variables on the server entry. Store the values as secrets:
NEXTCLOUD_URL
NEXTCLOUD_USERNAME
NEXTCLOUD_APP_PASSWORD
```

Command: `npx`  
Args: `-y`, `--package`, `github:wckdboy/nextcloud-mcp`, `nextcloud-mcp`  
Secret names: `NEXTCLOUD_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_APP_PASSWORD`

Confirm when the bot repeats the command and the variable names. Store the app token as `NEXTCLOUD_APP_PASSWORD` on that server entry. Do not paste the Nextcloud account password or the app token into the chat. Attach the server with `@` if the bot does not pick it up on its own. A server saved only in Cursor's `mcp.json` is not automatically available in Grok Bot; add it there with the message above.

If the bot's computer already has a built checkout, use command `node` and args `/ABSOLUTE/PATH/nextcloud-mcp/dist/index.js` with the same three variables.

### Grok Build (terminal)

This is the `grok` CLI, not the Grok Bot chat UI. Either form uses the same secret names.

```bash
grok mcp add nextcloud -- \
  npx -y --package github:wckdboy/nextcloud-mcp nextcloud-mcp
```

Then set the variables in `~/.grok/config.toml` so the values can come from your environment:

```toml
[mcp_servers.nextcloud]
command = "npx"
args = ["-y", "--package", "github:wckdboy/nextcloud-mcp", "nextcloud-mcp"]
enabled = true

[mcp_servers.nextcloud.env]
NEXTCLOUD_URL = "${NEXTCLOUD_URL}"
NEXTCLOUD_USERNAME = "${NEXTCLOUD_USERNAME}"
NEXTCLOUD_APP_PASSWORD = "${NEXTCLOUD_APP_PASSWORD}"
```

`grok mcp doctor nextcloud` checks the process. Grok expands `${VAR}` when it loads the file.

### Grok on the web

Custom connectors at [grok.com/connectors](https://grok.com/connectors) need a public HTTPS MCP URL. The stdio command above is the one Grok Bot should run. The HTTP mode below is loopback unless you put it behind your own TLS proxy and set `MCP_HTTP_TOKEN`.

## Optional HTTP

```bash
npm run mcp:http
```

That is `node dist/index.js --http`. The MCP endpoint is `http://127.0.0.1:8787/mcp`. `GET /health` returns `{"ok":true,"name":"nextcloud-mcp"}` and no credentials.

The transport is Streamable HTTP: a normal JSON response, or an SSE stream when the session needs one. On loopback, `Host` and `Origin` are limited to localhost. Set `MCP_HTTP_TOKEN` to require `Authorization: Bearer <token>`.

Binding a non-loopback address also requires `MCP_HTTP_TOKEN` and `MCP_HTTP_ALLOWED_HOSTS` (the hostnames clients send in `Host`).

## Search limits

`search` sends a WebDAV `SEARCH` request (RFC 5323) to `/remote.php/dav/`, scoped to `files/<user>/<folder>` with depth `infinity`. The match is a substring of `displayname` (the file name). It does not search inside file contents. `%`, `_`, and `\` in the query are removed so they are not LIKE wildcards. Results default to 25 and cannot exceed 100. If the server returns HTTP 405 or 501, that instance does not allow WebDAV SEARCH.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # mocked WebDAV and OCS
npm run build       # dist/
npm run check       # typecheck and test
```

CI runs typecheck, test, and build on Node 22. No live Nextcloud.

## License

MIT
