import { createOpenAI } from "@ai-sdk/openai";
import {
  createOpenRouter,
  type LanguageModelV3,
} from "@openrouter/ai-sdk-provider";
import {
  getOptionalEnvValue,
  getRequiredEnvValue,
} from "@/server/lib/runtime-env";

// OpenRouter model slug used for the in-app chat agents (onboarding + SAM).
// Override with OPENROUTER_MODEL to swap models without a code change.
const DEFAULT_CHAT_AGENT_MODEL = "minimax/minimax-m3";
// Default model when routing to an OpenAI-compatible endpoint (Meta Muse).
const DEFAULT_OPENAI_COMPAT_MODEL = "muse-spark-1.1";

/**
 * Returns the AI SDK LanguageModel for the chat agents.
 *
 * Two providers, selected by LLM_BASE_URL:
 *  - unset  → OpenRouter (default). `usage: { include: true }` turns on
 *    OpenRouter usage accounting so each response carries its real USD cost
 *    (providerMetadata.openrouter.usage.cost), metered against the usage-credit
 *    pool; `provider.order` prefers Together then Atlas Cloud (fp8); `zdr: true`
 *    restricts routing to Zero-Data-Retention endpoints; `reasoning` splits the
 *    model's chain-of-thought into a separate stream instead of leaking inline.
 *  - set    → any OpenAI-compatible endpoint (e.g. Meta Muse at
 *    https://api.meta.ai/v1, model muse-spark-1.1). The OpenRouter-only options
 *    above don't apply; usage-cost metering is already inert unless Autumn
 *    billing is configured (see isBillingEnabled), so nothing is lost here.
 */
export async function getChatAgentModel(): Promise<LanguageModelV3> {
  const apiKey = await getRequiredEnvValue("OPENROUTER_API_KEY");
  const modelId = await getOptionalEnvValue("OPENROUTER_MODEL");
  const baseUrl = await getOptionalEnvValue("LLM_BASE_URL");
  return buildChatAgentModel(apiKey, modelId, baseUrl);
}

/**
 * Synchronous variant for callers that already hold the env values. Think's
 * `getModel()` hook is sync and runs on every turn, so the SAM agent reads the
 * key/model/base-url from its DO env and builds the model here.
 */
export function buildChatAgentModel(
  apiKey: string,
  modelId?: string,
  baseUrl?: string,
): LanguageModelV3 {
  if (baseUrl) {
    return createOpenAI({ apiKey, baseURL: baseUrl })(
      modelId ?? DEFAULT_OPENAI_COMPAT_MODEL,
    ) as LanguageModelV3;
  }
  return createOpenRouter({ apiKey })(modelId ?? DEFAULT_CHAT_AGENT_MODEL, {
    usage: { include: true },
    reasoning: { effort: "medium" },
    provider: {
      order: ["together", "atlas-cloud/fp8"],
      zdr: true,
      allow_fallbacks: true,
    },
  });
}
