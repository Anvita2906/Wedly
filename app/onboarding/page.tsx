"use client";

import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSupabase } from "@/components/supabase-session-provider";
import type { Database, WeddingProfile } from "@/lib/supabase/types";
import { useWeddingStore } from "@/store/weddingStore";

const TOTAL_STEPS = 7;
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const cities = [
  "Mumbai",
  "Delhi",
  "Bengaluru",
  "Hyderabad",
  "Chennai",
  "Kolkata",
  "Pune",
  "Jaipur",
  "Udaipur",
  "Ahmedabad",
  "Chandigarh",
  "Kochi",
  "Goa",
  "Agra",
  "Mysuru",
  "Surat",
  "Vadodara",
  "Lucknow",
  "Bhopal",
  "Indore",
];

const weddingTypes = [
  {
    subtitle: "Tamil, Telugu, Kannada, Malayalam",
    title: "South Indian",
    value: "South Indian",
  },
  {
    subtitle: "Punjabi, Rajasthani, UP, Delhi",
    title: "North Indian",
    value: "North Indian",
  },
  {
    subtitle: "Church, registry, courthouse",
    title: "Western",
    value: "Western",
  },
  {
    subtitle: "Mix of cultures and traditions",
    title: "Fusion",
    value: "Fusion",
  },
  {
    subtitle: "Resort, beach, hill station",
    title: "Destination",
    value: "Destination",
  },
  {
    subtitle: "Under 50 guests, close family only",
    title: "Intimate",
    value: "Intimate",
  },
];

const guestRanges = [
  {
    description: "Intimate gathering",
    label: "Under 50",
    value: "under-50",
  },
  {
    description: "Close family & friends",
    label: "50–150",
    value: "50-150",
  },
  {
    description: "Traditional celebration",
    label: "150–300",
    value: "150-300",
  },
  {
    description: "Grand affair",
    label: "300+",
    value: "300-plus",
  },
];

const budgetRanges = [
  {
    description: "Intimate budget",
    label: "Under ₹5L",
    value: "under-5l",
  },
  {
    description: "Moderate",
    label: "₹5L–₹15L",
    value: "5l-15l",
  },
  {
    description: "Traditional",
    label: "₹15L–₹30L",
    value: "15l-30l",
  },
  {
    description: "Premium",
    label: "₹30L–₹60L",
    value: "30l-60l",
  },
  {
    description: "Luxury",
    label: "₹60L+",
    value: "60l-plus",
  },
];

type OnboardingFormState = {
  budgetExact: string;
  budgetRange: string;
  city: string;
  cityQuery: string;
  guestCountExact: string;
  guestRange: string;
  partner1_name: string;
  partner2_name: string;
  role: "" | "couple" | "planner";
  weddingDay: string;
  weddingMonth: string;
  weddingType: string;
  weddingYear: string;
};

const initialFormState: OnboardingFormState = {
  budgetExact: "",
  budgetRange: "",
  city: "",
  cityQuery: "",
  guestCountExact: "",
  guestRange: "",
  partner1_name: "",
  partner2_name: "",
  role: "",
  weddingDay: "",
  weddingMonth: "",
  weddingType: "",
  weddingYear: "",
};

