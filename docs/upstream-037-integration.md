# Upstream 0.3.7 integration

Tracking: [issue #36](https://github.com/gzy31007/learnharness/issues/36), under specification #31. This is an integration record, not a release announcement or evidence of real-account acceptance.

## Fixed inputs and preservation

- Release input R: `5f44daa6d66e2bf323ae65defffa43881093f6b7`.
- Upstream input U: `b277ee3e0fa24249c1b2d0f9b7fd6ed485f484b9`, official v0.3.7 and the verified fork master at integration start.
- Delivery branch: `sync/upstream-subscriptions`, targeting `release/0.3`. The branch name predates the decision to merge all of U, including its non-subscription changes.
- Remote preservation branch: `feature/retained-codex-subscription`, created at exactly R and read back before merging. It preserves the entire committed pre-replacement product, not just authentication files.
- The local `contrib/instance-codex-subscription` candidate and original integration branch remain in place. They are not substitutes for the remote R snapshot. The preservation branch does not contain pre-existing uncommitted or untracked files in the main workspace.

The integration uses a normal merge of U into R, not a reset, squash, or whole-tree replacement. Both inputs must remain ancestors of the delivery head. To recover the old committed implementation, inspect or branch from `origin/feature/retained-codex-subscription`. Do not restore old credentials into the new desktop connection store.

## Conflict decisions

The merge reported the following textual conflicts. Auto-merged files were also reviewed for duplicated old services, incompatible dependency baselines, and local product behavior.

| Path | Decision and reason |
| --- | --- |
| `.github/workflows/release.yml` | Integrate U's provider-runtime smoke step; retain this fork's cross-platform rehearsal and release behavior. No workflow is dispatched by this task. |
| `components/activity-dock.tsx` | Use U's captured-cost and server-pricing display; retire custom subscription coverage badges. |
| `components/graph-view.tsx` | Use U's graph and pricing changes, including notes import; retire the old custom coverage projection. |
| `components/settings/model-menu.tsx` | Use U's provider-aware menu and remove the retired authorization-source branch. |
| `components/settings/settings-dialog.tsx` | Use U's desktop connection sections, not the old Web subscription pane. |
| `components/setup-cta.tsx` | Use U's key and desktop-capability behavior; remove the old Web OAuth entry. |
| `components/stats-bar.tsx` | Use U's context-usage and pricing projection instead of the old subscription-cost path. |
| `src/agent/models.ts` | Use U's Pi 1.4.0 factory and desktop transports. Add only an explicit refusal for historical `openai-codex` pins. |
| `src/agent/subagents/extraction.ts` | Use U's dispatch lifecycle and background-consent handling; remove old scope/preflight injection. |
| `src/agent/teacher-agent.ts` | Use U's native agent/request lifecycle and identity propagation. |
| `src/core/contracts/jobs.ts` | Use U's job and usage contract, without the retired subscription provenance API. Historical JSON may still carry an old stamp; recovery rejects it. |
| `src/core/cost-summary.ts` | Use U's captured-cost fold and server-side pricing. Do not maintain a parallel subscription coverage model. |
| `src/core/prices.ts` | Use U's pricing implementation; remove the local copied rate table and synchronizer. |
| `src/server/chat-handler.ts` | Integrate U's request-cycle and desktop subscription gates; retain local image-capability rejection and add pre-persistence refusal for retired model pins. |
| `src/server/compaction.ts` | Use U's compaction accounting and request lifecycle; remove old usage-presence plumbing. |
| `src/server/index.ts` | Use U's service exports without exporting the retired subscription service. |
| `src/server/jobs.ts` | Use U's wake pipeline and consent handling; add a narrow historical-job refusal before respawn or result redelivery. |
| `src/server/keys.ts` | Use U's API-key and desktop connection truth; remove the old `providerAuthorization` service. |
| `src/server/model-catalog.ts` | Use U's federated catalogs; retain the independent local image-input capability validation. |
| `tests/extraction.test.ts` | Use U's tests; remove assertions requiring the deleted scope/preflight API. |
| `tests/render-activity-dock.test.tsx` | Use U's cost rendering assertions, not custom coverage semantics. |
| `tests/render-stats-bar.test.tsx` | Use U's captured-cost/context-meter assertions. |
| `tests/usage.test.ts` | Use U's reported-cost semantics, not the removed copied-price/usage-presence helpers. |

## Other semantic decisions

- `package.json` and `package-lock.json` use the complete fixed U baseline, including Pi 1.4.0, jose, Next 16.3.2, and upstream KaTeX 0.18.2 with its `$katex` override. There is no additional dependency upgrade to a later latest version.
- Auto-merged chat, home, new-session, setup, model-picker, and settings-signal code uses U's connection model. The old `subscription`/`chat` settings signals and old authorization fields are not retained as hidden compatibility paths.
- Local capability checks remain in `app/api/settings/[section]/route.ts`, `src/server/model-catalog.ts`, and role engine resolution. A vision role cannot silently receive a text-only model. API-key, practice, demo-rendering, and math-display regressions remain covered independently of old OAuth fixtures.
- Local desktop acceptance isolation remains in `electron/main.cjs` and `electron-builder.acceptance.yml`. The upstream main-process subscription IPC, safe-storage, status, and transport modules are integrated alongside it. An acceptance marker disables the updater; a development launch is not a production release.
- U's notes import, graph pricing, context accounting, provider attribution, and request-cycle changes are included. They are not excluded merely because the task branch name mentions subscriptions.
- Existing Git/issue instructions, workspace inventory, research archive, and historical subscription reports remain. The older subscription implementation/deployment reports describe R, not the replacement login flow. Locked archive files are not rewritten.
- The offline native Codex serializer assertion in the upstream session-identity suite uses the SDK directly. It does not re-enable the application's retired provider factory or discover real OAuth credentials.

## Retired active implementation

The following old implementation groups are removed from the active tree. Their committed originals and dedicated tests remain recoverable from the preservation branch and Git history.

- `app/api/subscription/**`: the old Web login, attempt, status, and input routes.
- `components/settings/subscription-section.tsx`: the old Web connection UI.
- `src/core/subscription.ts`, `src/server/subscription*.ts`, and `src/store/subscription-*.ts`: the old authorization, browser process, transport, errors, filesystem, credential, and lock services.
- Old composition/race/store child fixtures and the dedicated browser, composition, HTTP, lifecycle, races, SDK, settings, store, and zero-key subscription suites. Shared tests are adapted to U; unrelated product assertions are retained.
- Local Next pinning, the source-map security regression, undici SDK maintenance regression, and dependency-text security assertions. These are retired maintenance requirements, not findings that the underlying risks have disappeared. Historical research and evidence remain. No security issue is closed by this change.
- The custom copied pricing table, pricing synchronization script, subscription usage-presence fields, coverage display, and their exclusive test expectations. U's usage/cost behavior is now authoritative. A displayed zero cost is not a promise of unlimited quota or free future calls.

## User migration and historical data

Desktop subscriptions use U's ChatGPT, GitHub Copilot, and Grok connections. Web users get the desktop capability guidance; API-key connections remain available in Web. Supported accounts and platforms follow U's actual capabilities.

Old `openai-codex` model selections are not translated to `chatgpt`. A historical session remains readable and keeps its stored pin. Its model control asks the user to select a model again. Sending returns HTTP 503 with `code: model_reselection_required` before beginning a turn or changing the record. The shared engine factory also rejects the retired provider for background roles.

A queued job with the historical `subscriptionGeneration` field cannot be respawned or have its result redelivered under a replacement connection, even after the current model is changed. Jobs belonging to a session still pinned to the retired provider are also stopped. Recovery preserves the result and records a visible re-selection error. It does not infer that current desktop consent authorizes old queued work.

No bulk rewrite, deletion, credential import, or automatic model migration is performed. The migration tests preserve the historical chat file byte for byte on refusal and retain old job results without redelivery. Existing notes, graph ledgers, and usage records remain in their stores. Old credential originals are not read, copied, deleted, or imported. Users must sign in again through the product UI. Do not send credentials in chat.

## Workflow and release boundaries

Push CI remains limited to `main`; pull requests run ordinary CI. The release workflow starts only on a `v*` tag or manual dispatch. The new website notification workflow requires a published release and explicitly requires the official repository identity, so it does not deploy this fork. The integration does not change repository settings, branch protection, or deployment targets.

Production publishing identity and updater behavior are not acceptance authorization. Use the retained acceptance config for any approved rehearsal package. This task neither publishes a tag/release nor dispatches release workflows, enables an official update feed in an acceptance package, merges the delivery PR, or closes issue #36 or older security issues.

## Verification record

Verification is recorded separately from implementation. The task uses the existing `/root/learnharness/.scratch/upstream-sync-20261022/source` environment, one fixed-lock installation, and its approved build outputs. Logs and the resource manifest live in the sibling `evidence/issue36-20261025` directory. Dependencies, npm cache, and intermediate builds are reproducible outputs, retained until handoff and a separately approved cleanup whitelist.

At this document's initial write, retired-pin request/engine/job tests and the interactive model re-selection test pass. Full-suite and fresh-build checks are in progress. Subsequent results and remaining acceptance limits must be recorded before delivery; this paragraph is not a claim that all acceptance criteria passed.

Real-account login, billed inference, Windows installation/UI, and macOS-specific behavior are not inferred from Linux fixtures or a Web build. A fresh desktop launch and IPC checks must be identified explicitly when run. Missing platforms/accounts remain unverified, and fixture coverage must not be relabeled as real-account acceptance.
