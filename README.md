# AI Control

A self-hosted dashboard for local Codex, Claude Code and OpenCode sessions on **macOS and Linux**, accessible from a browser or phone.

![Orbit: session overview](docs/screenshots/orbit-light-overview.webp)

## Features

- Sessions grouped by project, with status, subagents, context and progress.
- An inline attention inbox, explicit review queue, pinned session names, saved views and a command palette (**Ctrl/Cmd+K**).
- Saved text drafts, prompt snippets, project launch presets, editable handoffs and two session panes. Pins, views and review state follow you between devices.
- Conversation search covers retained history and local archives within size limits. Inspect shared Git changes, observed overlapping edits, past decisions and connection health.
- Answer permissions and questions, send messages with pasted or picked images (Claude needs tmux), stop turns and start agents. Nothing is auto-approved.
- Switch models and supported effort levels from session headers; remember choices for new sessions.
- Fire idle Claude, Codex and OpenCode 2 sessions. Codex and OpenCode keep archived history.
- [Live feed](#live-feed) (**f**): all sessions' replies, tool calls and screenshots on one timeline, so you can follow every agent without switching.
- Chat history with Markdown, diffs, tool calls, screenshots, older messages on demand and the Markdown files a session writes.
- Account usage limits, notifications and sounds when a session needs you.
- Filter the feed by project, agent, session, final replies or failures; choose alert categories, muted projects and quiet hours in **Workspace → Preferences**.
- OpenCode spend HUDs, daily cost charts, token mix and editable weekly or monthly budgets, in every theme: a Bridge console row, a Metropolis plant, a Fantasy treasury and a line on the Office whiteboard.
- Sessions lost to a crash, a killed tmux or a shutdown come back with their last prompt and reply, to resume in a click.
- Light, dark and themed interfaces, including calm e-ink Parchment and Graphite, a walkable 3D Office and a starship Bridge you run from the captain's chair or walk around, with holograms for its colours and who's waiting. Heroes, Zelda, Sanctuary and Metropolis have animated pixel wallpapers: waterfalls and rivers, waving flags, guttering candles, dripping blood, cranes and welders.
- Brick Knights: a toy castle built live in 3D, one scene where every wall, tray, button and meter is real brick geometry on one grid and each label is printed on its brick, so they scroll, press and arrive together. A dragon crosses the keep, minifigures mark sessions and the castle gate opens at start-up.
- A pixel-art Metropolis where each project is a neighbourhood and each session a building that grows while it runs.
- Fantasy Battle, an RPG where each project is a fight, each session a party member and each subagent a minion, with context counting down to Compact, tools as spells, a closing blow when a session finishes, and a boot logo and title screen.
- Nodes, every session a node round you on a 3D board, in five looks with their own lists: Clean (light or dark), Neurons, Synthetic circuits, a Steampunk plant and Mycelium. Status, activity, context, plans, screenshots and usage show on the board itself. Pan with the arrows, WASD or a flick, zoom with **+** and **-**, and **0** shows it all.
- Trickshot in the Office's kitchen: land a paper ball or mug in its target or hit a fruit with a rubber ball or plate, with six levels, three daily shots and a score board.
- Office online: host a meeting with `npm run hub` and share its code; friends join at the meetings clipboard by their Office door, and their bests show on the pinball backbox, the darts chalkboard, the golf board, the kitchen score board and snake's score line. Only names and scores leave your machine.
- Local access or access from other devices over Tailscale, protected by a PIN or password.

### Live feed

Follow every agent at once instead of switching between them. Press **f** or pick **Live feed** in the sidebar: one timeline mixes every session's replies, tool calls and screenshots as they happen, while a strip along the top shows who's working, who's waiting and whose finished work you haven't seen. Click a session to answer it; **Back** returns to the feed. You can hide subagents and tool calls, and the feed opens beside a 3D scene.

| Orbit | Beside the Office | Heroes on a phone |
| --- | --- | --- |
| ![Live feed in Orbit](docs/screenshots/orbit-light-feed.webp) | ![Live feed beside the Office](docs/screenshots/office-feed.webp) | ![Live feed in Heroes on a phone](docs/screenshots/heroes-feed-phone.webp) |

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

Spend HUDs: [Heroes](docs/screenshots/heroes-spend.webp) · [Bridge](docs/screenshots/bridge-list.webp) · [Metropolis](docs/screenshots/city-list.webp) · [Fantasy Battle](docs/screenshots/fantasy-list.webp) · [Session controls](docs/screenshots/heroes-session-header.webp)

Install [OpenCode 2](https://dev.opencode.ai/v2/docs/), connect your provider with `/connect`, then choose its model with `/models`. Adding an Anthropic key does not switch away from OpenCode's free model. Connect AI Control to the shared background service:

```sh
npm run setup -- --opencode auto
npm restart
```

Use **… → New OpenCode session** beside search to create a session in any folder and open its terminal in tmux. Pick **Model** and **Effort** in its header; new dashboard sessions remember the choice. Terminal sessions started with `opencode` share the same service; AI Control discovers its address and password after restarts. A provider key alone does not connect the dashboard.

For a standalone server or OpenCode 1, run `opencode serve --hostname 127.0.0.1 --port 4096`, enter its URL/password in `npm run setup`, then restart AI Control. Connect the terminal to that same server (`opencode --server URL` in V2; `opencode attach URL` in V1).

Click the spend panel's balance to set a USD budget: weekly (Monday reset) or monthly (reset on a day of your choice; day 31 resets on the last day of shorter months), in the server timezone. It tracks recorded estimates, not provider credits, and does not cap API spending. **Updating** means final costs are pending; **Partial** means totals are incomplete. Fire archives idle sessions and subagents while leaving the terminal open; running or queued work blocks it. Advanced V2 forms stay in OpenCode. V1 model changes apply to the next dashboard message; its sessions must be exposed by the connected server.

## Commands

```sh
npm run attach             # Server terminal
npm stop                   # Stop
npm restart                # Restart
npm run hub                # Host Office online and sign in; prints the join code (--join <code>, --new-code, --stop)
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

| Springfield | Sanctuary |
| --- | --- |
| ![Springfield](docs/screenshots/springfield-overview.webp) | ![Sanctuary](docs/screenshots/diablo-overview.webp) |

| Heroes | Zelda |
| --- | --- |
| ![Heroes](docs/screenshots/heroes-opencode.webp) | ![Zelda](docs/screenshots/zelda-overview.webp) |

| Bridge | Bridge, on alert | Bridge's list |
| --- | --- | --- |
| ![Bridge at warp](docs/screenshots/bridge-warp.webp) | ![Bridge on alert, in the Cobalt colours](docs/screenshots/bridge-hail.webp) | ![Bridge's session list](docs/screenshots/bridge-list.webp) |

The Bridge theme is an original design and is not affiliated with any franchise.

| Metropolis | Metropolis on a phone | Metropolis list |
| --- | --- | --- |
| ![Metropolis, with a power plant per agent](docs/screenshots/city-overview.webp) | ![Metropolis on a phone](docs/screenshots/city-phone.webp) | ![Metropolis session list](docs/screenshots/city-list.webp) |

| Fantasy Battle | A fight | On a phone |
| --- | --- | --- |
| ![Fantasy Battle](docs/screenshots/fantasy-overview.webp) | ![A fight in Fantasy Battle](docs/screenshots/fantasy-fight.webp) | ![Fantasy Battle on a phone](docs/screenshots/fantasy-phone.webp) |

The Fantasy Battle theme is an original design and is not affiliated with any franchise.

| Nodes · Clean | Clean dark | Neurons |
| --- | --- | --- |
| ![Nodes in the Clean look](docs/screenshots/nodes-clean.webp) | ![Nodes in Clean dark](docs/screenshots/nodes-clean-dark.webp) | ![Nodes as neurons](docs/screenshots/nodes-neurons.webp) |

| Synthetic | Steampunk | Mycelium |
| --- | --- | --- |
| ![Nodes as a circuit board](docs/screenshots/nodes-synthetic.webp) | ![Nodes as a steam plant](docs/screenshots/nodes-steampunk.webp) | ![Nodes as mycelium](docs/screenshots/nodes-mycelium.webp) |

| Steampunk's list | Steampunk's chat | Neurons on a phone |
| --- | --- | --- |
| ![Steampunk's session list in the machine hall](docs/screenshots/nodes-list.webp) | ![A permission request in Steampunk's chat](docs/screenshots/nodes-chat.webp) | ![Nodes as neurons on a phone](docs/screenshots/nodes-phone.webp) |

[More screenshots, including mobile](docs/screenshots).

## Network and security

Listens on localhost and optionally the Tailscale IP, never the LAN. Passwords are hashed; sessions lock after ten idle minutes. Settings and logs stay in `.local/`; credentials stay on the backend.

For iPhone and iPad notifications, open the HTTPS URL in Safari, choose **Share → Add to Home Screen**, open AI Control from the Home Screen, and enable **Alerts → Notifications**. iOS/iPadOS 16.4 or later is required. Notifications continue while the app is closed and can show project and session names on the lock screen. Changing the PIN/password removes existing notification subscriptions; unlock each device again to restore them.

For HTTPS and notifications, enable HTTPS in Tailscale and follow the certificate command printed by `npm run setup`. Renew certificates every 90 days. The [Mac CLI](https://tailscale.com/docs/reference/tailscale-cli?tab=macos) is bundled in the Tailscale app. HTTP over Tailscale still has encrypted transport between devices.

## How it works

Codex connects through its local app-server socket. Claude sessions and history come from local files; hooks forward permissions and questions. Messages reach Claude through tmux or its inbox. OpenCode uses its local HTTP API. Account limits use your existing login; OpenCode costs use its recorded usage.

## License

A hobby project provided as is under [MIT](LICENSE), without warranty. Use at your own risk, including approvals and messages sent to agents. Not affiliated with OpenAI, Anthropic, the LEGO Group, or the owners of *Alien* or *Command & Conquer*.

LEGO is a trademark of the LEGO Group, which does not sponsor or endorse this project; Brick Knights is an original design in the style of toy castle bricks.

Includes [Marked](client/vendor/marked/LICENSE.md) (MIT) and fonts under the [SIL Open Font License](client/public/fonts/OFL.txt) and the [Apache License](client/public/fonts/APACHE-2.0.txt).
