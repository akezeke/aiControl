# AI Control

A self-hosted dashboard for keeping track of your local Codex and Claude Code sessions from a browser or phone.

> **Disclaimer:** a hobby project shared as is under the [MIT License](LICENSE). It is just a way to keep track of your agents; use it at your own risk. The authors take no responsibility for anything it does, including approvals and messages sent to your agents. Not affiliated with OpenAI, Anthropic, or the owners of *Alien* or *Command & Conquer*.

![Orbit light: session overview](docs/screenshots/orbit-light-overview.webp)

## Features

- Every running Codex and Claude Code session, by project or as a flat list, sorted needs input → working → idle.
- Answer Claude and Codex permission requests and questions: allow once, for the session or always, or deny with a reason. Edits show as diffs, plans as Markdown. The terminal stays usable; whichever answers first wins. Nothing is auto-approved.
- Send messages: start or steer Codex turns, type into Claude sessions running in tmux. `/clear` opens a fresh Codex chat in the dashboard. Stop a turn, change effort, or start a new Claude or Codex in a project's tmux session.
- Recent history as safe Markdown, with folded tool calls, errors, older pages on demand, and the screenshots a Claude or Codex session looked at, shown where they were taken; click one to view it large. Claude subagents and workflow workers are nested under their session.
- Model, effort, permission mode, context, plan progress, goal and cost per session; unread dots for finished work.
- Notifications (HTTPS) and theme sounds when a session needs you, a favicon badge, and `/` `j` `k` `n` shortcuts.
- Five-hour and weekly usage limits for both accounts, with a warning when the current pace runs past the limit.
- Themes: Orbit (auto, light or dark), MU/TH/UR, EVA, Springfield, Sanctuary, Heroes, and a 3D Office. A picker asks on first visit.
- This computer only, or your other devices over Tailscale. PIN or password, ten-minute idle lock.

## More is more

MU/TH/UR has a physical control panel and curved CRT glass: the frame stays put while sessions scroll inside, with faint interference and a tiny, occasional stowaway. EVA has a steel production sidebar, tactical radar, plan progress and usage-fed power meters. Both have boot sequences, status-sensitive radar contacts, themed scrollbars and screenshot frames. Motion switches off with reduced motion; the stowaway and interference also pause while typing. Orbit is the calm option.

Springfield brings Simpsons-inspired skies, doughnuts and a TV session map. Sanctuary turns the dashboard into a pixel-art dungeon with skull-carved frames, blood and mana usage orbs. Heroes has a pixel castle, hero portraits, jeweled mana meters and illuminated chat scrolls with a wax-seal Send button.

Office swaps the list for a toon-shaded 3D office: every session is a fruit at a desk, sleeping when idle and waving when it needs you, with speech bubbles, its latest lines on the monitor and usage on the whiteboard. Walk around in first person (WASD, Shift to run, Space to jump; click to capture the mouse, or use the arrow keys, to look), Tab for the overview, and click someone to fly over and open their session. ☰ swaps back to the list, as notes and post-its on a corkboard.

## Screenshots

| Springfield | Sanctuary | Heroes |
| --- | --- | --- |
| ![Springfield: cartoon skies and TV session map](docs/screenshots/springfield-overview.webp) | ![Sanctuary: carved skull frames, bloody selections and usage orbs](docs/screenshots/diablo-overview.webp) | ![Heroes: pixel castle, hero portraits and mana meters](docs/screenshots/heroes-overview.webp) |
| ![Springfield: chat and message composer](docs/screenshots/springfield-chat.webp) | ![Sanctuary: chat in carved dungeon frames](docs/screenshots/diablo-chat.webp) | ![Heroes: illuminated messages, writing scroll and wax-seal Send button](docs/screenshots/heroes-chat.webp) |
| <img src="docs/screenshots/springfield-phone.webp" width="260" alt="Springfield on a phone"> | <img src="docs/screenshots/diablo-phone.webp" width="260" alt="Sanctuary on a phone: blood and mana usage orbs"> | <img src="docs/screenshots/heroes-phone.webp" width="260" alt="Heroes on a phone: ornate frames and mana meters"> |

| MU/TH/UR | EVA |
| --- | --- |
| ![MU/TH/UR: session overview with radar](docs/screenshots/mother-overview.webp) | ![EVA: session overview with tactical radar and power bar](docs/screenshots/eva-overview.webp) |
| ![MU/TH/UR: physical access terminal](docs/screenshots/mother-unlock.webp) | ![EVA: steel access console](docs/screenshots/eva-unlock.webp) |
| ![MU/TH/UR: subagent history with tool calls](docs/screenshots/mother-subagent.webp) | ![EVA: Claude permission request](docs/screenshots/eva-permission.webp) |

