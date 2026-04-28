import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import type { Database, WeddingProfile } from "@/lib/supabase/types";

export const runtime = "nodejs";

type OrchestratorMessage = {
  content: string;
  role: "assistant" | "user";
};

type OrchestratorRequestBody = {
  messages?: OrchestratorMessage[];
  userId?: string;
  weddingProfile?: WeddingProfile | null;
};

type TaskToolRow = Database["public"]["Tables"]["tasks"]["Row"];

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

type ShoppingItemRow = {
  actual_cost?: number | null;
  category: string;
  estimated_cost: number | null;
  id: string;
  is_ai_suggested: boolean;
  status: "not_purchased" | "purchased";
  title: string;
  user_id: string;
};

type ExtendedDatabase = {
  public: {
    CompositeTypes: Database["public"]["CompositeTypes"];
    Enums: Database["public"]["Enums"];
    Functions: Database["public"]["Functions"];
    Tables: Database["public"]["Tables"] & {
      shopping_items: {
        Insert: Omit<ShoppingItemRow, "id">;
        Relationships: [];
        Row: ShoppingItemRow;
        Update: Partial<Omit<ShoppingItemRow, "id" | "user_id">>;
      };
      vendors: {
        Insert: Omit<VendorRow, "id">;
        Relationships: [];
        Row: VendorRow;
        Update: Partial<Omit<VendorRow, "id" | "user_id">>;
      };
    };
    Views: Database["public"]["Views"];
  };
};

type OrchestratorAction = {
  args: Record<string, unknown>;
  result: string;
  tool: string;
};

type ToolExecutionResult = {
  actionResult: string;
  modelResult: string;
};

const tools = [
  {
    function: {
      description:
        "Add a new task to the wedding timeline. Use when user asks to add, create or include a task.",
      name: "add_task",
      parameters: {
        properties: {
          due_date: {
            description:
              "Due date in YYYY-MM-DD format, calculate based on wedding date and phase",
            type: "string",
          },
          phase_id: {
            description: "Which phase this task belongs to",
            enum: [
              "foundation",
              "vendor-locking",
              "communication",
              "detailing",
              "final-sprint",
            ],
            type: "string",
          },
          phase_name: {
            description: "Human readable phase name",
            type: "string",
          },
          priority: {
            enum: ["high", "medium", "low"],
            type: "string",
          },
          title: {
            description: "Task title",
            type: "string",
          },
        },
        required: ["title", "phase_id", "phase_name", "priority", "due_date"],
        type: "object",
      },
    },
    type: "function",
  },
  {
    function: {
      description:
        "Mark a task as completed. Use when user says they completed, finished or done with a task.",
      name: "complete_task",
      parameters: {
        properties: {
          task_title: {
            description:
              'Title of the task to mark complete — will search by title',
            type: "string",
          },
        },
        required: ["task_title"],
        type: "object",
      },
    },
    type: "function",
  },
  {
    function: {
      description:
        "Delete a task from the timeline. Use when user asks to remove or delete a task.",
      name: "delete_task",
      parameters: {
        properties: {
          task_title: {
            description: 'Title of the task to delete',
            type: "string",
          },
        },
        required: ["task_title"],
        type: "object",
      },
    },
    type: "function",
  },
  {
    function: {
      description:
        "Add a new vendor to the vendor tracker. Use when user mentions a vendor they want to track.",
      name: "add_vendor",
      parameters: {
        properties: {
          budget_allocated: {
            description: "Budget allocated in INR if mentioned",
            type: "number",
          },
          category: {
            description: "Vendor category e.g. Photography, Catering",
            type: "string",
          },
          name: {
            description: "Vendor business name if mentioned",
            type: "string",
          },
          notes: {
            description: "Any notes about this vendor",
            type: "string",
          },
        },
        required: ["category"],
        type: "object",
      },
    },
    type: "function",
  },
  {
    function: {
      description:
        "Update a vendor status or amount paid. Use when user says they booked a vendor, paid a vendor or wants to update vendor details.",
      name: "update_vendor_status",
      parameters: {
        properties: {
          amount_paid: {
            description: "Amount paid in INR if mentioned",
            type: "number",
          },
          category: {
            description: "Vendor category to update",
            type: "string",
          },
          status: {
            enum: [
              "not_started",
              "researching",
              "shortlisted",
              "booked",
              "cancelled",
            ],
            type: "string",
          },
        },
        required: ["category"],
        type: "object",
      },
    },
    type: "function",
  },
  {
    function: {
      description:
        "Add an item to the shopping list. Use when user asks to add something to buy.",
      name: "add_shopping_item",
      parameters: {
        properties: {
          category: {
            description: "Shopping category e.g. Bridal, Accessories, Decor",
            type: "string",
          },
          estimated_cost: {
            description: "Estimated cost in INR if mentioned",
            type: "number",
          },
          title: {
            description: "Item name",
            type: "string",
          },
        },
        required: ["title", "category"],
        type: "object",
      },
    },
    type: "function",
  },
  {
    function: {
      description:
        "Get all overdue tasks. Use when user asks what is overdue, what they are behind on, or what needs urgent attention.",
      name: "get_overdue_tasks",
      parameters: { properties: {}, type: "object" },
    },
    type: "function",
  },
  {
    function: {
      description:
        "Get current budget summary. Use when user asks about budget, spending, or how much money is left.",
      name: "get_budget_summary",
      parameters: { properties: {}, type: "object" },
    },
    type: "function",
  },
  {
    function: {
      description:
        "Get all pending tasks for a specific phase or all phases. Use when user asks what tasks are left or what they need to do.",
      name: "get_pending_tasks",
      parameters: {
        properties: {
          phase_id: {
            description: "Optional phase filter",
            enum: [
              "foundation",
              "vendor-locking",
              "communication",
              "detailing",
              "final-sprint",
              "all",
            ],
            type: "string",
          },
        },
        type: "object",
      },
    },
    type: "function",
  },
] as const;

