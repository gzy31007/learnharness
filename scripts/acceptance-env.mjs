/**
 * acceptance-env.mjs — build and verify the isolated environment an
 * acceptance command is allowed to see (issue #41).
 *
 * An acceptance run must not inherit the machine's credentials, proxies, or
 * Node injection variables, and every mutable path (HOME, data, auth, npm
 * cache/config) must be a profile this invocation owns. `createAcceptanceEnv`
 * builds that profile and the matching environment; `preflightAcceptanceEnv`
 * re-checks an environment before a command is started, so a hand-edited or
 * partially inherited env is rejected instead of silently used.
 *
 * The npm config files must be two DIFFERENT empty regular files inside the
 * owned home. The checks never open those files: a path that resolves to a
 * FIFO, a device, or a secret file is rejected by lstat/realpath alone.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** The only inherited variables an acceptance command may see. */
const BASIC_ENV_KEYS = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM"];
const MODES = new Set(["suite", "smoke"]);

/** Paths every acceptance environment must own inside the isolated home. */
const PATH_ENV_KEYS = [
	"HOME",
	"USERPROFILE",
	"APPDATA",
	"LOCALAPPDATA",
	"XDG_CONFIG_HOME",
	"XDG_CACHE_HOME",
	"LH_DATA_DIR",
	"LH_AUTH_FILE",
	"NPM_CONFIG_USERCONFIG",
	"NPM_CONFIG_GLOBALCONFIG",
	"NPM_CONFIG_CACHE",
];

/** Values that keep npm offline and telemetry off. */
const POLICY_ENV_VALUES = {
	NPM_CONFIG_OFFLINE: "true",
	NPM_CONFIG_AUDIT: "false",
	NPM_CONFIG_FUND: "false",
	NPM_CONFIG_UPDATE_NOTIFIER: "false",
	NEXT_TELEMETRY_DISABLED: "1",
	DO_NOT_TRACK: "1",
};

/**
 * The complete set of variables an acceptance environment may carry. Anything
 * else (a credential, a proxy, a Node injection switch, a tool-specific knob)
 * means the environment was not built by createAcceptanceEnv.
 */
const ALLOWED_ENV_KEYS = new Set([
	...BASIC_ENV_KEYS,
	...PATH_ENV_KEYS,
	...Object.keys(POLICY_ENV_VALUES),
	"NODE_ENV",
	"LH_IGNORE_ENV_KEYS",
]);

export class AcceptanceEnvError extends Error {
	/**
	 * @param {string} code stable failure category, e.g. "mode-invalid"
	 * @param {string} message human-readable reason (never a secret value)
	 */
	constructor(code, message) {
		super(message);
		this.name = "AcceptanceEnvError";
		this.code = code;
	}
}

function assertMode(mode) {
	if (!MODES.has(mode)) {
		throw new AcceptanceEnvError("mode-invalid", `mode must be "suite" or "smoke", received ${JSON.stringify(mode)}`);
	}
}

function requireAbsoluteHome(home) {
	if (typeof home !== "string" || !path.isAbsolute(home)) {
		throw new AcceptanceEnvError("home-invalid", "home must be an absolute path");
	}
	return path.resolve(home);
}

function basicEnvironment(inheritedEnv) {
	const env = {};
	for (const key of BASIC_ENV_KEYS) {
		const value = inheritedEnv[key];
		if (typeof value === "string" && value !== "") env[key] = value;
	}
	return env;
}

/**
 * Create the owned profile under `home` and the environment that points at it.
 *
 * @param {{ mode: "suite" | "smoke", home: string, inheritedEnv?: Record<string, string | undefined> }} options
 */