| Office | Office overview |
| --- | --- |
| ![Office: first person among the fruit sessions](docs/screenshots/office-first-person.webp) | ![Office: overview of the whole room](docs/screenshots/office-overview.webp) |
| ![Office list: sessions as taped notes and post-its on a corkboard](docs/screenshots/office-list.webp) | ![Office: Claude permission request on a post-it](docs/screenshots/office-permission.webp) |

| Screenshots in the history | Screenshot viewer |
| --- | --- |
| ![Office list: the screenshots a session looked at, as taped prints between its messages](docs/screenshots/office-history-shots.webp) | ![MU/TH/UR: a screenshot large on the CRT viewer, ‹ › and swipe to step](docs/screenshots/mother-shot-viewer.webp) |

| Orbit dark | First visit |
| --- | --- |
| ![Orbit dark: Codex command approval](docs/screenshots/orbit-dark-approval.webp) | ![Theme picker](docs/screenshots/theme-picker.webp) |

| Phone: Orbit | Phone: MU/TH/UR | Phone: EVA | Phone: Office |
| --- | --- | --- | --- |
| <img src="docs/screenshots/orbit-phone-table.webp" width="260" alt="Orbit on a phone: Markdown table as cards"> | <img src="docs/screenshots/mother-phone-question.webp" width="260" alt="MU/TH/UR on a phone: answering a question"> | <img src="docs/screenshots/eva-phone.webp" width="260" alt="EVA on a phone: session overview"> | <img src="docs/screenshots/office-phone.webp" width="260" alt="Office on a phone: sessions as fruit at their desks"> |

## Start

Requires macOS or Linux, Node 22.12+ and `tmux` (plus `ss` on Linux). Tailscale is optional.

On a Mac, install the prerequisites with [Homebrew](https://brew.sh): `brew install node tmux`.

```sh
npm ci
npm start
```

The first run asks how to reach the dashboard (Tailscale or this computer only) and for a PIN or password. It then connects the Claude hooks in `~/.claude/settings.json` (backed up to `.local/`), starts the server in a tmux session named `aiControl` on port 47841, and prints the URL.

On macOS, the Tailscale app is detected automatically. Claude usage reads its existing [Keychain login](https://code.claude.com/docs/en/authentication#credential-management); macOS may ask for Keychain access. For certificate commands, use the [Tailscale Mac CLI](https://tailscale.com/docs/reference/tailscale-cli?tab=macos).

```sh
npm run attach             # Open the server's tmux session
npm stop                   # Stop the server
npm restart                # Restart it
npm run setup              # Change Tailscale/local mode, certificate and Claude accounts
npm run password           # Change the PIN/password and sign out everywhere
npm run dev:local          # Run on 127.0.0.1 only
npm run demo               # Demo dashboard on port 47842, PIN 1234
npm run connect:claude     # Reinstall the Claude hooks
npm run disconnect:claude  # Remove them
npm test
```

## Network and security

- Listens only on the Tailscale IP and `127.0.0.1` (plain HTTP, for this machine), or just `127.0.0.1` in local mode; never the LAN.
- HTTPS needs a Tailscale certificate: enable HTTPS in the Tailscale admin console, then run `tailscale cert --cert-file .local/<host>.crt --key-file .local/<host>.key <host>`. Rerun it every 90 days. Without a certificate it uses HTTP; Tailscale still encrypts traffic between devices.
- Salted scrypt password hash, HttpOnly SameSite cookies, origin and CSRF checks; five failed logins block an address for 15 minutes.
- Settings, logins and logs stay in `.local/`. The browser loads no third-party scripts, fonts or services.

## How it works

- **Codex:** connects to the app-server control socket (`~/.codex/app-server-control/`, or `CODEX_HOME`) and rejoins loaded threads.
- **Claude Code:** reads running sessions from `~/.claude/sessions` and transcripts from `~/.claude/projects`. Several accounts (`CLAUDE_CONFIG_DIR` folders, any name) go in `claudeDirs` in `.local/config.json`; `npm run setup` offers the ones it finds. Each gets its own hooks, sessions and usage row. Hooks forward questions and permission requests over a local socket. Messages are pasted into the session's tmux pane, or sent to its inbox outside tmux.
- **Usage:** Codex's `account/rateLimits/read`, and the Claude CLI's internal OAuth usage endpoint with its existing login. Credentials never leave the backend.

## License

MIT. Bundles [Marked](client/vendor/marked/LICENSE.md) (MIT) and three Google Fonts under the [SIL Open Font License](client/public/fonts/OFL.txt).
