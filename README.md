# AI Control

A self-hosted dashboard for keeping track of your local Codex and Claude Code sessions from a browser or phone.

> **Disclaimer:** a hobby project shared as is under the [MIT License](LICENSE). It is just a way to keep track of your agents; use it if you want, at your own risk. The authors take no responsibility for anything it does or fails to do, including answers, approvals and messages sent to your agents, changes to your Claude settings, or exposed data. Not affiliated with OpenAI, Anthropic, or the owners of *Alien* or *Command & Conquer*.

## Features

- **Overview:** all running Codex and Claude Code sessions, grouped by project or as one flat list, sorted by needs input → working → idle, with live status, the latest message, search and an agent filter.
- **History:** recent user and assistant messages per session, rendered as safe Markdown.
- **Questions and permissions:** answer Claude permission requests and `AskUserQuestion` prompts, and Codex command/file approvals, permission requests, questions and simple MCP forms. The terminal stays usable; whichever answers first wins. Nothing is ever auto-approved.
- **Send messages:** start or steer Codex turns, and type into Claude sessions running in tmux (with the local inbox as fallback). Manage Codex's queued messages.
- **Subagents:** Claude subagents and workflow workers nested under their session, with one line per tool call, read-only.
- **Usage limits:** Codex and Claude five-hour and weekly usage with reset times, refreshed every five minutes.
- **Themes:** Orbit (auto, light or dark), MU/TH/UR (an *Alien*-style ship computer) and EVA (a *Command & Conquer*-style command console). A picker asks on first visit.
- **Access:** this computer only, or your other devices over Tailscale with HTTPS or HTTP. PIN or password login, ten-minute idle lock, CSRF protection and login rate limits.
- **Phone friendly:** responsive layout, numeric PIN keyboard, working Back button.

## More is more

A dashboard you watch all day should be fun to look at. MU/TH/UR and EVA go all in: boot sequences, CRT scanlines, typed-out text, radar contacts that blip when a session changes status, hazard stripes, and a power bar fed by your usage limits. Orbit is the calm option. The effects stay lightweight, never block a control, and switch off when your system asks for reduced motion.

## Screenshots

![Orbit light: session overview](docs/screenshots/orbit-light-overview.webp)

| MU/TH/UR | EVA |
| --- | --- |
| ![MU/TH/UR: session overview with radar](docs/screenshots/mother-overview.webp) | ![EVA: session overview with globe radar and power bar](docs/screenshots/eva-overview.webp) |
| ![MU/TH/UR: subagent history with tool calls](docs/screenshots/mother-subagent.webp) | ![EVA: Claude permission request](docs/screenshots/eva-permission.webp) |

| Orbit dark | First visit |
| --- | --- |
| ![Orbit dark: Codex command approval](docs/screenshots/orbit-dark-approval.webp) | ![Theme picker](docs/screenshots/theme-picker.webp) |

| Phone: Orbit | Phone: MU/TH/UR | Phone: EVA |
| --- | --- | --- |
| <img src="docs/screenshots/orbit-phone-table.webp" width="260" alt="Orbit on a phone: Markdown table as cards"> | <img src="docs/screenshots/mother-phone-question.webp" width="260" alt="MU/TH/UR on a phone: answering a question"> | <img src="docs/screenshots/eva-phone.webp" width="260" alt="EVA on a phone: session overview"> |

All data is fake, from `npm run demo`: a dashboard with made-up projects, sessions, subagents, requests and usage on `http://127.0.0.1:47842` (PIN `1234`). It runs beside a normal server and connects to no agents.

## Dashboard

Click anywhere on a session card to open its history and controls. The **…** menu beside search holds the agent filter and the **By project** / **Flat list** grouping; the flat list labels each card with its project. Details show up to six recent user/assistant messages and a composer for connected Codex sessions and Claude sessions running in tmux (or, failing that, with a local inbox). Provider icons identify sessions without repeating provider names on each card. Both the visible Back button and the phone/browser Back button return to the overview.

