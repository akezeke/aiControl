# AI Control

A self-hosted dashboard for local Codex, Claude Code and OpenCode sessions on **macOS and Linux**, accessible from a browser or phone.

![Orbit: session overview](docs/screenshots/orbit-light-overview.webp)

## Features

- Sessions grouped by project, with status, subagents, context and progress.
- Answer permissions and questions, send messages, stop turns and start agents. Nothing is auto-approved.
- Chat history with Markdown, diffs, tool calls and screenshots.
- Account usage limits, notifications and sounds when a session needs you.
- OpenCode session costs, tokens and estimated daily/monthly spending.
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

### OpenCode

![OpenCode icons for every theme](docs/screenshots/opencode-icons.webp)

Install [OpenCode](https://opencode.ai/docs/) and leave its local server running:

```sh
npm install -g opencode-ai
opencode serve --hostname 127.0.0.1 --port 4096
```

In another terminal, run `npm run setup`, enter `http://127.0.0.1:4096` as the OpenCode URL, then run `npm restart`. If the server uses `OPENCODE_SERVER_PASSWORD`, save the same password in setup.

Use `opencode attach http://127.0.0.1:4096` for terminal sessions on that server. Run `/connect` to connect Anthropic or another provider, then `/models` to select a model. AI Control can create sessions, send messages, stop turns and answer permissions/questions. Costs and tokens cover recorded OpenCode sessions; provider credit balances are unavailable. Each theme includes its own OpenCode icon.

## Commands

```sh
npm run attach             # Server terminal
npm stop                   # Stop
npm restart                # Restart
npm run setup              # Network, HTTPS, Claude accounts and OpenCode
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

Codex connects through its local app-server socket. Claude sessions and history come from local files; hooks forward permissions and questions. Messages reach Claude through tmux or its inbox. OpenCode uses its local HTTP API. Account limits use your existing login; OpenCode costs use its recorded usage.

## License

A hobby project provided as is under [MIT](LICENSE), without warranty. Use at your own risk, including approvals and messages sent to agents. Not affiliated with OpenAI, Anthropic, or the owners of *Alien* or *Command & Conquer*.

Includes [Marked](client/vendor/marked/LICENSE.md) (MIT) and fonts under the [SIL Open Font License](client/public/fonts/OFL.txt).
