import { CliError } from "./config.ts";

const KNOWN_FLAGS = new Set([
  "help", "version", "compact", "bare", "dry-run", "json",
  "fail-fast", "no-summary", "no-warn",
]);

/** Minimal argv parser: `--key value`, `--key=value`, and boolean `--flag`. */
export class Args {
  readonly positional: string[] = [];
  private readonly options = new Map<string, string>();
  private readonly flags = new Set<string>();

  constructor(argv: string[]) {
    for (let i = 0; i < argv.length; i++) {
      const token = argv[i]!;
      if (!token.startsWith("--")) {
        this.positional.push(token);
        continue;
      }
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        this.options.set(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const next = argv[i + 1];
      if (KNOWN_FLAGS.has(body) || next === undefined || next.startsWith("--")) {
        this.flags.add(body);
      } else {
        this.options.set(body, next);
        i++;
      }
    }
  }

  string(name: string): string | undefined {
    return this.options.get(name);
  }

  flag(name: string): boolean {
    return this.flags.has(name) || this.options.get(name) === "true";
  }

  requireString(name: string): string {
    const value = this.options.get(name);
    if (value === undefined) throw new CliError(`Missing required --${name}`);
    return value;
  }
}
