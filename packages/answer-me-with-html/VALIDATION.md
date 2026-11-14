# Migration validation record

The initial renderer migration passed native compilation through Limina 0.5.0 and TypeScript
6.0.3, then JavaScript-only assembly through esbuild 0.28.2. Local build Node was
26.13.1; the complete compiled test set also ran with Node 20.19.0. Both runtimes
reported **59 passed, 0 failed, 2 browser-gated tests skipped** before the bounded
package-integration follow-up below. These earlier compatibility results are not
a claim of final root acceptance for the new guard and receipt wiring. No deployment,
publication, commit or push was performed.

## Authority and executable fixtures

- Upstream source: `edccab07c012e2141585f8ddb18a62e01664fa2b`, version 0.5.11.
- Customized source authority: parent snapshot
  `[local snapshot path redacted]`.
  Its 12 actual skill files matched the captured working tree byte for byte;
  macOS AppleDouble metadata members were excluded from this content comparison.
- Original hashes and module mapping: `PROVENANCE.json`.
- Retained executable reproduction: compiled `tests/*.test.mts` and
  `tests/fixtures/renderer-golden.json` in this package. Tests create isolated
  artifacts under the OS temporary directory.
- Reviewable standalone output from this run:
  `/tmp/am-full-migration/final-skill`.
- Build/test logs and additional independent controls:
  `/tmp/am-full-migration/`.

The worker sandbox allowed writes only in this repository and temporary
locations. The parent's `dev-server-repo` reproduction directory was read-only;
no new reproduction files were written there. The original bundled renderer is
absent from the migrated source tree and is never an assembly input.

## Three independent adversarial rounds

### 1. Document and rendering contracts

Intent: disprove source fidelity by varying grammar, language, template, math,
HTML filtering, fonts, diagrams and video output rather than repeating one draft.

```sh
node --test packages/answer-me-with-html/.build/tests/renderer.test.mjs
```

Result: all six tests passed on Node 20 and 26. Twenty pre-migration document
snapshots match after removing executable script bodies and their CSP meta tag
and normalizing the video title date cell. The comparison retains every other
byte, including CSS, fonts, DOM/SVG, localization, hidden drafts and video JSON.
Every generated executable script separately matches its actual CSP hash. All
14 component examples render. Malformed layout counts remain errors. Additional
regressions preserve raw theme diagnostics, catalog extensions, mixed saved
replies/remarks and JavaScript timing coercion.

Boundary: this round proves the retained output and pure-data contracts, not real
browser layout or media encoding.

### 2. Compiler, isolated runtime and state

Intent: challenge build phase separation and standalone execution through a
second runtime and filesystem path, then challenge persistence with malformed
unrelated entries and future extension fields.

```sh
node20 --test packages/answer-me-with-html/.build/tests/assembly.integration.test.mjs packages/answer-me-with-html/.build/tests/state.test.mjs
```

Here `node20` denotes the Node 20 executable; this run used
`/Users/chenjiaxiang/.nvm/versions/node/v20.19.0/bin/node`.

Result: all four tests passed. The three entry scripts run from temporary output
without `node_modules`; math renders, configuration honors both custom `AM_HOME`
and `~/.agents/.answer-me-with-html`, and publisher status works. Assembly rejects
owned TypeScript inputs, relative/non-temporary destinations and nonempty output.
Mixed invalid subsystem entries cannot erase valid state or extensions.
Additional baseline differential: 12 state cases, 60 assertions, zero mismatches.

### 3. Publication and serialization boundaries

Intent: disprove compatibility using alternate state/configuration paths, partial
journals, archive races, recovery, metadata/CSP cleaning and simulated service
failures, independently from renderer markup snapshots.

```sh
node20 --test packages/answer-me-with-html/.build/tests/publish.test.mjs packages/answer-me-with-html/.build/tests/publish-html.test.mjs
```

Result: all 49 tests passed. Vercel and fetch are local stubs; no real publishing
occurred. Four added regressions preserve opaque legacy settings, catalog extras
and accepted context records, archive validation order, and partial-journal
status/errors. Independent baseline comparisons also matched 66 publisher cases
and 469 sanitizer cases, including malformed data and truncated images.

## Final commands

```sh
pnpm exec limina build packages/answer-me-with-html/tsconfig.json --preset tsc
node packages/answer-me-with-html/.build/scripts/assemble.mjs --out /tmp/am-full-migration/final-skill
node --test packages/answer-me-with-html/.build/tests/*.test.mjs
node20 --test packages/answer-me-with-html/.build/tests/*.test.mjs
pnpm exec oxfmt --check packages/answer-me-with-html
```

The staging directory must be absent or empty for a new assembly run. Tests
assemble their own unique staging directories. The package formatter ignores the
authoritative `skill/` documents and raw CSS assets to preserve their exact bytes.

Supplementary selected upstream controls passed: 243 component/chart/ER cases,
48 config/maintenance cases and 27 export/OS cases. Five locale objects and eight
standalone CSS assets match the customized bundle exactly. Theme/catalog/TTS
boundary controls matched 156 cases. Browser/shared controls matched 24 layout,
12 reply and 8 WebM cases; 54 controlled-DOM player cases plus 880 timing-operator
checks matched upstream/native-JavaScript results or failure semantics. These
controlled-DOM checks do not substitute for the real-browser tests below.

## Remaining limits

