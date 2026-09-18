import { Response as ResponseSchema, Request as RequestSchema } from "./schema.ts";
import { CliError, EXIT, type Config } from "./config.ts";

export interface CallResult {
  response: ResponseSchema;
  latencyMs: number;
  attempts: number;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000);
  }
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return base + Math.random() * 250; // jitter, so a batch does not retry in lockstep
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Single POST /v1/systemone call with retry on 429/529/5xx and network faults. */
export async function call(body: RequestSchema, cfg: Config): Promise<CallResult> {
  const url = new URL("/v1/systemone", cfg.baseUrl).toString();
  const started = performance.now();
  let lastError = "";

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.ok) {
        const json = await res.json();
        const parsed = ResponseSchema.safeParse(json);
        if (!parsed.success) {
          throw new CliError(
            `Unexpected response shape: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`,
            EXIT.API,
          );
        }
        return {
          response: parsed.data,
          latencyMs: Math.round(performance.now() - started),
          attempts: attempt + 1,
        };
      }

      const text = await res.text().catch(() => "");
      if (res.status === 401) {
        throw new CliError(`401 Unauthorized -- check TYPESAFE_API_KEY. ${text}`.trim(), EXIT.AUTH);
      }
      if (res.status === 422) {
        throw new CliError(`422 Unprocessable Entity -- server rejected the request. ${text}`.trim(), EXIT.INPUT);
      }
      if (!RETRYABLE.has(res.status) || attempt === cfg.maxRetries) {
        throw new CliError(`${res.status} ${res.statusText}. ${text}`.trim(), EXIT.API);
      }
      lastError = `${res.status} ${res.statusText}`;
      await sleep(backoffMs(attempt, res.headers.get("retry-after")));
    } catch (err) {
      if (err instanceof CliError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === cfg.maxRetries) {
        throw new CliError(`Request failed after ${attempt + 1} attempts: ${message}`, EXIT.API);
      }
      lastError = message;
      await sleep(backoffMs(attempt, null));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new CliError(`Request failed: ${lastError}`, EXIT.API);
}
