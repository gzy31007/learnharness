# Linux desktop acceptance runner

Run the real source-shell Electron app against an **existing** production build. This checks local UI, preload execution and IPC, empty-account controls, and the trusted/untrusted renderer boundary. It does not sign in, contact model APIs, package an installer, or prove Windows/macOS behavior.

From the repository root:

```sh
node scripts/desktop-acceptance.mjs --output /absolute/path/to/new-evidence
```

The parent directory must exist. The output directory must not exist. The runner refuses to overwrite earlier runs. It never installs dependencies or builds. Reuse an approved source tree, installed Electron and production build. If any is missing, prepare it through the normal approval process, not through this command.

On a root-run WSL test environment, pass `--no-sandbox` explicitly. If `/dev/shm` is constrained, also pass `--disable-dev-shm-usage`. These are local probe flags, not shipping-app defaults. The outer deadline defaults to 120000 ms and can be set with `--timeout-ms`; the UI probe has its own 100000 ms limit.

## Success contract

Exit 0 requires a normal child exit, a readable JSON report from this invocation, `completed: true`, `success: true`, no timeout or execution error, and all 22 planned assertions. Assertion names must match the fixed contract exactly, without duplicates or omissions. Each assertion must report boolean `pass`, `actual` and `expected` as true. The plan is not derived from the checks that happened to run. An empty array cannot pass.

The preload check uses CDP `Debugger.scriptParsed` and `Runtime.executionContextCreated` events for the real preload file in a non-default execution context. A configured path in `getLastWebPreferences()` is not proof of execution. Real `window.lh` IPC calls must also succeed. The same probe opens a separate renderer without preload and checks private API denial.

The runner records selected source/lock/build-input hashes before execution and rejects changes to those inputs during the run. These identify this probe's inputs, not a full reproducible-build attestation. The built payload must already correspond to the intended product revision.

## Evidence and isolation

The output contains `result.json`, `run-record.json`, `probe.log`, screenshots, an empty auth store and an isolated profile. The runner passes an allowlisted environment rather than inheriting provider credentials or a development URL. It adds one symlink to the existing build, not a source or dependency copy. Chromium uses a short temporary directory whose absolute path is recorded in `run-record.json`.

The runner kills its own Linux process group after completion, interruption or timeout. Runtime profile and temporary files are retained for diagnosis. They are reproducible outputs, not permanent evidence. Keep the reports, logs and necessary screenshots; propose exact profile/temp paths for approved cleanup separately. The tool does not delete historical artifacts.

## Runner self-tests

```sh
node --import tsx --test tests/desktop-acceptance.test.ts
```

The public test boundary is command execution, output files and exit codes. A command after `--` replaces only the probe process, for example with a synthetic child used by the self-tests. It still must produce the fixed report contract using `LH_ACCEPTANCE_RESULT` and `LH_ACCEPTANCE_RUN_ID`. The run record names that command. A successful synthetic probe is not evidence of a desktop UI run. Self-tests do not start Electron or need a new build.

This command is deliberately not wired into CI or installer packaging. Those integrations need a separate decision.
