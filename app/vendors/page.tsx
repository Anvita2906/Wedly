"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HTMLInputTypeAttribute } from "react";

import { createClient } from "@/lib/supabase/client";
import { getWeddingProfileForUser } from "@/lib/supabase/wedding-profile";
import type { Database, WeddingProfile } from "@/lib/supabase/types";
import { useWeddingStore } from "@/store/weddingStore";

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

type VendorInsert = Omit<VendorRow, "id">;

type VendorUpdate = Partial<Omit<VendorRow, "id" | "user_id">>;

type ExtendedDatabase = {
  public: {
    CompositeTypes: Database["public"]["CompositeTypes"];
    Enums: Database["public"]["Enums"];
    Functions: Database["public"]["Functions"];
    Tables: Database["public"]["Tables"] & {
      vendors: {
        Insert: VendorInsert;
        Relationships: [];
        Row: VendorRow;
        Update: VendorUpdate;
      };
    };
    Views: Database["public"]["Views"];
  };
};

type CategoryGroup = {
  budgetAllocated: number | null;
  category: string;
  note: string | null;
  status: VendorStatus;
  vendorCount: number;
  vendors: VendorRow[];
};

type CategoryTip = {
  tip: string;
  urgency: "high" | "medium" | "low";
};

type VendorFormState = {
  amount_paid: string;
  contact_name: string;
  email: string;
  notes: string;
  phone: string;
  vendor_name: string;
};

type AddCategoryFormState = {
  budget_allocated: string;
  category: string;
  notes: string;
};

type VendorMeta = {
  amount_paid?: number | null;
  contact_name?: string;
  email?: string;
  phone?: string;
  vendor_name?: string;
};

const initialCategoryForm: AddCategoryFormState = {
  budget_allocated: "",
  category: "",
  notes: "",
};

const statusOrder: Record<VendorStatus, number> = {
  cancelled: 0,
  not_started: 1,
  researching: 2,
  shortlisted: 3,
  booked: 4,
};

const vendorMetaMarker = "[[WEDLY_VENDOR_META]]";

function parseVendorMeta(notes: string | null | undefined): VendorMeta {
  if (!notes) {
    return {};
  }

  const markerIndex = notes.indexOf(vendorMetaMarker);

  if (markerIndex === -1) {
    return {};
  }

  const rawMeta = notes.slice(markerIndex + vendorMetaMarker.length).trim();

  try {
    return JSON.parse(rawMeta) as VendorMeta;
  } catch {
    return {};
  }
}

function stripVendorMeta(notes: string | null | undefined) {
  if (!notes) {
    return "";
  }

  const markerIndex = notes.indexOf(vendorMetaMarker);
  return markerIndex === -1 ? notes : notes.slice(0, markerIndex).trim();
}

function buildVendorNotes(notes: string, meta: VendorMeta) {
  const cleanNotes = stripVendorMeta(notes).trim();
  const meaningfulMeta = Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );

  if (!Object.keys(meaningfulMeta).length) {
    return cleanNotes || null;
  }

  return `${cleanNotes}${cleanNotes ? "\n\n" : ""}${vendorMetaMarker} ${JSON.stringify(
    meaningfulMeta,
  )}`;
}

function getVendorDisplayName(vendor: VendorRow) {
  const meta = parseVendorMeta(vendor.notes);
  return (
    vendor.vendor_name?.trim() ||
    meta.vendor_name?.trim() ||
    vendor.contact_name?.trim() ||
    meta.contact_name?.trim() ||
    "Vendor entry"
  );
}

function getVendorContact(vendor: VendorRow) {
  const meta = parseVendorMeta(vendor.notes);
  return (
    vendor.phone?.trim() ||
    meta.phone?.trim() ||
    vendor.email?.trim() ||
    meta.email?.trim() ||
    null
  );
}

function getVendorPaidAmount(vendor: VendorRow) {
  const meta = parseVendorMeta(vendor.notes);

  if (vendor.amount_paid !== null && vendor.amount_paid !== undefined) {
    return vendor.amount_paid;
  }

  return meta.amount_paid ?? null;
}

function hasVendorDetails(vendor: VendorRow) {
  const meta = parseVendorMeta(vendor.notes);
  const directPaidAmount =
    typeof vendor.amount_paid === "number" && Number.isFinite(vendor.amount_paid)
      ? vendor.amount_paid
      : null;
  const metaPaidAmount =
    typeof meta.amount_paid === "number" && Number.isFinite(meta.amount_paid)
      ? meta.amount_paid
      : null;
  const hasPaidAmount =
    (directPaidAmount !== null && directPaidAmount > 0) ||
    (metaPaidAmount !== null && metaPaidAmount > 0);

  return Boolean(
    vendor.vendor_name?.trim() ||
      meta.vendor_name?.trim() ||
      vendor.contact_name?.trim() ||
      meta.contact_name?.trim() ||
      vendor.phone?.trim() ||
      meta.phone?.trim() ||
      vendor.email?.trim() ||
      meta.email?.trim() ||
      hasPaidAmount,
  );
}

function buildVendorFormState(vendor: VendorRow): VendorFormState {
  const meta = parseVendorMeta(vendor.notes);

  return {
    amount_paid:
      getVendorPaidAmount(vendor) === null || getVendorPaidAmount(vendor) === undefined
        ? ""
        : String(getVendorPaidAmount(vendor)),
    contact_name: vendor.contact_name ?? meta.contact_name ?? "",
    email: vendor.email ?? meta.email ?? "",
    notes: stripVendorMeta(vendor.notes),
    phone: vendor.phone ?? meta.phone ?? "",
    vendor_name: vendor.vendor_name ?? meta.vendor_name ?? "",
  };
}

