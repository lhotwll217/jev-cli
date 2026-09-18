import { homedir } from "node:os";
import { join } from "node:path";

export const EXIT = {
  OK: 0,
  USAGE: 1,
  INPUT: 2,
  AUTH: 3,
  API: 4,
  PARTIAL: 5,
} as const;

export class CliError extends Error {
  readonly code: number;
  constructor(message: string, code: number = EXIT.USAGE) {
    super(message);
    this.code = code;
  }
}

/**
 * Per-million-token prices. The API returns token counts only, so cost is
 * reported only when the caller supplies rates -- we never guess a price.
 */
export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface Config {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  pricing?: Pricing;
}

function num(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new CliError(`${name} must be a number, got ${raw}`);
  return parsed;
}

export function schemaDir(): string {
  const override = process.env.JEV_HOME;
  if (override) return join(override, "schemas");
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg ?? join(homedir(), ".config"), "jev", "schemas");
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const apiKey = overrides.apiKey ?? process.env.TYPESAFE_API_KEY ?? "";
  if (!apiKey) {
    throw new CliError(
      "No API key. Set TYPESAFE_API_KEY in the environment (or pass --api-key).",
      EXIT.AUTH,
    );
  }
  const input = num("JEV_PRICE_INPUT_PER_MTOK");
  const output = num("JEV_PRICE_OUTPUT_PER_MTOK");
  const pricing =
    input !== undefined || output !== undefined
      ? { inputPerMTok: input ?? 0, outputPerMTok: output ?? 0 }
      : undefined;

  return {
    apiKey,
    baseUrl: overrides.baseUrl ?? process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai",
    model: overrides.model ?? process.env.JEV_MODEL ?? "jev-latest",
    timeoutMs: overrides.timeoutMs ?? num("JEV_TIMEOUT_MS") ?? 60_000,
    maxRetries: overrides.maxRetries ?? num("JEV_MAX_RETRIES") ?? 3,
    pricing: overrides.pricing ?? pricing,
  };
}

export function costUsd(
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
  pricing: Pricing | undefined,
): number | undefined {
  if (!usage || !pricing) return undefined;
  const cost =
    ((usage.input_tokens ?? 0) / 1_000_000) * pricing.inputPerMTok +
    ((usage.output_tokens ?? 0) / 1_000_000) * pricing.outputPerMTok;
  return Number(cost.toFixed(8));
}
