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

type DraftMessage = {
  channel: "WhatsApp" | "Email";
  id: string;
  message: string;
  recipient: string;
  recipientType: "vendor" | "family" | "partner";
  reason: string;
  subject: string | null;
  urgency: "high" | "medium" | "low";
};

type CommsStatus = "pending" | "sent" | "dismissed";

type MessageHistoryEntry = {
  channel: "WhatsApp" | "Email";
  message: string;
  recipient: string;
  recipientType: "vendor" | "family" | "partner";
  reason: string;
  sentAt: string | null;
  status: CommsStatus;
  subject: string | null;
  urgency: "high" | "medium" | "low";
};

type CommsGenerateRequest = {
  messageHistory?: MessageHistoryEntry[];
  pendingGuestCount: number;
  urgentTasks: TaskRow[];
  vendors: VendorRow[];
  weddingProfile: Partial<WeddingProfile> | null;
};

const REMINDER_COOLDOWN_MS = 2 * 60 * 1000;

function extractJsonArray(content: string) {
  const trimmed = content.trim();

  if (trimmed.startsWith("```")) {
    const withoutFence = trimmed
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();

    return extractJsonArray(withoutFence);
  }

  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse communication drafts from OpenAI.");
  }

  return trimmed.slice(start, end + 1);
}