function parseCurrencyInput(value: string) {
  const sanitized = value.replace(/[^\d.]/g, "").trim();

  if (!sanitized) {
    return null;
  }

  const parsedValue = Number(sanitized);
  return Number.isFinite(parsedValue) ? parsedValue : null;
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

function buildProfileRequestBody(profile: WeddingProfile) {
  return {
    budget: profile.budget,
    city: profile.city,
    guest_count: profile.guest_count,
    partner1_name: profile.partner1_name,
    wedding_date: profile.wedding_date,
    wedding_type: profile.wedding_type,
  };
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

function getUrgencyColor(urgency: CategoryTip["urgency"]) {
  switch (urgency) {
    case "high":
      return "#C86A5A";
    case "medium":
      return "#C9A84C";
    case "low":
    default:
      return "#4D9A8F";
  }
}

function getCategoryStatus(vendors: VendorRow[]) {
  return vendors.reduce<VendorStatus>((current, vendor) => {
    return statusOrder[vendor.status] > statusOrder[current]
      ? vendor.status
      : current;
  }, "cancelled");
}

function groupVendorsByCategory(vendors: VendorRow[]) {
  const groups = new Map<string, CategoryGroup>();

  for (const vendor of vendors) {
    const category = vendor.category.trim() || "Uncategorised";
    const existing = groups.get(category);
    const actualVendorCount = hasVendorDetails(vendor) ? 1 : 0;

    if (!existing) {
      groups.set(category, {
        budgetAllocated: vendor.budget_allocated ?? null,
        category,
        note: stripVendorMeta(vendor.notes) || null,
        status: vendor.status,
        vendorCount: actualVendorCount,
        vendors: [vendor],
      });
      continue;
    }

    existing.vendors.push(vendor);
    existing.vendorCount += actualVendorCount;

    if (existing.budgetAllocated === null && vendor.budget_allocated !== null) {
      existing.budgetAllocated = vendor.budget_allocated;
    }

    if (!existing.note && stripVendorMeta(vendor.notes)) {
      existing.note = stripVendorMeta(vendor.notes);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      status: getCategoryStatus(group.vendors),
      vendors: [...group.vendors].sort((first, second) => {
        const firstName = getVendorDisplayName(first);
        const secondName = getVendorDisplayName(second);
        return firstName.localeCompare(secondName);
      }),
    }))
    .sort((first, second) => first.category.localeCompare(second.category));
}

function getMissingVendorColumn(errorMessage: string) {
  const match = errorMessage.match(
    /Could not find the '([^']+)' column of 'vendors'/i,
  );

  return match?.[1] ?? null;
}

function cleanVendorPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== ""),
  );
}

function UnderlineInput({
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  onChange: (value: string) => void;
  placeholder: string;
  type?: HTMLInputTypeAttribute;
  value: string;
}) {
  return (
    <input
      className="w-full border-0 border-b border-[#D7C9A2] bg-transparent px-0 py-3 text-[14px] text-[#2C241E] outline-none transition-colors placeholder:text-[#958B7B] focus:border-[#C9A84C] focus:ring-0"
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      type={type}
      value={value}
    />
  );
}

function UnderlineTextarea({
  onChange,
  placeholder,
  rows = 3,
  value,
}: {
  onChange: (value: string) => void;
  placeholder: string;
  rows?: number;
  value: string;
}) {
  return (
    <textarea
      className="w-full resize-none border-0 border-b border-[#D7C9A2] bg-transparent px-0 py-3 text-[14px] leading-6 text-[#2C241E] outline-none transition-colors placeholder:text-[#958B7B] focus:border-[#C9A84C] focus:ring-0"
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      value={value}
    />
  );
}

