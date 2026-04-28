import OpenAI from "openai";

import type { Database, WeddingProfile } from "@/lib/supabase/types";

export const runtime = "nodejs";

type TaskRow = Database["public"]["Tables"]["tasks"]["Row"] & {
  created_at?: string | null;
  updated_at?: string | null;
};

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
  created_at?: string | null;
  email?: string | null;
  id: string;
  is_ai_suggested: boolean;
  notes: string | null;
  phone?: string | null;
  status: VendorStatus;
  updated_at?: string | null;
  user_id: string;
  vendor_name?: string | null;
};

type GuestRow = {
  created_at?: string | null;
  id: string;
  name: string;
  phone?: string | null;
  rsvp_status: "Confirmed" | "Pending" | "Declined";
  side: "Bride's side" | "Groom's side";
  updated_at?: string | null;
  user_id: string;
};

type DailyQuote = {
  author: string;
  text: string;
};

type DailyTask = {
  reason: string;
  title: string;
};

type DashboardDaily = {
  agent_screen: "vendors" | "timeline" | "comms" | "budget";
  agent_update: string | null;
  daily_quote: DailyQuote;
  most_important_task: DailyTask | null;
};

type DashboardDailyBody = {
  dateSeed: string;
  guests: GuestRow[];
  pendingMessageCount: number;
  tasks: TaskRow[];
  vendors: VendorRow[];
  weddingProfile: Partial<WeddingProfile>;
};

const quotes: DailyQuote[] = [
  {
    author: "Dave Meurer",
    text: "A great marriage is not when the perfect couple comes together, but when an imperfect couple learns to enjoy their differences.",
  },
  {
    author: "Audrey Hepburn",
    text: "The best thing to hold onto in life is each other.",
  },
  {
    author: "Mignon McLaughlin",
    text: "A successful marriage requires falling in love many times, always with the same person.",
  },
  {
    author: "Emily Brontë",
    text: "Whatever our souls are made of, his and mine are the same.",
  },
  {
    author: "Maya Angelou",
    text: "In all the world, there is no heart for me like yours.",
  },
  {
    author: "Roy Croft",
    text: "I love you not only for what you are, but for what I am when I am with you.",
  },
  {
    author: "David Viscott",
    text: "To love and be loved is to feel the sun from both sides.",
  },
  {
    author: "Anonymous",
    text: "Love is not about how many days, months or years you have been together. It's all about how much you love each other every day.",
  },
];

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
    throw new Error("Dashboard daily route did not return valid JSON.");
  }

  return JSON.parse(trimmed.slice(start, end + 1)) as Partial<DashboardDaily>;
}

function getSeedNumber(seed: string) {
  return seed.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0);
}

function getSeededQuote(seed: string) {
  return quotes[getSeedNumber(seed) % quotes.length];
}

function getPriorityRank(priority: string | null | undefined) {
  switch ((priority ?? "").toLowerCase()) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    default:
      return 3;
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "soon";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "soon";
  }

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

function getMostImportantTask(tasks: TaskRow[]) {
  const nextTask = tasks
    .filter((task) => task.status !== "completed")
    .sort((first, second) => {
      const priorityDiff =
        getPriorityRank(first.priority) - getPriorityRank(second.priority);

      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const firstDue = first.due_date ?? "9999-12-31";
      const secondDue = second.due_date ?? "9999-12-31";
      return firstDue.localeCompare(secondDue);
    })[0];

  if (!nextTask) {
    return null;
  }

  return {
    reason: nextTask.due_date
      ? `It is the nearest unfinished ${nextTask.priority} priority task, due ${formatDate(nextTask.due_date)}.`
      : `It is the clearest unfinished ${nextTask.priority} priority task in your plan right now.`,
    title: nextTask.title,
  } satisfies DailyTask;
}

