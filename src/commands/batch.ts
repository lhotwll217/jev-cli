import { call } from "../client.ts";
import { CliError, EXIT, costUsd, loadConfig } from "../config.ts";
import { parseJson, readJsonFile, readStdin } from "../io.ts";
import { loadSchema } from "../library.ts";
import { validateRequest, warn } from "./run.ts";
import type { Args } from "../args.ts";
import { readFile } from "node:fs/promises";

interface Row {
  id: string;
  state: unknown;
}

/** Each JSONL line is a bare state (string/object) or `{id, state}`. */
function parseRows(text: string): Row[] {
  const rows: Row[] = [];
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const value = parseJson(trimmed, `line ${index + 1}`);
    if (value && typeof value === "object" && !Array.isArray(value) && "state" in value) {
      const record = value as { id?: unknown; state: unknown };
      rows.push({ id: String(record.id ?? index), state: record.state });
    } else {
      rows.push({ id: String(index), state: value });
    }
  });
  return rows;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? null;
}

export async function batchCommand(args: Args): Promise<number> {
  const cfg = loadConfig({
    apiKey: args.string("api-key"),
    model: args.string("model"),
    baseUrl: args.string("base-url"),
  });

  const schemaOpt = args.string("schema");
  const questionsOpt = args.string("questions");
  if (!schemaOpt && !questionsOpt) {
    throw new CliError("batch needs --schema <name> or --questions <file|json>.");
  }
  const questions = schemaOpt
    ? await loadSchema(schemaOpt)
    : questionsOpt!.trim().startsWith("{")
      ? parseJson(questionsOpt!, "--questions")
      : await readJsonFile(questionsOpt!);

  warn(questions, args);

  const inputPath = args.string("input");
  const text = inputPath ? await readFile(inputPath, "utf8") : await readStdin();
  if (!text.trim()) throw new CliError("No input. Pass --input <file.jsonl> or pipe JSONL on stdin.");

  const rows = parseRows(text);
  if (rows.length === 0) throw new CliError("Input contained no rows.", EXIT.INPUT);

  const concurrency = Math.max(1, Number(args.string("concurrency") ?? 4));
  const latencies: number[] = [];
  let failures = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const startedAll = performance.now();

  // Fixed-size worker pool: keeps `concurrency` requests in flight and streams
  // each result as soon as it lands, so long batches stay pipeable.
  let cursor = 0;
  const results = new Array<string>(rows.length);
  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const index = cursor++;
      const row = rows[index]!;
      try {
        const body = validateRequest(row.state, questions, cfg.model);
        const result = await call(body, cfg);
        latencies.push(result.latencyMs);
        inputTokens += result.response.usage?.input_tokens ?? 0;
        outputTokens += result.response.usage?.output_tokens ?? 0;
        results[index] = JSON.stringify({
          id: row.id,
          answers: result.response.answers,
          meta: {
            latency_ms: result.latencyMs,
            attempts: result.attempts,
            usage: result.response.usage ?? null,
            cost_usd: costUsd(result.response.usage, cfg.pricing) ?? null,
          },
        });
      } catch (err) {
        failures++;
        const message = err instanceof Error ? err.message : String(err);
        results[index] = JSON.stringify({ id: row.id, error: message });
        if (args.flag("fail-fast")) {
          cursor = rows.length;
          throw new CliError(`Row ${row.id} failed: ${message}`, EXIT.API);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  for (const line of results) if (line) process.stdout.write(line + "\n");

  if (!args.flag("no-summary")) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const usage = { input_tokens: inputTokens, output_tokens: outputTokens };
    const summary = {
      rows: rows.length,
      ok: rows.length - failures,
      failed: failures,
      concurrency,
      wall_ms: Math.round(performance.now() - startedAll),
      latency_ms: { p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted.at(-1) ?? null },
      usage,
      cost_usd: costUsd(usage, cfg.pricing) ?? null,
    };
    // Summary goes to stderr so stdout stays clean JSONL for jq.
    process.stderr.write(JSON.stringify(summary) + "\n");
  }

  return failures > 0 ? EXIT.PARTIAL : EXIT.OK;
}
