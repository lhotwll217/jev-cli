import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { CliError, EXIT, schemaDir } from "./config.ts";
import { Questions } from "./schema.ts";
import { parseJson } from "./io.ts";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function pathFor(name: string): string {
  if (!NAME_RE.test(name)) {
    throw new CliError(`Invalid schema name ${name} -- use letters, digits, dot, dash, underscore.`);
  }
  return join(schemaDir(), `${name}.json`);
}

export async function saveSchema(name: string, questions: unknown): Promise<string> {
  const parsed = Questions.safeParse(questions);
  if (!parsed.success) {
    throw new CliError(`Invalid questions: ${formatIssues(parsed.error.issues)}`, EXIT.INPUT);
  }
  await mkdir(schemaDir(), { recursive: true });
  const path = pathFor(name);
  await writeFile(path, JSON.stringify(parsed.data, null, 2) + "\n", "utf8");
  return path;
}

export async function loadSchema(name: string): Promise<unknown> {
  const path = pathFor(name);
  try {
    return parseJson(await readFile(path, "utf8"), path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError(`No saved schema named ${name}. Try: jev schemas list`, EXIT.INPUT);
    }
    throw err;
  }
}

export async function listSchemas(): Promise<string[]> {
  try {
    const entries = await readdir(schemaDir());
    return entries.filter((e) => e.endsWith(".json")).map((e) => e.slice(0, -5)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function removeSchema(name: string): Promise<void> {
  try {
    await unlink(pathFor(name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError(`No saved schema named ${name}.`, EXIT.INPUT);
    }
    throw err;
  }
}

export function formatIssues(issues: { path: (string | number)[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}
