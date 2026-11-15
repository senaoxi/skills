# Vercel snapshot delivery

Use this workflow only when the user explicitly asks to publish an existing local HTML explainer.

## Check the saved site

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" status --check-project
```

- `vercel` means the CLI can access the saved project and its team and project ID match. Use that project.
- `uninitialized` or `local` means Vercel publication needs setup. Keep the local HTML and follow [Vercel setup](vercel-setup.md) to configure the destination. Resume this publication after setup succeeds.
- If status reports an error, show it and follow the matching [Vercel setup](vercel-setup.md) guidance for settings, credentials or project access. Repeat the check before continuing.

Each publication verifies an immutable deployment. With a delivery alias selected in setup, build from the current production gallery and promote the verified deployment. Without an alias, build from this publisher's archive and return the deployment URL. Preserve existing deployment protection.

## Prepare optional conversation capture

If the user explicitly asks to publish only the article, proceed to Review and use `--article-only` on Review and Publish. Otherwise, check [ChatGPT archive authorization](chatgpt-archive.md#select-the-conversation-and-capture-once). With saved opt-in, follow that guide to select the conversation and capture it once before Review. Without saved authorization, proceed with ordinary article Review. After a capture or credential-status failure, report the reason and pause until it is resolved or the user chooses article-only publication.

## Review the outgoing resources

Choose a stable slug. When updating an existing page, reuse its slug and pass `--replace`. Recover the slug from the original page URL or the gallery's downloaded filename. Ask for the URL if the slug is ambiguous. For a new page, set `--group` to the project slug or omit it for `Posts`. Group IDs use lowercase ASCII letters, numbers and hyphens.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" review /absolute/path/output.html \
  --slug topic-name --group example-project --json
```

If Capture returned `status: captured`, add `--conversation-bundle /absolute/path/captured-bundle` to Review. With saved opt-in, Review requires that bundle or the user's explicit `--article-only` choice. When the user makes that choice, pass `--article-only` to both Review and Publish. The choice belongs to this reviewed selection. It does not edit the saved opt-in.

Read every selected resource path returned by review. Check that the editable HTML contains the original Markdown in `#am-source`. If the draft is missing, use the original editable HTML. The complete reviewed HTML is the downloadable archive. It includes embedded Markdown, source paths, quoted code, and embedded media with its metadata. With conversation capture, also inspect the exact raw JSON and archive HTML. Raw JSON can contain branches and tool arguments absent from the visible HTML. Review all selected bytes and any authorized attribution for the site's audience.

The review output includes the selected resource paths and their combined `sha256`. The user's explicit publish request authorizes upload of the selected article. Conversation resources also require the archive opt-in described above.

