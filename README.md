# Skills

Author local skills, mirror external skills, and distribute standalone skill
directories from one private pnpm workspace. `packages/answer-me-with-html/`
contains the local renderer's TypeScript source. External skills from
[backnotprop/pstack](https://github.com/backnotprop/pstack) remain mirrors in
`skills/`, alongside the assembled local skill.

The root package has no release or publish workflow. See the
[engineering contract](docs/engineering/skills-monorepo.md) for project ownership,
build APIs, artifact assembly, and evaluation limits.

## Set up the repository

Use Git, a Node.js version accepted by the root `engines.node`, and the pnpm
version pinned in `package.json`. CI uses Node.js 24.15.0 and pnpm 12.18.0.
TypeScript 6.0.3 and Limina 0.5.0 govern the native managed TypeScript build.
The assembled `answer-me-with-html` skill has a separate Node.js 20+ runtime.

```sh
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` governs and compiles the workspace, validates source ownership, and
assembles local skill artifacts. Run `pnpm skills sync` separately when you
intend to fetch configured external sources. Local builds use the installed,
locked dependencies and preserve unrelated external mirrors.

For an older checkout whose lock still has `repository.version: 1`, follow the
[explicit ownership migration](docs/engineering/skills-monorepo.md#ownership-migration).
Keep the original staged and unstaged changes until that migration is reviewed.

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
operational failures. From another directory, use
`pnpm --dir /path/to/skills skills list` to target this repository. Direct
`node /path/to/.build/scripts/cli.mjs ...` manages its current working directory
after compilation.

## Author local skills

Keep authored skills under `packages/<directory>/`. The root discovers packages
through `package.json` metadata with a unique `skillBuild.name`. Put static
instructions and references in `skill/`, including `SKILL.md` and the complete
applicable license terms.

```sh
pnpm build:ts
pnpm artifacts:build --skill answer-me-with-html
pnpm test:compiled --skill answer-me-with-html
```

The renderer has separate Node, browser, and shared TypeScript projects.
Its package-local assembler reads compiled JavaScript and static assets to create
standalone scripts. Edit those source modules rather than a bundled renderer.
Keep tests in `tests/` and evaluation cases in `evals/` inside the package.
Documentation-only packages need no empty TypeScript project or assembler.

`skills/` is tracked distribution output. `.build/` contains ignored compiler
outputs, and Limina keeps generated build configurations under `.limina/`.
Commit reviewed source and distribution changes together. Unknown files and
edits to managed copies block replacement rather than becoming source skills.

Local locators passed to the external manager must resolve inside this repository,
including through symlinks. The manager stores those paths relative to the root.
Use package discovery for authored workspace skills. The external SDK installer
does not own workspace artifacts.

## Filter published files

The root `.skillsignore` applies globally to skills from every configured source,
including local locators, remote Git repositories, and downloads. The manager
reads it on sync and when adding a skill. It matches paths relative to each
skill's root and ignores case.

Rules use [`.gitignore` pattern syntax](https://git-scm.com/docs/gitignore).
For example, `tests/` excludes directories with that name at any depth,
`/drafts/` excludes only top-level drafts, and `!example.test.mjs` can
restore a file matched by an earlier rule when its parent directory is included.
Keep `SKILL.md` and the applicable license terms available. An absent or empty
`.skillsignore` adds no exclusions. Run `pnpm skills sync` after editing it
to refresh external mirrors. The local artifact validator also excludes tests,
evaluation inputs, TypeScript source, and build metadata from standalone skills.

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
A second local SDK installation computes the published SDK hash after removing
centralized license files and paths matched by `.skillsignore`. The original
installed digest records the input package.
Attribution files such as `NOTICE` also appear in the root declaration and remain
inside the skill when they are not license files. Removing a skill removes its
notice associations. Empty selections leave the project's license prefix alone.

The local renderer's `NOTICE` carries its source provenance and complete bundled
dependency and asset terms into `skills/answer-me-with-html/`. A consumer who
installs only that directory receives those terms. This supplements the existing
root license aggregation policy and does not replace the project's license.

## Ownership and recovery

`skills-lock.json` retains SDK schema version 2 and declaration-name keys. Its
`repository.version: 2` extension records canonical names, source binding,
origins, provenance, complete notices, and exact published-tree hashes. Each
installed receipt identifies an external or workspace owner. Workspace receipts
bind an artifact to its package and build inputs. Tree inventories
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

One repository lock serializes local artifact publication, add, remove, sync,
and list. Publication covers
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

A stale local artifact can be removed only when its stored owner and exact
current tree still match. An unknown path, modified artifact, or ownership
collision blocks deletion. Do not delete `.skills-sync-*` recovery evidence to
make a build proceed.

## Install into a consumer project

Run the upstream installer from the project that consumes these skills.

```sh
cd /path/to/consumer-project
npx skills add /path/to/this-repository --skill '*' --yes
```

For a repository available through Git, use its source locator instead.

```sh
npx skills add owner/repo --skill '*' --yes
```

The `pnpm skills` script runs this repository manager. Use `npx skills`
from the project that consumes the skills.

## Run checks and automation

```sh
pnpm fmt:check
pnpm limina:check
pnpm build:ts
pnpm validate:projects
pnpm test:compiled --kind unit
pnpm artifacts:build
pnpm test:compiled --kind integration
pnpm artifacts:check
pnpm validate:distribution
pnpm pack:check
```

`limina:check` runs the named `governance` pipeline with `graph:check`,
`source:check`, and `proof:check`. `build:ts` runs the TypeScript checker and
emitter once through Limina's managed native `tsc -b` path. The later commands
reuse compiled outputs. Unit tests run before assembly, and integration tests
run against the assembled artifacts. `pack:check` inspects the npm pack
whitelist without publishing a package.

The manager tests invoke real CLI subprocesses and pinned `skills@1.8.1` with
isolated Git repositories and loopback HTTP fixtures. The root test runner
selects current tests through the source Solution, so stale compiled test files
do not become test inputs. Evaluation calls require an explicit external runner,
model, and budget. They are excluded from normal CI. See the
[evaluation API](docs/engineering/skills-monorepo.md#evaluation-api) for the
runner protocol and report limits.

CI runs the full Linux baseline, Windows path and installation tests, and a
Node.js 20 smoke render of the Linux-built standalone skill. The final Git
guard rejects tracked changes, untracked files, and ignored unknown files under
`skills/` and the managed control files.

The external sync workflow runs daily or through `workflow_dispatch` on the
default branch. It has `contents: read` permission and uploads a patch, status,
and report for review. It does not commit, push, or bypass CI. New untracked
files enter the patch, while ignored unknown paths fail the report step and
remain listed for inspection. Apply reviewed updates locally and run the full
checks before integrating them.

`pnpm skills` enables Node's environment proxy support by default. Set
`NODE_USE_ENV_PROXY=0` to opt out. Git operations use your existing
authentication and proxy configuration. Keep credentials out of source locators.
