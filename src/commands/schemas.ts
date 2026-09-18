import { CliError } from "../config.ts";
import { schemaDir } from "../config.ts";
import { emit, parseJson, readJsonFile, readStdin } from "../io.ts";
import { listSchemas, loadSchema, removeSchema, saveSchema } from "../library.ts";
import { warn } from "./run.ts";
import type { Args } from "../args.ts";

export async function schemasCommand(args: Args): Promise<number> {
  const sub = args.positional[0];
  switch (sub) {
    case undefined:
    case "list": {
      const names = await listSchemas();
      if (args.flag("json")) emit(names, !args.flag("compact"));
      else if (names.length === 0) process.stderr.write(`No saved schemas in ${schemaDir()}\n`);
      else process.stdout.write(names.join("\n") + "\n");
      return 0;
    }
    case "show": {
      const name = requireName(args.positional[1]);
      emit(await loadSchema(name), !args.flag("compact"));
      return 0;
    }
    case "add": {
      const name = requireName(args.positional[1]);
      const source = args.positional[2];
      const questions = source
        ? source.trim().startsWith("{")
          ? parseJson(source, "questions")
          : await readJsonFile(source)
        : parseJson(await readStdin(), "stdin");
      const map = unwrap(questions);
      warn(map, args);
      const path = await saveSchema(name, map);
      process.stderr.write(`Saved ${name} -> ${path}\n`);
      return 0;
    }
    case "rm": {
      const name = requireName(args.positional[1]);
      await removeSchema(name);
      process.stderr.write(`Removed ${name}\n`);
      return 0;
    }
    case "path":
      process.stdout.write(schemaDir() + "\n");
      return 0;
    default:
      throw new CliError(`Unknown subcommand: schemas ${sub}`);
  }
}

/** Accepts either a bare questions map or a full request body containing one. */
function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "questions" in value) {
    return (value as { questions: unknown }).questions;
  }
  return value;
}

function requireName(name: string | undefined): string {
  if (!name) throw new CliError("Missing schema name.");
  return name;
}
