/**
 * The acceptance environment gate (issue #41): suite and smoke runs must
 * execute inside a profile the invocation itself owns, and must not see the
 * machine's credentials, proxies, or Node injection variables.
 *
 * Tests observe the two approved seams only — createAcceptanceEnv and
 * preflightAcceptanceEnv — plus the public CLI (scripts/acceptance-check.mjs).
 * No test reads a real credential: every value below is a throwaway string.
 *
 * Fixtures live under LH_ACCEPTANCE_TEST_TMP when the runner sets it (the
 * approved evidence tree); a plain checkout falls back to the platform temp
 * directory. Nothing here touches a real HOME or auth file.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";

import { createAcceptanceEnv, preflightAcceptanceEnv } from "../scripts/acceptance-env.mjs";

const TMP_ROOT = process.env.LH_ACCEPTANCE_TEST_TMP ?? fs.mkdtempSync(path.join(os.tmpdir(), "lh-acceptance-env-"));
fs.mkdirSync(TMP_ROOT, { recursive: true });

function scratch(label: string): string {
	return fs.mkdtempSync(path.join(TMP_ROOT, `${label}-`));
}

function inside(base: string, candidate: string): boolean {
	const rel = path.relative(path.resolve(base), path.resolve(candidate));
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Everything a caller might hold in its own environment, all fake values. */
const INHERITED: Record<string, string> = {
	PATH: "/usr/local/bin:/usr/bin:/bin",
	LANG: "C.UTF-8",
	TZ: "UTC",
	OPENAI_API_KEY: "sk-fake-openai",
	OPENROUTER_API_KEY: "sk-or-fake",
	ANTHROPIC_API_KEY: "sk-ant-fake",
	AWS_SECRET_ACCESS_KEY: "fake-aws-secret",
	GITHUB_TOKEN: "fake-github-token",
	GOOGLE_APPLICATION_CREDENTIALS: "/tmp/fake-google-credentials.json",
	HTTP_PROXY: "http://proxy.invalid:1",
	HTTPS_PROXY: "http://proxy.invalid:1",
	http_proxy: "http://proxy.invalid:1",
	ALL_PROXY: "socks5://proxy.invalid:1",
	NO_PROXY: "localhost",
	NODE_ENV: "development",
	NODE_OPTIONS: "--require=/tmp/fake-inject.cjs",
	NODE_PATH: "/tmp/fake-node-path",
	NODE_EXTRA_CA_CERTS: "/tmp/fake-ca.pem",
	NODE_TLS_REJECT_UNAUTHORIZED: "0",
	NODE_USE_ENV_PROXY: "1",
	ELECTRON_RUN_AS_NODE: "1",
	npm_config_registry: "https://registry.invalid/",
	NPM_CONFIG_REGISTRY: "https://registry.invalid/",
	LH_IGNORE_ENV_KEYS: "1",
	LH_DATA_DIR: "/home/real-user/learnharness/data",
	LH_AUTH_FILE: "/home/real-user/.learnharness/auth.json",
	TMPDIR: "/home/real-user/tmp",
	TMP: "/home/real-user/tmp",
	TEMP: "/home/real-user/tmp",
};

type CheckError = { code?: string; message: string };

/** Run a check that must reject, and return the error it raised. */
function rejection(run: () => unknown): CheckError {
	try {
		run();
	} catch (error) {
		return error as CheckError;
	}
	assert.fail("expected the check to reject");
}

