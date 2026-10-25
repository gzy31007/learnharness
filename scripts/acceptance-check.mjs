#!/usr/bin/env node
/**
 * acceptance-check.mjs — run one command inside an isolated acceptance
 * environment and keep the evidence (issue #41).
 *
 * The gate order is preflight → npm config probe → command. The first two
 * only read: they verify the environment built by acceptance-env.mjs and
 * prove the installed npm loads exactly the two owned config files. If either
 * fails, the command is never started, and the record says so.
 *
 * The command runs in the caller's cwd, sees only the isolated environment
 * (no inherited credentials, proxies, or Node injection), and its output goes
 * to <output>/run.log. <output>/run-record.json keeps the argv, cwd, input
 * hashes, and the precise failure category — never the environment itself.
 *
 * POSIX only: the command runs in its own process group so a timeout or a
 * signal can reap the whole tree. Windows cleanup is not implemented and is
 * refused instead of silently leaving a process behind.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createAcceptanceEnv, preflightAcceptanceEnv, probeNpmConfigLoading } from "./acceptance-env.mjs";

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE =
	"usage: acceptance-check.mjs --mode suite|smoke --output <new evidence directory> [--timeout-ms <ms>] -- <executable> [args...]";
const HASHED_INPUTS = ["package-lock.json", "scripts/acceptance-env.mjs", "scripts/acceptance-check.mjs"];

class UsageError extends Error {}
class RunnerFailure extends Error {
	constructor(category, message) {
		super(message);
		this.category = category;
	}
}

function parseCliArgs(argv) {
	const separator = argv.indexOf("--");
	if (separator < 0) throw new UsageError("a command must follow --");
	const command = argv.slice(separator + 1);
	if (command.length === 0) throw new UsageError("a command must follow --");
	let values;
	try {
		({ values } = parseArgs({
			args: argv.slice(0, separator),
			options: {
				mode: { type: "string" },
				output: { type: "string" },
				"timeout-ms": { type: "string", default: "600000" },
			},
			strict: true,
		}));
	} catch (error) {
		throw new UsageError(error.message);
	}
	if (values.mode !== "suite" && values.mode !== "smoke") throw new UsageError('--mode must be "suite" or "smoke"');
	if (!values.output) throw new UsageError("--output must name a new evidence directory");
	const timeoutMs = Number(values["timeout-ms"]);
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
		throw new UsageError("--timeout-ms must be a positive timer-safe integer");
	}
	return { mode: values.mode, output: path.resolve(values.output), timeoutMs, command };
}

/** Map an error to the stage that failed, so a probe failure is never read as a command failure. */
function classOf(error) {
	if (error instanceof RunnerFailure) return error.category;
	const code = typeof error?.code === "string" ? error.code : "";
	if (code.startsWith("npm-probe")) return "npm-config";
	// Profile construction and the preflight both decide whether the command
	// may start, and neither has started it.
	return "preflight";
}

function inputHashes() {
	return Object.fromEntries(
		HASHED_INPUTS.map((name) => {
			const file = path.join(SOURCE, name);
			return [name, fs.existsSync(file) ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null];
		}),
	);
}

