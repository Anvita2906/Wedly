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

type DashboardBriefing = {
  greeting_line: string;
  health_color: "success" | "gold" | "warn" | "danger";
  health_label: "Excellent" | "On track" | "Needs attention" | "At risk";
  health_reason: string;
  health_score: number;
  personal_moment: string;
  this_week: Array<{
    due: string;
    title: string;
    type: "task" | "vendor" | "guest";
  }>;
  urgent_reason: string;
  urgent_screen: "vendors" | "timeline" | "budget" | "comms";
  urgent_thing: string;
};

type DashboardV2Body = {
  guests: GuestRow[];
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
    throw new Error("Dashboard briefing did not return valid JSON.");
  }

  return JSON.parse(trimmed.slice(start, end + 1)) as Partial<DashboardBriefing>;
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
    return "This week";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "This week";
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getDaysRemaining(weddingDate: string | null | undefined) {
  if (!weddingDate) {
    return null;
  }

  const eventDate = new Date(`${weddingDate}T00:00:00`);

  if (Number.isNaN(eventDate.getTime())) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.max(
    Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
    0,
  );
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

function isTaskDueSoon(task: TaskRow) {
  if (task.status === "completed" || !task.due_date) {
    return false;
  }

  const dueDate = new Date(`${task.due_date}T00:00:00`);

  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays =
    (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);

  return diffDays >= 0 && diffDays <= 7;
}

function getCategoryAllocatedBudget(vendors: VendorRow[]) {
  const budgets = new Map<string, number>();

  for (const vendor of vendors) {
    const category = vendor.category.trim();

    if (!category) {
      continue;
    }

    budgets.set(
      category,
      Math.max(budgets.get(category) ?? 0, vendor.budget_allocated ?? 0),
    );
  }

  return [...budgets.values()].reduce((sum, value) => sum + value, 0);
}

function getWeekdayLabel(weddingDate: string | null | undefined) {
  if (!weddingDate) {
    return null;
  }

  const date = new Date(`${weddingDate}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString("en-IN", { weekday: "long" });
}

function getMonthSeasonNote(weddingDate: string | null | undefined, city: string | null | undefined) {
  if (!weddingDate) {
    return null;
  }

  const date = new Date(`${weddingDate}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const month = date.getMonth();

  if (month === 10 || month === 11 || month === 0) {
    return city
      ? `${city} weddings around this season usually carry that beautiful festive glow people remember for years.`
      : "This wedding season usually brings that beautiful festive glow people remember for years.";
  }

  if (month >= 1 && month <= 3) {
    return city
      ? `${city} weddings around this time often feel especially fresh and vibrant, which makes details like flowers and colour feel alive.`
      : "This part of the wedding season often feels especially fresh and vibrant, which makes details like flowers and colour feel alive.";
  }

  if (month >= 4 && month <= 6) {
    return city
      ? `Planning a ${city} wedding in this stretch means comfort and guest flow matter even more than usual.`
      : "Planning a wedding in this stretch means comfort and guest flow matter even more than usual.";
  }

  return city
    ? `${city} weddings in this part of the year often reward couples who make the experience feel calm and welcoming.`
    : "This part of the year often rewards couples who make the experience feel calm and welcoming.";
}

function buildFallbackThisWeek(body: DashboardV2Body) {
  const dueSoonTasks = body.tasks
    .filter((task) => isTaskDueSoon(task))
    .sort((first, second) => {
      if (!first.due_date || !second.due_date) {
        return 0;
      }

      return first.due_date.localeCompare(second.due_date);
    })
    .map((task) => ({
      due: formatDate(task.due_date),
      title: task.title,
      type: "task" as const,
    }));

  const vendorMoves = body.vendors
    .filter(
      (vendor) =>
        vendor.status === "researching" ||
        vendor.status === "shortlisted" ||
        vendor.status === "not_started",
    )
    .slice(0, 2)
    .map((vendor) => ({
      due: "This week",
      title: `Move ${vendor.category} forward`,
      type: "vendor" as const,
    }));

  const guestMoves = body.guests
    .filter((guest) => guest.rsvp_status === "Pending")
    .slice(0, 1)
    .map(() => ({
      due: "This week",
      title: "Follow up on pending RSVPs",
      type: "guest" as const,
    }));

  return [...dueSoonTasks, ...vendorMoves, ...guestMoves].slice(0, 3);
}

function buildFallbackBriefing(body: DashboardV2Body): DashboardBriefing {
  const profile = body.weddingProfile ?? {};
  const partnerName = profile.partner1_name?.trim() || "there";
  const city = profile.city?.trim() || "your city";
  const weddingType = profile.wedding_type?.trim() || "wedding";
  const daysRemaining = getDaysRemaining(profile.wedding_date);
  const totalTasks = body.tasks.length;
  const completedTasks = body.tasks.filter((task) => task.status === "completed").length;
  const overdueTasks = body.tasks.filter((task) => isTaskOverdue(task));
  const bookedVendors = body.vendors.filter((vendor) => vendor.status === "booked").length;
  const vendorCategories = [...new Set(body.vendors.map((vendor) => vendor.category.trim()).filter(Boolean))];
  const allocatedBudget = getCategoryAllocatedBudget(body.vendors);
  const remainingBudget = (profile.budget ?? 0) - allocatedBudget;
  const pendingGuestCount = body.guests.filter((guest) => guest.rsvp_status === "Pending").length;
  const thisWeek = buildFallbackThisWeek(body);
  const taskScore = totalTasks > 0 ? (completedTasks / totalTasks) * 40 : 18;
  const vendorScore =
    vendorCategories.length > 0 ? (bookedVendors / vendorCategories.length) * 25 : 12;
  const timelineScore =
    overdueTasks.length > 0
      ? Math.max(0, 20 - overdueTasks.length * 4)
      : daysRemaining !== null && daysRemaining < 60 && completedTasks < Math.max(4, totalTasks / 3)
        ? 6
        : 18;
  const budgetScore =
    remainingBudget >= 0 ? 15 : Math.max(0, 15 - Math.ceil(Math.abs(remainingBudget) / 200000));

  const healthScore = Math.max(
    0,
    Math.min(100, Math.round(taskScore + vendorScore + timelineScore + budgetScore)),
  );

  let healthLabel: DashboardBriefing["health_label"] = "Needs attention";
  let healthColor: DashboardBriefing["health_color"] = "warn";

  if (healthScore >= 85) {
    healthLabel = "Excellent";
    healthColor = "success";
  } else if (healthScore >= 65) {
    healthLabel = "On track";
    healthColor = "gold";
  } else if (healthScore < 40) {
    healthLabel = "At risk";
    healthColor = "danger";
  }

  const nextUrgentTask = overdueTasks[0] ?? body.tasks.find((task) => isTaskDueSoon(task));
  const nextVendor = body.vendors.find((vendor) =>
    vendor.status === "researching" || vendor.status === "shortlisted" || vendor.status === "not_started",
  );

  const weekday = getWeekdayLabel(profile.wedding_date);
  const seasonNote = getMonthSeasonNote(profile.wedding_date, city);

  if (nextUrgentTask) {
    return {
      greeting_line:
        daysRemaining !== null
          ? `${partnerName}, with ${daysRemaining} days to go in ${city}, your plan wants one calm but clear move today.`
          : `${partnerName}, your ${weddingType} in ${city} already has a clear next step waiting for you.`,
      health_color: healthColor,
      health_label: healthLabel,
      health_reason:
        overdueTasks.length > 0
          ? `${overdueTasks.length} task${overdueTasks.length === 1 ? "" : "s"} ${overdueTasks.length === 1 ? "is" : "are"} already overdue, which is the clearest drag on momentum right now.`
          : `${completedTasks} of ${totalTasks} tasks are done, and the next few decisions now matter more than raw volume.`,
      health_score: healthScore,
      personal_moment:
        weekday && seasonNote
          ? `Your wedding falls on a ${weekday}. ${seasonNote}`
          : seasonNote ?? `There is something lovely about how this ${weddingType} is slowly turning into a lived story rather than a list.`,
      this_week: thisWeek,
      urgent_reason:
        overdueTasks.length > 0
          ? "Leaving late tasks untouched tends to make vendor decisions and guest communication feel heavier than they need to."
          : "Clearing the next visible task this week will keep your timeline feeling lighter and more trustworthy.",
      urgent_screen: "timeline",
      urgent_thing: `Finish ${nextUrgentTask.title} ${nextUrgentTask.due_date ? `by ${formatDate(nextUrgentTask.due_date)}` : "this week"}.`,
    };
  }

  if (remainingBudget < 0) {
    return {
      greeting_line: `${partnerName}, your ${city} wedding already has shape, but the numbers are asking for a gentler re-balance today.`,
      health_color: healthColor,
      health_label: healthLabel,
      health_reason: `You have ${formatCurrency(Math.abs(remainingBudget))} more allocated than your total budget allows right now.`,
      health_score: healthScore,
      personal_moment:
        weekday && seasonNote
          ? `Your wedding falls on a ${weekday}. ${seasonNote}`
          : seasonNote ?? `This is the stage where protecting ease matters just as much as protecting the spreadsheet.`,
      this_week: thisWeek,
      urgent_reason:
        "If you let the overspend sit too long, the later decisions will feel tighter and more reactive than they need to.",
      urgent_screen: "budget",
      urgent_thing: "Rebalance your biggest vendor allocations before you confirm anything else.",
    };
  }

  if (nextVendor) {
    return {
      greeting_line: `${partnerName}, your ${weddingType} in ${city} is ready for one confident vendor move this week.`,
      health_color: healthColor,
      health_label: healthLabel,
      health_reason: `${bookedVendors} vendor booking${bookedVendors === 1 ? "" : "s"} ${bookedVendors === 1 ? "is" : "are"} confirmed across ${vendorCategories.length || 0} categories so far.`,
      health_score: healthScore,
      personal_moment:
        weekday && seasonNote
          ? `Your wedding falls on a ${weekday}. ${seasonNote}`
          : seasonNote ?? `The nice thing about this stage is that one booking can suddenly make the whole wedding feel more real.`,
      this_week: thisWeek,
      urgent_reason:
        "One booking now will make the rest of the planning feel much steadier and less abstract.",
      urgent_screen: "vendors",
      urgent_thing: `Move your ${nextVendor.category} decision forward while the options still feel open.`,
    };
  }

  return {
    greeting_line:
      daysRemaining !== null
        ? `${partnerName}, with ${daysRemaining} days to go, your wedding story in ${city} is settling into a beautiful rhythm.`
        : `${partnerName}, your wedding story in ${city} is beginning to gather a lovely rhythm.`,
    health_color: healthColor,
    health_label: healthLabel,
    health_reason: `${completedTasks} of ${totalTasks} tasks are complete, and there is no single red flag pulling the plan off course today.`,
    health_score: healthScore,
    personal_moment:
      weekday && seasonNote
        ? `Your wedding falls on a ${weekday}. ${seasonNote}`
        : seasonNote ?? `Even quiet planning days matter, because they are usually the ones that help the whole celebration feel more intentional.`,
    this_week: thisWeek,
    urgent_reason:
      pendingGuestCount > 0 || body.pendingMessageCount > 0
        ? "A small communication move now will keep everyone around you aligned before things pile up."
        : "A calm, intentional check-in today will help the coming week feel much easier.",
    urgent_screen: body.pendingMessageCount > 0 || pendingGuestCount > 10 ? "comms" : "timeline",
    urgent_thing:
      body.pendingMessageCount > 0 || pendingGuestCount > 10
        ? "Review the messages Wedly has already drafted and send the ones that move the plan forward."
        : "Review this week’s planning thread and choose the next meaningful move.",
  };
}

function normalizeBriefing(
  raw: Partial<DashboardBriefing>,
  fallback: DashboardBriefing,
): DashboardBriefing {
  const healthColor =
    raw.health_color === "success" ||
    raw.health_color === "gold" ||
    raw.health_color === "warn" ||
    raw.health_color === "danger"
      ? raw.health_color
      : fallback.health_color;

  const healthLabel =
    raw.health_label === "Excellent" ||
    raw.health_label === "On track" ||
    raw.health_label === "Needs attention" ||
    raw.health_label === "At risk"
      ? raw.health_label
      : fallback.health_label;

  const urgentScreen =
    raw.urgent_screen === "vendors" ||
    raw.urgent_screen === "timeline" ||
    raw.urgent_screen === "budget" ||
    raw.urgent_screen === "comms"
      ? raw.urgent_screen
      : fallback.urgent_screen;

  const normalizedWeek =
    Array.isArray(raw.this_week) && raw.this_week.length > 0
      ? raw.this_week
          .filter(
            (item): item is DashboardBriefing["this_week"][number] =>
              Boolean(
                item &&
                  typeof item === "object" &&
                  typeof item.title === "string" &&
                  typeof item.due === "string" &&
                  (item.type === "task" || item.type === "vendor" || item.type === "guest"),
              ),
          )
          .slice(0, 3)
      : fallback.this_week;

  const nextScore = Number(raw.health_score);

  return {
    greeting_line: raw.greeting_line?.trim() || fallback.greeting_line,
    health_color: healthColor,
    health_label: healthLabel,
    health_reason: raw.health_reason?.trim() || fallback.health_reason,
    health_score:
      Number.isFinite(nextScore) && nextScore >= 0 && nextScore <= 100
        ? Math.round(nextScore)
        : fallback.health_score,
    personal_moment: raw.personal_moment?.trim() || fallback.personal_moment,
    this_week: normalizedWeek.length ? normalizedWeek : fallback.this_week,
    urgent_reason: raw.urgent_reason?.trim() || fallback.urgent_reason,
    urgent_screen: urgentScreen,
    urgent_thing: raw.urgent_thing?.trim() || fallback.urgent_thing,
  };
}

export async function POST(request: Request) {
  let body: DashboardV2Body;

  try {
    body = (await request.json()) as DashboardV2Body;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  if (!body.weddingProfile) {
    return new Response("Wedding profile is required.", { status: 400 });
  }

  const fallback = buildFallbackBriefing(body);
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return Response.json({ briefing: fallback });
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      messages: [
        {
          content:
            "You are Wedly, a deeply personal AI wedding orchestrator. You know this couple intimately through their data. Generate a personal dashboard briefing. Return a JSON object with exactly these fields:\n" +
            "greeting_line: A warm single sentence greeting using partner1_name. Reference something specific from their data — their city, wedding type, or a specific task or vendor situation. Feel like a friend, not an app. Max 20 words.\n" +
            "health_score: A number between 0 and 100 representing how on track their wedding planning is. Calculate based on: tasks completion rate, vendor booking progress, days remaining vs planning progress, budget health. Be honest — if they haven't done much, score should reflect that.\n" +
            "health_label: One of these exactly — 'Excellent', 'On track', 'Needs attention', 'At risk'\n" +
            "health_color: One of these exactly — 'success', 'gold', 'warn', 'danger'\n" +
            "health_reason: One specific sentence explaining the main factor driving this score. Use actual numbers from their data.\n" +
            "urgent_thing: The single most important thing they need to do right now. One sentence starting with a verb. Specific — mention actual vendor names, task names, dates.\n" +
            "urgent_reason: One sentence explaining why this specific thing matters today — what happens if they don't do it.\n" +
            "urgent_screen: Which screen to navigate to — vendors or timeline or budget or comms\n" +
            "this_week: Array of exactly 3 objects — tasks or actions due or important in the next 7 days. Each object has: title (task or action name), type (task or vendor or guest), due (formatted date string or 'This week')\n" +
            "personal_moment: A small delightful personal observation or fact specific to their wedding. Examples: a fun fact about their wedding city Jaipur, something about their wedding date like what day of the week it falls on, a milestone celebration if they completed tasks recently, a seasonal note about November weddings. Make it feel like a thoughtful friend noticed something special. Max 2 sentences.",
          role: "system",
        },
        {
          content: JSON.stringify(body),
          role: "user",
        },
      ],
      model: "gpt-4o",
      temperature: 0.8,
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const parsed = extractJsonObject(content);

    return Response.json({
      briefing: normalizeBriefing(parsed, fallback),
    });
  } catch {
    return Response.json({ briefing: fallback });
  }
}
