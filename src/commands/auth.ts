import { stdin as input, stderr as output } from "node:process";
import { Args } from "../args.ts";
import { CliError, EXIT } from "../config.ts";
import { removeApiKey, saveApiKey, storedApiKey } from "../credentials.ts";
import { readStdin } from "../io.ts";

async function promptForApiKey(): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new CliError(
      "Interactive login needs a terminal. Pipe the key to `jev auth login --with-token` instead.",
      EXIT.AUTH,
    );
  }

  output.write("TypeSafe API key: ");
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";

    const finish = (error?: Error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      output.write("\n");
      if (error) reject(error);
      else resolve(value.trim());
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") return finish(new CliError("Login cancelled.", EXIT.AUTH));
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };

    input.on("data", onData);
  });
}

async function login(args: Args): Promise<number> {
  const apiKey = args.flag("with-token") ? (await readStdin()).trim() : await promptForApiKey();
  if (!apiKey) throw new CliError("API key cannot be empty.", EXIT.AUTH);

  saveApiKey(apiKey);
  const saved = storedApiKey();
  if (saved !== apiKey) throw new CliError("Secure-storage verification failed.", EXIT.AUTH);

  process.stdout.write("API key saved in the operating system credential store.\n");
  process.stdout.write("Run `jev auth status` to check setup or `jev run ...` to make a request.\n");
  return EXIT.OK;
}

function status(): number {
  if (process.env.TYPESAFE_API_KEY) {
    process.stdout.write("Authenticated with TYPESAFE_API_KEY from the environment.\n");
    return EXIT.OK;
  }
  if (storedApiKey()) {
    process.stdout.write("Authenticated with an API key from the operating system credential store.\n");
    return EXIT.OK;
  }
  process.stdout.write("Not authenticated. Run `jev auth login`.\n");
  return EXIT.AUTH;
}

function logout(): number {
  const removed = removeApiKey();
  process.stdout.write(removed ? "Stored API key removed.\n" : "No stored API key found.\n");
  if (process.env.TYPESAFE_API_KEY) {
    process.stdout.write("TYPESAFE_API_KEY is still set in the environment.\n");
  }
  return EXIT.OK;
}

export async function authCommand(args: Args): Promise<number> {
  const action = args.positional[0];
  switch (action) {
    case "login":
      return login(args);
    case "status":
      return status();
    case "logout":
      return logout();
    default:
      throw new CliError("Usage: jev auth <login|status|logout> [--with-token]");
  }
}
