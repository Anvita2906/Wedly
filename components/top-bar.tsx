"use client";

import type { User } from "@supabase/supabase-js";
import { Loader2, Lock, LogOut, Menu, PencilLine, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";
import { getPageTitle } from "@/lib/navigation";
import type { WeddingProfile } from "@/lib/supabase/types";
import { useUiStore } from "@/store/ui-store";
import { useWeddingStore } from "@/store/weddingStore";

function getRoleLabel(role: string | null | undefined) {
  if (role === "planner") {
    return "Wedding planner";
  }

  if (role === "couple") {
    return "Couple";
  }

  return "Not set";
}

function formatCurrencyInput(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function toTitleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function getPlannerAccountLabel(user: User | null) {
  const metadata = user?.user_metadata;
  const candidates = [
    typeof metadata?.company_name === "string" ? metadata.company_name : "",
    typeof metadata?.full_name === "string" ? metadata.full_name : "",
    typeof metadata?.name === "string" ? metadata.name : "",
    user?.email?.split("@")[0] ?? "",
  ];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();

    if (!trimmed) {
      continue;
    }

    if (trimmed.includes("@")) {
      return toTitleCase(trimmed.split("@")[0].replace(/[._-]+/g, " "));
    }

    return toTitleCase(trimmed.replace(/[._-]+/g, " "));
  }

  return "Planner account";
}

function buildFormState(profile: WeddingProfile | null) {
  return {
    budget: formatCurrencyInput(profile?.budget),
    city: profile?.city ?? "",
    guest_count: formatCurrencyInput(profile?.guest_count),
    partner1_name: profile?.partner1_name ?? "",
    partner2_name: profile?.partner2_name ?? "",
    wedding_date: profile?.wedding_date ?? "",
    wedding_type: profile?.wedding_type ?? "",
  };
}

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const pageTitle = getPageTitle(pathname);
  const toggleMobileSidebar = useUiStore((state) => state.toggleMobileSidebar);
  const setIsOnboarded = useWeddingStore((state) => state.setIsOnboarded);
  const setPlanningStartDate = useWeddingStore((state) => state.setPlanningStartDate);
  const setUser = useWeddingStore((state) => state.setUser);
  const user = useWeddingStore((state) => state.user);
  const weddingProfile = useWeddingStore((state) => state.weddingProfile);
  const setWeddingProfile = useWeddingStore((state) => state.setWeddingProfile);

  const supabase = useMemo(() => createClient(), []);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const profilePanelRef = useRef<HTMLDivElement | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [formState, setFormState] = useState(() => buildFormState(weddingProfile));
  const isPlannerRole = weddingProfile?.role === "planner";

  const resetProfilePanel = (profile: WeddingProfile | null) => {
    setIsOpen(false);
    setIsEditing(false);
    setLogoutError(null);
    setSaveError(null);
    setSaveSuccess(null);
    setFormState(buildFormState(profile));
  };

  const clearWedlyClientCache = () => {
    if (typeof window === "undefined") {
      return;
    }

    const keysToRemove: string[] = [];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);

      if (key?.startsWith("wedly_")) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => {
      window.localStorage.removeItem(key);
    });
  };

  useEffect(() => {
    setFormState(buildFormState(weddingProfile));
  }, [weddingProfile]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (
        profilePanelRef.current?.contains(target) ||
        profileButtonRef.current?.contains(target)
      ) {
        return;
      }

      resetProfilePanel(weddingProfile);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        resetProfilePanel(weddingProfile);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen, weddingProfile]);

  const plannerAccountLabel = useMemo(
    () => getPlannerAccountLabel(user),
    [user],
  );

  const profileHeading = isPlannerRole
    ? plannerAccountLabel
    : `${weddingProfile?.partner1_name || "Your"} & ${
        weddingProfile?.partner2_name || "wedding"
      }`;

  const profileDescription = isPlannerRole
    ? "Your planner account stays tied to this profile, while the client wedding details below can be updated anytime."
    : "Update your saved wedding details here anytime.";

  const firstPartnerLabel = isPlannerRole ? "Bride" : "Bride / Partner 1";
  const secondPartnerLabel = isPlannerRole ? "Groom" : "Groom / Partner 2";

  const handleOpenToggle = () => {
    setIsOpen((current) => {
      const next = !current;

      if (!next) {
        resetProfilePanel(weddingProfile);
      }

      return next;
    });
  };

  const handleInputChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = event.target;

    setFormState((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleEditStart = () => {
    setLogoutError(null);
    setSaveError(null);
    setSaveSuccess(null);
    setFormState(buildFormState(weddingProfile));
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setFormState(buildFormState(weddingProfile));
    setLogoutError(null);
    setSaveError(null);
    setSaveSuccess(null);
    setIsEditing(false);
  };

  const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!user) {
      setSaveError("We couldn't find your signed-in account.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    const payload: WeddingProfile = {
      budget: parseOptionalNumber(formState.budget),
      city: formState.city.trim() || null,
      guest_count: parseOptionalNumber(formState.guest_count),
      partner1_name: formState.partner1_name.trim() || null,
      partner2_name: formState.partner2_name.trim() || null,
      role: weddingProfile?.role ?? null,
      wedding_date: formState.wedding_date || null,
      wedding_type: formState.wedding_type.trim() || null,
    };

    const { error } = await supabase
      .from("wedding_profiles" as never)
      .update(payload as never)
      .eq("user_id", user.id);

    if (error) {
      setSaveError(error.message);
      setIsSaving(false);
      return;
    }

    setWeddingProfile(payload);
    setSaveSuccess("Profile updated");
    setIsSaving(false);
    setIsEditing(false);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    setLogoutError(null);
    setSaveError(null);
    setSaveSuccess(null);

    const { error } = await supabase.auth.signOut();

    if (error) {
      setLogoutError(error.message);
      setIsLoggingOut(false);
      return;
    }

    clearWedlyClientCache();
    setPlanningStartDate(null);
    setWeddingProfile(null);
    setIsOnboarded(false);
    setUser(null);
    resetProfilePanel(null);
    setIsLoggingOut(false);
    router.replace("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-white px-5 md:px-7">
      <div className="flex items-center gap-3">
        <button
          aria-label="Toggle navigation menu"
          className="flex size-10 items-center justify-center rounded-full border border-border bg-white text-ink transition-colors duration-150 ease-in-out hover:bg-gold-pale md:hidden"
          onClick={toggleMobileSidebar}
          type="button"
        >
          <Menu className="size-5" strokeWidth={1.8} />
        </button>

        <h1 className="font-display text-[20px] leading-none text-ink">
          {pageTitle}
        </h1>
      </div>

      <div className="relative flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-full bg-success-light px-3 py-2 text-[12px] font-medium text-success">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-35" />
            <span className="relative inline-flex h-full w-full rounded-full bg-success" />
          </span>
          <span>AI Active</span>
        </div>

        <button
          aria-expanded={isOpen}
          aria-label="Open profile"
          className="inline-flex items-center rounded-full border border-[rgba(201,168,76,0.24)] bg-[#FBF7ED] px-4 py-2 text-sm font-semibold text-ink transition-colors duration-150 hover:border-gold/40 hover:bg-[#f8f0df]"
          onClick={handleOpenToggle}
          ref={profileButtonRef}
          type="button"
        >
          <span className="text-[13px] font-medium">Profile</span>
        </button>

        {isOpen ? (
          <div
            className="absolute right-0 top-[calc(100%+12px)] z-50 w-[420px] max-w-[calc(100vw-2rem)] rounded-[20px] border border-[rgba(201,168,76,0.18)] bg-[#fffdf9] p-5 shadow-[0_24px_48px_rgba(28,26,23,0.14)]"
            ref={profilePanelRef}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-gold">
                  Profile
                </p>
                <h2 className="mt-2 font-display text-[28px] leading-none text-ink">
                  {profileHeading}
                </h2>
                <p className="mt-2 text-[12px] text-[#7A7568]">
                  {profileDescription}
                </p>
              </div>

              <button
                aria-label="Close profile"
                className="rounded-full p-1 text-[#7A7568] transition-colors hover:bg-gold-pale hover:text-ink"
                onClick={() => resetProfilePanel(weddingProfile)}
                type="button"
              >
                <X className="size-4" strokeWidth={1.9} />
              </button>
            </div>

            {!isEditing ? (
              <>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {isPlannerRole ? (
                    <div className="rounded-2xl border border-[rgba(201,168,76,0.14)] bg-[#fbf7ed] px-4 py-3">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                        Planner account
                      </p>
                      <p className="mt-2 text-[14px] text-ink">
                        {plannerAccountLabel}
                      </p>
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-[rgba(201,168,76,0.14)] bg-[#fbf7ed] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      {firstPartnerLabel}
                    </p>
                    <p className="mt-2 text-[14px] text-ink">
                      {weddingProfile?.partner1_name || "Not set"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[rgba(201,168,76,0.14)] bg-[#fbf7ed] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      {secondPartnerLabel}
                    </p>
                    <p className="mt-2 text-[14px] text-ink">
                      {weddingProfile?.partner2_name || "Not set"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[rgba(201,168,76,0.14)] bg-[#fbf7ed] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      Wedding date
                    </p>
                    <p className="mt-2 text-[14px] text-ink">
                      {weddingProfile?.wedding_date || "Not set"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[rgba(201,168,76,0.14)] bg-[#fbf7ed] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      City
                    </p>
                    <p className="mt-2 text-[14px] text-ink">
                      {weddingProfile?.city || "Not set"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[rgba(201,168,76,0.14)] bg-[#fbf7ed] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      Budget
                    </p>
                    <p className="mt-2 text-[14px] text-ink">
                      {weddingProfile?.budget != null
                        ? `₹${weddingProfile.budget.toLocaleString("en-IN")}`
                        : "Not set"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[rgba(201,168,76,0.14)] bg-[#fbf7ed] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      Guests
                    </p>
                    <p className="mt-2 text-[14px] text-ink">
                      {weddingProfile?.guest_count ?? "Not set"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[rgba(201,168,76,0.14)] bg-[#fbf7ed] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      Wedding type
                    </p>
                    <p className="mt-2 text-[14px] text-ink">
                      {weddingProfile?.wedding_type || "Not set"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[rgba(201,168,76,0.14)] bg-[#fbf7ed] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                        Role
                      </p>
                      <Lock className="size-3 text-[#B8A96A]" strokeWidth={1.7} />
                    </div>
                    <p className="mt-2 text-[14px] text-ink">
                      {getRoleLabel(weddingProfile?.role)}
                    </p>
                  </div>
                </div>

                <p className="mt-4 text-[11px] text-[#8A847A]">
                  Your role stays locked after onboarding, but you can change all
                  other profile details here.
                </p>

                <button
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-cream transition-opacity hover:opacity-90"
                  onClick={handleEditStart}
                  type="button"
                >
                  <PencilLine className="size-4" strokeWidth={1.8} />
                  Edit details
                </button>
              </>
            ) : (
              <form className="mt-5" onSubmit={handleSaveProfile}>
                <div className="grid gap-4 sm:grid-cols-2">
                  {isPlannerRole ? (
                    <label className="flex flex-col gap-2">
                      <span className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                        Planner account
                      </span>
                      <input
                        className="rounded-2xl border border-[rgba(201,168,76,0.14)] bg-[#f4efe3] px-4 py-3 text-[14px] text-[#7A7568]"
                        disabled
                        value={plannerAccountLabel}
                      />
                    </label>
                  ) : null}

                  <label className="flex flex-col gap-2">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      {firstPartnerLabel}
                    </span>
                    <input
                      className="rounded-2xl border border-[rgba(201,168,76,0.18)] bg-[#fbf7ed] px-4 py-3 text-[14px] text-ink transition-colors focus:border-gold focus:outline-none"
                      name="partner1_name"
                      onChange={handleInputChange}
                      value={formState.partner1_name}
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      {secondPartnerLabel}
                    </span>
                    <input
                      className="rounded-2xl border border-[rgba(201,168,76,0.18)] bg-[#fbf7ed] px-4 py-3 text-[14px] text-ink transition-colors focus:border-gold focus:outline-none"
                      name="partner2_name"
                      onChange={handleInputChange}
                      value={formState.partner2_name}
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      Wedding date
                    </span>
                    <input
                      className="rounded-2xl border border-[rgba(201,168,76,0.18)] bg-[#fbf7ed] px-4 py-3 text-[14px] text-ink transition-colors focus:border-gold focus:outline-none"
                      name="wedding_date"
                      onChange={handleInputChange}
                      type="date"
                      value={formState.wedding_date}
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      City
                    </span>
                    <input
                      className="rounded-2xl border border-[rgba(201,168,76,0.18)] bg-[#fbf7ed] px-4 py-3 text-[14px] text-ink transition-colors focus:border-gold focus:outline-none"
                      name="city"
                      onChange={handleInputChange}
                      value={formState.city}
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      Budget
                    </span>
                    <input
                      className="rounded-2xl border border-[rgba(201,168,76,0.18)] bg-[#fbf7ed] px-4 py-3 text-[14px] text-ink transition-colors focus:border-gold focus:outline-none"
                      inputMode="numeric"
                      name="budget"
                      onChange={handleInputChange}
                      placeholder="6000000"
                      value={formState.budget}
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      Guest count
                    </span>
                    <input
                      className="rounded-2xl border border-[rgba(201,168,76,0.18)] bg-[#fbf7ed] px-4 py-3 text-[14px] text-ink transition-colors focus:border-gold focus:outline-none"
                      inputMode="numeric"
                      name="guest_count"
                      onChange={handleInputChange}
                      placeholder="250"
                      value={formState.guest_count}
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      Wedding type
                    </span>
                    <input
                      className="rounded-2xl border border-[rgba(201,168,76,0.18)] bg-[#fbf7ed] px-4 py-3 text-[14px] text-ink transition-colors focus:border-gold focus:outline-none"
                      name="wedding_type"
                      onChange={handleInputChange}
                      value={formState.wedding_type}
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                      Role
                      <Lock className="size-3" strokeWidth={1.7} />
                    </span>
                    <input
                      className="rounded-2xl border border-[rgba(201,168,76,0.14)] bg-[#f4efe3] px-4 py-3 text-[14px] text-[#7A7568]"
                      disabled
                      value={getRoleLabel(weddingProfile?.role)}
                    />
                  </label>
                </div>

                {saveError ? (
                  <p className="mt-4 text-[12px] text-[#C0392B]">{saveError}</p>
                ) : null}

                {saveSuccess ? (
                  <p className="mt-4 text-[12px] text-[#2E7D52]">{saveSuccess}</p>
                ) : null}

                <div className="mt-5 flex items-center justify-end gap-3">
                  <button
                    className="rounded-full px-4 py-2 text-[13px] text-[#7A7568] transition-colors hover:bg-gold-pale hover:text-ink"
                    onClick={handleCancelEdit}
                    type="button"
                  >
                    Cancel
                  </button>

                  <button
                    className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-cream transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                    disabled={isSaving}
                    type="submit"
                  >
                    {isSaving ? (
                      <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
                    ) : null}
                    {isSaving ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </form>
            )}

            <div className="mt-6 rounded-2xl border border-[rgba(201,168,76,0.14)] bg-[#fbf7ed] px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#B8A96A]">
                Session
              </p>
              <p className="mt-2 text-[14px] text-ink">
                {user?.email || "You are signed in to Wedly"}
              </p>
              <p className="mt-2 text-[12px] leading-5 text-[#8A847A]">
                Logging out takes you back to the sign in screen. Your wedding
                details stay safely saved in Wedly.
              </p>

              {logoutError ? (
                <p className="mt-3 text-[12px] text-[#C0392B]">{logoutError}</p>
              ) : null}

              <button
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-[rgba(28,26,23,0.12)] bg-white px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-[#D7C9A2] hover:bg-[#fffaf1] disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isLoggingOut}
                onClick={() => void handleLogout()}
                type="button"
              >
                {isLoggingOut ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
                ) : (
                  <LogOut className="size-4" strokeWidth={1.8} />
                )}
                {isLoggingOut ? "Logging out..." : "Log out"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
