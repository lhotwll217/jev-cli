import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/index.ts", import.meta.url));

let server: Server;
let baseUrl = "";
let jevHome = "";

/** Scripted responses keyed by a marker inside the request state. */
const ANSWER = {
  type: "choice" as const,
  choice: "billing",
  probabilities: { billing: 0.82, technical: 0.18 },
  confidence: 0.82,
};
let overloadCount = 0;

before(async () => {
  jevHome = await mkdtemp(join(tmpdir(), "jev-test-"));
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.headers.authorization !== "Bearer test-key") {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end('{"error":"bad key"}');
      }
      const parsed = JSON.parse(body || "{}");
      const state = typeof parsed.state === "string" ? parsed.state : JSON.stringify(parsed.state);
      if (state.includes("BOOM")) {
        res.writeHead(422, { "content-type": "application/json" });
        return res.end('{"error":"nope"}');
      }
      if (state.includes("OVERLOAD") && overloadCount < 2) {
        overloadCount++;
        res.writeHead(529, { "retry-after": "0" });
        return res.end("overloaded");
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          model: parsed.model,
          answers: { department: ANSWER, urgency: { type: "noul", noul: 0.93 } },
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "object" && address) baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(jevHome, { recursive: true, force: true });
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function jev(args: string[], opts: { stdin?: string; env?: Record<string, string> } = {}): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: {
        ...process.env,
        TYPESAFE_API_KEY: "test-key",
        TYPESAFE_BASE_URL: baseUrl,
        JEV_HOME: jevHome,
        ...opts.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

const QUESTIONS = {
  department: {
    type: "choice",
    instructions: "Which team handles this?",
    criteria: { billing: "Payment issues", technical: "Bugs" },
  },
  urgency: { type: "noul", instructions: "Is this urgent?" },
};

test("run: returns answers plus latency and usage meta", async () => {
  const res = await jev(["run", "--state", "payouts failing", "--questions", JSON.stringify(QUESTIONS)]);
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.answers.department.choice, "billing");
  assert.equal(out.meta.usage.input_tokens, 100);
  assert.ok(out.meta.latency_ms >= 0);
  assert.equal(out.meta.cost_usd, null, "no cost without configured pricing");
});

test("run: reports cost only when prices are configured", async () => {
  const res = await jev(["run", "--state", "x", "--questions", JSON.stringify(QUESTIONS)], {
    env: { JEV_PRICE_INPUT_PER_MTOK: "1", JEV_PRICE_OUTPUT_PER_MTOK: "2" },
  });
  assert.equal(res.code, 0, res.stderr);
  // 100/1e6 * 1 + 20/1e6 * 2 = 0.00014
  assert.equal(JSON.parse(res.stdout).meta.cost_usd, 0.00014);
});

test("run: accepts a whole request body on stdin", async () => {
  const res = await jev(["run", "--bare"], {
    stdin: JSON.stringify({ state: "hello", questions: QUESTIONS }),
  });
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.department.choice, "billing");
  assert.equal(out.urgency.noul, 0.93);
});

test("run: --dry-run validates without calling the API", async () => {
  const res = await jev(["run", "--state", "BOOM", "--questions", JSON.stringify(QUESTIONS), "--dry-run"]);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).model, "jev-latest");
});

test("run: a one-option choice is warned about, not rejected", async () => {
  const thin = { q: { type: "choice", instructions: "pick", criteria: { only: "one" } } };
  const res = await jev(["run", "--state", "x", "--questions", JSON.stringify(thin)]);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stderr, /nothing to decide/);
});

test("run: a two-option choice warns that noul is the better type", async () => {
  const binary = { q: { type: "choice", instructions: "pick", criteria: { yes: "y", no: "n" } } };
  const res = await jev(["run", "--state", "x", "--questions", JSON.stringify(binary)]);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stderr, /noul with extra steps/);
  assert.match(res.stderr, /yes, no/);
});

test("run: --no-warn silences the advisory", async () => {
  const binary = { q: { type: "choice", instructions: "pick", criteria: { yes: "y", no: "n" } } };
  const res = await jev(["run", "--state", "x", "--questions", JSON.stringify(binary), "--no-warn"]);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, "");
});

test("batch: the choice advisory fires once, not once per row", async () => {
  const binary = { q: { type: "choice", instructions: "pick", criteria: { yes: "y", no: "n" } } };
  const input = ['"a"', '"b"', '"c"'].join("\n");
  const res = await jev(["batch", "--questions", JSON.stringify(binary), "--no-summary"], { stdin: input });
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr.match(/noul with extra steps/g)?.length, 1);
});