async function main() {
	let options;
	try {
		options = parseCliArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`${error.message}\n${USAGE}`);
		process.exitCode = 1;
		return;
	}
	const { mode, output, timeoutMs, command } = options;
	// An existing directory is refused before anything is written: evidence is
	// immutable once created, including historical and failed evidence.
	try {
		fs.mkdirSync(output, { mode: 0o700 });
	} catch (error) {
		console.error(`refusing to reuse the output directory ${output}: ${error.code === "EEXIST" ? "it already exists" : error.message}`);
		process.exitCode = 1;
		return;
	}

	const record = {
		runId: randomUUID(),
		mode,
		source: SOURCE,
		output,
		cwd: process.cwd(),
		argv: command,
		platform: process.platform,
		runtime: { node: process.version },
		startedAt: new Date().toISOString(),
		inputHashes: inputHashes(),
		stage: "preflight",
		failureCategory: null,
		failure: null,
		targetStarted: false,
		childExitCode: null,
		childSignal: null,
		timedOut: false,
		success: false,
	};

	let child = null;
	let logFd;
	let timer;
	let timedOut = false;
	let interrupted = false;

	const killGroup = () => {
		if (!child?.pid) return;
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
	};
	const interrupt = () => {
		interrupted = true;
		try {
			killGroup();
		} catch {
			// The record still says the run was interrupted.
		}
	};

	process.on("SIGINT", interrupt);
	process.on("SIGTERM", interrupt);

	try {
		if (process.platform === "win32") {
			throw new RunnerFailure("platform", "acceptance-check.mjs needs POSIX process-group cleanup and refuses to run on Windows");
		}
		const created = createAcceptanceEnv({ mode, home: path.join(output, "home"), inheritedEnv: process.env });

		record.stage = "preflight";
		preflightAcceptanceEnv({ mode, home: created.home, env: created.env });

		// Probe with the caller's cwd so npm sees the same project context the
		// command will see. This is read-only and never installs or fetches.
		record.stage = "npm-config";
		record.npmProbe = probeNpmConfigLoading({ env: created.env, cwd: record.cwd });

		// A signal delivered while the synchronous probe ran is handled only
		// after it returns; do not start the command for an interrupted run.
		if (interrupted) throw new RunnerFailure("interrupted", "interrupted by signal");

		record.stage = "command";
		logFd = fs.openSync(path.join(output, "run.log"), "wx", 0o600);
		let spawnError = null;
		const outcome = await new Promise((resolve) => {
			let settled = false;
			const settle = (value) => {
				if (!settled) {
					settled = true;
					resolve(value);
				}
			};
			try {
				child = spawn(command[0], command.slice(1), {
					cwd: record.cwd,
					env: created.env,
					detached: true,
					stdio: ["ignore", logFd, logFd],
				});
			} catch (error) {
				// An invalid command (for example an empty argv[0]) throws
				// synchronously; it is a spawn failure, not a preflight one.
				spawnError = error;
				settle({ code: null, signal: null });
				return;
			}
			record.targetStarted = true;
			// The deadline covers the command only, never the npm probe above.
			timer = setTimeout(() => {
				timedOut = true;
				record.timedOut = true;
				try {
					killGroup();
				} catch {
					// Recorded below as a timeout regardless.
				}
			}, timeoutMs);
			child.once("error", (error) => {
				spawnError = error;
				record.targetStarted = false;
				settle({ code: null, signal: null });
			});
			child.once("close", (code, signal) => settle({ code, signal }));
		});
		clearTimeout(timer);
		timer = undefined;
		record.childExitCode = outcome.code;
		record.childSignal = outcome.signal;

		if (timedOut) throw new RunnerFailure("timeout", `command deadline of ${timeoutMs}ms exceeded`);
		if (interrupted) throw new RunnerFailure("interrupted", "interrupted by signal");
		if (spawnError) throw new RunnerFailure("spawn", spawnError.message);
		if (outcome.signal) throw new RunnerFailure("child-exit", `command exited with signal ${outcome.signal}`);
		if (outcome.code !== 0) throw new RunnerFailure("child-exit", `command exited with code ${outcome.code}`);
		record.success = true;
		record.stage = "done";
	} catch (error) {
		record.failureCategory = classOf(error);
		record.failure = error.message;
		record.success = false;
	} finally {
		clearTimeout(timer);
		process.removeListener("SIGINT", interrupt);
		process.removeListener("SIGTERM", interrupt);
		try {
			killGroup();
		} catch (error) {
			record.success = false;
			record.failureCategory = record.failureCategory ?? "internal";
			record.failure = `command cleanup failed: ${error.message}`;
		}
		if (logFd !== undefined) fs.closeSync(logFd);
		record.finishedAt = new Date().toISOString();
	}

	try {
		fs.writeFileSync(path.join(output, "run-record.json"), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
	} catch (error) {
		console.error(`could not write the run record: ${error.message}`);
		process.exitCode = 1;
		return;
	}
	console.log(
		JSON.stringify({
			success: record.success,
			failureCategory: record.failureCategory,
			failure: record.failure,
			record: path.join(output, "run-record.json"),
		}),
	);
	process.exitCode = record.success ? 0 : 1;
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
