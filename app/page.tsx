"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { Database, WeddingProfile } from "@/lib/supabase/types";
import { useWeddingStore } from "@/store/weddingStore";

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

type CommsMessageRow = {
  created_at?: string | null;
  id: string;
  recipient?: string | null;
  sent_at?: string | null;
  status: "pending" | "sent";
  updated_at?: string | null;
  user_id: string;
};

type WeddingProfileWithCreatedAt = WeddingProfile & {
  created_at?: string | null;
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
      wedding_profiles: {
        Insert: WeddingProfileWithCreatedAt & { id?: string; user_id: string };
        Relationships: [];
        Row: WeddingProfileWithCreatedAt & { id: string; user_id: string };
        Update: Partial<WeddingProfileWithCreatedAt> & {
          id?: string;
          user_id?: string;
        };
      };
    };
    Views: Database["public"]["Views"];
  };
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

type CachedDashboardDaily = {
  data: DashboardDaily;
};

type DailyPayload = {
  guests: GuestRow[];
  pendingMessageCount: number;
  tasks: TaskRow[];
  vendors: VendorRow[];
};

function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCacheKey(userId: string, dateKey: string) {
  return `wedly_dashboard_${userId}_${dateKey}`;
}

function readCachedDaily(userId: string, dateKey: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(getCacheKey(userId, dateKey));

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as CachedDashboardDaily;

    if (!parsed || !parsed.data || typeof parsed.data !== "object") {
      window.localStorage.removeItem(getCacheKey(userId, dateKey));
      return null;
    }

    return parsed.data;
  } catch {
    window.localStorage.removeItem(getCacheKey(userId, dateKey));
    return null;
  }
}

function writeCachedDaily(userId: string, dateKey: string, data: DashboardDaily) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    getCacheKey(userId, dateKey),
    JSON.stringify({ data } satisfies CachedDashboardDaily),
  );
}

function getGreetingByTime(date: Date) {
  const hours = date.getHours();

  if (hours < 12) {
    return "Good morning";
  }

  if (hours < 17) {
    return "Good afternoon";
  }

  return "Good evening";
}

