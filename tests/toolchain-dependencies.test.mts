import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { dependencySnapshot } from "../scripts/toolchain-dependencies.mjs";

async function put(path: string, value: string | object): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(t: TestContext, manifest: object = {}): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "active-dependencies-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await put(resolve(root, "package.json"), { name: "fixture-root", private: true, ...manifest });
  await lock(root, []);
  return realpath(root);
}

async function lock(root: string, identities: string[]): Promise<void> {
  await put(
    resolve(root, "pnpm-lock.yaml"),
    `---\nlockfileVersion: '9.0'\npackages:\n  pnpm@12.18.0: {}\n---\nlockfileVersion: '9.0'\npackages: ${identities.length ? `\n${identities.map((identity) => `  ${JSON.stringify(identity)}: {}`).join("\n")}` : "{}"}\n`,
  );
}

async function installed(
  root: string,
  name: string,
  metadata: object = {},
  version = "1.0.0",
): Promise<string> {
  const path = resolve(
    root,
    "node_modules/.pnpm",
    `${name.replaceAll("/", "+")}@${version}`,
    "node_modules",
    name,
  );
  await put(resolve(path, "package.json"), { name, version, ...metadata });
  await put(resolve(path, "index.mjs"), `export const value = ${JSON.stringify(name)};\n`);
  await put(resolve(path, "index.d.mts"), "export declare const value: string;\n");
  return path;
}

async function link(path: string, target: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await symlink(target, path, process.platform === "win32" ? "junction" : "dir");
}

