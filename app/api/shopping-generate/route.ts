import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import { createClient } from "@/lib/supabase/server";
import type { Database, WeddingProfile } from "@/lib/supabase/types";

export const runtime = "nodejs";

type ShoppingGenerateBody = {
  budget?: WeddingProfile["budget"];
  city?: WeddingProfile["city"];
  guest_count?: WeddingProfile["guest_count"];
  wedding_type?: WeddingProfile["wedding_type"];
};

type GeneratedShoppingItem = {
  category: string;
  estimated_cost: number | null;
  is_ai_suggested: boolean;
  title: string;
};

type ShoppingItemRow = GeneratedShoppingItem & {
  actual_cost?: number | null;
  id: string;
  status: "not_purchased" | "purchased";
  user_id: string;
};

type ShoppingItemInsert = Omit<ShoppingItemRow, "id">;

type ExtendedDatabase = {
  public: {
    CompositeTypes: Database["public"]["CompositeTypes"];
    Enums: Database["public"]["Enums"];
    Functions: Database["public"]["Functions"];
    Tables: Database["public"]["Tables"] & {
      shopping_items: {
        Insert: ShoppingItemInsert;
        Relationships: [];
        Row: ShoppingItemRow;
        Update: Partial<Omit<ShoppingItemRow, "id" | "user_id">>;
      };
    };
    Views: Database["public"]["Views"];
  };
};

function extractArrayFromText(content: string) {
  const startIndex = content.indexOf("[");
  const endIndex = content.lastIndexOf("]");

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("The shopping response was not valid JSON.");
  }

  return content.slice(startIndex, endIndex + 1);
}

function parseShoppingPayload(content: string) {
  const normalizedContent = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (normalizedContent.startsWith("[")) {
    return JSON.parse(normalizedContent) as Array<Partial<GeneratedShoppingItem>>;
  }

  try {
    const parsedObject = JSON.parse(normalizedContent) as {
      items?: Array<Partial<GeneratedShoppingItem>>;
    };

    if (Array.isArray(parsedObject.items)) {
      return parsedObject.items;
    }
  } catch {}

  return JSON.parse(extractArrayFromText(normalizedContent)) as Array<
    Partial<GeneratedShoppingItem>
  >;
}

function parseCost(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const sanitized = value.replace(/[^\d.]/g, "").trim();

    if (!sanitized) {
      return null;
    }

    const parsedValue = Number(sanitized);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  return null;
}

function normalizeItem(item: Partial<GeneratedShoppingItem>) {
  return {
    category: item.category?.trim() || "Miscellaneous",
    estimated_cost: parseCost(item.estimated_cost),
    is_ai_suggested: true,
    title: item.title?.trim() || "Wedding item",
  } satisfies GeneratedShoppingItem;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY.", { status: 500 });
  }

  let body: ShoppingGenerateBody;

  try {
    body = (await request.json()) as ShoppingGenerateBody;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  const supabase = await createClient();
  const shoppingSupabase = supabase as unknown as SupabaseClient<ExtendedDatabase>;
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return new Response(authError.message, { status: 401 });
  }

  if (!user) {
    return new Response("Unauthorized.", { status: 401 });
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      messages: [
        {
          content: `Generate a wedding shopping list for a ${body.wedding_type ?? "wedding"} wedding in ${body.city ?? "their city"} with ${body.guest_count ?? "their"} guests and budget ${body.budget ?? "not specified"}. Return JSON array of items. Each item: title, category (Bridal, Groom, Decor, Gifts, Stationery, Accessories, Miscellaneous), estimated_cost in INR, is_ai_suggested: true. Generate 15-20 realistic items specific to their wedding type.`,
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
      throw new Error("OpenAI returned an empty shopping response.");
    }

    const normalizedItems = parseShoppingPayload(rawContent)
      .slice(0, 20)
      .map(normalizeItem)
      .filter((item) => item.title);

    const insertPayload = normalizedItems.map((item) => ({
      ...item,
      actual_cost: null,
      status: "not_purchased" as const,
      user_id: user.id,
    }));

    const { data, error } = await shoppingSupabase
      .from("shopping_items" as never)
      .insert(insertPayload as never)
      .select("*");

    if (error) {
      throw error;
    }

    return Response.json((data ?? []) as ShoppingItemRow[]);
  } catch (error) {
    return new Response(
      error instanceof Error
        ? error.message
        : "Unable to generate shopping items.",
      {
        status: 500,
      },
    );
  }
}
