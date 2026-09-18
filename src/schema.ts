import { z } from "zod";

/**
 * Mirrors the TypeSafe System One request/response contract
 * (POST /v1/systemone). Content fields accept string | object | array.
 */
const Content = z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]);

const NoulQuestion = z.object({
  type: z.literal("noul"),
  instructions: Content,
  name: z.string().optional(),
  criteria: z.object({ true: z.string(), false: z.string() }).partial().optional(),
});

const ChoiceQuestion = z.object({
  type: z.literal("choice"),
  instructions: Content,
  name: z.string().optional(),
  criteria: z.record(z.union([z.string(), z.null()])),
});

const ScoreQuestion = z.object({
  type: z.literal("score"),
  instructions: Content,
  name: z.string().optional(),
  criteria: z.array(z.string()).min(2, "score.criteria needs at least 2 ordered levels"),
});

export const Question = z.discriminatedUnion("type", [NoulQuestion, ChoiceQuestion, ScoreQuestion]);
export const Questions = z
  .record(Question)
  .refine((q) => Object.keys(q).length > 0, { message: "questions must not be empty" });

export const Request = z.object({
  state: Content,
  model: z.string().default("jev-latest"),
  questions: Questions,
});

/**
 * Answers are parsed permissively: unknown keys pass through so a server-side
 * addition never breaks the CLI, but the fields we report on are checked.
 */
const NoulAnswer = z.object({ type: z.literal("noul"), noul: z.number() }).passthrough();
const ChoiceAnswer = z
  .object({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities: z.record(z.number()).optional(),
    confidence: z.number().optional(),
  })
  .passthrough();
const ScoreAnswer = z
  .object({
    type: z.literal("score"),
    score: z.number(),
    legend: z.record(z.string()).optional(),
    probabilities: z.record(z.number()).optional(),
    confidence: z.number().optional(),
  })
  .passthrough();

export const Answer = z.union([NoulAnswer, ChoiceAnswer, ScoreAnswer, z.record(z.unknown())]);

export const Usage = z
  .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
  .passthrough();

export const Response = z
  .object({
    model: z.string().optional(),
    answers: z.record(Answer),
    usage: Usage.optional(),
  })
  .passthrough();

export type Request = z.infer<typeof Request>;
export type Response = z.infer<typeof Response>;
export type Usage = z.infer<typeof Usage>;
export type Questions = z.infer<typeof Questions>;

/**
 * Advisory checks that are not API rules. A two-option choice is a noul with
 * extra steps: same information, but you pay for a probability map to carry it.
 */
export function lintQuestions(questions: unknown): string[] {
  const warnings: string[] = [];
  if (!questions || typeof questions !== "object") return warnings;
  for (const [id, q] of Object.entries(questions as Record<string, unknown>)) {
    if (!q || typeof q !== "object") continue;
    const question = q as { type?: unknown; criteria?: unknown };
    if (question.type !== "choice" || !question.criteria || typeof question.criteria !== "object") continue;
    const options = Object.keys(question.criteria as Record<string, unknown>);
    if (options.length === 2) {
      warnings.push(
        `${id}: a 2-option choice (${options.join(", ")}) is a noul with extra steps -- consider type "noul".`,
      );
    }
    if (options.length === 1) {
      warnings.push(`${id}: a 1-option choice has nothing to decide.`);
    }
  }
  return warnings;
}
