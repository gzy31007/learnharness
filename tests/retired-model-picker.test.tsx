import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { ModelControl } from "../components/model-picker.tsx";
import { notifySettingsSaved } from "../components/settings-signal.ts";
import type { ModelCatalogEntry, ModelCatalogResponse } from "../src/core/index.ts";

// The retired-Codex pin (issue #36): a session whose stored model still names
// the retired `openai-codex` provider keeps its history, but the composer's
// model control must SAY so — the learner has to pick a model again. The
// control stays the place to do it (the model button still opens the catalog),
// while the thinking ladder is inert because the retired pin has no entry.
// The server owns the hard refusal (503 code:model_reselection_required); this
// test covers only the observable UI affordance.
//
// As in setup-dialog-interaction: mount real React handlers against an
// isolated DOM with fetch wholly stubbed — no settings or session write can
// escape the fixture.
const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	HTMLInputElement: dom.window.HTMLInputElement,
	HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
});
Object.assign(dom.window, { innerWidth: 1280, innerHeight: 800 });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const originalFetch = globalThis.fetch;
const CHAT_ID = "legacy-codex-session";
const RETIRED = { provider: "openai-codex", id: "gpt-5.1-codex" };
const FRESH: ModelCatalogEntry = {
	id: "gpt-5.2",
	name: "GPT-5.2",
	provider: "chatgpt",
	reasoning: true,
	input: ["text"],
	supportedLevels: ["off", "low", "high"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 256_000,
	maxTokens: 32_000,
};

/** The freshest catalog: the retired provider is NOT in it (it left with the
 *  old Codex engine), so the stored pin has no entry to resolve. */
const catalog = {
	models: [FRESH],
	providers: [{ id: "chatgpt", envVar: "", keyPresent: true }],
	slots: { strong: { model: { provider: "chatgpt", id: "gpt-5.2" } }, cheap: null, vision: null },
	defaults: {},
} as unknown as ModelCatalogResponse;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const writes: { url: string; method: string; body: unknown }[] = [];

function stubFetch() {
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		if (method !== "GET") {
			writes.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
			return Response.json({ settings: { model: { provider: "chatgpt", id: "gpt-5.2" }, thinkingLevel: "high" } });
		}
		if (url === "/api/models") return Response.json(catalog);
		if (url === "/api/settings") {
			return Response.json({ settings: { models: { strong: { model: RETIRED, thinkingLevel: "high" }, cheap: null, vision: null } } });
		}
		if (url === `/api/chats/${CHAT_ID}`) {
			return Response.json({ settings: { model: RETIRED, thinkingLevel: "high" } });
		}
		throw new Error(`unexpected fetch: ${method} ${url}`);
	};
}

async function flush() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

async function mount(children: React.ReactNode) {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root!.render(children));
	await flush();
}

async function click(element: Element | null) {
	assert.ok(element, "expected an element to click");
	await act(async () => {
		element!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
	});
	await flush();
}

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = null;
	host = null;
	globalThis.fetch = originalFetch;
	writes.length = 0;
	// The catalog cache is module-level: invalidate so the next test reads the
	// fixture instead of the previous test's copy.
	await act(async () => notifySettingsSaved("keys"));
});

test("a retired Codex pin announces the re-selection and keeps the model button usable", async () => {
	stubFetch();
	await mount(<ModelControl chatId={CHAT_ID} />);

	// 1. The pin itself is still readable — history is not rewritten.
	const modelButton = document.querySelector('[data-testid="stats-model"]');
	assert.ok(modelButton, "the model button renders");
	assert.equal(modelButton!.hasAttribute("disabled"), false, "the model button stays enabled");
	assert.match(modelButton!.textContent ?? "", /gpt-5\.1-codex/, "the stored id still shows");

	// 2. Observable notice: the learner is told this session's model is gone.
	const notice = document.querySelector('[data-testid="model-retired-notice"]');
	assert.ok(notice, "the retired pin renders a visible re-selection notice");
	const noticeText = notice!.textContent ?? "";
	assert.match(noticeText, /re-?select a model/i, `notice names the action: ${noticeText}`);
	assert.match(noticeText, /retired/i, `notice names the cause: ${noticeText}`);
	// The full guidance (connect a subscription in the desktop app, history is
	// untouched) rides the accessible title instead of a wall of text.
	assert.match(notice!.getAttribute("title") ?? "", /history has not changed/i);

	// 3. Thinking is inert: the retired pin has no catalog entry, so no ladder.
	const thinking = document.querySelector('[data-testid="stats-thinking"]');
	assert.ok(thinking, "the thinking button renders");
	assert.equal(thinking!.hasAttribute("disabled"), true, "thinking is disabled under a retired pin");
	assert.match(thinking!.getAttribute("title") ?? "", /re-?select a model/i, "the disabled ladder explains itself");

	// 4. Re-selection works from here: the menu opens and lists the live catalog.
	await click(modelButton);
	const menu = document.querySelector('[data-testid="model-menu"]');
	assert.ok(menu, "the model menu opens on the retired pin");
	const option = document.querySelector('[data-testid="model-option-gpt-5_2"]');
	assert.ok(option, "the live catalog offers its models");

	await click(option);
	const write = writes.find((entry) => entry.method === "PUT");
	assert.ok(write, "picking a model writes the session record");
	assert.equal(write!.url, `/api/chats/${CHAT_ID}/settings`);
	assert.deepEqual(write!.body, { model: { provider: "chatgpt", id: "gpt-5.2" }, thinkingLevel: "high" }, "the pick never rewrites the retired pin into chatgpt silently — it is an explicit choice");

	// 5. A live pin is not flagged: the notice disappears with the new record.
	await flush();
	assert.equal(document.querySelector('[data-testid="model-retired-notice"]'), null, "no notice once a live model is stored");
});
