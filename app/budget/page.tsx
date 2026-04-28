"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { HTMLInputTypeAttribute } from "react";

import { createClient } from "@/lib/supabase/client";
import { getWeddingProfileForUser } from "@/lib/supabase/wedding-profile";
import type { Database } from "@/lib/supabase/types";
import { useWeddingStore } from "@/store/weddingStore";

type BudgetTab = "budget" | "shopping" | "guests";
type VendorStatus =
  | "not_started"
  | "researching"
  | "shortlisted"
  | "booked"
  | "cancelled";
type ShoppingStatus = "not_purchased" | "purchased";
type GuestSide = "Bride's side" | "Groom's side";
type GuestStatus = "Confirmed" | "Pending" | "Declined";

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
  status: ShoppingStatus;
  title: string;
  user_id: string;
};

type GuestRow = {
  dietary_notes?: string | null;
  id: string;
  name: string;
  phone?: string | null;
  rsvp_status: GuestStatus;
  side: GuestSide;
  user_id: string;
};

type VendorInsert = Omit<VendorRow, "id">;
type ShoppingItemInsert = Omit<ShoppingItemRow, "id">;
type ShoppingItemUpdate = Partial<Omit<ShoppingItemRow, "id" | "user_id">>;
type GuestInsert = Omit<GuestRow, "id">;
type GuestUpdate = Partial<Omit<GuestRow, "id" | "user_id">>;

type ExtendedDatabase = {
  public: {
    CompositeTypes: Database["public"]["CompositeTypes"];
    Enums: Database["public"]["Enums"];
    Functions: Database["public"]["Functions"];
    Tables: Database["public"]["Tables"] & {
      guests: {
        Insert: GuestInsert;
        Relationships: [];
        Row: GuestRow;
        Update: GuestUpdate;
      };
      shopping_items: {
        Insert: ShoppingItemInsert;
        Relationships: [];
        Row: ShoppingItemRow;
        Update: ShoppingItemUpdate;
      };
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

type BudgetInsightResponse = {
  insight: string;
};

type ShoppingSuggestion = {
  category: string;
  title: string;
};

type BudgetBreakdownRow = {
  amount: number;
  color: string;
  id: string;
  label: string;
  paid: number;
  source: "Vendor" | "Shopping";
  statusLabel: string;
  statusStyles: {
    background: string;
    color: string;
  };
  summaryLabel: "Allocated" | "Estimated";
};

type ShoppingDraft = {
  estimated_cost: string;
  title: string;
};

type GuestDraft = {
  dietary_notes: string;
  name: string;
  phone: string;
  rsvp_status: GuestStatus;
  side: GuestSide;
};

const tabOptions: Array<{ id: BudgetTab; label: string }> = [
  { id: "budget", label: "Budget" },
  { id: "shopping", label: "Shopping" },
  { id: "guests", label: "Guests" },
];

const initialGuestDraft: GuestDraft = {
  dietary_notes: "",
  name: "",
  phone: "",
  rsvp_status: "Pending",
  side: "Bride's side",
};

const initialShoppingDraft: ShoppingDraft = {
  estimated_cost: "",
  title: "",
};

const vendorMetaMarker = "[[WEDLY_VENDOR_META]]";
const budgetBreakdownPalette = [
  "#C9A84C",
  "#3D8B7A",
  "#C27C6E",
  "#4A6FA5",
  "#B8860B",
  "#7A7568",
  "#C0392B",
  "#2E7D52",
];

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

function buildProfileRequestBody(profile: {
  budget: number | null;
  city: string | null;
  guest_count: number | null;
  partner1_name: string | null;
  wedding_date: string | null;
  wedding_type: string | null;
}) {
  return {
    budget: profile.budget,
    city: profile.city,
    guest_count: profile.guest_count,
    partner1_name: profile.partner1_name,
    wedding_date: profile.wedding_date,
    wedding_type: profile.wedding_type,
  };
}

function getMissingGuestsColumn(errorMessage: string) {
  const match = errorMessage.match(
    /Could not find the '([^']+)' column of 'guests'/i,
  );

  return match?.[1] ?? null;
}

function cleanMutationPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== ""),
  );
}

function parseVendorMeta(notes: string | null | undefined) {
  if (!notes) {
    return {};
  }

  const markerIndex = notes.indexOf(vendorMetaMarker);

  if (markerIndex === -1) {
    return {};
  }

  const rawMeta = notes.slice(markerIndex + vendorMetaMarker.length).trim();

  try {
    return JSON.parse(rawMeta) as {
      amount_paid?: number | null;
      contact_name?: string;
      email?: string;
      phone?: string;
      vendor_name?: string;
    };
  } catch {
    return {};
  }
}

function getVendorPaidAmount(vendor: VendorRow) {
  const meta = parseVendorMeta(vendor.notes);

  if (vendor.amount_paid !== null && vendor.amount_paid !== undefined) {
    return vendor.amount_paid;
  }

  return meta.amount_paid ?? null;
}

function getStatusStyles(status: VendorStatus) {
  switch (status) {
    case "researching":
      return {
        background: "#EAF0F8",
        color: "#4A6FA5",
        label: "Researching",
      };
    case "shortlisted":
      return {
        background: "#F5EDDA",
        color: "#8B6B16",
        label: "Shortlisted",
      };
    case "booked":
      return {
        background: "#E6F3EA",
        color: "#2D7A50",
        label: "Booked ✓",
      };
    case "cancelled":
      return {
        background: "#F8E8E4",
        color: "#A54B45",
        label: "Cancelled",
      };
    case "not_started":
    default:
      return {
        background: "#EEE8DE",
        color: "#857B6D",
        label: "Not started",
      };
  }
}

function getShoppingGroups(items: ShoppingItemRow[]) {
  const groups = new Map<string, ShoppingItemRow[]>();

  for (const item of items) {
    const currentItems = groups.get(item.category) ?? [];
    currentItems.push(item);
    groups.set(item.category, currentItems);
  }

  return [...groups.entries()]
    .map(([category, rows]) => ({
      category,
      rows: [...rows].sort((first, second) => first.title.localeCompare(second.title)),
    }))
    .sort((first, second) => first.category.localeCompare(second.category));
}

function getShoppingStatusStyles(status: ShoppingStatus) {
  if (status === "purchased") {
    return {
      background: "#E6F3EA",
      color: "#2D7A50",
      label: "Purchased",
    };
  }

  return {
    background: "#F5F0E8",
    color: "#B8A96A",
    label: "Not purchased",
  };
}

function getShoppingSuggestionPool(profile: {
  city?: string | null;
  wedding_type?: string | null;
}) {
  const type = (profile.wedding_type ?? "").toLowerCase();
  const city = profile.city?.trim() || "your city";

  const commonSuggestions: ShoppingSuggestion[] = [
    { category: "Accessories", title: "Emergency touch-up kit" },
    { category: "Gifts", title: "Thank-you gift tags" },
    { category: "Stationery", title: "Ceremony signage" },
    { category: "Miscellaneous", title: "Vendor tip envelopes" },
    { category: "Decor", title: `Welcome board for ${city}` },
    { category: "Bridal", title: "Bridal footwear backup pair" },
  ];

  if (type.includes("south")) {
    return [
      { category: "Bridal", title: "Fresh jasmine hair garlands" },
      { category: "Gifts", title: "Tambulam return gift baskets" },
      { category: "Decor", title: "Pooja thali styling set" },
      ...commonSuggestions,
    ];
  }

  if (type.includes("north")) {
    return [
      { category: "Groom", title: "Sehra and safa accessories" },
      { category: "Decor", title: "Baraat entry prop baskets" },
      { category: "Gifts", title: "Shagun envelope set" },
      ...commonSuggestions,
    ];
  }

  if (type.includes("destination")) {
    return [
      { category: "Gifts", title: "Guest welcome bags" },
      { category: "Stationery", title: "Travel itinerary cards" },
      { category: "Accessories", title: "Luggage tags for guests" },
      ...commonSuggestions,
    ];
  }

  if (type.includes("intimate")) {
    return [
      { category: "Decor", title: "Tablescape candles" },
      { category: "Gifts", title: "Family keepsake notes" },
      { category: "Stationery", title: "Personal menu cards" },
      ...commonSuggestions,
    ];
  }

  return [
    { category: "Bridal", title: "Wedding day jewellery organiser" },
    { category: "Groom", title: "Pocket square and cufflink set" },
    { category: "Decor", title: "Ceremony aisle accents" },
    ...commonSuggestions,
  ];
}

