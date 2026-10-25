import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-retired-subscription-"));
process.env.LH_DATA_DIR = path.join(dir, "data");
process.env.LH_AUTH_FILE = path.join(dir, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async () => { requests++; throw new Error("Migration tests must not contact a provider"); };
after(() => { globalThis.fetch = originalFetch; });
const { stores } = await import("../src/server/stores.ts");
const { handleChatRequest } = await import("../src/server/chat-handler.ts");
const { recoverStaleJobs, setJobRespawn } = await import("../src/server/jobs.ts");
const { piEngineForSpec } = await import("../src/agent/models.ts");

test("a retired Codex session refuses before dispatch or persistence and asks for a fresh model choice", async () => {
	const chat = stores.chatStore.createChat("Historical Codex session");
	stores.chatStore.saveSettings(chat.id, { model: { provider: "openai-codex", id: "gpt-5.1-codex" } });
	const file = path.join(process.env.LH_DATA_DIR!, "chats", `${chat.id}.json`);
	const before = fs.readFileSync(file, "utf8");
	const response = await handleChatRequest(new Request("http://fixture/api/chat", {
		method: "POST", body: JSON.stringify({ chatId: chat.id, input: { type: "text", text: "Keep my existing notes" } }),
	}));
	assert.equal(response.status, 503);
	const refusal = await response.json();
	assert.equal(refusal.code, "model_reselection_required");
	assert.equal(refusal.provider, "openai-codex");
	assert.match(refusal.error, /select.*model/i);
	assert.equal(requests, 0);
	assert.equal(fs.readFileSync(file, "utf8"), before, "refusal preserves the historical record byte for byte");
});

test("background model resolution cannot reuse the retired SDK provider", () => {
	assert.throws(() => piEngineForSpec({ provider: "openai-codex", id: "gpt-5.1-codex" }), /select.*model/i);
	assert.equal(requests, 0);
});

test("restarting does not dispatch a queued job authorized by the retired subscription", () => {
	const chat = stores.chatStore.createChat("Historical queued work");
	stores.chatStore.saveSettings(chat.id, { model: { provider: "openrouter", id: "deepseek/deepseek-chat" } });
	const job = stores.jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "retired-job" });
	const jobFile = path.join(process.env.LH_DATA_DIR!, "jobs", `${job.id}.json`);
	fs.writeFileSync(jobFile, JSON.stringify({ ...job, subscriptionGeneration: "old-authority" }));
	const completed = stores.jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "retired-result" });
	const result = { text: "Historical research result" };
	fs.writeFileSync(path.join(process.env.LH_DATA_DIR!, "jobs", `${completed.id}.json`), JSON.stringify({ ...completed, result, subscriptionGeneration: "old-authority" }));
	const legacyChat = stores.chatStore.createChat("Unstamped legacy work");
	stores.chatStore.saveSettings(legacyChat.id, { model: { provider: "openai-codex", id: "gpt-6-luna" } });
	const unstamped = stores.jobStore.createJob({ kind: "research", chatId: legacyChat.id, toolCallId: "old-pin-job" });
	let respawns = 0;
	setJobRespawn(() => { respawns++; });
	recoverStaleJobs();
	assert.equal(respawns, 0, "a changed current model does not authorize old queued work");
	assert.equal(stores.jobStore.getJob(job.id)?.status, "error");
	assert.match(stores.jobStore.getJob(job.id)?.error ?? "", /select.*model/i);
	assert.equal(stores.jobStore.getJob(completed.id)?.status, "error");
	assert.deepEqual(stores.jobStore.getJob(completed.id)?.result, result, "old results stay readable but are not delivered");
	assert.deepEqual(stores.chatStore.getChat(chat.id)?.messages, []);
	assert.equal(stores.jobStore.getJob(unstamped.id)?.status, "error");
	assert.equal(requests, 0);
});
