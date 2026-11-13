# Skills

Manage and distribute external agent skills through one repository command.
The initial manifest subscribes to every skill in
[backnotprop/pstack](https://github.com/backnotprop/pstack). Future syncs retain
that subscription unless you remove the source or exclude individual origins.

## Set up the repository

Use Node.js 24 or later, Git, and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm skills sync
```

The first sync migrates the previous unversioned manifest and SDK lock. It
requires Git-tracked, unchanged `skills-sources.json`, `skills-lock.json`,
`skills/`, and `LICENSE` from HEAD. Staged additions, ignored files, untracked
nested directories, and changed executable bits also block migration, including
when `core.fileMode` is false. Every existing legacy origin must remain
discoverable, and a different origin cannot claim its installed directory.
Preserve local changes before that sync.
Add, remove, and list require this initial migration. Subsequent managed
snapshots can remain uncommitted.

## Add, list, and remove skills

```sh
pnpm skills list --available owner/repo --ref main
pnpm skills add owner/repo --skill alpha --skill beta --ref main
pnpm skills add https://git.example.org/team/skills.git --all --ref release
pnpm skills add https://example.org/skill.tar.gz --skill skill-name
pnpm skills list
pnpm skills remove alpha beta
pnpm skills remove --source source-1
pnpm skills help
```

`pnpm skills` without a subcommand prints help. Use `pnpm skills sync` to
refresh configured selections. The previous `pnpm sync` entry has been removed.

Add requires named selectors or `--all`. A batch succeeds together or fails
together. Git sources require a concrete branch, tag, or commit, supplied by
`--ref` or an SDK-supported locator. Literal `HEAD` is rejected. An exact
configured source reuses its ref when omitted. A conflicting explicit ref fails.
Change a configured ref in `skills-sources.json`, then run `pnpm skills sync` to refresh
its selected skills. After any source or selection policy edit, add, remove, and
list require this explicit sync. Formatting and source-order changes do not
change the policy digest.

The manager installs every selected skill into a separate SDK sandbox. The
actual destination basename determines its canonical installed name. For
example, `Fancy Skill` can install as `fancy-skill`. A collision reports both
owners and fails without overwriting. Re-adding an active origin also fails.
There is no force option. Use `pnpm skills sync` to refresh configured selections.

Remove takes canonical names shown by list. After migration, remove uses stored
receipts and notices without contacting remotes. Add preserves unrelated source
snapshots. Unknown names or source IDs fail without publishing changes. Empty
source lists and empty selections are valid.

The CLI returns 0 for success, 2 for invalid arguments, and 1 for conflicts or
operational failures. `skills.sh` changes to its own repository directory before
calling the CLI. Direct `node /path/to/scripts/cli.mjs ...` manages its current
working directory.

## Author local skills

Keep original local skills in `my-skills/`. Each selected local package needs
a `SKILL.md` and its complete applicable `LICENSE` file. Register the directory
once to sync all current and future skills it contains.

```sh
pnpm skills add ./my-skills --all
```

Edit that source directory, then run `pnpm skills sync` to refresh the copies.
Commit the original skills with the generated files so GitHub Actions can sync
from its own checkout.
The `skills/` directory is managed output. Unregistered directories and edits to
managed copies block management rather than becoming new source skills.

Local sources must resolve inside this repository, including when accessed
through a symlink. The manager stores their paths relative to the repository
root. `my-skills`, `./my-skills`, and the absolute path to that directory
register the same source. Run `pnpm skills sync` in the original checkout to
migrate an existing absolute source inside the repository. For a previously
registered external directory, use `pnpm skills remove --source SOURCE_ID`,
then add the originals under `my-skills/` or register a remote Git source.

## Configure source selections

The first successful sync writes a version-2 manifest.

```json
{
  "version": 2,
  "sources": [
    {
      "id": "source-1",
      "source": "backnotprop/pstack",
      "ref": "main",
      "selection": {
        "mode": "all",
        "exclude": [{ "kind": "path", "path": "skills/architect" }]
      }
    },
    {
      "id": "source-2",
      "source": "https://example.org/skills.tar.gz",
      "selection": {
        "mode": "include",
        "origins": [{ "kind": "path", "path": "." }]
      }
    }
  ]
}
```

An all-source selection includes future discoveries. Removing a selected origin
adds a durable exclusion. A declaration rename in the same upstream folder does
not undo that exclusion. An upstream folder move is a new origin. Well-known
providers without folders use `{ "kind": "declared", "name": "skill-name" }`.
A provider identity change can also create a new origin.

An include selection names exact observed origins. Missing selected origins fail
sync. Source IDs stay local and stable. The lock binds them to the SDK-resolved
source URL, type, and subpath. Reusing an ID to point at a different source fails.
The manager does not guess equivalence between HTTP and SSH locators.

## Keep complete notices in one LICENSE

The root `LICENSE` preserves the project's own terms above
`# Licenses of bundled skills`. The generated section contains complete supplied
terms, source identities, origins, and observed provenance. Do not edit that
section by hand.

For Git sources, the manager reads applicable root, ancestor, and selected-skill
notices from the same checked-out commit through Git objects. Generic Git remotes
retain their actual URL and paths without invented GitHub browser links.

For archive, well-known, and local sources, the exact installed package must
contain complete applicable license files. The manager collects those files and
records an installed-content SHA-256 digest. That digest identifies observed
bytes. It does not authenticate a release. An SPDX identifier or an HTTP license
file omitted from the installed bundle is insufficient. The command fails when
supplied full terms are missing and does not refetch a mutable URL for them.
It also rejects LICENSE files containing only known identifier forms, SPDX
expressions, license titles, or URLs. A nested vendor license alone does not
supply terms for the selected package. Complete custom terms retain their UTF-8
BOM and CRLF bytes in the notice ledger.
The aggregation does not certify legal completeness outside the observed source
or package.

`LICENSE`, `LICENCE`, `COPYING`, and license collection files inside installed
skills move into the root declaration and lossless lock notice records. This is
an intentional packaging change. Other resource and executable bytes stay intact.
Empty directories within centralized license collections are removed so Git can
retain the exact published tree.
Other empty source directories fail before publication because Git cannot retain
them. Add a tracked file or marker in the source directory.
A second local SDK installation computes the published SDK hash after stripping
those license files. The original installed digest remains separate provenance.
Attribution files such as `NOTICE` also appear in the root declaration and remain
inside the skill when they are not license files. Removing a skill removes its
notice associations. Empty selections leave the project's license prefix alone.

## Ownership and recovery

`skills-lock.json` retains SDK schema version 2 and declaration-name keys. Its
`repository` extension records canonical names, source binding, origins,
provenance, complete notices, and exact published-tree hashes. Tree inventories
include directories, paths, raw file bytes, and executable bits. SDK hashes have
a separate purpose and do not replace these ownership hashes.
The extension also records the normalized manifest digest, control-file
executable bits, notice byte hashes, and associations for centralized files.

The upstream SDK can read this lock, but its writer drops the repository
extension. Do not run the upstream installer in the management repository.
An extension-stripped lock is damaged ownership and must be restored. Unknown
content, changed files, missing skills, symlinks, and changed root license text
block management without deleting that content. Executable-bit changes on the
manifest, lock, or root LICENSE also block management.

One repository lock serializes add, remove, sync, and list. Publication covers
`skills-sources.json`, `skills/`, `skills-lock.json`, and `LICENSE`. All four are
rechecked after staging. A journal and backups record the old and new
fingerprints before moves begin. This is sequential filesystem publication,
not an atomic multi-path rename.

A normal publication error restores the previous artifacts. The next command can
recover an interrupted owner only when its same-host process is proven dead.
Elapsed time never proves staleness. Recovery checks fingerprints before removing
or restoring anything. Manual edits or persistent I/O failures leave the lock,
journal, and backups with a recovery path in the error. Inspect those files
before retrying. An unreadable owner or a separately interrupted recovery claim
requires inspection rather than automatic lock deletion.

## Install into a consumer project

Run the upstream installer from the project that consumes these skills.

```sh
cd /path/to/consumer-project
npx skills add /path/to/this-repository --skill '*' --yes
```

After publishing your repository, use its source locator instead.

```sh
npx skills add owner/repo --skill '*' --yes
```

The `pnpm skills` script runs this repository manager. Use `npx skills`
from the project that consumes the skills.

## Run checks and automation

```sh
pnpm fmt:check
bash -n skills.sh
pnpm test
```

The tests invoke real CLI subprocesses and pinned `skills@1.8.1` with isolated Git
and loopback HTTP fixtures. They exercise canonical collisions, notice
centralization, preserving errors, deterministic sync, and interrupted
publication. They do not require external network access or global Git changes.

CI runs formatting, shell syntax, and tests. The sync workflow refreshes daily,
on configuration changes, or through `workflow_dispatch`. It commits the
manifest with the mirror, lock, and root license. It needs repository contents
write access. Branch protection can require manual integration.

The shell entry point enables Node's environment proxy support. Git operations
use your existing authentication and proxy configuration. Keep credentials out
of source locators.