function getBudgetInsightCacheKey(userId: string, dateKey: string) {
  return `wedly_budget_insight_${userId}_${dateKey}`;
}

function getBudgetDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function readBudgetInsightCache(userId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(
    getBudgetInsightCacheKey(userId, getBudgetDateKey()),
  );

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as BudgetInsightResponse;
    return parsed.insight || null;
  } catch {
    return null;
  }
}

function writeBudgetInsightCache(userId: string, insight: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    getBudgetInsightCacheKey(userId, getBudgetDateKey()),
    JSON.stringify({ insight }),
  );
}

function UnderlineInput({
  onBlur,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  onBlur?: () => void;
  onChange: (value: string) => void;
  placeholder: string;
  type?: HTMLInputTypeAttribute;
  value: string;
}) {
  return (
    <input
      className="w-full border-0 border-b border-[#D7C9A2] bg-transparent px-0 py-2 text-[13px] text-[#2C241E] outline-none transition-colors placeholder:text-[#958B7B] focus:border-[#C9A84C] focus:ring-0"
      onBlur={onBlur}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      type={type}
      value={value}
    />
  );
}

export default function BudgetPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [browserSupabase] = useState(() => createClient());
  const budgetSupabase =
    browserSupabase as unknown as SupabaseClient<ExtendedDatabase>;
  const donutCanvasRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef<Record<BudgetTab, number>>({
    budget: 0,
    guests: 0,
    shopping: 0,
  });
  const [activeTab, setActiveTab] = useState<BudgetTab>("budget");

  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItemRow[]>([]);
  const [guests, setGuests] = useState<GuestRow[]>([]);

  const [pageError, setPageError] = useState<string | null>(null);
  const [budgetInsight, setBudgetInsight] = useState("");
  const [budgetInsightError, setBudgetInsightError] = useState<string | null>(null);
  const [isBudgetInsightLoading, setIsBudgetInsightLoading] = useState(false);
  const [isShoppingLoading, setIsShoppingLoading] = useState(false);
  const [shoppingError, setShoppingError] = useState<string | null>(null);
  const [isGuestsLoading, setIsGuestsLoading] = useState(false);
  const [guestsError, setGuestsError] = useState<string | null>(null);

  const [expandedShoppingCategories, setExpandedShoppingCategories] = useState<
    Record<string, boolean>
  >({});
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [newShoppingCategoryName, setNewShoppingCategoryName] = useState("");
  const [editingShoppingCategory, setEditingShoppingCategory] = useState<string | null>(null);
  const [editingShoppingCategoryDrafts, setEditingShoppingCategoryDrafts] = useState<
    Record<string, string>
  >({});
  const [confirmingShoppingCategoryDelete, setConfirmingShoppingCategoryDelete] = useState<
    string | null
  >(null);
  const [addingItemCategory, setAddingItemCategory] = useState<string | null>(null);
  const [shoppingDrafts, setShoppingDrafts] = useState<Record<string, ShoppingDraft>>({});
  const [editingShoppingItemId, setEditingShoppingItemId] = useState<string | null>(null);
  const [editingShoppingItemDrafts, setEditingShoppingItemDrafts] = useState<
    Record<string, string>
  >({});
  const [confirmingShoppingItemDelete, setConfirmingShoppingItemDelete] = useState<
    string | null
  >(null);
  const [deletingShoppingItemIds, setDeletingShoppingItemIds] = useState<
    Record<string, boolean>
  >({});
  const [refreshTick, setRefreshTick] = useState(0);

  const [isAddGuestOpen, setIsAddGuestOpen] = useState(false);
  const [guestDraft, setGuestDraft] = useState<GuestDraft>(initialGuestDraft);
  const [isSavingGuest, setIsSavingGuest] = useState(false);
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [editingGuestDrafts, setEditingGuestDrafts] = useState<Record<string, GuestDraft>>(
    {},
  );
  const [guestSideFilter, setGuestSideFilter] = useState<"All" | GuestSide>("All");
  const [guestStatusFilter, setGuestStatusFilter] = useState<
    "All" | GuestStatus
  >("All");

  const initializedRef = useRef(false);

  const user = useWeddingStore((state) => state.user);
  const weddingProfile = useWeddingStore((state) => state.weddingProfile);
  const setIsOnboarded = useWeddingStore((state) => state.setIsOnboarded);
  const setUser = useWeddingStore((state) => state.setUser);
  const setWeddingProfile = useWeddingStore((state) => state.setWeddingProfile);

  const totalBudget = weddingProfile?.budget ?? 0;
  const vendorAllocated = useMemo(
    () => vendors.reduce((sum, vendor) => sum + (vendor.budget_allocated ?? 0), 0),
    [vendors],
  );
  const vendorPaid = useMemo(
    () => vendors.reduce((sum, vendor) => sum + (getVendorPaidAmount(vendor) ?? 0), 0),
    [vendors],
  );
  const shoppingGroups = useMemo(() => getShoppingGroups(shoppingItems), [shoppingItems]);
  const shoppingEstimated = useMemo(
    () =>
      shoppingItems.reduce((sum, item) => sum + (item.estimated_cost ?? 0), 0),
    [shoppingItems],
  );
  const shoppingPaid = useMemo(
    () => shoppingItems.reduce((sum, item) => sum + (item.actual_cost ?? 0), 0),
    [shoppingItems],
  );
  const totalAllocated = vendorAllocated + shoppingEstimated;
  const totalPaid = vendorPaid + shoppingPaid;
  const overUnder = totalBudget - totalAllocated;
  const paidOfAllocatedPercentage =
    totalAllocated > 0 ? Math.min((totalPaid / totalAllocated) * 100, 100) : 0;
  const unallocatedAmount = Math.max(totalBudget - totalAllocated, 0);
  const guestCounts = useMemo(
    () => ({
      confirmed: guests.filter((guest) => guest.rsvp_status === "Confirmed").length,
      declined: guests.filter((guest) => guest.rsvp_status === "Declined").length,
      pending: guests.filter((guest) => guest.rsvp_status === "Pending").length,
      total: guests.length,
    }),
    [guests],
  );
  const filteredGuests = useMemo(
    () =>
      guests.filter((guest) => {
        const sideMatch = guestSideFilter === "All" || guest.side === guestSideFilter;
        const statusMatch =
          guestStatusFilter === "All" || guest.rsvp_status === guestStatusFilter;
        return sideMatch && statusMatch;
      }),
    [guestSideFilter, guestStatusFilter, guests],
  );
  const budgetBreakdownRows = useMemo(() => {
    const colorByKey = new Map<string, string>();
    let colorIndex = 0;

    const getColor = (key: string) => {
      const normalizedKey = key.trim().toLowerCase();

      if (!colorByKey.has(normalizedKey)) {
        colorByKey.set(
          normalizedKey,
          budgetBreakdownPalette[colorIndex % budgetBreakdownPalette.length],
        );
        colorIndex += 1;
      }

      return colorByKey.get(normalizedKey) ?? budgetBreakdownPalette[0];
    };

    const vendorRows: BudgetBreakdownRow[] = vendors.map((vendor) => {
      const statusStyles = getStatusStyles(vendor.status);
      return {
        amount: vendor.budget_allocated ?? 0,
        color: getColor(vendor.category),
        id: vendor.id,
        label: vendor.category,
        paid: getVendorPaidAmount(vendor) ?? 0,
        source: "Vendor",
        statusLabel: statusStyles.label,
        statusStyles: {
          background: statusStyles.background,
          color: statusStyles.color,
        },
        summaryLabel: "Allocated",
      };
    });

    const shoppingRows: BudgetBreakdownRow[] = shoppingItems
      .filter((item) => item.title.trim().length > 0)
      .map((item) => {
        const statusStyles = getShoppingStatusStyles(item.status);
        return {
          amount: item.estimated_cost ?? 0,
        color: getColor(item.category || item.title),
        id: item.id,
        label: item.title,
        paid: item.actual_cost ?? 0,
        source: "Shopping",
        statusLabel: statusStyles.label,
        statusStyles: {
          background: statusStyles.background,
          color: statusStyles.color,
          },
          summaryLabel: "Estimated",
        };
      });

    return [...vendorRows, ...shoppingRows].sort(
      (first, second) => second.amount - first.amount,
    );
  }, [shoppingItems, vendors]);
  const shoppingSuggestions = useMemo(() => {
    const existingKeys = new Set(
      shoppingItems.map(
        (item) => `${item.category.trim().toLowerCase()}::${item.title.trim().toLowerCase()}`,
      ),
    );

    return getShoppingSuggestionPool(weddingProfile ?? {})
      .filter(
        (suggestion) =>
          !existingKeys.has(
            `${suggestion.category.trim().toLowerCase()}::${suggestion.title
              .trim()
              .toLowerCase()}`,
          ),
      )
      .slice(0, 3);
  }, [shoppingItems, weddingProfile]);
  const budgetOverrunRows = useMemo(
    () => (overUnder < 0 ? budgetBreakdownRows.slice(0, 3) : []),
    [budgetBreakdownRows, overUnder],
  );

  useEffect(() => {
    const requestedTab = searchParams.get("tab");

    if (requestedTab === "budget" || requestedTab === "shopping" || requestedTab === "guests") {
      setActiveTab(requestedTab);
    }
  }, [searchParams]);

  const runGuestMutation = async <T,>(
    payload: Record<string, unknown>,
    runner: (nextPayload: Record<string, unknown>) => Promise<{
      data: T | null;
      error: { message: string } | null;
    }>,
  ) => {
    let nextPayload = cleanMutationPayload(payload);

    while (true) {
      const result = await runner(nextPayload);

      if (!result.error) {
        return result;
      }

      const missingColumn = getMissingGuestsColumn(result.error.message);

      if (!missingColumn || !(missingColumn in nextPayload)) {
        return result;
      }

      nextPayload = { ...nextPayload };
      delete nextPayload[missingColumn];
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function ensureSessionAndProfile() {
      let nextUser: User | null = user;

      if (!nextUser) {
        const {
          data: { user: fetchedUser },
          error,
        } = await browserSupabase.auth.getUser();

        if (!isMounted) {
          return;
        }

        if (error) {
          setPageError(error.message);
          return;
        }

        nextUser = fetchedUser ?? null;
        setUser(nextUser);
      }

      if (!nextUser) {
        setPageError("No signed-in user found.");
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

          setPageError(
            error instanceof Error
              ? error.message
              : "We couldn't load your wedding profile.",
          );
        }
      }
    }

    void ensureSessionAndProfile();

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
    const handleDataUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string }>).detail;

      if (detail?.type === "vendor" || detail?.type === "shopping") {
        initializedRef.current = false;
        setRefreshTick((current) => current + 1);
      }
    };

    window.addEventListener("wedly-data-updated", handleDataUpdated as EventListener);

    return () => {
      window.removeEventListener(
        "wedly-data-updated",
        handleDataUpdated as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (!user || !weddingProfile || initializedRef.current) {
      return;
    }

    initializedRef.current = true;

    const loadEverything = async () => {
      setPageError(null);
      setShoppingError(null);
      setGuestsError(null);
      setIsShoppingLoading(true);
      setIsGuestsLoading(true);

      try {
        const [vendorResult, shoppingResult, guestResult] = await Promise.all([
          budgetSupabase
            .from("vendors" as never)
            .select("*")
            .eq("user_id", user.id)
            .order("category", { ascending: true }),
          budgetSupabase
            .from("shopping_items" as never)
            .select("*")
            .eq("user_id", user.id)
            .order("category", { ascending: true }),
          budgetSupabase
            .from("guests" as never)
            .select("*")
            .eq("user_id", user.id)
            .order("name", { ascending: true }),
        ]);

        if (vendorResult.error) {
          throw vendorResult.error;
        }

        setVendors((vendorResult.data ?? []) as VendorRow[]);

        if (guestResult.error) {
          throw guestResult.error;
        }

        setGuests((guestResult.data ?? []) as GuestRow[]);

        if (shoppingResult.error) {
          throw shoppingResult.error;
        }

        const typedShoppingData = (shoppingResult.data ?? []) as ShoppingItemRow[];

        if (typedShoppingData.length > 0) {
          setShoppingItems(typedShoppingData);
          setExpandedShoppingCategories(
            typedShoppingData.reduce<Record<string, boolean>>((acc, item) => {
              acc[item.category] = true;
              return acc;
            }, {}),
          );
        } else {
          const response = await fetch("/api/shopping-generate", {
            body: JSON.stringify(buildProfileRequestBody(weddingProfile)),
            headers: {
              "Content-Type": "application/json",
            },
            method: "POST",
          });

          if (!response.ok) {
            throw new Error(
              (await response.text()) || "We couldn't generate the shopping list.",
            );
          }

          const generatedItems = (await response.json()) as ShoppingItemRow[];
          setShoppingItems(generatedItems);
          setExpandedShoppingCategories(
            generatedItems.reduce<Record<string, boolean>>((acc, item) => {
              acc[item.category] = true;
              return acc;
            }, {}),
          );
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "We couldn't load your budget data.";

        setPageError(message);
        setShoppingError(message);
        setGuestsError(message);
      } finally {
        setIsShoppingLoading(false);
        setIsGuestsLoading(false);
      }
    };

    void loadEverything();
  }, [budgetSupabase, refreshTick, user, weddingProfile]);

  useEffect(() => {
    if (activeTab !== "budget") {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const canvas = donutCanvasRef.current;

      if (!canvas) {
        return;
      }

      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      const size = 208;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, size, size);

      const center = size / 2;
      const radius = 74;
      const lineWidth = 18;
      const fullCircle = Math.PI * 2;
      const gapAngle = 0.042;

      let segments: Array<{ color: string; value: number }> = [];

      if (totalBudget > 0) {
        if (totalAllocated > totalBudget && totalAllocated > 0) {
          segments = [
            { color: "#C9A84C", value: vendorAllocated / totalAllocated },
            { color: "#C27C6E", value: shoppingEstimated / totalAllocated },
          ];
        } else {
          segments = [
            { color: "#C9A84C", value: vendorAllocated / totalBudget },
            { color: "#C27C6E", value: shoppingEstimated / totalBudget },
            {
              color: "#E8E2D9",
              value: Math.max(totalBudget - totalAllocated, 0) / totalBudget,
            },
          ];
        }
      } else {
        segments = [{ color: "#E8E2D9", value: 1 }];
      }

      let startAngle = -Math.PI / 2;

      segments
        .filter((segment) => segment.value > 0)
        .forEach((segment, index, array) => {
          const rawAngle = fullCircle * segment.value;
          const adjustedGap = array.length > 1 ? gapAngle : 0;
          const segmentAngle = Math.max(rawAngle - adjustedGap, rawAngle * 0.92);

          context.beginPath();
          context.strokeStyle = segment.color;
          context.lineWidth = lineWidth;
          context.lineCap = "butt";
          context.arc(center, center, radius, startAngle, startAngle + segmentAngle);
          context.stroke();

          startAngle += rawAngle;
        });

      context.beginPath();
      context.fillStyle = "#FFFFFF";
      context.arc(center, center, 62, 0, fullCircle);
      context.fill();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeTab, shoppingEstimated, totalAllocated, totalBudget, vendorAllocated]);

  useEffect(() => {
    if (!user || !weddingProfile) {
      return;
    }

    if (vendors.length === 0 && shoppingItems.length === 0) {
      setBudgetInsight("Add vendors and shopping items to unlock Wedly's budget guidance.");
      setBudgetInsightError(null);
      setIsBudgetInsightLoading(false);
      return;
    }

    const cachedInsight = readBudgetInsightCache(user.id);

    if (cachedInsight) {
      setBudgetInsight(cachedInsight);
      setBudgetInsightError(null);
      setIsBudgetInsightLoading(false);
      return;
    }

    let isMounted = true;

    const loadInsight = async () => {
      setIsBudgetInsightLoading(true);
      setBudgetInsightError(null);

      try {
        const response = await fetch("/api/budget-insight", {
          body: JSON.stringify({
            shoppingItems,
            totalAllocated,
            totalBudget,
            totalPaid,
            overUnder,
            vendors,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        if (!response.ok) {
          throw new Error((await response.text()) || "We couldn't load budget insight.");
        }

        const data = (await response.json()) as BudgetInsightResponse;

        if (!isMounted) {
          return;
        }

        setBudgetInsight(data.insight);
        writeBudgetInsightCache(user.id, data.insight);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setBudgetInsightError(
          error instanceof Error ? error.message : "We couldn't load budget insight.",
        );
      } finally {
        if (isMounted) {
          setIsBudgetInsightLoading(false);
        }
      }
    };

    void loadInsight();

    return () => {
      isMounted = false;
    };
  }, [overUnder, shoppingItems, totalAllocated, totalBudget, totalPaid, user, vendors, weddingProfile]);

  useEffect(() => {
    const contentElement = contentRef.current;

    if (!contentElement) {
      return;
    }

    contentElement.scrollTop = scrollPositionsRef.current[activeTab] ?? 0;
  }, [activeTab]);

  const handleTabChange = (nextTab: BudgetTab) => {
    if (contentRef.current) {
      scrollPositionsRef.current[activeTab] = contentRef.current.scrollTop;
    }

    setActiveTab(nextTab);
  };

  const updateExpandedShoppingCategory = (category: string, expanded: boolean) => {
    setExpandedShoppingCategories((current) => ({
      ...current,
      [category]: expanded,
    }));
  };

  const toggleShoppingPurchased = async (item: ShoppingItemRow) => {
    const nextStatus: ShoppingStatus =
      item.status === "purchased" ? "not_purchased" : "purchased";

    setShoppingError(null);
    setShoppingItems((current) =>
      current.map((row) =>
        row.id === item.id ? { ...row, status: nextStatus } : row,
      ),
    );

    const { error } = await budgetSupabase
      .from("shopping_items" as never)
      .update({ status: nextStatus } as never)
      .eq("id", item.id);

    if (error) {
      setShoppingItems((current) =>
        current.map((row) => (row.id === item.id ? item : row)),
      );
      setShoppingError(error.message);
    }
  };

  const saveAddedShoppingItem = async (category: string) => {
    const draft = shoppingDrafts[category];

    if (!user || !draft?.title.trim()) {
      setShoppingError("Item title is required.");
      return;
    }

    const payload = {
      actual_cost: null,
      category,
      estimated_cost: null,
      is_ai_suggested: false,
      status: "not_purchased" as ShoppingStatus,
      title: draft.title.trim(),
      user_id: user.id,
    };

    const { data, error } = await budgetSupabase
      .from("shopping_items" as never)
      .insert(payload as never)
      .select("*")
      .single();

    if (error) {
      setShoppingError(error.message);
      return;
    }

    setShoppingItems((current) => [...current, data as ShoppingItemRow]);
    setAddingItemCategory(null);
    setShoppingDrafts((current) => ({
      ...current,
      [category]: initialShoppingDraft,
    }));
    updateExpandedShoppingCategory(category, true);
  };

  const startEditingShoppingItem = (item: ShoppingItemRow) => {
    setEditingShoppingItemId(item.id);
    setEditingShoppingItemDrafts((current) => ({
      ...current,
      [item.id]: item.title,
    }));
  };

  const cancelEditingShoppingItem = () => {
    setEditingShoppingItemId(null);
  };

  const saveShoppingItemTitle = async (item: ShoppingItemRow) => {
    const nextTitle = editingShoppingItemDrafts[item.id]?.trim();

    if (!nextTitle) {
      setShoppingError("Item name is required.");
      return;
    }

    setShoppingError(null);
    setShoppingItems((current) =>
      current.map((row) => (row.id === item.id ? { ...row, title: nextTitle } : row)),
    );
    setEditingShoppingItemId(null);

    const { error } = await budgetSupabase
      .from("shopping_items" as never)
      .update({ title: nextTitle } as never)
      .eq("id", item.id);

    if (error) {
      setShoppingItems((current) =>
        current.map((row) => (row.id === item.id ? item : row)),
      );
      setShoppingError(error.message);
    }
  };

  const deleteShoppingItem = async (item: ShoppingItemRow) => {
    setShoppingError(null);
    setDeletingShoppingItemIds((current) => ({ ...current, [item.id]: true }));

    await new Promise((resolve) => {
      window.setTimeout(resolve, 180);
    });

    const previousItems = shoppingItems;
    setShoppingItems((current) => current.filter((row) => row.id !== item.id));
    setConfirmingShoppingItemDelete(null);

    const { error } = await budgetSupabase
      .from("shopping_items" as never)
      .delete()
      .eq("id", item.id);

    setDeletingShoppingItemIds((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });

    if (error) {
      setShoppingItems(previousItems);
      setShoppingError(error.message);
    }
  };

  const saveShoppingCategoryName = async (category: string) => {
    const nextCategory = editingShoppingCategoryDrafts[category]?.trim();

    if (!user || !nextCategory) {
      setShoppingError("Category name is required.");
      return;
    }

    setShoppingError(null);
    const previousItems = shoppingItems;

    setShoppingItems((current) =>
      current.map((item) =>
        item.category === category ? { ...item, category: nextCategory } : item,
      ),
    );
    setEditingShoppingCategory(null);
    setExpandedShoppingCategories((current) => {
      const next = { ...current };
      const wasExpanded = current[category] ?? true;
      delete next[category];
      next[nextCategory] = wasExpanded;
      return next;
    });

    const { error } = await budgetSupabase
      .from("shopping_items" as never)
      .update({ category: nextCategory } as never)
      .eq("user_id", user.id)
      .eq("category", category);

    if (error) {
      setShoppingItems(previousItems);
      setExpandedShoppingCategories((current) => {
        const next = { ...current };
        delete next[nextCategory];
        next[category] = true;
        return next;
      });
      setShoppingError(error.message);
    }
  };

  const createShoppingCategory = async () => {
    const category = newShoppingCategoryName.trim();

    if (!user || !category) {
      setShoppingError("Category name is required.");
      return;
    }

    const payload = {
      actual_cost: null,
      category,
      estimated_cost: null,
      is_ai_suggested: false,
      status: "not_purchased" as ShoppingStatus,
      title: "",
      user_id: user.id,
    };

    const { data, error } = await budgetSupabase
      .from("shopping_items" as never)
      .insert(payload as never)
      .select("*")
      .single();

    if (error) {
      setShoppingError(error.message);
      return;
    }

    setShoppingItems((current) => [...current, data as ShoppingItemRow]);
    updateExpandedShoppingCategory(category, true);
    setNewShoppingCategoryName("");
    setIsAddCategoryOpen(false);
  };

  const deleteShoppingCategory = async (category: string) => {
    if (!user) {
      return;
    }

    const previousItems = shoppingItems;
    setShoppingItems((current) => current.filter((item) => item.category !== category));
    setConfirmingShoppingCategoryDelete(null);

    const { error } = await budgetSupabase
      .from("shopping_items" as never)
      .delete()
      .eq("user_id", user.id)
      .eq("category", category);

    if (error) {
      setShoppingItems(previousItems);
      setShoppingError(error.message);
    }
  };

  const addShoppingSuggestion = async (suggestion: ShoppingSuggestion) => {
    if (!user) {
      return;
    }

    const payload = {
      actual_cost: null,
      category: suggestion.category,
      estimated_cost: null,
      is_ai_suggested: true,
      status: "not_purchased" as ShoppingStatus,
      title: suggestion.title,
      user_id: user.id,
    };

    const { data, error } = await budgetSupabase
      .from("shopping_items" as never)
      .insert(payload as never)
      .select("*")
      .single();

    if (error) {
      setShoppingError(error.message);
      return;
    }

    setShoppingItems((current) => [...current, data as ShoppingItemRow]);
    updateExpandedShoppingCategory(suggestion.category, true);
  };

  const saveGuest = async () => {
    if (!user || !guestDraft.name.trim()) {
      setGuestsError("Guest name is required.");
      return;
    }

    setIsSavingGuest(true);

    const payload = {
      dietary_notes: guestDraft.dietary_notes || null,
      name: guestDraft.name.trim(),
      phone: guestDraft.phone || null,
      rsvp_status: guestDraft.rsvp_status,
      side: guestDraft.side,
      user_id: user.id,
    };

    const { data, error } = await runGuestMutation<GuestRow>(
      payload,
      async (nextPayload) =>
        budgetSupabase
          .from("guests" as never)
          .insert(nextPayload as never)
          .select("*")
          .single(),
    );

    setIsSavingGuest(false);

    if (error) {
      setGuestsError(error.message);
      return;
    }

    setGuests((current) =>
      [...current, data as GuestRow].sort((first, second) =>
        first.name.localeCompare(second.name),
      ),
    );
    setGuestDraft(initialGuestDraft);
    setIsAddGuestOpen(false);
  };

  const startEditingGuest = (guest: GuestRow) => {
    setEditingGuestId(guest.id);
    setEditingGuestDrafts((current) => ({
      ...current,
      [guest.id]: {
        dietary_notes: guest.dietary_notes ?? "",
        name: guest.name,
        phone: guest.phone ?? "",
        rsvp_status: guest.rsvp_status,
        side: guest.side,
      },
    }));
  };

  const saveGuestEdit = async (guestId: string) => {
    const draft = editingGuestDrafts[guestId];

    if (!draft?.name.trim()) {
      setGuestsError("Guest name is required.");
      return;
    }

    const payload = {
      dietary_notes: draft.dietary_notes || null,
      name: draft.name.trim(),
      phone: draft.phone || null,
      rsvp_status: draft.rsvp_status,
      side: draft.side,
    };

    const { data, error } = await runGuestMutation<GuestRow>(
      payload,
      async (nextPayload) =>
        budgetSupabase
          .from("guests" as never)
          .update(nextPayload as never)
          .eq("id", guestId)
          .select("*")
          .single(),
    );

    if (error) {
      setGuestsError(error.message);
      return;
    }

    setGuests((current) =>
      current.map((guest) => (guest.id === guestId ? (data as GuestRow) : guest)),
    );
    setEditingGuestId(null);
  };

  const deleteGuest = async (guest: GuestRow) => {
    if (!window.confirm(`Delete ${guest.name}?`)) {
      return;
    }

    const previousGuests = guests;
    setGuests((current) => current.filter((row) => row.id !== guest.id));

    const { error } = await budgetSupabase
      .from("guests" as never)
      .delete()
      .eq("id", guest.id);

    if (error) {
      setGuests(previousGuests);
      setGuestsError(error.message);
    }
  };

  const renderBudgetTab = () => {
    const vendorPercentage =
      totalBudget > 0 ? Math.max(0, Math.min(100, (vendorAllocated / totalBudget) * 100)) : 0;
    const shoppingPercentage =
      totalBudget > 0
        ? Math.max(0, Math.min(100, (shoppingEstimated / totalBudget) * 100))
        : 0;
    const unallocatedPercentage =
      totalBudget > 0
        ? Math.max(0, Math.min(100, (unallocatedAmount / totalBudget) * 100))
        : 0;

    return (
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="rounded-[16px] border border-[#E8E2D9] bg-white px-7 py-7">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[#C9A84C]">
              ✦ Budget allocation
            </p>

            <div className="mt-6 flex justify-center">
              <div className="relative h-[208px] w-[208px]">
                <canvas className="h-[208px] w-[208px]" height={208} ref={donutCanvasRef} width={208} />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
                  <p className="font-display text-[28px] leading-none text-[#1C1A17]">
                    {formatCurrency(totalBudget)}
                  </p>
                  <p className="mt-3 text-[10px] uppercase tracking-[0.14em] text-[#8B8378]">
                    total budget
                  </p>
                  {overUnder < 0 ? (
                    <p className="mt-3 text-[12px] font-medium leading-snug text-[#A54B45]">
                      {formatCurrency(Math.abs(overUnder))} over
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {[
                {
                  amount: vendorAllocated,
                  color: "#C9A84C",
                  label: "Vendors",
                  percentage: vendorPercentage,
                },
                {
                  amount: shoppingEstimated,
                  color: "#C27C6E",
                  label: "Shopping",
                  percentage: shoppingPercentage,
                },
                {
                  amount: unallocatedAmount,
                  color: "#E8E2D9",
                  label: "Unallocated",
                  percentage: unallocatedPercentage,
                },
              ].map((item) => (
                <div className="flex items-center gap-3 text-[11px]" key={item.label}>
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="flex-1 text-[#8B8378]">{item.label}</span>
                  <span className="font-medium text-[#1C1A17]">
                    {formatCurrency(item.amount)}
                  </span>
                  <span className="text-[#A69A88]">{Math.round(item.percentage)}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[12px] border border-[#E8E2D9] bg-white px-5 py-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-[#8B8378]">
                  Total budget
                </p>
                <p className="mt-3 font-display text-[24px] leading-none text-[#1C1A17]">
                  {formatCurrency(totalBudget)}
                </p>
                <p className="mt-2 text-[11px] text-[#8B8378]">set during signup</p>
              </div>

              <div className="rounded-[12px] border border-[#E8E2D9] bg-white px-5 py-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-[#8B8378]">
                  Total allocated
                </p>
                <p
                  className="mt-3 font-display text-[24px] leading-none"
                  style={{ color: overUnder < 0 ? "#A54B45" : "#2D7A50" }}
                >
                  {formatCurrency(totalAllocated)}
                </p>
                <p className="mt-2 text-[11px] text-[#8B8378]">
                  {overUnder < 0
                    ? `${formatCurrency(Math.abs(overUnder))} over budget`
                    : `${formatCurrency(overUnder)} remaining`}
                </p>
              </div>

              <div className="rounded-[12px] border border-[#E8E2D9] bg-white px-5 py-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-[#8B8378]">
                  Total paid
                </p>
                <p className="mt-3 font-display text-[24px] leading-none text-[#2D7A50]">
                  {formatCurrency(totalPaid)}
                </p>
                <p className="mt-2 text-[11px] text-[#8B8378]">
                  {Math.round(paidOfAllocatedPercentage)}% of allocated
                </p>
              </div>
            </div>

            <div className="rounded-[12px] border border-[rgba(201,168,76,0.25)] bg-[#FBF7ED] px-6 py-5">
              <div className="flex items-start gap-4">
                <span className="mt-1 text-[#C9A84C]">✦</span>
                <div className="min-w-0 flex-1">
                  {isBudgetInsightLoading ? (
                    <div className="space-y-2">
                      <div className="h-3 w-full animate-pulse rounded-full bg-[rgba(201,168,76,0.16)]" />
                      <div className="h-3 w-5/6 animate-pulse rounded-full bg-[rgba(201,168,76,0.16)]" />
                      <div className="h-3 w-2/3 animate-pulse rounded-full bg-[rgba(201,168,76,0.16)]" />
                    </div>
                  ) : (
                    <p className="text-[12px] leading-7 text-[#4E453B]">
                      {budgetInsightError
                        ? budgetInsightError
                        : budgetInsight || "Your latest budget recommendation will appear here."}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[16px] border border-[#E8E2D9] bg-white px-6 py-5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-[#C9A84C]">
            ✦ Where every rupee is going
          </p>

          {budgetBreakdownRows.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-[#A69A88]">
              Add vendors and shopping items to see your budget breakdown
            </div>
          ) : (
            <div className="mt-5">
              {budgetBreakdownRows.map((row, index) => {
                const amountWidth =
                  totalBudget > 0 ? Math.max(0, Math.min(100, (row.amount / totalBudget) * 100)) : 0;
                const paidWidth =
                  totalBudget > 0 ? Math.max(0, Math.min(100, (row.paid / totalBudget) * 100)) : 0;

                return (
                  <div
                    className={`flex flex-col gap-4 py-4 lg:flex-row lg:items-center ${
                      index === budgetBreakdownRows.length - 1 ? "" : "border-b border-[#F0EBE3]"
                    }`}
                    key={row.id}
                  >
                    <div className="flex min-w-0 items-center gap-3 lg:min-w-[260px]">
                      <span
                        className="h-2 w-2 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      <p className="min-w-0 truncate text-[13px] text-[#1C1A17]">{row.label}</p>
                      <span className="rounded-full bg-[#F5F0E8] px-2 py-1 text-[10px] text-[#B8A96A]">
                        {row.source}
                      </span>
                    </div>

                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="min-w-[56px] text-[10px] text-[#A69A88]">
                          {row.summaryLabel}
                        </span>
                        <div className="h-[5px] flex-1 overflow-hidden rounded-[3px] bg-[#F0EBE3]">
                          <div
                            className="h-full rounded-[3px]"
                            style={{
                              backgroundColor: row.color,
                              width: `${amountWidth}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="min-w-[56px] text-[10px] text-[#A69A88]">Paid</span>
                        <div className="h-[5px] flex-1 overflow-hidden rounded-[3px] bg-[#F0EBE3]">
                          <div
                            className="h-full rounded-[3px] bg-[#2E7D52]"
                            style={{ width: `${paidWidth}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 lg:min-w-[210px] lg:justify-end">
                      <p className="min-w-[110px] text-right font-display text-[16px] leading-none text-[#1C1A17]">
                        {formatCurrency(row.amount)}
                      </p>
                      <span
                        className="rounded-full px-3 py-1 text-[10px] font-medium"
                        style={{
                          background: row.statusStyles.background,
                          color: row.statusStyles.color,
                        }}
                      >
                        {row.statusLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {budgetOverrunRows.length > 0 ? (
          <div className="rounded-[12px] border border-[rgba(192,57,43,0.2)] bg-[#FDF2F0] px-5 py-4">
            <p className="text-[13px] font-medium text-[#C0392B]">
              ⚠ Budget overrun detected
            </p>
            <div className="mt-3 space-y-2">
              {budgetOverrunRows.map((row) => (
                <div className="flex items-center justify-between gap-4 text-[12px]" key={row.id}>
                  <span className="text-[#7B7163]">{row.label}</span>
                  <span className="font-medium text-[#C0392B]">
                    {formatCurrency(row.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const renderShoppingTab = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="font-display text-[22px] leading-none text-[#1C1A17]">
          ✦ Your shopping list
        </p>
        <button
          className="rounded-full border border-[#E8E2D9] bg-transparent px-4 py-2 text-[13px] text-[#1C1A17] transition-colors hover:border-[#C9A84C]"
          onClick={() => setIsAddCategoryOpen(true)}
          type="button"
        >
          + Add category
        </button>
      </div>

      {shoppingError ? (
        <div className="rounded-[12px] border border-[#E8C7C2] bg-[#FDF2F0] px-4 py-3 text-[13px] text-[#A54B45]">
          {shoppingError}
        </div>
      ) : null}

      {isShoppingLoading && shoppingGroups.length === 0 ? (
        <div className="py-16 text-center">
          <p className="font-display text-[22px] text-[#8B8378]">Your shopping list is empty</p>
          <p className="mt-2 text-[14px] text-[#A69A88]">
            Wedly is generating your personalised list
            <span className="ml-1 inline-flex gap-1 align-middle">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#C9A84C]" />
              <span
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#C9A84C]"
                style={{ animationDelay: "120ms" }}
              />
              <span
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#C9A84C]"
                style={{ animationDelay: "240ms" }}
              />
            </span>
          </p>
        </div>
      ) : shoppingGroups.length === 0 ? (
        <div className="py-16 text-center">
          <p className="font-display text-[22px] text-[#8B8378]">Your shopping list is empty</p>
          <p className="mt-2 text-[14px] text-[#A69A88]">
            Add a category to begin building it.
          </p>
        </div>
      ) : (
        <div>
          {shoppingGroups.map((group) => {
            const isExpanded = expandedShoppingCategories[group.category] ?? true;
            const visibleRows = group.rows.filter((item) => item.title.trim().length > 0);
            const purchasedRows = visibleRows.filter(
              (item) => item.status === "purchased",
            ).length;
            const isEditingCategory = editingShoppingCategory === group.category;
            const isDeletingCategory = confirmingShoppingCategoryDelete === group.category;
            const isAiGenerated = group.rows.some((item) => item.is_ai_suggested);

            return (
              <div
                className="mb-[10px] overflow-hidden rounded-[12px] border border-[#E8E2D9] bg-white"
                key={group.category}
              >
                <div className="flex items-center justify-between gap-4 px-[18px] py-[14px]">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-4 text-left"
                    onClick={() => updateExpandedShoppingCategory(group.category, !isExpanded)}
                    type="button"
                  >
                    <div className="min-w-0 flex-1">
                      {isEditingCategory ? (
                        <input
                          autoFocus
                          className="w-full border-0 border-b border-[#C9A84C] bg-transparent px-0 py-1 text-[14px] font-medium text-[#1C1A17] outline-none focus:ring-0"
                          onChange={(event) =>
                            setEditingShoppingCategoryDrafts((current) => ({
                              ...current,
                              [group.category]: event.target.value,
                            }))
                          }
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void saveShoppingCategoryName(group.category);
                            }

                            if (event.key === "Escape") {
                              setEditingShoppingCategory(null);
                            }
                          }}
                          value={
                            editingShoppingCategoryDrafts[group.category] ?? group.category
                          }
                        />
                      ) : (
                        <p className="truncate text-[14px] font-medium text-[#1C1A17]">
                          {group.category}
                        </p>
                      )}
                    </div>
                    <p className="text-[12px] text-[#8B8378]">
                      {purchasedRows} of {visibleRows.length} purchased
                    </p>
                  </button>

                  <div className="flex items-center gap-2">
                    {isDeletingCategory ? (
                      <div className="flex items-center gap-2 text-[12px] text-[#A54B45]">
                        <span>Delete this category and all its items?</span>
                        <button
                          className="font-medium text-[#A54B45]"
                          onClick={() => void deleteShoppingCategory(group.category)}
                          type="button"
                        >
                          Yes
                        </button>
                        <button
                          className="text-[#8B8378]"
                          onClick={() => setConfirmingShoppingCategoryDelete(null)}
                          type="button"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <>
                        {isAiGenerated ? (
                          <span className="rounded-full bg-[#FBF7ED] px-2 py-1 text-[10px] text-[#C9A84C]">
                            ✦ AI
                          </span>
                        ) : null}
                        <button
                          className="rounded-full p-2 text-[#8B8378] transition-colors hover:text-[#1C1A17]"
                          onClick={() => {
                            setEditingShoppingCategory(group.category);
                            setEditingShoppingCategoryDrafts((current) => ({
                              ...current,
                              [group.category]: group.category,
                            }));
                          }}
                          type="button"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          className="rounded-full p-2 text-[#8B8378] transition-colors hover:text-[#A54B45]"
                          onClick={() => setConfirmingShoppingCategoryDelete(group.category)}
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <button
                          className="rounded-full p-2 text-[#8B8378] transition-colors hover:text-[#1C1A17]"
                          onClick={() =>
                            updateExpandedShoppingCategory(group.category, !isExpanded)
                          }
                          type="button"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div
                  className={`overflow-hidden border-t border-[#F0EBE3] transition-[max-height,opacity] duration-300 ease-out ${
                    isExpanded ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"
                  }`}
                >
                  <div>
                    {visibleRows.length === 0 ? (
                      <div className="px-[18px] py-6 text-center text-[13px] text-[#A69A88]">
                        No items in this category yet.
                      </div>
                    ) : (
                      visibleRows.map((item, index) => {
                        const isEditingItem = editingShoppingItemId === item.id;
                        const isDeletingItem = confirmingShoppingItemDelete === item.id;

                        return (
                          <div
                            className={`group flex items-center gap-[10px] px-[18px] py-[10px] transition-all ${
                              index === visibleRows.length - 1 ? "" : "border-b border-[#F0EBE3]"
                            } ${deletingShoppingItemIds[item.id] ? "opacity-0" : "opacity-100"} ${
                              isDeletingItem ? "bg-[#FDF2F0]" : ""
                            }`}
                            key={item.id}
                          >
                            <button
                              className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] transition-colors ${
                                item.status === "purchased"
                                  ? "border-[#C9A84C] bg-[#C9A84C] text-white"
                                  : "border-[#E8E2D9] bg-white text-transparent"
                              }`}
                              onClick={() => void toggleShoppingPurchased(item)}
                              type="button"
                            >
                              <Check className="h-3 w-3" />
                            </button>

                            <div className="min-w-0 flex-1">
                              {isEditingItem ? (
                                <input
                                  autoFocus
                                  className="w-full border-0 border-b border-[#C9A84C] bg-transparent px-0 py-1 text-[13px] text-[#2C241E] outline-none focus:ring-0"
                                  onChange={(event) =>
                                    setEditingShoppingItemDrafts((current) => ({
                                      ...current,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      void saveShoppingItemTitle(item);
                                    }

                                    if (event.key === "Escape") {
                                      cancelEditingShoppingItem();
                                    }
                                  }}
                                  value={editingShoppingItemDrafts[item.id] ?? item.title}
                                />
                              ) : (
                                <p
                                  className={`text-[13px] ${
                                    item.status === "purchased"
                                      ? "text-[#B0A697] line-through"
                                      : "text-[#4E453B]"
                                  }`}
                                >
                                  {item.title}
                                </p>
                              )}
                            </div>

                            {isDeletingItem ? (
                              <div className="flex items-center gap-2 text-[12px] text-[#A54B45]">
                                <span>Delete?</span>
                                <button
                                  className="font-medium text-[#A54B45]"
                                  onClick={() => void deleteShoppingItem(item)}
                                  type="button"
                                >
                                  Yes
                                </button>
                                <button
                                  className="text-[#8B8378]"
                                  onClick={() => setConfirmingShoppingItemDelete(null)}
                                  type="button"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                <button
                                  className="rounded-full p-2 text-[#8B8378] transition-colors hover:text-[#1C1A17]"
                                  onClick={() => startEditingShoppingItem(item)}
                                  type="button"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  className="rounded-full p-2 text-[#8B8378] transition-colors hover:text-[#A54B45]"
                                  onClick={() => setConfirmingShoppingItemDelete(item.id)}
                                  type="button"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}

                    {addingItemCategory === group.category ? (
                      <div className="mx-[18px] mb-2 mt-2 rounded-[8px] border border-dashed border-[rgba(201,168,76,0.3)] px-4 py-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                          <input
                            autoFocus
                            className="min-w-0 flex-1 border-0 border-b border-[#C9A84C] bg-transparent px-0 py-1 text-[13px] text-[#2C241E] outline-none placeholder:text-[#958B7B] focus:ring-0"
                            onChange={(event) =>
                              setShoppingDrafts((current) => ({
                                ...current,
                                [group.category]: {
                                  ...(current[group.category] ?? initialShoppingDraft),
                                  title: event.target.value,
                                },
                              }))
                            }
                            placeholder="Item name..."
                            value={shoppingDrafts[group.category]?.title ?? ""}
                          />
                          <div className="flex items-center gap-3">
                            <button
                              className="text-[13px] font-medium text-[#C9A84C]"
                              onClick={() => void saveAddedShoppingItem(group.category)}
                              type="button"
                            >
                              Add
                            </button>
                            <button
                              className="text-[13px] text-[#8B8378]"
                              onClick={() => setAddingItemCategory(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mx-[18px] mb-2 mt-2">
                        <button
                          className="flex w-full items-center rounded-[8px] border border-dashed border-[rgba(201,168,76,0.3)] px-[14px] py-[10px] text-[13px] text-[#C9A84C]"
                          onClick={() => setAddingItemCategory(group.category)}
                          type="button"
                        >
                          + Add item
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="mt-2 rounded-[12px] border border-[rgba(201,168,76,0.25)] bg-[#FAF7F2] px-[18px] py-[14px]">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[#C9A84C]">
              ✦ Wedly suggests
            </p>
            <div className="mt-3 space-y-3">
              {shoppingSuggestions.length > 0 ? (
                shoppingSuggestions.map((suggestion) => (
                  <div
                    className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                    key={`${suggestion.category}-${suggestion.title}`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <p className="truncate text-[13px] text-[#4E453B]">{suggestion.title}</p>
                      <span className="rounded-full bg-[#FBF7ED] px-2 py-1 text-[10px] text-[#C9A84C]">
                        {suggestion.category}
                      </span>
                    </div>
                    <button
                      className="text-left text-[13px] font-medium text-[#C9A84C] sm:text-right"
                      onClick={() => void addShoppingSuggestion(suggestion)}
                      type="button"
                    >
                      Add +
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-[12px] text-[#A69A88]">All suggestions added</p>
              )}
            </div>
          </div>
        </div>
      )}

      {isAddCategoryOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(28,26,23,0.4)] px-4"
          onClick={() => setIsAddCategoryOpen(false)}
        >
          <div
            className="w-full max-w-[400px] rounded-[16px] bg-white px-8 py-8"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <p className="font-display text-[24px] leading-none text-[#1C1A17]">
                New category
              </p>
              <button
                className="text-[#8B8378]"
                onClick={() => setIsAddCategoryOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="mt-6">
              <input
                autoFocus
                className="w-full border-0 border-b border-[#C9A84C] bg-transparent px-0 py-2 text-[13px] text-[#2C241E] outline-none placeholder:text-[#958B7B] focus:ring-0"
                onChange={(event) => setNewShoppingCategoryName(event.target.value)}
                placeholder="e.g. Groom's outfit, Stationery"
                value={newShoppingCategoryName}
              />
            </div>

            <button
              className="mt-8 w-full rounded-[12px] bg-[#1C1A17] px-4 py-3 text-[13px] font-medium text-[#FAF7F2]"
              onClick={() => void createShoppingCategory()}
              type="button"
            >
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );

  const renderGuestsTab = () => {
    return (
      <div className="space-y-6">
        {guestCounts.pending > 10 ? (
          <div className="flex flex-col gap-4 rounded-[12px] border border-[#D7C9A2] bg-[#FAF7F2] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-[#4E453B]">
              ✦ {guestCounts.pending} guests haven&apos;t responded yet. Good time to
              send a reminder.
            </p>
            <button
              className="rounded-[10px] border border-[#C9A84C] px-4 py-2 text-[12px] font-medium text-[#C9A84C]"
              onClick={() => router.push("/comms")}
              type="button"
            >
              Draft reminder →
            </button>
          </div>
        ) : null}

        <div className="rounded-[14px] border border-[#E8E2D9] bg-white px-5 py-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Total invited", guestCounts.total],
              ["Confirmed", guestCounts.confirmed],
              ["Pending", guestCounts.pending],
              ["Declined", guestCounts.declined],
            ].map(([label, value]) => (
              <div
                className="rounded-[12px] border border-[#EFE7D9] bg-[#FCFAF6] px-4 py-3"
                key={label}
              >
                <p className="text-[11px] uppercase tracking-[0.12em] text-[#8B8378]">
                  {label}
                </p>
                <p className="mt-2 font-display text-[24px] leading-none text-[#1C1A17]">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {(["All", "Bride's side", "Groom's side"] as const).map((option) => (
              <button
                className={`rounded-full px-4 py-2 text-[12px] transition-colors ${
                  guestSideFilter === option
                    ? "bg-[#1C1A17] text-[#FAF7F2]"
                    : "bg-white text-[#7B7163]"
                }`}
                key={option}
                onClick={() => setGuestSideFilter(option)}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {(["All", "Confirmed", "Pending", "Declined"] as const).map((option) => (
              <button
                className={`rounded-full px-4 py-2 text-[12px] transition-colors ${
                  guestStatusFilter === option
                    ? "bg-[#1C1A17] text-[#FAF7F2]"
                    : "bg-white text-[#7B7163]"
                }`}
                key={option}
                onClick={() => setGuestStatusFilter(option)}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[14px] border border-[#E8E2D9] bg-white px-5 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-[#8B8378]">
                Guest list
              </p>
            </div>
            <button
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-[10px] bg-[#1C1A17] px-4 py-2 text-[13px] font-medium text-[#FAF7F2]"
              onClick={() => setIsAddGuestOpen((current) => !current)}
              type="button"
            >
              <Plus className="h-4 w-4" />
              Add guest
            </button>
          </div>

          {guestsError ? (
            <div className="mt-4 rounded-[12px] border border-[#E8C7C2] bg-[#FDF2F0] px-4 py-3 text-[13px] text-[#A54B45]">
              {guestsError}
            </div>
          ) : null}

          {isAddGuestOpen ? (
            <div className="mt-5 rounded-[12px] border border-[#EFE7D9] bg-[#FCFAF6] px-4 py-4">
              <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr_170px_150px_1fr]">
                <UnderlineInput
                  onChange={(value) =>
                    setGuestDraft((current) => ({ ...current, name: value }))
                  }
                  placeholder="Name"
                  value={guestDraft.name}
                />
                <UnderlineInput
                  onChange={(value) =>
                    setGuestDraft((current) => ({ ...current, phone: value }))
                  }
                  placeholder="Phone"
                  value={guestDraft.phone}
                />
                <select
                  className="border-0 border-b border-[#D7C9A2] bg-transparent px-0 py-2 text-[13px] text-[#2C241E] outline-none"
                  onChange={(event) =>
                    setGuestDraft((current) => ({
                      ...current,
                      side: event.target.value as GuestSide,
                    }))
                  }
                  value={guestDraft.side}
                >
                  <option>Bride&apos;s side</option>
                  <option>Groom&apos;s side</option>
                </select>
                <select
                  className="border-0 border-b border-[#D7C9A2] bg-transparent px-0 py-2 text-[13px] text-[#2C241E] outline-none"
                  onChange={(event) =>
                    setGuestDraft((current) => ({
                      ...current,
                      rsvp_status: event.target.value as GuestStatus,
                    }))
                  }
                  value={guestDraft.rsvp_status}
                >
                  <option>Pending</option>
                  <option>Confirmed</option>
                  <option>Declined</option>
                </select>
                <UnderlineInput
                  onChange={(value) =>
                    setGuestDraft((current) => ({
                      ...current,
                      dietary_notes: value,
                    }))
                  }
                  placeholder="Dietary notes"
                  value={guestDraft.dietary_notes}
                />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  className="text-[13px] text-[#8B8378]"
                  onClick={() => {
                    setIsAddGuestOpen(false);
                    setGuestDraft(initialGuestDraft);
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-[10px] bg-[#1C1A17] px-4 py-2 text-[13px] font-medium text-[#FAF7F2]"
                  disabled={isSavingGuest}
                  onClick={() => void saveGuest()}
                  type="button"
                >
                  {isSavingGuest ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </button>
              </div>
            </div>
          ) : null}

          {isGuestsLoading ? (
            <div className="py-10 text-center text-[14px] text-[#7B7163]">
              Loading guests...
            </div>
          ) : filteredGuests.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-display text-[20px] text-[#B0A697]">No guests added yet</p>
              <p className="mt-3 text-[14px] text-[#8B8378]">
                Start building your guest list
              </p>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {filteredGuests.map((guest) => {
                const isEditing = editingGuestId === guest.id;
                const draft =
                  editingGuestDrafts[guest.id] ?? {
                    dietary_notes: guest.dietary_notes ?? "",
                    name: guest.name,
                    phone: guest.phone ?? "",
                    rsvp_status: guest.rsvp_status,
                    side: guest.side,
                  };

                const rsvpStyles =
                  guest.rsvp_status === "Confirmed"
                    ? { background: "#E6F3EA", color: "#2D7A50" }
                    : guest.rsvp_status === "Declined"
                      ? { background: "#F8E8E4", color: "#A54B45" }
                      : { background: "#F5EDDA", color: "#8B6B16" };

                return (
                  <div
                    className="rounded-[12px] border border-[#EFE7D9] bg-[#FCFAF6] px-4 py-4"
                    key={guest.id}
                  >
                    {isEditing ? (
                      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr_170px_150px_1fr_auto]">
                        <UnderlineInput
                          onChange={(value) =>
                            setEditingGuestDrafts((current) => ({
                              ...current,
                              [guest.id]: { ...draft, name: value },
                            }))
                          }
                          placeholder="Name"
                          value={draft.name}
                        />
                        <UnderlineInput
                          onChange={(value) =>
                            setEditingGuestDrafts((current) => ({
                              ...current,
                              [guest.id]: { ...draft, phone: value },
                            }))
                          }
                          placeholder="Phone"
                          value={draft.phone}
                        />
                        <select
                          className="border-0 border-b border-[#D7C9A2] bg-transparent px-0 py-2 text-[13px] text-[#2C241E] outline-none"
                          onChange={(event) =>
                            setEditingGuestDrafts((current) => ({
                              ...current,
                              [guest.id]: {
                                ...draft,
                                side: event.target.value as GuestSide,
                              },
                            }))
                          }
                          value={draft.side}
                        >
                          <option>Bride&apos;s side</option>
                          <option>Groom&apos;s side</option>
                        </select>
                        <select
                          className="border-0 border-b border-[#D7C9A2] bg-transparent px-0 py-2 text-[13px] text-[#2C241E] outline-none"
                          onChange={(event) =>
                            setEditingGuestDrafts((current) => ({
                              ...current,
                              [guest.id]: {
                                ...draft,
                                rsvp_status: event.target.value as GuestStatus,
                              },
                            }))
                          }
                          value={draft.rsvp_status}
                        >
                          <option>Pending</option>
                          <option>Confirmed</option>
                          <option>Declined</option>
                        </select>
                        <UnderlineInput
                          onChange={(value) =>
                            setEditingGuestDrafts((current) => ({
                              ...current,
                              [guest.id]: {
                                ...draft,
                                dietary_notes: value,
                              },
                            }))
                          }
                          placeholder="Dietary notes"
                          value={draft.dietary_notes}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            className="text-[12px] text-[#8B8378]"
                            onClick={() => setEditingGuestId(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                          <button
                            className="rounded-[10px] bg-[#1C1A17] px-3 py-2 text-[12px] text-[#FAF7F2]"
                            onClick={() => void saveGuestEdit(guest.id)}
                            type="button"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="grid flex-1 gap-3 lg:grid-cols-[1.2fr_170px_150px_1fr]">
                          <span className="text-[13px] font-medium text-[#1C1A17]">
                            {guest.name}
                          </span>
                          <span className="rounded-full bg-[#F5EDDA] px-3 py-1 text-[11px] font-medium text-[#8B6B16]">
                            {guest.side}
                          </span>
                          <span
                            className="rounded-full px-3 py-1 text-[11px] font-medium"
                            style={rsvpStyles}
                          >
                            {guest.rsvp_status}
                          </span>
                          <span className="text-[12px] text-[#7B7163]">
                            {guest.dietary_notes || "No dietary notes"}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-full p-2 text-[#8B8378] hover:bg-[#F7F0E4] hover:text-[#1C1A17]"
                            onClick={() => startEditingGuest(guest)}
                            type="button"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            className="rounded-full p-2 text-[#8B8378] hover:bg-[#FDF2F0] hover:text-[#A54B45]"
                            onClick={() => void deleteGuest(guest)}
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="mx-auto flex h-[calc(100vh-120px)] w-full max-w-[1280px] flex-col bg-[#FAF7F2] px-4 pb-8 pt-2 sm:px-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="font-display text-[32px] leading-none text-[#1C1A17]">
            Budget & More
          </h1>
        </div>

        {pageError ? (
          <div className="rounded-[12px] border border-[#E8C7C2] bg-[#FDF2F0] px-4 py-3 text-[13px] text-[#A54B45]">
            {pageError}
          </div>
        ) : null}

        <div className="border-b border-[#E8E2D9]">
          <div className="flex gap-6">
            {tabOptions.map((tab) => (
              <button
                className={`relative pb-4 text-[14px] transition-colors ${
                  activeTab === tab.id ? "text-[#1C1A17]" : "text-[#8B8378]"
                }`}
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                type="button"
              >
                {tab.label}
                {activeTab === tab.id ? (
                  <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#C9A84C]" />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className="mt-6 flex-1 overflow-y-auto pr-1"
        onScroll={() => {
          if (contentRef.current) {
            scrollPositionsRef.current[activeTab] = contentRef.current.scrollTop;
          }
        }}
        ref={contentRef}
      >
        <div className="animate-in fade-in duration-200">
          {activeTab === "budget"
            ? renderBudgetTab()
            : activeTab === "shopping"
              ? renderShoppingTab()
              : renderGuestsTab()}
        </div>
      </div>
    </section>
  );
}
