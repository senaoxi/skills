# Set up delivery

Use this guide for a setup request or when an explicit publish request needs a valid destination. Ordinary HTML answers are delivered as local files.
An explicit publish request with a verified saved Vercel destination follows the [publishing guide](vercel-shared.md#check-the-saved-site).

## Choose a setup path

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" status
```

Use the same resolved data directory for every step (`AM_HOME`, or `~/.agents/.mark` by default). If the directory changes, start again at status. If status fails, report the settings error and help the user correct it. Continue after status succeeds.

| Status and evidence | Ask the user | Next step |
| --- | --- | --- |
| `local` or `vercel` | Show the saved mode. Ask whether to reuse the saved settings or start fresh. | Use the on-disk settings and finish without a write, or start fresh. |
| `uninitialized` and a restorable setup | Say settings are missing and summarize the candidate's mode and any known team slug and project ID. Ask whether to restore that setup or start fresh. | Restore the selected candidate or start fresh. |
| `uninitialized` without a restorable setup | Proceed to the fresh delivery choice. | Start fresh. |

Check history only when status is `uninitialized`. A restorable setup has a record of a successful settings save in this exact data directory. Require evidence of both the resolved directory and the completed save. Restoring settings does not recover the publication archive.

Use the host's choice tool when available. Carry forward choices the user already made explicitly in this setup for this directory. A request to start from scratch resolves the setup path. If the user chooses Vercel while the restore or reuse choice is open, keep the delivery preference and ask the open question again.

For an authorized restore, use the candidate's delivery mode. For Vercel, use its team slug and project ID, ask for any missing values, and follow the project check and domain selection below.

## Set up from scratch

Offer a choice between keeping HTML local and configuring Vercel for explicit publishing. A pending explicit publication supplies the Vercel choice once the setup path is resolved. For local delivery, go to [Validate and save](#validate-and-save).

For Vercel, ask for the fields the user has yet to supply in this setup. Use values they give now, including values that match a previous project. Show both fields together when both are missing and put each field's help beside it. Use chat if the host has no suitable input tool. These are non-secret fields. For ChatGPT session JSON, use the [archive capture setup](chatgpt-archive.md).

| Required field         | Help to show                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vercel team (slug)** | In the Vercel dashboard, switch to the team that owns the project and open the project. Copy the first segment after `vercel.com/` from `https://vercel.com/<team-slug>/<project-name>`. For example, enter `my-team`. [Vercel docs: find the team slug in the dashboard URL](https://vercel.com/docs/cli/open#how-it-works) |
| **Vercel project ID**  | In the same project, open **Settings → General → Project ID** and copy the full value starting with `prj_`. [Vercel docs: find your project ID](https://vercel.com/docs/project-configuration/general-settings#project-id)                                                                                                   |

## Check the Vercel project and choose a domain

Once you have both values from the chosen setup path, run the read-only project check.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" setup --team TEAM_SLUG --project-id PROJECT_ID --check-project
```

The helper runs `vercel project inspect PROJECT_ID --scope TEAM_SLUG --non-interactive --json` and checks the returned project ID and team slug. On success, use the returned project name when showing the alias choices.

If the check fails, explain the cause and reopen the relevant input with its official help above. For an unknown team, an inaccessible project, or a mismatched owner, ask the user to copy both values from the same project's dashboard and check that the CLI account has access. If the CLI is missing, signed out, or cannot reach Vercel, help the user resolve that issue and retry the same values. Rerun the check after each correction. Continue to alias selection only after the check succeeds.

List the aliases bound to the project's current production deployment.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" setup --team TEAM_SLUG --project-id PROJECT_ID --list-domains
```

Show the verified project name, up to the five returned domains, and an option to use the deployment URL. If `more` is true, indicate that additional domains are available. Accept an exact hostname if the user types another alias. The save command checks its binding. Use a numbered text list if the host prompt cannot show all options.

When offering aliases, explain that each later publication will update the project's production deployment and its production domains. The deployment URL option uses an immutable URL. Preserve the project's existing access protection. Keep a persistent `AM_HOME` per publisher and project. If the project already has a production deployment, publishing without an alias requires this publisher's publication archive for that project.

Use the user's explicit choice of a domain or the deployment URL for this project in the current setup. A restore choice covers the project details. Ask separately for the domain, even if the candidate used one before. If discovery succeeds with no eligible aliases, use the deployment URL. If discovery fails or the user's selected alias is unavailable, report the issue and ask whether to use the deployment URL or retry. If the project changes, repeat its project check and domain selection.

## Validate and save

The resolved setup path, delivery mode, and applicable project and domain choices authorize the save. Run it once those decisions are settled.

For local delivery, run the local setup command.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" setup --local
```

For Vercel delivery, use an authenticated Vercel CLI that supports `api`, `deploy --prod --skip-domain --json`, and `curl`. To use the deployment URL, run the base setup command.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" setup --team TEAM_SLUG --project-id PROJECT_ID
```

If the user selects an alias, add `--alias-domain SELECTED_HOSTNAME`. The helper saves it as the delivery alias. Later publications build from the current production gallery, verify the new deployment, then promote it and check the selected alias. Follow the [link and access reporting rules](vercel-shared.md#report-deployment-and-access-separately) for the result. [Vercel CLI documentation](https://vercel.com/docs/cli)

If status was `uninitialized`, add `--if-uninitialized` to the save command. This guards against another setup saving first. If the helper reports that delivery is already set up, rerun status and resolve the saved-settings choice before trying another save.

The helper checks the project identity again before saving. If the final check fails, return to the input guidance above. `setup --local` retains the on-disk project binding and archive for later reuse. Use a separate `AM_HOME` for another project so each project keeps its own archive.

If validation fails, report the cause. When it succeeds, report the saved mode and settings path.

The helper saves the delivery mode and project details in `delivery.md` in the active data directory. It uses owner-only permissions on POSIX systems.

## Offer optional ChatGPT capture

After delivery setup, show the [archive disclosure](chatgpt-archive.md#explain-archive-sharing) and let the user choose whether to configure optional ChatGPT archive capture or skip it. Explain that this choice applies to later explicitly requested publications and is independent of the Vercel project, team, and alias.

If the user chooses capture setup, follow [ChatGPT archive capture setup](chatgpt-archive.md#set-up-or-update-local-credentials) through its completion interaction. Skipping or cancelling preserves any earlier archive authorization.

For a pending explicit publication with a Vercel destination, follow [Vercel snapshot delivery](vercel-shared.md) after capture setup succeeds or the user skips or cancels it. A one-time article-only choice can skip capture for that publication.
