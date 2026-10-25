/** Historical pins remain readable, but never authorize the replacement desktop connection. */
export function isRetiredModelProvider(provider: string | undefined): boolean {
	return provider === "openai-codex";
}

export const RETIRED_MODEL_MESSAGE = "This session uses the retired Codex connection. Select a model again. To use a subscription, connect it in the desktop app first. Your history has not changed.";

export function retiredModelEnvelope(provider: string) {
	return { code: "model_reselection_required", provider, error: RETIRED_MODEL_MESSAGE };
}