export function createAcceptanceEnv({ mode, home, inheritedEnv = {} } = {}) {
	assertMode(mode);
	const homeDir = requireAbsoluteHome(home);

	// A profile is created once; an existing auth file or npm config is never
	// overwritten (evidence directories are immutable once written).
	fs.mkdirSync(homeDir, { mode: 0o700 });
	fs.chmodSync(homeDir, 0o700);
	const dirs = {
		data: path.join(homeDir, "data"),
		appdata: path.join(homeDir, "appdata"),
		localappdata: path.join(homeDir, "localappdata"),
		xdgConfig: path.join(homeDir, "xdg-config"),
		xdgCache: path.join(homeDir, "xdg-cache"),
	};
	for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { mode: 0o700 });

	const authFile = path.join(homeDir, "auth.json");
	fs.writeFileSync(authFile, "{}\n", { mode: 0o600, flag: "wx" });

	// npm must not read the machine's config or reach the network. The two
	// config files are distinct empty regular files inside the owned home.
	const npmDir = path.join(homeDir, "npm");
	fs.mkdirSync(npmDir, { mode: 0o700 });
	const userConfig = path.join(npmDir, "user.npmrc");
	const globalConfig = path.join(npmDir, "global.npmrc");
	fs.writeFileSync(userConfig, "", { mode: 0o600, flag: "wx" });
	fs.writeFileSync(globalConfig, "", { mode: 0o600, flag: "wx" });
	const npmCache = path.join(homeDir, "npm-cache");
	fs.mkdirSync(npmCache, { mode: 0o700 });

	const env = {
		...basicEnvironment(inheritedEnv),
		HOME: homeDir,
		USERPROFILE: homeDir,
		APPDATA: dirs.appdata,
		LOCALAPPDATA: dirs.localappdata,
		XDG_CONFIG_HOME: dirs.xdgConfig,
		XDG_CACHE_HOME: dirs.xdgCache,
		LH_DATA_DIR: dirs.data,
		LH_AUTH_FILE: authFile,
		NPM_CONFIG_USERCONFIG: userConfig,
		NPM_CONFIG_GLOBALCONFIG: globalConfig,
		NPM_CONFIG_CACHE: npmCache,
		...POLICY_ENV_VALUES,
		// NODE_ENV is part of the mode contract, never inherited: suite runs
		// exactly like `npm test`, smoke runs the packaged shell in production.
		NODE_ENV: mode === "suite" ? "test" : "production",
	};
	// smoke runs the packaged shell with the fresh-user switch ON; the suite
	// must not inherit it from the caller either way.
	if (mode === "smoke") env.LH_IGNORE_ENV_KEYS = "1";

	return {
		mode,
		home: homeDir,
		env: Object.freeze(env),
		authFile,
		npm: { userConfig, globalConfig, cache: npmCache },
	};
}

function inside(base, candidate) {
	const rel = path.relative(path.resolve(base), path.resolve(candidate));
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Read one required path variable; never echoes its value in the error. */
function requirePath(env, key) {
	const value = env[key];
	if (typeof value !== "string" || value === "" || !path.isAbsolute(value)) {
		throw new AcceptanceEnvError("missing-env", `${key} must be set to an absolute path`);
	}
	return path.resolve(value);
}

function lstatOrMissing(resolved, key) {
	try {
		return fs.lstatSync(resolved);
	} catch (error) {
		if (error.code === "ENOENT") throw new AcceptanceEnvError("path-missing", `${key} does not exist: ${resolved}`);
		throw error;
	}
}


function requireOwnedDirectory(homeDir, realHome, resolved, key) {
	if (!inside(homeDir, resolved) && !inside(realHome, resolved)) {
		throw new AcceptanceEnvError("path-outside-home", `${key} is outside the owned home: ${resolved}`);
	}
	const stat = lstatOrMissing(resolved, key);
	if (stat.isSymbolicLink()) throw new AcceptanceEnvError("path-symlink", `${key} must not be a symlink: ${resolved}`);
	if (!stat.isDirectory()) throw new AcceptanceEnvError("path-not-directory", `${key} must be a directory: ${resolved}`);
	const real = fs.realpathSync(resolved);
	if (!inside(realHome, real)) {
		throw new AcceptanceEnvError("path-outside-home", `${key} leaves the owned home: ${resolved}`);
	}
	return real;
}

/** The auth file must be an empty JSON object; its content is never echoed. */
function requireOwnedAuthFile(homeDir, realHome, resolved) {
	const key = "LH_AUTH_FILE";
	if (!inside(homeDir, resolved) && !inside(realHome, resolved)) {
		throw new AcceptanceEnvError("path-outside-home", `${key} is outside the owned home: ${resolved}`);
	}
	const stat = lstatOrMissing(resolved, key);
	if (stat.isSymbolicLink()) throw new AcceptanceEnvError("path-symlink", `${key} must not be a symlink: ${resolved}`);
	if (!stat.isFile()) throw new AcceptanceEnvError("path-not-regular", `${key} must be a regular file: ${resolved}`);
	const real = fs.realpathSync(resolved);
	if (!inside(realHome, real)) {
		throw new AcceptanceEnvError("path-outside-home", `${key} leaves the owned home: ${resolved}`);
	}
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(real, "utf8"));
	} catch {
		throw new AcceptanceEnvError("auth-invalid", `${key} must contain a JSON object`);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new AcceptanceEnvError("auth-invalid", `${key} must contain a JSON object`);
	}
	if (Object.keys(parsed).length !== 0) {
		throw new AcceptanceEnvError("auth-not-empty", `${key} must be an empty JSON object: acceptance runs must not use real credentials`);
	}
	return { real };
}

