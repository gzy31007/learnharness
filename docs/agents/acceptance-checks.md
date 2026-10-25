# Acceptance environment checks

Use this entry point for local acceptance commands that must not inherit a developer's credentials. It prepares an isolated profile, checks the effective environment before starting the requested command, and preserves the outcome as evidence. It does not install dependencies, build the application, or choose a different runtime automatically.

The source checkout and dependencies remain reusable. Isolate the command's HOME, authorization, application data, and npm configuration instead of creating another source tree. Follow [the Git workflow](git-workflow.md) before changing branches or creating environments.

## Choose the mode

- `suite` leaves `LH_IGNORE_ENV_KEYS` unset and sets `NODE_ENV=test`. Tests own their synthetic environment credentials and may exercise both authentication modes.
- `smoke` sets `LH_IGNORE_ENV_KEYS=1` and `NODE_ENV=production`. Application probes exercise an empty-profile setup.

Both modes start from an explicit environment allowlist. Provider, cloud, proxy, and credential variables are not inherited. Neither are `NODE_OPTIONS`, `NODE_PATH`, `LH_DEV_URL`, `ELECTRON_RUN_AS_NODE`, or temporary-directory overrides. HOME, application data, authorization, and npm configuration point into the run-owned profile. Removing the fresh-user switch for a suite does not restore the developer's environment.

The fresh-user switch is product behavior, not a general isolation mechanism. Applying it to the whole suite deletes synthetic credentials that authentication tests deliberately inject. Keep its behavior in the existing product tests; validate the runner's mode choice separately.

## Run a check

From the source checkout, run a local command through the wrapper. Choose an output path that does not exist:

```sh
node scripts/acceptance-check.mjs --mode suite --output /absolute/approved/evidence/typecheck -- npm run typecheck
```

For a keyless application probe, use `--mode smoke` instead. The wrapper accepts an explicit command after `--`; it does not choose or run a probe for you. Existing application probe commands may require an existing production build. This wrapper never creates that build.

For tests that require Electron's bundled Node, choose it explicitly in the command:

```sh
node scripts/acceptance-check.mjs --mode suite --output /absolute/approved/evidence/tests -- /usr/bin/env ELECTRON_RUN_AS_NODE=1 /absolute/source/node_modules/electron/dist/electron --import tsx --test tests/acceptance-env.test.ts
```

`ELECTRON_RUN_AS_NODE` is an explicit argument to `env` here, not a variable inherited from the developer's shell. Use the verified runtime path for the existing checkout. The runner uses POSIX process-group cleanup and explicitly refuses Windows. Only Linux has been exercised; these examples do not establish macOS or Windows acceptance.

The target command's deadline defaults to 600000 milliseconds. `--timeout-ms` can select a different positive, timer-safe deadline. The preceding npm configuration queries have their own 30000-millisecond limit per query and do not count against the target deadline. A timeout or interruption is a failed invocation, even if the command previously printed a success message.

## npm configuration

Use two distinct empty regular files owned by the run for npm user and global configuration. Pointing both at `/dev/null` makes npm reject the duplicated configuration before a lifecycle script starts. Report that as a configuration failure, not a TypeScript or test failure.

The preflight rejects identical paths, aliases to the same file, files outside the run-owned profile, and nonempty or nonregular files. It checks file metadata before reading configuration contents. npm configuration loading is checked with the effective isolated environment before the requested command starts. npm is offline; the probe does not install anything.

## Evidence and limits

Use a new output directory for each invocation. Existing output must remain untouched, including earlier failed attempts. Retain the command, working directory, source and lock identifiers, runtime information, output log, exit status, and failure classification needed to reproduce the run. Do not dump the inherited environment or credentials into a manifest.

A successful preflight proves the runner's environment contract, not application correctness. The requested check must execute and pass separately. A command's own dotenv loading, explicit credentials in its arguments, network behavior, and filesystem access are outside this environment filter. It is not an operating-system sandbox or a network firewall.

The runner does not convert a successful local run into cross-platform or CI-equivalent acceptance. Record the runtime actually used. The repository's CI runtime and Electron's bundled Node may differ from the host Node.

Inspect test and command behavior before execution. Existing tests may create and clean their own platform temporary files. Keep new tool fixtures and retained evidence within the approved task directory. Do not move temporary paths into a long evidence pathname without checking Unix-socket path limits. New installations, build trees, source copies, expanded budgets, and cleanup each retain their normal approval requirements.
