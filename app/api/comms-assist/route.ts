import OpenAI from "openai";

import type { WeddingProfile } from "@/lib/supabase/types";

export const runtime = "nodejs";

type CommsAssistRequest = {
  channel?: string;
  partialMessage?: string;
  subject?: string;
  weddingProfile?: Partial<WeddingProfile> | null;
};

type CommsAssistResponse = {
  suggestion: string;
};

function extractJsonObject(content: string) {
  const trimmed = content.trim();

  if (trimmed.startsWith("```")) {
    const withoutFence = trimmed
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();

    return extractJsonObject(withoutFence);
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse AI suggestion.");
  }

  return trimmed.slice(start, end + 1);
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY.", { status: 500 });
  }

  let body: CommsAssistRequest;

  try {
    body = (await request.json()) as CommsAssistRequest;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  if (!body.weddingProfile) {
    return new Response("Wedding profile is required.", { status: 400 });
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      messages: [
        {
          content:
            "You are helping draft a wedding communication message. Channel: " +
            `${body.channel ?? "Email"}. Subject if email: ${body.subject ?? ""}. ` +
            `The user has started writing: ${body.partialMessage ?? ""}. Wedding details: ${JSON.stringify(body.weddingProfile)}. ` +
            "Generate a complete, warm and professional message appropriate for this channel. For WhatsApp be conversational and concise. For Email be slightly more formal. For SMS be very brief under 160 characters. Return JSON with one field: suggestion.",
          role: "system",
        },
      ],
      model: "gpt-4o",
      temperature: 0.5,
    });

    const rawContent = completion.choices[0]?.message?.content;

    if (!rawContent) {
      throw new Error("OpenAI returned an empty response.");
    }

    const parsed = JSON.parse(extractJsonObject(rawContent)) as Partial<CommsAssistResponse>;

    if (!parsed.suggestion?.trim()) {
      throw new Error("OpenAI did not return a usable suggestion.");
    }

    return Response.json({ suggestion: parsed.suggestion.trim() });
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Could not generate AI suggestion.",
      { status: 500 },
    );
  }
}
