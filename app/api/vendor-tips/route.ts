import OpenAI from "openai";

import type { WeddingProfile } from "@/lib/supabase/types";

export const runtime = "nodejs";

type VendorTipsBody = {
  profile?: {
    budget?: WeddingProfile["budget"];
    city?: WeddingProfile["city"];
    guest_count?: WeddingProfile["guest_count"];
    partner1_name?: WeddingProfile["partner1_name"];
    wedding_date?: WeddingProfile["wedding_date"];
    wedding_type?: WeddingProfile["wedding_type"];
  };
  vendors?: Array<{
    budget_allocated?: number | null;
    category?: string | null;
    notes?: string | null;
    status?: string | null;
    vendor_name?: string | null;
  }>;
};

type VendorTip = {
  category: string;
  tip: string;
  urgency: "high" | "medium" | "low";
};

function extractArrayFromText(content: string) {
  const startIndex = content.indexOf("[");
  const endIndex = content.lastIndexOf("]");

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("The vendor tips response was not valid JSON.");
  }

  return content.slice(startIndex, endIndex + 1);
}

function parseTipsPayload(content: string) {
  const normalizedContent = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (normalizedContent.startsWith("[")) {
    return JSON.parse(normalizedContent) as Array<Partial<VendorTip>>;
  }

  try {
    const parsedObject = JSON.parse(normalizedContent) as {
      tips?: Array<Partial<VendorTip>>;
    };

    if (Array.isArray(parsedObject.tips)) {
      return parsedObject.tips;
    }
  } catch {}

  return JSON.parse(extractArrayFromText(normalizedContent)) as Array<
    Partial<VendorTip>
  >;
}

function normalizeTip(item: Partial<VendorTip>) {
  return {
    category: item.category?.trim() || "General",
    tip: item.tip?.trim() || "Review this vendor category next.",
    urgency:
      item.urgency === "high" || item.urgency === "low"
        ? item.urgency
        : "medium",
  } satisfies VendorTip;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY.", { status: 500 });
  }

  let body: VendorTipsBody;

  try {
    body = (await request.json()) as VendorTipsBody;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  if (!body.profile) {
    return new Response("Wedding profile is required.", { status: 400 });
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      messages: [
        {
          content:
            "Based on this wedding profile and vendor list, give 4 specific actionable tips for vendor booking. Each tip should be specific to their city, wedding type and current planning stage. Return JSON array with objects: tip (one sentence action), category (which vendor this applies to), urgency (high/medium/low).",
          role: "system",
        },
        {
          content: JSON.stringify({
            profile: body.profile,
            vendors: body.vendors ?? [],
          }),
          role: "user",
        },
      ],
      model: "gpt-4o",
      temperature: 0.7,
    });

    const rawContent = completion.choices[0]?.message?.content;

    if (!rawContent) {
      throw new Error("OpenAI returned an empty vendor tips response.");
    }

    const tips = parseTipsPayload(rawContent)
      .slice(0, 4)
      .map(normalizeTip);

    return Response.json(tips);
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Unable to generate vendor tips.",
      {
        status: 500,
      },
    );
  }
}
