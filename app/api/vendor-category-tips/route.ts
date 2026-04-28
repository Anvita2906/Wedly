import OpenAI from "openai";

export const runtime = "nodejs";

type VendorCategoryTipsBody = {
  budget?: number | null;
  category?: string | null;
  city?: string | null;
  wedding_type?: string | null;
};

type VendorCategoryTip = {
  tip: string;
  urgency: "high" | "medium" | "low";
};

function extractArrayFromText(content: string) {
  const startIndex = content.indexOf("[");
  const endIndex = content.lastIndexOf("]");

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("The vendor category tips response was not valid JSON.");
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
    return JSON.parse(normalizedContent) as Array<Partial<VendorCategoryTip>>;
  }

  try {
    const parsedObject = JSON.parse(normalizedContent) as {
      tips?: Array<Partial<VendorCategoryTip>>;
    };

    if (Array.isArray(parsedObject.tips)) {
      return parsedObject.tips;
    }
  } catch {}

  return JSON.parse(extractArrayFromText(normalizedContent)) as Array<
    Partial<VendorCategoryTip>
  >;
}

function normalizeTip(item: Partial<VendorCategoryTip>) {
  return {
    tip: item.tip?.trim() || "Shortlist this category carefully.",
    urgency:
      item.urgency === "high" || item.urgency === "low"
        ? item.urgency
        : "medium",
  } satisfies VendorCategoryTip;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY.", { status: 500 });
  }

  let body: VendorCategoryTipsBody;

  try {
    body = (await request.json()) as VendorCategoryTipsBody;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  if (!body.category) {
    return new Response("Category is required.", { status: 400 });
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      messages: [
        {
          content: `Give 2-3 specific actionable tips for booking a ${body.category} vendor for a ${body.wedding_type ?? "wedding"} in ${body.city ?? "their city"} with budget ${body.budget ?? "not specified"}. Each tip should be one sentence, practical and specific. Return JSON array with objects: tip (string), urgency (high/medium/low).`,
          role: "system",
        },
        {
          content: JSON.stringify(body),
          role: "user",
        },
      ],
      model: "gpt-4o",
      temperature: 0.7,
    });

    const rawContent = completion.choices[0]?.message?.content;

    if (!rawContent) {
      throw new Error("OpenAI returned an empty vendor category tips response.");
    }

    const tips = parseTipsPayload(rawContent)
      .slice(0, 3)
      .map(normalizeTip);

    return Response.json(tips);
  } catch (error) {
    return new Response(
      error instanceof Error
        ? error.message
        : "Unable to generate category tips.",
      {
        status: 500,
      },
    );
  }
}
