"use strict";
// Exercise the real Linux source shell, production server, preload and local notices.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.LH_ACCEPTANCE_OUTPUT;
const source = process.env.LH_ACCEPTANCE_SOURCE;
const resultFile = process.env.LH_ACCEPTANCE_RESULT;
if (!root || !source || !resultFile || !process.env.LH_ACCEPTANCE_RUN_ID) throw new Error("Start through desktop-acceptance.mjs");
Object.defineProperty(process, "resourcesPath", { value: path.join(root, "resources") });
for (const name of ["userData", "sessionData", "crashDumps"]) app.setPath(name, path.join(root, "home", name));
app.setAppLogsPath(path.join(root, "home", "logs"));
const evidence = { runId: process.env.LH_ACCEPTANCE_RUN_ID, completed: false, success: false, timeout: false, runtime: { versions: process.versions, platform: process.platform, arch: process.arch, isPackaged: app.isPackaged }, assertions: [], observations: { preloadScripts: [], contexts: [] } };
const save = () => fs.writeFileSync(resultFile, JSON.stringify(evidence, null, 2));
function check(name, actual) { evidence.assertions.push({ name, pass: actual === true, actual, expected: true }); save(); }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(wc, expression) {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) { if (await wc.executeJavaScript(expression)) return; await delay(100); }
	throw new Error(`DOM wait timed out: ${expression}`);
}
async function shot(win, name) {
	// DOM existence can precede painted modal frames. Wait for finite entrance animations.
	await win.webContents.executeJavaScript(`(async()=>{
		const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
		await frame(); await frame();
		await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));
		await frame(); await frame();
	})()`);
	fs.writeFileSync(path.join(root, name), (await win.webContents.capturePage()).toPNG());
}
function finish(error) {
	clearTimeout(deadline);
	if (error) evidence.error = error.stack || String(error);
	save();
	app.quit();
}
const deadline = setTimeout(() => { evidence.timeout = true; finish(new Error("Desktop probe deadline exceeded")); }, 100_000);
deadline.unref();
app.once("will-quit", () => { save(); app.exit(evidence.success && !evidence.timeout && !evidence.error ? 0 : 1); });
save();

