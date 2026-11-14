# Customized renderer source

This private workspace package restores the renderer as strict TypeScript modules
from upstream `edccab07c012e2141585f8ddb18a62e01664fa2b` (0.5.11). The customized
working-tree skill captured before migration is the behavioral authority.
`PROVENANCE.json` records its hashes and the source mapping. No previous renderer
bundle is retained as source or consumed by assembly.

`src/node` owns the CLI, renderer, components, themes, publishing and Node I/O.
`src/browser` owns DOM interactions and browser media/export adapters.
`src/shared` owns pure layout/reply/remark helpers and the WebM writer, with no
Node or DOM ambient types. Every source import uses its emitted `.mjs` name.
The project aggregates have `files: []` and references; leaves own nonempty input
sets and `liminaOptions.outputs` without hand-written project references.

Use the workspace task conveniences (the root wrapper compiles all runtime sources
through Limina 0.5.0 / TypeScript 6.0.3 before dispatch):

```sh
pnpm -w run skill answer-me-with-html build
pnpm -w run skill answer-me-with-html test --kind unit
pnpm -w run skill answer-me-with-html test --kind integration
```

For direct assembly, first run the root native build and successful-receipt step.
It writes `.build/source-outputs.json` for this package. Then assemble only emitted
JavaScript with esbuild 0.28.2:

```sh
pnpm -w run build:ts
stage=$(mktemp -d)
node packages/answer-me-with-html/.build/scripts/assemble.mjs --out "$stage"
```

`--out` must name an empty, absolute directory under the operating system's
temporary directory. Assembly writes only within it. The output includes the
unchanged static `skill/` content, standalone `scripts/am.mjs`, `publish.mjs`,
`publish-html.mjs`, and a `NOTICE` containing complete bundled license terms.
Neither a package installation nor a network connection is needed to run these
entry scripts with Node 20. Chrome, ffmpeg, system speech and explicitly selected
remote providers retain their existing optional feature requirements.

Both an esbuild plugin and metafile inspection require every own JavaScript input
to appear in the current native output manifest. Absolute imports of original
source or stale cache files cannot escape a disposable package view. Other inputs
must belong to the declared dependency closure in the existing pnpm lockfile;
unregistered packages, vendor symlink escapes and unknown virtual modules fail.
The guard consumes the native output mapping without constructing a second
TypeScript graph or transpiling TypeScript. See `INTEGRATION.md` for the manifest
and receipt handshake.
Browser runtimes are assembled separately from their native `.mjs` outputs and
inlined along with CSS and font data. Temml retains deferred compilation for math
input. The package version is 0.0.0; CLI compatibility version remains 0.5.11.

Run the already compiled tests:

```sh
node .build/scripts/run-tests.mjs --skill answer-me-with-html --kind unit
AM_E2E=1 node .build/scripts/run-tests.mjs --skill answer-me-with-html --kind integration
```

Tests assemble their own temporary standalone artifacts. The renderer suite checks
20 pre-migration page/video document digests, preserving CSS, font data, DOM/SVG, localization
and source drafts; it excludes executable script bodies and their CSP meta
because module assembly changes JavaScript formatting; it normalizes the video
title date cell. Separate checks bind CSP
to the actual generated script, exercise all component examples, reject invalid
counts and enforce standalone assembly. Publisher tests cover the existing custom
review, metadata removal, locks, recovery and gallery preservation using local
Vercel/fetch stubs. Browser and assembly suites use `*.integration.test.mts`.
`AM_E2E=1` requires Chrome and fails when it is missing; ordinary optional runs
remain opt-in. Browser tests exercise real Chrome when enabled. `AM_TEST_NODE20`
may point to a Node 20 binary for the isolated runtime test.

Compiled test fixtures write a `.renderer-assets.json` only in their temporary test directory. Directly
importing the development renderer requires `AM_RENDERER_ASSETS` to point to that
file; assembled scripts embed the same asset data and never load it at runtime.

Package `pnpm run build`, `test`, and `eval` forward to the matching root skill task.
`evals/cases/*.json` contains seven data-only scenarios and explicit grading criteria.
An actual eval requires the caller to provide a runner, model and budget settings;
case-data validation never invokes a model. See `evals/README.md`.
