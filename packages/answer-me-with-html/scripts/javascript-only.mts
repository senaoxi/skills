import { builtinModules, createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Metafile, Plugin } from "esbuild";
import { compiledInputs, pathKey, within } from "./input-manifest.mjs";
import { lockedDependencies } from "./locked-dependencies.mjs";

const typescript = /\.(?:[cm]?ts|tsx)$/i;
export interface JavaScriptInputs {
  assertInput(path: string, namespace?: string): void;
  resolveDependency(specifier: string): string;
}

/** Only current native outputs and this package's locked dependency closure enter esbuild. */
export function javaScriptInputs(packageRoot: string, manifestFile?: string): JavaScriptInputs {
  const compiled = compiledInputs(packageRoot, manifestFile);
  const dependencies = lockedDependencies(compiled.originalPackageRoot);
  const need = createRequire(join(compiled.originalPackageRoot, "package.json"));
  function dependency(path: string) {
    return dependencies.find(
      (item) =>
        within(item.directory, path) &&
        !relative(item.directory, path).split(/[\\/]/).includes("node_modules"),
    );
  }
  const resolveDependency = (specifier: string): string => {
    const path = realpathSync(need.resolve(specifier));
    if (!dependency(path))
      throw new Error(`Input is outside the declared locked dependency closure: ${path}`);
    compiled.assertDependency(path);
    return path;
  };
  function assertInput(path: string, namespace = "file"): void {
    if (namespace === "deferred-temml" && path === "temml") {
      resolveDependency("temml/dist/temml.min.js");
      return;
    }
    if (namespace !== "file")
      throw new Error(`Unapproved assembly input namespace: ${namespace}:${path}`);
    if (typescript.test(path))
      throw new Error(`Native TypeScript compilation required before assembly: ${path}`);
    const physical = realpathSync(path);
    if (typescript.test(physical))
      throw new Error(`Native TypeScript compilation required before assembly: ${physical}`);
    if (compiled.outputs.has(pathKey(physical))) {
      compiled.assertOutput(physical);
      return;
    }
    if (within(compiled.packageRoot, physical) && !dependency(physical))
      throw new Error(`JavaScript input is not in the current compiled output manifest: ${path}`);
    if (!dependency(physical))
      throw new Error(`Input is outside the current package view and locked dependencies: ${path}`);
    compiled.assertDependency(physical);
  }
  return { assertInput, resolveDependency };
}

export function javascriptOnly(inputs: JavaScriptInputs): Plugin {
  return {
    name: "current-native-javascript-only",
    setup(build) {
      build.onLoad({ filter: /.*/ }, ({ path, namespace }) => {
        inputs.assertInput(path, namespace);
        return undefined;
      });
    },
  };
}

export function assertJavaScriptInputs(
  metafile: Metafile,
  inputs: JavaScriptInputs,
  cwd: string,
  platform: "node" | "browser" = "node",
): void {
  for (const input of Object.keys(metafile.inputs)) {
    if (input.startsWith("deferred-temml:"))
      inputs.assertInput(input.slice("deferred-temml:".length), "deferred-temml");
    else inputs.assertInput(resolve(cwd, input));
  }
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  for (const output of Object.values(metafile.outputs))
    for (const item of output.imports) {
      if (item.external && (platform !== "node" || !builtins.has(item.path)))
        throw new Error(`Unbundled runtime dependency: ${item.path}`);
    }
}