If the reviewed selection includes a conversation archive, show the user the [archive disclosure](chatgpt-archive.md#explain-archive-sharing) before Publish if they have yet to see it for this publication.

Publish only after reviewing those exact resources. Pass the returned digest literally, with the same source and attribution flags used for review.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" publish /absolute/path/output.html \
  --slug topic-name --group example-project --reviewed-sha256 REVIEWED_SHA256
```

Publication uses the frozen Review selection, including any captured bundle. A matching `--conversation-bundle` flag is accepted for caller compatibility. Article-only uploads check saved authorization again unless the explicit choice was included in Review. If the source, attribution, or selected resources change, run Review again. With a selected production alias, a successful replacement updates the existing page URL on that alias. Each immutable deployment URL retains its own version.

A captured archive adds JSON and HTML links to the article and gallery at `conversations/<slug>.json` and `conversations/<slug>.html`. A replacement without a new bundle clears that page's previous conversation resources. Other pages keep their archives.

## Download and resume editing

Use **Download** on the online reading page or **Download editable HTML** in the gallery. The reading page shows a download button in place of its editing toolbar. The browser saves the complete archive as `<slug>.html`. Open it locally to switch themes, annotate, and copy feedback with Reply, or use `am patch` to edit a panel. Browser-stored annotations belong to the browser that made them. Copy them through Reply to carry them back into the conversation.

Older published copies that had their draft removed need the original local HTML. Republish that file with the original slug and `--replace` to make the article editable again.

## Report deployment and access separately

On success, give the published page link and the local editable HTML link. Get these from `delivery.url` and `source` in JSON output or the CLI's `Published:` and `Editable source:` lines. Use the saved alias when Vercel confirms its binding to this deployment. Otherwise, use the immutable deployment URL.

The publisher checks alias access without following redirects. If the anonymous request cannot verify the page, it tries the authenticated Vercel CLI. If both checks fail, give the confirmed alias and explain that its page access remains unverified. Include the immutable deployment URL from the CLI's `Verified Vercel deployment:` line as well. Report when the delivered URL needs authentication.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" verify --slug topic-name --json
```

Verification reports the saved publication, observed current production and alias access. The current production deployment can differ from the saved immutable snapshot.

For automation, use `--json` with `publish`, `verify` or `recover`. Read the remote, archive, delivery and production states. If publication fails, give the local editable link and the failure. An unknown upload or pending archive requires recovery.

Report the conversation JSON and HTML links when an archive was included. Otherwise report the precise reason the optional archive was skipped. Capture includes only content stored by the server at capture time. The publication result and later messages are not part of that snapshot.

Use `stage` for an offline gallery. Review and explicitly publish the selected page to include it in a deployment.

## Recover without uploading again

The publisher saves a private candidate snapshot and journal before uploading. A pending operation blocks another publication. If archive persistence or verification fails after deployment, keep the pending files and run recovery after resolving the reported local or network failure.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" recover --json
```

Recovery verifies retained article and conversation bytes and the known remote deployment before completing the archive. It does not recapture the conversation or require a ChatGPT credential. A journal for a selected alias also records the previous production deployment and whether a promotion was requested. If a prior promotion is unresolved, inspect its status in Vercel. Once the verified deployment and its alias are serving, run recovery again. If Vercel shows a definite failure, only promote the saved candidate after checking that production and the alias still point to the recorded baseline. Then run recovery to save the archive. A prepared operation that never attempted upload can be cleared safely. If the upload response was lost and no deployment is recorded, locate the actual candidate in the pinned Vercel project and provide its immutable HTTPS origin.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" recover \
  --deployment https://candidate.example.vercel.app --json
```

The helper checks the supplied deployment's project and content. Do not guess an origin, retry upload or discard the journal to clear uncertainty. A stale lock after a killed process requires checking that the previous publisher is no longer running before removing that lock. Do not remove a live publisher's lock.

## Publication archive

The pending snapshot is `$AM_HOME/vercel-shared-pending`. The verified publication record is `$AM_HOME/vercel-shared-published.json`; its HTML files are in `$AM_HOME/vercel-shared-content`. The offline gallery remains `$AM_HOME/vercel-shared-site`. The default `AM_HOME` is `~/.agents/.mark`.

Without a delivery alias, each publisher builds immutable snapshots from its own archive. A project with an existing production deployment requires a publication archive bound to that project. With a delivery alias, the publisher reads the current production gallery.

The uploader uses `vercel deploy --prod --skip-domain` and checks the index, catalog, reading pages, editable downloads, and selected conversation resources byte for byte. Gallery rebuilds preserve existing pages' archived conversation resources. With a selected delivery alias, it rechecks production and the alias against the baseline before calling `vercel promote`. If either has changed, it returns the immutable URL and reports a conflict. Rerun publication to build from the new production gallery. The local lock coordinates this data directory. Keep a single publisher for the production project because a separate publisher can still race the last check and the promotion.

## Conversation provenance and ordering

Include attribution only when the user wants it shared. For ChatGPT use `--context-source chatgpt --context-title "Authorized title"`. For Codex use `--context-source codex --context-title "Authorized title"`. Pass the same flags to review and publication.

Use `--context-url` only for a real ChatGPT conversation link the user authorized sharing. The helper retains its HTTPS origin and conversation path, removing query and fragment. This validates the URL format, not the conversation's existence or title. Attribution appears in the online HTML, gallery and `pages.json`.

Pass the archive target to Capture through [trusted invocation context or explicit input](chatgpt-host-context.md). Public attribution is a separate input and uses separate authorization.

Omitting source flags clears previous attribution when publishing an existing slug. `--clear-context` makes that intent explicit and also clears an offline staged record.

Each catalog entry has a group, UTC `publishedAt` and optional attribution. Project groups sort alphabetically, with `Posts` last. Entries sort newest first, then by slug. Republishing keeps the existing date unless `--published-at YYYY-MM-DD` supplies an author-known date. Offline adoption without metadata uses the file's modification time as a date proxy. Change the group by publishing with a different `--group`.
