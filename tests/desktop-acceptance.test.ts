import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { test as nodeTest } from "node:test";

const test = process.platform === "linux" ? nodeTest : nodeTest.skip;
const runner = path.resolve("scripts/desktop-acceptance.mjs");
const expectedChecks: string[] = createRequire(import.meta.url)("../scripts/desktop-acceptance-contract.cjs");
const passingReport = `const report = {runId: process.env.LH_ACCEPTANCE_RUN_ID, completed: true, success: true, timeout: false, assertions: ${JSON.stringify(expectedChecks.map((name) => ({ name, pass: true, actual: true, expected: true })))}};`;
const saveReport = "fs.writeFileSync(process.env.LH_ACCEPTANCE_RESULT, JSON.stringify(report));";

function runProbe(body: string, extraArgs: string[] = []) {
	const root = mkdtempSync(path.join(tmpdir(), "lh-runner-test-"));
	const output = path.join(root, "evidence");
	const child = `const fs = require('node:fs'); ${body}`;
	try {
		const process = spawnSync(globalThis.process.execPath, [runner, "--output", output, ...extraArgs, "--", globalThis.process.execPath, "-e", child], {
			env: { ...globalThis.process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 15_000,
		});
		const record = JSON.parse(readFileSync(path.join(output, "run-record.json"), "utf8"));
		return { code: process.status, record, stderr: process.stderr };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("desktop runner enforces its own deadline even after a probe writes passing results", () => {
	const result = runProbe(passingReport + saveReport + "setInterval(() => {}, 1000);", ["--timeout-ms", "500"]);
	assert.equal(result.code, 1);
	assert.equal(result.record.timedOut, true);
	assert.match(result.record.failure, /deadline|timeout/i);
});

for (const [name, change] of [
	["one omitted assertion", "report.assertions.pop();"],
	["duplicate assertion instead of a required check", "report.assertions[21] = report.assertions[0];"],
	["unexpected assertion instead of a required check", 'report.assertions[21].name = "unplanned check";'],
	["failed assertion", "report.assertions[0].pass = false;"],
	["passing flag hiding a false observation", "report.assertions[0].actual = false;"],
	["changed expected value", "report.assertions[0].expected = false;"],
	["missing timeout flag", "delete report.timeout;"],
	["missing completion flag", "delete report.completed;"],
	["false completion flag", "report.completed = false;"],
	["false success flag", "report.success = false;"],
	["missing success flag", "delete report.success;"],
	["string success flag", 'report.success = "true";'],
	["reported timeout despite passing checks", "report.timeout = true;"],
	["preload error despite passing checks", 'report.preloadError = "failed to load";'],
	["debugger error despite passing checks", 'report.debuggerError = "not attached";'],
	["execution error despite passing checks", 'report.error = "failed";'],
] as const) {
	test(`desktop runner rejects ${name}`, () => {
		const result = runProbe(passingReport + change + saveReport);
		assert.equal(result.record.childExitCode, 0);
		assert.equal(result.code, 1);
		assert.equal(result.record.success, false);
		assert.ok(result.record.failure);
	});
}

test("desktop runner rejects malformed JSON and missing result files", () => {
	for (const body of ['fs.writeFileSync(process.env.LH_ACCEPTANCE_RESULT, "{");', ""]) {
		const result = runProbe(body);
		assert.equal(result.record.childExitCode, 0);
		assert.equal(result.code, 1);
	}
});

test("desktop runner rejects a nonzero exit even after a complete passing report", () => {
	const result = runProbe(passingReport + saveReport + "process.exit(7);");
	assert.equal(result.record.childExitCode, 7);
	assert.equal(result.code, 1);
});

test("desktop runner refuses existing output without modifying historical evidence", () => {
	const root = mkdtempSync(path.join(tmpdir(), "lh-runner-history-"));
	try {
		const before = 'unique historical failure';
		const file = path.join(root, "result.json");
		writeFileSync(file, before);
		const result = spawnSync(process.execPath, [runner, "--output", root, "--", process.execPath, "-e", ""], { encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
		assert.equal(result.status, 1);
		assert.equal(readFileSync(file, "utf8"), before);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("desktop runner accepts the complete passing plan from this invocation", () => {
	assert.equal(expectedChecks.length, 22);
	const result = runProbe(passingReport + saveReport);
	assert.equal(result.code, 0, result.stderr);
	assert.equal(result.record.success, true);
});

test("desktop runner rejects a complete report from a different invocation", () => {
	const result = runProbe(passingReport + 'report.runId = "previous-run";' + saveReport);
	assert.equal(result.record.childExitCode, 0);
	assert.equal(result.code, 1);
	assert.match(result.record.failure, /invocation|run/i);
});

test("desktop runner rejects claimed success with no expected assertions", () => {
	const result = runProbe(`fs.writeFileSync(process.env.LH_ACCEPTANCE_RESULT, JSON.stringify({runId: process.env.LH_ACCEPTANCE_RUN_ID, completed: true, success: true, timeout: false, assertions: []}));`);
	assert.equal(result.record.childExitCode, 0);
	assert.equal(result.code, 1);
	assert.match(result.record.failure, /assertion/i);
});

test("desktop runner rejects a zero-exit probe that timed out without running assertions", () => {
	const result = runProbe(`fs.writeFileSync(process.env.LH_ACCEPTANCE_RESULT, JSON.stringify({runId: process.env.LH_ACCEPTANCE_RUN_ID, timeout: true, assertions: []}));`);
	assert.equal(result.record.childExitCode, 0);
	assert.equal(result.code, 1);
	assert.equal(result.record.success, false);
	assert.match(result.record.failure, /timeout|complete/i);
});
