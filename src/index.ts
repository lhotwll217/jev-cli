#!/usr/bin/env node
import { Args } from "./args.ts";
import { CliError, EXIT } from "./config.ts";
import { USAGE } from "./usage.ts";
import { runCommand } from "./commands/run.ts";
import { batchCommand } from "./commands/batch.ts";
import { schemasCommand } from "./commands/schemas.ts";

const VERSION = "0.1.0";

async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  const args = new Args(argv.slice(1));

  if (!command || command === "--help" || command === "help" || args.flag("help")) {
    process.stdout.write(USAGE);
    return command ? EXIT.OK : EXIT.USAGE;
  }
  if (command === "--version") {
    process.stdout.write(VERSION + "\n");
    return EXIT.OK;
  }

  switch (command) {
    case "run":
      return runCommand(args);
    case "batch":
      return batchCommand(args);
    case "schemas":
      return schemasCommand(args);
    default:
      throw new CliError(`Unknown command: ${command}\n\n${USAGE}`);
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (err instanceof CliError) {
    process.stderr.write(err.message + "\n");
    process.exitCode = err.code;
  } else {
    process.stderr.write((err instanceof Error ? err.stack ?? err.message : String(err)) + "\n");
    process.exitCode = EXIT.API;
  }
}