The theme menu switches between **Orbit** (auto, light or dark; auto follows the system), **MU/TH/UR** (Alien-style ship computer) and **EVA** (Command & Conquer-style command console). Alien uses a MU/TH/UR-style phosphor terminal, octagonal display, amber console lamps and CRT scanlines, based on [the 1979 film's displays](https://typesetinthefuture.com/2014/12/01/alien/). C&C uses the [original game's](https://www.mobygames.com/game/338/command-conquer/screenshots/) right-hand steel sidebar, pixel terrain radar, square production buttons and inset counters. Both sidebar displays map actual sessions; click a contact to open it. EVA's power bar shows each account's five-hour usage. Decorative motion respects reduced motion and never blocks controls. The first visit shows a theme picker; MU/TH/UR is the fallback. Only the theme and grouping preferences are saved in local storage. Markdown tables become labeled row cards on phones.

Account usage appears above the session list in one compact row per provider: icon, `5h`/`w` bars and percentages, the five-hour reset clock time in the browser's local timezone, and weekly resets in days. Update details live in icon tooltips; additional model windows scroll horizontally. Session filters do not affect usage. Usage loads at server startup (Codex loads when connected) and refreshes every five minutes, shared by all tabs. Failed refreshes retain values marked stale; passed resets show `due` until refreshed. Missing windows are not shown as zero usage.

Codex usage comes from [`account/rateLimits/read`](https://learn.chatgpt.com/docs/app-server), including separately metered model buckets where available. Claude usage uses the installed CLI's `https://api.anthropic.com/api/oauth/usage` endpoint and reads its existing login from `~/.claude/.credentials.json` (or `CLAUDE_CONFIG_DIR`) on each poll. That endpoint is an internal CLI interface and can change. Credentials stay on the backend, are never included in snapshots, and are not rewritten or renewed by this app. An expired or unsupported login shows an unavailable message; open Claude Code to renew an expired login. API-key-only accounts may not report subscription windows. 

Projects and sessions sort by **needs input → working → idle**. Within a status, the session that entered it most recently comes first, and activity inside a status never reshuffles the list: cards move only when their status changes. Finishing work puts the session at the top of the idle group. Equal times use a stable order, and refreshing the page retains these times in this tab without storing message contents.

## Start

Requires Linux, Node 22.12+, `tmux` and `ss`. Tailscale is optional.

```sh
npm ci
npm start
```

The first run detects Tailscale and asks whether your other Tailscale devices should reach the dashboard, and which HTTPS certificate to use (see [Network and login](#network-and-login)). Without Tailscale it runs locally. The answers are saved in `.local/config.json`; change them with `npm run setup`. It then asks you to choose a 4–8 digit PIN or a password with at least 12 characters, stores a salted scrypt hash, connects the Claude hooks (editing `~/.claude/settings.json`, with a backup in `.local/`), and launches Vite and the backend in a detached **`aiControl`** tmux session. Subsequent runs reuse that session. `npm start` prints the dashboard URL.

AI Control uses port **47841**. Startup checks all listening TCP addresses and refuses to launch if that port is already occupied; it never switches ports silently.

```sh
npm run attach             # View the server in tmux; Ctrl-B then D detaches
npm stop                   # Stop only this server
npm restart                # Full restart (backend edits already auto-restart)
npm run password           # Choose a PIN/password and invalidate existing logins
npm run setup              # Choose Tailscale or local mode and the certificate
npm run demo               # Fake data for screenshots on port 47842
npm run connect:claude     # Reinstall only AI Control's hooks
npm run disconnect:claude  # Remove only AI Control's hooks
```

The server runs under `node --watch`: edits in `server/` or `scripts/server.mjs` restart it automatically, and logins survive the restart. Refresh the browser for client changes. `npm restart` is only needed after changing `scripts/start.mjs` or the hook installer.

You can also choose a PIN from the **PIN** button in the dashboard. Enter your current credential and your chosen PIN twice. Saving locks all browser sessions; log in again with the PIN. PIN login uses the phone's numeric keyboard and retains the same attempt limits as passwords.

`npm run dev:local` starts the same tmux session in local mode regardless of the saved setting, on `http://127.0.0.1:47841` or `http://localhost:47841`, with password protection. Stop an existing session before switching modes. This mode is accessible only from this computer.

## Network and login

Tailscale mode binds to this machine's Tailscale IPv4 address from `tailscale status`, and rejects any address outside Tailscale's `100.64.0.0/10` range. Local mode binds to `127.0.0.1`. It never listens on a LAN or wildcard address.

With a certificate, the dashboard uses HTTPS on this machine's MagicDNS name; an expired or mismatched certificate prevents startup. Enable HTTPS certificates in the Tailscale admin console, then run `tailscale cert --cert-file .local/<host>.crt --key-file .local/<host>.key <host>`; setup finds certificates there. On Linux, `sudo tailscale set --operator=$USER` lets that command run without sudo. Certificates last 90 days; rerun the same command to renew. Without a certificate the dashboard uses plain HTTP over Tailscale: WireGuard still encrypts traffic between devices, but cookies are not marked Secure. No Tailscale Serve or Funnel configuration is changed.

The dashboard stays unlocked across refreshes and brief trips to other apps, and locks after ten minutes without interaction. Mouse/touch interaction, scrolling and typing renew the idle window; page loads and status polling do not. The server enforces the same ten-minute timeout, including while the phone is asleep. You can also lock immediately with **Lock**. Cookies are Secure, HttpOnly and SameSite=Strict under HTTPS; requests that change state require both the exact origin and a session CSRF token. Five unsuccessful password attempts from one address trigger a 15-minute limit.

Session data, account usage and decisions are available only after login. Vite serves the `client/` directory; server code, credentials, certificates and runtime files are excluded. The browser loads no third-party scripts, fonts or services. Claude usage requests run only on the backend.

## Agent integration

**Codex:** connects directly over WebSocket to `~/.codex/app-server-control/app-server-control.sock` (respecting `CODEX_HOME` when set). The socket requires an HTTP Upgrade handshake and WebSocket frames; `codex app-server proxy` is a raw byte tunnel, not a JSONL bridge. It enumerates loaded threads, rejoins them without configuration overrides, and listens for status changes and server requests. It does not launch a second daemon or intentionally load historical conversations. Command/file approvals, requested permissions, user-input questions and simple MCP forms are supported. Permission grants apply once or for the current turn; the UI never offers broad persistent approval. A response is reported delivered after the daemon confirms resolution. Requests resolved in another client disappear here. The adapter retries dropped connections every five seconds, replaces sockets when RPCs stop responding for ten seconds, and rejoins loaded sessions. It reports connection errors in the dashboard and server log. History uses ten-item pages, unused streaming notifications are suppressed, and the WebSocket message limit is 256 MiB to accommodate image-bearing tool results without the previous 32 MiB reconnect loop. Only text is shown in conversation history; unconfirmed messages are never automatically replayed after reconnecting.

**Sending messages:** **Send** behaves like Enter in the Codex CLI: it starts a turn when idle and joins the current work when busy. Active messages use Codex's native `turn/steer` API with the current turn ID; new turns use `turn/start`. Codex handles when the agent picks up the added input. Model, working folder and permission settings are preserved, and sending does not answer pending questions or grant approvals. Enter inserts a line break and Ctrl/Command+Enter submits. Text is limited to 12,000 characters. If a turn changes during delivery, AI Control rechecks it after an explicit rejection; an unconfirmed delivery is never blindly retried.

**Previously queued messages:** the pending list still shows Codex's persistent queue. For messages queued through AI Control, **Edit & send** removes the queued copy and places its text in the empty composer; press **Send** to join current work. **Remove** discards a queued message. Older queued messages otherwise retain their previous behavior: AI Control starts its entries in order when idle with no unanswered permission/question. Entries from another client stay under that client's control. New messages from the composer no longer enter this queue. Queue contents remain with Codex across a dashboard restart.

Submissions use stable client IDs and duplicate clicks/retries are deduplicated in the running server. Delivery timeouts are shown as unconfirmed and are not automatically retried. Check the conversation or queue before submitting a new copy. The message endpoints require the same login, exact origin and CSRF token as approval responses. Drafts stay in browser memory and are cleared when locking. Claude sends are typed into the session's tmux pane, described below. Its question and approval forms remain available through the hooks.

This adapter targets the installed Codex protocol, whose schema was inspected with `codex app-server generate-ts --experimental`. Older daemons or independent Codex runtimes with different control sockets are not covered by this first version. Complex MCP forms and prompts that are not replayed to this connection remain in the original client; the dashboard says so rather than inventing a usable action.

**Claude messages:** for a session started inside tmux (its registration records the pane), the text is pasted into that pane as one bracketed paste followed by Enter, exactly like typing it: Claude receives it as your prompt, queued like terminal input while it works. Before typing, AI Control checks that the pane still hosts that Claude process, strips control characters, leaves copy mode, and refuses while Claude shows a dialog (session status other than idle/busy) or a request is pending here. A failure after pasting is reported as unconfirmed and never retyped. Sessions outside tmux fall back to the local inbox socket; Claude then sees the text as a message from another session, not from you, so prefer running Claude in tmux.

**Claude Code:** discovers running sessions from `~/.claude/sessions`, verifying PID and process start time to exclude old records. `npm start` merges AI Control's command hooks into `~/.claude/settings.json`, preserving other settings and keeping a backup in `.local/`. Existing sessions may need to review the hooks with `/hooks` or restart before responses can be handled here. Session titles prefer saved custom titles, then an explicitly user-set name, then Claude’s generated `ai-title`, then its registered fallback name. Titles are read from bounded transcript windows and cached while the server is running. A session without hooks can still send through an available local inbox; answering questions and permissions requires hooks.

The hooks send lifecycle events and pending requests through an owner-only Unix socket. `PermissionRequest` hooks run alongside Claude's own dialog, and whichever answers first wins: permissions get allow/deny, and `AskUserQuestion` gets the selected or free-text answers added to its input. The terminal dialog stays usable the whole time; answering there removes the request here. Requests stay answerable here for up to 24 hours. If AI Control is stopped or the hook fails, the terminal dialog simply remains. It never defaults to approval. (Earlier versions used a blocking `PreToolUse` hook for questions; it is removed on install and answered instantly with no decision if an old session still has it.) Claude sandbox-network dialogs and other interaction types that do not expose a supported decision hook must be answered in the original client. Plain conversational questions are not turned into chat inputs.

The integrations follow the [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server), [Claude Code hook reference](https://code.claude.com/docs/en/hooks) and [Claude inbox documentation](https://code.claude.com/docs/en/cross-session-messaging#the-sessions-inbox-socket).

Claude subagents appear as nested cards under their session, read from `<session>/subagents/agent-*.jsonl` and its `.meta.json` (description, agent type); workflow workers come from `subagents/workflows/<run>/` and carry a **Workflow** tag (tooltip: workflow name · phase). A running workflow's name is read once from its launch result in the session transcript; a finished one's from `workflows/<run>.json`. Their history pins the task (workflow harness preface removed), then text replies and one line per tool call, labelled by the call's own description with the raw command or full path in the tooltip; workflow workers write almost no text, so these lines are their main record. A subagent counts as working while its latest step is a tool call (up to 30 minutes without output) or it wrote within the last minute; finished subagents stay listed for 30 minutes. They are read-only.

Recent Codex messages come from paginated `thread/items/list` responses. Recent Claude messages come from bounded, cached reads of the session's transcript under `~/.claude/projects`. Only user and assistant text is included; tool output, internal reasoning and metadata are excluded. Claude inbox messages submitted through this running dashboard are included once their matching UUID appears in the transcript. Details render Markdown headings, emphasis, lists, quotes, links, tables and code. Raw HTML stays literal, embedded images show their alt text, and only absolute HTTP(S) and mail links are clickable. Long messages expand between complete Markdown blocks and are capped at 12,000 characters. Message access uses the same authentication as session status.

The session view uses a full-height flex layout: compact header, history filling the remaining space, and pending questions or permissions below it. An open request hides the composer and can occupy the entire area below the header. Short requests leave the remaining history visible; oversized requests scroll as one pane rather than several small inner boxes. History opens at the latest message and follows incoming messages while you are at the bottom. Scrolling up pauses following and preserves your reading position during updates. **Latest messages** returns to the bottom and resumes following. Permission requests show the reason, command, working folder, requested access and affected files, with expandable diffs and technical details.

## Files and verification

- `.local/auth.json`: password verifier, mode 0600; `.local/` is mode 0700.
- `.local/config.json`: mode and certificate paths chosen by `npm run setup`.
- `.local/logins.json`: dashboard logins saved at shutdown so restarts keep you signed in (token hashes only), mode 0600.
- `.local/server.log`: startup/server output, also visible in tmux.
- `.local/decisions.jsonl`: decision audit records containing IDs, timestamps and decision type; question answers and prompt contents are not logged.
- `.local/claude-settings-*.backup.json`: backups made before changing Claude settings.
- `client/`: responsive dashboard and login page.
- `client/vendor/marked/`: bundled Marked 13.0.3 ESM build with its MIT license; only the source-map reference was removed. No CDN is needed at runtime.
- `client/public/fonts/`: VT323, Josefin Slab and Black Ops One from Google Fonts, served locally under the SIL Open Font License (`OFL.txt`).
- `scripts/demo.mjs`: the fake data behind `npm run demo`.
- `server/`: authentication, HTTP handlers and agent adapters.

```sh
npm test
npm run build
```

Automated checks cover authentication, PIN changes, CSRF, expiration, reopening the page, duplicate/stale answers, Claude hook response flow, hook-config preservation, stale process filtering, message filtering and transcript path limits, stable session ordering, Back/Forward navigation, theme persistence, mobile table structure, safe Markdown, Claude title precedence, local inbox validation, send deduplication and Tailscale address validation. Codex tests exercise real HTTP upgrade and masked WebSocket frames on in-memory streams with a simulated daemon, including large tool results, history pagination, dropped and unresponsive connections, restored questions, stale socket events, shutdown during retry, native steering, turn changes during delivery, sending, queue order, cancellation, permission blocking and ambiguous delivery failures across reconnects. These tests do not send messages to real sessions or approve real work.

Usage tests cover five-minute scheduling, shared and overlapping reads, provider window formats, separate model buckets, unavailable or expired credentials, rotated Claude tokens, throttling, stale data, reset countdowns, account changes, and Codex reconnects. Usage read errors/timeouts do not interrupt session controls.

Review `.local/server.log` if startup fails. The runtime prerequisites are `tmux`, `ss`, Codex and/or Claude Code, and, for access from other devices, a running Tailscale daemon.
