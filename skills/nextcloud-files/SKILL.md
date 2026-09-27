---
name: nextcloud-files
description: Use the Nextcloud file tools for the signed-in user's files. Covers list, stat, read, write, mkdir, move, delete, filename search, and public share links. Use when the user asks to browse, change, or share files on their Nextcloud. Auth is an app token already set on the server.
---

# Nextcloud files

Paths are relative to the signed-in user's files. `""` and `"/"` are the files root. Reject `..`, encoded `..`, backslashes, and URLs before calling a tool.

The server already authenticates with HTTP Basic using `NEXTCLOUD_USERNAME` and an app token (`NEXTCLOUD_APP_PASSWORD` from Settings → Security → Devices & sessions). Do not ask for the Nextcloud account password or the app token. Do not start Login Flow v2, OAuth, or a browser login. Do not put secrets in tool arguments except the optional share-link password.

## Which tool

| Need | Tool |
| --- | --- |
| Immediate children of a folder | `list_directory` (not recursive) |
| Metadata for one file or folder | `stat` |
| File bytes | `read_file` (UTF-8 text; `encoding: "base64"` for binary) |
| Upload or replace a file | `write_file` |
| Create a folder | `mkdir` |
| Rename or move | `move` (`from`, `to`; this is not a copy) |
| Remove one path | `delete` |
| Find a file by name | `search` (filename substring only, not file contents) |
| Public link | `create_share_link` (OCS share type 3) |

`write_file` and `move` refuse to replace an existing path unless `overwrite` is true. `write_file` and `mkdir` create missing parents only when `parents` is true. They do not delete anything to do that.

## Delete

`delete` refuses unless `confirm` is true. A folder also requires `recursive: true`, because Nextcloud `DELETE` on a folder removes everything inside that one folder. The files root cannot be deleted. There is no multi-path delete and no account wipe.

## Share links

`create_share_link` defaults to read permission (`1`). Do not share the files root. The result includes the URL and the permissions the server stored. It does not echo a link password.