describe("createAcceptanceEnv", () => {
	it("carries only process basics and owns every path inside the given home", () => {
		const root = scratch("suite");
		const home = path.join(root, "home");
		try {
			const created = createAcceptanceEnv({ mode: "suite", home, inheritedEnv: INHERITED });
			const env = created.env as Record<string, string>;

			// Positive: the process basics survive, so commands can still run.
			assert.equal(env.PATH, INHERITED.PATH);
			assert.equal(env.LANG, INHERITED.LANG);
			assert.equal(env.TZ, INHERITED.TZ);

			// Negative: no credential, proxy, or Node injection reaches the command.
			for (const key of [
				"OPENAI_API_KEY",
				"OPENROUTER_API_KEY",
				"ANTHROPIC_API_KEY",
				"AWS_SECRET_ACCESS_KEY",
				"GITHUB_TOKEN",
				"GOOGLE_APPLICATION_CREDENTIALS",
				"HTTP_PROXY",
				"HTTPS_PROXY",
				"http_proxy",
				"ALL_PROXY",
				"NO_PROXY",
				"NODE_OPTIONS",
				"NODE_PATH",
				"NODE_EXTRA_CA_CERTS",
				"NODE_TLS_REJECT_UNAUTHORIZED",
				"NODE_USE_ENV_PROXY",
				"ELECTRON_RUN_AS_NODE",
				"npm_config_registry",
				"NPM_CONFIG_REGISTRY",
				"LH_IGNORE_ENV_KEYS",
				"TMPDIR",
				"TMP",
				"TEMP",
			]) {
				assert.equal(env[key], undefined, `${key} must not reach the acceptance command`);
			}
			// The owned paths replace the inherited ones instead of riding along.
			assert.notEqual(env.LH_DATA_DIR, INHERITED.LH_DATA_DIR);
			assert.notEqual(env.LH_AUTH_FILE, INHERITED.LH_AUTH_FILE);

			// NODE_ENV is fixed by the mode, never inherited.
			assert.equal(env.NODE_ENV, "test");

			// The profile is the only home the command can see.
			assert.equal(fs.realpathSync(home), fs.realpathSync(env.HOME as string));
			for (const key of [
				"USERPROFILE",
				"APPDATA",
				"LOCALAPPDATA",
				"XDG_CONFIG_HOME",
				"XDG_CACHE_HOME",
				"LH_DATA_DIR",
				"LH_AUTH_FILE",
			]) {
				assert.ok(env[key], `${key} must be set`);
				assert.ok(inside(home, env[key] as string), `${key} must stay inside the owned home: ${env[key]}`);
			}

			// The auth file starts empty, mode 0600, and the home itself is private.
			assert.deepEqual(JSON.parse(fs.readFileSync(env.LH_AUTH_FILE as string, "utf8")), {});
			assert.equal(fs.statSync(env.LH_AUTH_FILE as string).mode & 0o777, 0o600);
			assert.equal(fs.statSync(home).mode & 0o777, 0o700);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("pins the fresh-user switch for smoke and keeps npm offline with two empty config files", () => {
		const root = scratch("smoke");
		const home = path.join(root, "home");
		try {
			const env = createAcceptanceEnv({ mode: "smoke", home, inheritedEnv: { ...INHERITED, LH_IGNORE_ENV_KEYS: "0" } }).env as Record<
				string,
				string
			>;

			// Smoke always runs with the switch ON, whatever the caller exported.
			assert.equal(env.LH_IGNORE_ENV_KEYS, "1");
			assert.equal(env.NODE_ENV, "production");

			// npm must not reach the network or nag during acceptance.
			assert.equal(env.NPM_CONFIG_OFFLINE, "true");
			assert.equal(env.NPM_CONFIG_AUDIT, "false");
			assert.equal(env.NPM_CONFIG_FUND, "false");
			assert.equal(env.NPM_CONFIG_UPDATE_NOTIFIER, "false");
			assert.equal(env.NEXT_TELEMETRY_DISABLED, "1");

			for (const key of ["NPM_CONFIG_USERCONFIG", "NPM_CONFIG_GLOBALCONFIG", "NPM_CONFIG_CACHE"]) {
				assert.ok(env[key], `${key} must be set`);
				assert.ok(inside(home, env[key] as string), `${key} must stay inside the owned home: ${env[key]}`);
			}

			// Two different, empty, plain files — never symlinks or devices.
			const user = fs.lstatSync(env.NPM_CONFIG_USERCONFIG as string);
			const global = fs.lstatSync(env.NPM_CONFIG_GLOBALCONFIG as string);
			for (const [name, stat] of [
				["user", user],
				["global", global],
			] as const) {
				assert.ok(stat.isFile(), `${name} npm config must be a regular file`);
				assert.equal(stat.isSymbolicLink(), false, `${name} npm config must not be a symlink`);
				assert.equal(stat.size, 0, `${name} npm config must be empty`);
			}
			assert.notEqual(env.NPM_CONFIG_USERCONFIG, env.NPM_CONFIG_GLOBALCONFIG);
			assert.ok(user.dev !== global.dev || user.ino !== global.ino, "user and global npm config must be different files");
			assert.ok(fs.statSync(env.NPM_CONFIG_CACHE as string).isDirectory(), "npm cache must be an owned directory");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("preflightAcceptanceEnv", () => {
	it("accepts the profile createAcceptanceEnv built for either mode", () => {
		for (const mode of ["suite", "smoke"] as const) {
			const root = scratch(`preflight-${mode}`);
			const home = path.join(root, "home");
			try {
				const created = createAcceptanceEnv({ mode, home, inheritedEnv: INHERITED });
				const checked = preflightAcceptanceEnv({ mode, home, env: created.env }) as {
					mode: string;
					home: string;
					authFile: string;
					npm: { userConfig: string; globalConfig: string; cache: string };
				};
				assert.equal(checked.mode, mode);
				assert.equal(checked.home, fs.realpathSync(home));
				assert.equal(checked.authFile, created.authFile);
				assert.equal(checked.npm.userConfig, created.npm.userConfig);
				assert.equal(checked.npm.globalConfig, created.npm.globalConfig);
				assert.equal(checked.npm.cache, created.npm.cache);
			} finally {
				fs.rmSync(root, { recursive: true, force: true });
			}
		}
	});
});

describe("preflightAcceptanceEnv: npm config files", () => {
	/** A valid profile plus a mutable copy of its env. */
	function profile(label: string) {
		const root = scratch(`npm-${label}`);
		const home = path.join(root, "home");
		const created = createAcceptanceEnv({ mode: "suite", home, inheritedEnv: INHERITED });
		return { root, home, created, env: { ...created.env } as Record<string, string> };
	}

	function reject(mode: "suite" | "smoke", home: string, env: Record<string, string>): CheckError {
		return rejection(() => preflightAcceptanceEnv({ mode, home, env }));
	}

	it("rejects user and global config naming the same path", () => {
		const { root, home, created, env } = profile("same-path");
		try {
			env.NPM_CONFIG_GLOBALCONFIG = created.npm.userConfig;
			const error = reject("suite", home, env);
			assert.equal(error.code, "npm-config-same-file");
			assert.match(error.message, /different files/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a hardlink to the same file", () => {
		const { root, home, created, env } = profile("hardlink");
		try {
			const link = path.join(home, "npm", "global-link.npmrc");
			fs.linkSync(created.npm.userConfig, link);
			env.NPM_CONFIG_GLOBALCONFIG = link;
			assert.equal(reject("suite", home, env).code, "npm-config-same-file");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a missing config file", () => {
		const { root, home, env } = profile("missing");
		try {
			env.NPM_CONFIG_USERCONFIG = path.join(home, "npm", "does-not-exist.npmrc");
			const error = reject("suite", home, env);
			assert.equal(error.code, "path-missing");
			assert.match(error.message, /NPM_CONFIG_USERCONFIG/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a non-empty config file without echoing its contents", () => {
		const { root, home, env } = profile("non-empty");
		try {
			const secret = "SECRET-NPM-CONFIG-VALUE";
			fs.writeFileSync(env.NPM_CONFIG_USERCONFIG as string, `registry=${secret}\n`);
			const error = reject("suite", home, env);
			assert.equal(error.code, "path-not-empty");
			assert.match(error.message, /NPM_CONFIG_USERCONFIG/);
			assert.equal(error.message.includes(secret), false, "the rejected content must never appear in the message");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a symlinked config file", () => {
		const { root, home, env } = profile("symlink");
		try {
			const target = path.join(home, "npm", "target.npmrc");
			fs.writeFileSync(target, "");
			const link = path.join(home, "npm", "user-link.npmrc");
			fs.symlinkSync(target, link);
			env.NPM_CONFIG_USERCONFIG = link;
			const error = reject("suite", home, env);
			assert.equal(error.code, "path-symlink");
			assert.match(error.message, /NPM_CONFIG_USERCONFIG/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects /dev/null without opening it, including the duplicate case", () => {
		const { root, home, env } = profile("dev-null");
		try {
			// Outside-home is decided from the path alone, so the device is
			// never lstat'ed, opened, or read.
			env.NPM_CONFIG_USERCONFIG = "/dev/null";
			const device = reject("suite", home, env);
			assert.equal(device.code, "path-outside-home");
			assert.match(device.message, /NPM_CONFIG_USERCONFIG/);
			assert.match(device.message, /\/dev\/null/);

			// Duplicate /dev/null is still an explicit rejection, not "two
			// different empty files".
			env.NPM_CONFIG_GLOBALCONFIG = "/dev/null";
			assert.equal(reject("suite", home, env).code, "path-outside-home");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a directory as a config file without opening it", () => {
		const { root, home, env } = profile("directory");
		try {
			env.NPM_CONFIG_USERCONFIG = path.join(home, "npm");
			const directory = reject("suite", home, env);
			assert.equal(directory.code, "path-not-regular");
			assert.match(directory.message, /NPM_CONFIG_USERCONFIG/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a FIFO as non-regular without blocking on a read", () => {
		if (process.platform === "win32") return;
		const { root, home, env } = profile("fifo");
		try {
			const fifo = path.join(home, "npm", "user.fifo");
			execFileSync("mkfifo", [fifo]);
			env.NPM_CONFIG_USERCONFIG = fifo;
			assert.equal(reject("suite", home, env).code, "path-not-regular");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects an empty config file outside the owned home", () => {
		const { root, home, env } = profile("outside");
		try {
			const outside = path.join(root, "outside.npmrc");
			fs.writeFileSync(outside, "");
			env.NPM_CONFIG_GLOBALCONFIG = outside;
			const error = reject("suite", home, env);
			assert.equal(error.code, "path-outside-home");
			assert.match(error.message, /NPM_CONFIG_GLOBALCONFIG/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a path that leaves the home through a symlinked parent", () => {
		const { root, home, env } = profile("parent-escape");
		try {
			const outside = path.join(root, "outside-dir");
			fs.mkdirSync(outside);
			fs.writeFileSync(path.join(outside, "empty.npmrc"), "");
			fs.symlinkSync(outside, path.join(home, "npm", "escape"), "dir");
			env.NPM_CONFIG_USERCONFIG = path.join(home, "npm", "escape", "empty.npmrc");
			assert.equal(reject("suite", home, env).code, "path-outside-home");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("preflightAcceptanceEnv: environment shape", () => {
	function profile(mode: "suite" | "smoke", label: string) {
		const root = scratch(`shape-${label}`);
		const home = path.join(root, "home");
		const created = createAcceptanceEnv({ mode, home, inheritedEnv: INHERITED });
		return { root, home, created, env: { ...created.env } as Record<string, string> };
	}

	function reject(mode: "suite" | "smoke", home: string, env: Record<string, string>): CheckError {
		return rejection(() => preflightAcceptanceEnv({ mode, home, env }));
	}

	it("rejects an unknown mode before touching the profile", () => {
		const { root, home } = profile("suite", "bad-mode");
		try {
			const error = rejection(() => preflightAcceptanceEnv({ mode: "regression" as never, home, env: {} }));
			assert.equal(error.code, "mode-invalid");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("requires the fresh-user switch to match the mode", () => {
		const suite = profile("suite", "switch-suite");
		try {
			suite.env.LH_IGNORE_ENV_KEYS = "1";
			assert.equal(reject("suite", suite.home, suite.env).code, "mode-incompatible");
			suite.env.LH_IGNORE_ENV_KEYS = "0";
			assert.equal(reject("suite", suite.home, suite.env).code, "mode-incompatible");
		} finally {
			fs.rmSync(suite.root, { recursive: true, force: true });
		}

		const smoke = profile("smoke", "switch-smoke");
		try {
			preflightAcceptanceEnv({ mode: "smoke", home: smoke.home, env: smoke.env });
			delete smoke.env.LH_IGNORE_ENV_KEYS;
			assert.equal(reject("smoke", smoke.home, smoke.env).code, "mode-incompatible");
			smoke.env.LH_IGNORE_ENV_KEYS = "0";
			assert.equal(reject("smoke", smoke.home, smoke.env).code, "mode-incompatible");
		} finally {
			fs.rmSync(smoke.root, { recursive: true, force: true });
		}
	});

	it("requires NODE_ENV fixed by the mode", () => {
		const { root, home, env } = profile("suite", "node-env");
		try {
			env.NODE_ENV = "production";
			const error = reject("suite", home, env);
			assert.equal(error.code, "env-incompatible");
			assert.match(error.message, /NODE_ENV/);
			delete env.NODE_ENV;
			assert.equal(reject("suite", home, env).code, "env-incompatible");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a credential variable by name without echoing its value", () => {
		const { root, home, env } = profile("suite", "credential");
		try {
			env.OPENAI_API_KEY = "sk-fake-value-must-not-appear";
			const error = reject("suite", home, env);
			assert.equal(error.code, "env-unexpected-key");
			assert.match(error.message, /OPENAI_API_KEY/);
			assert.equal(error.message.includes("sk-fake-value-must-not-appear"), false);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("requires npm to stay offline and quiet", () => {
		const { root, home, env } = profile("suite", "npm-policy");
		try {
			for (const key of ["NPM_CONFIG_OFFLINE", "NPM_CONFIG_AUDIT", "NPM_CONFIG_FUND", "NPM_CONFIG_UPDATE_NOTIFIER"]) {
				const original = env[key] as string;
				env[key] = original === "true" ? "false" : "true";
				const error = reject("suite", home, env);
				assert.equal(error.code, "env-incompatible", `${key} must be pinned`);
				assert.match(error.message, new RegExp(key));
				env[key] = original;
			}
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("requires PATH so the npm probe and the command can be resolved", () => {
		const { root, home, env } = profile("suite", "path-missing");
		try {
			delete env.PATH;
			const error = reject("suite", home, env);
			assert.equal(error.code, "missing-env");
			assert.match(error.message, /PATH/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("requires HOME to name the owned home", () => {
		const { root, home, env } = profile("suite", "home-mismatch");
		try {
			const other = path.join(root, "other-home");
			fs.mkdirSync(other);
			env.HOME = other;
			const error = reject("suite", home, env);
			assert.equal(error.code, "home-mismatch");
			assert.match(error.message, /HOME/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("preflightAcceptanceEnv: profile directories and auth", () => {
	function profile(label: string) {
		const root = scratch(`profile-${label}`);
		const home = path.join(root, "home");
		const created = createAcceptanceEnv({ mode: "suite", home, inheritedEnv: INHERITED });
		return { root, home, created, env: { ...created.env } as Record<string, string> };
	}

	function reject(home: string, env: Record<string, string>): CheckError {
		return rejection(() => preflightAcceptanceEnv({ mode: "suite", home, env }));
	}

	it("requires every profile directory to stay inside the owned home", () => {
		const { root, home, env } = profile("dirs");
		try {
			const outside = path.join(root, "outside-data");
			fs.mkdirSync(outside);
			env.LH_DATA_DIR = outside;
			const escaped = reject(home, env);
			assert.equal(escaped.code, "path-outside-home");
			assert.match(escaped.message, /LH_DATA_DIR/);
			env.LH_DATA_DIR = path.join(home, "data");

			env.XDG_CACHE_HOME = path.join(home, "xdg-cache-missing");
			assert.equal(reject(home, env).code, "path-missing");
			env.XDG_CACHE_HOME = path.join(home, "xdg-cache");

			env.APPDATA = path.join(home, "auth.json");
			assert.equal(reject(home, env).code, "path-not-directory");
			env.APPDATA = path.join(home, "appdata");

			const link = path.join(home, "appdata-link");
			fs.symlinkSync(path.join(home, "appdata"), link, "dir");
			env.APPDATA = link;
			assert.equal(reject(home, env).code, "path-symlink");
			env.APPDATA = path.join(home, "appdata");

			env.NPM_CONFIG_CACHE = path.join(root, "outside-cache");
			assert.equal(reject(home, env).code, "path-outside-home");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a non-empty auth file without echoing its contents", () => {
		const { root, home, env } = profile("auth-non-empty");
		try {
			const secret = "sk-fake-auth-value";
			fs.writeFileSync(env.LH_AUTH_FILE as string, JSON.stringify({ OPENAI_API_KEY: secret }));
			const error = reject(home, env);
			assert.equal(error.code, "auth-not-empty");
			assert.match(error.message, /auth/i);
			assert.equal(error.message.includes(secret), false);
			assert.equal(error.message.includes("OPENAI_API_KEY"), false);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects an invalid or symlinked auth file before reading it", () => {
		const { root, home, env } = profile("auth-invalid");
		try {
			fs.writeFileSync(env.LH_AUTH_FILE as string, "not json");
			assert.equal(reject(home, env).code, "auth-invalid");

			const target = path.join(home, "auth-target.json");
			fs.writeFileSync(target, "{}\n");
			const link = path.join(home, "auth-link.json");
			fs.symlinkSync(target, link);
			env.LH_AUTH_FILE = link;
			assert.equal(reject(home, env).code, "path-symlink");

			env.LH_AUTH_FILE = path.join(home, "missing-auth.json");
			assert.equal(reject(home, env).code, "path-missing");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// The public CLI: scripts/acceptance-check.mjs
// ---------------------------------------------------------------------------

const CLI = path.resolve("scripts/acceptance-check.mjs");
const TEST_HOME = path.join(TMP_ROOT, "cli-runner-home");
fs.mkdirSync(TEST_HOME, { recursive: true });

/** A synthetic command: a POSIX shell script, so no runtime needs PATH tricks. */
function fakeCommand(root: string, name: string, body: string): string {
	const file = path.join(root, name);
	fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
	return file;
}

const CLI_CALLER_ENV: NodeJS.ProcessEnv = {
	HOME: TEST_HOME,
	PATH: "/usr/local/bin:/usr/bin:/bin",
	LANG: "C.UTF-8",
	TZ: "UTC",
	ELECTRON_RUN_AS_NODE: "1",
	// Present only to satisfy ProcessEnv typing; the isolated env sets its own
	// value and the command must never see this one.
	NODE_ENV: "development",
};

function cliEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
	return Object.assign({}, CLI_CALLER_ENV, overrides);
}

function runCli(options: {
	args: string[];
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	timeoutMs?: number;
}): { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, [CLI, ...options.args], {
		cwd: options.cwd ?? process.cwd(),
		env: options.env ?? cliEnv(),
		encoding: "utf8",
		timeout: options.timeoutMs ?? 60_000,
	});
	return { code: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
}

type AcceptanceRunRecord = {
	runId: string;
	mode: string;
	source: string;
	output: string;
	cwd: string;
	argv: string[];
	platform: string;
	runtime: { node: string };
	startedAt: string;
	finishedAt?: string;
	inputHashes: Record<string, string | null>;
	stage: string;
	failureCategory: string | null;
	failure: string | null;
	targetStarted: boolean;
	childExitCode: number | null;
	childSignal: string | null;
	timedOut: boolean;
	success: boolean;
	npmProbe?: { userConfig: string; globalConfig: string };
};

function readRecord(output: string): AcceptanceRunRecord {
	return JSON.parse(fs.readFileSync(path.join(output, "run-record.json"), "utf8")) as AcceptanceRunRecord;
}

describe("acceptance-check.mjs", () => {
	it("runs the command in the isolated profile and keeps the log and the record", () => {
		const root = scratch("cli-success");
		try {
			const seen = path.join(root, "home-seen.txt");
			const dump = path.join(root, "env-dump.txt");
			const fake = fakeCommand(root, "success.sh", `printf 'hello from command\\n'\nprintf '%s' "$HOME" > "$2"\nenv > "$1"`);
			const output = path.join(root, "evidence");

			const result = runCli({ args: ["--mode", "suite", "--output", output, "--", fake, dump, seen] });
			assert.equal(result.code, 0, `stderr: ${result.stderr}`);
			const record = readRecord(output);

			assert.equal(record.success, true);
			assert.equal(record.mode, "suite");
			assert.equal(record.cwd, process.cwd());
			assert.deepEqual(record.argv, [fake, dump, seen]);
			assert.equal(record.targetStarted, true);
			assert.equal(record.childExitCode, 0);
			assert.equal(record.stage, "done");
			assert.equal(record.source, process.cwd());
			assert.match(fs.readFileSync(path.join(output, "run.log"), "utf8"), /hello from command/);

			// The command's HOME is the isolated profile, not the caller's.
			assert.ok(inside(path.join(output, "home"), fs.readFileSync(seen, "utf8")));

			// Reproduction metadata: hashes, not an environment dump.
			for (const input of ["package-lock.json", "scripts/acceptance-env.mjs", "scripts/acceptance-check.mjs"]) {
				assert.match(record.inputHashes[input] ?? "", /^[0-9a-f]{64}$/, `${input} hash`);
			}
			assert.equal("env" in record, false, "the record must not dump the environment");

			// The npm probe loaded exactly the owned config files.
			assert.equal(record.npmProbe?.userConfig, path.join(output, "home", "npm", "user.npmrc"));
			assert.equal(record.npmProbe?.globalConfig, path.join(output, "home", "npm", "global.npmrc"));

			// The environment the command actually saw: isolated, no secrets.
			const environment = fs.readFileSync(dump, "utf8");
			assert.match(environment, /^NODE_ENV=test$/m);
			assert.equal(/^LH_IGNORE_ENV_KEYS=/m.test(environment), false, "suite must not carry the fresh-user switch");
			for (const key of ["OPENAI_API_KEY", "HTTP_PROXY", "NODE_OPTIONS", "TMPDIR", "ELECTRON_RUN_AS_NODE"]) {
				assert.equal(new RegExp(`^${key}=`, "m").test(environment), false, `${key} leaked into the command`);
			}
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("runs the npm config probe in the command's cwd", () => {
		const root = scratch("cli-probe-cwd");
		try {
			const cwdLog = path.join(root, "npm-cwd.txt");
			const bin = path.join(root, "bin");
			fs.mkdirSync(bin);
			fs.writeFileSync(
				path.join(bin, "npm"),
				`#!/bin/sh\nprintf '%s' "$PWD" > '${cwdLog}'\ncase "$3" in userconfig) printf '%s\\n' "$NPM_CONFIG_USERCONFIG" ;; globalconfig) printf '%s\\n' "$NPM_CONFIG_GLOBALCONFIG" ;; *) exit 9 ;; esac\n`,
				{ mode: 0o700 },
			);
			const fake = fakeCommand(root, "success.sh", `printf 'ok\\n'`);
			const output = path.join(root, "evidence");
			const result = runCli({ args: ["--mode", "suite", "--output", output, "--", fake], env: cliEnv({ PATH: bin }) });
			assert.equal(result.code, 0, result.stderr);
			assert.equal(fs.readFileSync(cwdLog, "utf8"), process.cwd(), "npm must see the same project context as the command");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("records a failed command as child-exit and keeps its log", () => {
		const root = scratch("cli-child-exit");
		try {
			const fake = fakeCommand(root, "fail.sh", `printf 'about to fail\\n'\nexit 3`);
			const output = path.join(root, "evidence");
			const result = runCli({ args: ["--mode", "suite", "--output", output, "--", fake] });
			assert.equal(result.code, 1, result.stderr);
			const record = readRecord(output);
			assert.equal(record.success, false);
			assert.equal(record.failureCategory, "child-exit");
			assert.equal(record.stage, "command");
			assert.equal(record.targetStarted, true);
			assert.equal(record.childExitCode, 3);
			assert.match(record.failure ?? "", /3/);
			assert.match(fs.readFileSync(path.join(output, "run.log"), "utf8"), /about to fail/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not start the command when preflight rejects the environment", () => {
		const root = scratch("cli-preflight");
		try {
			const marker = path.join(root, "target-ran.txt");
			const fake = fakeCommand(root, "must-not-run.sh", `printf 'ran' > "$1"`);
			const output = path.join(root, "evidence");
			// No PATH: the isolated env cannot resolve the npm probe or the command.
			const env = cliEnv();
			delete env.PATH;
			const result = runCli({ args: ["--mode", "suite", "--output", output, "--", fake, marker], env });
			assert.equal(result.code, 1, result.stderr);
			const record = readRecord(output);
			assert.equal(record.success, false);
			assert.equal(record.failureCategory, "preflight");
			assert.equal(record.stage, "preflight");
			assert.equal(record.targetStarted, false);
			assert.equal(fs.existsSync(marker), false, "the command must not start after a preflight failure");
			assert.equal(fs.existsSync(path.join(output, "run.log")), false);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not start the command when npm loads a different config or cannot start", () => {
		const root = scratch("cli-npm-config");
		try {
			const bin = path.join(root, "bin");
			fs.mkdirSync(bin);
			// A stand-in npm that reports config files nobody owns.
			fs.writeFileSync(
				path.join(bin, "npm"),
				"#!/bin/sh\ncase \"$3\" in userconfig) printf '/tmp/real-user.npmrc\\n' ;; globalconfig) printf '/tmp/real-global.npmrc\\n' ;; *) exit 9 ;; esac\n",
				{ mode: 0o700 },
			);
			const marker = path.join(root, "target-ran.txt");
			const fake = fakeCommand(root, "must-not-run.sh", `printf 'ran' > "$1"`);
			const output = path.join(root, "evidence");
			const result = runCli({ args: ["--mode", "suite", "--output", output, "--", fake, marker], env: cliEnv({ PATH: bin }) });
			assert.equal(result.code, 1, result.stderr);
			const record = readRecord(output);
			assert.equal(record.failureCategory, "npm-config");
			assert.equal(record.stage, "npm-config");
			assert.equal(record.targetStarted, false);
			assert.match(record.failure ?? "", /npm/);
			assert.equal(fs.existsSync(marker), false, "the command must not start after a failed config probe");

			// A PATH without any npm is a config-probe failure, not a command failure.
			const emptyBin = path.join(root, "empty-bin");
			fs.mkdirSync(emptyBin);
			const noNpm = path.join(root, "evidence-2");
			const result2 = runCli({ args: ["--mode", "suite", "--output", noNpm, "--", fake, marker], env: cliEnv({ PATH: emptyBin }) });
			assert.equal(result2.code, 1, result2.stderr);
			const record2 = readRecord(noNpm);
			assert.equal(record2.failureCategory, "npm-config");
			assert.equal(record2.targetStarted, false);
			assert.match(record2.failure ?? "", /npm/);
			assert.equal(fs.existsSync(marker), false);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not start the command for a signal that arrives during the npm probe", async () => {
		const root = scratch("cli-signal-during-probe");
		try {
			const bin = path.join(root, "bin");
			fs.mkdirSync(bin);
			const ready = path.join(root, "npm-ready.txt");
			// Stand-in npm: announce itself, sleep long enough for SIGTERM to
			// land inside spawnSync, then answer correctly.
			fs.writeFileSync(
				path.join(bin, "npm"),
				`#!/bin/sh\n: > '${ready}'\n/bin/sleep 0.8\ncase "$3" in userconfig) printf '%s\\n' "$NPM_CONFIG_USERCONFIG" ;; globalconfig) printf '%s\\n' "$NPM_CONFIG_GLOBALCONFIG" ;; *) exit 9 ;; esac\n`,
				{ mode: 0o700 },
			);
			const marker = path.join(root, "target-ran.txt");
			const fake = fakeCommand(root, "must-not-run.sh", `printf 'ran' > "$1"`);
			const output = path.join(root, "evidence");
			const runner = spawn(process.execPath, [CLI, "--mode", "suite", "--output", output, "--", fake, marker], {
				cwd: process.cwd(),
				env: cliEnv({ PATH: bin }),
				stdio: ["ignore", "pipe", "pipe"],
			});
			const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
				runner.once("close", (code, signal) => resolve({ code, signal }));
			});
			await waitFor(() => fs.existsSync(ready));
			runner.kill("SIGTERM");
			await closed;

			const record = readRecord(output);
			assert.equal(record.success, false);
			assert.equal(record.failureCategory, "interrupted");
			assert.equal(record.targetStarted, false, "the command must not start when SIGTERM lands during the probe");
			assert.equal(fs.existsSync(marker), false, "the command must not have run during the probe");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("records an empty command as spawn, not a preflight rejection", () => {
		const root = scratch("cli-empty-command");
		try {
			const output = path.join(root, "evidence");
			const result = runCli({ args: ["--mode", "suite", "--output", output, "--", ""] });
			assert.equal(result.code, 1, result.stderr);
			const record = readRecord(output);
			assert.equal(record.failureCategory, "spawn");
			assert.equal(record.targetStarted, false);
			assert.equal(record.stage, "command");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("records a command that could not start as spawn, not a command failure", () => {
		const root = scratch("cli-spawn");
		try {
			const output = path.join(root, "evidence");
			const missing = path.join(root, "missing-command");
			const result = runCli({ args: ["--mode", "suite", "--output", output, "--", missing] });
			assert.equal(result.code, 1, result.stderr);
			const record = readRecord(output);
			assert.equal(record.success, false);
			assert.equal(record.failureCategory, "spawn");
			assert.equal(record.targetStarted, false);
			assert.equal(record.childExitCode, null);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

async function waitFor(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) assert.fail("timed out waiting for the command to start");
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

describe("acceptance-check.mjs: output, deadline, and signals", () => {
	function expectGone(pid: number): void {
		assert.throws(() => process.kill(pid, 0), /ESRCH/, `process ${pid} must not survive the run`);
	}

	it("refuses an existing output directory and writes nothing into it", () => {
		const root = scratch("cli-existing");
		try {
			const output = path.join(root, "evidence");
			fs.mkdirSync(output);
			const keep = path.join(output, "keep.txt");
			fs.writeFileSync(keep, "keep");
			const fake = fakeCommand(root, "success.sh", `printf 'ran\\n'`);
			const result = runCli({ args: ["--mode", "suite", "--output", output, "--", fake] });
			assert.equal(result.code, 1);
			assert.match(result.stderr, /exists|reuse/i);
			assert.equal(fs.readFileSync(keep, "utf8"), "keep");
			assert.deepEqual(fs.readdirSync(output), ["keep.txt"]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects invalid arguments before creating any evidence", () => {
		const root = scratch("cli-usage");
		try {
			const output = path.join(root, "evidence");
			const noCommand = runCli({ args: ["--mode", "suite", "--output", output] });
			assert.equal(noCommand.code, 1);
			assert.match(noCommand.stderr, /usage|command/i);
			assert.equal(fs.existsSync(output), false);

			const badMode = runCli({ args: ["--mode", "regression", "--output", output, "--", "/bin/true"] });
			assert.equal(badMode.code, 1);
			assert.match(badMode.stderr, /mode/);
			assert.equal(fs.existsSync(output), false);

			const badTimeout = runCli({ args: ["--mode", "suite", "--timeout-ms", "soon", "--output", output, "--", "/bin/true"] });
			assert.equal(badTimeout.code, 1);
			assert.match(badTimeout.stderr, /timeout/i);
			assert.equal(fs.existsSync(output), false);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("stops the command at the deadline and reaps its process group", () => {
		const root = scratch("cli-timeout");
		try {
			const pidFile = path.join(root, "child.pid");
			const fake = fakeCommand(root, "hang.sh", `printf '%s' "$$" > "$1"\nwhile true; do sleep 1; done`);
			const output = path.join(root, "evidence");
			const result = runCli({
				args: ["--mode", "suite", "--timeout-ms", "400", "--output", output, "--", fake, pidFile],
				timeoutMs: 60_000,
			});
			assert.equal(result.code, 1, result.stderr);
			const record = readRecord(output);
			assert.equal(record.timedOut, true);
			assert.equal(record.failureCategory, "timeout");
			assert.equal(record.stage, "command");
			assert.equal(record.targetStarted, true);
			assert.match(record.failure ?? "", /deadline/);

			const pid = Number(fs.readFileSync(pidFile, "utf8"));
			sleep(300);
			expectGone(pid);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("records an interrupt and reaps the command when the runner gets SIGTERM", async () => {
		const root = scratch("cli-signal");
		try {
			const pidFile = path.join(root, "child.pid");
			const fake = fakeCommand(root, "hang.sh", `printf '%s' "$$" > "$1"\nwhile true; do sleep 1; done`);
			const output = path.join(root, "evidence");
			const runner = spawn(process.execPath, [CLI, "--mode", "suite", "--output", output, "--", fake, pidFile], {
				cwd: process.cwd(),
				env: cliEnv(),
				stdio: ["ignore", "pipe", "pipe"],
			});
			const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
				runner.once("close", (code, signal) => resolve({ code, signal }));
			});
			await waitFor(() => fs.existsSync(pidFile));
			runner.kill("SIGTERM");
			const outcome = await closed;
			assert.equal(outcome.code, 1);

			const record = readRecord(output);
			assert.equal(record.failureCategory, "interrupted");
			assert.equal(record.success, false);
			assert.equal(record.targetStarted, true);

			const pid = Number(fs.readFileSync(pidFile, "utf8"));
			sleep(300);
			expectGone(pid);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