function buildFallbackAgentUpdate(body: DashboardDailyBody) {
  const overdueTasks = body.tasks.filter((task) => isTaskOverdue(task));
  const bookedVendors = body.vendors.filter((vendor) => vendor.status === "booked").length;
  const pendingGuests = body.guests.filter(
    (guest) => guest.rsvp_status === "Pending",
  ).length;

  if (body.pendingMessageCount > 0) {
    return {
      screen: "comms" as const,
      text: `You have ${body.pendingMessageCount} message${body.pendingMessageCount === 1 ? "" : "s"} waiting for approval, and clearing them could unlock replies today.`,
    };
  }

  if (overdueTasks.length > 0) {
    return {
      screen: "timeline" as const,
      text: `${overdueTasks[0].title} is already overdue, and that quiet delay is the clearest pressure point in your plan right now.`,
    };
  }

  if (bookedVendors === 0 && body.vendors.length > 0) {
    return {
      screen: "vendors" as const,
      text: `No vendors are booked yet, so your next vendor decision could shift the whole wedding from thinking into movement.`,
    };
  }

  if (pendingGuests > 0) {
    return {
      screen: "comms" as const,
      text: `${pendingGuests} guest${pendingGuests === 1 ? "" : "s"} still have not responded, so this is a good day to nudge the silence gently.`,
    };
  }

  return {
    screen: "timeline" as const,
    text: null,
  };
}

function normalizeDaily(
  raw: Partial<DashboardDaily>,
  fallback: DashboardDaily,
) {
  const nextQuote =
    raw.daily_quote &&
    typeof raw.daily_quote === "object" &&
    typeof raw.daily_quote.text === "string" &&
    typeof raw.daily_quote.author === "string"
      ? {
          author: raw.daily_quote.author.trim() || fallback.daily_quote.author,
          text: raw.daily_quote.text.trim() || fallback.daily_quote.text,
        }
      : fallback.daily_quote;

  const nextTask =
    raw.most_important_task === null
      ? null
      : raw.most_important_task &&
          typeof raw.most_important_task === "object" &&
          typeof raw.most_important_task.title === "string" &&
          typeof raw.most_important_task.reason === "string"
        ? {
            reason:
              raw.most_important_task.reason.trim() ||
              fallback.most_important_task?.reason ||
              "",
            title:
              raw.most_important_task.title.trim() ||
              fallback.most_important_task?.title ||
              "",
          }
        : fallback.most_important_task;

  const nextScreen =
    raw.agent_screen === "vendors" ||
    raw.agent_screen === "timeline" ||
    raw.agent_screen === "comms" ||
    raw.agent_screen === "budget"
      ? raw.agent_screen
      : fallback.agent_screen;

  return {
    agent_screen: nextScreen,
    agent_update:
      raw.agent_update === null
        ? null
        : raw.agent_update?.trim() || fallback.agent_update,
    daily_quote: nextQuote,
    most_important_task: nextTask,
  } satisfies DashboardDaily;
}

export async function POST(request: Request) {
  let body: DashboardDailyBody;

  try {
    body = (await request.json()) as DashboardDailyBody;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  const fallbackNotice = buildFallbackAgentUpdate(body);
  const fallback = {
    agent_screen: fallbackNotice.screen,
    agent_update: fallbackNotice.text,
    daily_quote: getSeededQuote(body.dateSeed),
    most_important_task: getMostImportantTask(body.tasks),
  } satisfies DashboardDaily;

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return Response.json(fallback);
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      messages: [
        {
          content:
            "You are Wedly, a deeply personal AI wedding orchestrator. Read the wedding data carefully and return JSON with exactly these fields:\n" +
            "daily_quote: object with text and author\n" +
            "agent_update: one warm specific sentence about most important thing noticed today — or null if nothing urgent\n" +
            "most_important_task: object with title and reason — the single most important pending task\n" +
            "agent_screen: which screen to navigate to — vendors, timeline, comms, or budget\n" +
            "Be specific to the actual data. Do not invent vendors or tasks that are not present.",
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

    return Response.json(normalizeDaily(parsed, fallback));
  } catch {
    return Response.json(fallback);
  }
}
