// Run a Linux source-shell probe against the existing production build. Never build or install.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import expectedChecks from "./desktop-acceptance-contract.cjs";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const probeFile = path.join(source, "scripts", "desktop-acceptance-probe.cjs");
const inputs = ["package-lock.json", "electron/main.cjs", "electron/preload.cjs", "scripts/desktop-acceptance.mjs", "scripts/desktop-acceptance-probe.cjs", "scripts/desktop-acceptance-contract.cjs", ".next/BUILD_ID", ".next/standalone/server.js"];
function hashes() {
	return Object.fromEntries(inputs.map((name) => [name, fs.existsSync(path.join(source, name)) ? createHash("sha256").update(fs.readFileSync(path.join(source, name))).digest("hex") : null]));
}

async function main() {
	const separator = process.argv.indexOf("--", 2);
	const { values } = parseArgs({
		args: process.argv.slice(2, separator < 0 ? undefined : separator),
		options: { output: { type: "string" }, "timeout-ms": { type: "string", default: "120000" }, "no-sandbox": { type: "boolean" }, "disable-dev-shm-usage": { type: "boolean" } },
	});
	if (!values.output) throw new Error("--output must name a new evidence directory");
	const timeoutMs = Number(values["timeout-ms"]);
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new Error("--timeout-ms must be a positive timer-safe integer");
	const custom = separator < 0 ? null : process.argv.slice(separator + 1);
	if (custom && !custom.length) throw new Error("A probe command is required after --");
	// Process-group cleanup and this source-shell probe are verified on Linux only.
	if (process.platform !== "linux") throw new Error("Desktop acceptance currently supports Linux only");
	const output = path.resolve(values.output);
	fs.mkdirSync(output, { mode: 0o700 }); // Refuse existing output, including historical evidence.
	const home = path.join(output, "home");
	fs.mkdirSync(home, { mode: 0o700 });
	fs.writeFileSync(path.join(home, "auth.json"), "{}\n", { mode: 0o600, flag: "wx" });
	const runId = randomUUID();
	const resultFile = path.join(output, "result.json");
	const before = hashes();
	const record = { runId, source, output, startedAt: new Date().toISOString(), runnerVersions: process.versions, command: custom, expectedChecks, inputHashes: before, childExitCode: null, childSignal: null, timedOut: false, success: false, failure: null };
	let child;
	let log;
	let timer;
	let interrupted = false;
	function stop() {
		if (child?.pid) {
			try { process.kill(-child.pid, "SIGKILL"); }
			catch (error) { if (error.code !== "ESRCH") throw error; }
		}
	}
	function interrupt() { interrupted = true; stop(); }
	try {
		const env = {};
		for (const key of ["PATH", "LANG", "LC_ALL", "TZ", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "XAUTHORITY"]) {
			if (process.env[key]) env[key] = process.env[key];
		}
		Object.assign(env, { HOME: home, LH_DATA_DIR: path.join(home, "data"), LH_AUTH_FILE: path.join(home, "auth.json"), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NO_PROXY: "127.0.0.1,localhost", LH_ACCEPTANCE_RESULT: resultFile, LH_ACCEPTANCE_RUN_ID: runId, LH_ACCEPTANCE_OUTPUT: output, LH_ACCEPTANCE_SOURCE: source });
		if (custom) {
			// A custom probe still has to implement the same fixed report contract.
			if (process.env.ELECTRON_RUN_AS_NODE) env.ELECTRON_RUN_AS_NODE = process.env.ELECTRON_RUN_AS_NODE;
		} else {
			if (!before[".next/BUILD_ID"] || !before[".next/standalone/server.js"]) throw new Error("Existing production build missing; no automatic build is performed");
			const resources = path.join(output, "resources");
			fs.mkdirSync(resources);
			fs.symlinkSync(path.join(source, ".next"), path.join(resources, "server"), "dir");
			// Chromium socket paths need a short directory, independent of the evidence path.
			env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "lh-desktop-"));
			record.temporaryDirectory = env.TMPDIR;
			record.command = [createRequire(import.meta.url)("electron"), ...["no-sandbox", "disable-dev-shm-usage"].filter((key) => values[key]).map((key) => `--${key}`), probeFile];
		}
		log = fs.openSync(path.join(output, "probe.log"), "wx", 0o600);
		child = spawn(record.command[0], record.command.slice(1), { cwd: source, env, detached: true, stdio: ["ignore", log, log] });
		process.on("SIGINT", interrupt);
		process.on("SIGTERM", interrupt);
		timer = setTimeout(() => { record.timedOut = true; stop(); }, timeoutMs);
		let spawnError;
		const outcome = await new Promise((resolve) => {
			child.once("error", (error) => { spawnError = error; });
			child.once("close", (code, signal) => resolve({ code, signal }));
		});
		record.childExitCode = outcome.code;
		record.childSignal = outcome.signal;
		if (record.timedOut) throw new Error("Runner deadline exceeded");
		if (interrupted) throw new Error("Runner interrupted");
		if (spawnError || outcome.code !== 0 || outcome.signal) throw new Error(spawnError?.message ?? "Probe did not exit successfully");
		const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
		if (!result || result.runId !== runId) throw new Error("Result belongs to a different invocation");
		if (result.timeout !== false || result.completed !== true || result.success !== true) throw new Error("Probe timed out or did not complete successfully");
		if (result.error || result.preloadError || result.debuggerError) throw new Error("Probe reported an execution error");
		if (!Array.isArray(result.assertions) || result.assertions.length !== expectedChecks.length) throw new Error("Expected assertion set is incomplete");
		const seen = new Set();
		for (const assertion of result.assertions) {
			if (!assertion || !expectedChecks.includes(assertion.name) || seen.has(assertion.name)) throw new Error("Unexpected or duplicate assertion");
			if (assertion.pass !== true || assertion.actual !== true || assertion.expected !== true) throw new Error(`Assertion failed: ${assertion.name}`);
			seen.add(assertion.name);
		}
		if (JSON.stringify(hashes()) !== JSON.stringify(before)) throw new Error("Acceptance inputs changed during the run");
		record.success = true;
	} catch (error) { record.failure = error.message; }
	finally {
		clearTimeout(timer);
		process.removeListener("SIGINT", interrupt);
		process.removeListener("SIGTERM", interrupt);
		try { stop(); } catch (error) { record.success = false; record.failure = `Probe cleanup failed: ${error.message}`; }
		if (log !== undefined) fs.closeSync(log);
		record.finishedAt = new Date().toISOString();
		fs.writeFileSync(path.join(output, "run-record.json"), JSON.stringify(record, null, 2), { mode: 0o600, flag: "wx" });
	}
	console.log(JSON.stringify({ success: record.success, failure: record.failure, record: path.join(output, "run-record.json") }));
	process.exitCode = record.success ? 0 : 1;
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
