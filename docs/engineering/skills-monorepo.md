# Skills monorepo contract

The workspace separates authored TypeScript, external mirrors, and standalone
skill artifacts. The root package is private. Packing checks the distribution
contents without creating a release or publishing to npm.

This document defines the build and ownership contract. A configured CI job is
not a test result. Execution reports must identify the commands, environment,
observations, and limits of each completed run.

## Source and distribution ownership

Only `answer-me-with-html` moves into `packages/` in this migration. The 58
pstack skills in the migration baseline remain external mirrors under `skills/`.
An external subscription can discover more skills on a later explicit sync.

| Path                                    | Owner and purpose                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `scripts/`                              | Root management, project validation, assembly orchestration, tests, evaluations, and pack checks      |
| `tests/`                                | Root TypeScript tests and isolated fixtures                                                           |
| `packages/answer-me-with-html/`         | Authored renderer, publisher, browser runtime, static skill documents, assets, tests, and evaluations |
| `skills/`                               | Tracked standalone local artifact and external mirrors                                                |
| `skills-sources.json`                   | External source selections with stable source IDs and concrete Git refs                               |
| `skills-lock.json`                      | SDK v2 records and the repository v2 owner ledger                                                     |
| `LICENSE`                               | Existing project terms followed by complete supplied bundled-skill notices                            |
| `.build/`                               | Ignored JavaScript outputs for root tools and tests                                                   |
| `packages/*/.build/`                    | Ignored JavaScript outputs owned by the corresponding package                                         |
| `.limina/` and package-local `.limina/` | Generated managed build configurations and reference metadata                                         |
| `reports/evals/`                        | Ignored raw evaluation responses and summaries                                                        |

`skills/` is an installation boundary. Consumers do not need the root toolchain,
workspace TypeScript source, or repository-relative imports. External mirrors
retain upstream resource bytes under the existing filtering and license policy.
The local JavaScript-only distribution rule does not rewrite external pstack
skills that contain their own TypeScript tools.

## Root command API

The pinned toolchain is pnpm 12.18.0, TypeScript 6.0.3, Limina 0.5.0,
`skills` 1.8.1, `ignore` 7.0.14, and `oxfmt` 0.78.0. Root execution uses the
Node.js versions in `package.json#engines`. CI pins Node.js 24.15.0.