async function inspect(win) {
	const wc = win.webContents;
	await waitFor(wc, `document.querySelector('[data-testid="settings-entry"]') !== null`);
	evidence.observations.url = wc.getURL();
	const prefs = wc.getLastWebPreferences();
	// Only actual execution events prove the preload loaded in an isolated world.
	const preload = evidence.observations.preloadScripts.some((script) => {
		let loaded = script.url;
		if (loaded.startsWith("file://")) loaded = fileURLToPath(loaded);
		return loaded === path.join(source, "electron", "preload.cjs") && evidence.observations.contexts.some((context) => context.id === script.executionContextId && context.auxData?.isDefault === false);
	});
	check("production loopback home", /^http:\/\/127\.0\.0\.1:\d+\/$/.test(wc.getURL()));
	check("real preload in isolated context via CDP", preload);
	check("context isolation", prefs.contextIsolation === true);
	check("node integration disabled", prefs.nodeIntegration === false);
	await shot(win, "01-home.png");
	const statuses = await wc.executeJavaScript(`(async()=>({platform:window.lh?.platform,chatgpt:await window.lh.chatgpt.status(),subscriptions:await window.lh.subscriptions.status()}))()`);
	evidence.observations.initialStatus = statuses;
	check("desktop platform", statuses.platform === process.platform);
	check("ChatGPT available and empty", statuses.chatgpt.available === true && statuses.chatgpt.pending === false && statuses.chatgpt.activeId === null && statuses.chatgpt.accounts.length === 0);
	check("native provider IDs", JSON.stringify(statuses.subscriptions.map((s) => s.providerId).sort()) === JSON.stringify(["github-copilot", "xai"]));
	check("native providers available and disconnected", statuses.subscriptions.every((s) => s.available && !s.connected && !s.pending && s.connectionId === null));
	check("status has no token credential or API-key fields", !/access.?token|refresh.?token|id.?token|api.?key|credential|client.?secret/i.test(JSON.stringify(statuses)));
	await wc.executeJavaScript(`document.querySelector('[data-testid="settings-entry"]').click()`);
	await waitFor(wc, `document.querySelector('[data-testid="settings-dialog"]') && document.querySelector('[data-testid="github-copilot-connection"]')`);
	await waitFor(wc, `[...document.querySelectorAll('[data-testid="subscription-connections"] button')].filter(b=>b.innerText==='Connect' && !b.disabled).length>=3`);
	evidence.observations.settings = await wc.executeJavaScript(`document.querySelector('[data-testid="settings-dialog"]').innerText`);
	check("three subscription connection rows", await wc.executeJavaScript(`["chatgpt","github-copilot","xai"].every(id=>document.querySelector('[data-testid="'+id+'-connection"]'))`));
	check("no retired web OAuth entry in rendered settings", !/WebOAuth|web.oauth|\/api\/subscription|\/subscription\/attempts/i.test(evidence.observations.settings));
	await waitFor(wc, `!!document.querySelector('[data-testid="group-provider-keys"]')`);
	await shot(win, "02-settings.png");
	// Open privacy notices only. Never press a sign-in/proceed control or use real accounts.
	await wc.executeJavaScript(`document.querySelector('[data-testid="chatgpt-login"]').click()`);
	await waitFor(wc, `!!document.querySelector('[data-testid="chatgpt-privacy-notice"]')`);
	await shot(win, "03-chatgpt-notice.png");
	await wc.executeJavaScript(`[...document.querySelectorAll('[data-testid="chatgpt-account-dialog"] button')].find(b=>b.innerText==='Cancel').click()`);
	await waitFor(wc, `!document.querySelector('[data-testid="chatgpt-account-dialog"]')`);
	check("ChatGPT notice cancels without login", true);
	for (const [id, label, filename] of [["github-copilot", "GitHub Copilot", "04-copilot-notice.png"], ["xai", "Grok", "05-grok-notice.png"]]) {
		await wc.executeJavaScript(`document.querySelector('[data-testid="${id}-connection"] button').click()`);
		await waitFor(wc, `!!document.querySelector('[data-testid="subscription-privacy-notice"]')`);
		const text = await wc.executeJavaScript(`document.querySelector('[data-testid="subscription-connection-dialog"]').innerText`);
		check(label + " notice label", text.includes(label));
		await shot(win, filename);
		await wc.executeJavaScript(`[...document.querySelectorAll('[data-testid="subscription-connection-dialog"] button')].find(b=>b.innerText==='Cancel').click()`);
		await waitFor(wc, `!document.querySelector('[data-testid="subscription-connection-dialog"]')`);
	}
	const controls = await wc.executeJavaScript(`(async()=>{await window.lh.chatgpt.cancel();await window.lh.chatgpt.disconnect('nonexistent-isolated-account');for(const id of ['github-copilot','xai']){await window.lh.subscriptions.cancel(id);await window.lh.subscriptions.disconnect(id);}return {chatgpt:await window.lh.chatgpt.status(),subscriptions:await window.lh.subscriptions.status()};})()`);
	check("empty-account controls leave ChatGPT disconnected", controls.chatgpt.accounts.length === 0 && !controls.chatgpt.pending);
	check("empty-account native controls remain available disconnected", controls.subscriptions.every((s) => s.available && !s.connected && !s.pending));
	const api = await wc.executeJavaScript(`(async()=>{const out={};for(const u of ['/api/models','/api/subscription','/api/subscription/attempts'])out[u]=(await fetch(u)).status;return out;})()`);
	check("desktop model API accessible", api["/api/models"] === 200);
	check("retired subscription API absent", api["/api/subscription"] === 404);
	check("retired subscription attempt API absent", api["/api/subscription/attempts"] === 404);
	const web = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
	try {
		await web.loadURL(wc.getURL());
		const untrusted = await web.webContents.executeJavaScript(`(async()=>({hasLH:typeof window.lh!=='undefined',models:(await fetch('/api/models')).status,keys:(await fetch('/api/keys')).status}))()`);
		check("untrusted Web renderer has no desktop preload", untrusted.hasLH === false);
		check("untrusted Web renderer denied private model API", untrusted.models === 403);
		check("untrusted Web renderer denied private key API", untrusted.keys === 403);
	} finally { web.destroy(); }
	evidence.completed = true;
	evidence.success = evidence.assertions.every((assertion) => assertion.pass);
	save();
}
let claimed = false;
app.on("browser-window-created", (_event, win) => {
	if (claimed) return;
	claimed = true;
	try {
		win.webContents.debugger.attach("1.3");
		win.webContents.debugger.on("message", (_e, method, params) => {
			if (method === "Debugger.scriptParsed" && params.url?.includes("preload.cjs")) evidence.observations.preloadScripts.push({ url: params.url, executionContextId: params.executionContextId, hash: params.hash });
			if (method === "Runtime.executionContextCreated") evidence.observations.contexts.push(params.context);
			save();
		});
		const ready = Promise.all([win.webContents.debugger.sendCommand("Debugger.enable"), win.webContents.debugger.sendCommand("Runtime.enable")]);
		ready.catch((error) => { evidence.debuggerError = String(error); finish(error); });
		win.webContents.on("preload-error", (_e, preloadPath, error) => { evidence.preloadError = { path: preloadPath, error: String(error) }; finish(error); });
		win.webContents.once("did-finish-load", () => ready.then(() => inspect(win)).then(() => finish(), finish));
	} catch (error) { finish(error); }
});
require(path.join(source, "electron", "main.cjs"));
