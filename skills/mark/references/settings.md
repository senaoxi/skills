# Settings, clean-up and updates

Read this for an explicit settings, cleanup, or update request.

The renderer, publisher, and ChatGPT archive helper use `~/.agents/.mark` by default. Set `AM_HOME` to use a different data directory.

## Manage settings and storage

When the arguments start with `config`, for example `/mark config open off`, use the settings CLI.

- `config`: run `am config` to show the current settings, then let the user choose. Where the agent has a choice tool such as AskUserQuestion, use it: at most 4 settings at a time, these first: `open`, `theme`, `mode`, `style`, with the current value marked in the options. Otherwise ask in plain text.
- `config <key> <value>`: run `am config set <key> <value>`.
- `config reset [key]`: run `am config reset [key]`.

When the user asks in natural language ("stop opening the browser", "use the card theme by default"), also convert it to `am config set`. Settings: `open` (auto-open the browser), `theme`, `mode`, `style`, `scale` (text size on the page; diagrams and charts grow with it), `voice` (video narration), `update_check` (new-version notices in the terminal), `close_after_reply` (close the page tab after the reply is copied). Run `am config` to see all descriptions.

`update_check` reads the upstream Answer me with HTML version from GitHub (raw.githubusercontent.com) at most once a day. This is an informational notice for Mark's bundled renderer. To turn it off, run `am config set update_check false`, or set `AM_NO_UPDATE_CHECK`.

When the user asks for a ready-made theme ("use the comic theme", "install the manga theme"): run `am theme add <name> --use`. Names come from the catalog at https://answer-me-with-html.com/themes/ (at the time of writing: `comic`, `manga`, `pop`); if the name is not there, the command lists the available ones. It downloads, checks and saves the theme and makes it the default, and it asks the user nothing else. If it stops because a file of that name already exists, tell the user it may be their own theme and run it again with `--force` only if they agree. `am theme list` shows the installed themes (`--remote` also shows the catalog), `am theme update` updates them, and `am theme remove <name>` deletes one. The command prints only theme names and versions; it needs Answer me with HTML 0.5.3 or newer.

When the arguments start with `clean`, or the user asks to clean up pages / the cache: first run `am clean --dry-run` and tell the user how many items and how much space will be deleted. Run `am clean` only after the user agrees (add `--all` to delete all pages, videos and saved drafts, `--days N` to change how many days to keep).

When the arguments start with `update`, or the user asks to update this skill, identify the source of the installed Mark copy. For a symlink into the skills workspace, run `pnpm -w run skill mark build` in that workspace after its source has been updated. For a copied install, refresh only `mark` from the same installation source. Ask for the source if you cannot identify it.
