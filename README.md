<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/icon-dark.png">
    <img src="docs/readme/icon-light.png" width="128" height="128" alt="Murmur">
  </picture>
</p>

<h1 align="center">Murmur</h1>

<p align="center">
  <img src="docs/readme/hero.webp" alt="A beautiful home for your Hermes agents: the Buddies peeking over Murmur in a browser at umbrel.local" width="100%">
</p>

<p align="center">
  Chat with your own AI agents, one at a time or all together.<br>
  In the browser, on your Mac or PC, and on your phone.
</p>

<p align="center">
  <a href="https://apps.umbrel.com/app/murmur">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/readme/app-store-badge-dark.svg">
      <img src="docs/readme/app-store-badge-light.svg" alt="Available on the Umbrel App Store" width="220">
    </picture>
  </a>
</p>

<p align="center">
  <a href="#get-murmur"><b>Get Murmur</b></a> ·
  <a href="#bring-your-hermes-or-start-fresh">Your Hermes</a> ·
  <a href="#what-you-can-do">Features</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="docs/DEVELOPMENT.md">Develop</a>
</p>

Murmur is the app for [Hermes Agent](https://github.com/NousResearch/hermes-agent), the open-source agent that runs on your own hardware, remembers what matters, uses tools and gets things done. Murmur is the friendly face on top. There are no terminals, config files or jargon. Make a few agents, give each one a personality, and talk to them from anywhere.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/preview-dark.webp">
    <img src="docs/readme/preview-light.webp" alt="Asking Basil to plan next week's dinners: a plan ticks itself off, three helpers go looking for recipes, and the answer arrives with a shopping list" width="600">
  </picture>
</p>

## One Murmur, everywhere

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/everywhere-dark.png">
  <img src="docs/readme/everywhere-light.png" alt="The same Murmur as a Mac app, on a phone and as a Windows app" width="100%">
</picture>

Open it in any browser on your network, install the app for **macOS**, **Windows** or **Linux**, or add it to your phone's home screen. It's the same Murmur everywhere, with the same agents and chats, and every chat picks up where you left off on another device.

## Bring your Hermes, or start fresh

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/where-dark.png">
  <img src="docs/readme/where-light.png" alt="Murmur finds the Hermes Agent app on this Umbrel, with seven agents in it, and offers to start fresh instead" width="100%">
</picture>

Murmur comes with Hermes built in, so you can start fresh with nothing else to install. Already have Hermes? It can live anywhere: on your Umbrel, a Mac in the closet, a Raspberry Pi or a server in the cloud. Murmur finds the ones on your network, or you can paste an address. Your agents, their memories and every past chat come along, including chats from the Hermes dashboard, Hermes Desktop, the terminal and Telegram. Nothing is imported or copied: it all stays in your Hermes.

### Make an agent in seconds

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/agents-edit-dark.png">
  <img src="docs/readme/agents-edit-light.png" alt="Making a new agent from the Coach template: picking its name and colour before creating it" width="100%">
</picture>

Start from a template (Researcher, Writer, Planner, Coder, Coach or Chef) or from scratch. Pick a name and a colour, say what it's for, and it's ready to talk.

### No model yet? Connect one in a minute

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/onboarding-wide-dark.png">
  <img src="docs/readme/onboarding-wide-light.png" alt="Connect a model: continue with ChatGPT, or run a model on the Umbrel itself, picked to fit" width="100%">
</picture>

Sign in with your ChatGPT plan, or run a model right on your Umbrel: Murmur picks one that fits its memory and sets it up in one tap, using its graphics when it has them. Or use Ollama or another model server, or an API key from OpenRouter, OpenAI, Anthropic and others. You can switch any time.

## What you can do

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/buddies-dark.png">
  <img src="docs/readme/buddies-light.png" alt="Nine Buddies, each in its own colour: idle, listening, thinking, working, needs you, speaking, done, uh-oh and asleep" width="100%">
</picture>

### Agents with a personality
Every agent is a **Buddy**, a little character in its own colour that shows what it's doing at a glance: listening, thinking, working, waiting on you, or done. Anything that needs you rises to the top.

### Chats that show their work

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/work-dark.png">
  <img src="docs/readme/work-light.png" alt="Basil working through a plan for next week's dinners with three helpers, and on a phone, the finished shopping list with hearts on both sides" width="100%">
</picture>

Answers stream in as they're written. For bigger jobs, the agent writes a plan and ticks it off as it goes, and sends helpers off to work side by side, each with a line on what it's doing. When it's done, it all folds away. Searches, pages and commands show up in plain words, and you can open any step. Stop it, steer it mid-answer, or have the answer read aloud. Tap a heart on a reply, and your agents react to you, too.

### Connect your apps

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/apps-dark.png">
  <img src="docs/readme/apps-light.png" alt="Atlas's apps: Notion, Linear and Todoist switched on, and dozens more to add" width="100%">
</picture>

Give each agent the apps it needs: Notion, Linear, Todoist, Figma, Canva and dozens more, with one sign-in each. Add an app to another agent in a tap. Most apps only sign in over https, on localhost or in the desktop app.

### You stay in charge

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/approval-wide-dark.png">
  <img src="docs/readme/approval-wide-light.png" alt="Hermes checked storage and listed files on the Umbrel, then asks before deleting the old phone backups" width="100%">
</picture>

On umbrelOS, your agents can work with the Umbrel itself: its apps, files and more. Connect it in **Settings → Umbrel**, or just paste the message umbrelOS gives you into a chat, and every agent gets it. Before anything changes, like deleting files, the agent asks in plain words and waits for *Allow* or *Don't allow*.

### Group chats

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/group-wide-dark.png">
  <img src="docs/readme/group-wide-light.png" alt="Atlas, Juniper and Basil planning a weekend in Lisbon together" width="100%">
</picture>

Put a few agents in one room and let them work it out together. Mention one with **@** to ask just them. Each one speaks in its own colour.

### Text them on WhatsApp and Telegram

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/messaging-dark.png">
  <img src="docs/readme/messaging-light.png" alt="Linking Atlas to WhatsApp with a QR code, and on a phone, Sam asking to message Atlas" width="100%">
</picture>

Scan a code and an agent is on WhatsApp or Telegram, so you can text it from the apps already on your phone. Talk to it in your own WhatsApp, or give it a spare number of its own. When someone new writes in, they wait under *Needs you* until you tap *Allow*.

### In your pocket, too

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/phones-dark.png">
  <img src="docs/readme/phones-light.png" alt="On a phone: approving a cleanup on the Umbrel, a chart and a file from an agent, and Atlas's page with its week" width="100%">
</picture>

- **Answer from anywhere.** Approvals, questions and replies follow you to your phone.
- **Pictures, files and live widgets.** Send photos and files, and get images, downloads and little interactive tools back right in the chat.
- **Routines and memory.** Ask for a briefing every morning at 8. See what an agent remembers, and change or forget any of it.

### And the details
- **Honest usage.** See how much of your plan is left and when it resets, how full a chat is, and what each agent did this week.
- **Choose the model and how hard it thinks** for each agent or each chat.
- **Move agents.** Export an agent to a file and bring it in on another Hermes.
- **More than one Hermes?** Keep one at home and another at work, and switch in one tap.
- **Give it a goal** with `/goal`, and the agent keeps working until it's done. Ask a quick side question with `/btw` without interrupting it.
- **Search every chat**, with a command palette and keyboard shortcuts on desktop.
- **Light and dark**, desktop notifications and a Dock badge, and fluid at every screen size.

## Get Murmur

<table>
<tr>
<td width="50%" valign="top">

#### On umbrelOS
Install **Murmur** from the [Umbrel App Store](https://apps.umbrel.com/app/murmur). It comes with Hermes built in. Already use the **Hermes Agent** app? Murmur finds it and offers to use it instead, agents and all.

</td>
<td width="50%" valign="top">

#### On your Mac or PC
Download Murmur for macOS, Windows or Linux from [Releases](https://github.com/getumbrel/murmur/releases), open it, and pick your Hermes from the list.

</td>
</tr>
</table>

#### With Docker
Run Murmur with its own Hermes:

```sh
curl -fsSLO https://raw.githubusercontent.com/getumbrel/murmur/master/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/getumbrel/murmur/master/.env.example -o .env
# set MURMUR_HERMES_PASSWORD in .env, then:
docker compose up -d
```

Or run Murmur alone and point it at your Hermes. [`docs/STANDALONE.md`](docs/STANDALONE.md) has every option.

```sh
docker run -d -p 3000:3000 -v murmur:/data ghcr.io/getumbrel/murmur:0.9
```

Murmur comes with **Hermes 0.22.5**, and works with any **Hermes Agent 0.21.4 or newer**. If yours is older, Murmur shows you how to update it.

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/how-it-works-dark.png">
  <img src="docs/readme/how-it-works-light.png" alt="Your browser, desktop app and phone talk to Murmur, which connects to Hermes on your Umbrel, a computer or Pi, or in the cloud" width="100%">
</picture>

- **Hermes does the work.** Agents are Hermes profiles and chats are Hermes sessions. Murmur reads and writes the same data, so it stays in sync with the Hermes dashboard, Hermes Desktop and Telegram.
- **Hermes comes along.** On umbrelOS and with Docker Compose, Murmur runs its own Hermes right beside it, private to Murmur. Or it uses a Hermes you already have.
- **Murmur is the experience.** A mobile-first React app and a tiny Node server with no dependencies. The browser never sees Hermes's access key.
- **The desktop app** is the same Murmur in a native window, with its server built in.

## Privacy and security

- Everything runs on hardware you control. Murmur talks only to your Hermes.
- On umbrelOS, Murmur sits behind your Umbrel login. On its own, you can give it a password (`MURMUR_PASSWORD`).
- Hermes's access key stays on Murmur's server, and Murmur refuses requests from other websites.
- An exported agent leaves its keys and sign-ins behind.

## Develop

```sh
npm install
docker compose -f dev/docker-compose.yml up -d        # a local Hermes, like the Umbrel app
HERMES_URL=http://localhost:18789 npm run dev:server   # Murmur's server on :3000
npm run dev:web                                        # the app on :5173, with hot reload
```

[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) covers the architecture, server settings, tests, releases and updating the Hermes client. [`docs/DESKTOP.md`](docs/DESKTOP.md) covers the desktop app, and [`docs/DESIGN.md`](docs/DESIGN.md) and [`docs/BRAND.md`](docs/BRAND.md) cover design and brand.

## Contributing

Found a bug, or wish Murmur did something it doesn't? [Open an issue](https://github.com/getumbrel/murmur/issues/new) and tell us about it. We read every one, reply, and work on them.

We're not accepting pull requests for now. So many arrive written by AI that we can't review each one with the care it deserves, so an issue is the best way to help.

## License

[MIT](LICENSE). Murmur includes Hermes Agent's typed client, which is also MIT.

<p align="center">
  <br>
  <img src="docs/readme/icon-light.png" width="40" height="40" alt=""><br>
  <sub><b>Murmur</b> by <a href="https://umbrel.com">Umbrel</a></sub>
</p>
