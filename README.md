# Skills

This repository collects reusable skills for coding agents. Browse the [skill catalog](skills/)
for skills maintained here and skills mirrored from other repositories.

## Install a skill

The [Skills CLI](https://github.com/vercel-labs/skills) requires Node.js 22.20 or later.
Run the command from the project where you'll use the skill.

```sh
npx skills add "/path/to/skills" --skill "<skill-name>"
```

Replace `/path/to/skills` with the path to your checkout. Use the name in the
skill's `SKILL.md` for `<skill-name>`. See that file for usage and any other requirements.

After [setting up the workspace](#contributing), run `pnpm skills sync --global`
to copy all bundled skills to `~/.agents/skills/`. The command asks before replacing
existing skills with the same name.

## Contributing

Use Git and the Node.js and pnpm versions in [`package.json`](package.json).
Run these commands from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Keep the source for skills maintained here, including forks, under [`packages/`](packages/).
Include the rebuilt files under [`skills/`](skills/) with your source changes.
Run `pnpm skills help` for commands to manage external mirrors.
See the [maintainer guide](docs/engineering/skills-monorepo.md) for build and distribution details.

## License

This project is licensed under the [MIT License](LICENSE). See the
[bundled skill licenses and notices](skills/THIRD-PARTY-NOTICES.md) for upstream terms.
