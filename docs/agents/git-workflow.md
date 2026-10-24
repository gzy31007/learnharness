# Git workflow

How work moves from an issue to a merged branch, and which Git actions an agent takes on its own authority. The generic rules below are meant to be reused across projects; the "This repository" section holds the configuration they apply to, and portability notes sit at the end.

## Authority

This file governs Git and release conduct. Review and verification procedure stays in the applicable skills: `code-review` for the Standards and Spec axes, `pr` for PR bodies, `tdd` for test-first work. This document points at them and does not restate their steps.

Project conventions win over this document. When an instruction here conflicts with something the project already documents, stop, report the conflict, and wait for a decision before changing anything.

## Branch roles

The branch roles below describe the agreed layout. The repository section records its initialization; historical bootstrap exceptions do not authorize new work from `main`.

`master` mirrors upstream. It carries only commits that exist upstream. Touch it when the user asks to check or sync upstream, and update it by fast-forward. If upstream history diverged or was rewritten, stop and report; resetting and force-pushing are not recovery steps.

`release/<major.minor>` carries development, internal builds, acceptance, and patches for one line, so `release/1.10` also carries the 1.10.x patches.

`stable` holds the curated history of the version currently promoted and formally released.

Release tags are immutable. Each tag pins the commit that was actually built and verified.

## Choosing the target version

Read the issue body and its milestone first. When exactly one release line is clearly active, use it and say so in the handoff. When two lines are plausible, or none is, ask before branching; never default to `main`.

Ordinary development starts from the verified current commit of the target release, on a `feature`, `fix`, `docs`, or `sync` task branch. Open its PR back to that release, not the default branch. The task branch is the delivery head; do not commit or push the task directly onto the release. Record the full base SHA. If the release has advanced since initialization, use its verified current baseline and keep the historical initialization SHA as evidence, not as a rollback target.

A new release line starts from the exact tag of the previous released version. It never starts from an old release branch tip (that tip may hold unreleased work), from a stable aggregation commit, or from an arbitrary master commit.

An upstream update that should reach our own versions is its own task: branch `sync/<short>` from the target release, compare impact, integrate, verify, then open a PR. Upstream work reaches releases one line at a time; it never gets poured into every release or into stable at once.

## Issues and branches

Every change to tracked files binds to an existing or a new issue, and the agent may create or reuse the issue from a chat request.

Discussion-only work, an investigation, a comment added to a ticket, or a pure Git-reference operation produces no empty commit. Discussion and ticket-only work need no task branch; a pure reference operation changes only its authorized refs. A document or a research report that enters the repository is a file change, so it does get a task branch.

One branch covers one independently deliverable task. Branches follow tasks, not chat sessions or subagents: a new session continues the existing branch, and unrelated tasks stay apart.

Names are `feature/<short>`, `fix/<short>`, `docs/<short>`, or `sync/<short>`. Short names work; no version number and no issue number is required inside the name. Traceability comes from the base commit, the PR target, the commits, and the ticket record.

## Start of work

1. Read the issue, its comments, and its milestone.
2. Inspect the state you are about to join: `git branch --show-current`, `git status --short`, `git worktree list`, `git fetch origin`. Note which dirty paths already belong to someone else.
3. Pick the base: the target release branch, or the exact tag of the previous release when cutting a new line.
4. Create the task branch from that base.

Done when you can name the issue, the base commit, and every pre-existing dirty path you are leaving untouched.

Pre-existing changes stay where they are. Never stash away, restore, or clean another party's work, and never let it ride along in a commit. Stage explicit paths rather than `git add -A`. An isolated index or a throwaway checkout keeps the working tree clean, and it still holds only the task's files. When ownership is unclear, ask.

## Upstream contributions

A contribution to the official repository is separate from ordinary release development and mirror maintenance. Verify the official target repository and branch, record its full commit SHA, and start an independent task branch at that SHA. Select only the agreed feature and its necessary tests and documentation. Never offer the entire personal `main` or release history as the contribution.