function buildSystemPrompt(profile: WeddingProfile | null) {
  return `You are Wedly, an AI wedding orchestrator. You have access to tools that let you take real actions in the app. When the user asks you to do something — add a task, update a vendor, mark something complete — USE THE TOOLS to actually do it, don't just talk about it. Always confirm what you did after taking action. The wedding details: partner1=${
    profile?.partner1_name ?? "Unknown"
  }, partner2=${profile?.partner2_name ?? "Unknown"}, wedding_date=${
    profile?.wedding_date ?? "Unknown"
  }, city=${profile?.city ?? "Unknown"}, budget=${
    profile?.budget ?? "Unknown"
  }, guest_count=${profile?.guest_count ?? "Unknown"}.`;
}

function getTodayDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric",
  }).format(new Date());
}

function parseArguments(input: string) {
  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    throw new Error("The AI returned invalid tool arguments.");
  }
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function executeToolCall(
  supabase: SupabaseClient<ExtendedDatabase>,
  userId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case "add_task": {
      const title = asString(args.title);
      const phaseId = asString(args.phase_id);
      const phaseName = asString(args.phase_name);
      const priority = asString(args.priority);
      const dueDate = asString(args.due_date);

      if (!title || !phaseId || !phaseName || !priority || !dueDate) {
        throw new Error("Missing task details for add_task.");
      }

      const { error } = await supabase
        .from("tasks")
        .insert({
          description: "Added via AI Orchestrator",
          due_date: dueDate,
          is_user_added: true,
          phase_id: phaseId,
          phase_name: phaseName,
          priority,
          status: "pending",
          title,
          user_id: userId,
        } as Database["public"]["Tables"]["tasks"]["Insert"])
        .select()
        .single();

      if (error) {
        throw error;
      }

      return {
        actionResult: `Task "${title}" added to ${phaseName} phase.`,
        modelResult: JSON.stringify({
          due_date: dueDate,
          phase_id: phaseId,
          phase_name: phaseName,
          priority,
          title,
        }),
      };
    }

    case "complete_task": {
      const taskTitle = asString(args.task_title);

      if (!taskTitle) {
        throw new Error("Task title is required to complete a task.");
      }

      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .ilike("title", `%${taskTitle}%`)
        .order("due_date", { ascending: true })
        .limit(1);

      if (error) {
        throw error;
      }

      const task = (data?.[0] as TaskToolRow | undefined) ?? null;

      if (!task) {
        return {
          actionResult: `Could not find task matching "${taskTitle}".`,
          modelResult: JSON.stringify({ found: false, task_title: taskTitle }),
        };
      }

      const { error: updateError } = await supabase
        .from("tasks")
        .update({ status: "completed" } as Database["public"]["Tables"]["tasks"]["Update"])
        .eq("id", task.id);

      if (updateError) {
        throw updateError;
      }

      return {
        actionResult: `Task "${task.title}" marked as completed.`,
        modelResult: JSON.stringify({ found: true, status: "completed", task }),
      };
    }

    case "delete_task": {
      const taskTitle = asString(args.task_title);

      if (!taskTitle) {
        throw new Error("Task title is required to delete a task.");
      }

      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .ilike("title", `%${taskTitle}%`)
        .order("due_date", { ascending: true })
        .limit(1);

      if (error) {
        throw error;
      }

      const task = (data?.[0] as TaskToolRow | undefined) ?? null;

      if (!task) {
        return {
          actionResult: `Could not find task matching "${taskTitle}".`,
          modelResult: JSON.stringify({ found: false, task_title: taskTitle }),
        };
      }

      const { error: deleteError } = await supabase.from("tasks").delete().eq("id", task.id);

      if (deleteError) {
        throw deleteError;
      }

      return {
        actionResult: `Task "${task.title}" deleted.`,
        modelResult: JSON.stringify({ deleted: true, task }),
      };
    }

    case "add_vendor": {
      const category = asString(args.category);
      const name = asString(args.name);
      const notes = asString(args.notes);
      const budgetAllocated = asNumber(args.budget_allocated) ?? 0;

      if (!category) {
        throw new Error("Vendor category is required.");
      }

      const { error } = await supabase.from("vendors" as never).insert(
        {
          amount_paid: null,
          budget_allocated: budgetAllocated,
          category,
          contact_name: null,
          email: null,
          is_ai_suggested: false,
          notes: notes || null,
          phone: null,
          status: "not_started",
          user_id: userId,
          vendor_name: name || "",
        } as never,
      );

      if (error) {
        throw error;
      }

      return {
        actionResult: `Vendor category "${category}" added to your vendor tracker.`,
        modelResult: JSON.stringify({
          budget_allocated: budgetAllocated,
          category,
          name,
          notes,
        }),
      };
    }

    case "update_vendor_status": {
      const category = asString(args.category);

      if (!category) {
        throw new Error("Vendor category is required to update a vendor.");
      }

      const { data, error } = await supabase
        .from("vendors" as never)
        .select("*")
        .eq("user_id", userId)
        .ilike("category", `%${category}%`)
        .order("category", { ascending: true })
        .limit(1);

      if (error) {
        throw error;
      }

      const vendor = (data?.[0] as VendorRow | undefined) ?? null;

      if (!vendor) {
        return {
          actionResult: `Could not find vendor category matching "${category}".`,
          modelResult: JSON.stringify({ category, found: false }),
        };
      }

      const updates: Partial<VendorRow> = {};
      const nextStatus = asString(args.status) as VendorStatus | "";
      const amountPaid = asNumber(args.amount_paid);

      if (nextStatus) {
        updates.status = nextStatus;
      }

      if (amountPaid !== null) {
        updates.amount_paid = amountPaid;
      }

      if (!Object.keys(updates).length) {
        return {
          actionResult: `No update values were provided for "${vendor.category}".`,
          modelResult: JSON.stringify({ found: true, updated: false, vendor }),
        };
      }

      const { error: updateError } = await supabase
        .from("vendors" as never)
        .update(updates as never)
        .eq("id", vendor.id);

      if (updateError) {
        throw updateError;
      }

      return {
        actionResult: `Vendor "${vendor.category}" updated.`,
        modelResult: JSON.stringify({ found: true, updates, vendor }),
      };
    }

    case "add_shopping_item": {
      const title = asString(args.title);
      const category = asString(args.category);
      const estimatedCost = asNumber(args.estimated_cost) ?? 0;

      if (!title || !category) {
        throw new Error("Title and category are required for a shopping item.");
      }

      const { error } = await supabase.from("shopping_items" as never).insert(
        {
          actual_cost: null,
          category,
          estimated_cost: estimatedCost,
          is_ai_suggested: false,
          status: "not_purchased",
          title,
          user_id: userId,
        } as never,
      );

      if (error) {
        throw error;
      }

      return {
        actionResult: `"${title}" added to your shopping list under ${category}.`,
        modelResult: JSON.stringify({
          category,
          estimated_cost: estimatedCost,
          title,
        }),
      };
    }

    case "get_overdue_tasks": {
      const today = getTodayDateString();
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "pending")
        .lt("due_date", today);

      if (error) {
        throw error;
      }

      const overdueTasks = (data ?? []) as TaskToolRow[];

      return {
        actionResult:
          overdueTasks.length === 0
            ? "No overdue tasks found."
            : `Found ${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"}.`,
        modelResult: JSON.stringify(overdueTasks),
      };
    }

    case "get_budget_summary": {
      const [vendorResult, shoppingResult] = await Promise.all([
        supabase
          .from("vendors" as never)
          .select("budget_allocated, amount_paid")
          .eq("user_id", userId),
        supabase
          .from("shopping_items" as never)
          .select("estimated_cost, actual_cost")
          .eq("user_id", userId),
      ]);

      if (vendorResult.error) {
        throw vendorResult.error;
      }

      if (shoppingResult.error) {
        throw shoppingResult.error;
      }

      const vendors = (vendorResult.data ?? []) as Array<{
        amount_paid?: number | null;
        budget_allocated?: number | null;
      }>;
      const shoppingItems = (shoppingResult.data ?? []) as Array<{
        actual_cost?: number | null;
        estimated_cost?: number | null;
      }>;

      const totalAllocated =
        vendors.reduce((sum, vendor) => sum + (vendor.budget_allocated ?? 0), 0) +
        shoppingItems.reduce((sum, item) => sum + (item.estimated_cost ?? 0), 0);
      const totalPaid =
        vendors.reduce((sum, vendor) => sum + (vendor.amount_paid ?? 0), 0) +
        shoppingItems.reduce((sum, item) => sum + (item.actual_cost ?? 0), 0);

      return {
        actionResult: `Budget summary ready: ₹${totalAllocated} allocated and ₹${totalPaid} paid so far.`,
        modelResult: JSON.stringify({ totalAllocated, totalPaid }),
      };
    }

    case "get_pending_tasks": {
      const phaseId = asString(args.phase_id);
      let query = supabase.from("tasks").select("*").eq("user_id", userId).eq("status", "pending");

      if (phaseId && phaseId !== "all") {
        query = query.eq("phase_id", phaseId);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      const pendingTasks = (data ?? []) as TaskToolRow[];

      return {
        actionResult:
          pendingTasks.length === 0
            ? "No pending tasks found for that scope."
            : `Found ${pendingTasks.length} pending task${pendingTasks.length === 1 ? "" : "s"}.`,
        modelResult: JSON.stringify(pendingTasks),
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY.", { status: 500 });
  }

  let body: OrchestratorRequestBody;

  try {
    body = (await request.json()) as OrchestratorRequestBody;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  const messages = (body.messages ?? []).filter(
    (message) =>
      message.content?.trim() &&
      (message.role === "user" || message.role === "assistant"),
  );

  if (messages.length === 0) {
    return new Response("Conversation history is required.", { status: 400 });
  }

  const supabase = (await createSupabaseClient()) as unknown as SupabaseClient<ExtendedDatabase>;
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

  if (body.userId && body.userId !== user.id) {
    return new Response("User mismatch.", { status: 403 });
  }

  const openai = new OpenAI({ apiKey });
  const systemPrompt = buildSystemPrompt(body.weddingProfile ?? null);
  const baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { content: systemPrompt, role: "system" },
    ...messages.map((message) => ({
      content: message.content,
      role: message.role,
    })),
  ];

  try {
    const firstResponse = await openai.chat.completions.create({
      messages: baseMessages,
      model: "gpt-4o",
      temperature: 0.4,
      tool_choice: "auto",
      tools,
    });

    const firstMessage = firstResponse.choices[0]?.message;
    const toolCalls = firstMessage?.tool_calls ?? [];

    if (!toolCalls.length) {
      return Response.json({
        actions: [] satisfies OrchestratorAction[],
        message:
          firstMessage?.content?.trim() ||
          "I’m here and ready to help with your wedding plan.",
      });
    }

    const actions: OrchestratorAction[] = [];
    const toolMessages: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = [];

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;

      try {
        const args = parseArguments(toolCall.function.arguments);
        const result = await executeToolCall(supabase, user.id, toolName, args);

        actions.push({
          args,
          result: result.actionResult,
          tool: toolName,
        });

        toolMessages.push({
          content: result.modelResult,
          role: "tool",
          tool_call_id: toolCall.id,
        });
      } catch (error) {
        const args = (() => {
          try {
            return parseArguments(toolCall.function.arguments);
          } catch {
            return {};
          }
        })();
        const failureMessage =
          error instanceof Error
            ? `Failed to execute ${toolName}: ${error.message}`
            : `Failed to execute ${toolName}.`;

        actions.push({
          args,
          result: failureMessage,
          tool: toolName,
        });

        toolMessages.push({
          content: JSON.stringify({ error: failureMessage }),
          role: "tool",
          tool_call_id: toolCall.id,
        });
      }
    }

    const secondResponse = await openai.chat.completions.create({
      messages: [
        ...baseMessages,
        {
          content: firstMessage?.content ?? "",
          role: "assistant",
          tool_calls: toolCalls,
        },
        ...toolMessages,
      ],
      model: "gpt-4o",
      temperature: 0.5,
    });

    return Response.json({
      actions,
      message:
        secondResponse.choices[0]?.message?.content?.trim() ||
        "Done. I’ve updated your plan.",
    });
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Unable to reach the orchestrator.",
      { status: 500 },
    );
  }
}