function formatHeroDate(value: string | null | undefined) {
  if (!value) {
    return "Wedding date";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "Wedding date";
  }

  return date
    .toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    .replace(",", "");
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

  return Math.ceil(
    (eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
}

function getPlanningProgress(
  planningStartDate: string | null | undefined,
  weddingDate: string | null | undefined,
) {
  if (!weddingDate) {
    return null;
  }

  const wedding = new Date(
    weddingDate.includes("T") ? weddingDate : `${weddingDate}T00:00:00`,
  );

  if (Number.isNaN(wedding.getTime())) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = planningStartDate
    ? new Date(
        planningStartDate.includes("T")
          ? planningStartDate
          : `${planningStartDate}T00:00:00`,
      )
    : new Date(today);

  if (Number.isNaN(start.getTime())) {
    start.setTime(today.getTime());
  }

  start.setHours(0, 0, 0, 0);

  const totalDays = Math.max(
    1,
    Math.ceil((wedding.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const daysRemaining = Math.max(
    0,
    Math.ceil((wedding.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const progressRatio = Math.min(
    1,
    Math.max(0, 1 - daysRemaining / totalDays),
  );

  return {
    bottomFillRatio: progressRatio,
    daysRemaining,
    topFillRatio: 1 - progressRatio,
    totalDays,
  };
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

function formatShortDueDate(value: string | null | undefined) {
  if (!value) {
    return "today";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "today";
  }

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
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
      ? `It is the nearest unfinished ${nextTask.priority} priority task, due ${formatShortDueDate(nextTask.due_date)}.`
      : "It is the clearest unfinished thread in your wedding plan right now.",
    title: nextTask.title,
  } satisfies DailyTask;
}

function buildFallbackDaily(
  dateKey: string,
  tasks: TaskRow[],
  pendingMessageCount: number,
) {
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

  const seed = dateKey
    .split("")
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const overdueTasks = tasks.filter((task) => isTaskOverdue(task));

  return {
    agent_screen:
      pendingMessageCount > 0 ? "comms" : overdueTasks.length > 0 ? "timeline" : "timeline",
    agent_update:
      pendingMessageCount > 0
        ? `You have ${pendingMessageCount} message${pendingMessageCount === 1 ? "" : "s"} waiting for approval, and clearing them could unlock replies today.`
        : overdueTasks.length > 0
          ? `${overdueTasks[0].title} is already overdue, and that quiet delay is the clearest pressure point in your plan right now.`
          : null,
    daily_quote: quotes[seed % quotes.length],
    most_important_task: getMostImportantTask(tasks),
  } satisfies DashboardDaily;
}

function renderHighlightedNotice(text: string) {
  const parts = text.split(/(\d[\d,./-]*)/g);

  return parts.map((part, index) => {
    if (!part) {
      return null;
    }

    if (/\d/.test(part)) {
      return (
        <span
          className="font-medium not-italic text-[rgba(250,247,242,0.85)]"
          key={`${part}-${index}`}
        >
          {part}
        </span>
      );
    }

    return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
  });
}

function ShimmerBlock({ className }: { className: string }) {
  return (
    <div
      className={`rounded-full bg-[rgba(255,255,255,0.05)] animate-[dashboardShimmer_1.5s_ease-in-out_infinite] ${className}`}
    />
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [browserSupabase] = useState(() => createClient());
  const supabase =
    browserSupabase as unknown as SupabaseClient<ExtendedDatabase>;

  const user = useWeddingStore((state) => state.user);
  const weddingProfile = useWeddingStore((state) => state.weddingProfile);
  const setIsOnboarded = useWeddingStore((state) => state.setIsOnboarded);
  const planningStartDate = useWeddingStore((state) => state.planningStartDate);
  const setPlanningStartDate = useWeddingStore((state) => state.setPlanningStartDate);
  const setUser = useWeddingStore((state) => state.setUser);
  const setWeddingProfile = useWeddingStore((state) => state.setWeddingProfile);

  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [daily, setDaily] = useState<DashboardDaily | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [confirmedGuestCount, setConfirmedGuestCount] = useState(0);
  const [isDailyLoading, setIsDailyLoading] = useState(true);

  const hasLoadedRef = useRef(false);
  const heroCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hourglassCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCurrentTime(new Date());
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const todayKey = useMemo(() => getTodayKey(currentTime), [currentTime]);

  const loadDaily = useCallback(
    async (
      currentUser: User,
      profile: WeddingProfileWithCreatedAt,
      payload: DailyPayload,
      forceRefresh: boolean,
    ) => {
      setIsDailyLoading(true);

      try {
        if (!forceRefresh) {
          const cached = readCachedDaily(currentUser.id, todayKey);

          if (cached) {
            setDaily(cached);
            setIsDailyLoading(false);
            return;
          }
        }

        const response = await fetch("/api/dashboard-daily", {
          body: JSON.stringify({
            dateSeed: todayKey,
            guests: payload.guests,
            pendingMessageCount: payload.pendingMessageCount,
            tasks: payload.tasks,
            vendors: payload.vendors,
            weddingProfile: {
              city: profile.city,
              partner1_name: profile.partner1_name,
              partner2_name: profile.partner2_name,
              wedding_date: profile.wedding_date,
              wedding_type: profile.wedding_type,
            },
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        if (!response.ok) {
          throw new Error("Could not load daily briefing.");
        }

        const nextDaily = (await response.json()) as DashboardDaily;
        setDaily(nextDaily);
        writeCachedDaily(currentUser.id, todayKey, nextDaily);
      } catch {
        setDaily(
          buildFallbackDaily(
            todayKey,
            payload.tasks,
            payload.pendingMessageCount,
          ),
        );
      } finally {
        setIsDailyLoading(false);
      }
    },
    [todayKey],
  );

  const loadDashboard = useCallback(async () => {
    try {
      let nextUser = user;

      if (!nextUser) {
        const {
          data: { user: fetchedUser },
          error: userError,
        } = await browserSupabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        nextUser = fetchedUser ?? null;
        setUser(nextUser);
      }

      if (!nextUser) {
        throw new Error("No signed-in user found.");
      }

      const profilePromise = weddingProfile
        ? Promise.resolve({
            data: weddingProfile as WeddingProfileWithCreatedAt,
            error: null,
          })
        : supabase
            .from("wedding_profiles")
            .select("partner1_name, partner2_name, wedding_date, city, wedding_type, role, budget, guest_count, created_at")
            .eq("user_id", nextUser.id)
            .maybeSingle()
            .overrideTypes<WeddingProfileWithCreatedAt | null, { merge: false }>();

      const [profileResponse, tasksResponse, vendorsResponse, guestsResponse, commsResponse] =
        await Promise.all([
          profilePromise,
          supabase.from("tasks").select("*").eq("user_id", nextUser.id),
          supabase.from("vendors").select("*").eq("user_id", nextUser.id),
          supabase.from("guests").select("*").eq("user_id", nextUser.id),
          supabase
            .from("comms_messages")
            .select("*", { count: "exact", head: true })
            .eq("user_id", nextUser.id)
            .eq("status", "pending"),
        ]);

      if (profileResponse.error) {
        throw profileResponse.error;
      }

      if (tasksResponse.error) {
        throw tasksResponse.error;
      }

      if (vendorsResponse.error) {
        throw vendorsResponse.error;
      }

      if (guestsResponse.error) {
        throw guestsResponse.error;
      }

      if (commsResponse.error) {
        throw commsResponse.error;
      }

      const nextProfile = profileResponse.data;

      if (!nextProfile) {
        throw new Error("Wedding profile not found.");
      }

      setWeddingProfile({
        budget: nextProfile.budget,
        city: nextProfile.city,
        guest_count: nextProfile.guest_count,
        partner1_name: nextProfile.partner1_name,
        partner2_name: nextProfile.partner2_name,
        role: nextProfile.role,
        wedding_date: nextProfile.wedding_date,
        wedding_type: nextProfile.wedding_type,
      });
      setPlanningStartDate(nextProfile.created_at ?? null);
      setIsOnboarded(true);

      const nextTasks = (tasksResponse.data ?? []) as TaskRow[];
      const nextVendors = (vendorsResponse.data ?? []) as VendorRow[];
      const nextGuests = (guestsResponse.data ?? []) as GuestRow[];
      const nextPendingComms = commsResponse.count ?? 0;

      setTasks(nextTasks);
      setVendors(nextVendors);
      setConfirmedGuestCount(
        nextGuests.filter((guest) => guest.rsvp_status === "Confirmed").length,
      );
      await loadDaily(
        nextUser,
        nextProfile,
        {
          guests: nextGuests,
          pendingMessageCount: nextPendingComms,
          tasks: nextTasks,
          vendors: nextVendors,
        },
        false,
      );
    } catch {
      setDaily(buildFallbackDaily(todayKey, [], 0));
      setTasks([]);
      setVendors([]);
      setConfirmedGuestCount(0);
      setIsDailyLoading(false);
    }
  }, [
    browserSupabase,
    loadDaily,
    setIsOnboarded,
    setPlanningStartDate,
    setUser,
    setWeddingProfile,
    supabase,
    todayKey,
    user,
    weddingProfile,
  ]);

  useEffect(() => {
    if (hasLoadedRef.current) {
      return;
    }

    hasLoadedRef.current = true;
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const canvas = heroCanvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const petals = [
      { baseX: 40, baseY: 50, color: "rgba(201,168,76,0.35)", size: 12, speed: 0.012, t: 0.3 },
      { baseX: 100, baseY: 200, color: "rgba(194,124,110,0.3)", size: 16, speed: 0.011, t: 1.1 },
      { baseX: 180, baseY: 90, color: "rgba(201,168,76,0.35)", size: 14, speed: 0.015, t: 2.6 },
      { baseX: 60, baseY: 260, color: "rgba(194,124,110,0.3)", size: 18, speed: 0.014, t: 1.8 },
      { baseX: 280, baseY: 40, color: "rgba(201,168,76,0.35)", size: 11, speed: 0.017, t: 0.8 },
      { baseX: 220, baseY: 230, color: "rgba(194,124,110,0.3)", size: 20, speed: 0.009, t: 3.1 },
      { baseX: 340, baseY: 180, color: "rgba(201,168,76,0.35)", size: 15, speed: 0.013, t: 2.1 },
      { baseX: 130, baseY: 280, color: "rgba(194,124,110,0.3)", size: 13, speed: 0.02, t: 0.5 },
      { baseX: 390, baseY: 80, color: "rgba(201,168,76,0.35)", size: 17, speed: 0.01, t: 2.9 },
    ];

    const rings = [
      { baseX: 70, baseY: 160, color: "rgba(201,168,76,0.28)", radius: 8, speed: 0.01, t: 1.4 },
      { baseX: 200, baseY: 60, color: "rgba(194,124,110,0.25)", radius: 10, speed: 0.016, t: 0.6 },
      { baseX: 300, baseY: 240, color: "rgba(201,168,76,0.28)", radius: 14, speed: 0.012, t: 2.3 },
      { baseX: 160, baseY: 220, color: "rgba(194,124,110,0.25)", radius: 9, speed: 0.008, t: 1.9 },
      { baseX: 380, baseY: 160, color: "rgba(201,168,76,0.28)", radius: 12, speed: 0.018, t: 0.1 },
    ];

    const sparkles = [
      { baseX: 120, baseY: 120, color: "rgba(201,168,76,0.6)", size: 4, speed: 0.01, t: 0.4 },
      { baseX: 250, baseY: 170, color: "rgba(194,124,110,0.5)", size: 5, speed: 0.014, t: 2.2 },
      { baseX: 80, baseY: 300, color: "rgba(201,168,76,0.6)", size: 3, speed: 0.009, t: 1.5 },
      { baseX: 320, baseY: 120, color: "rgba(194,124,110,0.5)", size: 4, speed: 0.013, t: 0.9 },
      { baseX: 190, baseY: 300, color: "rgba(201,168,76,0.6)", size: 5, speed: 0.02, t: 2.7 },
      { baseX: 350, baseY: 250, color: "rgba(194,124,110,0.5)", size: 4, speed: 0.011, t: 1.2 },
    ];

    let animationFrame = 0;

    const resizeCanvas = () => {
      const parent = canvas.parentElement;

      if (!parent) {
        return;
      }

      const rect = parent.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;

      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const drawSparkle = (
      x: number,
      y: number,
      size: number,
      color: string,
      alpha: number,
    ) => {
      context.save();
      context.translate(x, y);
      context.fillStyle = color.replace(/[\d.]+\)$/, `${alpha})`);

      for (let index = 0; index < 4; index += 1) {
        context.save();
        context.rotate((Math.PI / 2) * index);
        context.beginPath();
        context.moveTo(0, -size);
        context.lineTo(size * 0.42, 0);
        context.lineTo(-size * 0.42, 0);
        context.closePath();
        context.fill();
        context.restore();
      }

      context.restore();
    };

    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      context.clearRect(0, 0, width, height);

      if (window.innerWidth < 768) {
        animationFrame = window.requestAnimationFrame(render);
        return;
      }

      const drawableWidth = width * 0.65;

      petals.forEach((petal) => {
        petal.t += petal.speed;
        const x = (petal.baseX / 440) * drawableWidth;
        const y = (petal.baseY / 320) * height + Math.sin(petal.t) * 8;
        const rotation = Math.sin(petal.t * 0.8) * 0.6;

        context.save();
        context.translate(x, y);
        context.rotate(rotation);
        context.fillStyle = petal.color;
        context.beginPath();
        context.ellipse(0, 0, petal.size, petal.size * 0.45, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();
      });

      rings.forEach((ring) => {
        ring.t += ring.speed;
        const x = (ring.baseX / 440) * drawableWidth;
        const y = (ring.baseY / 320) * height + Math.sin(ring.t) * 6;
        const alpha = 0.16 + Math.abs(Math.sin(ring.t)) * 0.2;

        context.save();
        context.strokeStyle = ring.color.replace(/[\d.]+\)$/, `${alpha})`);
        context.lineWidth = 1.1;
        context.beginPath();
        context.arc(x, y, ring.radius, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      });

      sparkles.forEach((sparkle) => {
        sparkle.t += sparkle.speed;
        const x = (sparkle.baseX / 440) * drawableWidth;
        const y = (sparkle.baseY / 320) * height + Math.sin(sparkle.t) * 5;
        const alpha = 0.2 + Math.abs(Math.sin(sparkle.t)) * 0.5;

        drawSparkle(x, y, sparkle.size, sparkle.color, alpha);
      });

      animationFrame = window.requestAnimationFrame(render);
    };

    resizeCanvas();
    render();

    window.addEventListener("resize", resizeCanvas);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  useEffect(() => {
    const canvas = hourglassCanvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    type Particle = {
      alpha: number;
      size: number;
      vy: number;
      x: number;
      y: number;
    };

    const ratio = window.devicePixelRatio || 1;
    const width = 110;
    const height = 200;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const cx = width / 2;
    let animationFrame = 0;
    let lastTimestamp = 0;
    const planningProgress = getPlanningProgress(
      planningStartDate,
      weddingProfile?.wedding_date,
    );
    const targetTopFill = planningProgress?.topFillRatio ?? 0.72;
    const targetBottomFill = planningProgress?.bottomFillRatio ?? 0.28;
    let displayTopFill = targetTopFill;
    let displayBottomFill = targetBottomFill;
    let nextSpawnDelay = 660;
    let spawnAccumulator = 0;
    const particles: Particle[] = [];

    const drawHourglassPath = () => {
      context.beginPath();
      context.moveTo(cx, 8);
      context.bezierCurveTo(cx + 48, 8, cx + 52, 18, cx + 52, 36);
      context.bezierCurveTo(cx + 52, 56, cx + 40, 68, cx + 7, 90);
      context.bezierCurveTo(cx + 3, 94, cx + 2, 98, cx + 7, 102);
      context.bezierCurveTo(cx + 40, 124, cx + 52, 138, cx + 52, 158);
      context.bezierCurveTo(cx + 52, 178, cx + 48, 190, cx, 194);
      context.bezierCurveTo(cx - 48, 190, cx - 52, 178, cx - 52, 158);
      context.bezierCurveTo(cx - 52, 138, cx - 40, 124, cx - 7, 102);
      context.bezierCurveTo(cx - 2, 98, cx - 3, 94, cx - 7, 90);
      context.bezierCurveTo(cx - 40, 68, cx - 52, 56, cx - 52, 36);
      context.bezierCurveTo(cx - 52, 18, cx - 48, 8, cx, 8);
      context.closePath();
    };

    const drawSandSurface = (
      leftX: number,
      rightX: number,
      y: number,
      peak: number,
    ) => {
      context.beginPath();
      context.moveTo(leftX, y + 1);
      context.quadraticCurveTo(cx, y - peak, rightX, y + 1);
      context.stroke();
    };

    const render = (timestamp: number) => {
      if (!lastTimestamp) {
        lastTimestamp = timestamp;
      }

      const delta = timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      context.clearRect(0, 0, width, height);

      const glassGradient = context.createLinearGradient(0, 0, width, 0);
      glassGradient.addColorStop(0, "rgba(225,205,154,0.26)");
      glassGradient.addColorStop(0.18, "rgba(145,118,54,0.14)");
      glassGradient.addColorStop(0.5, "rgba(18,14,9,0.66)");
      glassGradient.addColorStop(0.82, "rgba(145,118,54,0.14)");
      glassGradient.addColorStop(1, "rgba(225,205,154,0.26)");

      drawHourglassPath();
      context.fillStyle = glassGradient;
      context.fill();

      context.save();
      drawHourglassPath();
      context.clip();

      displayTopFill += (targetTopFill - displayTopFill) * 0.02;
      displayBottomFill += (targetBottomFill - displayBottomFill) * 0.02;

      const topSurfaceY = 18 + (1 - displayTopFill) * 54;
      const bottomSurfaceY = 190 - displayBottomFill * 72;

      const topGradient = context.createLinearGradient(0, topSurfaceY, 0, 96);
      topGradient.addColorStop(0, "rgba(251,232,158,0.98)");
      topGradient.addColorStop(0.6, "rgba(210,176,83,0.92)");
      topGradient.addColorStop(1, "rgba(171,134,38,0.82)");
      context.fillStyle = topGradient;
      context.fillRect(cx - 62, topSurfaceY, 124, 96 - topSurfaceY);

      context.strokeStyle = "rgba(255,240,194,0.92)";
      context.lineWidth = 1.15;
      drawSandSurface(cx - 32, cx + 32, topSurfaceY, 3);

      const bottomGradient = context.createLinearGradient(0, bottomSurfaceY, 0, 194);
      bottomGradient.addColorStop(0, "rgba(248,223,134,0.98)");
      bottomGradient.addColorStop(0.55, "rgba(216,183,82,0.92)");
      bottomGradient.addColorStop(1, "rgba(173,136,43,0.86)");
      context.fillStyle = bottomGradient;
      context.fillRect(cx - 62, bottomSurfaceY, 124, 194 - bottomSurfaceY);

      drawSandSurface(cx - 36, cx + 36, bottomSurfaceY, 5);

      const neckGlow = context.createRadialGradient(cx, 96, 0, cx, 96, 9);
      neckGlow.addColorStop(0, "rgba(235,203,111,0.8)");
      neckGlow.addColorStop(1, "rgba(201,168,76,0)");
      context.fillStyle = neckGlow;
      context.beginPath();
      context.arc(cx, 96, 9, 0, Math.PI * 2);
      context.fill();

      const canDrip = targetTopFill > 0.02 && targetBottomFill < 0.98;

      spawnAccumulator += delta;
      if (canDrip && spawnAccumulator >= nextSpawnDelay) {
        spawnAccumulator = 0;
        nextSpawnDelay = 660 + Math.random() * 260;
        particles.push({
          alpha: 1,
          size: 1.6 + Math.random() * 0.9,
          vy: 0.28,
          x: cx + (Math.random() - 0.5) * 1.6,
          y: 96,
        });
      }

      if (canDrip) {
        context.strokeStyle = "rgba(239,214,126,0.78)";
        context.lineWidth = 1.1;
        context.beginPath();
        context.moveTo(cx, 96);
        context.lineTo(cx, Math.min(bottomSurfaceY - 5, 118));
        context.stroke();
      }

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.vy += 0.07;
        particle.y += particle.vy;

        if (particle.y >= bottomSurfaceY - 2) {
          particle.y = bottomSurfaceY - 2;
          particle.alpha -= 0.08;
        }

        if (bottomSurfaceY - particle.y < 12) {
          particle.alpha = Math.max(0, (bottomSurfaceY - particle.y) / 12);
        }

        if (particle.alpha <= 0) {
          particles.splice(index, 1);
          continue;
        }

        context.fillStyle = `rgba(248,226,145,${particle.alpha})`;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        context.fill();
      }

      context.restore();

      drawHourglassPath();
      context.strokeStyle = "rgba(214,182,93,0.42)";
      context.lineWidth = 1.7;
      context.stroke();

      context.beginPath();
      context.moveTo(cx - 30, 24);
      context.bezierCurveTo(cx - 42, 44, cx - 40, 74, cx - 16, 116);
      context.strokeStyle = "rgba(255,255,255,0.08)";
      context.lineWidth = 4.5;
      context.stroke();

      context.beginPath();
      context.moveTo(cx + 30, 28);
      context.bezierCurveTo(cx + 38, 44, cx + 34, 66, cx + 18, 88);
      context.strokeStyle = "rgba(255,255,255,0.03)";
      context.lineWidth = 2.2;
      context.stroke();

      context.fillStyle = "rgba(255,255,255,0.06)";
      context.beginPath();
      context.ellipse(cx - 20, 26, 12, 4.5, -0.2, 0, Math.PI * 2);
      context.fill();

      animationFrame = window.requestAnimationFrame(render);
    };

    animationFrame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [planningStartDate, weddingProfile?.wedding_date]);

  const greeting = useMemo(() => getGreetingByTime(currentTime), [currentTime]);
  const partner1Name = weddingProfile?.partner1_name?.trim() || "Your wedding";
  const partner2Name = weddingProfile?.partner2_name?.trim() || "";
  const heroDateLabel = useMemo(
    () => formatHeroDate(weddingProfile?.wedding_date),
    [weddingProfile?.wedding_date],
  );
  const daysRemaining = useMemo(
    () => getDaysRemaining(weddingProfile?.wedding_date),
    [weddingProfile?.wedding_date],
  );
  const isWeddingDay = daysRemaining != null && daysRemaining <= 0;
  const totalBudget = weddingProfile?.budget ?? 0;
  const allocatedBudget = useMemo(() => {
    const byCategory = new Map<string, number>();

    for (const vendor of vendors) {
      const category = vendor.category.trim();

      if (!category) {
        continue;
      }

      byCategory.set(
        category,
        Math.max(byCategory.get(category) ?? 0, vendor.budget_allocated ?? 0),
      );
    }

    return [...byCategory.values()].reduce((sum, value) => sum + value, 0);
  }, [vendors]);
  const remainingBudget = totalBudget - allocatedBudget;
  const completedTaskCount = useMemo(
    () => tasks.filter((task) => task.status === "completed").length,
    [tasks],
  );
  const bookedVendorCount = useMemo(
    () => vendors.filter((vendor) => vendor.status === "booked").length,
    [vendors],
  );
  const budgetProgress =
    totalBudget > 0 ? Math.min(100, (allocatedBudget / totalBudget) * 100) : 0;
  const vendorProgress =
    vendors.length > 0 ? Math.min(100, (bookedVendorCount / vendors.length) * 100) : 0;
  const guestProgress =
    (weddingProfile?.guest_count ?? 0) > 0
      ? Math.min(100, (confirmedGuestCount / (weddingProfile?.guest_count ?? 1)) * 100)
      : 0;

  return (
    <section className="flex flex-col gap-[18px] bg-[#FAF7F2] px-7 pb-7 pt-5">
      <style jsx>{`
        @keyframes dashboardShimmer {
          0%,
          100% {
            background-color: rgba(255, 255, 255, 0.03);
          }
          50% {
            background-color: rgba(255, 255, 255, 0.08);
          }
        }

        @keyframes pulseDot {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.3;
          }
        }
      `}</style>

      <section className="relative min-h-[300px] overflow-hidden bg-[#FAF7F2] px-14 py-12 max-md:min-h-0 max-md:px-6 max-md:py-8">
        <div className="pointer-events-none absolute left-[-150px] top-[-200px] z-0 h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(201,168,76,0.18)_0%,rgba(201,168,76,0.06)_40%,transparent_70%)] max-md:hidden" />
        <div className="pointer-events-none absolute bottom-[-120px] left-[220px] z-0 h-[350px] w-[350px] rounded-full bg-[radial-gradient(circle,rgba(194,124,110,0.14)_0%,transparent_70%)] max-md:hidden" />
        <canvas
          className="pointer-events-none absolute inset-0 z-[1] h-full w-full max-md:hidden"
          ref={heroCanvasRef}
        />

        <div className="relative z-[2] flex min-h-[204px] items-center justify-between gap-10 max-md:flex-col max-md:items-start">
          <div className="flex-1">
            <div className="mb-4 flex items-center gap-2">
              <span
                className="inline-flex h-[5px] w-[5px] rounded-full bg-[#C9A84C]"
                style={{ animation: "pulseDot 2s ease-in-out infinite" }}
              />
              <p className="font-sans text-[13px] uppercase tracking-[0.14em] text-[#B8A96A]">
                {greeting}
              </p>
            </div>

            <h1 className="max-w-[440px] font-display text-[30px] font-light italic leading-[1.45] text-[#1C1A17] max-md:text-[26px]">
              <span className="font-normal text-[#C9A84C] not-italic">
                {partner1Name} &amp; {partner2Name || "your person"}
              </span>{" "}
              are getting married in{" "}
              <span className="border-b border-[rgba(201,168,76,0.4)] not-italic">
                {weddingProfile?.city ?? "your city"}
              </span>{" "}
              — and every detail matters.
            </h1>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <span className="h-px w-[60px] bg-[linear-gradient(90deg,transparent,rgba(201,168,76,0.6))]" />
              <span className="h-[7px] w-[7px] rotate-45 bg-[#C9A84C] opacity-70" />
              <span className="font-display text-[14px] uppercase tracking-[0.2em] text-[#A8841F]">
                {heroDateLabel}
              </span>
              <span className="h-[7px] w-[7px] rotate-45 bg-[#C9A84C] opacity-70" />
              <span className="h-px w-[60px] bg-[linear-gradient(90deg,rgba(201,168,76,0.6),transparent)]" />
            </div>
          </div>

          <div className="relative z-[2] flex shrink-0 items-center gap-7 rounded-[28px] bg-[#1C1A17] px-9 py-7 max-md:w-full max-md:justify-between max-md:px-6 max-md:py-5">
            <canvas
              className="h-[200px] w-[110px] shrink-0"
              ref={hourglassCanvasRef}
            />

            <div className="grid min-w-[220px] grid-rows-[auto_116px_auto] self-stretch py-3 max-md:min-w-0 max-md:grid-rows-[auto_96px_auto]">
              <p className="self-start font-sans text-[9px] uppercase tracking-[0.16em] text-[rgba(201,168,76,0.4)]">
                {isWeddingDay ? "today is the day" : "days remaining"}
              </p>
              <div className="flex items-center self-center">
                <p
                  className={`font-display font-light leading-[0.78] tracking-[-0.03em] text-[#C9A84C] max-md:text-[58px] ${
                    isWeddingDay ? "text-[50px]" : "text-[64px]"
                  }`}
                >
                  {isWeddingDay
                    ? "Today"
                    : daysRemaining != null
                      ? Math.max(daysRemaining, 0)
                      : "—"}
                </p>
              </div>
              <div className="flex flex-col items-start justify-end gap-3 self-end pb-1">
                <p className="font-sans text-[10px] uppercase leading-none tracking-[0.12em] text-[rgba(250,247,242,0.25)]">
                  {isWeddingDay ? "your wedding day" : "days to go"}
                </p>
                <span className="h-px w-10 bg-[rgba(201,168,76,0.5)]" />
                <p className="font-display text-[14px] italic leading-none text-[rgba(201,168,76,0.38)]">
                  {isWeddingDay ? "this moment is yours" : "until you say I do"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="w-full rounded-[44px] border border-[rgba(201,168,76,0.1)] bg-[#1C1A17] shadow-[0_18px_40px_rgba(28,26,23,0.08)] max-md:rounded-[28px]">
        <div className="grid lg:grid-cols-3">
          <div className="border-b border-[rgba(255,255,255,0.05)] px-9 py-7 lg:min-h-[250px] lg:border-b-0 lg:border-r lg:border-r-[rgba(255,255,255,0.05)] lg:pl-12">
            <div className="flex items-center gap-2 font-sans text-[10px] uppercase tracking-[0.12em] text-[rgba(201,168,76,0.78)]">
              <span>✦ Today&apos;s thought</span>
              <span className="h-px flex-1 bg-[rgba(201,168,76,0.22)]" />
            </div>
            {isDailyLoading && !daily ? (
              <div className="mt-7 space-y-4">
                <ShimmerBlock className="h-8 w-8 rounded-none" />
                <ShimmerBlock className="h-5 w-full" />
                <ShimmerBlock className="h-5 w-[86%]" />
                <ShimmerBlock className="h-5 w-[70%]" />
                <ShimmerBlock className="h-4 w-36" />
              </div>
            ) : (
              <>
                <p className="mb-[6px] mt-7 font-display text-[40px] leading-[0.8] text-[rgba(201,168,76,0.28)]">
                  &quot;
                </p>
                <p className="font-display text-[17px] italic leading-[1.75] text-[rgba(250,247,242,0.88)]">
                  {daily?.daily_quote.text ?? ""}
                </p>
                <p className="mt-3 font-sans text-[11px] text-[rgba(250,247,242,0.48)]">
                  — {daily?.daily_quote.author ?? ""}
                </p>
              </>
            )}
          </div>

          <div className="border-b border-[rgba(255,255,255,0.05)] px-9 py-7 lg:min-h-[250px] lg:border-b-0 lg:border-r lg:border-r-[rgba(255,255,255,0.05)] lg:px-8">
            <div className="flex items-center gap-2 font-sans text-[10px] uppercase tracking-[0.12em] text-[rgba(201,168,76,0.78)]">
              <span>✦ Focus for today</span>
              <span className="h-px flex-1 bg-[rgba(201,168,76,0.22)]" />
            </div>
            {isDailyLoading && !daily ? (
              <div className="mt-7 space-y-4">
                <ShimmerBlock className="h-8 w-[72%]" />
                <ShimmerBlock className="h-8 w-[58%]" />
                <ShimmerBlock className="h-4 w-full" />
                <ShimmerBlock className="h-4 w-[88%]" />
                <ShimmerBlock className="h-10 w-40 rounded-[20px]" />
              </div>
            ) : daily?.most_important_task ? (
              <>
                <p className="mt-6 font-display text-[20px] leading-[1.3] text-[rgba(250,247,242,0.96)]">
                  {daily.most_important_task.title}
                </p>
                <p className="mt-2 font-sans text-[12px] leading-[1.6] text-[rgba(250,247,242,0.72)]">
                  {daily.most_important_task.reason}
                </p>
                <button
                  className="mt-4 rounded-[20px] border border-[rgba(201,168,76,0.34)] bg-[rgba(201,168,76,0.14)] px-[14px] py-[7px] font-display text-[14px] text-[#D9B857] transition-colors hover:bg-[rgba(201,168,76,0.22)]"
                  onClick={() => router.push("/timeline")}
                  type="button"
                >
                  Start this task →
                </button>
              </>
            ) : (
              <p className="mt-7 font-display text-[22px] text-[rgba(250,247,242,0.35)]">
                You&apos;re all caught up for today
              </p>
            )}
          </div>

          <div className="px-9 py-7 lg:min-h-[250px] lg:pr-12 lg:pl-8">
            <div className="flex items-center gap-2 font-sans text-[10px] uppercase tracking-[0.12em] text-[rgba(201,168,76,0.78)]">
              <span>✦ Wedly noticed</span>
              <span className="h-px flex-1 bg-[rgba(201,168,76,0.22)]" />
            </div>
            {isDailyLoading && !daily ? (
              <div className="mt-7 space-y-4">
                <ShimmerBlock className="h-4 w-full" />
                <ShimmerBlock className="h-4 w-[92%]" />
                <ShimmerBlock className="h-4 w-[76%]" />
                <ShimmerBlock className="h-4 w-40" />
              </div>
            ) : (
              <>
                <p className="mt-6 font-sans text-[13px] italic leading-[1.7] text-[rgba(250,247,242,0.76)]">
                  {renderHighlightedNotice(
                    daily?.agent_update ?? "Everything looks calm today.",
                  )}
                </p>
                <button
                  className="mt-[14px] inline-flex items-center gap-[6px] font-sans text-[12px] text-[#D9B857] transition-opacity hover:opacity-75"
                  onClick={() =>
                    router.push(
                      daily?.agent_screen
                        ? `/${daily.agent_screen}`
                        : "/timeline",
                    )
                  }
                  type="button"
                >
                  <span
                    className="h-[6px] w-[6px] rounded-full bg-[#D9B857]"
                    style={{ animation: "pulseDot 2s infinite" }}
                  />
                  Review &amp; approve →
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="grid w-full gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[32px] border border-[rgba(201,168,76,0.25)] bg-[#FBF7ED] px-9 py-6 min-h-[128px] max-md:rounded-[24px] max-md:px-6">
          <div className="flex items-center gap-[6px] font-sans text-[10px] uppercase tracking-[0.1em] text-[#B8A96A]">
            <span className="h-[5px] w-[5px] rounded-full bg-[#2E7D52]" />
            <span>Tasks</span>
          </div>
          <p className="mt-3 font-display text-[24px] font-normal leading-[1.2] text-[#1C1A17]">
            {completedTaskCount} of {tasks.length}
          </p>
          <p className="mt-[3px] font-sans text-[11px] text-[#B8A96A]">
            tasks complete
          </p>
          <div className="mt-[10px] h-[2px] rounded-[1px] bg-[rgba(201,168,76,0.15)]">
            <div
              className="h-full rounded-[1px] bg-[#C9A84C]"
              style={{
                width: `${tasks.length > 0 ? (completedTaskCount / tasks.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        <div className="rounded-[32px] border border-[rgba(201,168,76,0.25)] bg-[#FBF7ED] px-9 py-6 min-h-[128px] max-md:rounded-[24px] max-md:px-6">
          <div className="flex items-center gap-[6px] font-sans text-[10px] uppercase tracking-[0.1em] text-[#B8A96A]">
            <span className="h-[5px] w-[5px] rounded-full bg-[#C9A84C]" />
            <span>Budget</span>
          </div>
          <p className="mt-3 font-display text-[24px] font-normal leading-[1.2] text-[#1C1A17]">
            {formatCurrency(remainingBudget)}
          </p>
          <p className="mt-[3px] font-sans text-[11px] text-[#B8A96A]">
            of {formatCurrency(totalBudget)}
          </p>
          <div className="mt-[10px] h-[2px] rounded-[1px] bg-[rgba(201,168,76,0.15)]">
            <div
              className="h-full rounded-[1px] bg-[#C9A84C]"
              style={{ width: `${budgetProgress}%` }}
            />
          </div>
        </div>

        <div className="rounded-[32px] border border-[rgba(201,168,76,0.25)] bg-[#FBF7ED] px-9 py-6 min-h-[128px] max-md:rounded-[24px] max-md:px-6">
          <div className="flex items-center gap-[6px] font-sans text-[10px] uppercase tracking-[0.1em] text-[#B8A96A]">
            <span className="h-[5px] w-[5px] rounded-full bg-[#C27C6E]" />
            <span>Vendors</span>
          </div>
          <p className="mt-3 font-display text-[24px] font-normal leading-[1.2] text-[#1C1A17]">
            {bookedVendorCount} of {vendors.length}
          </p>
          <p className="mt-[3px] font-sans text-[11px] text-[#B8A96A]">
            vendors booked
          </p>
          <div className="mt-[10px] h-[2px] rounded-[1px] bg-[rgba(201,168,76,0.15)]">
            <div
              className="h-full rounded-[1px] bg-[#C9A84C]"
              style={{ width: `${vendorProgress}%` }}
            />
          </div>
        </div>

        <div className="rounded-[32px] border border-[rgba(201,168,76,0.25)] bg-[#FBF7ED] px-9 py-6 min-h-[128px] max-md:rounded-[24px] max-md:px-6">
          <div className="flex items-center gap-[6px] font-sans text-[10px] uppercase tracking-[0.1em] text-[#B8A96A]">
            <span className="h-[5px] w-[5px] rounded-full bg-[#7A7568]" />
            <span>Guests</span>
          </div>
          <p className="mt-3 font-display text-[24px] font-normal leading-[1.2] text-[#1C1A17]">
            {confirmedGuestCount} confirmed
          </p>
          <p className="mt-[3px] font-sans text-[11px] text-[#B8A96A]">
            of ~{weddingProfile?.guest_count ?? 0} expected
          </p>
          <div className="mt-[10px] h-[2px] rounded-[1px] bg-[rgba(201,168,76,0.15)]">
            <div
              className="h-full rounded-[1px] bg-[#C9A84C]"
              style={{ width: `${guestProgress}%` }}
            />
          </div>
        </div>
      </section>
    </section>
  );
}
