# Set up delivery

Use this guide when the user explicitly requests delivery setup. Ordinary HTML answers start with local rendering and need no setup.

## Read the current mode

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" status
```

The command reports `uninitialized`, `local`, or `vercel`. Both `uninitialized` and `local` deliver locally. Show the current mode and let the user choose.

## Ask the user

Offer **Keep HTML local** and **Publish eligible answers to my Vercel project**. Use the host's choice tool when available. The second option creates an immutable gallery snapshot in a dedicated Vercel project. It does not promote deployments or update the production domain. Preserve the project's existing access protection. Keep a persistent `AM_HOME` per publisher and project. A project with existing production needs its matching publication archive or legacy record for its first snapshot. Separate publishers can have different snapshot histories.

For Vercel, collect the team slug, existing project name, project ID, and an optional preferred HTTPS origin to check separately. The project ID is in the Vercel dashboard under the project's general settings. Give the user the terminal command below if they prefer to enter these details locally. Authentication stays with the Vercel CLI. [Vercel project settings](https://vercel.com/docs/project-configuration/general-settings)

Retain the saved mode when the user makes no new choice.

## Validate and save

Save local delivery with this command.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" setup --local
```

For Vercel delivery, use an authenticated Vercel CLI that supports `api`, `deploy --prod --skip-domain --json`, and `curl`. Run this with the user's project details. Add `--public-origin` when the user supplies a preferred origin. [Vercel CLI documentation](https://vercel.com/docs/cli)

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" setup --team TEAM_SLUG --project PROJECT_NAME --project-id PROJECT_ID
```

The helper checks the project identity before saving. `setup --local` retains the project binding and archive for later reuse. Use a separate `AM_HOME` for another project so each project keeps its own archive.

If validation fails, report the cause. When it succeeds, report the saved mode and settings path.

All hosts use `~/.agents/answer-me-with-html-vercel.md` for delivery settings associated with the default archive. If `AM_HOME` points to a different data directory, the settings file is `$AM_HOME/answer-me-with-html-vercel.md` and applies to that archive. Keep the settings and archive outside shared repositories. The helper writes the settings with owner-only permissions on POSIX systems.

The Markdown file records delivery mode and project details. If it is absent, the helper checks the previous Markdown name, `answer-me-with-html.md`, then `$AM_HOME/vercel-shared-project.json`. A legacy binding without an explicit mode delivers locally until the user chooses Vercel. The next successful setup writes the new settings file.
