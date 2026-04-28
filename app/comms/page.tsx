"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  Mail,
  Pencil,
  Phone,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { getWeddingProfileForUser } from "@/lib/supabase/wedding-profile";
import type { Database, WeddingProfile } from "@/lib/supabase/types";
import { useWeddingStore } from "@/store/weddingStore";

type CommsTab = "pending" | "sent";
type CommsMode = "ai" | "manual";
type CommsStatus = "pending" | "sent" | "dismissed";
type RecipientType = "vendor" | "family" | "partner";
type Channel = "WhatsApp" | "Email" | "SMS";
type Urgency = "high" | "medium" | "low";
type ManualRelationship = "Vendor" | "Family" | "Friend" | "Co-partner" | "Other";
type ManualSendType = "single" | "bulk";
type BulkSource = "paste" | "guests";
type ContactKind = "email" | "phone" | "unknown";

type DraftMessage = {
  channel: Channel;
  id: string;
  message: string;
  recipient: string;
  recipientType: RecipientType;
  reason: string;
  subject: string | null;
  urgency: Urgency;
};

type SentMessage = DraftMessage & {
  sentAt: string;
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
  email?: string | null;
  id: string;
  is_ai_suggested: boolean;
  notes: string | null;
  phone?: string | null;
  status: VendorStatus;
  user_id: string;
  vendor_name?: string | null;
};

type GuestStatus = "Confirmed" | "Pending" | "Declined";

type GuestRow = {
  id: string;
  name: string;
  phone?: string | null;
  rsvp_status: GuestStatus;
  side: "Bride's side" | "Groom's side";
  user_id: string;
};

type CommsMessageRow = {
  channel: Channel;
  id: string;
  message: string;
  reason: string;
  recipient: string;
  recipient_type: RecipientType;
  sent_at?: string | null;
  status: CommsStatus;
  subject?: string | null;
  urgency: Urgency;
  user_id: string;
};

type MessageHistoryEntry = {
  channel: Channel;
  message: string;
  recipient: string;
  recipientType: RecipientType;
  reason: string;
  sentAt: string | null;
  status: CommsStatus;
  subject: string | null;
  urgency: Urgency;
};

