# Mark eval cases

`cases/*.json` supplies scenarios and grading criteria for an explicit external evaluator.

Each file contains one case object.

| Field           | Meaning                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | Case-data schema version, currently `1`.                                                                                                      |
| `id`            | Unique lowercase slug matching the JSON filename.                                                                                             |
| `category`      | `explicit-activation`, `ordinary-question`, `local-only`, `missing-tools`, `complex-resources`, or `setup-authorization`.                     |
| `prompt`        | The initial user message presented to the evaluated assistant.                                                                                |
| `followUps`     | Subsequent user messages for setup authorization cases.                                                                                       |
| `context`       | Workspace and home locations, environment prerequisites, saved delivery mode, any historical context, and runner setup instructions.          |
| `fixtures`      | Supplied files, each with a workspace/home scope, relative path, UTF-8 content, and SHA-256 digest. Optional provenance describes the source. |
| `expected`      | Activation, artifact, delivery, publication constraints, required and forbidden behavior, and resource fragments that must remain faithful.   |
| `rubric`        | Individually named required criteria for a human or external grader.                                                                          |

The runner receives the assembled skill directory from the repository's eval request. It must materialize fixture files in their declared scope, apply `context.processEnvironment` so `AM_HOME` stays inside the evaluation home, provision or accurately simulate the stated tool availability, and expose the exact skill directory to the assistant. Environment entries describe the scenario to provision; they are not results from an evaluation run.

Keep `expected` and `rubric` private to the grader. `context.instructions` are runner setup instructions, not an extra assistant task or an implicit skill invocation. Present only the user prompt and the appropriate scenario context/tool environment to the assistant.

For `setup-authorization`, give the assistant `context.history` as saved context from an earlier session. Resolve its `/eval/home` paths to the isolated home and keep it outside the current user messages. Use the real bundled publisher with a local Vercel stub exposing project inspection and alias endpoints. Deny network access to the agent's commands. Send each `followUps` entry in the same conversation after the previous turn ends. Observe prompts, actual commands and arguments, stub calls, and the contents or absence of `delivery.md` after each turn. Grade each boundary even if a later turn recovers from an earlier mistake.

All current cases forbid network publishing. The saved-Vercel case supplies local settings as a control and requires that the explicit local-only request win. The missing-Node case expects the substantive answer in chat and no claimed HTML artifact. The missing-browser case permits real local rendering and requires an honest preview limitation.

The complex-resource case supplies code and numeric input as evaluation fixtures. They are not measurements of a production application. The image is an unchanged copy of `docs/logo.svg` from upstream commit `edccab07c012e2141585f8ddb18a62e01664fa2b`; its case fixture records the provenance and content hash. Grade fidelity to these supplied inputs, valid component grammar, actual renderer evidence, and the final local artifact. An `ask` component is optional when no decision is pending; the standard Reply control does not require inventing a decision.

`tests/eval-cases.test.ts` checks the case schema, fixture integrity, unique IDs, portable fixture paths, resource anchors, and category coverage after TypeScript compilation. Passing that test says the data is usable. It does not establish that any model passed the behavioral rubric.