function Overlay({
  isVisible,
  onClick,
}: {
  isVisible: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label="Close overlay"
      className={`fixed inset-0 z-40 bg-[rgba(28,26,23,0.4)] transition-opacity duration-300 ${
        isVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
      onClick={onClick}
      type="button"
    />
  );
}

export default function VendorsPage() {
  const [browserSupabase] = useState(() => createClient());
  const vendorSupabase =
    browserSupabase as unknown as SupabaseClient<ExtendedDatabase>;

  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [drawerErrorMessage, setDrawerErrorMessage] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [categoryTips, setCategoryTips] = useState<Record<string, CategoryTip[]>>({});
  const [tipsLoadingForCategory, setTipsLoadingForCategory] = useState<string | null>(
    null,
  );
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorDrafts, setVendorDrafts] = useState<Record<string, VendorFormState>>(
    {},
  );
  const [savingVendorIds, setSavingVendorIds] = useState<string[]>([]);
  const [deletingVendorIds, setDeletingVendorIds] = useState<string[]>([]);
  const [addingVendorForCategory, setAddingVendorForCategory] = useState<string | null>(
    null,
  );
  const [inlineAddVendorForm, setInlineAddVendorForm] =
    useState<VendorFormState>(buildVendorFormState({
      amount_paid: null,
      budget_allocated: null,
      category: "",
      id: "new",
      is_ai_suggested: false,
      notes: null,
      status: "not_started",
      user_id: "",
      vendor_name: "",
    }));
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [addCategoryForm, setAddCategoryForm] =
    useState<AddCategoryFormState>(initialCategoryForm);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [isSavingVendor, setIsSavingVendor] = useState(false);
  const [isEditingCategoryBudget, setIsEditingCategoryBudget] = useState(false);
  const [categoryBudgetDraft, setCategoryBudgetDraft] = useState("");
  const [isSavingCategoryBudget, setIsSavingCategoryBudget] = useState(false);
  const [deletingCategoryName, setDeletingCategoryName] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const initializedRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);

  const user = useWeddingStore((state) => state.user);
  const weddingProfile = useWeddingStore((state) => state.weddingProfile);
  const setIsOnboarded = useWeddingStore((state) => state.setIsOnboarded);
  const setUser = useWeddingStore((state) => state.setUser);
  const setWeddingProfile = useWeddingStore((state) => state.setWeddingProfile);

  const categories = useMemo(() => groupVendorsByCategory(vendors), [vendors]);
  const activeCategoryGroup = useMemo(
    () =>
      activeCategory
        ? categories.find((category) => category.category === activeCategory) ?? null
        : null,
    [activeCategory, categories],
  );
  const trackedVendorCount = useMemo(
    () => categories.reduce((sum, category) => sum + category.vendorCount, 0),
    [categories],
  );
  const allocatedAmount = useMemo(
    () =>
      categories.reduce(
        (sum, category) => sum + (category.budgetAllocated ?? 0),
        0,
      ),
    [categories],
  );
  const paidAmount = useMemo(
    () =>
      vendors.reduce(
        (sum, vendor) => sum + (hasVendorDetails(vendor) ? getVendorPaidAmount(vendor) ?? 0 : 0),
        0,
      ),
    [vendors],
  );
  const confirmedCount = useMemo(
    () =>
      vendors.filter(
        (vendor) => vendor.status === "booked" && hasVendorDetails(vendor),
      ).length,
    [vendors],
  );
  const totalBudget = weddingProfile?.budget ?? 0;
  const allocationProgress =
    totalBudget > 0 ? Math.min((allocatedAmount / totalBudget) * 100, 100) : 0;

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
          setErrorMessage(error.message);
          setIsInitialLoading(false);
          return;
        }

        nextUser = fetchedUser ?? null;
        setUser(nextUser);
      }

      if (!nextUser) {
        setErrorMessage("No signed-in user found.");
        setIsInitialLoading(false);
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
          setIsInitialLoading(false);
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

      if (detail?.type === "vendor") {
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

    const loadVendors = async () => {
      setIsInitialLoading(true);
      setErrorMessage(null);

      try {
        const { data, error } = await vendorSupabase
          .from("vendors" as never)
          .select("*")
          .eq("user_id", user.id)
          .order("category", { ascending: true });

        if (error) {
          throw error;
        }

        const typedVendors = (data ?? []) as VendorRow[];

        if (typedVendors.length > 0) {
          setVendors(typedVendors);
          setIsInitialLoading(false);
          return;
        }

        const response = await fetch("/api/vendors-generate", {
          body: JSON.stringify(buildProfileRequestBody(weddingProfile)),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        if (!response.ok) {
          throw new Error(
            (await response.text()) || "We couldn't build your vendor plan.",
          );
        }

        const generatedVendors = (await response.json()) as VendorRow[];
        setVendors(generatedVendors);
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "We couldn't build your vendor plan.",
        );
      } finally {
        setIsInitialLoading(false);
      }
    };

    void loadVendors();
  }, [refreshTick, user, vendorSupabase, weddingProfile]);

  useEffect(() => {
    if (!activeCategoryGroup || !weddingProfile || categoryTips[activeCategoryGroup.category]) {
      return;
    }

    let isMounted = true;

    const loadCategoryTips = async () => {
      setTipsLoadingForCategory(activeCategoryGroup.category);
      setDrawerErrorMessage(null);

      try {
        const response = await fetch("/api/vendor-category-tips", {
          body: JSON.stringify({
            budget: activeCategoryGroup.budgetAllocated ?? weddingProfile.budget,
            category: activeCategoryGroup.category,
            city: weddingProfile.city,
            wedding_type: weddingProfile.wedding_type,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        if (!response.ok) {
          throw new Error((await response.text()) || "We couldn't load category tips.");
        }

        const tips = (await response.json()) as CategoryTip[];

        if (!isMounted) {
          return;
        }

        setCategoryTips((current) => ({
          ...current,
          [activeCategoryGroup.category]: tips,
        }));
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setDrawerErrorMessage(
          error instanceof Error ? error.message : "We couldn't load category tips.",
        );
      } finally {
        if (isMounted) {
          setTipsLoadingForCategory(null);
        }
      }
    };

    void loadCategoryTips();

    return () => {
      isMounted = false;
    };
  }, [activeCategoryGroup, categoryTips, weddingProfile]);

  useEffect(() => {
    if (!activeCategoryGroup) {
      setCategoryBudgetDraft("");
      setIsEditingCategoryBudget(false);
      return;
    }

    setCategoryBudgetDraft(
      activeCategoryGroup.budgetAllocated == null
        ? ""
        : String(activeCategoryGroup.budgetAllocated),
    );
    setIsEditingCategoryBudget(false);
  }, [activeCategoryGroup]);

  useEffect(() => {
    if (!isDrawerOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isDrawerOpen]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const openDrawer = (categoryName: string) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }

    setActiveCategory(categoryName);
    window.requestAnimationFrame(() => {
      setIsDrawerOpen(true);
    });
  };

  function closeDrawer() {
    setIsDrawerOpen(false);
    setEditingVendorId(null);
    setAddingVendorForCategory(null);
    setIsEditingCategoryBudget(false);
    setDrawerErrorMessage(null);

    closeTimerRef.current = window.setTimeout(() => {
      setActiveCategory(null);
    }, 300);
  }

  const runVendorMutation = async <T,>(
    payload: Record<string, unknown>,
    runner: (nextPayload: Record<string, unknown>) => Promise<{
      data: T | null;
      error: { message: string } | null;
    }>,
  ) => {
    let nextPayload = cleanVendorPayload(payload);

    while (true) {
      const result = await runner(nextPayload);

      if (!result.error) {
        return result;
      }

      const missingColumn = getMissingVendorColumn(result.error.message);

      if (!missingColumn || !(missingColumn in nextPayload)) {
        return result;
      }

      nextPayload = { ...nextPayload };
      delete nextPayload[missingColumn];
    }
  };

  const updateVendorDraft = (
    vendorId: string,
    field: keyof VendorFormState,
    value: string,
  ) => {
    setVendorDrafts((current) => ({
      ...current,
      [vendorId]: {
        ...(current[vendorId] ?? {
          amount_paid: "",
          contact_name: "",
          email: "",
          notes: "",
          phone: "",
          vendor_name: "",
        }),
        [field]: value,
      },
    }));
  };

  const beginEditingVendor = (vendor: VendorRow) => {
    setEditingVendorId(vendor.id);
    setVendorDrafts((current) => ({
      ...current,
      [vendor.id]: current[vendor.id] ?? buildVendorFormState(vendor),
    }));
  };

  const saveVendor = async (vendorId: string) => {
    const draft = vendorDrafts[vendorId];

    if (!draft) {
      return;
    }

    const patch = {
      amount_paid: parseCurrencyInput(draft.amount_paid),
      contact_name: draft.contact_name || null,
      email: draft.email || null,
      notes: buildVendorNotes(draft.notes, {
        amount_paid: parseCurrencyInput(draft.amount_paid),
        contact_name: draft.contact_name,
        email: draft.email,
        phone: draft.phone,
        vendor_name: draft.vendor_name,
      }),
      phone: draft.phone || null,
      vendor_name: draft.vendor_name || null,
    };

    setSavingVendorIds((current) => [...current, vendorId]);
    setDrawerErrorMessage(null);

    const { data, error } = await runVendorMutation<VendorRow>(
      patch,
      async (nextPayload) =>
        vendorSupabase
          .from("vendors" as never)
          .update(nextPayload as never)
          .eq("id", vendorId)
          .select("*")
          .single(),
    );

    setSavingVendorIds((current) => current.filter((id) => id !== vendorId));

    if (error) {
      setDrawerErrorMessage(error.message);
      return;
    }

    setVendors((current) =>
      current.map((vendor) => (vendor.id === vendorId ? (data as VendorRow) : vendor)),
    );
    setEditingVendorId(null);
  };

  const updateVendorStatus = async (vendorId: string, nextStatus: VendorStatus) => {
    setDrawerErrorMessage(null);

    const { data, error } = await vendorSupabase
      .from("vendors" as never)
      .update({ status: nextStatus } as never)
      .eq("id", vendorId)
      .select("*")
      .single();

    if (error) {
      setDrawerErrorMessage(error.message);
      return;
    }

    setVendors((current) =>
      current.map((vendor) => (vendor.id === vendorId ? (data as VendorRow) : vendor)),
    );
  };

  const deleteVendor = async (vendor: VendorRow) => {
    const label = vendor.vendor_name?.trim() || vendor.category;

    if (!window.confirm(`Delete ${label}?`)) {
      return;
    }

    setDeletingVendorIds((current) => [...current, vendor.id]);
    setDrawerErrorMessage(null);

    const { error } = await vendorSupabase
      .from("vendors" as never)
      .delete()
      .eq("id", vendor.id);

    setDeletingVendorIds((current) => current.filter((id) => id !== vendor.id));

    if (error) {
      setDrawerErrorMessage(error.message);
      return;
    }

    setVendors((current) => current.filter((item) => item.id !== vendor.id));

    if (
      activeCategoryGroup &&
      activeCategoryGroup.vendorCount <= 1 &&
      activeCategoryGroup.category === vendor.category
    ) {
      setEditingVendorId(null);
    }
  };

  const saveInlineVendor = async () => {
    if (!user || !activeCategoryGroup) {
      return;
    }

    if (!inlineAddVendorForm.vendor_name.trim()) {
      setDrawerErrorMessage("Vendor name is required.");
      return;
    }

    setIsSavingVendor(true);
    setDrawerErrorMessage(null);

    const payload = {
      amount_paid: parseCurrencyInput(inlineAddVendorForm.amount_paid),
      budget_allocated: activeCategoryGroup.budgetAllocated,
      category: activeCategoryGroup.category,
      contact_name: inlineAddVendorForm.contact_name || null,
      email: inlineAddVendorForm.email || null,
      is_ai_suggested: false,
      notes: buildVendorNotes(inlineAddVendorForm.notes, {
        amount_paid: parseCurrencyInput(inlineAddVendorForm.amount_paid),
        contact_name: inlineAddVendorForm.contact_name,
        email: inlineAddVendorForm.email,
        phone: inlineAddVendorForm.phone,
        vendor_name: inlineAddVendorForm.vendor_name,
      }),
      phone: inlineAddVendorForm.phone || null,
      status: "not_started" as VendorStatus,
      user_id: user.id,
      vendor_name: inlineAddVendorForm.vendor_name || null,
    };

    const { data, error } = await runVendorMutation<VendorRow>(
      payload,
      async (nextPayload) =>
        vendorSupabase
          .from("vendors" as never)
          .insert(nextPayload as never)
          .select("*")
          .single(),
    );

    setIsSavingVendor(false);

    if (error) {
      setDrawerErrorMessage(error.message);
      return;
    }

    setVendors((current) => [...current, data as VendorRow]);
    setInlineAddVendorForm(buildVendorFormState({
      amount_paid: null,
      budget_allocated: null,
      category: activeCategoryGroup.category,
      id: "new",
      is_ai_suggested: false,
      notes: null,
      status: "not_started",
      user_id: user.id,
      vendor_name: "",
    }));
    setAddingVendorForCategory(null);
  };

  const saveCategoryBudget = async () => {
    if (!user || !activeCategoryGroup) {
      return;
    }

    setIsSavingCategoryBudget(true);
    setDrawerErrorMessage(null);

    const nextBudget = parseCurrencyInput(categoryBudgetDraft);

    const { data, error } = await vendorSupabase
      .from("vendors" as never)
      .update({ budget_allocated: nextBudget } as never)
      .eq("user_id", user.id)
      .eq("category", activeCategoryGroup.category)
      .select("*");

    setIsSavingCategoryBudget(false);

    if (error) {
      setDrawerErrorMessage(error.message);
      return;
    }

    const updatedRows = (data ?? []) as VendorRow[];
    const updatedById = new Map(updatedRows.map((vendor) => [vendor.id, vendor]));

    setVendors((current) =>
      current.map((vendor) => updatedById.get(vendor.id) ?? vendor),
    );
    setIsEditingCategoryBudget(false);
  };

  const deleteCategory = async (categoryName: string) => {
    if (!user) {
      setDrawerErrorMessage("No signed-in user found.");
      return;
    }

    const targetGroup = categories.find((category) => category.category === categoryName);
    const vendorSummary =
      targetGroup && targetGroup.vendorCount > 0
        ? ` This will also remove ${targetGroup.vendorCount} saved vendor${
            targetGroup.vendorCount === 1 ? "" : "s"
          } in this category.`
        : "";

    if (!window.confirm(`Delete the ${categoryName} category?${vendorSummary}`)) {
      return;
    }

    setDeletingCategoryName(categoryName);
    setDrawerErrorMessage(null);

    const { error } = await vendorSupabase
      .from("vendors" as never)
      .delete()
      .eq("user_id", user.id)
      .eq("category", categoryName);

    setDeletingCategoryName(null);

    if (error) {
      setDrawerErrorMessage(error.message);
      return;
    }

    setVendors((current) =>
      current.filter((vendor) => vendor.category !== categoryName),
    );
    setCategoryTips((current) => {
      const next = { ...current };
      delete next[categoryName];
      return next;
    });

    if (activeCategory === categoryName) {
      closeDrawer();
    }
  };

  const saveCategory = async () => {
    if (!user) {
      setErrorMessage("No signed-in user found.");
      return;
    }

    if (!addCategoryForm.category.trim()) {
      setErrorMessage("Category name is required.");
      return;
    }

    setIsSavingCategory(true);
    setErrorMessage(null);

    const payload = {
      budget_allocated: parseCurrencyInput(addCategoryForm.budget_allocated),
      category: addCategoryForm.category.trim(),
      is_ai_suggested: false,
      notes: addCategoryForm.notes.trim() || null,
      status: "not_started" as VendorStatus,
      user_id: user.id,
    };

    const { data, error } = await runVendorMutation<VendorRow>(
      payload,
      async (nextPayload) =>
        vendorSupabase
          .from("vendors" as never)
          .insert(nextPayload as never)
          .select("*")
          .single(),
    );

    setIsSavingCategory(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const nextVendor = data as VendorRow;
    setVendors((current) => [...current, nextVendor]);
    setAddCategoryForm(initialCategoryForm);
    setIsAddCategoryModalOpen(false);
    openDrawer(nextVendor.category);
  };

  const drawerTips = activeCategory ? categoryTips[activeCategory] ?? [] : [];
  const visibleDrawerVendors =
    activeCategoryGroup?.vendors.filter((vendor) => hasVendorDetails(vendor)) ?? [];

  if (isInitialLoading) {
    return (
      <section className="flex min-h-[calc(100vh-180px)] flex-col items-center justify-center bg-[#FAF7F2] px-6 text-center">
        <h1 className="font-display text-[54px] leading-none text-[#1C1A17]">
          Wedly
        </h1>
        <p className="mt-6 font-display text-[24px] text-[#1C1A17]">
          ✦ Building your vendor plan...
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-[#FAF7F2] px-4 pb-10 pt-2 sm:px-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="font-display text-[28px] leading-none text-[#1C1A17] sm:text-[34px]">
              Your vendors
            </h1>
            <p className="mt-3 text-[14px] text-[#7B7163]">
              {categories.length} categories · {trackedVendorCount} vendors tracked
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-[#1C1A17] px-4 py-3 text-[14px] font-medium text-[#FAF7F2] transition-opacity hover:opacity-90"
              onClick={() => setIsAddCategoryModalOpen(true)}
              type="button"
            >
              <Plus className="h-4 w-4" />
              Add category
            </button>
          </div>
        </div>

        {errorMessage ? (
          <div className="rounded-[12px] border border-[#E8C7C2] bg-[#FDF2F0] px-4 py-3 text-[13px] text-[#A54B45]">
            {errorMessage}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[14px] border border-[#E8E2D9] bg-white px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#C9A84C]">
              Total budget
            </p>
            <p className="mt-2 font-display text-[26px] leading-none text-[#C9A84C]">
              {formatCurrency(totalBudget)}
            </p>
          </div>
          <div className="rounded-[14px] border border-[#E8E2D9] bg-white px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#8B8378]">
              Allocated
            </p>
            <p className="mt-2 font-display text-[26px] leading-none text-[#1C1A17]">
              {formatCurrency(allocatedAmount)}
            </p>
          </div>
          <div className="rounded-[14px] border border-[#E8E2D9] bg-white px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#8B8378]">
              Paid
            </p>
            <p className="mt-2 font-display text-[26px] leading-none text-[#1C1A17]">
              {formatCurrency(paidAmount)}
            </p>
          </div>
          <div className="rounded-[14px] border border-[#E8E2D9] bg-white px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#8B8378]">
              Confirmed count
            </p>
            <p className="mt-2 font-display text-[26px] leading-none text-[#1C1A17]">
              {confirmedCount}
            </p>
          </div>
        </div>

        <div className="h-[2px] overflow-hidden rounded-full bg-[#E6DED2]">
          <div
            className="h-full rounded-full bg-[#C9A84C] transition-[width] duration-300"
            style={{ width: `${allocationProgress}%` }}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {categories.map((category) => {
            const statusStyles = getStatusStyles(category.status);

            return (
              <button
                className="rounded-[12px] border border-[#E8E2D9] bg-white p-5 text-left shadow-[0_2px_8px_rgba(28,26,23,0.04)] transition-all hover:border-[#C9A84C] hover:shadow-[0_6px_16px_rgba(28,26,23,0.08)]"
                key={category.category}
                onClick={() => openDrawer(category.category)}
                type="button"
              >
                <h2 className="text-[15px] font-semibold text-[#1C1A17]">
                  {category.category}
                </h2>
                <p className="mt-3 font-display text-[22px] leading-none text-[#C9A84C]">
                  {formatCurrency(category.budgetAllocated)}
                </p>
                <p className="mt-4 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] italic text-[#7B7163]">
                  {category.note || "Wedly is tracking this category for your wedding plan."}
                </p>

                <div className="mt-6 flex items-center justify-between gap-3">
                  <span
                    className="rounded-full px-3 py-1 text-[11px] font-medium"
                    style={{
                      background: statusStyles.background,
                      color: statusStyles.color,
                    }}
                  >
                    {statusStyles.label}
                  </span>
                  <span className="text-[12px] text-[#8B8378]">
                    {category.vendorCount > 0
                      ? `${category.vendorCount} vendor${
                          category.vendorCount === 1 ? "" : "s"
                        } added`
                      : "No vendors yet"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <Overlay isVisible={isDrawerOpen} onClick={closeDrawer} />

      {activeCategoryGroup ? (
        <aside
          className={`fixed inset-x-0 bottom-0 z-50 h-[88vh] rounded-t-[24px] bg-white transition-transform duration-300 ease-out sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-full sm:max-w-[480px] sm:rounded-l-[24px] sm:rounded-tr-none ${
            isDrawerOpen
              ? "translate-y-0 sm:translate-x-0"
              : "translate-y-full sm:translate-x-full sm:translate-y-0"
          }`}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-6 sm:px-7">
              <div>
                <h2 className="font-display text-[24px] leading-none text-[#1C1A17]">
                  {activeCategoryGroup.category}
                </h2>
                {isEditingCategoryBudget ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 rounded-full border border-[#E8E2D9] bg-[#FAF7F2] px-4 py-2">
                      <span className="text-[13px] text-[#958B7B]">₹</span>
                      <input
                        className="w-[120px] border-0 bg-transparent text-[14px] text-[#1C1A17] outline-none placeholder:text-[#958B7B]"
                        inputMode="numeric"
                        onChange={(event) => setCategoryBudgetDraft(event.target.value)}
                        placeholder="Budget"
                        value={categoryBudgetDraft}
                      />
                    </div>
                    <button
                      className="inline-flex items-center justify-center rounded-[10px] bg-[#1C1A17] px-3 py-2 text-[12px] font-medium text-[#FAF7F2] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isSavingCategoryBudget}
                      onClick={() => void saveCategoryBudget()}
                      type="button"
                    >
                      {isSavingCategoryBudget ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Save budget"
                      )}
                    </button>
                    <button
                      className="text-[12px] text-[#8B8378] transition-opacity hover:opacity-75"
                      onClick={() => {
                        setCategoryBudgetDraft(
                          activeCategoryGroup.budgetAllocated == null
                            ? ""
                            : String(activeCategoryGroup.budgetAllocated),
                        );
                        setIsEditingCategoryBudget(false);
                      }}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2.5">
                    <p className="text-[14px] text-[#7B7163]">
                      Budget allocated {formatCurrency(activeCategoryGroup.budgetAllocated)}
                    </p>
                    <button
                      aria-label="Edit budget"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#E6D7AF] bg-[#FBF7ED] text-[#C9A84C] transition-colors hover:border-[#D6BB66] hover:bg-[#F7EDD7] hover:text-[#A8841F]"
                      onClick={() => setIsEditingCategoryBudget(true)}
                      title="Edit budget"
                      type="button"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  className="rounded-full p-2 text-[#8B8378] transition-colors hover:bg-[#FDF2F0] hover:text-[#A54B45]"
                  disabled={deletingCategoryName === activeCategoryGroup.category}
                  onClick={() => void deleteCategory(activeCategoryGroup.category)}
                  type="button"
                >
                  {deletingCategoryName === activeCategoryGroup.category ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Trash2 className="h-5 w-5" />
                  )}
                </button>
                <button
                  className="rounded-full p-2 text-[#8B8378] transition-colors hover:bg-[#F7F0E4] hover:text-[#1C1A17]"
                  onClick={closeDrawer}
                  type="button"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="mx-6 h-px bg-[#D7C9A2] sm:mx-7" />

            <div className="flex-1 overflow-y-auto px-6 pb-8 pt-5 sm:px-7">
              {drawerErrorMessage ? (
                <div className="mb-4 rounded-[10px] border border-[#E8C7C2] bg-[#FDF2F0] px-4 py-3 text-[12px] text-[#A54B45]">
                  {drawerErrorMessage}
                </div>
              ) : null}

              <p className="text-[10px] uppercase tracking-[0.22em] text-[#C9A84C]">
                ✦ Wedly suggests
              </p>

              {tipsLoadingForCategory === activeCategoryGroup.category ? (
                <p className="mt-3 text-[12px] text-[#C9A84C]">Generating tips...</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {drawerTips.map((tip, index) => (
                    <div
                      className="rounded-[10px] bg-[#FAF7F2] px-4 py-3"
                      key={`${activeCategoryGroup.category}-tip-${index}`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className="mt-1 h-2.5 w-2.5 rounded-full"
                          style={{ background: getUrgencyColor(tip.urgency) }}
                        />
                        <p className="text-[12px] leading-6 text-[#4E453B]">
                          {tip.tip}
                        </p>
                      </div>
                    </div>
                  ))}

                  {!drawerTips.length && !tipsLoadingForCategory ? (
                    <div className="rounded-[10px] bg-[#FAF7F2] px-4 py-3 text-[12px] text-[#7B7163]">
                      Category tips will appear here as Wedly reviews this vendor lane.
                    </div>
                  ) : null}
                </div>
              )}

              <p className="mt-8 text-[11px] uppercase tracking-[0.16em] text-[#8B8378]">
                Vendors in this category
              </p>

              <div className="mt-5 space-y-3">
                {visibleDrawerVendors.length ? (
                  visibleDrawerVendors.map((vendor) => {
                    const draft =
                      vendorDrafts[vendor.id] ?? buildVendorFormState(vendor);
                    const isEditing = editingVendorId === vendor.id;
                    const isSaving = savingVendorIds.includes(vendor.id);
                    const isDeleting = deletingVendorIds.includes(vendor.id);
                    const statusStyles = getStatusStyles(vendor.status);

                    return (
                      <div
                        className="group rounded-[12px] border border-[#EDE6DA] bg-white px-4 py-4 shadow-[0_2px_8px_rgba(28,26,23,0.04)]"
                        key={vendor.id}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            className="min-w-0 flex-1 text-left"
                            onClick={() => beginEditingVendor(vendor)}
                            type="button"
                          >
                            <p className="truncate text-[13px] font-medium text-[#1C1A17]">
                              {getVendorDisplayName(vendor)}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span
                                className="rounded-full px-3 py-1 text-[10px] font-medium"
                                style={{
                                  background: statusStyles.background,
                                  color: statusStyles.color,
                                }}
                              >
                                {statusStyles.label}
                              </span>
                              <span className="text-[12px] text-[#4E453B]">
                                {formatCurrency(getVendorPaidAmount(vendor))}
                              </span>
                              {getVendorContact(vendor) ? (
                                <span className="text-[12px] text-[#8B8378]">
                                  {getVendorContact(vendor)}
                                </span>
                              ) : null}
                            </div>
                          </button>

                          <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                            <button
                              className="rounded-full p-2 text-[#8B8378] transition-colors hover:bg-[#F7F0E4] hover:text-[#1C1A17]"
                              onClick={() => beginEditingVendor(vendor)}
                              type="button"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              className="rounded-full p-2 text-[#8B8378] transition-colors hover:bg-[#FDF2F0] hover:text-[#A54B45]"
                              disabled={isDeleting}
                              onClick={() => void deleteVendor(vendor)}
                              type="button"
                            >
                              {isDeleting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="mt-4 grid gap-4 border-t border-[#F0E6D8] pt-4">
                            <UnderlineInput
                              onChange={(value) =>
                                updateVendorDraft(vendor.id, "vendor_name", value)
                              }
                              placeholder="Vendor name"
                              value={draft.vendor_name}
                            />
                            <UnderlineInput
                              onChange={(value) =>
                                updateVendorDraft(vendor.id, "contact_name", value)
                              }
                              placeholder="Contact name"
                              value={draft.contact_name}
                            />
                            <UnderlineInput
                              onChange={(value) =>
                                updateVendorDraft(vendor.id, "phone", value)
                              }
                              placeholder="Phone"
                              type="tel"
                              value={draft.phone}
                            />
                            <UnderlineInput
                              onChange={(value) =>
                                updateVendorDraft(vendor.id, "email", value)
                              }
                              placeholder="Email"
                              type="email"
                              value={draft.email}
                            />
                            <UnderlineInput
                              onChange={(value) =>
                                updateVendorDraft(vendor.id, "amount_paid", value)
                              }
                              placeholder="Amount paid"
                              value={draft.amount_paid}
                            />
                            <UnderlineTextarea
                              onChange={(value) =>
                                updateVendorDraft(vendor.id, "notes", value)
                              }
                              placeholder="Notes"
                              value={draft.notes}
                            />

                            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                              <select
                                className="rounded-full border border-[#E8E2D9] bg-[#FAF7F2] px-4 py-2 text-[12px] text-[#1C1A17] outline-none transition-colors focus:border-[#C9A84C]"
                                onChange={(event) =>
                                  void updateVendorStatus(
                                    vendor.id,
                                    event.target.value as VendorStatus,
                                  )
                                }
                                value={vendor.status}
                              >
                                <option value="not_started">Not started</option>
                                <option value="researching">Researching</option>
                                <option value="shortlisted">Shortlisted</option>
                                <option value="booked">Booked</option>
                                <option value="cancelled">Cancelled</option>
                              </select>

                              <div className="flex items-center gap-3">
                                <button
                                  className="text-[13px] text-[#8B8378] transition-opacity hover:opacity-75"
                                  onClick={() => setEditingVendorId(null)}
                                  type="button"
                                >
                                  Cancel
                                </button>
                                <button
                                  className="inline-flex items-center justify-center rounded-[10px] bg-[#1C1A17] px-4 py-2 text-[13px] font-medium text-[#FAF7F2] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={isSaving}
                                  onClick={() => void saveVendor(vendor.id)}
                                  type="button"
                                >
                                  {isSaving ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    "Save"
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-[12px] border border-dashed border-[#E8E2D9] bg-[#FCFAF6] px-5 py-10 text-center">
                    <p className="font-display text-[18px] text-[#B0A697]">
                      No vendors added yet
                    </p>
                  </div>
                )}
              </div>

              {addingVendorForCategory === activeCategoryGroup.category ? (
                <div className="mt-4 rounded-[12px] border border-[#E8E2D9] bg-[#FCFAF6] px-4 py-4">
                  <div className="grid gap-4">
                    <UnderlineInput
                      onChange={(value) =>
                        setInlineAddVendorForm((current) => ({
                          ...current,
                          vendor_name: value,
                        }))
                      }
                      placeholder="Vendor name"
                      value={inlineAddVendorForm.vendor_name}
                    />
                    <UnderlineInput
                      onChange={(value) =>
                        setInlineAddVendorForm((current) => ({
                          ...current,
                          contact_name: value,
                        }))
                      }
                      placeholder="Contact name"
                      value={inlineAddVendorForm.contact_name}
                    />
                    <UnderlineInput
                      onChange={(value) =>
                        setInlineAddVendorForm((current) => ({
                          ...current,
                          phone: value,
                        }))
                      }
                      placeholder="Phone"
                      type="tel"
                      value={inlineAddVendorForm.phone}
                    />
                    <UnderlineInput
                      onChange={(value) =>
                        setInlineAddVendorForm((current) => ({
                          ...current,
                          email: value,
                        }))
                      }
                      placeholder="Email"
                      type="email"
                      value={inlineAddVendorForm.email}
                    />
                    <UnderlineInput
                      onChange={(value) =>
                        setInlineAddVendorForm((current) => ({
                          ...current,
                          amount_paid: value,
                        }))
                      }
                      placeholder="Amount paid"
                      value={inlineAddVendorForm.amount_paid}
                    />
                    <UnderlineTextarea
                      onChange={(value) =>
                        setInlineAddVendorForm((current) => ({
                          ...current,
                          notes: value,
                        }))
                      }
                      placeholder="Notes"
                      value={inlineAddVendorForm.notes}
                    />
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-3">
                    <button
                      className="text-[13px] text-[#8B8378] transition-opacity hover:opacity-75"
                      onClick={() => setAddingVendorForCategory(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="inline-flex items-center justify-center rounded-[10px] bg-[#1C1A17] px-4 py-2 text-[13px] font-medium text-[#FAF7F2] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isSavingVendor}
                      onClick={() => void saveInlineVendor()}
                      type="button"
                    >
                      {isSavingVendor ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Save"
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="mt-4 flex w-full items-center justify-center rounded-[12px] border border-dashed border-[#D7C9A2] bg-transparent px-4 py-4 text-[13px] font-medium text-[#C9A84C] transition-colors hover:bg-[#FBF7ED]"
                  onClick={() => {
                    setAddingVendorForCategory(activeCategoryGroup.category);
                    setInlineAddVendorForm({
                      amount_paid: "",
                      contact_name: "",
                      email: "",
                      notes: "",
                      phone: "",
                      vendor_name: "",
                    });
                  }}
                  type="button"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add vendor to {activeCategoryGroup.category}
                </button>
              )}
            </div>
          </div>
        </aside>
      ) : null}

      <Overlay
        isVisible={isAddCategoryModalOpen}
        onClick={() => {
          setIsAddCategoryModalOpen(false);
        }}
      />

      {isAddCategoryModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="w-full max-w-[440px] rounded-[16px] bg-white p-8 shadow-[0_18px_50px_rgba(28,26,23,0.15)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-[24px] leading-none text-[#1C1A17]">
                  Add vendor category
                </h2>
              </div>
              <button
                className="rounded-full p-2 text-[#8B8378] transition-colors hover:bg-[#F7F0E4] hover:text-[#1C1A17]"
                onClick={() => setIsAddCategoryModalOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid gap-4">
              <UnderlineInput
                onChange={(value) =>
                  setAddCategoryForm((current) => ({ ...current, category: value }))
                }
                placeholder="Category name"
                value={addCategoryForm.category}
              />
              <div className="flex items-center gap-3 border-b border-[#D7C9A2]">
                <span className="py-3 text-[14px] text-[#958B7B]">₹</span>
                <input
                  className="w-full border-0 bg-transparent px-0 py-3 text-[14px] text-[#2C241E] outline-none placeholder:text-[#958B7B] focus:ring-0"
                  onChange={(event) =>
                    setAddCategoryForm((current) => ({
                      ...current,
                      budget_allocated: event.target.value,
                    }))
                  }
                  placeholder="Budget allocated"
                  value={addCategoryForm.budget_allocated}
                />
              </div>
              <UnderlineTextarea
                onChange={(value) =>
                  setAddCategoryForm((current) => ({ ...current, notes: value }))
                }
                placeholder="Notes"
                value={addCategoryForm.notes}
              />
            </div>

            <button
              className="mt-8 inline-flex w-full items-center justify-center rounded-[12px] bg-[#1C1A17] px-4 py-3 text-[14px] font-medium text-[#FAF7F2] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSavingCategory}
              onClick={() => void saveCategory()}
              type="button"
            >
              {isSavingCategory ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save category"
              )}
            </button>
          </div>
        </div>
      ) : null}

    </>
  );
}