function parseDrafts(content: string) {
  const rawArray = extractJsonArray(content);
  return JSON.parse(rawArray) as Array<Partial<DraftMessage>>;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function buildSimilarityKey(draft: {
  message?: string | null;
  reason?: string | null;
  recipient?: string | null;
  recipientType?: string | null;
  subject?: string | null;
}) {
  return [
    normalizeText(draft.recipient),
    normalizeText(draft.recipientType),
    normalizeText(draft.reason),
    normalizeText(draft.subject),
  ].join("|");
}

function isDraftBlockedByHistory(
  draft: DraftMessage,
  history: MessageHistoryEntry[],
  now: number,
) {
  const draftKey = buildSimilarityKey(draft);

  return history.some((item) => {
    const historyKey = buildSimilarityKey(item);

    if (draftKey !== historyKey) {
      return false;
    }

    if (item.status === "dismissed") {
      return true;
    }

    if (item.status === "sent" && item.sentAt) {
      const sentAt = new Date(item.sentAt).getTime();

      if (!Number.isNaN(sentAt) && now - sentAt < REMINDER_COOLDOWN_MS) {
        return true;
      }
    }

    return false;
  });
}

function dedupeDrafts(
  drafts: DraftMessage[],
  history: MessageHistoryEntry[],
) {
  const now = Date.now();
  const seenKeys = new Set<string>();

  return drafts.filter((draft) => {
    const key = buildSimilarityKey(draft);

    if (!key || seenKeys.has(key) || isDraftBlockedByHistory(draft, history, now)) {
      return false;
    }

    seenKeys.add(key);
    return true;
  });
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) {
    return "the wedding date";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getVendorRecipient(vendor: VendorRow | undefined) {
  if (!vendor) {
    return "Vendor partner";
  }

  return (
    vendor.vendor_name?.trim() ||
    vendor.contact_name?.trim() ||
    `${vendor.category} vendor`
  );
}

function buildFallbackDrafts(body: CommsGenerateRequest): DraftMessage[] {
  const weddingDate = formatDateLabel(body.weddingProfile?.wedding_date);
  const city = body.weddingProfile?.city ?? "your wedding city";
  const partnerName = body.weddingProfile?.partner1_name ?? "there";
  const firstTask = body.urgentTasks[0];
  const secondTask = body.urgentTasks[1];
  const firstVendor = body.vendors[0];
  const secondVendor = body.vendors[1];
  const pendingGuests = body.pendingGuestCount;

  const fallbacks: DraftMessage[] = [
    {
      channel: "WhatsApp",
      id: "msg-1",
      message: firstVendor
        ? `Hi ${getVendorRecipient(firstVendor)}, we are reviewing our ${firstVendor.category.toLowerCase()} plans for the wedding on ${weddingDate} in ${city}. Could you please confirm your current availability and next steps from your side this week?`
        : `Hi ${partnerName}, let's review the most time-sensitive wedding work for ${weddingDate} in ${city} and decide what needs to move first this week.`,
      recipient: getVendorRecipient(firstVendor),
      recipientType: firstVendor ? "vendor" : "partner",
      reason: firstVendor
        ? `This keeps the ${firstVendor.category.toLowerCase()} booking moving with a real vendor already in your plan.`
        : "Your current plan needs a clear partner-level decision on what to handle first.",
      subject: null,
      urgency: "high",
    },
    {
      channel: "Email",
      id: "msg-2",
      message: firstTask
        ? `Hello, we are tracking the task "${firstTask.title}" which is due by ${formatDateLabel(firstTask.due_date)} for our wedding on ${weddingDate}. Please let us know any information or availability we need from your side to keep this moving on time.`
        : `Hi ${partnerName}, I want to align on the next planning decisions for the wedding on ${weddingDate} in ${city}. Can we review what needs attention this week and lock owners for each item?`,
      recipient: firstTask ? "Relevant stakeholder" : partnerName,
      recipientType: firstTask ? "family" : "partner",
      reason: firstTask
        ? `An actual pending task in your timeline is due soon: ${firstTask.title}.`
        : "This helps turn the current plan into concrete next steps.",
      subject: firstTask ? `Follow-up on ${firstTask.title}` : "This week's wedding planning priorities",
      urgency: "medium",
    },
    {
      channel: "WhatsApp",
      id: "msg-3",
      message:
        pendingGuests > 0
          ? `Hi everyone, a few RSVPs are still pending for our wedding on ${weddingDate}. If you haven't replied yet, please send your response this week so we can finalise numbers calmly.`
          : `Hi family, we are tightening the guest planning side for the wedding on ${weddingDate}. Please share any final updates we should keep in mind so we can keep things organised.`,
      recipient: "Family group",
      recipientType: "family",
      reason:
        pendingGuests > 0
          ? `${pendingGuests} guests are still marked as pending in your real guest list.`
          : "A family-side update keeps communication aligned while the plan evolves.",
      subject: null,
      urgency: pendingGuests > 10 ? "high" : "medium",
    },
    {
      channel: "WhatsApp",
      id: "msg-4",
      message: secondVendor
        ? `Hi ${getVendorRecipient(secondVendor)}, we are reviewing our ${secondVendor.category.toLowerCase()} planning for the wedding on ${weddingDate}. Could you share your latest availability, package guidance, and any details we should decide next?`
        : secondTask
          ? `Hi ${partnerName}, the task "${secondTask.title}" is coming up by ${formatDateLabel(secondTask.due_date)}. Let's close what needs to be decided so it doesn't slip.`
          : `Hi ${partnerName}, I'd like to keep our vendor and family communication proactive for the wedding on ${weddingDate}. Can we decide the next two messages to send today?`,
      recipient: secondVendor ? getVendorRecipient(secondVendor) : partnerName,
      recipientType: secondVendor ? "vendor" : "partner",
      reason: secondVendor
        ? `This follows up on a real vendor category already in your vendor plan: ${secondVendor.category}.`
        : secondTask
          ? `This message is tied to a real due-soon task: ${secondTask.title}.`
          : "A partner-level message helps keep current priorities moving.",
      subject: secondVendor ? null : null,
      urgency: secondVendor || secondTask ? "medium" : "low",
    },
  ];

  return fallbacks;
}

function normalizeDraft(
  item: Partial<DraftMessage> | undefined,
  index: number,
  fallback: DraftMessage,
): DraftMessage {
  const channel =
    item?.channel === "Email" || item?.channel === "WhatsApp"
      ? item.channel
      : fallback.channel;
  const recipientType =
    item?.recipientType === "vendor" ||
    item?.recipientType === "family" ||
    item?.recipientType === "partner"
      ? item.recipientType
      : fallback.recipientType;
  const urgency =
    item?.urgency === "high" || item?.urgency === "low" || item?.urgency === "medium"
      ? item.urgency
      : fallback.urgency;

  return {
    channel,
    id: item?.id?.trim() || fallback.id || `msg-${index + 1}`,
    message: item?.message?.trim() || fallback.message,
    recipient: item?.recipient?.trim() || fallback.recipient,
    recipientType,
    reason: item?.reason?.trim() || fallback.reason,
    subject:
      channel === "Email"
        ? item?.subject?.trim() || fallback.subject || "Wedding planning update"
        : null,
    urgency,
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY.", { status: 500 });
  }

  let body: CommsGenerateRequest;

  try {
    body = (await request.json()) as CommsGenerateRequest;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  if (!body.weddingProfile) {
    return new Response("Wedding profile is required.", { status: 400 });
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      messages: [
        {
          content:
            "You are Wedly's Communication Agent for a wedding planning app. Based only on the real wedding data provided, generate up to 4 draft messages that genuinely need to be sent now. Do not make up information. Use only actual tasks, vendors, guest counts, dates, and wedding details from the payload. Respect message history: do not recreate anything previously dismissed, and do not send another reminder for the same recipient/topic if a similar message was already sent in the last 2 minutes. If nothing needs to be sent, return an empty JSON array. Mix recipients between vendors and family/couple when relevant. Return only valid JSON array objects with these fields: id, recipient, recipientType, channel, subject, message, urgency, reason.",
          role: "system",
        },
        {
          content: JSON.stringify(body),
          role: "user",
        },
      ],
      model: "gpt-4o",
      temperature: 0.4,
    });

    const rawContent = completion.choices[0]?.message?.content;

    if (!rawContent) {
      throw new Error("OpenAI returned an empty response.");
    }

    const parsedDrafts = parseDrafts(rawContent);
    const fallbackDrafts = buildFallbackDrafts(body);
    const normalizedDrafts = Array.from(
      { length: Math.min(4, Math.max(parsedDrafts.length, fallbackDrafts.length)) },
      (_, index) =>
      normalizeDraft(parsedDrafts[index], index, fallbackDrafts[index]),
    );
    const filteredDrafts = dedupeDrafts(
      normalizedDrafts,
      body.messageHistory ?? [],
    );

    return Response.json({ drafts: filteredDrafts });
  } catch (error) {
    return new Response(
      error instanceof Error
        ? error.message
        : "Could not generate messages. Try again.",
      { status: 500 },
    );
  }
}