/**
 * The path must be an empty regular file owned by the home. Metadata is
 * inspected before anything is opened, and the file is never read: a path
 * that turns out to be a FIFO, a device, or somebody else's secret file is
 * rejected on its type alone.
 */
function requireOwnedEmptyFile(homeDir, realHome, resolved, key) {
	if (!inside(homeDir, resolved) && !inside(realHome, resolved)) {
		throw new AcceptanceEnvError("path-outside-home", `${key} is outside the owned home: ${resolved}`);
	}
	const stat = lstatOrMissing(resolved, key);
	if (stat.isSymbolicLink()) throw new AcceptanceEnvError("path-symlink", `${key} must not be a symlink: ${resolved}`);
	if (!stat.isFile()) throw new AcceptanceEnvError("path-not-regular", `${key} must be a regular file: ${resolved}`);
	if (stat.size !== 0) throw new AcceptanceEnvError("path-not-empty", `${key} must be empty: ${resolved}`);
	const real = fs.realpathSync(resolved);
	if (!inside(realHome, real)) {
		throw new AcceptanceEnvError("path-outside-home", `${key} leaves the owned home: ${resolved}`);
	}
	return { real, dev: stat.dev, ino: stat.ino };
}

/**
 * Re-check an environment before an acceptance command is started. Every
 * failure raises AcceptanceEnvError with a stable `code`; messages name the
 * variable or path involved and never echo a value.
 *
 * @param {{ mode: "suite" | "smoke", home: string, env: Record<string, string | undefined> }} options
 */
