# AI Control

A self-hosted dashboard for local Codex and Claude Code sessions on **macOS and Linux**, accessible from a browser or phone.

![Orbit: session overview](docs/screenshots/orbit-light-overview.webp)

## Features

- Sessions grouped by project, with status, subagents, context and progress.
- Answer permissions and questions, send messages, stop turns and start agents. Nothing is auto-approved.
- Chat history with Markdown, diffs, tool calls and screenshots.
- Account usage limits, notifications and sounds when a session needs you.
- Light, dark and themed interfaces, including a walkable 3D Office.
- Local access or access from other devices over Tailscale, protected by a PIN or password.

## Setup

Requires **Node 22.12+** and **tmux**. Linux also needs **ss** (`iproute2`). On macOS, install prerequisites with [Homebrew](https://brew.sh):

```sh
brew install node tmux
```

Then, on either platform:

```sh
npm ci
npm start
```

First run chooses local or Tailscale access, sets your PIN/password, and connects Claude hooks. Existing Claude settings are backed up in `.local/`. The server runs in tmux as `aiControl` on port **47841** and prints its URL.

On macOS, the Tailscale app is detected automatically. Claude usage uses its existing [Keychain login](https://code.claude.com/docs/en/authentication#credential-management); macOS may ask for access. Use `npm run setup` to add Claude accounts or change network settings.

## Commands

```sh
npm run attach             # Server terminal
npm stop                   # Stop
npm restart                # Restart
npm run setup              # Network, HTTPS and Claude accounts
npm run password           # Change PIN/password; sign out everywhere
npm run dev:local          # Localhost only
npm run demo               # Demo on port 47842, PIN 1234
npm run connect:claude     # Install Claude hooks
npm run disconnect:claude  # Remove Claude hooks
npm test
npm run build
```

## Screenshots

| MU/TH/UR | EVA | Office |
| --- | --- | --- |
| ![MU/TH/UR](docs/screenshots/mother-overview.webp) | ![EVA](docs/screenshots/eva-overview.webp) | ![Office](docs/screenshots/office-overview.webp) |

| Springfield | Sanctuary | Heroes |
| --- | --- | --- |
| ![Springfield](docs/screenshots/springfield-overview.webp) | ![Sanctuary](docs/screenshots/diablo-overview.webp) | ![Heroes](docs/screenshots/heroes-overview.webp) |

[More screenshots, including mobile](docs/screenshots).

## Network and security

Listens on localhost and optionally the Tailscale IP, never the LAN. Passwords are hashed; sessions lock after ten idle minutes. Settings and logs stay in `.local/`; credentials stay on the backend.

For HTTPS and browser notifications, enable HTTPS in Tailscale and follow the certificate command printed by `npm run setup`. Renew certificates every 90 days. The [Mac CLI](https://tailscale.com/docs/reference/tailscale-cli?tab=macos) is bundled in the Tailscale app. HTTP over Tailscale still has encrypted transport between devices.

## How it works

Codex connects through its local app-server socket. Claude sessions and history come from local files; hooks forward permissions and questions. Messages reach Claude through tmux or its inbox. Usage comes from each provider using your existing login; Claude manages token renewal.

## License

A hobby project provided as is under [MIT](LICENSE), without warranty. Use at your own risk, including approvals and messages sent to agents. Not affiliated with OpenAI, Anthropic, or the owners of *Alien* or *Command & Conquer*.

Includes [Marked](client/vendor/marked/LICENSE.md) (MIT) and fonts under the [SIL Open Font License](client/public/fonts/OFL.txt).