- Worker-sandbox real-browser attempt:
  `AM_E2E=1 node --test packages/answer-me-with-html/.build/tests/browser.integration.test.mjs`.
  Both tests failed before loading a page because Chrome exited with `SIGABRT`.
  Computer Use also denied access to Google Chrome. Root subsequently recorded
  **2 passed, 0 failed, 0 skipped** outside the worker sandbox in
  `repro/browser-first.log` (coordination note, original compiled test filename).
  That run covers the unchanged desktop/mobile controls, reply/table/diagram and
  RTL/video-load tests. Root will repeat them after the new manifest guard changes.
  Actual media encoding and PDF/PNG generation remain outside that browser-load
  coverage.
- Server controls passed 57 cases with a test-only replacement for blocked OS
  uptime. Two SSE watch controls failed equally on the original and migrated
  renderer: `fs.watch` reports `EMFILE`; OS uptime reports `EPERM`. No production
  workaround was introduced for these sandbox failures.
- No remote TTS request, system speech generation, ffmpeg export, production
  service verification, remote CI, distribution sync or release was performed.
- The unchanged Temml font contains a FontCreator noncommercial metadata notice
  alongside the distributed MIT notices. Its exact embedded text and copyright
  attribution are preserved in `skill/licenses/Temml-Font-METADATA.txt` and
  `NOTICE`; their legal applicability is unresolved by this migration.

## Bounded package integration follow-up

Implemented `artifact:prepare` and root-task `build`/`test`/`eval` conveniences,
seven data-only cases under `evals/cases/`, and mandatory missing-Chrome failure
when `AM_E2E=1`. Browser and assembly suites now have integration filenames.
The obsolete compiled filenames were removed from this package's ignored cache.

The JavaScript guard now consumes `SKILL_BUILD_OUTPUT_MANIFEST` or the package
`.build/source-outputs.json` fallback. Every own JavaScript file must be one of
its current native outputs. File inputs outside that output set must be members
of the declared, version-matched pnpm lock closure under installed dependency
roots. Both plugin and metafile audit reject retained orphan JS, absolute original
TS/JS paths, undeclared packages, escaping vendor symlinks, unknown virtual modules
and unbundled runtime imports. Windows temp validation no longer resolves `/tmp`.

Compilation and focused checks used native TypeScript 6.0.3 first:

```sh
node_modules/.bin/tsc -p packages/answer-me-with-html/tests/tsconfig.json --noEmit false --rootDir /Users/chenjiaxiang/Project/skills/packages/answer-me-with-html --outDir /tmp/am-integration-native/.build --declaration false
AM_EVAL_CASES_DIR=/Users/chenjiaxiang/Project/skills/packages/answer-me-with-html/evals/cases node --test /tmp/am-integration-native/.build/tests/javascript-only.test.mjs /tmp/am-integration-native/.build/tests/browser-requirements.test.mjs /tmp/am-integration-native/.build/tests/eval-cases.test.mjs
```

Repeated the latter command with Node 20.19.0. Both Node 20 and Node 26 reported
**17 passed, 0 failed, 0 skipped**: six real-esbuild/metafile input-boundary tests,
three browser-requirement tests and eight eval data-integrity tests. The guard
fixtures model current output maps and small locked dependency installations;
they are not an alternate compiler or proof of a root successful-build receipt.
The temporary native test harness linked only installed esbuild/yaml for read-only
module resolution; no package-manager command ran in it.

Logs: `/tmp/am-full-migration/package-integration-native.log`,
`package-integration-focused-tests.log`, `package-integration-node20-tests.log`.
An initial temporary-harness run lacked esbuild resolution and was corrected;
its import failure was a harness setup issue, not a passing product check.

Root handoff remains explicit: refresh the importer for package devDependency
`yaml@2.9.1`, emit/invalidate the fallback manifest with the successful compile
receipt, enumerate `evals/cases/`, and run the root native build, actual Chrome and
full acceptance. This worker did not run root artifact publication or wait for
that acceptance, and did not invoke any model/eval runner. See `INTEGRATION.md`.

## Final manifest interface follow-up

The consumer now matches the generic producer's version-2 disposable-view
manifest and the version-1 package fallback with a global receipt pointer.
Neither path accepts an unbacked allowlist. Own view outputs and original
provenance match the successful global output records, and current file hashes
are checked again at consumption. Supplied dependency file maps must equal the
global exact map; dependency-root/lock checks remain in force. The fallback also
requires the complete package mapping and a valid, matching committed global
receipt. Root retains responsibility for native compiler evidence and fresh
source membership; this consumer does not build a source graph.

Focused tests construct isolated receipt fixtures with actual source/config,
original output, copied view output, dependency bytes and the producer's receipt
checksums/commit order. They do not install permissive production test bypasses.
They cover valid v2/v1 contracts, original-output provenance confinement,
incomplete fallback lists, missing/invalidated receipts, pointer/root/hash drift,
unregistered dependency files and preserved-mtime byte changes. Native TypeScript
compilation precedes the tests. Logs are under `/tmp/am-full-migration/` with the
`manifest-v2-` prefix. No final artifact preparation/publication, paid calls,
root-script edits, browser-test edits or package-resource edits were part of this
follow-up. Final root acceptance remains separate.

Final interface checks: native TypeScript 6.0.3 compilation passed, then the focused
manifest/guard suite passed **13 tests on Node 20.19.0 and 13 on Node 26.13.1**,
with zero failures or skips. Formatting checks cover only the owned consumer,
guard, test and interface/validation documents.
