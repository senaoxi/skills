# Skills

A template for syncing and distributing agent skills. The `skills/` directory
contains all skills from [backnotprop/pstack](https://github.com/backnotprop/pstack),
including their references, scripts, and resources.

## Setup

Requires Node.js 24 or later, pnpm, and Git. The pnpm version is pinned in
`package.json`.

```sh
pnpm install --frozen-lockfile
```

## Sync

```sh
pnpm sync
```

Configure GitHub repositories and their branches, tags, or commit SHAs in
[skills-sources.json](./skills-sources.json). Every configured source contributes
all its skills. To add a source, add its repository and `ref` to this file.

Each sync resolves the configured refs to commits and uses the `skills` API to
install into a temporary directory with the neutral `universal` target. It reads
license and attribution files from those same commits through Git, including `LICENSE`,
`LICENCE`, `COPYING`, `NOTICE`, `AUTHORS`, and `LICENSES/` collections. Relevant
files in the repository root, skill ancestors, and bundled skill subdirectories
are included; unrelated skill directories are excluded.

The root `LICENSE` keeps the project's own license before the
`# Licenses of bundled skills` heading. Everything below that heading is generated:
repository, resolved commit, upstream file links, and full notice texts. Copyright
holders and license terms come from those texts; no author or license type needs
to be configured manually.

After all downloads and installations succeed, the script replaces `skills/`,
`skills-lock.json`, and `LICENSE`. Removed sources lose their skills and notices.
Missing licenses, partial installations, and colliding skill names stop the sync
before publication. Transient network failures get at most three attempts.
File replacement errors trigger rollback; if rollback fails,
the original files remain in a reported backup directory. Simultaneous syncs are
rejected by a local lock. An interrupted process may leave `.skills-sync-*`
directories to inspect before retrying.

Only GitHub repository sources are supported. Every skill needs a license file
in its directory or an ancestor, or an applicable `LICENSES/` collection. A license
identifier in frontmatter alone does not supply the required full notice text.
License collection uses a temporary Git object database fetched at the resolved
commit, then reads its tree and blobs. It follows your existing Git authentication
and proxy configuration. Each repository requires one additional shallow fetch
for its notice files.
The shell entry point enables [Node's environment proxy support](https://nodejs.org/learn/http/enterprise-network-configuration)
so configured HTTP and HTTPS proxies also apply to the skills library's requests.

## Install skills

Install from a local checkout:

```sh
pnpm skills add . --skill '*' --yes
```

After publishing your copy to GitHub, replace `<owner>/<repo>` with its location:

```sh
npx skills add <owner>/<repo> --skill '*' --yes
```

## Automation

- CI checks formatting, shell syntax, and sync tests on pushes and pull requests.
- The sync workflow runs daily, when its configuration changes on the default
  branch, or manually through `workflow_dispatch`.
- Automatic sync commits require GitHub Actions to have write access to repository
  contents. Branch protection rules may require manual updates instead.

```sh
pnpm fmt
pnpm fmt:check
bash -n sync.sh
pnpm test
```

## License

The infrastructure template uses the MIT License. The root [LICENSE](./LICENSE)
also contains the source attribution and full upstream license text for all
bundled Pstack skills.
