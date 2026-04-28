import OpenAI from "openai";

import type { Database, WeddingProfile } from "@/lib/supabase/types";

export const runtime = "nodejs";

type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];

type VendorStatus =
  | "not_started"
  | "researching"
  | "shortlisted"
  | "booked"
  | "cancelled";

type VendorRow = {
  amount_paid?: number | null;
  budget_allocated: number | null;
  category: string;
  contact_name?: string | null;
  email?: string | null;
  id: string;
  is_ai_suggested: boolean;
  notes: string | null;
  phone?: string | null;
  status: VendorStatus;
  user_id: string;
  vendor_name?: string | null;
};

type GuestRow = {
  id: string;
  name: string;
  phone?: string | null;
  rsvp_status: "Confirmed" | "Pending" | "Declined";
  side: "Bride's side" | "Groom's side";
  user_id: string;
};

type DashboardInsight = {
  action: string;
  action_type: "urgent" | "opportunity";
  category: "vendor" | "timeline" | "budget" | "guests";
  data_points: string[];
  headline: string;
  insight: string;
};

type DashboardInsightBody = {
  guests: GuestRow[];
  pendingGuestCount: number;
  pendingMessageCount: number;
  tasks: TaskRow[];
  vendors: VendorRow[];
  weddingProfile: Partial<WeddingProfile> | null;
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
    throw new Error("Dashboard insight did not return valid JSON.");
  }

  return JSON.parse(trimmed.slice(start, end + 1)) as Partial<DashboardInsight>;
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "₹0";
  }

  return new Intl.NumberFormat("en-IN", {
    currency: "INR",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "your wedding date";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getCategoryAllocatedBudget(vendors: VendorRow[]) {
  const budgets = new Map<string, number>();

  for (const vendor of vendors) {
    const category = vendor.category.trim();

    if (!category) {
      continue;
    }

    budgets.set(category, Math.max(budgets.get(category) ?? 0, vendor.budget_allocated ?? 0));
  }

  return [...budgets.values()].reduce((sum, value) => sum + value, 0);
}

function isTaskOverdue(task: TaskRow) {
  if (task.status === "completed" || !task.due_date) {
    return false;
  }

  const dueDate = new Date(`${task.due_date}T00:00:00`);

  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return dueDate.getTime() < today.getTime();
}

function buildFallbackInsight(body: DashboardInsightBody): DashboardInsight {
  const profile = body.weddingProfile ?? {};
  const overdueTasks = body.tasks.filter((task) => isTaskOverdue(task));
  const allocatedBudget = getCategoryAllocatedBudget(body.vendors);
  const totalBudget = profile.budget ?? 0;
  const remainingBudget = totalBudget - allocatedBudget;

  if (!body.tasks.length) {
    return {
      action: "Build your planning timeline",
      action_type: "opportunity",
      category: "timeline",
      data_points: [
        "0 tasks in your current plan",
        `${body.vendors.length} vendor rows already tracked`,
        `${body.pendingGuestCount} guests still pending`,
      ],
      headline: "Your plan needs one clear starting structure",
      insight:
        "Your wedding data is already starting to gather, but there is no task structure turning it into a usable plan yet. Building the timeline now will connect vendors, budget, and guest follow-ups into one working rhythm.",
    };
  }

  if (overdueTasks.length > 0) {
    return {
      action: "Clear the overdue timeline items",
      action_type: "urgent",
      category: "timeline",
      data_points: [
        `${overdueTasks.length} overdue tasks`,
        `${body.pendingMessageCount} pending communication drafts`,
        `${body.pendingGuestCount} pending guest RSVPs`,
      ],
      headline: "Timeline drift is starting to create pressure",
      insight:
        "A few overdue tasks can look manageable on their own, but together they start affecting vendor responses, guest communication, and booking confidence. Resolving the late items now will calm several other moving parts at once.",
    };
  }

  if (remainingBudget < 0) {
    return {
      action: "Rebalance your highest allocations",
      action_type: "urgent",
      category: "budget",
      data_points: [
        `${formatCurrency(Math.abs(remainingBudget))} over budget`,
        `${body.vendors.length} vendor rows tracked`,
        `${formatCurrency(totalBudget)} total wedding budget`,
      ],
      headline: "Your budget pressure is now visible across categories",
      insight:
        "Individually the allocations may feel reasonable, but together they now exceed the total wedding budget. Tightening the biggest categories today will protect later decisions from being made under pressure.",
    };
  }

  return {
    action: "Use today to lock your next important decision",
    action_type: "opportunity",
    category: body.vendors.length ? "vendor" : "guests",
    data_points: [
      `${body.tasks.filter((task) => task.status === "completed").length} tasks completed`,
      `${body.pendingGuestCount} guests pending`,
      `${formatDate(profile.wedding_date)} wedding date`,
    ],
    headline: "You have a clean window to get ahead",
    insight:
      "Your plan is stable enough that one decisive move today can improve several areas together. Acting while the pressure is still manageable will keep the rest of the wedding easier to steer.",
  };
}

function normalizeInsight(raw: Partial<DashboardInsight>, fallback: DashboardInsight): DashboardInsight {
  const category =
    raw.category === "vendor" ||
    raw.category === "timeline" ||
    raw.category === "budget" ||
    raw.category === "guests"
      ? raw.category
      : fallback.category;

  const actionType =
    raw.action_type === "urgent" || raw.action_type === "opportunity"
      ? raw.action_type
      : fallback.action_type;

  const dataPoints = Array.isArray(raw.data_points)
    ? raw.data_points.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  return {
    action: raw.action?.trim() || fallback.action,
    action_type: actionType,
    category,
    data_points: [...dataPoints.slice(0, 3), ...fallback.data_points].slice(0, 3),
    headline: raw.headline?.trim() || fallback.headline,
    insight: raw.insight?.trim() || fallback.insight,
  };
}

export async function POST(request: Request) {
  let body: DashboardInsightBody;

  try {
    body = (await request.json()) as DashboardInsightBody;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  if (!body.weddingProfile) {
    return new Response("Wedding profile is required.", { status: 400 });
  }

  const fallback = buildFallbackInsight(body);
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return Response.json({ insight: fallback });
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      messages: [
        {
          content:
            "You are Wedly's AI Orchestrator. Analyse ALL the wedding data provided and find the single most important cross-connected insight that the couple needs to know today. Look for connections across tasks, vendors, guests and budget that individually seem fine but together reveal a risk or opportunity. Do not just summarise each category separately. Find the one thing that only becomes visible when you connect the dots. Return a JSON object with exactly these fields: headline: one punchy sentence stating the risk or opportunity — max 12 words; insight: 2-3 sentences explaining the connection between different data points — be specific, use actual numbers, vendor names, dates from the data provided; action: one specific thing they should do today — start with a verb; action_type: urgent or opportunity; data_points: array of 3 strings — each one a specific number or fact from the data that feeds into this insight; category: which area this primarily affects — vendor or timeline or budget or guests.",
          role: "system",
        },
        {
          content: JSON.stringify(body),
          role: "user",
        },
      ],
      model: "gpt-4o",
      temperature: 0.35,
    });

    const rawContent = completion.choices[0]?.message?.content;

    if (!rawContent) {
      return Response.json({ insight: fallback });
    }

    const parsed = extractJsonObject(rawContent);
    return Response.json({ insight: normalizeInsight(parsed, fallback) });
  } catch {
    return Response.json({ insight: fallback });
  }
}
