"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { getWeddingProfileForUser } from "@/lib/supabase/wedding-profile";
import type { WeddingProfile } from "@/lib/supabase/types";
import { useWeddingStore } from "@/store/weddingStore";

type OrchestratorAction = {
  args: Record<string, unknown>;
  result: string;
  tool: string;
};

type ChatMessage = {
  actions?: OrchestratorAction[];
  content: string;
  id: string;
  role: "assistant" | "user";
  timestamp: string;
};

type OrchestratorResponse = {
  actions: OrchestratorAction[];
  message: string;
};

const quickActionChips = [
  "What's overdue?",
  "Add a task",
  "Update a vendor",
  "Check my budget",
];

function createMessageId() {
  return `msg-${crypto.randomUUID()}`;
}

function getDaysRemaining(weddingDate: string | null) {
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

function getPrimaryName(profile: WeddingProfile | null) {
  const rawName = profile?.partner1_name || profile?.partner2_name || "there";
  return rawName.split(" ")[0] ?? "there";
}

function getUserInitials(profile: WeddingProfile | null) {
  const firstInitial = profile?.partner1_name?.trim().charAt(0).toUpperCase() ?? "";
  const secondInitial = profile?.partner2_name?.trim().charAt(0).toUpperCase() ?? "";

  if (firstInitial && secondInitial) {
    return `${firstInitial} & ${secondInitial}`;
  }

  return firstInitial || secondInitial || "W";
}

function getOpeningMessage(profile: WeddingProfile | null) {
  const name = getPrimaryName(profile);
  const daysRemaining = getDaysRemaining(profile?.wedding_date ?? null);
  const city = profile?.city ?? "your city";

  return `Good morning ${name}. I'm your Wedly AI Orchestrator. You have ${
    daysRemaining ?? "some"
  } days until your wedding in ${city}. Based on your profile I've identified 3 things to focus on this week. What would you like to work on today?`;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isFailedAction(result: string) {
  const normalized = result.trim().toLowerCase();
  return normalized.startsWith("failed") || normalized.startsWith("could not");
}

function getActionDataType(tool: string) {
  if (tool === "add_task" || tool === "complete_task" || tool === "delete_task") {
    return "task";
  }

  if (tool === "add_vendor" || tool === "update_vendor_status") {
    return "vendor";
  }

  if (tool === "add_shopping_item") {
    return "shopping";
  }

  return null;
}

function highlightActionText(text: string) {
  return text.split(/(\d[\d,]*|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g).map((part, index) => {
    if (!part) {
      return null;
    }

    if (/^\d[\d,]*$/.test(part)) {
      return (
        <span className="font-medium text-current" key={`${part}-${index}`}>
          {part}
        </span>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

export default function AiOrchestratorPage() {
  const [supabase] = useState(() => createClient());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pendingAssistantMessageId, setPendingAssistantMessageId] = useState<string | null>(null);
  const [hasLoadedOpeningMessage, setHasLoadedOpeningMessage] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const user = useWeddingStore((state) => state.user);
  const weddingProfile = useWeddingStore((state) => state.weddingProfile);
  const setIsOnboarded = useWeddingStore((state) => state.setIsOnboarded);
  const setUser = useWeddingStore((state) => state.setUser);
  const setWeddingProfile = useWeddingStore((state) => state.setWeddingProfile);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      let nextUser = user;

      if (!nextUser) {
        const {
          data: { user: fetchedUser },
        } = await supabase.auth.getUser();

        if (!isMounted) {
          return;
        }

        nextUser = fetchedUser ?? null;
        setUser(nextUser);
      }

      if (!nextUser) {
        return;
      }

      try {
        const profile = await getWeddingProfileForUser(supabase, nextUser.id);

        if (!isMounted) {
          return;
        }

        setWeddingProfile(profile);
        setIsOnboarded(Boolean(profile));
      } catch {}
    }

    void loadProfile();

    return () => {
      isMounted = false;
    };
  }, [setIsOnboarded, setUser, setWeddingProfile, supabase, user]);

  useEffect(() => {
    if (!weddingProfile || hasLoadedOpeningMessage) {
      return;
    }

    setMessages([
      {
        content: getOpeningMessage(weddingProfile),
        id: createMessageId(),
        role: "assistant",
        timestamp: new Date().toISOString(),
      },
    ]);
    setHasLoadedOpeningMessage(true);
  }, [hasLoadedOpeningMessage, weddingProfile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
  }, [inputValue]);

  const userInitials = useMemo(() => getUserInitials(weddingProfile), [weddingProfile]);

  const emitDataUpdates = (actions: OrchestratorAction[]) => {
    const nextTypes = new Set<string>();

    actions.forEach((action) => {
      if (isFailedAction(action.result)) {
        return;
      }

      const dataType = getActionDataType(action.tool);

      if (dataType) {
        nextTypes.add(dataType);
      }
    });

    nextTypes.forEach((type) => {
      window.dispatchEvent(new CustomEvent("wedly-data-updated", { detail: { type } }));
    });
  };

  const handleSendMessage = async (rawMessage?: string) => {
    const trimmedMessage = (rawMessage ?? inputValue).trim();

    if (!trimmedMessage || isSending) {
      return;
    }

    const nextUserMessage: ChatMessage = {
      content: trimmedMessage,
      id: createMessageId(),
      role: "user",
      timestamp: new Date().toISOString(),
    };

    const assistantMessageId = createMessageId();
    const assistantMessage: ChatMessage = {
      actions: [],
      content: "",
      id: assistantMessageId,
      role: "assistant",
      timestamp: new Date().toISOString(),
    };

    const nextMessages = [...messages, nextUserMessage];

    setMessages([...nextMessages, assistantMessage]);
    setInputValue("");
    setIsSending(true);
    setPendingAssistantMessageId(assistantMessageId);

    try {
      const response = await fetch("/api/orchestrator", {
        body: JSON.stringify({
          messages: nextMessages.map((message) => ({
            content: message.content,
            role: message.role,
          })),
          userId: user?.id,
          weddingProfile,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error((await response.text()) || "We couldn't reach your orchestrator right now.");
      }

      const data = (await response.json()) as OrchestratorResponse;

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                actions: data.actions ?? [],
                content: data.message,
              }
            : message,
        ),
      );

      emitDataUpdates(data.actions ?? []);
    } catch (error) {
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                actions: [],
                content:
                  error instanceof Error
                    ? error.message
                    : "Something went wrong while contacting Wedly.",
              }
            : message,
        ),
      );
    } finally {
      setIsSending(false);
      setPendingAssistantMessageId(null);
    }
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await handleSendMessage();
    }
  };

  const showQuickActions =
    !isSending &&
    (messages.length === 0 || messages[messages.length - 1]?.role === "assistant");

  return (
    <section className="h-[calc(100vh-116px)] overflow-hidden rounded-[18px] bg-[#FAF7F2]">
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-7">
          <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6">
            {messages.map((message) => {
              const isAssistant = message.role === "assistant";
              const isThinking =
                pendingAssistantMessageId === message.id && message.content.length === 0;

              return (
                <div
                  className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
                  key={message.id}
                >
                  <div
                    className={`flex items-end gap-3 ${
                      isAssistant ? "flex-row" : "flex-row-reverse"
                    }`}
                    style={{ maxWidth: isAssistant ? "88%" : "72%" }}
                  >
                    <div
                      className={`flex h-8 min-w-8 items-center justify-center rounded-full text-[12px] font-semibold ${
                        isAssistant
                          ? "bg-[#F7EED7] text-[#C9A84C]"
                          : "bg-[#F0E6D5] text-[#8B6B16]"
                      }`}
                    >
                      {isAssistant ? "✦" : userInitials}
                    </div>

                    <div className={`flex flex-col ${isAssistant ? "items-start" : "items-end"}`}>
                      {isAssistant && message.actions?.length ? (
                        <div className="mb-2 flex w-full flex-col gap-2">
                          {message.actions.map((action, index) => {
                            const failed = isFailedAction(action.result);

                            return (
                              <div
                                className="rounded-[10px] border px-[14px] py-[8px]"
                                key={`${action.tool}-${index}`}
                                style={{
                                  background: failed ? "#FDF2F0" : "#E8F5EE",
                                  borderColor: failed
                                    ? "rgba(192,57,43,0.2)"
                                    : "rgba(46,125,82,0.2)",
                                }}
                              >
                                <p
                                  className="text-[12px]"
                                  style={{ color: failed ? "#C0392B" : "#2E7D52" }}
                                >
                                  <span className="mr-1 font-medium">
                                    {failed ? "✗" : "✓"}
                                  </span>
                                  {highlightActionText(action.result)}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      <div
                        className={`w-full rounded-[16px] px-5 py-4 ${
                          isAssistant
                            ? "rounded-tl-[4px] border border-[#E8E2D9] bg-white text-[#1C1A17]"
                            : "rounded-tr-[4px] bg-[#1C1A17] text-[#FAF7F2]"
                        }`}
                      >
                        {isThinking ? (
                          <p className="text-[12px] italic text-[#C9A84C]">
                            ✦ Wedly is thinking...
                          </p>
                        ) : (
                          <p className="whitespace-pre-wrap text-[14px] leading-7">
                            {message.content}
                          </p>
                        )}
                      </div>
                      <p className="mt-2 text-[11px] text-[#B8B2A7]">
                        {formatTimestamp(message.timestamp)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="border-t border-[#E8E2D9] bg-white p-4 md:p-4">
          <div className="mx-auto w-full max-w-[1120px]">
            <div className="flex items-end gap-3">
              <textarea
                aria-label="Message your AI wedding orchestrator"
                className="max-h-[100px] min-h-[46px] flex-1 resize-none rounded-[24px] border border-[#E8E2D9] bg-[#FAF7F2] px-4 py-[10px] text-[14px] leading-6 text-[#1C1A17] outline-none transition-colors duration-200 placeholder:text-[#9C9589] focus:border-[#C9A84C]"
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Wedly what to focus on next..."
                ref={textareaRef}
                rows={1}
                value={inputValue}
              />

              <button
                aria-label="Send message"
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border border-[#1C1A17] bg-[#1C1A17] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSending || !inputValue.trim()}
                onClick={() => void handleSendMessage()}
                type="button"
              >
                <ArrowUp className="h-4 w-4 text-[#C9A84C]" strokeWidth={2.1} />
              </button>
            </div>

            {showQuickActions ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {quickActionChips.map((chip) => (
                  <button
                    className="rounded-full border border-[#E8E2D9] bg-transparent px-[14px] py-[6px] text-[12px] text-[#8B8378] transition-colors hover:border-[#C9A84C]"
                    key={chip}
                    onClick={() => void handleSendMessage(chip)}
                    type="button"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
