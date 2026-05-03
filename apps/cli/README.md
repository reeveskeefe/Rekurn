# Rekurn CLI

Install globally:

```bash
npm install -g rekurn@0.2.5
```

Or run without installing:

```bash
npx rekurn@0.2.5 --help
```

Rekurn is a self-hosted version control system. There is no central rekurn.com
account — any site can run the Rekurn backend, and you authenticate against
each site independently using that site's own login page.

## Quick start

```bash
# Connect to a Rekurn site (opens your browser)
rekurn login https://yoursite.com

# Initialise a repo in the current directory
rekurn init

# Point the repo at a remote
rekurn remote set https://yoursite.com/username/repo-name

# Commit, push, pull
rekurn commit -m "first commit"
rekurn push
rekurn pull
```

## How login works

Running `rekurn login` starts a temporary local HTTP server, then opens your
browser to the Rekurn site's login page. You enter your email, receive a magic
link, click it, and the site posts a session token back to the local server.
The token is stored in your **OS keychain** (macOS Keychain Access, GNOME
Secret Service on Linux, DPAPI on Windows) — never in plain text on disk.

If the session token ever expires, `rekurn` will silently attempt to refresh it
before prompting you to log in again.

## Multi-site

You can connect to as many Rekurn sites as you like. Each gets its own
credential entry keyed by URL in `~/.rekurn/credentials.json` (tokens in
keychain only). Switch the active site:

```bash
rekurn settings
```

## Commands

| Command | Description |
|---|---|
| `rekurn login [url]` | Authenticate with a Rekurn site |
| `rekurn logout` | Remove stored credentials |
| `rekurn init` | Initialise a new repo |
| `rekurn clone <url>` | Clone a remote repo |
| `rekurn commit -m <msg>` | Create a commit |
| `rekurn push` | Push commits to the remote |
| `rekurn pull` | Pull commits from the remote |
| `rekurn fetch` | Fetch without merging |
| `rekurn branch` | List / create branches |
| `rekurn merge` | Merge a branch |
| `rekurn rebase` | Rebase onto a branch |
| `rekurn log` | Show commit history |
| `rekurn diff` | Show uncommitted changes |
| `rekurn status` | Show working tree status |
| `rekurn snapshot` | Save a named snapshot |
| `rekurn remote set <url>` | Set the remote URL |
| `rekurn remote show` | Show the current remote |
| `rekurn deploy` | Trigger a deployment |
| `rekurn audit` | View audit log |
| `rekurn verify` | Verify repo integrity |
| `rekurn settings` | Manage multi-site credentials |

## Environment variables

| Variable | Description |
|---|---|
| `REKURN_API_URL` | Override the API base URL for all commands |
| `REKURN_ALLOW_INSECURE_REMOTE` | Set to `1` to allow `http://` remotes (local dev only) |

## License

Apache 2.0
