import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BudgetInsightBody = {
  overUnder?: number;
  shoppingItems?: Array<{
    actual_cost?: number | null;
    category?: string | null;
    estimated_cost?: number | null;
    status?: string | null;
    title?: string | null;
  }>;
  totalAllocated?: number;
  totalBudget?: number;
  vendors?: Array<{
    amount_paid?: number | null;
    budget_allocated?: number | null;
    category?: string | null;
    status?: string | null;
    vendor_name?: string | null;
  }>;
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY.", { status: 500 });
  }

  let body: BudgetInsightBody;

  try {
    body = (await request.json()) as BudgetInsightBody;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  if (typeof body.totalBudget !== "number") {
    return new Response("Total budget is required.", { status: 400 });
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      messages: [
        {
          content:
            "You are a wedding budget advisor. Analyse this wedding budget data and give one specific 2-3 sentence insight. Focus on the most important financial risk or opportunity. Mention specific categories and amounts. Be direct and actionable.",
          role: "system",
        },
        {
          content: JSON.stringify(body),
          role: "user",
        },
      ],
      model: "gpt-4o",
      temperature: 0.6,
    });

    const insight = completion.choices[0]?.message?.content?.trim();

    if (!insight) {
      throw new Error("OpenAI returned an empty budget insight.");
    }

    return Response.json({ insight });
  } catch (error) {
    return new Response(
      error instanceof Error
        ? error.message
        : "Unable to generate budget insight.",
      { status: 500 },
    );
  }
}
