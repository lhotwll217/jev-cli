# jev-cli

JSON in, typed decisions out. A thin CLI over the TypeSafe **System One** API
(`POST /v1/systemone`, model `jev-latest`) for ad-hoc experiments, eval loops,
and shelling out from an agent harness.

It exists because reaching for an SDK or an agent skill is too much ceremony
when you just want to probe how the model behaves across a hundred variations
of a prompt state.

## Install

```bash
npm install && npm run build
npm link            # puts `jev` on PATH
export TYPESAFE_API_KEY=sk-...
```

During development, skip the build: `node src/index.ts run ...` (Node 20+
strips the types).

## One decision

```bash
jev run \
  --state "Payouts have been failing for 3 days and we are losing sales." \
  --questions examples/triage.questions.json
```

```json
{
  "model": "jev-latest",
  "answers": {
    "urgency": { "type": "noul", "noul": 0.94 },
    "department": {
      "type": "choice",
      "choice": "billing",
      "probabilities": { "billing": 0.81, "technical": 0.16, "sales": 0.03 },
      "confidence": 0.81
    }
  },
  "meta": {
    "latency_ms": 48,
    "attempts": 1,
    "usage": { "input_tokens": 142, "output_tokens": 18 },
    "cost_usd": null
  }
}
```

A whole request body on stdin works too, which is the shape that composes best
with heredocs and other tools:

```bash
echo '{"state":"card declined","questions":{"urgent":{"type":"noul","instructions":"Is this urgent?"}}}' \
  | jev run --bare | jq '.urgent.noul'
```

`--bare` drops the wrapper and emits only the answers map. `--dry-run`
validates the request and prints it without spending a call.

## A question library

Question maps are the reusable part; the state is what changes per experiment.
Save them by name instead of passing files around:

```bash
jev schemas add triage examples/triage.questions.json
jev run --state "the API returns 500s" --schema triage
jev schemas list        # -> triage
jev schemas path        # where they live ($JEV_HOME or XDG config dir)
```

## Batches

One schema, many states, results as JSONL on stdout in input order. The API has
no batch endpoint, so this is a client-side worker pool.

```bash
jev batch --input examples/states.jsonl --schema triage --concurrency 8 \
  | jq -r '[.id, .answers.department.choice, .answers.severity.score] | @tsv'
```

The per-run summary goes to **stderr**, so stdout stays clean for `jq`:

```json
{"rows":4,"ok":4,"failed":0,"concurrency":8,"wall_ms":210,
 "latency_ms":{"p50":48,"p95":91,"max":91},
 "usage":{"input_tokens":568,"output_tokens":72},"cost_usd":null}
```

A row that fails is written inline as `{"id":..., "error":...}` and the process
exits 5, so a partial batch is still fully usable. `--fail-fast` stops instead.

## Cost reporting

The API returns token counts only — there is no price in the response. `jev`
therefore reports `cost_usd: null` unless you supply the rates yourself:

```bash
export JEV_PRICE_INPUT_PER_MTOK=0.042
export JEV_PRICE_OUTPUT_PER_MTOK=0.042
```

Set them to whatever your contract actually says. Latency and token counts are
always reported and never guessed.

## Question types

| Type | Required | Answer |
|---|---|---|
| `noul` | `instructions`; optional `criteria.{true,false}` | `{ noul: 0–1 }` |
| `choice` | `criteria`: option → description | `{ choice, probabilities, confidence }` |
| `score` | `criteria`: ordered levels (≥2) | `{ score, legend, probabilities, confidence }` |

Bad question maps are rejected locally with a pointed message before any
network call, so a typo in a 500-row batch costs nothing.

Separately, `jev` warns (stderr, once per run, `--no-warn` to silence) when a
`choice` has exactly two options: that is a `noul` with extra steps, paying for
a probability map to carry one bit. It is a warning, not a rule -- the API
allows it and so does the CLI.

## Environment

| Variable | Default |
|---|---|
| `TYPESAFE_API_KEY` | *required* |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` |
| `JEV_MODEL` | `jev-latest` |
| `JEV_TIMEOUT_MS` | `60000` |
| `JEV_MAX_RETRIES` | `3` — 429/529/5xx, exponential backoff with jitter, honours `Retry-After` |
| `JEV_PRICE_INPUT_PER_MTOK` / `JEV_PRICE_OUTPUT_PER_MTOK` | unset → no cost reporting |
| `JEV_HOME` | `$XDG_CONFIG_HOME/jev` or `~/.config/jev` |

## Exit codes

`0` ok · `1` usage · `2` bad input (incl. 422) · `3` auth (401) · `4` API error ·
`5` batch finished with failed rows

## Tests

```bash
npm test        # 15 tests against an in-process mock server
npm run typecheck
```

The suite covers retry-then-succeed on 529, non-retry on 422, schema rejection,
batch ordering under concurrency, and partial-failure exit codes. It has **not**
yet been run against the live API — the request and response shapes come from
the published API reference.