type ExtendedDatabase = {
  public: {
    CompositeTypes: Database["public"]["CompositeTypes"];
    Enums: Database["public"]["Enums"];
    Functions: Database["public"]["Functions"];
    Tables: Database["public"]["Tables"] & {
      comms_messages: {
        Insert: Omit<CommsMessageRow, "id"> & { id?: string };
        Relationships: [];
        Row: CommsMessageRow;
        Update: Partial<Omit<CommsMessageRow, "id" | "user_id">>;
      };
      guests: {
        Insert: Omit<GuestRow, "id">;
        Relationships: [];
        Row: GuestRow;
        Update: Partial<Omit<GuestRow, "id" | "user_id">>;
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

type CommsResponse = {
  drafts: DraftMessage[];
};

type CommsGenerateRequestBody = {
  messageHistory: MessageHistoryEntry[];
  pendingGuestCount: number;
  urgentTasks: Database["public"]["Tables"]["tasks"]["Row"][];
  vendors: VendorRow[];
  weddingProfile: ReturnType<typeof buildRequestProfile>;
};

type CommsAssistResponse = {
  suggestion: string;
};

type DraftGenerationContext = {
  emptyStateMessage: string | null;
  pendingGuestCount: number;
  urgentTasks: Database["public"]["Tables"]["tasks"]["Row"][];
  vendors: VendorRow[];
};

type ManualRecipient = {
  contact: string;
  contactType: ContactKind;
  guestId?: string;
  id: string;
  name: string;
  relationship: ManualRelationship;
};

type ManualDelivery = {
  channel: Channel;
  contact: string;
  name: string;
  recipientType: RecipientType;
  relationship: ManualRelationship;
};

function getChannelStyles(channel: Channel) {
  if (channel === "Email") {
    return {
      background: "#EAF0F8",
      color: "#4A6FA5",
    };
  }

  if (channel === "SMS") {
    return {
      background: "#F2ECE5",
      color: "#7A7568",
    };
  }

  return {
    background: "#E6F3F1",
    color: "#2E7268",
  };
}

function getRecipientStyles(recipientType: RecipientType) {
  if (recipientType === "vendor") {
    return {
      background: "#F5EDDA",
      color: "#8B6B16",
    };
  }

  if (recipientType === "partner") {
    return {
      background: "#ECE7F8",
      color: "#6950A1",
    };
  }

  return {
    background: "#F1ECE4",
    color: "#6A6256",
  };
}

function getUrgencyColor(urgency: Urgency) {
  switch (urgency) {
    case "high":
      return "#C86A5A";
    case "medium":
      return "#C9A84C";
    case "low":
      return "#4D9A8F";
  }
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
}

function buildRequestProfile(profile: WeddingProfile) {
  return {
    budget: profile.budget,
    city: profile.city,
    guest_count: profile.guest_count,
    partner1_name: profile.partner1_name,
    partner2_name: profile.partner2_name,
    wedding_date: profile.wedding_date,
    wedding_type: profile.wedding_type,
  };
}

function mapRowToDraft(row: CommsMessageRow): DraftMessage {
  return {
    channel: row.channel,
    id: row.id,
    message: row.message,
    reason: row.reason,
    recipient: row.recipient,
    recipientType: row.recipient_type,
    subject: row.subject ?? null,
    urgency: row.urgency,
  };
}

function mapRowToSent(row: CommsMessageRow): SentMessage {
  return {
    ...mapRowToDraft(row),
    sentAt: row.sent_at ?? new Date().toISOString(),
  };
}

function mapRowToHistory(row: CommsMessageRow): MessageHistoryEntry {
  return {
    channel: row.channel,
    message: row.message,
    reason: row.reason,
    recipient: row.recipient,
    recipientType: row.recipient_type,
    sentAt: row.sent_at ?? null,
    status: row.status,
    subject: row.subject ?? null,
    urgency: row.urgency,
  };
}

function splitMessages(rows: CommsMessageRow[]) {
  const pending = rows
    .filter((row) => row.status === "pending")
    .map(mapRowToDraft);
  const sent = rows
    .filter((row) => row.status === "sent")
    .sort((first, second) => {
      const firstTime = new Date(first.sent_at ?? 0).getTime();
      const secondTime = new Date(second.sent_at ?? 0).getTime();
      return secondTime - firstTime;
    })
    .map(mapRowToSent);

  return { pending, sent };
}

function detectContactType(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "unknown" as const;
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "email" as const;
  }

  if (/^\+?[0-9()\-\s]{7,}$/.test(trimmed)) {
    return "phone" as const;
  }

  return "unknown" as const;
}

function mapRelationshipToRecipientType(relationship: ManualRelationship): RecipientType {
  if (relationship === "Vendor") {
    return "vendor";
  }

  if (relationship === "Co-partner") {
    return "partner";
  }

  return "family";
}

function buildRecipientLabel(recipient: ManualDelivery) {
  if (recipient.contact) {
    return `${recipient.name || recipient.contact} (${recipient.contact})`;
  }

  return recipient.name;
}

export default function CommunicationAgentPage() {
  const [browserSupabase] = useState(() => createClient());
  const supabase =
    browserSupabase as unknown as SupabaseClient<ExtendedDatabase>;

  const user = useWeddingStore((state) => state.user);
  const weddingProfile = useWeddingStore((state) => state.weddingProfile);
  const setIsOnboarded = useWeddingStore((state) => state.setIsOnboarded);
  const setUser = useWeddingStore((state) => state.setUser);
  const setWeddingProfile = useWeddingStore((state) => state.setWeddingProfile);

  const [mode, setMode] = useState<CommsMode>("ai");
  const [activeTab, setActiveTab] = useState<CommsTab>("pending");
  const [drafts, setDrafts] = useState<DraftMessage[]>([]);
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [emptyStateMessage, setEmptyStateMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generationContext, setGenerationContext] =
    useState<DraftGenerationContext | null>(null);
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(true);
  const [needsGenerationConfirmation, setNeedsGenerationConfirmation] =
    useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [transitioningIds, setTransitioningIds] = useState<string[]>([]);

  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [isLoadingGuests, setIsLoadingGuests] = useState(false);
  const [manualErrorMessage, setManualErrorMessage] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel>("Email");
  const [manualSubject, setManualSubject] = useState("");
  const [manualMessage, setManualMessage] = useState("");
  const [assistSuggestion, setAssistSuggestion] = useState<string | null>(null);
  const [isAssistLoading, setIsAssistLoading] = useState(false);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [sendType, setSendType] = useState<ManualSendType>("single");
  const [singleName, setSingleName] = useState("");
  const [singleContact, setSingleContact] = useState("");
  const [singleRelationship, setSingleRelationship] =
    useState<ManualRelationship>("Vendor");
  const [isGuestPickerOpen, setIsGuestPickerOpen] = useState(false);
  const [bulkSource, setBulkSource] = useState<BulkSource>("paste");
  const [bulkPasteValue, setBulkPasteValue] = useState("");
  const [parsedContacts, setParsedContacts] = useState<ManualRecipient[]>([]);
  const [guestFilter, setGuestFilter] = useState<
    "All guests" | "Bride's side" | "Groom's side" | "Pending RSVP"
  >("All guests");
  const [selectedGuestIds, setSelectedGuestIds] = useState<string[]>([]);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isSavingManual, setIsSavingManual] = useState(false);

  const hasLoadedRef = useRef(false);
  const toastTimeoutRef = useRef<number | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function ensureContext() {
      let nextUser = user;

      if (!nextUser) {
        const {
          data: { user: fetchedUser },
        } = await browserSupabase.auth.getUser();

        if (!isMounted) {
          return;
        }

        nextUser = fetchedUser ?? null;
        setUser(nextUser);
      }

      if (!nextUser) {
        setErrorMessage("No signed-in user found.");
        setIsLoadingDrafts(false);
        return;
      }

      if (!weddingProfile) {
        try {
          const profile = await getWeddingProfileForUser(browserSupabase, nextUser.id);

          if (!isMounted) {
            return;
          }

          setWeddingProfile(profile);
          setIsOnboarded(Boolean(profile));
        } catch (error) {
          if (!isMounted) {
            return;
          }

          setErrorMessage(
            error instanceof Error
              ? error.message
              : "We couldn't load your wedding profile.",
          );
          setIsLoadingDrafts(false);
        }
      }
    }

    void ensureContext();

    return () => {
      isMounted = false;
    };
  }, [
    browserSupabase,
    setIsOnboarded,
    setUser,
    setWeddingProfile,
    user,
    weddingProfile,
  ]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadGuests() {
      if (!user) {
        return;
      }

      setIsLoadingGuests(true);

      const { data, error } = await supabase
        .from("guests")
        .select("*")
        .eq("user_id", user.id)
        .order("name", { ascending: true });

      if (!isMounted) {
        return;
      }

      if (error) {
        setManualErrorMessage(error.message);
      } else {
        setGuests((data ?? []) as GuestRow[]);
      }

      setIsLoadingGuests(false);
    }

    void loadGuests();

    return () => {
      isMounted = false;
    };
  }, [supabase, user]);

  const showToast = (message: string) => {
    setToastMessage(message);

    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const getDraftGenerationContext = useCallback(
    async (currentUser: User): Promise<DraftGenerationContext> => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() + 30);
      const cutoffDate = cutoff.toISOString().slice(0, 10);

      const [tasksResponse, vendorsResponse, guestsResponse] = await Promise.all([
        supabase
          .from("tasks")
          .select("*")
          .eq("user_id", currentUser.id)
          .eq("status", "pending")
          .not("due_date", "is", null)
          .lte("due_date", cutoffDate)
          .order("due_date", { ascending: true }),
        supabase
          .from("vendors")
          .select("*")
          .eq("user_id", currentUser.id)
          .order("category", { ascending: true }),
        supabase
          .from("guests")
          .select("id", { count: "exact", head: true })
          .eq("user_id", currentUser.id)
          .eq("rsvp_status", "Pending"),
      ]);

      if (tasksResponse.error) {
        throw new Error(tasksResponse.error.message);
      }

      if (vendorsResponse.error) {
        throw new Error(vendorsResponse.error.message);
      }

      if (guestsResponse.error) {
        throw new Error(guestsResponse.error.message);
      }

      const urgentTasks = tasksResponse.data ?? [];
      const vendors = vendorsResponse.data ?? [];
      const pendingGuestCount = guestsResponse.count ?? 0;

      let nextEmptyStateMessage: string | null = null;

      if (!vendors.length && !urgentTasks.length && pendingGuestCount === 0) {
        nextEmptyStateMessage =
          "Nothing needs a message yet. Visit Vendors or Timeline first so Wedly has real planning context to draft from.";
      } else if (!vendors.length) {
        nextEmptyStateMessage =
          "Your vendor map has not been created yet. Visit Vendors first, and Wedly will start drafting outreach here.";
      } else if (!urgentTasks.length && pendingGuestCount === 0) {
        nextEmptyStateMessage =
          "There are no near-term tasks or pending RSVPs to act on right now. Once something becomes time-sensitive, Wedly will draft it here.";
      }

      return {
        emptyStateMessage: nextEmptyStateMessage,
        pendingGuestCount,
        urgentTasks,
        vendors,
      };
    },
    [supabase],
  );

  const generateAndStoreMessages = useCallback(
    async (
      currentUser: User,
      profile: WeddingProfile,
      messageHistory: CommsMessageRow[],
      existingSent: SentMessage[] = [],
    ) => {
      const context = await getDraftGenerationContext(currentUser);
      const {
        emptyStateMessage: nextEmptyStateMessage,
        pendingGuestCount,
        urgentTasks,
        vendors,
      } = context;

      const requestBody: CommsGenerateRequestBody = {
        messageHistory: messageHistory.map(mapRowToHistory),
        pendingGuestCount,
        urgentTasks,
        vendors,
        weddingProfile: buildRequestProfile(profile),
      };

      const response = await fetch("/api/comms-generate", {
        body: JSON.stringify(requestBody),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Could not generate messages. Try again.");
      }

      const data = (await response.json()) as CommsResponse;

      if (!data.drafts.length) {
        setDrafts([]);
        setSentMessages(existingSent);
        setActiveTab("pending");
        setEmptyStateMessage(nextEmptyStateMessage);
        setGenerationContext(context);
        setNeedsGenerationConfirmation(false);
        return;
      }

      const insertPayload: ExtendedDatabase["public"]["Tables"]["comms_messages"]["Insert"][] =
        data.drafts.map((draft) => ({
          channel: draft.channel,
          message: draft.message,
          reason: draft.reason,
          recipient: draft.recipient,
          recipient_type: draft.recipientType,
          sent_at: null,
          status: "pending",
          subject: draft.subject,
          urgency: draft.urgency,
          user_id: currentUser.id,
        }));

      const { data: insertedRows, error: insertError } = await supabase
        .from("comms_messages" as never)
        .insert(insertPayload as never)
        .select("*");

      if (insertError) {
        throw new Error(insertError.message);
      }

      const insertedMessages = (insertedRows ?? []) as CommsMessageRow[];
      setDrafts(insertedMessages.map(mapRowToDraft));
      setSentMessages(existingSent);
      setActiveTab("pending");
      setEmptyStateMessage(null);
      setGenerationContext(context);
      setNeedsGenerationConfirmation(false);
    },
    [getDraftGenerationContext, supabase],
  );

  const loadMessages = useCallback(
    async (currentUser: User, profile: WeddingProfile, forceRefresh: boolean) => {
      if (forceRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoadingDrafts(true);
      }

      setErrorMessage(null);
      setEmptyStateMessage(null);
      setEditingMessageId(null);
      setEditingValue("");

      try {
        const { data, error } = await supabase
          .from("comms_messages")
          .select("*")
          .eq("user_id", currentUser.id)
          .in("status", ["pending", "sent", "dismissed"]);

        if (error) {
          throw new Error(error.message);
        }

        const existingMessages = (data ?? []) as CommsMessageRow[];
        const splitExisting = splitMessages(existingMessages);

        if (!forceRefresh && existingMessages.length > 0) {
          setDrafts(splitExisting.pending);
          setSentMessages(splitExisting.sent);
          setEmptyStateMessage(null);
          setGenerationContext(null);
          setNeedsGenerationConfirmation(false);
          return;
        }

        if (forceRefresh) {
          const { error: deleteError } = await supabase
            .from("comms_messages")
            .delete()
            .eq("user_id", currentUser.id)
            .eq("status", "pending");

          if (deleteError) {
            throw new Error(deleteError.message);
          }
        } else {
          const context = await getDraftGenerationContext(currentUser);
          setDrafts([]);
          setSentMessages(splitExisting.sent);
          setActiveTab("pending");
          setGenerationContext(context);
          setEmptyStateMessage(context.emptyStateMessage);
          setNeedsGenerationConfirmation(true);
          return;
        }

        await generateAndStoreMessages(
          currentUser,
          profile,
          existingMessages,
          splitExisting.sent,
        );
      } catch (error) {
        setDrafts([]);
        setEmptyStateMessage(null);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Could not generate messages. Try again.",
        );
      } finally {
        setIsLoadingDrafts(false);
        setIsRefreshing(false);
      }
    },
    [generateAndStoreMessages, getDraftGenerationContext, supabase],
  );

  useEffect(() => {
    if (!user || !weddingProfile || hasLoadedRef.current) {
      return;
    }

    hasLoadedRef.current = true;
    void loadMessages(user, weddingProfile, false);
  }, [loadMessages, user, weddingProfile]);

  const handleRegenerate = async () => {
    if (!user || !weddingProfile) {
      return;
    }

    setDrafts([]);
    await loadMessages(user, weddingProfile, true);
  };

  const handleGenerateFromCurrentState = async () => {
    if (!user || !weddingProfile) {
      return;
    }

    setNeedsGenerationConfirmation(false);
    setIsLoadingDrafts(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase
        .from("comms_messages")
        .select("*")
        .eq("user_id", user.id)
        .in("status", ["pending", "sent", "dismissed"]);

      if (error) {
        throw new Error(error.message);
      }

      const existingMessages = (data ?? []) as CommsMessageRow[];
      const splitExisting = splitMessages(existingMessages);

      await generateAndStoreMessages(
        user,
        weddingProfile,
        existingMessages,
        splitExisting.sent,
      );
    } catch (error) {
      setNeedsGenerationConfirmation(true);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not generate messages. Try again.",
      );
    } finally {
      setIsLoadingDrafts(false);
    }
  };

  const handleStartEditing = (draft: DraftMessage) => {
    setEditingMessageId(draft.id);
    setEditingValue(draft.message);
  };

  const handleSaveEditing = async (draftId: string) => {
    const nextMessage = editingValue.trim();

    if (!nextMessage) {
      setEditingMessageId(null);
      setEditingValue("");
      return;
    }

    const previousDrafts = drafts;
    setDrafts((current) =>
      current.map((draft) =>
        draft.id === draftId ? { ...draft, message: nextMessage } : draft,
      ),
    );
    setEditingMessageId(null);
    setEditingValue("");
    setErrorMessage(null);

    const { error } = await supabase
      .from("comms_messages" as never)
      .update({ message: nextMessage } as never)
      .eq("id", draftId);

    if (error) {
      setDrafts(previousDrafts);
      setErrorMessage(error.message);
    }
  };

  const handleCancelEditing = (draft: DraftMessage) => {
    setEditingMessageId(null);
    setEditingValue(draft.message);
  };

  const handleApprove = async (draft: DraftMessage) => {
    const nextDraft =
      editingMessageId === draft.id
        ? { ...draft, message: editingValue.trim() || draft.message }
        : draft;
    const sentAt = new Date().toISOString();

    setTransitioningIds((current) => [...current, draft.id]);

    window.setTimeout(() => {
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      setSentMessages((current) => [{ ...nextDraft, sentAt }, ...current]);
      setTransitioningIds((current) => current.filter((id) => id !== draft.id));

      if (editingMessageId === draft.id) {
        setEditingMessageId(null);
        setEditingValue("");
      }
    }, 260);

    const { error } = await supabase
      .from("comms_messages" as never)
      .update({
        message: nextDraft.message,
        sent_at: sentAt,
        status: "sent",
      } as never)
      .eq("id", draft.id);

    if (error) {
      setDrafts((current) => [...current, nextDraft]);
      setSentMessages((current) => current.filter((item) => item.id !== draft.id));
      setTransitioningIds((current) => current.filter((id) => id !== draft.id));
      setErrorMessage(error.message);
      return;
    }

    showToast("Message approved ✓");
  };

  const handleDismiss = async (draft: DraftMessage) => {
    setTransitioningIds((current) => [...current, draft.id]);

    window.setTimeout(() => {
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      setTransitioningIds((current) => current.filter((id) => id !== draft.id));

      if (editingMessageId === draft.id) {
        setEditingMessageId(null);
        setEditingValue("");
      }
    }, 260);

    const { error } = await supabase
      .from("comms_messages" as never)
      .update({ status: "dismissed" } as never)
      .eq("id", draft.id);

    if (error) {
      setDrafts((current) => [...current, draft]);
      setTransitioningIds((current) => current.filter((id) => id !== draft.id));
      setErrorMessage(error.message);
    }
  };

  const handleParseContacts = () => {
    const tokens = bulkPasteValue
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    const uniqueTokens = Array.from(new Set(tokens));

    setParsedContacts(
      uniqueTokens.map((contact, index) => ({
        contact,
        contactType: detectContactType(contact),
        id: `parsed-${index}-${contact}`,
        name: contact,
        relationship: "Other",
      })),
    );
  };

  const handleRemoveParsedContact = (id: string) => {
    setParsedContacts((current) => current.filter((item) => item.id !== id));
  };

  const filteredGuests = useMemo(() => {
    return guests.filter((guest) => {
      if (guestFilter === "Bride's side") {
        return guest.side === "Bride's side";
      }

      if (guestFilter === "Groom's side") {
        return guest.side === "Groom's side";
      }

      if (guestFilter === "Pending RSVP") {
        return guest.rsvp_status === "Pending";
      }

      return true;
    });
  }, [guestFilter, guests]);

  const manualRecipients = useMemo<ManualRecipient[]>(() => {
    if (sendType === "single") {
      const trimmedName = singleName.trim();
      const trimmedContact = singleContact.trim();

      if (!trimmedName && !trimmedContact) {
        return [];
      }

      return [
        {
          contact: trimmedContact,
          contactType: detectContactType(trimmedContact),
          id: "single-recipient",
          name: trimmedName || trimmedContact,
          relationship: singleRelationship,
        },
      ];
    }

    if (bulkSource === "paste") {
      return parsedContacts;
    }

    return guests
      .filter((guest) => selectedGuestIds.includes(guest.id))
      .map((guest) => ({
        contact: guest.phone?.trim() ?? "",
        contactType: detectContactType(guest.phone ?? ""),
        guestId: guest.id,
        id: guest.id,
        name: guest.name,
        relationship: "Family" as const,
      }));
  }, [
    bulkSource,
    guests,
    parsedContacts,
    selectedGuestIds,
    sendType,
    singleContact,
    singleName,
    singleRelationship,
  ]);

  const recipientSummary = useMemo(() => {
    const names = manualRecipients.map((recipient) => recipient.name || recipient.contact);
    const count = manualRecipients.length;
    const firstNames = names.slice(0, 3);

    return {
      count,
      names,
      preview:
        count <= 3
          ? firstNames.join(", ")
          : `${firstNames.join(", ")} and ${count - 3} more`,
    };
  }, [manualRecipients]);

  const deliveryWarnings = useMemo(() => {
    const warnings: string[] = [];

    if (selectedChannel === "Email") {
      const skipped = manualRecipients.filter(
        (recipient) => recipient.contactType !== "email",
      ).length;

      if (skipped > 0) {
        warnings.push(
          `${skipped} contact${skipped > 1 ? "s" : ""} ${skipped > 1 ? "have" : "has"} no email — ${skipped > 1 ? "they'll" : "it'll"} be skipped for Email channel.`,
        );
      }
    }

    if (selectedChannel === "WhatsApp" || selectedChannel === "SMS") {
      const skipped = manualRecipients.filter(
        (recipient) => recipient.contactType !== "phone",
      ).length;

      if (skipped > 0) {
        warnings.push(
          `${skipped} contact${skipped > 1 ? "s" : ""} ${skipped > 1 ? "have" : "has"} no phone number — ${skipped > 1 ? "they'll" : "it'll"} be skipped for ${selectedChannel}.`,
        );
      }
    }

    return warnings;
  }, [manualRecipients, selectedChannel]);

  const manualDeliveries = useMemo<ManualDelivery[]>(() => {
    return manualRecipients.flatMap((recipient) => {
      if (selectedChannel === "Email" && recipient.contactType === "email") {
        return [
          {
            channel: selectedChannel,
            contact: recipient.contact,
            name: recipient.name,
            recipientType: mapRelationshipToRecipientType(recipient.relationship),
            relationship: recipient.relationship,
          },
        ];
      }

      if (
        (selectedChannel === "WhatsApp" || selectedChannel === "SMS") &&
        recipient.contactType === "phone"
      ) {
        return [
          {
            channel: selectedChannel,
            contact: recipient.contact,
            name: recipient.name,
            recipientType: mapRelationshipToRecipientType(recipient.relationship),
            relationship: recipient.relationship,
          },
        ];
      }

      return [];
    });
  }, [manualRecipients, selectedChannel]);

  const channelIndicators = useMemo(() => {
    const hasEmails = manualRecipients.some((recipient) => recipient.contactType === "email");
    const hasPhones = manualRecipients.some((recipient) => recipient.contactType === "phone");

    return { hasEmails, hasPhones };
  }, [manualRecipients]);

  const recipientChannelCounts = useMemo(() => {
    const emailCount = manualRecipients.filter(
      (recipient) => recipient.contactType === "email",
    ).length;
    const phoneCount = manualRecipients.filter(
      (recipient) => recipient.contactType === "phone",
    ).length;

    return { emailCount, phoneCount };
  }, [manualRecipients]);

  const isManualSendDisabled =
    !manualMessage.trim() ||
    manualRecipients.length === 0 ||
    manualDeliveries.length === 0;

  const handleAssist = async () => {
    if (!weddingProfile) {
      setManualErrorMessage("Wedding profile is still loading.");
      return;
    }

    setIsAssistLoading(true);
    setManualErrorMessage(null);

    try {
      const response = await fetch("/api/comms-assist", {
        body: JSON.stringify({
          channel: selectedChannel,
          partialMessage: manualMessage,
          subject: manualSubject,
          weddingProfile: buildRequestProfile(weddingProfile),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as CommsAssistResponse;
      setAssistSuggestion(data.suggestion);
    } catch (error) {
      setManualErrorMessage(
        error instanceof Error ? error.message : "Could not generate AI suggestion.",
      );
    } finally {
      setIsAssistLoading(false);
    }
  };

  const handleConfirmManualSend = async () => {
    if (!user || manualDeliveries.length === 0) {
      return;
    }

    setIsSavingManual(true);
    setManualErrorMessage(null);

    const sentAt = new Date().toISOString();
    const reasonSuffix = attachmentName
      ? ` Attachment recorded: ${attachmentName}.`
      : "";
    const insertPayload: ExtendedDatabase["public"]["Tables"]["comms_messages"]["Insert"][] =
      manualDeliveries.map((delivery) => ({
        channel: delivery.channel,
        message: manualMessage.trim(),
        reason: `Manual ${delivery.channel} message recorded in Wedly.${reasonSuffix}`,
        recipient: buildRecipientLabel(delivery),
        recipient_type: delivery.recipientType,
        sent_at: sentAt,
        status: "sent",
        subject: delivery.channel === "Email" ? manualSubject.trim() || null : null,
        urgency: "low",
        user_id: user.id,
      }));

    const { data, error } = await supabase
      .from("comms_messages" as never)
      .insert(insertPayload as never)
      .select("*");

    if (error) {
      setManualErrorMessage(error.message);
      setIsSavingManual(false);
      return;
    }

    const inserted = ((data ?? []) as CommsMessageRow[]).map(mapRowToSent);
    setSentMessages((current) => [...inserted, ...current]);
    setIsReviewModalOpen(false);
    setActiveTab("sent");
    setMode("ai");
    setIsSavingManual(false);
    showToast("Message recorded as sent ✓");

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("wedly-data-updated", { detail: { type: "comms" } }),
      );
    }
  };

  const handleGuestSelectAll = () => {
    const visibleIds = filteredGuests.map((guest) => guest.id);
    const allSelected = visibleIds.every((id) => selectedGuestIds.includes(id));

    if (allSelected) {
      setSelectedGuestIds((current) =>
        current.filter((id) => !visibleIds.includes(id)),
      );
      return;
    }

    setSelectedGuestIds((current) => Array.from(new Set([...current, ...visibleIds])));
  };

  const totalMessageCount = drafts.length + sentMessages.length;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#FAF7F2]">
      <div className="border-b border-[#E8E2D9] bg-[#FAF7F2] px-5 py-5 md:px-7">
        <div className="mx-auto w-full max-w-[1120px]">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <h1 className="font-display text-[28px] leading-none text-[#1C1A17]">
              Communication Agent
            </h1>

            <div className="inline-flex self-start rounded-[999px] border border-[#E8E2D9] bg-[#FBF8F2] p-[4px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.55)] md:self-auto">
              {([
                ["ai", "✦ AI Mode"],
                ["manual", "✎ Manual Mode"],
              ] as const).map(([id, label]) => {
                const isActive = mode === id;

                return (
                  <button
                    className={`rounded-[999px] px-5 py-2 text-[12px] font-medium transition-all duration-200 ${
                      isActive
                        ? "bg-[#1C1A17] text-[#FAF7F2] shadow-[0_6px_14px_rgba(28,26,23,0.14)]"
                        : "bg-transparent text-[#9A9286]"
                    }`}
                    key={id}
                    onClick={() => setMode(id)}
                    type="button"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {mode === "ai" ? (
            <>
              <p className="mt-4 text-[14px] text-[#8F877B]">
                {needsGenerationConfirmation
                  ? "✦ Wedly can review your vendors, timeline, and RSVPs before drafting any messages"
                  : `✦ AI has drafted ${totalMessageCount} messages based on your current plan`}
              </p>

              <div className="mt-5 flex gap-8 border-b border-[#E8E2D9]">
                {([
                  ["pending", "Pending Approval"],
                  ["sent", "Sent"],
                ] as const).map(([id, label]) => (
                  <button
                    className={`border-b-2 pb-4 text-[14px] transition-colors ${
                      activeTab === id
                        ? "border-[#C9A84C] text-[#1C1A17]"
                        : "border-transparent text-[#8F877B]"
                    }`}
                    key={id}
                    onClick={() => setActiveTab(id)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-7">
        <div className="mx-auto w-full max-w-[1120px]">
          {mode === "ai" ? (
            activeTab === "pending" ? (
              <div className="space-y-4">
                {!needsGenerationConfirmation ? (
                  <div className="flex items-center justify-end">
                    <button
                      className="text-[12px] text-[#C9A84C] transition-opacity hover:opacity-75 disabled:opacity-50"
                      disabled={isLoadingDrafts || isRefreshing}
                      onClick={() => void handleRegenerate()}
                      type="button"
                    >
                      <span className="inline-flex items-center gap-2">
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                        />
                        Regenerate messages
                      </span>
                    </button>
                  </div>
                ) : null}

                {needsGenerationConfirmation ? (
                  <div className="rounded-[16px] border border-[#E8E2D9] bg-white px-6 py-6">
                    <div className="flex items-start gap-4">
                      <div className="mt-1 rounded-full bg-[#FBF7ED] p-3 text-[#C9A84C]">
                        <Sparkles className="h-5 w-5" />
                      </div>

                      <div className="flex-1">
                        <p className="font-display text-[24px] leading-none text-[#1C1A17]">
                          Generate communication drafts from your current plan?
                        </p>
                        <p className="mt-4 max-w-[720px] text-[14px] leading-7 text-[#8F877B]">
                          Wedly will look at your current vendor statuses, near-term
                          timeline tasks, and pending guest RSVPs before drafting any
                          outreach. Nothing will be generated unless you ask for it.
                        </p>

                        <div className="mt-5 flex flex-wrap gap-3 text-[12px] text-[#6A6256]">
                          <span className="rounded-full bg-[#FAF7F2] px-3 py-1.5">
                            {generationContext?.vendors.length ?? 0} vendor categories reviewed
                          </span>
                          <span className="rounded-full bg-[#FAF7F2] px-3 py-1.5">
                            {generationContext?.urgentTasks.length ?? 0} timeline items due soon
                          </span>
                          <span className="rounded-full bg-[#FAF7F2] px-3 py-1.5">
                            {generationContext?.pendingGuestCount ?? 0} pending RSVPs
                          </span>
                        </div>

                        {emptyStateMessage ? (
                          <p className="mt-5 max-w-[720px] text-[13px] leading-6 text-[#B8B2A7]">
                            {emptyStateMessage}
                          </p>
                        ) : null}

                        <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <p className="text-[12px] text-[#8F877B]">
                            You can also wait and return here once your plan changes.
                          </p>
                          <button
                            className="inline-flex items-center justify-center rounded-[10px] bg-[#1C1A17] px-5 py-3 text-[13px] font-medium text-[#FAF7F2] shadow-[0_10px_24px_rgba(28,26,23,0.12)] transition-all hover:-translate-y-0.5 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50 md:self-auto"
                            disabled={
                              isLoadingDrafts ||
                              Boolean(generationContext?.emptyStateMessage)
                            }
                            onClick={() => void handleGenerateFromCurrentState()}
                            type="button"
                          >
                            Draft messages from current state
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : isLoadingDrafts ? (
                  <div className="space-y-4">
                    <p className="text-center text-[13px] text-[#C9A84C]">
                      ✦ Analysing your plan and drafting messages...
                    </p>

                    {[0, 1, 2].map((index) => (
                      <div
                        className="comms-skeleton rounded-[12px] border border-[#EFE7D9] bg-[#FCF8F1] p-5"
                        key={index}
                      >
                        <div className="h-4 w-40 rounded-full bg-[#F2EBDD]" />
                        <div className="mt-4 h-3 w-2/3 rounded-full bg-[#F2EBDD]" />
                        <div className="mt-5 rounded-[8px] bg-[#F7F1E8] p-4">
                          <div className="h-3 w-full rounded-full bg-[#EFE5D7]" />
                          <div className="mt-3 h-3 w-5/6 rounded-full bg-[#EFE5D7]" />
                          <div className="mt-3 h-3 w-2/3 rounded-full bg-[#EFE5D7]" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : errorMessage ? (
                  <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-center">
                    <p className="max-w-[560px] text-[14px] text-[#A54B45]">
                      {errorMessage || "Could not generate messages. Try again."}
                    </p>
                    <button
                      className="rounded-[8px] bg-[#1C1A17] px-4 py-2 text-[13px] font-medium text-[#FAF7F2]"
                      onClick={() => {
                        if (user && weddingProfile) {
                          void loadMessages(user, weddingProfile, false);
                        }
                      }}
                      type="button"
                    >
                      Retry
                    </button>
                  </div>
                ) : drafts.length === 0 ? (
                  <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                    <Sparkles className="h-8 w-8 text-[#C9A84C]" />
                    <p className="mt-5 font-display text-[22px] text-[#8F877B]">
                      All caught up
                    </p>
                    <p className="mt-3 max-w-[560px] text-[14px] leading-7 text-[#B8B2A7]">
                      {emptyStateMessage || "No pending messages right now"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {drafts.map((draft, index) => {
                      const channelStyles = getChannelStyles(draft.channel);
                      const recipientStyles = getRecipientStyles(draft.recipientType);
                      const isEditing = editingMessageId === draft.id;
                      const isTransitioning = transitioningIds.includes(draft.id);

                      return (
                        <article
                          className="rounded-[12px] border border-[#E8E2D9] bg-white p-5 transition-all duration-300 hover:shadow-[0_2px_8px_rgba(28,26,23,0.08)]"
                          key={draft.id}
                          style={{
                            animation: `commsCardIn 360ms ease both`,
                            animationDelay: `${index * 100}ms`,
                            opacity: isTransitioning ? 0 : 1,
                            transform: isTransitioning
                              ? "translateX(18px)"
                              : "translateX(0)",
                          }}
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <p className="text-[14px] font-semibold text-[#1C1A17]">
                                {draft.recipient}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="rounded-full px-3 py-1 text-[11px] font-medium capitalize"
                                style={recipientStyles}
                              >
                                {draft.recipientType}
                              </span>
                              <span
                                className="rounded-full px-3 py-1 text-[11px] font-medium"
                                style={channelStyles}
                              >
                                {draft.channel}
                              </span>
                              <span className="flex items-center gap-2 text-[11px] uppercase text-[#8F877B]">
                                <span
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{ background: getUrgencyColor(draft.urgency) }}
                                />
                                {draft.urgency}
                              </span>
                            </div>
                          </div>

                          <p className="mt-3 text-[12px] italic text-[#8F877B]">
                            {draft.reason}
                          </p>

                          {draft.subject ? (
                            <p className="mt-3 text-[12px] text-[#6A6256]">
                              Subject: <span className="font-medium">{draft.subject}</span>
                            </p>
                          ) : null}

                          {isEditing ? (
                            <textarea
                              className="mt-4 min-h-[180px] w-full resize-none rounded-[8px] border border-[#E8E2D9] bg-[#FAF7F2] px-4 py-4 text-[13px] leading-[1.7] text-[#5F574B] outline-none transition-colors focus:border-[#C9A84C]"
                              onChange={(event) => setEditingValue(event.target.value)}
                              value={editingValue}
                            />
                          ) : (
                            <div className="mt-4 rounded-[8px] bg-[#FAF7F2] px-4 py-4 text-[13px] leading-[1.7] whitespace-pre-wrap text-[#5F574B]">
                              {draft.message}
                            </div>
                          )}

                          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-3">
                              {isEditing ? (
                                <>
                                  <button
                                    className="text-[13px] text-[#1C1A17]"
                                    onClick={() => void handleSaveEditing(draft.id)}
                                    type="button"
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="text-[13px] text-[#8F877B]"
                                    onClick={() => handleCancelEditing(draft)}
                                    type="button"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="inline-flex items-center gap-2 text-[13px] text-[#8F877B] transition-colors hover:text-[#1C1A17]"
                                  onClick={() => handleStartEditing(draft)}
                                  type="button"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  Edit
                                </button>
                              )}
                            </div>

                            <div className="flex items-center justify-end gap-2">
                              <button
                                className="text-[13px] text-[#8F877B] transition-colors hover:text-[#1C1A17]"
                                onClick={() => void handleDismiss(draft)}
                                type="button"
                              >
                                Dismiss
                              </button>
                              <button
                                className="rounded-[6px] bg-[#1C1A17] px-5 py-2 text-[13px] font-medium text-[#FAF7F2] transition-opacity hover:opacity-90"
                                onClick={() => void handleApprove(draft)}
                                type="button"
                              >
                                Approve &amp; Send
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : sentMessages.length === 0 ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                <p className="font-display text-[22px] text-[#8F877B]">
                  No messages sent yet
                </p>
                <p className="mt-3 text-[14px] text-[#B8B2A7]">
                  Approved messages will appear here
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {sentMessages.map((message, index) => {
                  const channelStyles = getChannelStyles(message.channel);
                  const recipientStyles = getRecipientStyles(message.recipientType);

                  return (
                    <article
                      className="rounded-[12px] border border-[#E8E2D9] bg-white p-5 opacity-75 transition-shadow hover:shadow-[0_2px_8px_rgba(28,26,23,0.08)]"
                      key={message.id}
                      style={{
                        animation: `commsCardIn 360ms ease both`,
                        animationDelay: `${index * 100}ms`,
                      }}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-[14px] font-semibold text-[#1C1A17]">
                            {message.recipient}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="rounded-full px-3 py-1 text-[11px] font-medium capitalize"
                            style={recipientStyles}
                          >
                            {message.recipientType}
                          </span>
                          <span
                            className="rounded-full px-3 py-1 text-[11px] font-medium"
                            style={channelStyles}
                          >
                            {message.channel}
                          </span>
                          <span className="rounded-full bg-[#E6F3EC] px-3 py-1 text-[11px] font-medium text-[#32855C]">
                            Sent ✓
                          </span>
                        </div>
                      </div>

                      <p className="mt-3 text-[12px] italic text-[#8F877B]">
                        {message.reason}
                      </p>

                      {message.subject ? (
                        <p className="mt-3 text-[12px] text-[#6A6256]">
                          Subject: <span className="font-medium">{message.subject}</span>
                        </p>
                      ) : null}

                      <div className="mt-4 rounded-[8px] bg-[#FAF7F2] px-4 py-4 text-[13px] leading-[1.7] whitespace-pre-wrap text-[#5F574B]">
                        {message.message}
                      </div>

                      <p className="mt-4 text-[11px] text-[#B8B2A7]">
                        Sent {formatTimestamp(message.sentAt)}
                      </p>
                    </article>
                  );
                })}
              </div>
            )
          ) : (
            <div className="space-y-4">
              {manualErrorMessage ? (
                <div className="rounded-[12px] border border-[rgba(192,57,43,0.2)] bg-[#FFF2F0] px-4 py-3 text-[13px] text-[#A54B45]">
                  {manualErrorMessage}
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <div className="rounded-[16px] border border-[#E8E2D9] bg-white p-6">
                  <div className="mb-5 flex items-center gap-2">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-[#B8A96A]">
                      ✦ Compose message
                    </p>
                    <span className="h-px flex-1 bg-[rgba(201,168,76,0.15)]" />
                  </div>

                  <div className="mb-5 flex flex-wrap gap-2">
                    {([
                      {
                        channel: "Email" as const,
                        label: "✉ Email",
                      },
                      {
                        channel: "WhatsApp" as const,
                        label: "💬 WhatsApp",
                      },
                      {
                        channel: "SMS" as const,
                        label: "📱 SMS",
                      },
                    ]).map(({ channel, label }) => {
                      const selected = selectedChannel === channel;

                      return (
                        <button
                          className={`rounded-[20px] border px-4 py-2 text-[12px] transition-all duration-150 ${
                            selected
                              ? "border-[#1C1A17] bg-[#1C1A17] text-[#FAF7F2] shadow-[0_8px_18px_rgba(28,26,23,0.16)]"
                              : "border-[#E8E2D9] bg-white text-[#8F877B] hover:border-[#C9A84C] hover:bg-[#FBF7ED] hover:text-[#8B6914]"
                          }`}
                          key={channel}
                          onClick={() => setSelectedChannel(channel)}
                          type="button"
                        >
                          <span className="inline-flex items-center gap-2">
                            {selected ? (
                              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#C9A84C] text-[10px] text-[#1C1A17]">
                                ✓
                              </span>
                            ) : null}
                            <span>{label}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedChannel === "Email" ? (
                    <div className="mb-4">
                      <label className="mb-1.5 block text-[11px] text-[#B8A96A]">
                        Subject line
                      </label>
                      <input
                        className="w-full border-0 border-b border-[#E8E2D9] bg-transparent px-0 py-2 text-[13px] text-[#1C1A17] outline-none transition-colors placeholder:text-[#B8A96A] focus:border-[#C9A84C]"
                        onChange={(event) => setManualSubject(event.target.value)}
                        placeholder="e.g. Wedding invitation — Anvita & Rajat"
                        value={manualSubject}
                      />
                    </div>
                  ) : null}

                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-4">
                      <label className="text-[11px] text-[#B8A96A]">Message</label>
                      <button
                        className="rounded-[20px] border border-[rgba(201,168,76,0.25)] bg-[#FBF7ED] px-3 py-1 text-[11px] text-[#8B6914] transition-opacity duration-150 hover:opacity-80 disabled:opacity-50"
                        disabled={isAssistLoading || !weddingProfile}
                        onClick={() => void handleAssist()}
                        type="button"
                      >
                        ✦ AI assist
                      </button>
                    </div>
                    <textarea
                      className="min-h-[130px] w-full resize-y rounded-[8px] border border-[#E8E2D9] bg-[#FAF7F2] px-4 py-3 text-[13px] leading-6 text-[#1C1A17] outline-none transition-colors placeholder:text-[#8F877B] focus:border-[#C9A84C]"
                      onChange={(event) => setManualMessage(event.target.value)}
                      placeholder="Write your message here..."
                      value={manualMessage}
                    />
                  </div>

                  {isAssistLoading ? (
                    <div className="mt-3 rounded-[10px] border border-[rgba(201,168,76,0.2)] bg-[#FBF7ED] px-4 py-3 text-[12px] italic text-[#8B6914]">
                      Generating suggestion...
                    </div>
                  ) : null}

                  {assistSuggestion ? (
                    <div className="mt-2 rounded-[8px] border border-[rgba(201,168,76,0.2)] bg-[#FBF7ED] px-4 py-3">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-[#C9A84C]">
                        AI suggestion:
                      </p>
                      <p className="mt-2 text-[12px] leading-[1.6] text-[#5F574B]">
                        {assistSuggestion}
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          className="rounded-[20px] border border-[rgba(201,168,76,0.3)] bg-transparent px-3 py-1 text-[11px] text-[#8B6914]"
                          onClick={() => setManualMessage(assistSuggestion)}
                          type="button"
                        >
                          Use this
                        </button>
                        <button
                          className="text-[11px] text-[#8F877B]"
                          onClick={() => setAssistSuggestion(null)}
                          type="button"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {selectedChannel === "Email" ? (
                    <div className="mt-4">
                      <button
                        className="flex w-full flex-col items-center justify-center rounded-[8px] border border-dashed border-[rgba(201,168,76,0.3)] px-4 py-5 text-center"
                        onClick={() => attachmentInputRef.current?.click()}
                        type="button"
                      >
                        <span className="text-[13px] text-[#8F877B]">
                          Attach invitation card or file
                        </span>
                        {attachmentName ? (
                          <span className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#FBF7ED] px-3 py-1 text-[11px] text-[#8B6914]">
                            {attachmentName}
                            <span
                              aria-hidden="true"
                              className="cursor-pointer"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAttachmentName(null);
                                if (attachmentInputRef.current) {
                                  attachmentInputRef.current.value = "";
                                }
                              }}
                            >
                              <X className="h-3 w-3" />
                            </span>
                          </span>
                        ) : null}
                      </button>
                      <input
                        className="hidden"
                        onChange={(event) => {
                          const fileName = event.target.files?.[0]?.name ?? null;
                          setAttachmentName(fileName);
                        }}
                        ref={attachmentInputRef}
                        type="file"
                      />
                    </div>
                  ) : null}

                  <button
                    className="mt-4 w-full rounded-[8px] bg-[#1C1A17] px-4 py-3 font-display text-[18px] text-[#FAF7F2] transition-opacity hover:opacity-90 disabled:opacity-50"
                    disabled={isManualSendDisabled}
                    onClick={() => setIsReviewModalOpen(true)}
                    type="button"
                  >
                    Review &amp; send →
                  </button>
                </div>

                <div className="rounded-[16px] border border-[#E8E2D9] bg-white p-6">
                  <div className="mb-5 flex items-center gap-2">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-[#B8A96A]">
                      ✦ Recipients
                    </p>
                    <span className="h-px flex-1 bg-[rgba(201,168,76,0.15)]" />
                  </div>

                  <div className="mb-5 inline-flex rounded-[24px] bg-[#F5F0E8] p-[3px]">
                    {([
                      ["single", "Single"],
                      ["bulk", "Bulk"],
                    ] as const).map(([id, label]) => {
                      const isActive = sendType === id;

                      return (
                        <button
                          className={`rounded-[20px] px-5 py-2 text-[12px] transition-all duration-200 ${
                            isActive
                              ? "bg-[#1C1A17] text-[#FAF7F2] shadow-[0_6px_14px_rgba(28,26,23,0.14)]"
                              : "bg-transparent text-[#7A7568] hover:text-[#1C1A17]"
                          }`}
                          key={id}
                          onClick={() => setSendType(id)}
                          type="button"
                        >
                          <span className="inline-flex items-center gap-2">
                            {isActive ? <span className="text-[11px]">✓</span> : null}
                            <span>{label}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {sendType === "single" ? (
                    <div className="space-y-0">
                      <div>
                        <label className="mb-1.5 block text-[11px] text-[#B8A96A]">
                          Name
                        </label>
                        <input
                          className="w-full border-0 border-b border-[#E8E2D9] bg-transparent px-0 py-2 text-[13px] text-[#1C1A17] outline-none transition-colors placeholder:text-[#B8A96A] focus:border-[#C9A84C]"
                          onChange={(event) => setSingleName(event.target.value)}
                          placeholder="Recipient name"
                          value={singleName}
                        />
                      </div>
                      <div className="mt-4">
                        <label className="mb-1.5 block text-[11px] text-[#B8A96A]">
                          Contact
                        </label>
                        <input
                          className="w-full border-0 border-b border-[#E8E2D9] bg-transparent px-0 py-2 text-[13px] text-[#1C1A17] outline-none transition-colors placeholder:text-[#B8A96A] focus:border-[#C9A84C]"
                          onChange={(event) => setSingleContact(event.target.value)}
                          placeholder="Email or phone number"
                          value={singleContact}
                        />
                      </div>
                      <div className="mt-4">
                        <p className="mb-2 text-[11px] text-[#B8A96A]">Relationship</p>
                        <div className="flex flex-wrap gap-2">
                          {([
                            "Vendor",
                            "Family",
                            "Friend",
                            "Co-partner",
                            "Other",
                          ] as const).map((option) => {
                            const label = option === "Co-partner" ? "Partner" : option;
                            const selected = singleRelationship === option;

                            return (
                              <button
                                className={`rounded-[20px] border px-3 py-1 text-[11px] transition-all duration-150 ${
                                  selected
                                    ? "border-[#1C1A17] bg-[#1C1A17] text-[#FAF7F2] shadow-[0_4px_10px_rgba(28,26,23,0.14)]"
                                    : "border-[#E8E2D9] bg-white text-[#7A7568] hover:border-[#C9A84C] hover:bg-[#FBF7ED] hover:text-[#8B6914]"
                                }`}
                                key={option}
                                onClick={() => setSingleRelationship(option)}
                                type="button"
                              >
                                <span className="inline-flex items-center gap-1.5">
                                  {selected ? (
                                    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#C9A84C] text-[9px] text-[#1C1A17]">
                                      ✓
                                    </span>
                                  ) : null}
                                  <span>{label}</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="mt-3">
                        <button
                          className="text-[12px] text-[#C9A84C] transition-all duration-150 hover:underline"
                          onClick={() => setIsGuestPickerOpen((current) => !current)}
                          type="button"
                        >
                          Or pick from guests
                        </button>

                        {isGuestPickerOpen ? (
                          <div className="mt-3 border-t border-[#F0EBE3] pt-3">
                            {isLoadingGuests ? (
                              <p className="py-2 text-[12px] text-[#8F877B]">
                                Loading guests...
                              </p>
                            ) : guests.length === 0 ? (
                              <p className="py-2 text-[12px] text-[#8F877B]">
                                No guests found yet.
                              </p>
                            ) : (
                              <div className="max-h-[220px] overflow-y-auto">
                                {guests.map((guest) => (
                                  <button
                                    className="flex w-full items-center justify-between border-b border-[#F5F0E8] py-3 text-left text-[12px] text-[#1C1A17] transition-colors hover:bg-[#FCFAF6]"
                                    key={guest.id}
                                    onClick={() => {
                                      setSingleName(guest.name);
                                      setSingleContact(guest.phone ?? "");
                                      setSingleRelationship("Family");
                                      setIsGuestPickerOpen(false);
                                    }}
                                    type="button"
                                  >
                                    <span>{guest.name}</span>
                                    <span className="text-[#B8A96A]">
                                      {guest.phone || "No phone"}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex border-b border-[#E8E2D9]">
                        {([
                          ["paste", "Paste list"],
                          ["guests", "From guests"],
                        ] as const).map(([id, label]) => {
                          const isActive = bulkSource === id;

                          return (
                            <button
                              className={`mb-[-1px] border-b-2 px-4 py-2 text-[12px] transition-all duration-150 ${
                                isActive
                                  ? "border-[#C9A84C] font-medium text-[#8B6914]"
                                  : "border-transparent text-[#7A7568] hover:text-[#1C1A17]"
                              }`}
                              key={id}
                              onClick={() => setBulkSource(id)}
                              type="button"
                            >
                              <span className="inline-flex items-center gap-1.5">
                                {isActive ? (
                                  <span className="h-1.5 w-1.5 rounded-full bg-[#C9A84C]" />
                                ) : null}
                                <span>{label}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {bulkSource === "paste" ? (
                        <div>
                          <textarea
                            className="min-h-[100px] w-full resize-none rounded-[8px] border border-[#E8E2D9] bg-[#FAF7F2] px-3 py-3 text-[12px] leading-5 text-[#1C1A17] outline-none transition-colors placeholder:text-[#8F877B] focus:border-[#C9A84C]"
                            onChange={(event) => setBulkPasteValue(event.target.value)}
                            placeholder={`Paste emails or phone numbers\none per line or comma separated\n\nexample@email.com\n+919876543210`}
                            value={bulkPasteValue}
                          />
                          <button
                            className="mt-2 rounded-[20px] border border-[rgba(201,168,76,0.25)] bg-[#FBF7ED] px-4 py-1.5 text-[12px] text-[#8B6914]"
                            onClick={handleParseContacts}
                            type="button"
                          >
                            Parse contacts
                          </button>

                          {parsedContacts.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {parsedContacts.map((contact) => (
                                <span
                                  className="inline-flex items-center gap-1.5 rounded-[20px] border border-[#E8E2D9] bg-[#F5F0E8] px-3 py-1 text-[11px] text-[#1C1A17]"
                                  key={contact.id}
                                >
                                  {contact.contact}
                                  <button
                                    className="ml-0.5 text-[13px] leading-none text-[#B8A96A]"
                                    onClick={() => handleRemoveParsedContact(contact.id)}
                                    type="button"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div>
                          <div className="mb-3 flex flex-wrap gap-1.5">
                            {([
                              "All guests",
                              "Bride's side",
                              "Groom's side",
                              "Pending RSVP",
                            ] as const).map((filter) => (
                              <button
                                className={`rounded-[20px] border px-3 py-1 text-[11px] transition-colors duration-150 ${
                                  guestFilter === filter
                                    ? "border-[#1C1A17] bg-[#1C1A17] text-[#FAF7F2] shadow-[0_4px_10px_rgba(28,26,23,0.14)]"
                                    : "border-[#E8E2D9] bg-white text-[#7A7568] hover:border-[#C9A84C] hover:bg-[#FBF7ED] hover:text-[#8B6914]"
                                }`}
                                key={filter}
                                onClick={() => setGuestFilter(filter)}
                                type="button"
                              >
                                <span className="inline-flex items-center gap-1.5">
                                  {guestFilter === filter ? (
                                    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#C9A84C] text-[9px] text-[#1C1A17]">
                                      ✓
                                    </span>
                                  ) : null}
                                  <span>{filter}</span>
                                </span>
                              </button>
                            ))}
                          </div>

                          <div className="border-y border-[#F5F0E8]">
                            <label className="flex items-center gap-3 py-3 text-[11px] text-[#8F877B]">
                              <input
                                checked={
                                  filteredGuests.length > 0 &&
                                  filteredGuests.every((guest) =>
                                    selectedGuestIds.includes(guest.id),
                                  )
                                }
                                onChange={handleGuestSelectAll}
                                type="checkbox"
                              />
                              Select all
                            </label>

                            <div className="max-h-[220px] overflow-y-auto">
                              {filteredGuests.map((guest) => (
                                <label
                                  className="flex items-center gap-3 border-b border-[#F5F0E8] py-2.5 text-[12px] text-[#1C1A17] last:border-b-0"
                                  key={guest.id}
                                >
                                  <input
                                    checked={selectedGuestIds.includes(guest.id)}
                                    onChange={() =>
                                      setSelectedGuestIds((current) =>
                                        current.includes(guest.id)
                                          ? current.filter((id) => id !== guest.id)
                                          : [...current, guest.id],
                                      )
                                    }
                                    type="checkbox"
                                  />
                                  <div className="flex-1">
                                    <p>{guest.name}</p>
                                    <p className="text-[11px] text-[#B8A96A]">
                                      {guest.phone || "No phone"}
                                    </p>
                                  </div>
                                </label>
                              ))}
                            </div>
                          </div>

                          <p className="mt-3 text-[12px] text-[#C9A84C]">
                            {selectedGuestIds.length} guests selected
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-4 border-t border-[#F0EBE3] pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[12px] font-medium text-[#1C1A17]">
                        {recipientSummary.count} recipient
                        {recipientSummary.count === 1 ? "" : "s"} selected
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-[10px] bg-[#F5F0E8] px-2.5 py-1 text-[10px] text-[#7A7568]">
                          ✉ {recipientChannelCounts.emailCount} emails
                        </span>
                        <span className="rounded-[10px] bg-[#F5F0E8] px-2.5 py-1 text-[10px] text-[#7A7568]">
                          📱 {recipientChannelCounts.phoneCount} numbers
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-3 text-[#8F877B]">
                      {channelIndicators.hasEmails ? <Mail className="h-4 w-4" /> : null}
                      {channelIndicators.hasPhones ? <Phone className="h-4 w-4" /> : null}
                    </div>

                    {deliveryWarnings.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {deliveryWarnings.map((warning) => (
                          <p className="text-[11px] text-[#B8860B]" key={warning}>
                            {warning}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="rounded-[12px] border border-[rgba(201,168,76,0.25)] bg-[#FBF7ED] px-5 py-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[#C9A84C]">
                  ✦ Wedly suggests
                </p>
                <p className="mt-3 text-[12px] leading-6 text-[#6A6256]">
                  Use AI Mode when you want Wedly to draft context-aware messages from your vendors, tasks, and guests. Use Manual Mode when you already know exactly what you want to send.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {isReviewModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(28,26,23,0.45)] px-4">
          <div className="w-full max-w-[560px] rounded-[20px] bg-white px-8 py-8 shadow-[0_20px_40px_rgba(28,26,23,0.12)]">
            <h2 className="font-display text-[26px] text-[#1C1A17]">
              Review before sending
            </h2>

            <div className="mt-6 space-y-4 text-[13px] text-[#5F574B]">
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-[#8F877B]">
                  Sending via
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span
                    className="rounded-full px-3 py-1 text-[11px] font-medium"
                    style={getChannelStyles(selectedChannel)}
                  >
                    {selectedChannel}
                  </span>
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-[#8F877B]">
                  To
                </p>
                <p className="mt-2">
                  {recipientSummary.count} recipient
                  {recipientSummary.count === 1 ? "" : "s"} —{" "}
                  {recipientSummary.preview || "No recipients"}
                </p>
              </div>

              {selectedChannel === "Email" ? (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.12em] text-[#8F877B]">
                    Subject
                  </p>
                  <p className="mt-2">{manualSubject || "No subject added"}</p>
                </div>
              ) : null}

              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-[#8F877B]">
                  Message preview
                </p>
                <div className="mt-2 max-h-[120px] overflow-y-auto rounded-[8px] bg-[#FAF7F2] px-4 py-4 leading-6 whitespace-pre-wrap">
                  {manualMessage}
                </div>
              </div>

              <div className="rounded-[10px] border border-[rgba(201,168,76,0.25)] bg-[#FBF7ED] px-4 py-4 text-[12px] leading-6 text-[#6A6256]">
                ✦ Note: Wedly will save a record of this message but actual delivery depends on your connected channels. For now this is saved as sent in your records.
              </div>
            </div>

            <button
              className="mt-6 w-full rounded-[8px] bg-[#1C1A17] px-4 py-3 text-[14px] font-medium text-[#FAF7F2] transition-opacity hover:opacity-90 disabled:opacity-50"
              disabled={isSavingManual}
              onClick={() => void handleConfirmManualSend()}
              type="button"
            >
              {isSavingManual ? "Saving..." : "Confirm & mark as sent"}
            </button>
            <button
              className="mt-3 w-full text-[13px] text-[#8F877B]"
              onClick={() => setIsReviewModalOpen(false)}
              type="button"
            >
              Go back &amp; edit
            </button>
          </div>
        </div>
      ) : null}

      {toastMessage ? (
        <div className="comms-toast fixed bottom-6 right-6 z-40 rounded-[999px] border border-[#D8C493] bg-[#E6D097] px-4 py-2 text-[12px] font-medium text-[#1C1A17] shadow-[0_10px_24px_rgba(28,26,23,0.12)]">
          {toastMessage}
        </div>
      ) : null}

      <style jsx>{`
        .comms-skeleton {
          position: relative;
          overflow: hidden;
        }

        .comms-skeleton::after {
          position: absolute;
          inset: 0;
          transform: translateX(-100%);
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.55) 45%,
            rgba(255, 255, 255, 0) 100%
          );
          animation: commsShimmer 1.4s ease-in-out infinite;
          content: "";
        }

        .comms-toast {
          animation: toastSlideIn 220ms ease;
        }

        @keyframes commsShimmer {
          100% {
            transform: translateX(100%);
          }
        }

        @keyframes commsCardIn {
          from {
            opacity: 0;
            transform: translateY(12px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes toastSlideIn {
          from {
            opacity: 0;
            transform: translateY(12px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </section>
  );
}