test("warnings go to stderr, leaving stdout parseable", async () => {
  const binary = { q: { type: "choice", instructions: "pick", criteria: { yes: "y", no: "n" } } };
  const res = await jev(["run", "--state", "x", "--questions", JSON.stringify(binary), "--bare"]);
  assert.doesNotThrow(() => JSON.parse(res.stdout));
});

test("run: rejects a score question with fewer than two levels", async () => {
  const bad = { q: { type: "score", instructions: "rate", criteria: ["only"] } };
  const res = await jev(["run", "--state", "x", "--questions", JSON.stringify(bad)]);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /at least 2 ordered levels/);
});

test("run: 401 exits with the auth code", async () => {
  const res = await jev(["run", "--state", "x", "--questions", JSON.stringify(QUESTIONS)], {
    env: { TYPESAFE_API_KEY: "wrong" },
  });
  assert.equal(res.code, 3);
  assert.match(res.stderr, /401/);
});

test("run: 422 exits with the input code and does not retry", async () => {
  const res = await jev(["run", "--state", "BOOM", "--questions", JSON.stringify(QUESTIONS)]);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /422/);
});

test("run: retries 529 and reports the attempt count", async () => {
  const res = await jev(["run", "--state", "OVERLOAD please", "--questions", JSON.stringify(QUESTIONS)]);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).meta.attempts, 3);
});

test("schemas: add, list, show, then run against the saved name", async () => {
  const add = await jev(["schemas", "add", "triage", JSON.stringify(QUESTIONS)]);
  assert.equal(add.code, 0, add.stderr);

  const list = await jev(["schemas", "list"]);
  assert.equal(list.stdout.trim(), "triage");

  const show = await jev(["schemas", "show", "triage"]);
  assert.equal(JSON.parse(show.stdout).department.type, "choice");

  const run = await jev(["run", "--state", "card declined", "--schema", "triage", "--bare"]);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).department.choice, "billing");

  const rm = await jev(["schemas", "rm", "triage"]);
  assert.equal(rm.code, 0);
  assert.equal((await jev(["schemas", "list"])).stdout.trim(), "");
});

test("schemas: rejects an invalid question map at save time", async () => {
  const res = await jev(["schemas", "add", "bad", JSON.stringify({ q: { type: "nope" } })]);
  assert.equal(res.code, 2);
});

test("batch: streams JSONL, keeps input order, summarises to stderr", async () => {
  await jev(["schemas", "add", "triage", JSON.stringify(QUESTIONS)]);
  const input = [
    JSON.stringify({ id: "a", state: "card declined" }),
    JSON.stringify({ id: "b", state: "app crashes" }),
    JSON.stringify({ id: "c", state: "pricing question" }),
  ].join("\n");

  const res = await jev(["batch", "--schema", "triage", "--concurrency", "2"], { stdin: input });
  assert.equal(res.code, 0, res.stderr);
  const lines = res.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.id), ["a", "b", "c"]);

  const summary = JSON.parse(res.stderr.trim().split("\n").at(-1)!);
  assert.equal(summary.rows, 3);
  assert.equal(summary.ok, 3);
  assert.equal(summary.usage.input_tokens, 300);
  assert.ok(summary.latency_ms.p50 !== null);
  await jev(["schemas", "rm", "triage"]);
});

test("batch: a failing row is recorded inline and exits 5", async () => {
  const input = ["\"fine\"", "\"BOOM\""].join("\n");
  const res = await jev(["batch", "--questions", JSON.stringify(QUESTIONS)], { stdin: input });
  assert.equal(res.code, 5);
  const lines = res.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines[0].answers.department.choice, "billing");
  assert.match(lines[1].error, /422/);
  assert.equal(JSON.parse(res.stderr.trim().split("\n").at(-1)!).failed, 1);
});

test("missing api key is a clear auth-coded failure", async () => {
  const res = await jev(["run", "--state", "x", "--questions", JSON.stringify(QUESTIONS)], {
    env: { TYPESAFE_API_KEY: "" },
  });
  assert.equal(res.code, 3);
  assert.match(res.stderr, /TYPESAFE_API_KEY/);
});

test("help and unknown commands behave", async () => {
  assert.equal((await jev(["--help"])).code, 0);
  const unknown = await jev(["frobnicate"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Unknown command/);
});
