import { call } from "../client.ts";
import { CliError, EXIT, costUsd, loadConfig, type Config } from "../config.ts";
import { coerceState, emit, parseJson, readJsonFile, readStdin } from "../io.ts";
import { formatIssues, loadSchema } from "../library.ts";
import { Request, Questions } from "../schema.ts";
import type { Args } from "../args.ts";

/**
 * Resolves state + questions from the many accepted input routes:
 * a whole-request JSON on stdin, --state/--questions, or --schema.
 */
export async function resolveInput(args: Args): Promise<{ state: unknown; questions: unknown }> {
  let state: unknown;
  let questions: unknown;

  const stateOpt = args.string("state");
  const questionsOpt = args.string("questions");
  const schemaOpt = args.string("schema");

  if (questionsOpt && schemaOpt) {
    throw new CliError("Use either --questions or --schema, not both.");
  }
  if (questionsOpt) {
    questions = questionsOpt.trim().startsWith("{")
      ? parseJson(questionsOpt, "--questions")
      : await readJsonFile(questionsOpt);
  } else if (schemaOpt) {
    questions = await loadSchema(schemaOpt);
  }

  if (stateOpt !== undefined) {
    state = stateOpt.startsWith("@") ? await readJsonFile(stateOpt.slice(1)) : coerceState(stateOpt);
  }

  if (state === undefined || questions === undefined) {
    const stdin = await readStdin();
    if (stdin.trim()) {
      const body = parseJson(stdin, "stdin") as Record<string, unknown>;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        state ??= body.state;
        questions ??= body.questions;
      } else if (state === undefined) {
        state = body;
      }
    }
  }

  if (state === undefined) throw new CliError("No state. Pass --state, --state @file.json, or JSON on stdin.");
  if (questions === undefined) {
    throw new CliError("No questions. Pass --questions, --schema <name>, or include them in stdin JSON.");
  }
  return { state, questions };
}

export function validateRequest(state: unknown, questions: unknown, model: string) {
  const parsed = Request.safeParse({ state, model, questions });
  if (!parsed.success) {
    throw new CliError(`Invalid request: ${formatIssues(parsed.error.issues)}`, EXIT.INPUT);
  }
  return parsed.data;
}

export async function runCommand(args: Args): Promise<number> {
  const cfg: Config = loadConfig({
    apiKey: args.string("api-key"),
    model: args.string("model"),
    baseUrl: args.string("base-url"),
  });
  const { state, questions } = await resolveInput(args);

  if (args.flag("dry-run")) {
    emit(validateRequest(state, questions, cfg.model), !args.flag("compact"));
    return EXIT.OK;
  }

  const body = validateRequest(state, questions, cfg.model);
  const result = await call(body, cfg);

  if (args.flag("bare")) {
    emit(result.response.answers, !args.flag("compact"));
    return EXIT.OK;
  }

  emit(
    {
      model: result.response.model ?? cfg.model,
      answers: result.response.answers,
      meta: {
        latency_ms: result.latencyMs,
        attempts: result.attempts,
        usage: result.response.usage ?? null,
        cost_usd: costUsd(result.response.usage, cfg.pricing) ?? null,
      },
    },
    !args.flag("compact"),
  );
  return EXIT.OK;
}

export { Questions };