type LuxeOption = {
  label: string;
  value: string;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function parseNumericInput(value: string) {
  const normalized = value.replace(/[^\d]/g, "");

  if (!normalized) {
    return null;
  }

  const numericValue = Number(normalized);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatDateString(
  day: string,
  month: string,
  year: string,
): string | null {
  if (!day || !month || !year) {
    return null;
  }

  const normalizedMonth = String(Number(month) + 1).padStart(2, "0");
  const normalizedDay = day.padStart(2, "0");

  return `${year}-${normalizedMonth}-${normalizedDay}`;
}

function getGuestCountValue(form: OnboardingFormState) {
  const exactValue = parseNumericInput(form.guestCountExact);

  if (exactValue !== null) {
    return exactValue;
  }

  switch (form.guestRange) {
    case "under-50":
      return 40;
    case "50-150":
      return 100;
    case "150-300":
      return 225;
    case "300-plus":
      return 350;
    default:
      return null;
  }
}

function getBudgetValue(form: OnboardingFormState) {
  const exactValue = parseNumericInput(form.budgetExact);

  if (exactValue !== null) {
    return exactValue;
  }

  switch (form.budgetRange) {
    case "under-5l":
      return 400000;
    case "5l-15l":
      return 1000000;
    case "15l-30l":
      return 2250000;
    case "30l-60l":
      return 4500000;
    case "60l-plus":
      return 6000000;
    default:
      return null;
  }
}

function getWeddingDate(
  day: string,
  month: string,
  year: string,
): Date | null {
  if (!day || !month || !year) {
    return null;
  }

  const result = new Date(Number(year), Number(month), Number(day));

  if (
    Number.isNaN(result.getTime()) ||
    result.getFullYear() !== Number(year) ||
    result.getMonth() !== Number(month) ||
    result.getDate() !== Number(day)
  ) {
    return null;
  }

  result.setHours(0, 0, 0, 0);
  return result;
}

function addMonths(date: Date, monthsToAdd: number) {
  return new Date(
    date.getFullYear(),
    date.getMonth() + monthsToAdd,
    date.getDate(),
  );
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function pluralize(value: number, label: string) {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

function ChoiceCard({
  compact = false,
  onClick,
  selected,
  subtitle,
  title,
}: {
  compact?: boolean;
  onClick: () => void;
  selected: boolean;
  subtitle: string;
  title: string;
}) {
  return (
    <button
      className={classNames(
        "w-full text-left transition-all duration-200 hover:-translate-y-0.5",
        compact ? "px-6 py-5" : "min-w-[240px] px-8 py-7 md:w-[340px]",
        selected ? "border-2" : "border",
      )}
      onClick={onClick}
      style={{
        background: selected ? "#FBF7ED" : "#FFFFFF",
        borderColor: selected ? "#C9A84C" : "#E8E2D9",
        borderRadius: "12px",
        boxShadow: selected
          ? "0 16px 40px rgba(201, 168, 76, 0.12)"
          : "0 12px 32px rgba(28, 26, 23, 0.06)",
        cursor: "pointer",
      }}
      type="button"
    >
      <p className="font-display text-[28px] leading-none text-ink">{title}</p>
      <p className="mt-3 text-[14px] leading-6 text-ink-muted">{subtitle}</p>
    </button>
  );
}

function LuxeSelect({
  isOpen,
  onSelect,
  onToggle,
  options,
  placeholder,
  value,
}: {
  isOpen: boolean;
  onSelect: (value: string) => void;
  onToggle: () => void;
  options: LuxeOption[];
  placeholder: string;
  value: string;
}) {
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? "";

  return (
    <div className="relative">
      <button
        className="flex w-full items-center justify-between border-0 border-b border-[#E8E2D9] bg-transparent px-0 py-4 text-left text-[16px] text-ink transition-colors duration-200 hover:border-[#D2C7B7] focus-visible:border-gold"
        onClick={onToggle}
        style={{ cursor: "pointer" }}
        type="button"
      >
        <span className={value ? "text-ink" : "text-ink-muted"}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown
          className={classNames(
            "h-4 w-4 shrink-0 text-gold transition-transform duration-200",
            isOpen && "rotate-180",
          )}
          strokeWidth={1.8}
        />
      </button>

      {isOpen ? (
        <div className="absolute left-0 top-full z-20 mt-3 max-h-60 w-full overflow-y-auto rounded-[18px] border border-border bg-white p-2 shadow-[0_18px_40px_rgba(28,26,23,0.08)]">
          {options.map((option) => (
            <button
              className={classNames(
                "flex w-full items-center justify-between rounded-[12px] px-4 py-3 text-left text-[14px] transition-colors",
                option.value === value
                  ? "bg-gold-pale text-ink"
                  : "text-ink-muted hover:bg-[#F8F3EA] hover:text-ink",
              )}
              key={option.value}
              onClick={() => onSelect(option.value)}
              style={{ cursor: "pointer" }}
              type="button"
            >
              <span>{option.label}</span>
              {option.value === value ? (
                <Check className="h-4 w-4 text-gold" strokeWidth={2} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LoadingScreen() {
  return (
    <section className="flex min-h-screen flex-col items-center justify-center bg-cream px-6 text-center">
      <p className="font-display text-[54px] leading-none text-ink">
        Wed<span className="text-gold">ly</span>
      </p>
      <div className="mt-6 flex items-center gap-3">
        {[0, 1, 2].map((index) => (
          <span
            className="onboarding-dot h-3 w-3 rounded-full bg-gold"
            key={index}
            style={{ animationDelay: `${index * 0.18}s` }}
          />
        ))}
      </div>
      <p className="mt-8 font-display text-[24px] leading-[1.4] text-ink-muted">
        Wedly is building your personalised plan...
      </p>
    </section>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { session, supabase } = useSupabase();
  const storeUser = useWeddingStore((state) => state.user);
  const setIsOnboarded = useWeddingStore((state) => state.setIsOnboarded);
  const setWeddingProfile = useWeddingStore((state) => state.setWeddingProfile);
  const user = storeUser ?? session?.user ?? null;

  const [activeDropdown, setActiveDropdown] = useState<
    "city" | "day" | "month" | "year" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [form, setForm] = useState<OnboardingFormState>(initialFormState);
  const [isSaving, setIsSaving] = useState(false);
  const [step, setStep] = useState(1);
  const deferredCityQuery = useDeferredValue(form.cityQuery);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setActiveDropdown(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  const filteredCities = useMemo(() => {
    const query = deferredCityQuery.trim().toLowerCase();

    if (!query) {
      return cities;
    }

    return cities.filter((city) => city.toLowerCase().includes(query));
  }, [deferredCityQuery]);

  const minimumWeddingDate = useMemo(() => {
    const today = startOfDay(new Date());
    return startOfDay(addMonths(today, 1));
  }, []);

  const availableYears = useMemo(() => {
    const startYear = minimumWeddingDate.getFullYear();
    return Array.from({ length: 5 }, (_, index) => startYear + index);
  }, [minimumWeddingDate]);

  const weddingDate = useMemo(
    () => getWeddingDate(form.weddingDay, form.weddingMonth, form.weddingYear),
    [form.weddingDay, form.weddingMonth, form.weddingYear],
  );

  const weddingDateMessage = useMemo(() => {
    if (!weddingDate) {
      return null;
    }

    const today = startOfDay(new Date());

    if (weddingDate < minimumWeddingDate) {
      return {
        tone: "danger" as const,
        value: `Choose a date on or after ${minimumWeddingDate.toLocaleDateString(
          "en-IN",
          {
            day: "numeric",
            month: "long",
            year: "numeric",
          },
        )} so Wedly has at least one month to plan properly.`,
      };
    }

    let monthsDifference = 0;
    let cursor = new Date(today);

    while (addMonths(cursor, 1) <= weddingDate) {
      cursor = addMonths(cursor, 1);
      monthsDifference += 1;
    }

    const daysDifference = Math.round(
      (weddingDate.getTime() - cursor.getTime()) / (1000 * 60 * 60 * 24),
    );

    return {
      tone: "gold" as const,
      value: `Your wedding is in ${pluralize(
        monthsDifference,
        "month",
      )} and ${pluralize(daysDifference, "day")}`,
    };
  }, [minimumWeddingDate, weddingDate]);

  const canContinue = useMemo(() => {
    switch (step) {
      case 1:
        return Boolean(form.role);
      case 2:
        return Boolean(
          form.partner1_name.trim() && form.partner2_name.trim(),
        );
      case 3:
        return Boolean(
          weddingDate && weddingDateMessage?.tone !== "danger",
        );
      case 4:
        return Boolean(form.city);
      case 5:
        return Boolean(form.weddingType);
      case 6:
        return Boolean(form.guestRange || parseNumericInput(form.guestCountExact));
      case 7:
        return Boolean(form.budgetRange || parseNumericInput(form.budgetExact));
      default:
        return false;
    }
  }, [form, step, weddingDate, weddingDateMessage]);

  const isPlannerFlow = form.role === "planner";
  const progress = (step / TOTAL_STEPS) * 100;
  const firstNamePlaceholder = "Bride's name";
  const secondNamePlaceholder = "Groom's name";
  const namesHeading = isPlannerFlow
    ? "Who is getting married?"
    : "What are your names?";
  const namesSubtitle = isPlannerFlow
    ? "We'll personalise the plan for your client couple"
    : "We'll personalise everything for you";
  const plannerAccountHint = isPlannerFlow
    ? "Your planner profile will use your signed-in Wedly account details."
    : null;
  const weddingDateHeading = isPlannerFlow
    ? "When is your client's wedding?"
    : "When is your wedding?";
  const weddingDateSubtitle = isPlannerFlow
    ? "Even an approximate date helps us plan for them"
    : "Even an approximate date helps us plan";
  const weddingLocationHeading = isPlannerFlow
    ? "Where is the wedding taking place?"
    : "Where is the wedding?";
  const weddingTypeHeading = isPlannerFlow
    ? "What kind of wedding are they planning?"
    : "What kind of wedding?";
  const weddingTypeSubtitle = isPlannerFlow
    ? "This helps us tailor the client planning checklist"
    : "This helps us tailor your planning checklist";
  const guestHeading = isPlannerFlow
    ? "How many guests are they expecting?"
    : "How many guests are you expecting?";
  const guestSubtitle = isPlannerFlow
    ? "A rough client estimate is absolutely fine"
    : "Rough estimate is fine";
  const guestExactLabel = isPlannerFlow
    ? "Or enter the client's exact number"
    : "Or enter exact number";
  const budgetHeading = isPlannerFlow
    ? "What's the couple's approximate budget?"
    : "What's your approximate budget?";
  const budgetSubtitle = isPlannerFlow
    ? "We'll keep every rupee accounted for in their plan"
    : "We'll keep every rupee accounted for";
  const budgetExactLabel = isPlannerFlow
    ? "Or enter the couple's exact budget in ₹"
    : "Or enter your exact budget in ₹";
  const finalStepButtonLabel = isPlannerFlow
    ? "Start client planning →"
    : "Start my wedding journey →";

  const updateField = <K extends keyof OnboardingFormState>(
    field: K,
    value: OnboardingFormState[K],
  ) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const goToStep = (nextStep: number) => {
    startTransition(() => {
      setStep(nextStep);
    });
    setActiveDropdown(null);
    setErrorMessage(null);
  };

  const handleBack = () => {
    if (step === 1) {
      return;
    }

    goToStep(step - 1);
  };

  const handleComplete = async () => {
    if (!user) {
      setErrorMessage("Please sign in again to continue onboarding.");
      return;
    }

    setErrorMessage(null);
    setIsSaving(true);

    const weddingDateValue = formatDateString(
      form.weddingDay,
      form.weddingMonth,
      form.weddingYear,
    );

    const weddingProfile: WeddingProfile = {
      budget: getBudgetValue(form),
      city: form.city || null,
      guest_count: getGuestCountValue(form),
      partner1_name: form.partner1_name.trim() || null,
      partner2_name: form.partner2_name.trim() || null,
      role: form.role || null,
      wedding_date: weddingDateValue,
      wedding_type: form.weddingType || null,
    };

    const payload: Database["public"]["Tables"]["wedding_profiles"]["Insert"] = {
      ...weddingProfile,
      user_id: user.id,
    };

    const startedAt = Date.now();
    const { data: existingProfiles, error: lookupError } = await supabase
      .from("wedding_profiles")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .overrideTypes<Array<{ id: string }>, { merge: false }>();

    if (lookupError) {
      setErrorMessage(lookupError.message);
      setIsSaving(false);
      return;
    }

    const existingProfileId = existingProfiles?.[0]?.id ?? null;
    const { error } = existingProfileId
      ? await supabase
          .from("wedding_profiles")
          .update(weddingProfile as never)
          .eq("id", existingProfileId)
      : await supabase.from("wedding_profiles").insert(payload as never);

    const elapsed = Date.now() - startedAt;

    if (elapsed < 2000) {
      await new Promise((resolve) => setTimeout(resolve, 2000 - elapsed));
    }

    if (error) {
      setErrorMessage(error.message);
      setIsSaving(false);
      return;
    }

    setWeddingProfile(weddingProfile);
    setIsOnboarded(true);
    router.replace("/");
    router.refresh();
  };

  const handleContinue = async () => {
    if (!canContinue || isSaving) {
      return;
    }

    if (step === TOTAL_STEPS) {
      await handleComplete();
      return;
    }

    goToStep(step + 1);
  };

  const stepContent = useMemo(() => {
    switch (step) {
      case 1:
        return (
          <div className="mx-auto flex w-full max-w-[760px] flex-col items-center text-center">
            <p className="text-[12px] uppercase tracking-[0.26em] text-gold">
              Let&apos;s get started
            </p>
            <h1 className="mt-5 max-w-[680px] pb-8 font-display text-[40px] leading-[1.2] text-ink md:pb-10 md:text-[48px] md:leading-[1.18]">
              How are you using Wedly?
            </h1>
            <div className="mt-4 flex w-full flex-col items-center justify-center gap-6 md:mt-6 md:flex-row md:items-stretch md:justify-center">
              <ChoiceCard
                onClick={() => updateField("role", "couple")}
                selected={form.role === "couple"}
                subtitle="Planning our own wedding together"
                title="We&apos;re the couple"
              />
              <ChoiceCard
                onClick={() => updateField("role", "planner")}
                selected={form.role === "planner"}
                subtitle="Managing weddings for my clients"
                title="I&apos;m a wedding planner"
              />
            </div>
          </div>
        );
      case 2:
        return (
          <div className="mx-auto flex w-full max-w-[820px] flex-col items-center text-center">
            <h1 className="max-w-[720px] font-display text-[40px] leading-[1.16] text-ink md:text-[48px]">
              {namesHeading}
            </h1>
            <p className="mt-8 text-[16px] leading-7 text-ink-muted">
              {namesSubtitle}
            </p>
            {plannerAccountHint ? (
              <p className="mt-3 text-[13px] leading-6 text-[#A0907A]">
                {plannerAccountHint}
              </p>
            ) : null}
            <div className="mx-auto mt-16 w-full max-w-[760px] md:mt-20">
              <div className="grid gap-x-20 gap-y-12 md:grid-cols-2">
                <label className="block text-left">
                  <div className="border-b border-[#E8E2D9] transition-colors duration-200 focus-within:border-gold">
                    <input
                      className="w-full border-none bg-transparent px-0 py-[18px] text-[16px] text-ink outline-none placeholder:text-ink-muted focus:outline-none focus-visible:outline-none"
                      onChange={(event) =>
                        updateField("partner1_name", event.target.value)
                      }
                      placeholder={firstNamePlaceholder}
                      style={{ border: "none", boxShadow: "none", outline: "none" }}
                      value={form.partner1_name}
                    />
                  </div>
                </label>
                <label className="block text-left">
                  <div className="border-b border-[#E8E2D9] transition-colors duration-200 focus-within:border-gold">
                    <input
                      className="w-full border-none bg-transparent px-0 py-[18px] text-[16px] text-ink outline-none placeholder:text-ink-muted focus:outline-none focus-visible:outline-none"
                      onChange={(event) =>
                        updateField("partner2_name", event.target.value)
                      }
                      placeholder={secondNamePlaceholder}
                      style={{ border: "none", boxShadow: "none", outline: "none" }}
                      value={form.partner2_name}
                    />
                  </div>
                </label>
              </div>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="font-display text-[40px] leading-[1.06] text-ink md:text-[48px]">
              {weddingDateHeading}
            </h1>
            <p className="mt-4 text-[16px] leading-7 text-ink-muted">
              {weddingDateSubtitle}
            </p>
            <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-3">
              <LuxeSelect
                isOpen={activeDropdown === "day"}
                onSelect={(value) => {
                  updateField("weddingDay", value);
                  setActiveDropdown(null);
                }}
                onToggle={() =>
                  setActiveDropdown((current) =>
                    current === "day" ? null : "day",
                  )
                }
                options={Array.from({ length: 31 }, (_, index) => ({
                  label: String(index + 1),
                  value: String(index + 1),
                }))}
                placeholder="Day"
                value={form.weddingDay}
              />
              <LuxeSelect
                isOpen={activeDropdown === "month"}
                onSelect={(value) => {
                  updateField("weddingMonth", value);
                  setActiveDropdown(null);
                }}
                onToggle={() =>
                  setActiveDropdown((current) =>
                    current === "month" ? null : "month",
                  )
                }
                options={months.map((month, index) => ({
                  label: month,
                  value: String(index),
                }))}
                placeholder="Month"
                value={form.weddingMonth}
              />
              <LuxeSelect
                isOpen={activeDropdown === "year"}
                onSelect={(value) => {
                  updateField("weddingYear", value);
                  setActiveDropdown(null);
                }}
                onToggle={() =>
                  setActiveDropdown((current) =>
                    current === "year" ? null : "year",
                  )
                }
                options={availableYears.map((year) => ({
                  label: String(year),
                  value: String(year),
                }))}
                placeholder="Year"
                value={form.weddingYear}
              />
            </div>
            {weddingDateMessage ? (
              <p
                className={classNames(
                  "mt-10 font-display text-[20px] italic",
                  weddingDateMessage.tone === "danger"
                    ? "text-danger"
                    : "text-gold",
                )}
              >
                {weddingDateMessage.value}
              </p>
            ) : null}
          </div>
        );
      case 4:
        return (
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="font-display text-[40px] leading-[1.06] text-ink md:text-[48px]">
              {weddingLocationHeading}
            </h1>
            <div className="relative mx-auto mt-10 max-w-xl text-left">
              <div className="rounded-[18px] border border-[#E8E2D9] bg-white px-5 py-4 transition-colors duration-200 focus-within:border-gold">
                <input
                  className="w-full border-0 bg-transparent p-0 text-[14px] text-ink outline-none placeholder:text-ink-muted"
                  onChange={(event) => {
                    updateField("cityQuery", event.target.value);
                    updateField("city", "");
                    setActiveDropdown("city");
                  }}
                  onFocus={() => setActiveDropdown("city")}
                  placeholder="Search city"
                  value={form.cityQuery}
                />
              </div>

              {activeDropdown === "city" ? (
                <div className="absolute left-0 top-full z-20 mt-3 max-h-72 w-full overflow-y-auto rounded-[20px] border border-border bg-white p-2 shadow-[0_18px_40px_rgba(28,26,23,0.08)]">
                  {filteredCities.length ? (
                    filteredCities.map((city) => (
                      <button
                        className={classNames(
                          "flex w-full items-center justify-between rounded-[12px] px-4 py-3 text-left text-[14px] transition-colors",
                          form.city === city
                            ? "bg-gold-pale text-ink"
                            : "text-ink-muted hover:bg-[#F8F3EA] hover:text-ink",
                        )}
                        key={city}
                        onClick={() => {
                          updateField("city", city);
                          updateField("cityQuery", city);
                          setActiveDropdown(null);
                        }}
                        type="button"
                      >
                        <span>{city}</span>
                        {form.city === city ? (
                          <Check className="h-4 w-4 text-gold" strokeWidth={2} />
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <p className="px-4 py-3 text-[14px] text-ink-muted">
                      No cities match that search.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        );
      case 5:
        return (
          <div className="mx-auto max-w-5xl text-center">
            <h1 className="font-display text-[40px] leading-[1.06] text-ink md:text-[48px]">
              {weddingTypeHeading}
            </h1>
            <p className="mt-4 text-[16px] leading-7 text-ink-muted">
              {weddingTypeSubtitle}
            </p>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {weddingTypes.map((option) => (
                <ChoiceCard
                  compact
                  key={option.value}
                  onClick={() => updateField("weddingType", option.value)}
                  selected={form.weddingType === option.value}
                  subtitle={option.subtitle}
                  title={option.title}
                />
              ))}
            </div>
          </div>
        );
      case 6:
        return (
          <div className="mx-auto max-w-5xl text-center">
            <h1 className="font-display text-[40px] leading-[1.06] text-ink md:text-[48px]">
              {guestHeading}
            </h1>
            <p className="mt-4 text-[16px] leading-7 text-ink-muted">
              {guestSubtitle}
            </p>
            <div className="mt-10 grid gap-5 md:grid-cols-4">
              {guestRanges.map((option) => (
                <ChoiceCard
                  compact
                  key={option.value}
                  onClick={() => updateField("guestRange", option.value)}
                  selected={form.guestRange === option.value}
                  subtitle={option.description}
                  title={option.label}
                />
              ))}
            </div>
            <div className="mx-auto mt-10 max-w-xl text-left">
              <label className="block">
                <span className="text-[14px] text-ink-muted">
                  {guestExactLabel}
                </span>
                <input
                  className="mt-3 w-full border-0 border-b border-[#E8E2D9] bg-transparent px-0 py-[14px] text-[16px] text-ink outline-none transition-colors duration-200 placeholder:text-ink-muted focus:border-gold"
                  onChange={(event) =>
                    updateField("guestCountExact", event.target.value)
                  }
                  placeholder="e.g. 250"
                  type="number"
                  value={form.guestCountExact}
                />
              </label>
            </div>
          </div>
        );
      case 7:
        return (
          <div className="mx-auto max-w-6xl text-center">
            <h1 className="font-display text-[40px] leading-[1.06] text-ink md:text-[48px]">
              {budgetHeading}
            </h1>
            <p className="mt-4 text-[16px] leading-7 text-ink-muted">
              {budgetSubtitle}
            </p>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
              {budgetRanges.map((option) => (
                <ChoiceCard
                  compact
                  key={option.value}
                  onClick={() => updateField("budgetRange", option.value)}
                  selected={form.budgetRange === option.value}
                  subtitle={option.description}
                  title={option.label}
                />
              ))}
            </div>
            <div className="mx-auto mt-10 max-w-xl text-left">
              <label className="block">
                <span className="text-[14px] text-ink-muted">
                  {budgetExactLabel}
                </span>
                <input
                  className="mt-3 w-full border-0 border-b border-[#E8E2D9] bg-transparent px-0 py-[14px] text-[16px] text-ink outline-none transition-colors duration-200 placeholder:text-ink-muted focus:border-gold"
                  inputMode="numeric"
                  onChange={(event) =>
                    updateField("budgetExact", event.target.value)
                  }
                  placeholder="e.g. 2500000"
                  value={form.budgetExact}
                />
              </label>
            </div>
          </div>
        );
      default:
        return null;
    }
  }, [
    activeDropdown,
    budgetExactLabel,
    budgetHeading,
    budgetSubtitle,
    firstNamePlaceholder,
    filteredCities,
    form,
    availableYears,
    guestExactLabel,
    guestHeading,
    guestSubtitle,
    namesHeading,
    namesSubtitle,
    plannerAccountHint,
    secondNamePlaceholder,
    step,
    weddingDateHeading,
    weddingDateSubtitle,
    weddingDateMessage,
    weddingLocationHeading,
    weddingTypeHeading,
    weddingTypeSubtitle,
  ]);

  if (isSaving) {
    return <LoadingScreen />;
  }

  return (
    <section className="min-h-screen bg-cream text-ink" ref={containerRef}>
      <div className="mx-auto flex min-h-screen w-full items-center justify-center px-6 py-8 md:px-10 md:py-12">
        <div className="flex w-full max-w-[980px] flex-col items-center justify-center gap-14 md:gap-16">
          <header className="w-full max-w-[860px]">
            <div className="flex w-full flex-col items-center text-center">
              <Link
                className="font-display text-[40px] font-semibold leading-none text-ink md:text-[52px]"
                href="/landing"
              >
                Wed<span className="text-gold">ly</span>
              </Link>

              <div className="mt-8 flex w-full max-w-[860px] items-center gap-5">
                <div className="flex-1">
                  <div className="h-[2px] w-full overflow-hidden rounded-full bg-[#E8E2D9]">
                    <div
                      className="h-full bg-gold transition-[width] duration-500 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
                <p className="shrink-0 whitespace-nowrap text-right text-[13px] text-ink-muted">
                  Step {step} of {TOTAL_STEPS}
                </p>
              </div>
            </div>
          </header>

          <main className="relative flex w-full max-w-[860px] items-center justify-center">
            <div
              className="onboarding-step flex w-full flex-col items-center justify-center text-center"
              key={step}
            >
              {stepContent}
            </div>
            {errorMessage ? (
              <p className="absolute left-1/2 top-full mt-8 -translate-x-1/2 text-center text-sm text-danger">
                {errorMessage}
              </p>
            ) : null}
          </main>

          <footer className="w-full max-w-[980px]">
            <div className="flex w-full items-center justify-between gap-6">
              <button
                aria-disabled={step === 1}
                className="inline-flex min-w-[176px] items-center justify-center rounded-[4px] px-8 py-[14px] text-[14px] font-medium transition-opacity"
                onClick={() => {
                  if (step !== 1) {
                    handleBack();
                  }
                }}
                style={{
                  background: "#1C1A17",
                  color: "#FAF7F2",
                  cursor: step === 1 ? "default" : "pointer",
                  opacity: step === 1 ? 0.62 : 1,
                }}
                type="button"
              >
                <span style={{ color: "#FAF7F2" }}>Back</span>
              </button>

              <button
                className={classNames(
                  "inline-flex min-w-[176px] items-center justify-center rounded-[4px] px-8 py-[14px] transition-opacity disabled:cursor-not-allowed disabled:opacity-50",
                  step === TOTAL_STEPS
                    ? "font-display text-[18px]"
                    : "text-[14px] font-medium",
                )}
                disabled={!canContinue}
                onClick={handleContinue}
                style={{
                  background: "#1C1A17",
                  color: step === TOTAL_STEPS ? "#C9A84C" : "#FAF7F2",
                  cursor: canContinue ? "pointer" : "not-allowed",
                }}
                type="button"
              >
                {step === TOTAL_STEPS ? finalStepButtonLabel : "Continue"}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </section>
  );
}
