# Setup — step by step

This guide gets the Missive MCP server running and connected to Claude, even if
you've never used a terminal before. It takes about 10 minutes. If you get stuck,
jump to [Troubleshooting](#troubleshooting) at the bottom.

**What you'll end up with:** Claude (Desktop or Code) able to read and organize
your Missive inbox, draft replies for you to send, post internal notes, manage
tasks and labels, and more — safely (it can't send external email or delete things).

---

## Before you start

You need:

1. **A Missive account on the Productive plan** (API tokens require it).
2. **A computer** (Mac, Windows, or Linux) where you can install software.

That's it. You do **not** need to know how to code.

---

## Step 1 — Install Node.js (the thing that runs the server)

1. Go to **https://nodejs.org** and download the **LTS** version.
2. Run the installer and accept the defaults.
3. To confirm it worked, open your terminal (on Mac: press `Cmd+Space`, type
   "Terminal", press Enter; on Windows: open "Command Prompt" or "PowerShell")
   and type:
   ```bash
   node --version
   ```
   You should see a number like `v20.x.x` or higher. If you see "command not
   found", restart your computer and try again.

## Step 2 — Get the code

**Option A — download a ZIP (easiest):** On the project's GitHub page, click the
green **Code** button → **Download ZIP**. Unzip it somewhere you'll remember,
like your Documents folder.

**Option B — git clone (if you have git):**
```bash
git clone https://github.com/kanjidoc/missive-mcp.git
```

## Step 3 — Open the folder in your terminal

In the terminal, type `cd ` (with a space), then drag the project folder onto the
terminal window and press Enter. You're now "inside" the folder. For example:
```bash
cd /Users/you/Documents/missive-mcp
```

## Step 4 — Install the project's pieces

```bash
npm install
```
This downloads everything the server needs. It takes a minute.

## Step 5 — Get your Missive API token

1. Open **Missive** → **Preferences** → the **API** tab.
2. Click **Create a new token**, give it a name (e.g. "Claude"), and copy it. It
   looks like `missive_pat-...`.
3. Keep it private — it's like a password for your inbox.

## Step 6 — Save your token

In the terminal, in the project folder, run:
```bash
cp .env.example .env
```
This creates a file named `.env`. Open it in any text editor, find the line:
```
MISSIVE_API_TOKEN=
```
and paste your token right after the `=` (no spaces, no quotes):
```
MISSIVE_API_TOKEN=missive_pat-your-token-here
```
Save the file. (This file stays on your computer and is never shared.)

## Step 7 — Check it works and find your IDs

```bash
npm run setup
```
If your token is good, you'll see **✓ Token works** followed by lists of your
organizations, contact books, teams, and users. It also prints a ready-to-paste
configuration you'll use in Step 9.

## Step 8 — (Optional) set defaults so you type less later

Setup printed IDs for your organizations, contact books, and teams. If you mostly
work in one of each, open `.env` again and fill in any of these so Claude doesn't
have to ask every time:

```
MISSIVE_DEFAULT_ORGANIZATION=...     # an organization ID from setup
MISSIVE_DEFAULT_CONTACT_BOOK=...     # a contact book ID from setup
MISSIVE_DEFAULT_TEAM=...             # a team ID from setup
MISSIVE_DEFAULT_FROM_ADDRESS=you@yourdomain.com   # the address drafts send from
```
The "from" address must be one of your Missive aliases — you can also find these
under **Settings → API → Resource IDs → Accounts** in Missive. All of these are
optional; skip any you don't need.

## Step 9 — Build the server

```bash
npm run build
```

## Step 10 — Connect it to Claude

You need the full path to the built server. In the terminal, run `pwd` to print
the current folder; the server is that path plus `/dist/index.js`.

**If you use Claude Desktop:**
1. Open Claude Desktop → **Settings** → **Developer** → **Edit Config** (this
   opens `claude_desktop_config.json`). On Mac it's at
   `~/Library/Application Support/Claude/claude_desktop_config.json`; on Windows,
   `%APPDATA%\Claude\claude_desktop_config.json`.
2. Add this inside the file (use the path from `pwd`):
   ```json
   {
     "mcpServers": {
       "missive": {
         "command": "node",
         "args": ["/full/path/to/missive-mcp/dist/index.js"]
       }
     }
   }
   ```
   If there's already an `"mcpServers"` section, add the `"missive"` entry inside it.
3. Save and fully quit + reopen Claude Desktop.

**If you use Claude Code:** just run the command `npm run setup` printed for you,
which looks like:
```bash
claude mcp add-json missive '{"type":"stdio","command":"node","args":["/full/path/to/missive-mcp/dist/index.js"]}'
```

## Step 11 — Try it

Ask Claude: **"Using Missive, list my organizations."** It should call
`missive_list_organizations` and show your org(s). You're connected. 🎉

Other things to try: "What's in my Missive inbox?", "Draft a reply to the latest
email from Jane" (it saves a draft you review and send), "Add a label to this
conversation", "Create a task to follow up tomorrow."

---

## Troubleshooting

- **"MISSIVE_API_TOKEN is not set"** — your `.env` is missing the token, or you
  edited `.env.example` instead of `.env`. Redo Step 6.
- **"Token check FAILED" / 401** — the token is wrong or was revoked. Create a new
  one (Step 5) and paste it again. Also confirm your org is on the Productive plan.
- **`node` or `npm` "command not found"** — Node.js isn't installed or your
  terminal needs a restart. Redo Step 1.
- **The `missive` tools don't appear in Claude** — make sure you ran
  `npm run build`, used the **full** path to `dist/index.js`, saved the config, and
  **fully restarted** Claude.
- **"list conversations" complains about a mailbox** — that's expected: ask for a
  specific mailbox, e.g. "list my inbox conversations."

## Keeping it up to date

When there's a new version: download/`git pull` the latest code, then run
`npm install && npm run build`, and restart Claude.

## A note on safety

By design this server **cannot send external emails or texts and cannot delete
anything**. When you ask it to "reply", it writes a draft and saves it in Missive —
**you** press send. It can post internal team notes and merge conversations, which
stay inside Missive. See the README's "What's not included" section for the full
picture.
