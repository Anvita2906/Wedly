import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import { createClient } from "@/lib/supabase/server";
import type { Database, WeddingProfile } from "@/lib/supabase/types";

export const runtime = "nodejs";

type VendorsGenerateBody = {
  budget?: WeddingProfile["budget"];
  city?: WeddingProfile["city"];
  guest_count?: WeddingProfile["guest_count"];
  partner1_name?: WeddingProfile["partner1_name"];
  wedding_date?: WeddingProfile["wedding_date"];
  wedding_type?: WeddingProfile["wedding_type"];
};

type GeneratedVendor = {
  budget_allocated: number | null;
  category: string;
  is_ai_suggested: boolean;
  notes: string;
};

type VendorRow = GeneratedVendor & {
  amount_paid?: number | null;
  contact_name?: string | null;
  id: string;
  email?: string | null;
  status: string;
  user_id: string;
  phone?: string | null;
  vendor_name?: string | null;
};

type VendorInsert = Omit<VendorRow, "id">;

type ExtendedDatabase = {
  public: {
    CompositeTypes: Database["public"]["CompositeTypes"];
    Enums: Database["public"]["Enums"];
    Functions: Database["public"]["Functions"];
    Tables: Database["public"]["Tables"] & {
      vendors: {
        Insert: VendorInsert;
        Relationships: [];
        Row: VendorRow;
        Update: Partial<Omit<VendorRow, "id" | "user_id">>;
      };
    };
    Views: Database["public"]["Views"];
  };
};

type VendorProfile = {
  budget: number | null;
  city: string | null;
  guest_count: number | null;
  partner1_name: string | null;
  wedding_date: string | null;
  wedding_type: string | null;
};

function extractArrayFromText(content: string) {
  const startIndex = content.indexOf("[");
  const endIndex = content.lastIndexOf("]");

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("The vendor response was not valid JSON.");
  }

  return content.slice(startIndex, endIndex + 1);
}

function parseVendorPayload(content: string) {
  const normalizedContent = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (normalizedContent.startsWith("[")) {
    return JSON.parse(normalizedContent) as Array<Partial<GeneratedVendor>>;
  }

  try {
    const parsedObject = JSON.parse(normalizedContent) as {
      vendors?: Array<Partial<GeneratedVendor>>;
    };

    if (Array.isArray(parsedObject.vendors)) {
      return parsedObject.vendors;
    }
  } catch {}

  return JSON.parse(extractArrayFromText(normalizedContent)) as Array<
    Partial<GeneratedVendor>
  >;
}

