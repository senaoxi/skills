# Vercel snapshot delivery

Use this workflow when saved delivery mode is `vercel`. Create and preserve the editable local HTML first. Use local delivery for local-only or confidential output. [Vercel setup](vercel-setup.md)

Each successful publication returns an immutable deployment URL. It includes the selected page and this publisher's previously published gallery. Production domains do not move. Old deployment URLs keep their previous content while Vercel retains those deployments. Preserve existing deployment protection.

## Review the outgoing page

Choose a stable slug. Set `--group` to the project slug for project explanations, or omit it for `Posts`. Group IDs use lowercase ASCII letters, numbers and hyphens.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" review /absolute/path/output.html \
  --slug topic-name --group example-project --json
```

Read the returned review file. Check its visible text, code, image content, link destinations, attribution and remaining HTML attributes against the intended audience. The review output includes `path` and `sha256`. The digest identifies bytes; it does not establish that the page contains no private information. Do the review yourself within the user's authorized scope. This is not a new human approval step.

The online copy removes the embedded draft, editor source paths and line attributes, comments, unsupported custom data attributes and executable scripts not authorized by the renderer's CSP hashes. It preserves renderer attributes, authorized scripts and visible code. These rules are metadata cleanup, not a general secret detector. PNG, JPEG, GIF and WebP metadata can be cleaned. Other embedded image formats must be replaced with supported formats before publication.

Publish only after reviewing that exact file. Pass the returned digest literally, with the same source and attribution flags used for review.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" deliver /absolute/path/output.html \
  --slug topic-name --group example-project --reviewed-sha256 REVIEWED_SHA256
```

If the source or attribution changes, run review again. Use `--replace` to change the body at an existing slug in the next snapshot. This creates a new deployment URL; it does not rewrite earlier deployments. Do not automatically pipe a review digest into publication without inspecting the review file.

## Report deployment and access separately

On success return `Published:` and `Editable source:`. `Published:` identifies the immutable deployment that passed authenticated byte comparison. Authentication by the publisher does not establish anonymous access or access for another reader.

A preferred origin is an independent observation. It can be protected, stale or unavailable. The publisher checks it without sending credentials or following a redirect into a login page. Never replace the verified deployment link with an unverified preferred origin. Do not disable protection or create a public bypass to make this check pass.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" verify --slug topic-name --json
```

Verification reports the saved publication, observed current production and preferred URL separately. A different current production is expected for immutable snapshots. A legacy production record must not be presented as current when production has changed.

For automation, use `--json` with `publish`, `deliver`, `verify` or `recover`. Read remote, archive, delivery and production states, not just the exit code. `deliver` can return a successful local fallback before upload. Once upload may have occurred, an unknown remote result or pending archive returns a failure that requires recovery. Report that state alongside the local file.

Use `publish` when any publishing error must be nonzero. Use `stage` for an offline gallery. Staged pages do not automatically enter a deployment; review and explicitly publish the selected page.

## Recover without uploading again

The publisher saves a private candidate snapshot and journal before uploading. A pending operation blocks another publication. If archive persistence or verification fails after deployment, keep the pending files and run recovery after resolving the reported local or network failure.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" recover --json
```

Recovery verifies retained bytes and the known remote deployment before completing the archive. It never deploys, promotes or changes access protection. A prepared operation that never attempted upload can be cleared safely. If the upload response was lost and no deployment is recorded, locate the actual candidate in the pinned Vercel project and provide its immutable HTTPS origin.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" recover \
  --deployment https://candidate.example.vercel.app --json
```

The helper checks the supplied deployment's project and content. Do not guess an origin, retry upload or discard the journal to clear uncertainty. A stale lock after a killed process requires checking that the previous publisher is no longer running before removing that lock. Do not remove a live publisher's lock.

## Archive and legacy production

The pending snapshot is `$AM_HOME/vercel-shared-pending`. The verified publication record is `$AM_HOME/vercel-shared-published.json`; its HTML files are in `$AM_HOME/vercel-shared-content`. The offline gallery remains `$AM_HOME/vercel-shared-site`. The default `AM_HOME` is `~/.answer-me-with-html`.

For initial migration, a legacy record must identify the current production deployment and cover its gallery. A missing or stale legacy archive stops publication. After migration, the version 2 archive follows this publisher's immutable snapshots independently of production. Move the record and its HTML files together when moving the publisher. Different publishers can retain different gallery histories without overwriting production.

The uploader uses `vercel deploy --prod --skip-domain`, checks the index, catalog and every page byte for byte, then saves the verified snapshot. It does not call `promote`. The local lock coordinates only the local archive. Recovery covers retained local evidence, not loss of the disk or removal of deployments by Vercel retention policies.

## Conversation provenance and ordering

Include attribution only when the user wants it shared. For ChatGPT use `--context-source chatgpt --context-title "Authorized title"`. For Codex use `--context-source codex --context-title "Authorized title"`. Pass the same flags to review and publication.

Use `--context-url` only for a real ChatGPT conversation link the user authorized sharing. The helper retains its HTTPS origin and conversation path, removing query and fragment. This validates the URL format, not the conversation's existence or title. Attribution appears in the online HTML, gallery and `pages.json`.

Omitting source flags clears previous attribution when publishing an existing slug. `--clear-context` makes that intent explicit and also clears an offline staged record.

Each catalog entry has a group, UTC `publishedAt` and optional attribution. Project groups sort alphabetically, with `Posts` last. Entries sort newest first, then by slug. Republishing keeps the existing date unless `--published-at YYYY-MM-DD` supplies an author-known date. Offline adoption without metadata uses the file's modification time as a date proxy. Change the group by publishing with a different `--group`.
