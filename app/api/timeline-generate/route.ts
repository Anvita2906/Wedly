import OpenAI from "openai";

import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database, TimelineTask, WeddingProfile } from "@/lib/supabase/types";

export const runtime = "nodejs";

type TimelineGenerateBody = Pick<
  WeddingProfile,
  "partner1_name" | "wedding_date" | "city" | "budget" | "guest_count" | "wedding_type"
> & {
  plan_start_date?: string | null;
};

const phaseNameById: Record<string, string> = {
  foundation: "Foundation",
  "vendor-locking": "Vendor Locking",
  communication: "Communication",
  detailing: "Detailing",
  "final-sprint": "Final Sprint",
};

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function getUserCreatedDateString(value: string | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function clampDueDateToPlanStart(dueDate: string | null, planStartDate: string) {
  if (!dueDate) {
    return planStartDate;
  }

  return dueDate < planStartDate ? planStartDate : dueDate;
}

function extractJsonArray(content: string) {
  const trimmed = content.trim();

  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as Array<Partial<TimelineTask>>;
  }

  const startIndex = trimmed.indexOf("[");
  const endIndex = trimmed.lastIndexOf("]");

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("Timeline generation did not return valid JSON.");
  }

  return JSON.parse(trimmed.slice(startIndex, endIndex + 1)) as Array<
    Partial<TimelineTask>
  >;
}

function normalizeTask(task: Partial<TimelineTask>, index: number): TimelineTask {
  const phaseId =
    task.phase_id && task.phase_id in phaseNameById ? task.phase_id : "foundation";
  const priority =
    task.priority === "high" || task.priority === "low" ? task.priority : "medium";

  return {
    description: task.description?.trim() || "Wedding planning task.",
    due_date: task.due_date?.trim() || null,
    is_user_added: false,
    phase_id: phaseId,
    phase_name: task.phase_name?.trim() || phaseNameById[phaseId],
    priority,
    status: "pending",
    title: task.title?.trim() || `Planning task ${index + 1}`,
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY.", { status: 500 });
  }

  let body: TimelineGenerateBody;

  try {
    body = (await request.json()) as TimelineGenerateBody;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  const supabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return new Response(userError.message, { status: 500 });
  }

  if (!user) {
    return new Response("Unauthorized.", { status: 401 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", user.id)
    .overrideTypes<Database["public"]["Tables"]["tasks"]["Row"][], { merge: false }>();

  if (existingError) {
    return new Response(existingError.message, { status: 500 });
  }

  if (existing && existing.length > 0) {
    return Response.json(existing);
  }

  const client = new OpenAI({ apiKey });
  const today = getTodayDateString();
  const userCreatedDate = getUserCreatedDateString(user.created_at);
  const planStartDate =
    body.plan_start_date && body.plan_start_date > (userCreatedDate ?? "")
      ? body.plan_start_date
      : userCreatedDate || today;

  try {
    const completion = await client.chat.completions.create({
      messages: [
        {
          content:
            `You are a professional wedding planner. Based on the wedding details provided generate a complete personalised wedding planning task list. Organise tasks into exactly 5 phases: Foundation, Vendor Locking, Communication, Detailing, Final Sprint. Generate 5-7 tasks per phase and make them specific to the wedding type, city, guest count and budget. For each task calculate a realistic due_date working backwards from the wedding date and keep it inside the correct phase window. Foundation tasks should be due 12-14 months before the wedding, Vendor Locking 9-12 months before, Communication 6-9 months before, Detailing 3-6 months before, and Final Sprint 1-3 months before. Tasks can share the same due_date when that is realistic. Today's date is ${today}. The user's planning timeline must not start before ${planStartDate}, which is when they began using Wedly. Never generate a due_date earlier than ${planStartDate}. If a task's calculated due date falls before ${planStartDate}, move it to ${planStartDate} or a near future date instead. Return a JSON array of task objects. Each object must have exactly these fields: phase_id (foundation/vendor-locking/communication/detailing/final-sprint), phase_name (full name), title, description (one sentence), priority (high/medium/low), due_date (YYYY-MM-DD format). Return only valid JSON array, no other text.`,
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
      throw new Error("OpenAI returned an empty task list.");
    }

    const parsedTasks = extractJsonArray(rawContent);
    const normalizedTasks = parsedTasks.map((task, index) => {
      const normalizedTask = normalizeTask(task, index);

      return {
        ...normalizedTask,
        due_date: clampDueDateToPlanStart(normalizedTask.due_date, planStartDate),
      };
    });

    const insertPayload: Array<Database["public"]["Tables"]["tasks"]["Insert"]> =
      normalizedTasks.map((task) => ({
        ...task,
        user_id: user.id,
      }));

    const { data, error } = await supabase
      .from("tasks")
      .insert(insertPayload as never)
      .select("*")
      .overrideTypes<Database["public"]["Tables"]["tasks"]["Row"][], { merge: false }>();

    if (error) {
      return new Response(error.message, { status: 500 });
    }

    return Response.json(data ?? []);
  } catch (error) {
    return new Response(
      error instanceof Error
        ? error.message
        : "Unable to generate your planning timeline.",
      { status: 500 },
    );
  }
}