| Command                                              | Contract                                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm limina:check`                                  | Run the named `governance` pipeline containing `graph:check`, `source:check`, and `proof:check`                |
| `pnpm build:ts`                                      | Compile the root Solution through Limina's native managed TypeScript `tsc -b` path                             |
| `pnpm build:tools`                                   | Compile the root tool projects for CLI convenience wrappers                                                    |
| `pnpm validate:projects`                             | Check current source ownership, output locations, and authored-code rules without a second compiler invocation |
| `pnpm test:compiled --kind unit`                     | Run current compiled unit tests before artifact assembly                                                       |
| `pnpm artifacts:build`                               | Prepare every local skill and publish the desired local owner set through the shared repository transaction    |
| `pnpm test:compiled --kind integration`              | Run current compiled integration tests after assembly                                                          |
| `pnpm artifacts:check`                               | Prepare the expected local artifacts and compare them with the installed distribution and receipts             |
| `pnpm validate:distribution`                         | Check local skill frontmatter, permitted files, and local references in standalone artifacts                   |
| `pnpm pack:check`                                    | Inspect `npm pack --dry-run --ignore-scripts --json` against the root whitelist                                |
| `pnpm skills`                                        | Compile the root tools and invoke the external source manager                                                  |
| `pnpm skill NAME build\|check\|test\|eval\|validate` | Select one discovered local skill and dispatch its task                                                        |
| `pnpm eval:compiled`                                 | Run an explicitly configured external evaluation runner against prepared local skills                          |
| `pnpm clean --dry-run`                               | List declared compiler and Limina outputs eligible for cleanup                                                 |

`pnpm build` composes governance, compilation, project validation, and local
artifact assembly. `pnpm test` compiles before running compiled tests. CI uses
the individual commands to keep unit tests before assembly and integration
tests after assembly. CI does not call these convenience wrappers in addition
to `build:ts`.

The test runner accepts `--kind all|unit|integration` and an optional
`--skill NAME`. It derives test entries from current TypeScript projects in the
source Solution, rather than scanning `.build/` for old test files. Paths named
`integration/`, `integration.*`, or `*.integration.*` select integration tests.
An empty selected test set fails rather than reporting a successful run.

`artifacts:build` accepts `--skill NAME`, `--check`, and the explicit migration
flag `--migrate`. A selected build must preserve every unrelated owner. A full
build supplies the complete desired local package set, which permits safe
removal of verified stale local artifacts.

The single-package `skill` convenience command first compiles the root Solution,
then limits artifact, test, or evaluation dispatch to the selected package. This
keeps cold-checkout behavior complete; selective compilation is deferred. The
compiled CI entries reuse the root compilation and do not trigger another
compiler pass. Each formal build attempt first invalidates the previous successful receipt and
removes the native output build-info namespace, so the single native compiler pass
re-emits all outputs. This prevents an incremental skip from sealing replaced or
missing JavaScript as a new successful build. Limina graph caches remain reusable;
`build:tools` retains its incremental convenience behavior. The internal
`record-build` helper is only part of this formal pipeline; running an incremental
compiler and then invoking the helper manually does not establish fresh emission.
After native compilation succeeds, `record-build` checks the generated
TypeScript configuration and actual `.tsbuildinfo` input versions, then records current
source/config/dependency and JavaScript hashes under `.build/`, including each
package output manifest. Assembly rejects missing or stale build evidence. These
ignored receipts are build caches, not another distribution ownership ledger.

Native incremental builds can skip changed bytes when source modification times
are preserved. The compiler-evidence gate rejects that stale result instead of
sealing old JavaScript as current. The gate reads the pinned TypeScript 6.0.3
build-info format and fails closed on missing or unsupported evidence. Recover
with `pnpm clean` followed by `pnpm build:ts`. Formal artifact builds retain graph
caches while regenerating native output evidence and JavaScript.

Dependency receipts follow visible workspace installations and their declared
dependency closure. They hash active package bytes and links, and check package
identities against the lockfile. Disconnected pnpm virtual-store caches are not
active inputs: deleting a package may leave those caches behind. A missing,
unlocked, or escaping dependency that remains reachable still fails the build.

## Source Solution and managed reference graph

The authored root `tsconfig.json` is a source Solution. Its references enumerate
the projects that own root tools, root tests, configuration code, and local
package Solutions. Each code-bearing package has its own governance root and
package-local Solution. Package governance covers its Node, browser, shared,
assembly, test, and evaluation projects as applicable. Documentation-only
packages have no empty TypeScript project merely to appear in this graph.

The root configuration leaf is `config/tsconfig.json`, which owns
`../limina.config.mts` and emits to `.build/config/`. Limina 0.5.0 rejects a
sole named environment such as root `tsconfig.config.json`. Giving that leaf
its own directory preserves the root Solution and keeps `proof:check` enabled.

Authored projects keep `strict: true`, `allowJs: false`, and `noEmit: true`.
Every code-bearing project declares `liminaOptions.outputs.rootDir` and
`liminaOptions.outputs.outDir`. Package outputs stay within that package's
`.build/` directory. Root outputs stay in the root `.build/` directory.

For example, the package's `src/node/tsconfig.json` declares these output
locations relative to its own directory:

```json
{
  "liminaOptions": {
    "outputs": {
      "rootDir": ".",
      "outDir": "../../.build/src/node"
    }
  }
}
```

Limina derives a managed reference graph using the selected TypeScript
Compiler's source and type evidence. The generated graph supplies the
references and compiler settings needed for the native build. The authored
source Solution and generated managed graph have different purposes. Their
edges need not be identical.

Managed configuration and reference metadata belong under `.limina/` and remain
rebuildable. JavaScript belongs at each project's declared `.build/` output.
Compiler incremental state is generated data. None of those files replaces
authored configuration or the committed skill owner ledger.

The named governance pipeline omits `checker:build`. `build:ts` owns the
TypeScript checking and emit pass, so CI invokes the checker once per host.
A diagnostic from that compiler is evidence about the program or its build
inputs. A nonzero native build alone does not establish a managed graph defect.

Project validation must reject orphan authored source, overlapping project
owners, JavaScript used as authored source, and package outputs that escape
their package. Runtime boundary checks must keep Node APIs out of browser and
shared projects. Shared code has neither Node globals nor DOM globals. Browser
projects receive DOM libraries, and Node projects receive Node types.

External `skills/` mirrors, dependency trees, generated outputs, and isolated
test fixtures stay outside authored-source governance. Restored renderer
TypeScript remains inside governance, including the browser runtime.

## Package assembly API

The root discovers immediate `packages/*/package.json` files with a unique
`skillBuild.name`. That name must match the static `skill/SKILL.md` frontmatter.
The package's npm name and its installed skill name have separate roles.

A code-bearing package declares this assembly entry:

```json
{
  "skillBuild": { "name": "answer-me-with-html" },
  "scripts": {
    "artifact:prepare": "node .build/scripts/assemble.mjs"
  }
}
```

The root prepares an isolated staging directory and invokes the compiled
package entry with `--out ABSOLUTE_STAGING_DIRECTORY`. The assembler writes
that skill directory. Root publication, ownership changes, license aggregation,
and replacement of `skills/` belong to the root transaction.

The root provides `SKILL_BUILD_OUTPUT_MANIFEST` with the current source-to-output
mapping. Assembly consumes current JavaScript outputs from the declared
projects and static assets. Missing or stale compiler outputs fail. Package
assembly cannot invoke another TypeScript compiler or feed authored TypeScript
directly to a bundler. JavaScript-only bundler input checks enforce this boundary.

The local renderer restores the full renderer into authored TypeScript modules,
including parsing, components, themes, Node commands, browser interaction,
publishing, and shared algorithms. An opaque copy of the old bundled
`scripts/am.mjs` cannot replace that source. Bundled third-party libraries remain
locked dependencies with their applicable notices.

The assembler creates the standalone Node.js 20+ scripts and embeds the compiled
browser runtime and assets. A final local skill excludes authored TypeScript,
tests, evaluation inputs, source maps, build caches, and dependency directories.
The final validator checks frontmatter and local references after assembly.
A package can declare `skillBuild.resources` as skill-relative paths required at
runtime; these paths must exist inside both prepared and formal distributions.
Static Markdown, HTML, and SVG references and literal JavaScript module imports
are checked separately. Computed paths still require declared resources and
installed-consumer integration coverage.

## Repository v2 owner ledger

`skills-lock.json` keeps the upstream SDK's top-level schema version 2. Its
`repository.version: 2` extension provides the shared owner ledger. A second
local-artifact lock would allow the external manager and local builder to
overwrite each other's files, so both use this ledger and transaction.

External records use `kind: "external"` and retain their source binding, origin,
observed provenance, notices, SDK receipt, and exact tree hash. Workspace records
use `kind: "workspace-build"` and bind the installed name to a package directory,
input hash, file inventory, executable bits, and toolchain identity, including the
stable `skills-local-build-v1` recipe version. The SDK
record points to `./skills/<name>`, so reinstallation reads the formal artifact;
`packageDir` separately records the development source. Pointing the SDK source
at `packages/` would install static development content without compiled scripts.

Adding, removing, or syncing external sources preserves workspace-owned
artifacts. Local builds preserve external owners. A name collision across those
owner kinds fails. An upstream SDK write that drops the repository extension
damages ownership and requires restoration of the managed snapshot.

Stale deletion is conditional on proof of ownership. Before removing a local
artifact absent from the desired package set, publication must match its owner
receipt and exact current tree. Unknown, ignored, edited, or symlinked content
blocks deletion. The same rule applies when a package changes its installed
name. Check mode reports differences without publishing a replacement.

### Ownership migration

The prior `repository.version: 1` ledger treats `source-2` at `./my-skills` as an
external local source. The explicit local build migration transfers the existing
`answer-me-with-html` origin into workspace ownership. The new authored source
is `packages/answer-me-with-html/`. The external pstack origins keep their owners.

After preserving the baseline and completing compilation, the transition uses
`pnpm artifacts:build --migrate`. A normal build must not silently reinterpret
an external owner as a workspace owner. Review the manifest, lock, mirror, and
license changes as one migration. Unknown content and concurrent edits must
block the transfer rather than being discarded.

For even older snapshots without repository ownership, the original migration
requires unchanged Git-tracked control files and mirror bytes from `HEAD`.
Staged additions, ignored paths, untracked directories, and changed executable
bits are preserving errors, including when `core.fileMode` is false.

### Publication and recovery

One repository lock serializes local publication and external add, remove,
sync, and list operations. The publication set is `skills-sources.json`,
`skills/`, `skills-lock.json`, and `LICENSE`. Publication records old and new
fingerprints, stages backups, and rechecks the complete set before moves.
The filesystem moves are sequential rather than an atomic multi-path rename.

A failure while moving artifacts attempts to restore the previous artifacts.
Before committing, publication compares both saved originals and installed
candidates with their expected fingerprints. Conflicts retain evidence. A failure
while persisting the committed marker reports an uncertain commit outcome and
retains the journal, lock, and backups; it does not claim a successful rollback.
Recovery may claim
an interrupted transaction only after proving that its same-host process is
dead. Time alone does not prove staleness. Recovery checks fingerprints before
restoring or removing any path.

Manual edits, an unreadable owner, a foreign host, an interrupted recovery claim,
or persistent I/O failures retain the lock, journal, and backups for inspection.
Errors identify the recovery evidence. Do not delete `.skills-sync-*` paths to
force another command through.

## License and pack boundaries

The root `LICENSE` preserves the project's original terms above the generated
bundled-skill section. Complete supplied license texts remain in that section
and lossless notice records. License-only files can be centralized under the
existing policy. Attribution files such as `NOTICE` remain inside the skill and
also contribute to the root declaration.

The renderer's local `NOTICE` includes source provenance and the complete terms
for its bundled dependencies and assets. That file travels with the assembled
standalone skill so a consumer installation retains those terms. SPDX labels,
license titles, and links alone do not substitute for supplied full terms.
Notice collection records observed material and does not certify legal
completeness beyond that material.

Git attributes preserve raw mirror and legal-text bytes across platforms.
Authored text uses LF. Formatting excludes generated mirrors, compiler outputs,
Limina metadata, reports, fixtures, and byte-preserved skill documents/assets.
Restored TypeScript source is formatted.

The root npm `files` whitelist permits `skills/`, `README.md`, and `LICENSE`.
npm also includes `package.json`. The pack check rejects unexpected paths and
missing required files. It does not publish a package. Root configs, compiler
outputs, management code, local package source, tests, and evaluation reports
remain outside the root tarball.

## CI and external sync

The Linux job installs with `--frozen-lockfile`, checks formatting and governance,
and invokes the managed compiler once. It then validates project ownership,
runs compiled unit tests, assembles artifacts, and runs compiled integration
tests. It requires Chrome and sets `AM_E2E=1` so browser tests run in this lane. Artifact checks, standalone validation, and pack validation follow.

The Windows job installs the locked SDK on Windows and receives the Linux-built
standalone skill. It uses the real SDK to install copies into consumer paths
with spaces and Unicode, checks the included scripts and `NOTICE`, and renders
from each installed copy. POSIX transaction and executable-bit behavior remains
part of the Linux baseline rather than a claim of Windows parity.

A separate Node.js 20 job receives a tar archive of the Linux-built standalone
skill and runs help and a smoke render without installing workspace dependencies.
The tar archive preserves file modes through the
[artifact upload](https://github.com/actions/upload-artifact/tree/v4#permission-loss).

The Linux and Windows jobs finish with Git status restricted to `skills/` and the managed
control files. The guard includes staged and unstaged changes, untracked files,
and ignored unknown files. Ignoring `.build/` must not make an unknown file
inside a managed skill's `.build/` directory acceptable.

The daily external sync runs only on the default branch, with
`contents: read` and checkout credentials disabled. It compiles once, invokes
the compiled external manager, validates the updated distribution, and uploads
`skills-sync-report`. No workflow commits, pushes, publishes, or adds skip-CI
messages.

The report contains the starting revision, command outcomes, tracked changes,
untracked paths, ignored paths, Git status, the sync log when available, and a
binary-capable patch. The patch includes additions as well as tracked deletions
and changes. Ignored unknown files cause failure and require inspection. Their
contents stay outside the patch. Failed sync or validation outcomes remain
failures even when report upload succeeds.

## Evaluation API

Evaluations run only on explicit request. Neither workflow dispatches an LLM
evaluation. A deterministic unit test of the runner protocol is not a model
evaluation result.

Packages provide JSON data under `evals/cases/`. Each file can contain one case,
a nonempty case array, or a `cases` property. The legacy `evals/cases.json` shape
is accepted as well. Case IDs must be unique across the selected package files. The caller supplies an external runner
as a JSON argv array and chooses the model and budget policy. For example,
after compilation, a caller can replace the runner and model in this command:

```sh
pnpm eval:compiled --skill answer-me-with-html \
	--runner '["/absolute/path/to/your-runner"]' \
	--model YOUR_MODEL \
	--budget 0.25 --max-budget 10 \
	--repetitions 3 --concurrency 1 --timeout 60000
```

The runner receives one JSON request on stdin containing `version`, `skill`,
`skillDirectory`, `case`, `model`, `repetition`, and the per-call `budget`.
It returns one JSON response on stdout with a boolean `pass` and a finite,
nonnegative `cost`. Additional response fields remain in the raw report.
The runner defines and documents its cost units and provider integration.

Preflight reserves `case count * repetitions * budget` and rejects a request
above `max-budget` before dispatch. The runner must enforce its provider-side
spending limit. A returned cost above the request budget fails that run, but
post-call validation cannot undo money already spent.

Defaults are three repetitions, concurrency one, and a 60,000 ms timeout.
The CLI limits repetitions to 100, concurrency to 32, and each timeout to
3,600,000 ms. Timeouts, malformed responses, nonzero runner exits, and failed
cases remain failed runs.

Each run writes raw requests, execution results, responses, and errors under
`reports/evals/`. `summary.json` records the model, runner argv, limits, results,
and costs. A failed call can have unknown cost. The summary's `actualCost` is
the sum of known reported costs and cannot establish the full provider bill.
Reports must distinguish runner assertions, observed model output, unavailable
traces, and untested scope. Missing execution is never a passing result.

## Migration evidence

The migration evidence location is
`~/Project/dev-server-repo/repros/skills-monorepo/`. Preserve its baseline
snapshot, staged patch, unstaged patch, commands, environment versions, logs,
and observations. Tests that claim empirical confirmation must include a
minimal reproduction and at least three independent attempts to overturn the
claim, with their conditions and results.

Integration requires an actual frozen install, governance and compiler results,
unit and artifact integration results, distribution and pack reports, and
ownership and recovery counterexamples. Windows behavior and the Node.js 20
standalone runtime require their own executed evidence. An unexecuted CI matrix
does not supply that evidence.