Use the existing task prefixes, for example `feature/upstream-codex-subscription`. The historical `contrib/instance-codex-subscription` candidate does not establish another naming convention or prove compatibility with the current official target. Inspect reusable candidates and rerun applicable checks; old logs are not current acceptance evidence.

Preparing and pushing the authorized task branch to `origin` is not permission to create or reopen an official PR. Obtain separate approval for those external actions. The contribution's PR target, if approved, is the verified official branch, not our release line.

## Commits

Commit in small stages that each carry one meaningful step, and each commit message says what changed and why. The record of the work lives in the branch and its commits; a chat summary supplements that record. A task delivered, or paused for handoff, is pushed before you report.

Messages are English, with a lowercase type or domain in a `type or domain: concrete change` subject, for example `math: dollar delimiters end-to-end`. A simple change needs only the subject. A complex one adds a body covering the reason, the implementation, and how it was verified, plus the issue reference.

Follow [Conventional Commits](https://www.conventionalcommits.org/) loosely. Upstream is the reference: commit [`bf29a2070ff57ca8e01749a9099c8fe662fc3776`](https://github.com/amosblomqvist/learnharness/commit/bf29a2070ff57ca8e01749a9099c8fe662fc3776) uses a lowercase type, a subject naming the outcome, body bullets per area of change, and the test counts that were run. Use that as a style reference, not a mandatory scope or trailer schema.

Done when every commit reads on its own, and nothing uncommitted remains that belongs to the task.

## Push, PR, and handoff

Push the branch when the task is delivered or when work pauses. The handoff report names the branch, the commits, the PR, which checks actually ran with their results, and anything skipped or failing. A skipped or failed check gets reported as such; a build is not a substitute for an interaction test.

Open the PR against the target release branch, and write its body with the `pr` skill. Authorizations split as follows:

- Commit and push in this repository are allowed inside an authorized task, including a paused-work handoff that reports failed checks. Open a delivery PR once the applicable checks pass.
- Opening a PR against upstream needs its own approval.
- Merging a PR, publishing a release, and closing an implementation ticket each wait for user confirmation.
- Any third-party repository needs its own approval.

Use `Refs` or `Related` links in the PR body. `Closes`, `Fixes`, and `Resolves` close the ticket automatically on merge, which pre-empts the separate issue-closure decision. A finished investigation does not mean a defect is fixed or a risk accepted, and a triage or cleanup ticket does not close itself.

## Merges and history

Merge PRs with merge commits, which keep the stage commits and the PR boundary visible.

Pushed history is append-only. Amend and rebase are for commits that have not left the machine; after a push, rewriting needs explicit approval, as does force-pushing.

Stable aggregation is its own flow and does not erase the release-side development record.

## Releases and stable

Order: tag the commit that was actually built and verified, publish it, then curate that same version into stable.

The release tag keeps the exact verification commit and never moves. `stable` and the tag hold the same file tree, while their commit SHAs may differ. Record the correspondence between the release tag, the source release commit, and the stable aggregation commit, in release notes, a tracking issue, or the aggregation commit body.

Curating a version into stable takes three or four meaningful commits when the changes support that many, and this is a target rather than a quota. Small patches take fewer. Do not pad the history or create empty commits, and curate only the new version.

The next release line starts from the previous release tag, not from a stable aggregation commit and not from an old release tip. A late patch on an old maintenance line does not pull the promoted version back. Rolling back, or promoting a different version, waits for user confirmation.

## Fixes spanning several versions

Report which lines a fix applies to and wait for confirmation. Then port it per line: a separate branch from each target release, its own verification, its own PR. Merging a whole old maintenance line forward is not a port.

## Worktrees

Check existing environments for safe reuse first. Each new worktree needs its own approval; parallel work is no reason to skip that gate. Before adding source or dependency copies, separate installs, caches, or build trees, report the reason, absolute destination, estimated disk growth, and retention plan, then obtain approval. An approved copy stays narrow: only the dependencies and fixtures that copy needs. A dirty worktree is never force-deleted.

Inspect test scripts and tool behavior before running them. If a check implicitly installs dependencies, builds, or creates another environment, stop for the same approval; naming it a test does not exempt it. Reuse the applicable skills rather than inventing another review or test procedure.

## Test environment and deployment

A pushed branch is not a deployment, and a deployment is not a passing test. Name which of the three actually happened: push, deploy, test run.

CI configuration, deployment targets, release channels, and branch protection move in a separate task with its own approval.

## This repository

- `origin` is `https://github.com/gzy31007/learnharness.git`, the publishing destination for our branches, including the `master` mirror.
- The official mirror source is the `main` branch of `https://github.com/amosblomqvist/learnharness.git`. It is read-only for mirror work; `origin/master` is the published copy, not the official source.
- `release/0.3` is the established development and acceptance entry for our 0.3.x tasks. Verify its current SHA for each task; do not infer it from a local `main` checkout.
- `main` and the default branch are retained. Initialization did not create `stable` or formal release tags, or migrate CI, deployment, release channels, or branch protection.
- Issues live in GitHub Issues for `gzy31007/learnharness`; operations are in [issue-tracker.md](issue-tracker.md).

### Mirror source and tracking

Inspect actual remote URLs, push URLs, branch tracking, and destination refs before mirror work. If an `upstream` remote is needed, verify any existing remote with that name before configuring it; stop on a conflicting source instead of overwriting it. Stale remote-tracking refs do not prove that a remote is configured. Reading the official URL directly is also possible without introducing defaults.

Keep official reads and `origin` publication explicit. Local `master`, `origin/master`, and a branch's configured tracking target are different things. A remote-tracking ref records a fetched observation; its presence neither configures `git pull` nor chooses a push destination. Initialization adds no default pull or push behavior. Do not add tracking or change defaults merely because the mirror now exists.

A later, authorized mirror update may only fast-forward to a verified official commit. Stop on divergence, an upstream rewrite, a conflicting source, or an unexpected concurrent ref change. Do not reset, force-push, delete and recreate a branch, or bypass approval to make the mirror match. Before publishing, check the target commit's workflows and relevant integrations; stop if an unauthorized release or deployment cannot be excluded. Updating the mirror is not permission to merge upstream into any release.

### First initialization exception, 2026-10-24

The user approved the fixed targets and the one-time absence of a previous formal release tag in [specification #31](https://github.com/gzy31007/learnharness/issues/31). [Initialization #32](https://github.com/gzy31007/learnharness/issues/32) records verification and the user's acceptance on 2026-10-24. The initial local and `origin` targets were:

- `release/0.3`: `c7f1e14e9aafbe3be2d68401f20466713ae4895f`, the approved committed `origin/main` snapshot.
- `master`: `6cba9c8c5afe8a63f47ea4ebae6e91d8a205cebb`, the approved official `main` commit with its ancestry.

These are historical initialization targets, not permanent branch tips. The first release line is a development snapshot, not a formal release, a tag, or completed upstream integration. This exception applies only to the first initialization. Future release lines still start from the exact previous formal release tag under the generic rules above.

The original upstream impact investigation and any actual `sync` remain separate follow-up work. Old security approval gates and locked archives remain protected; this initialization does not authorize product changes, global guidance edits, or artifact cleanup.

### Historical documentation bootstrap, 2026-10-23

Before a release line existed, the user authorized `docs/git-workflow` and `docs/workspace-cleanup` to branch from `main` and PR back to `main`, for documents, an index, and ignore rules. That approval covered only those two tasks; it does not extend to later work. New ordinary tasks now use the target release and a separate task head.

Moving the trunk, changing CI or release settings, editing the global `AGENTS.md`, deleting old artifacts, and retroactively adopting uncommitted history each need their own decision. Migrating these generic rules into global guidance is a later, out-of-scope step.

The three-to-four-commit stable count is our own convention for this project, not an upstream rule.

## Portability

These rules travel between projects; the migration does not. A copy of this document in another repository does not move that repository's branches, deployment, or GitHub settings.

Before adopting it there, check that project's own documented conventions, its configured remotes, its issue tracker, its target version, and any explicitly recorded exception, then write the result into a project section like the one above.
