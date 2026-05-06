# Higgsfield token scripts

Two parallel auth flows live in this directory. They both produce a bearer
`access_token`, but they hit **different** Higgsfield auth servers, target
different APIs, and save to **different** files so the two tokens coexist:

| Flow | Save file |
|---|---|
| Device flow (Plan B, official-CLI-style) | `.higgsfield-token-device.json` |
| Clerk/PKCE flow (Plan A, MCP server) | `.higgsfield-token.json` |

Both files land in whatever directory you run the script from.

## Which script do I run?

| Goal | Script |
|---|---|
| First-time setup with Higgsfield's own device-flow auth (Plan B, mirrors the official `higgsfield` CLI) | `node scripts/get-higgsfield-token-device.mjs` |
| Refresh an existing device-flow token without re-doing the browser dance | `node scripts/refresh-higgsfield-token-device.mjs` |
| First-time setup with the original Clerk-backed PKCE flow against the MCP server (Plan A) | `node scripts/get-higgsfield-token.mjs` |
| Refresh a Clerk/PKCE token | `node scripts/refresh-higgsfield-token.mjs` |

Each refresh script only touches its matching file (the device-flow refresh
reads/writes `.higgsfield-token-device.json`; the PKCE refresh reads/writes
`.higgsfield-token.json`). The device-flow refresh also checks for a
`flow="device"` marker in the JSON and bails clearly if you somehow point it
at the wrong file.

## Quick start (device flow — Plan B)

```bash
# 1. Bootstrap a token interactively. A browser window opens; approve it.
node scripts/get-higgsfield-token-device.mjs

# 2. The script prints the access_token at the end. Copy it into
#    Railway → Variables → HIGGSFIELD_TOKEN, then redeploy.

# 3. When the access_token expires, refresh without redoing the browser dance:
node scripts/refresh-higgsfield-token-device.mjs

# 4. Update Railway with the new access_token from the file (or from the
#    script's stdout — it prints it for you).
```

## Token lifetimes

The exact numbers come from the server response (saved as `expires_in` and
`refresh_expires_in` in `.higgsfield-token-device.json` — also as ISO timestamps
in `expires_at` and `refresh_expires_at`). In practice for the device flow:

- **`access_token`**: short — typically an hour or less. Refresh it via the
  refresh script, no browser needed.
- **`refresh_token`**: long-lived. Once it expires or is revoked, you must
  redo the full device flow. The refresh script detects this and prints
  exactly that instruction.

## Updating Railway

Both scripts print the full `access_token` between two horizontal rules at
the end so you can copy it directly. Paste it into:

  **Railway** → your service → **Variables** → `HIGGSFIELD_TOKEN`

Trigger a redeploy if Railway doesn't do it automatically.

## Troubleshooting

**`/authorize failed: HTTP 5xx`** — Higgsfield's device-auth server
(`fnf-device-auth.higgsfield.ai`) is down. Try again in a minute. Confirm by
hitting `https://fnf-device-auth.higgsfield.ai/health` in a browser; you
should see `null`.

**`device_code expired or never existed`** — you waited too long in the
browser, or restarted the script while one was already running. Just re-run
`get-higgsfield-token-device.mjs` to start a fresh session.

**`User denied authorization in the browser`** — you clicked "deny" or
closed the tab without approving. Re-run if it was an accident.

**`Timed out waiting for browser approval`** — the script waits 15 minutes
max. Re-run and approve faster, or copy the URL from the terminal if your
browser didn't open automatically.

**`Refresh failed: refresh_token is invalid, expired, or revoked`** — your
saved refresh token is dead. Run `get-higgsfield-token-device.mjs` for a
fresh device flow.

**`File was not created by get-higgsfield-token-device.mjs (flow="...")`** —
something other than the device-flow bootstrap wrote to
`.higgsfield-token-device.json`. The device-flow refresh script refuses to
touch it. Delete the file and re-run `get-higgsfield-token-device.mjs` to
recreate it cleanly.

**Browser doesn't open automatically** — that's fine. The script prints the
URL right above the polling line; copy and paste it into your browser. The
poll loop doesn't care how you reach the verification page.

## Security

- Both `.higgsfield-token-device.json` and `.higgsfield-token.json` contain
  bearer access tokens AND long-lived refresh tokens. Treat all of them as
  secrets.
- The repo's root `.gitignore` covers both filenames explicitly. Verify with
  `git check-ignore -v .higgsfield-token-device.json` (or the PKCE one) if
  in doubt.
- Files are written with `0o600` permissions (POSIX) — owner read/write only.
  On Windows the chmod is a no-op but the file still lives in your user
  profile, not anywhere world-readable.
- Never paste the file contents into a Slack channel, GitHub issue, or Railway
  build log. The scripts only echo a 24-character prefix when describing
  what was saved; the full access_token is printed only at the very end as a
  copy-target for Railway.
