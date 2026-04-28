import OpenAI from "openai";

import type { WeddingProfile } from "@/lib/supabase/types";

export const runtime = "nodejs";

type SuggestionPhaseId =
  | "foundation"
  | "vendor-locking"
  | "communication"
  | "detailing"
  | "final-sprint";

type TimelineSuggestion = {
  phase_id: SuggestionPhaseId;
  priority: "high" | "medium" | "low";
  reason: string;
  title: string;
};

type TimelineSuggestionsBody = {
  currentMonth?: {
    label: string;
    monthKey: string;
  } | null;
  existingTaskTitles?: string[];
  profile?: Pick<
    WeddingProfile,
    "partner1_name" | "wedding_date" | "city" | "budget" | "guest_count" | "wedding_type"
  > | null;
  suggestionMode?: "general" | "month";
};

function extractJsonArray(content: string) {
  const trimmed = content.trim();

  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as Array<Partial<TimelineSuggestion>>;
  }

  const startIndex = trimmed.indexOf("[");
  const endIndex = trimmed.lastIndexOf("]");

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("Timeline suggestions did not return valid JSON.");
  }

  return JSON.parse(trimmed.slice(startIndex, endIndex + 1)) as Array<
    Partial<TimelineSuggestion>
  >;
}

function normalizeSuggestion(
  suggestion: Partial<TimelineSuggestion>,
  index: number,
): TimelineSuggestion {
  const phaseId = (
    suggestion.phase_id === "vendor-locking" ||
    suggestion.phase_id === "communication" ||
    suggestion.phase_id === "detailing" ||
    suggestion.phase_id === "final-sprint"
      ? suggestion.phase_id
      : "foundation"
  ) as SuggestionPhaseId;

  const priority =
    suggestion.priority === "high" || suggestion.priority === "low"
      ? suggestion.priority
      : "medium";

  return {
    phase_id: phaseId,
    priority,
    reason: suggestion.reason?.trim() || "This task may be missing from the plan.",
    title: suggestion.title?.trim() || `Suggested task ${index + 1}`,
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY.", { status: 500 });
  }

  let body: TimelineSuggestionsBody;

  try {
    body = (await request.json()) as TimelineSuggestionsBody;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  if (!body.profile) {
    return new Response("Wedding profile is required.", { status: 400 });
  }

  const client = new OpenAI({ apiKey });
  const suggestionMode = body.suggestionMode === "month" ? "month" : "general";

  try {
    const completion = await client.chat.completions.create({
      messages: [
        {
          content:
            suggestionMode === "month"
              ? "You are a wedding planner helping a couple focus on this month. Based on the wedding profile, current month, and existing tasks, suggest exactly 3 useful tasks they should aim to complete during this month. Keep the ideas specific to their wedding type, city, guest count, budget, and how close the wedding is. Avoid duplicates of existing tasks. Return JSON array with objects containing exactly: title, reason (one line), phase_id, priority."
              : "Based on this wedding profile and existing tasks, suggest 5 additional tasks the couple might be missing. Make suggestions specific to their wedding type and city. Avoid duplicates of existing tasks. Return JSON array with objects containing exactly: title, reason (one line), phase_id, priority.",
          role: "system",
        },
        {
          content: JSON.stringify({
            currentMonth: body.currentMonth ?? null,
            existingTaskTitles: body.existingTaskTitles ?? [],
            profile: body.profile,
            suggestionMode,
          }),
          role: "user",
        },
      ],
      model: "gpt-4o",
      temperature: 0.7,
    });

    const rawContent = completion.choices[0]?.message?.content;

    if (!rawContent) {
      throw new Error("OpenAI returned no suggestions.");
    }

    const suggestions = extractJsonArray(rawContent)
      .slice(0, suggestionMode === "month" ? 3 : 5)
      .map((item, index) => normalizeSuggestion(item, index));

    return Response.json(suggestions);
  } catch (error) {
    return new Response(
      error instanceof Error
        ? error.message
        : "Unable to generate timeline suggestions.",
      { status: 500 },
    );
  }
}
