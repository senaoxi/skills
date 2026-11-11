# Skills Infrastructure Template

A template for syncing and distributing agent skills. The `skills/` directory
contains all skills from [backnotprop/pstack](https://github.com/backnotprop/pstack),
including their references, scripts, and resources.

## Setup

Requires Node.js 24 or later, pnpm, Git, and curl. The pnpm version is pinned in
`package.json`.

```sh
pnpm install --frozen-lockfile
```

## Sync

```sh
pnpm sync
```

The sync script uses the `skills` CLI without selecting an agent. It installs into
a temporary directory, then replaces `skills/`, `skills-lock.json`, and the
upstream license after downloading successfully. Each sync removes skills that
are no longer provided by the source.

To adapt this template, edit the source in [sync.sh](./sync.sh) and update its
license download and documentation. Keep source-specific licenses in `licenses/`.

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

- CI checks formatting and shell syntax on pushes and pull requests.
- The sync workflow runs daily, when its configuration changes on the default
  branch, or manually through `workflow_dispatch`.
- Automatic sync commits require GitHub Actions to have write access to repository
  contents. Branch protection rules may require manual updates instead.

```sh
pnpm fmt
pnpm fmt:check
bash -n sync.sh
```

## License

The infrastructure template uses the [MIT License](./LICENSE). The mirrored
Pstack skills retain their [upstream MIT License](./licenses/pstack.LICENSE).
