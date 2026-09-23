export const OpenRouterErrorCode = {
  missing_config: "missing_config",
  invalid_credentials: "invalid_credentials",
  unknown_model: "unknown_model",
  insufficient_credits: "insufficient_credits",
  rate_limited: "rate_limited",
  transient: "transient",
  validation: "validation",
  grounding: "grounding",
} as const;

export type OpenRouterErrorCode =
  (typeof OpenRouterErrorCode)[keyof typeof OpenRouterErrorCode];

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function classifyOpenRouterStatus(httpStatus: number, bodyText: string): {
  code: OpenRouterErrorCode;
  message: string;
} {
  const lower = bodyText.toLowerCase();
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      code: OpenRouterErrorCode.invalid_credentials,
      message:
        "OpenRouter rejected the API key. Check OPENROUTER_API_KEY in your local .env file.",
    };
  }
  if (httpStatus === 404 || lower.includes("not a valid model")) {
    return {
      code: OpenRouterErrorCode.unknown_model,
      message:
        "The configured OPENROUTER_MODEL is unavailable. Choose a supported model identifier in .env.",
    };
  }
  if (httpStatus === 402 || lower.includes("credit") || lower.includes("quota")) {
    return {
      code: OpenRouterErrorCode.insufficient_credits,
      message:
        "OpenRouter reports insufficient credits. Add credits, then retry. No other provider is used.",
    };
  }
  if (httpStatus === 429) {
    return {
      code: OpenRouterErrorCode.rate_limited,
      message: "OpenRouter rate-limited the request. Wait and retry.",
    };
  }
  if (httpStatus >= 500) {
    return {
      code: OpenRouterErrorCode.transient,
      message: "OpenRouter is temporarily unavailable. Your library is unchanged.",
    };
  }
  return {
    code: OpenRouterErrorCode.transient,
    message: "The OpenRouter request failed. Your saved work was kept.",
  };
}