export function preflightAcceptanceEnv({ mode, home, env = {} } = {}) {
	assertMode(mode);
	const homeDir = requireAbsoluteHome(home);
	let realHome;
	try {
		realHome = fs.realpathSync(homeDir);
	} catch {
		throw new AcceptanceEnvError("home-missing", `home does not exist: ${homeDir}`);
	}
	if (!fs.statSync(realHome).isDirectory()) {
		throw new AcceptanceEnvError("home-invalid", `home is not a directory: ${homeDir}`);
	}

	for (const key of Object.keys(env)) {
		if (!ALLOWED_ENV_KEYS.has(key)) {
			throw new AcceptanceEnvError("env-unexpected-key", `${key} is not allowed in the acceptance environment`);
		}
	}
	// The fresh-user switch is a mode contract, not a caller preference.
	if (mode === "suite" && env.LH_IGNORE_ENV_KEYS !== undefined) {
		throw new AcceptanceEnvError("mode-incompatible", "suite mode must not carry LH_IGNORE_ENV_KEYS");
	}
	if (mode === "smoke" && env.LH_IGNORE_ENV_KEYS !== "1") {
		throw new AcceptanceEnvError("mode-incompatible", "smoke mode requires LH_IGNORE_ENV_KEYS=1");
	}
	const expectedNodeEnv = mode === "suite" ? "test" : "production";
	if (env.NODE_ENV !== expectedNodeEnv) {
		throw new AcceptanceEnvError("env-incompatible", `NODE_ENV must be ${expectedNodeEnv} in ${mode} mode`);
	}
	for (const [key, expected] of Object.entries(POLICY_ENV_VALUES)) {
		if (env[key] !== expected) {
			throw new AcceptanceEnvError("env-incompatible", `${key} must be ${expected} in ${mode} mode`);
		}
	}
	if (typeof env.PATH !== "string" || env.PATH === "") {
		throw new AcceptanceEnvError("missing-env", "PATH must be set so the npm probe and the command can be resolved");
	}
	const envHome = requirePath(env, "HOME");
	if (path.resolve(envHome) !== homeDir) {
		let realEnvHome = null;
		try {
			realEnvHome = fs.realpathSync(envHome);
		} catch {
			realEnvHome = null;
		}
		if (realEnvHome !== realHome) {
			throw new AcceptanceEnvError("home-mismatch", `HOME must name the owned home, received ${envHome}`);
		}
	}

	for (const key of ["USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "LH_DATA_DIR", "NPM_CONFIG_CACHE"]) {
		requireOwnedDirectory(homeDir, realHome, requirePath(env, key), key);
	}
	const authFile = requireOwnedAuthFile(homeDir, realHome, requirePath(env, "LH_AUTH_FILE"));

	const userConfigPath = requirePath(env, "NPM_CONFIG_USERCONFIG");
	const globalConfigPath = requirePath(env, "NPM_CONFIG_GLOBALCONFIG");
	const userConfig = requireOwnedEmptyFile(homeDir, realHome, userConfigPath, "NPM_CONFIG_USERCONFIG");
	const globalConfig = requireOwnedEmptyFile(homeDir, realHome, globalConfigPath, "NPM_CONFIG_GLOBALCONFIG");
	// The same path, or a hardlink of one inode, would let npm read one file
	// where the contract promises two.
	if (userConfig.real === globalConfig.real || (userConfig.dev === globalConfig.dev && userConfig.ino === globalConfig.ino)) {
		throw new AcceptanceEnvError(
			"npm-config-same-file",
			"npm user and global config must be different files inside the owned home",
		);
	}

	return {
		mode,
		home: realHome,
		authFile: authFile.real,
		npm: {
			userConfig: userConfig.real,
			globalConfig: globalConfig.real,
			cache: env.NPM_CONFIG_CACHE,
		},
	};
}

/**
 * Ask the installed npm which files it actually loads as its user and global
 * config, using the isolated environment and the same working directory the
 * command will run in. Read-only: no install, no network, no writes.
 *
 * @param {{ env: Record<string, string>, cwd: string, timeoutMs?: number }} options
 */
export function probeNpmConfigLoading({ env, cwd, timeoutMs = 30_000 } = {}) {
	if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
		throw new AcceptanceEnvError("npm-probe", "cwd must be an absolute path");
	}
	const expected = { userconfig: env.NPM_CONFIG_USERCONFIG, globalconfig: env.NPM_CONFIG_GLOBALCONFIG };
	const loaded = {};
	for (const key of ["userconfig", "globalconfig"]) {
		const result = spawnSync("npm", ["config", "get", key], { cwd, env, encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL" });
		if (result.error) {
			throw new AcceptanceEnvError("npm-probe", `npm config get ${key} could not start: ${result.error.message}`);
		}
		if (result.status !== 0) {
			throw new AcceptanceEnvError("npm-probe", `npm config get ${key} exited with status ${result.status}`);
		}
		const value = result.stdout.trim();
		const wanted = path.resolve(expected[key]);
		if (value !== wanted) {
			throw new AcceptanceEnvError(
				"npm-probe-mismatch",
				`npm loaded ${key} from ${value || "(nothing)"} instead of the owned ${wanted}`,
			);
		}
		loaded[key] = value;
	}
	return { userConfig: loaded.userconfig, globalConfig: loaded.globalconfig };
}
