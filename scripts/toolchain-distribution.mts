import { lstat, readFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import ts from "typescript";
import { parseDocument } from "yaml";
import {
  distributionExcluded,
  exists,
  filesUnder,
  inside,
  nonempty,
  object,
  physicalPath,
  slug,
} from "./toolchain-core.mjs";
import { discoverSkills, selectSkills, skillResources } from "./toolchain-projects.mjs";

export function skillFrontmatter(text: string, expectedName?: string): Record<string, unknown> {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match?.[1]) throw new Error("SKILL.md must start with YAML frontmatter");
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length)
    throw new Error(
      `Invalid skill frontmatter: ${document.errors.map((error) => error.message).join("; ")}`,
    );
  const raw: unknown = document.toJS({ maxAliasCount: 20 });
  const metadata = object(raw, "skill frontmatter");
  const name = slug(metadata.name);
  if (expectedName !== undefined && name !== expectedName)
    throw new Error(`Frontmatter name ${name} does not match skillBuild.name ${expectedName}`);
  const description = nonempty(metadata.description, "skill description");
  if (description.length > 1024) throw new Error("Skill description exceeds 1024 characters");
  return metadata;
}

function markdownReferences(text: string): string[] {
  const body = text
    .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "")
    .replace(/(`+)[\s\S]*?\1/g, "");
  const links: string[] = [];
  for (const pattern of [
    /!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g,
    /^\s*\[(?!\^)[^\]\n]+\]:\s*(?:<([^>]+)>|(\S+))/gm,
  ]) {
    for (const match of body.matchAll(pattern)) {
      const target = match[1] ?? match[2];
      if (target) links.push(target);
    }
  }
  return [...links, ...markupReferences(body)];
}

function markupReferences(text: string): string[] {
  const markup = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|style|textarea|title)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>[\s\S]*?<\/\1\s*>/gi,
      "<$1$2>",
    );
  const references: string[] = [];
  const entities: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    sol: "/",
    bsol: "\\",
    colon: ":",
    period: ".",
    num: "#",
    quest: "?",
    percnt: "%",
    tab: "\t",
    newline: "\n",
  };
  for (const tag of markup.matchAll(/<[a-z][\w:-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    for (const attribute of tag[0].matchAll(
      /\s(?:src|href|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
    )) {
      const raw = attribute[1] ?? attribute[2] ?? attribute[3] ?? "";
      let unknownEntity = false;
      const target = raw
        .replace(
          /&#(x[\da-f]+|\d+);?|&([a-z][\da-z]*);/gi,
          (entity: string, numeric: string | undefined, named: string | undefined): string => {
            if (numeric !== undefined) {
              const code = /^x/i.test(numeric)
                ? Number.parseInt(numeric.slice(1), 16)
                : Number.parseInt(numeric, 10);
              if (
                !Number.isSafeInteger(code) ||
                code <= 0 ||
                code > 0x10ffff ||
                (code >= 0xd800 && code <= 0xdfff)
              )
                throw new Error(`Invalid character reference: ${raw}`);
              return String.fromCodePoint(code);
            }
            const decoded =
              named !== undefined && Object.hasOwn(entities, named.toLowerCase())
                ? entities[named.toLowerCase()]
                : undefined;
            if (decoded === undefined) unknownEntity = true;
            return decoded ?? entity;
          },
        )
        .trim()
        .replace(/[\t\r\n]/g, "");
      if (unknownEntity && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target))
        throw new Error(
          `Unsupported HTML entity in local reference: ${raw}; use a numeric reference`,
        );
      references.push(target);
    }
  }
  return references;
}

async function validateReference(directory: string, file: string, target: string): Promise<void> {
  if (/^[a-z]:[/\\]/i.test(target))
    throw new Error(`Local reference escapes skill root: ${file}: ${target}`);
  if (target.startsWith("#") || target.startsWith("?") || target.startsWith("//")) return;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    if (/^file:/i.test(target))
      throw new Error(`File URL is not local to the skill: ${file}: ${target}`);
    return;
  }
  let path: string;
  try {
    path = decodeURIComponent(target.split(/[?#]/, 1)[0] ?? "").replace(/\\([()\s])/g, "$1");
  } catch {
    throw new Error(`Invalid local reference: ${file}: ${target}`);
  }
  if (!path) return;
  const absolute = resolve(dirname(resolve(directory, file)), path);
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    /^[a-z]:/i.test(path) ||
    !inside(directory, absolute)
  )
    throw new Error(`Local reference escapes skill root: ${file}: ${target}`);
  await physicalPath(directory, absolute);
  if (!(await exists(absolute)) || (path.endsWith("/") && !(await lstat(absolute)).isDirectory()))
    throw new Error(`Missing local reference: ${file}: ${target}`);
}

type RuntimeReference = { target: string; kind: "import" | "require" };
function runtimeReferences(file: string, text: string): RuntimeReference[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const creators = new Set<string>();
  const loaders = new Set(["require"]);
  for (const node of source.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteralLike(node.moduleSpecifier) ||
      !["node:module", "module"].includes(node.moduleSpecifier.text)
    )
      continue;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const entry of bindings.elements)
        if ((entry.propertyName ?? entry.name).text === "createRequire")
          creators.add(entry.name.text);
  }
  const findLoaders = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      creators.has(node.initializer.expression.text)
    )
      loaders.add(node.name.text);
    ts.forEachChild(node, findLoaders);
  };
  findLoaders(source);
  const references: RuntimeReference[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      references.push({ target: node.moduleSpecifier.text, kind: "import" });
    if (
      ts.isCallExpression(node) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const expression = node.expression;
      if (expression.kind === ts.SyntaxKind.ImportKeyword)
        references.push({ target: node.arguments[0].text, kind: "import" });
      else if (
        (ts.isIdentifier(expression) &&
          (loaders.has(expression.text) || /^__require\d*$/.test(expression.text))) ||
        (ts.isPropertyAccessExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          expression.expression.text === "module" &&
          expression.name.text === "require")
      )
        references.push({ target: node.arguments[0].text, kind: "require" });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return references;
}

async function validateRuntimeReference(
  directory: string,
  file: string,
  reference: RuntimeReference,
): Promise<void> {
  const { target, kind } = reference;
  if (isBuiltin(target)) return;
  if (
    isAbsolute(target) ||
    target.includes("\\") ||
    target.includes("\0") ||
    /^[a-z][a-z\d+.-]*:/i.test(target)
  )
    throw new Error(`Absolute or unsupported runtime import: ${file}: ${target}`);
  if (!target.startsWith("./") && !target.startsWith("../"))
    throw new Error(
      `Undeclared bare runtime dependency: ${file}: ${target}; bundle it into the artifact`,
    );
  let path = target;
  if (kind === "import") {
    try {
      if (/%(?:2f|5c)/i.test(target)) throw new Error("Encoded path separator");
      path = decodeURIComponent(target.split(/[?#]/, 1)[0] ?? "");
    } catch {
      throw new Error(`Invalid runtime import: ${file}: ${target}`);
    }
  }
  const absolute = resolve(dirname(resolve(directory, file)), path);
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    !inside(directory, absolute)
  )
    throw new Error(`Runtime import escapes skill root: ${file}: ${target}`);
  const candidates =
    kind === "require"
      ? [
          absolute,
          ...[".js", ".json", ".node"].map((extension) => absolute + extension),
          ...["index.js", "index.json", "index.node"].map((name) => resolve(absolute, name)),
        ]
      : [absolute];
  for (const candidate of candidates) {
    await physicalPath(directory, candidate);
    if ((await exists(candidate)) && (await lstat(candidate)).isFile()) return;
  }
  throw new Error(`Missing runtime import: ${file}: ${target}`);
}

/** Check declared resources, static links and literal JavaScript loader edges.
 * Runtime npm dependencies must be bundled into this manifest-free artifact.
 * Computed paths/custom loaders still need resource declarations and SDK consumer tests.
 */
export async function validateSkillDirectory(
  directory: string,
  expectedName?: string,
  resources: readonly string[] = [],
): Promise<{ name: string; files: number }> {
  const files = await filesUnder(directory);
  if (!files.includes("SKILL.md")) throw new Error(`Missing SKILL.md in ${directory}`);
  const metadata = skillFrontmatter(
    await readFile(resolve(directory, "SKILL.md"), "utf8"),
    expectedName,
  );
  for (const resource of skillResources(resources)) {
    const path = resolve(directory, resource);
    await physicalPath(directory, path);
    if (!(await exists(path))) throw new Error(`Missing declared skill resource: ${resource}`);
  }
  for (const file of files) {
    if (distributionExcluded(file)) throw new Error(`Forbidden distribution file: ${file}`);
    if (/\.(?:md|html?|svg)$/i.test(file)) {
      const text = await readFile(resolve(directory, file), "utf8");
      for (const target of /\.md$/i.test(file) ? markdownReferences(text) : markupReferences(text))
        await validateReference(directory, file, target);
    } else if (/\.[cm]?js$/i.test(file))
      for (const reference of runtimeReferences(
        file,
        await readFile(resolve(directory, file), "utf8"),
      ))
        await validateRuntimeReference(directory, file, reference);
  }
  return { name: slug(metadata.name), files: files.length };
}

export async function validateDistributions(
  root: string,
  name?: string,
): Promise<{ skills: number; files: number }> {
  const packages = selectSkills(await discoverSkills(root), name);
  let files = 0;
  for (const pkg of packages) {
    const directory = resolve(root, "skills", pkg.name);
    await physicalPath(root, directory);
    files += (await validateSkillDirectory(directory, pkg.name, pkg.resources)).files;
  }
  return { skills: packages.length, files };
}
