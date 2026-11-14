# Package integration contract

Package conveniences delegate to `pnpm -w run skill answer-me-with-html build|test|eval`.
Root owns native compilation, compiler evidence and the successful-build receipt.
`artifact:prepare` remains `node .build/scripts/assemble.mjs`; it never compiles
TypeScript. No manifest is copied into the skill distribution.

## Disposable views: version 2

`SKILL_BUILD_OUTPUT_MANIFEST` points to the generic producer's JSON:

```ts
{
  version: 2;
  repositoryRoot: string;
  packageRoot: string;
  viewRoot: string;
  compileReceipt: {
    path: string;
    inputHash: string;
    outputHash: string;
  }
  files: {
    source: string;
    project: string;
    output: string;
    originalOutput: string;
    sha256: string;
  }
  [];
  dependencyFiles: {
    path: string;
    sha256: string;
  }
  [];
}
```

Paths are real absolute paths. Only `files[].output` grants access to owned
JavaScript in the current view. `originalOutput` proves the mapping against the
global receipt; it never authorizes importing an original output outside the
view. Source/project identity, cloned relative output path, manifest hash, global
output hash, current bytes and executable mode must agree. Inputs are hashed
again when consumed and inspected through the esbuild metafile.

## Direct compiled tests: version 1 fallback

Without the environment manifest, the consumer reads the package's
`.build/source-outputs.json`:

```ts
{
  version: 1;
  files: {
    source: string;
    output: string;
    project: string;
  }
  [];
  compileReceipt: {
    path: string;
    inputHash: string;
    outputHash: string;
  }
}
```

This fallback must describe the original package at that exact fallback path.
It requires the generated global `.build/toolchain/compile-receipt.json`, with
matching input/output fingerprints and all successfully compiled package output
mappings. Missing pointers, missing global receipts, incomplete hand-written
maps, inconsistent receipt checksums, changed recorded source/config/dependency
bytes and changed dependency links fail closed. Leftover package metadata cannot
substitute for an invalidated global receipt.

Both versions validate the supplied successful snapshot rather than reconstruct
a TypeScript graph. Root remains responsible for native compiler evidence and
current source/config membership. The consumer verifies the existing receipt's
recorded input/output hashes and current bytes; it has no transpiler or second
source resolver.

## Dependencies

Version 2's exact `dependencyFiles` map must match the successful global receipt.
The fallback takes that same map from the global receipt. Every consumed
third-party file, including deferred Temml and font/CSS resources, must match its
recorded SHA-256. Existing declared pnpm dependency-closure and installed-root
checks remain mandatory as well: global installed dependencies do not become
package dependencies merely because they appear in a receipt. Unknown virtual
modules, vendor symlink escapes and unbundled runtime imports still fail.

The build-only YAML parser is pinned `yaml@2.9.1`; no runtime dependency was added.
Browser and assembly suites use `*.integration.test.mts`; `AM_E2E=1` requires
Chrome. Eval data lives in `evals/cases/`. Root owns final native/Chrome acceptance.
