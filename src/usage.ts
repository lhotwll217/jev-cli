export const USAGE = `jev -- JSON in, typed decisions out (TypeSafe System One API)

USAGE
  jev run [options]                 One state + questions -> one answer set
  jev batch [options]               JSONL of states against one schema
  jev schemas <list|show|add|rm|path> [name] [source]
  jev --version | --help

RUN
  --state <text|json|@file>         State to evaluate. Bare JSON on stdin also works.
  --questions <file|json>           Question map, inline or from a file.
  --schema <name>                   Saved question map (see: jev schemas).
  --model <name>                    Default: jev-latest
  --bare                            Emit only the answers map, no meta.
  --dry-run                         Validate and print the request; send nothing.

BATCH
  --input <file.jsonl>              One state per line: bare value or {"id","state"}.
  --schema / --questions            Required; applied to every row.
  --concurrency <n>                 In-flight requests. Default 4.
  --fail-fast                       Stop on the first row error.
  --no-summary                      Suppress the stderr summary line.

GLOBAL
  --api-key <key>                   Overrides TYPESAFE_API_KEY.
  --base-url <url>                  Overrides TYPESAFE_BASE_URL.
  --compact                         Single-line JSON output.
  --no-warn                         Silence advisory warnings (stderr).

ENVIRONMENT
  TYPESAFE_API_KEY                  Required.
  TYPESAFE_BASE_URL                 Default https://api.typesafe.ai
  JEV_MODEL                         Default jev-latest
  JEV_TIMEOUT_MS                    Default 60000
  JEV_MAX_RETRIES                   Default 3 (429/529/5xx, exponential backoff)
  JEV_PRICE_INPUT_PER_MTOK          Set both to get cost_usd in the output;
  JEV_PRICE_OUTPUT_PER_MTOK         the API reports tokens only.
  JEV_HOME / XDG_CONFIG_HOME        Where saved schemas live.

EXIT CODES
  0 ok   1 usage   2 bad input   3 auth   4 api error   5 batch had failures
`;