function rel(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

test("last workspace removal ignores its retained virtual-store package after pnpm prunes the lock", async (t) => {
  const root = await fixture(t, { devDependencies: { tool: "1.0.0" } });
  const tool = await installed(root, "tool");
  const temml = await installed(root, "temml", {}, "0.14.0");
  await link(resolve(root, "node_modules/tool"), tool);
  await link(resolve(root, "node_modules/.pnpm/node_modules/temml"), temml);
  await lock(root, ["tool@1.0.0", "temml@0.14.0"]);
  const workspace = resolve(root, "packages/renderer");
  await put(resolve(workspace, "package.json"), {
    name: "renderer",
    private: true,
    dependencies: { temml: "0.14.0" },
  });
  await link(resolve(workspace, "node_modules/temml"), temml);
  const rootOnly = await dependencySnapshot(root, []);
  assert.ok(
    (await dependencySnapshot(root, [workspace])).allowed.some((file) =>
      file.path.startsWith(temml),
    ),
  );
  await rm(resolve(root, "packages"), { recursive: true });
  await lock(root, ["tool@1.0.0"]);
  const after = await dependencySnapshot(root, []);
  assert.deepEqual(after, rootOnly);
  assert.ok(!after.files.some((file) => file.path.includes("temml")));
  assert.ok(!after.links.some((file) => file.path.includes("temml")));
});

test("unreachable cache bytes and broken private-hoist links do not change the active snapshot", async (t) => {
  const root = await fixture(t, { dependencies: { tool: "1.0.0" } });
  const tool = await installed(root, "tool");
  await link(resolve(root, "node_modules/tool"), tool);
  await lock(root, ["tool@1.0.0"]);
  const before = await dependencySnapshot(root, []);
  const cached = await installed(root, "removed");
  await link(resolve(cached, "broken"), resolve(root, "gone"));
  await link(resolve(root, "node_modules/.pnpm/node_modules/orphan"), resolve(root, "gone"));
  await put(resolve(root, "node_modules/.pnpm/lock.yaml"), "retained store index\n");
  assert.deepEqual(await dependencySnapshot(root, []), before);
});

test("the same retained package actively linked at a visible entry must be locked", async (t) => {
  for (const declared of [false, true]) {
    const root = await fixture(t, declared ? { dependencies: { temml: "0.14.0" } } : {});
    const temml = await installed(root, "temml", {}, "0.14.0");
    await link(resolve(root, "node_modules/temml"), temml);
    await assert.rejects(dependencySnapshot(root, []), /absent from pnpm lock: temml@0\.14\.0/);
  }
});

test("an active transitive link into the virtual store cannot bypass lock validation", async (t) => {
  const root = await fixture(t, { dependencies: { app: "1.0.0" } });
  const app = await installed(root, "app", { dependencies: { temml: "0.14.0" } });
  const temml = await installed(root, "temml", {}, "0.14.0");
  await link(resolve(root, "node_modules/app"), app);
  await link(resolve(dirname(app), "temml"), temml);
  await lock(root, ["app@1.0.0"]);
  await assert.rejects(dependencySnapshot(root, []), /absent from pnpm lock: temml@0\.14\.0/);
});

test("active closure includes runtime, type, peer and installed optional dependencies with content/link evidence", async (t) => {
  const root = await fixture(t, { devDependencies: { app: "1.0.0" } });
  const app = await installed(root, "app", {
    dependencies: { runtime: "1.0.0", "@types/runtime": "1.0.0" },
    devDependencies: { unpublishedBuildTool: "1.0.0" },
    optionalDependencies: { present: "1.0.0", absent: "1.0.0" },
    peerDependencies: { peer: "1.0.0", optionalPeer: "1.0.0" },
    peerDependenciesMeta: { optionalPeer: { optional: true } },
  });
  await link(resolve(root, "node_modules/app"), app);
  const dependencies = [];
  for (const name of ["runtime", "@types/runtime", "present", "peer"]) {
    const path = await installed(
      root,
      name,
      name === "runtime" ? { dependencies: { app: "1.0.0" } } : {},
    );
    dependencies.push(path);
    await link(resolve(dirname(app), name), path);
  }
  await lock(
    root,
    ["app", "runtime", "@types/runtime", "present", "peer"].map((name) => `${name}@1.0.0`),
  );
  const runtime = dependencies[0];
  assert.ok(runtime);
  const file = resolve(runtime, "index.d.mts");
  await chmod(resolve(runtime, "index.mjs"), 0o755);
  const before = await dependencySnapshot(root, []);
  assert.equal(before.allowed.length, 15);
  assert.ok(
    before.files.some((entry) => entry.path === resolve(runtime, "index.mjs") && entry.executable),
  );
  const expected = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  assert.equal(before.allowed.find((entry) => entry.path === file)?.sha256, expected);
  assert.ok(
    before.links.some(
      (entry) => entry.path === "node_modules/app" && entry.target === rel(root, app),
    ),
  );
  assert.ok(
    before.links.some((entry) => entry.path === rel(root, resolve(dirname(app), "runtime"))),
  );
  const stat = await lstat(file);
  await put(file, "export declare const changed: true;\n");
  await utimes(file, stat.atime, stat.mtime);
  assert.notEqual(
    (await dependencySnapshot(root, [])).allowed.find((entry) => entry.path === file)?.sha256,
    expected,
  );
});

test("missing required runtime and peer packages reject, but absent optional packages are allowed", async (t) => {
  for (const field of ["dependencies", "peerDependencies"]) {
    const root = await fixture(t, { [field]: { missing: "1.0.0" } });
    await assert.rejects(dependencySnapshot(root, []), /Missing active dependency missing/);
  }
  const root = await fixture(t, {
    optionalDependencies: { missing: "1.0.0" },
    peerDependencies: { peer: "1.0.0" },
    peerDependenciesMeta: { peer: { optional: true } },
  });
  assert.deepEqual(await dependencySnapshot(root, []), { files: [], links: [], allowed: [] });
});

test("a broken active optional or required link is not treated as an uninstalled package", async (t) => {
  for (const optional of [false, true]) {
    const root = await fixture(t, { dependencies: { app: "1.0.0" } });
    const app = await installed(root, "app", {
      [optional ? "optionalDependencies" : "dependencies"]: { broken: "1.0.0" },
    });
    await link(resolve(root, "node_modules/app"), app);
    await link(resolve(dirname(app), "broken"), resolve(root, "missing-target"));
    await lock(root, ["app@1.0.0"]);
    await assert.rejects(dependencySnapshot(root, []), /ENOENT|Missing active dependency/);
  }
});

test("active direct and transitive dependencies cannot escape the repository or installed roots", async (t) => {
  for (const transitive of [false, true]) {
    const root = await fixture(t, { dependencies: { app: "1.0.0" } });
    const outside = await fixture(t);
    await put(resolve(outside, "package.json"), { name: "escaped", version: "1.0.0" });
    const app = await installed(
      root,
      "app",
      transitive ? { dependencies: { escaped: "1.0.0" } } : {},
    );
    await link(resolve(root, "node_modules/app"), app);
    await link(
      transitive ? resolve(dirname(app), "escaped") : resolve(root, "node_modules/escaped"),
      outside,
    );
    await lock(root, ["app@1.0.0", "escaped@1.0.0"]);
    await assert.rejects(dependencySnapshot(root, []), /Dependency link escapes repository/);
  }
  const root = await fixture(t);
  const target = resolve(root, "unowned-package");
  await put(resolve(target, "package.json"), { name: "escaped", version: "1.0.0" });
  await link(resolve(root, "node_modules/escaped"), target);
  await lock(root, ["escaped@1.0.0"]);
  await assert.rejects(dependencySnapshot(root, []), /escapes installed roots/);
});

test("current workspace links follow development dependencies without exposing owned source as third-party bytes", async (t) => {
  const root = await fixture(t, { dependencies: { "@workspace/current": "workspace:*" } });
  const workspace = resolve(root, "packages/current");
  await put(resolve(workspace, "package.json"), {
    name: "@workspace/current",
    private: true,
    devDependencies: { compiler: "1.0.0" },
  });
  await put(resolve(workspace, "source.mts"), "export const source = true;\n");
  const compiler = await installed(root, "compiler");
  await link(resolve(root, "node_modules/@workspace/current"), workspace);
  await link(resolve(workspace, "node_modules/compiler"), compiler);
  await lock(root, ["compiler@1.0.0"]);
  const state = await dependencySnapshot(root, [workspace]);
  assert.equal(state.allowed.length, 3);
  assert.ok(!state.allowed.some((file) => file.path.startsWith(workspace)));
  assert.ok(state.links.some((entry) => entry.path === "node_modules/@workspace/current"));
});

test("package aliases require declared npm identity and mismatched active packages reject", async (t) => {
  const root = await fixture(t, { dependencies: { compat: "npm:runtime@1.0.0" } });
  const runtime = await installed(root, "runtime");
  await link(resolve(root, "node_modules/compat"), runtime);
  await lock(root, ["runtime@1.0.0"]);
  assert.equal((await dependencySnapshot(root, [])).allowed.length, 3);
  await put(resolve(root, "package.json"), {
    name: "fixture-root",
    dependencies: { compat: "1.0.0" },
  });
  await assert.rejects(dependencySnapshot(root, []), /identity mismatch/);
});

test("active package resource links and executable links retain confinement and lock checks", async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  const app = await installed(root, "app");
  await link(resolve(root, "node_modules/app"), app);
  await symlink(resolve(outside, "package.json"), resolve(app, "escaped.json"));
  await lock(root, ["app@1.0.0"]);
  await assert.rejects(dependencySnapshot(root, []), /Dependency link escapes repository/);
  await rm(resolve(app, "escaped.json"));
  const orphan = await installed(root, "orphan");
  await mkdir(resolve(root, "node_modules/.bin"), { recursive: true });
  await symlink(resolve(orphan, "index.mjs"), resolve(root, "node_modules/.bin/orphan"));
  await assert.rejects(dependencySnapshot(root, []), /absent from pnpm lock: orphan@1\.0\.0/);
});

