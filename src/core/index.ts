/** Public surface of the dependency-free core. */
export * from "./types";
export * from "./llm/provider";
export { MockLLMProvider } from "./llm/mock";
export { OpenAIProvider } from "./llm/openai";
export { AnthropicProvider } from "./llm/anthropic";
export { createProvider, providerConfigFromEnv } from "./llm/factory";
export type { ProviderConfig, ProviderKind } from "./llm/factory";
export { buildSystemPrompt, selectRelevantAssets } from "./brand/voice";
export { buildUserPrompt } from "./content/prompt";
export {
  generateVariants,
  parseVariantJson,
  normaliseHashtags,
} from "./content/generator";
export {
  PLATFORM_RULES,
  validateForPlatform,
  clampToPlatform,
} from "./content/platform-rules";
export type { PlatformRule, ValidationResult } from "./content/platform-rules";
export {
  canTransition,
  assertTransition,
  applyReviewAction,
  groupForReview,
  InvalidTransitionError,
} from "./review/queue";
export type { ReviewAction } from "./review/queue";
export {
  planSchedule,
  availableSlots,
  nextReviewWindow,
} from "./schedule/planner";
export type { PlannerOptions } from "./schedule/planner";
export { evaluateVariant } from "./eval/evaluator";
export type {
  EvalInput,
  EvalIssue,
  EvalResult,
  EvalOptions,
  EvalSeverity,
} from "./eval/evaluator";
export {
  textSimilarity,
  maxSimilarity,
  shingles,
  jaccard,
  tokenize,
} from "./eval/similarity";
export type { SimilarityMatch } from "./eval/similarity";
