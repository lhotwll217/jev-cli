import { readFile } from "node:fs/promises";
import { CliError, EXIT } from "./config.ts";

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new CliError(`${label} is not valid JSON: ${(err as Error).message}`, EXIT.INPUT);
  }
}

export async function readJsonFile(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw new CliError(`Cannot read ${path}: ${(err as Error).message}`, EXIT.INPUT);
  }
  return parseJson(text, path);
}

/**
 * A --state value is a literal string unless it parses as JSON, so
 * `--state '{"ticket": ...}'` sends structured content while
 * `--state 'payouts are down'` sends the sentence.
 */
export function coerceState(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function emit(value: unknown, pretty: boolean): void {
  process.stdout.write(JSON.stringify(value, null, pretty ? 2 : 0) + "\n");
}