test("bundled nested payloads retain their parent lock ownership; unbundled injected children reject", async (t) => {
  const root = await fixture(t);
  const app = await installed(root, "app", {
    dependencies: { child: "1.0.0" },
    bundledDependencies: ["child"],
  });
  const child = resolve(app, "node_modules/child");
  await put(resolve(child, "package.json"), { name: "child", version: "1.0.0" });
  await put(resolve(child, "index.mjs"), "export const bundled = true;\n");
  await link(resolve(root, "node_modules/app"), app);
  await lock(root, ["app@1.0.0"]);
  assert.ok(
    (await dependencySnapshot(root, [])).allowed.some((file) => file.path.startsWith(child)),
  );
  await put(resolve(app, "package.json"), {
    name: "app",
    version: "1.0.0",
    dependencies: { child: "1.0.0" },
  });
  await assert.rejects(dependencySnapshot(root, []), /absent from pnpm lock: child@1\.0\.0/);
});

test("multi-document pnpm locks still merge and reject conflicting or duplicate package records", async (t) => {
  const root = await fixture(t);
  const app = await installed(root, "app");
  await link(resolve(root, "node_modules/app"), app);
  await lock(root, ["app@1.0.0"]);
  assert.equal((await dependencySnapshot(root, [])).allowed.length, 3);
  const text = await readFile(resolve(root, "pnpm-lock.yaml"), "utf8");
  await put(
    resolve(root, "pnpm-lock.yaml"),
    `${text}---\npackages:\n  app@1.0.0: {resolution: {integrity: conflict}}\n`,
  );
  await assert.rejects(dependencySnapshot(root, []), /Conflicting pnpm lock package/);
  await put(resolve(root, "pnpm-lock.yaml"), "---\npackages:\n  app@1.0.0: {}\n  app@1.0.0: {}\n");
  await assert.rejects(dependencySnapshot(root, []), /Invalid pnpm dependency lock/);
});
