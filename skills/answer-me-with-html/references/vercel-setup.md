# Set up delivery

Use this guide when the user explicitly requests delivery setup. Ordinary HTML answers start with local rendering and need no setup.

## Choose a setup path

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" status
```

Run this for the active data directory (`AM_HOME`, or `~/.agents/.answer-me-with-html` by default) before consulting memory or running a setup command. If the command fails, report the settings error and help the user resolve it. An error is not evidence that settings are missing.

If the user already asked to set up from scratch, go directly to fresh setup after reading status, without consulting memory. Otherwise, if the default directory reports `uninitialized` and settings still exist at a [previous default location](settings.md), offer to migrate and use the saved settings or set up from scratch. If they choose migration, follow the migration guide, read status again, and report the migrated mode.

1. **Saved settings (`local` or `vercel`).** Tell the user which mode is saved and offer **Use the saved configuration** or **Set up again**. Use only the on-disk settings for this decision; do not consult memory. If they keep the saved configuration, report the mode and finish without writing anything.
2. **No saved settings (`uninitialized`), with a remembered completed setup.** Consider only a completed setup for this data directory, including a previous default location if using the default. Tell the user that the settings are missing and summarize the remembered mode and any non-secret project details. Offer **Restore the previous configuration** or **Set up again**. Wait for an explicit choice before using remembered values to configure delivery. For restore, ask for any missing details and save the remembered delivery mode and, for Vercel, its project settings. This does not restore a missing publication archive.
3. **No saved settings and no remembered completed setup.** Start fresh. An unrelated archive or a setup that never completed does not qualify for restore.

Use the host's choice tool when available. Until the user chooses a path, leave settings unchanged.

## Set up from scratch

Offer **Keep HTML local** and **Publish eligible answers to my Vercel project**. When the user chooses Vercel, show these two required free-text fields together. Put each field's help and official link next to that field. Use separate prompts if the host cannot show both fields at once. If the host has no text input tool, show the two labeled fields and their help in chat and ask the user to reply with both values.

| Required field         | Help to show                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vercel team (slug)** | In the Vercel dashboard, switch to the team that owns the project and open the project. Copy the first segment after `vercel.com/` from `https://vercel.com/<team-slug>/<project-name>`. For example, enter `my-team`. [Vercel docs: find the team slug in the dashboard URL](https://vercel.com/docs/cli/open#how-it-works) |
| **Vercel project ID**  | In the same project, open **Settings → General → Project ID** and copy the full value starting with `prj_`. [Vercel docs: find your project ID](https://vercel.com/docs/project-configuration/general-settings#project-id)                                                                                                   |

If either value is missing, ask for that field again. Treat the examples as hints. Once both fields are filled, run the read-only project check with the supplied values:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" setup --team TEAM_SLUG --project-id PROJECT_ID --check-project
```

The helper runs `vercel project inspect PROJECT_ID --scope TEAM_SLUG --non-interactive --json` and checks the returned project ID and team slug. On success, use the returned project name when showing the alias choices.

If the check fails, explain the cause and reopen the relevant input with its official help above. For an unknown team, an inaccessible project, or a mismatched owner, ask the user to copy both values from the same project's dashboard and check that the CLI account has access. If the CLI is missing, signed out, or cannot reach Vercel, help the user resolve that issue and retry the same values. Rerun the check after each correction. Continue to alias selection only after the check succeeds. An alias lookup failure after that can still use **Skip**.

Before saving, list the aliases bound to the project's current production deployment:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" setup --team TEAM_SLUG --project-id PROJECT_ID --list-domains
```

Offer up to the five returned domains and **Skip (use the deployment URL)**. If `more` is true, end the list of example domains with “等” (or “and others” in English). Accept an exact hostname if the user types another alias. The save command checks its binding. If there is no current production deployment or no eligible alias, use the deployment URL. Use a numbered text list if the host prompt cannot show all options plus Skip. If discovery fails, report the error and let the user skip the alias choice.

Tell the user before they choose an alias that each later publication will update the project's production deployment and its production domains. Skip uses an immutable deployment URL. Preserve the project's existing access protection. Keep a persistent `AM_HOME` per publisher and project. For snapshot delivery, a project with existing production needs its matching publication archive or legacy record for its first snapshot.

## Validate and save

For local delivery, run:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" setup --local
```

For Vercel delivery, use an authenticated Vercel CLI that supports `api`, `deploy --prod --skip-domain --json`, and `curl`. If the user skips the alias, save with:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" setup --team TEAM_SLUG --project-id PROJECT_ID
```

If the user selects an alias, add `--alias-domain SELECTED_HOSTNAME`. The helper saves it as the delivery alias. Later publications build from the current production gallery, verify the new deployment, then promote it and check the selected alias. Follow the [link and access reporting rules](vercel-shared.md#report-deployment-and-access-separately) for the result. [Vercel CLI documentation](https://vercel.com/docs/cli)

If status was `uninitialized`, add `--if-uninitialized` to the save command so it cannot overwrite settings saved while waiting for the user's choice. If the helper reports that delivery is already set up, read status again and offer the saved-settings choices.

The helper checks the project identity again before saving. If the final check fails, return to the input guidance above. `setup --local` retains the on-disk project binding and archive for later reuse. Use a separate `AM_HOME` for another project so each project keeps its own archive.

If validation fails, report the cause. When it succeeds, report the saved mode and settings path.

Delivery settings are stored in `$AM_HOME/publish-vercel.md`. The default data directory is `~/.agents/.answer-me-with-html`. The helper writes the settings with owner-only permissions on POSIX systems. See [settings and maintenance](settings.md) to move data from an earlier default directory.

The Markdown file records delivery mode and project details. If it is absent, the helper checks for `answer-me-with-html-vercel.md`, `answer-me-with-html.md`, and `vercel-shared-project.json`, in that order, in the same data directory. A legacy JSON binding without an explicit mode delivers locally until the user chooses Vercel. The next successful settings write uses `publish-vercel.md`.