function parseBudgetAmount(value: unknown) {
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

function normalizeGeneratedVendor(item: Partial<GeneratedVendor>) {
  return {
    budget_allocated: parseBudgetAmount(item.budget_allocated),
    category: item.category?.trim() || "Vendor category",
    is_ai_suggested: true,
    notes: item.notes?.trim() || "Wedly AI suggested this category for your plan.",
  } satisfies GeneratedVendor;
}

function getFallbackVendorCategories(profile: VendorProfile) {
  const totalBudget = profile.budget ?? 0;
  const weddingType = (profile.wedding_type ?? "").toLowerCase();
  const city = profile.city ?? "your city";

  const categories: Array<{
    category: string;
    note: string;
    share: number;
  }> = [
    {
      category: "Venue",
      note: `Shortlist venues in ${city} that fit your guest count before locking any downstream vendor.`,
      share: 0.28,
    },
    {
      category: "Catering",
      note: `Taste-test menus early so the food plan matches the scale and style of your wedding.`,
      share: 0.22,
    },
    {
      category: "Photography",
      note: `Look for photographers whose portfolio matches the pace and rituals of your celebration.`,
      share: 0.08,
    },
    {
      category: "Decor",
      note: `Use decor budgeting carefully so florals and staging stay aligned with the overall tone.`,
      share: 0.1,
    },
    {
      category: "Makeup & Styling",
      note: `Book stylists who can handle long event hours and any location changes smoothly.`,
      share: 0.05,
    },
    {
      category: "Invitations & Stationery",
      note: `Keep invitation timelines realistic so family communication does not get delayed.`,
      share: 0.03,
    },
    {
      category: "Entertainment",
      note: `Entertainment decisions work best once the guest energy and event structure are clear.`,
      share: 0.05,
    },
    {
      category: "Transport & Logistics",
      note: `Map guest movement early if multiple venues or outstation arrivals are involved.`,
      share: 0.04,
    },
    {
      category: "Wedding Planner",
      note: `A planner or coordinator can reduce vendor follow-ups if your planning window is tight.`,
      share: 0.07,
    },
    {
      category: "Gifting & Favours",
      note: `Choose favours that are easy to source in volume and meaningful for your guest profile.`,
      share: 0.03,
    },
  ];

  if (weddingType.includes("south")) {
    categories.push(
      {
        category: "Nadaswaram",
        note: `For a South Indian wedding, confirm artist availability around key ceremony timings early.`,
        share: 0.025,
      },
      {
        category: "Flower Decoration Specialist",
        note: `Choose a decorator experienced with traditional floral work and mandap detailing.`,
        share: 0.03,
      },
    );
  } else if (weddingType.includes("north") || weddingType.includes("rajasthani")) {
    categories.push(
      {
        category: "Dhol Players",
        note: `Coordinate dhol timing with baraat flow and venue sound permissions in advance.`,
        share: 0.02,
      },
      {
        category: "Turban Maker",
        note: `Turban fitting and colour coordination should be locked after outfit tones are final.`,
        share: 0.015,
      },
    );
  } else if (weddingType.includes("destination")) {
    categories.push(
      {
        category: "Guest Hospitality",
        note: `Destination weddings need a dedicated hospitality lead for arrivals, rooming, and guest care.`,
        share: 0.04,
      },
      {
        category: "Travel Coordination",
        note: `Align travel blocks and shuttle timing early to avoid last-minute guest confusion.`,
        share: 0.03,
      },
    );
  }

  return categories.slice(0, 12).map((item) => ({
    budget_allocated: totalBudget > 0 ? Math.round(totalBudget * item.share) : null,
    category: item.category,
    is_ai_suggested: true,
    notes: item.note,
  }));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Unable to generate vendor categories.";
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY.", { status: 500 });
  }

  let body: VendorsGenerateBody;

  try {
    body = (await request.json()) as VendorsGenerateBody;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  const supabase = await createClient();
  const vendorSupabase = supabase as unknown as SupabaseClient<ExtendedDatabase>;
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

  const profile: VendorProfile = {
    budget: body.budget ?? null,
    city: body.city ?? null,
    guest_count: body.guest_count ?? null,
    partner1_name: body.partner1_name ?? null,
    wedding_date: body.wedding_date ?? null,
    wedding_type: body.wedding_type ?? null,
  };

  const client = new OpenAI({ apiKey });

  try {
    let normalizedVendors: GeneratedVendor[] = [];

    try {
    const completion = await client.chat.completions.create({
      messages: [
        {
          content: `You are a professional wedding planner. Based on the wedding details provided generate a list of vendor categories this couple will need. Wedding type is ${profile.wedding_type ?? "not specified"}, city is ${profile.city ?? "not specified"}, guest count is ${profile.guest_count ?? "not specified"}, total budget is ${profile.budget ?? "not specified"}. Return a JSON array of vendor objects. Each object must have: category (vendor type like Venue, Catering, Photography etc), budget_allocated (realistic amount in INR based on their total budget and wedding type — allocate percentages sensibly), notes (one line of specific advice for this vendor category given their city and wedding type), is_ai_suggested: true. Generate between 8-12 categories specific to their wedding type. For example a Rajasthani wedding in Jaipur should include Dhol Players, Ghodi, Turban Maker. A South Indian wedding should include Nadaswaram, Flower Decoration specialist. Return only valid JSON array.`,
          role: "system",
        },
        {
          content: JSON.stringify(profile),
          role: "user",
        },
      ],
      model: "gpt-4o",
      temperature: 0.7,
    });

    const rawContent = completion.choices[0]?.message?.content;

    if (!rawContent) {
      throw new Error("OpenAI returned an empty vendor response.");
    }

    const parsedVendors = parseVendorPayload(rawContent);
    normalizedVendors = parsedVendors
      .slice(0, 12)
      .map(normalizeGeneratedVendor)
      .filter((vendor) => vendor.category);
    } catch (openAiError) {
      console.error("vendors-generate OpenAI fallback used:", openAiError);
      normalizedVendors = getFallbackVendorCategories(profile);
    }

    if (!normalizedVendors.length) {
      throw new Error("No vendors were generated.");
    }

    const insertPayload = normalizedVendors.map((vendor) => ({
      ...vendor,
      status: "not_started",
      user_id: user.id,
    }));

    const { data, error } = await vendorSupabase
      .from("vendors" as never)
      .insert(insertPayload as never)
      .select("*");

    if (error) {
      throw error;
    }

    return Response.json((data ?? []) as VendorRow[]);
  } catch (error) {
    console.error("vendors-generate route failed:", error);
    return new Response(getErrorMessage(error), {
      status: 500,
    });
  }
}
