import OpenAI from "openai";

import type { WeddingProfile } from "@/lib/supabase/types";

export const runtime = "nodejs";

type DraftMessage = {
  channel: "WhatsApp" | "Email";
  id: string;
  message: string;
  recipient: string;
  recipientType: "vendor" | "family";
  reason: string;
  subject: string | null;
  urgency: "high" | "medium" | "low";
};

type CommsRequestBody = {
  budget?: WeddingProfile["budget"];
  city?: WeddingProfile["city"];
  guest_count?: WeddingProfile["guest_count"];
  partner1_name?: WeddingProfile["partner1_name"];
  wedding_date?: WeddingProfile["wedding_date"];
  wedding_type?: WeddingProfile["wedding_type"];
};

function extractArrayFromText(content: string) {
  const startIndex = content.indexOf("[");
  const endIndex = content.lastIndexOf("]");

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("The communication drafts were not valid JSON.");
  }

  return content.slice(startIndex, endIndex + 1);
}

function parseDraftPayload(content: string) {
  const trimmedContent = content.trim();

  if (trimmedContent.startsWith("[")) {
    return JSON.parse(trimmedContent) as Array<Partial<DraftMessage>>;
  }

  const parsedObject = JSON.parse(trimmedContent) as {
    drafts?: Array<Partial<DraftMessage>>;
  };

  if (Array.isArray(parsedObject.drafts)) {
    return parsedObject.drafts;
  }

  return JSON.parse(extractArrayFromText(trimmedContent)) as Array<
    Partial<DraftMessage>
  >;
}

function normalizeDraftMessage(
  item: Partial<DraftMessage>,
  index: number,
): DraftMessage {
  const recipientType =
    item.recipientType === "family" ? "family" : "vendor";
  const channel = item.channel === "Email" ? "Email" : "WhatsApp";
  const urgency =
    item.urgency === "high" || item.urgency === "low" ? item.urgency : "medium";

  return {
    channel,
    id: item.id?.trim() || `draft-${index + 1}`,
    message: item.message?.trim() || "Draft message unavailable.",
    recipient: item.recipient?.trim() || `Stakeholder ${index + 1}`,
    recipientType,
    reason: item.reason?.trim() || "This message needs your approval.",
    subject: channel === "Email" ? item.subject?.trim() || "Wedding planning update" : null,
    urgency,
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY.", { status: 500 });
  }

  let body: CommsRequestBody;

  try {
    body = (await request.json()) as CommsRequestBody;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  console.log("Communication Agent route called with body:", body);

  const profile: WeddingProfile = {
    budget: body.budget ?? null,
    city: body.city ?? null,
    guest_count: body.guest_count ?? null,
    partner1_name: body.partner1_name ?? null,
    partner2_name: null,
    role: null,
    wedding_date: body.wedding_date ?? null,
    wedding_type: body.wedding_type ?? null,
  };

  if (!profile.partner1_name && !profile.wedding_date && !profile.city) {
    return new Response("Wedding profile is required.", { status: 400 });
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      messages: [
        {
          content:
            "You are Wedly's Communication Agent. Based on the wedding details provided, generate exactly 4 draft messages that need to be sent. Each message should be to a different stakeholder — mix of vendors and family. Return a JSON array with exactly 4 objects. Each object must have these fields: id (unique string), recipient (name), recipientType (vendor or family), channel (WhatsApp or Email), subject (short subject line for email or null for WhatsApp), message (the full drafted message text), urgency (high, medium or low), reason (one line explaining why this message needs to go out now). Make messages specific to the wedding date, city, guest count and budget. Be realistic and contextual.",
          role: "system",
        },
        {
          content: JSON.stringify(profile),
          role: "user",
        },
      ],
      model: "gpt-4o",
      temperature: 0.8,
    });

    const rawContent = completion.choices[0]?.message?.content;

    if (!rawContent) {
      throw new Error("OpenAI returned an empty response.");
    }

    const parsed = parseDraftPayload(rawContent);

    const normalizedDrafts = parsed
      .slice(0, 4)
      .map((item, index) => normalizeDraftMessage(item, index));

    while (normalizedDrafts.length < 4) {
      normalizedDrafts.push(
        normalizeDraftMessage(
          {
            channel: normalizedDrafts.length % 2 === 0 ? "WhatsApp" : "Email",
            id: `draft-${normalizedDrafts.length + 1}`,
            message: "Draft message unavailable.",
            recipient: `Stakeholder ${normalizedDrafts.length + 1}`,
            recipientType: normalizedDrafts.length % 2 === 0 ? "vendor" : "family",
            reason: "This message needs your approval.",
            subject:
              normalizedDrafts.length % 2 === 0 ? null : "Wedding planning update",
            urgency: "medium",
          },
          normalizedDrafts.length,
        ),
      );
    }

    console.log("Communication Agent normalized drafts:", normalizedDrafts);
    return Response.json(normalizedDrafts);
  } catch (error) {
    return new Response(
      error instanceof Error
        ? error.message
        : "Unable to generate communication drafts.",
      {
        status: 500,
      },
    );
  }
}
