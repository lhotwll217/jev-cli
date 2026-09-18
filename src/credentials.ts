import { createRequire } from "node:module";
import type { Entry as KeyringEntry } from "@napi-rs/keyring";
import { CliError, EXIT } from "./config.ts";

const DEFAULT_SERVICE = "ai.typesafe.jev-cli";
const ACCOUNT = "default";
const require = createRequire(import.meta.url);

type EntryConstructor = new (service: string, account: string) => KeyringEntry;

function entry(): KeyringEntry {
  try {
    const { Entry } = require("@napi-rs/keyring") as { Entry: EntryConstructor };
    return new Entry(process.env.JEV_CREDENTIAL_SERVICE ?? DEFAULT_SERVICE, ACCOUNT);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `Secure credential storage is unavailable: ${detail}\nUse TYPESAFE_API_KEY for this session or CI.`,
      EXIT.AUTH,
    );
  }
}

export function storedApiKey(): string | undefined {
  try {
    return entry().getPassword() ?? undefined;
  } catch (error) {
    if (error instanceof CliError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(`Could not read the API key from secure storage: ${detail}`, EXIT.AUTH);
  }
}

export function saveApiKey(apiKey: string): void {
  try {
    entry().setPassword(apiKey);
  } catch (error) {
    if (error instanceof CliError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(`Could not save the API key in secure storage: ${detail}`, EXIT.AUTH);
  }
}

export function removeApiKey(): boolean {
  try {
    return entry().deleteCredential();
  } catch (error) {
    if (error instanceof CliError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(`Could not remove the API key from secure storage: ${detail}`, EXIT.AUTH);
  }
}
