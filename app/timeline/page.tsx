"use client";

import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import { createClient } from "@/lib/supabase/client";
import { getWeddingProfileForUser } from "@/lib/supabase/wedding-profile";
import type { Database } from "@/lib/supabase/types";
import { useWeddingStore } from "@/store/weddingStore";

type PhaseId =
  | "foundation"
  | "vendor-locking"
  | "communication"
  | "detailing"
  | "final-sprint";

type ViewMode = "phase" | "month";

type Suggestion = {
  phase_id: PhaseId;
  priority: "high" | "medium" | "low";
  reason: string;
  title: string;
};

type StoredSuggestions = {
  savedAt: number;
  suggestions: Suggestion[];
};

type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];

type MonthGroup = {
  isCurrentMonth: boolean;
  isOverdue: boolean;
  key: string;
  label: string;
  tasks: TaskRow[];
};

type AddTarget = {
  dueDate: string | null;
  key: string;
  phaseId: PhaseId;
};

const PHASES: Array<{
  endMonthsBefore: number;
  id: PhaseId;
  name: string;
  startMonthsBefore: number;
}> = [
  { id: "foundation", name: "Foundation", startMonthsBefore: 14, endMonthsBefore: 12 },
  { id: "vendor-locking", name: "Vendor Locking", startMonthsBefore: 12, endMonthsBefore: 9 },
  { id: "communication", name: "Communication", startMonthsBefore: 9, endMonthsBefore: 6 },
  { id: "detailing", name: "Detailing", startMonthsBefore: 6, endMonthsBefore: 3 },
  { id: "final-sprint", name: "Final Sprint", startMonthsBefore: 3, endMonthsBefore: 1 },
];

const phaseNameById = PHASES.reduce<Record<PhaseId, string>>((accumulator, phase) => {
  accumulator[phase.id] = phase.name;
  return accumulator;
}, {} as Record<PhaseId, string>);

const phaseOrder = new Map(PHASES.map((phase, index) => [phase.id, index]));

const monthTitleFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

const monthRangeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
});

const suggestionsTtlMs = 24 * 60 * 60 * 1000;

function getSuggestionsStorageKey(userId: string) {
  return `wedly_timeline_suggestions_${userId}`;
}

function readStoredSuggestions(userId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(getSuggestionsStorageKey(userId));

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as StoredSuggestions;

    if (
      !parsed ||
      !Array.isArray(parsed.suggestions) ||
      typeof parsed.savedAt !== "number"
    ) {
      window.localStorage.removeItem(getSuggestionsStorageKey(userId));
      return null;
    }

    if (Date.now() - parsed.savedAt > suggestionsTtlMs) {
      window.localStorage.removeItem(getSuggestionsStorageKey(userId));
      return null;
    }

    return parsed.suggestions;
  } catch {
    window.localStorage.removeItem(getSuggestionsStorageKey(userId));
    return null;
  }
}

function writeStoredSuggestions(userId: string, suggestions: Suggestion[]) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: StoredSuggestions = {
    savedAt: Date.now(),
    suggestions,
  };

  window.localStorage.setItem(
    getSuggestionsStorageKey(userId),
    JSON.stringify(payload),
  );
}

function clearStoredSuggestions(userId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getSuggestionsStorageKey(userId));
}

function parseLocalDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function endOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(23, 59, 59, 999);
  return nextDate;
}

function subtractMonths(date: Date, months: number) {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() - months);
  return nextDate;
}

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getLastDayOfMonthFromKey(monthKey: string) {
  const [yearValue, monthValue] = monthKey.split("-").map(Number);

  if (!yearValue || !monthValue) {
    return null;
  }

  const date = new Date(yearValue, monthValue, 0);
  return Number.isNaN(date.getTime())
    ? null
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate(),
      ).padStart(2, "0")}`;
}

function formatMonthRange(date: Date) {
  return monthRangeFormatter.format(date);
}

function formatMonthTitle(date: Date) {
  return monthTitleFormatter.format(date);
}

function getPhaseDateRange(phaseId: PhaseId, weddingDate: string | null) {
  const wedding = parseLocalDate(weddingDate);
  const phase = PHASES.find((item) => item.id === phaseId);

  if (!wedding || !phase) {
    return null;
  }

  const start = startOfDay(subtractMonths(wedding, phase.startMonthsBefore));
  const end = endOfDay(subtractMonths(wedding, phase.endMonthsBefore));

  return { end, start };
}

function getPhaseTimeframeLabel(phaseId: PhaseId, weddingDate: string | null) {
  const range = getPhaseDateRange(phaseId, weddingDate);

  if (!range) {
    return "Wedding date needed";
  }

  return `${formatMonthRange(range.start)} – ${formatMonthRange(range.end)}`;
}

function getPlanStartDate(userCreatedAt: string | undefined) {
  if (!userCreatedAt) {
    return startOfDay(new Date());
  }

  const date = new Date(userCreatedAt);
  return Number.isNaN(date.getTime()) ? startOfDay(new Date()) : startOfDay(date);
}

function getTaskBasedPhaseTimeframeLabel(
  phaseId: PhaseId,
  phaseTasks: TaskRow[],
  weddingDate: string | null,
  planStartDate: Date,
) {
  const taskDates = phaseTasks
    .map((task) => parseLocalDate(task.due_date))
    .filter((date): date is Date => Boolean(date))
    .sort((first, second) => first.getTime() - second.getTime());

  if (!taskDates.length) {
    return getPhaseTimeframeLabel(phaseId, weddingDate);
  }

  const rangeStart =
    taskDates[0].getTime() < planStartDate.getTime() ? planStartDate : taskDates[0];
  const rangeEnd = taskDates[taskDates.length - 1];

  return `${formatMonthRange(rangeStart)} – ${formatMonthRange(rangeEnd)}`;
}

function isDateInRange(date: Date, start: Date, end: Date) {
  const value = startOfDay(date).getTime();
  return value >= start.getTime() && value <= end.getTime();
}

function getActivePhaseId(weddingDate: string | null): PhaseId {
  const today = startOfDay(new Date());
  const wedding = parseLocalDate(weddingDate);

  if (!wedding) {
    return "foundation";
  }

  for (const phase of PHASES) {
    const range = getPhaseDateRange(phase.id, weddingDate);

    if (range && isDateInRange(today, range.start, range.end)) {
      return phase.id;
    }
  }

  return today < subtractMonths(wedding, 14) ? "foundation" : "final-sprint";
}

function isPhaseActiveNow(phaseId: PhaseId, weddingDate: string | null) {
  const range = getPhaseDateRange(phaseId, weddingDate);

  if (!range) {
    return false;
  }

  return isDateInRange(new Date(), range.start, range.end);
}

function getMonthsUntilWedding(dueDate: Date, weddingDate: Date) {
  return (
    (weddingDate.getFullYear() - dueDate.getFullYear()) * 12 +
    (weddingDate.getMonth() - dueDate.getMonth())
  );
}

function getPhaseIdForDueDate(dueDate: string | null, weddingDate: string | null): PhaseId {
  const parsedDueDate = parseLocalDate(dueDate);
  const parsedWeddingDate = parseLocalDate(weddingDate);

  if (!parsedDueDate || !parsedWeddingDate) {
    return "foundation";
  }

  const monthsUntilWedding = getMonthsUntilWedding(parsedDueDate, parsedWeddingDate);

  if (monthsUntilWedding >= 12) {
    return "foundation";
  }

  if (monthsUntilWedding >= 9) {
    return "vendor-locking";
  }

  if (monthsUntilWedding >= 6) {
    return "communication";
  }

  if (monthsUntilWedding >= 3) {
    return "detailing";
  }

  return "final-sprint";
}

function sortTasks(tasks: TaskRow[]) {
  return [...tasks].sort((first, second) => {
    const firstPhaseRank = phaseOrder.get(first.phase_id as PhaseId) ?? 0;
    const secondPhaseRank = phaseOrder.get(second.phase_id as PhaseId) ?? 0;

    if (firstPhaseRank !== secondPhaseRank) {
      return firstPhaseRank - secondPhaseRank;
    }

    if (!first.due_date && !second.due_date) {
      return first.title.localeCompare(second.title);
    }

    if (!first.due_date) {
      return 1;
    }

    if (!second.due_date) {
      return -1;
    }

    const dueDateCompare = first.due_date.localeCompare(second.due_date);
    return dueDateCompare !== 0 ? dueDateCompare : first.title.localeCompare(second.title);
  });
}

function formatDueDate(value: string | null) {
  if (!value) {
    return "Set due date";
  }

  const date = parseLocalDate(value);

  if (!date) {
    return value;
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getDueDateTone(value: string | null) {
  if (!value) {
    return "#8F877B";
  }

  const dueDate = parseLocalDate(value);

  if (!dueDate) {
    return "#8F877B";
  }

  const today = startOfDay(new Date());

  if (dueDate < today) {
    return "#D16454";
  }

  const differenceInDays = Math.ceil(
    (startOfDay(dueDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (differenceInDays <= 7) {
    return "#B7791F";
  }

  return "#8F877B";
}

function getPriorityColor(priority: string) {
  if (priority === "high") {
    return "#C86A5A";
  }

  if (priority === "low") {
    return "#4D9A8F";
  }

  return "#C9A84C";
}

function LoadingState() {
  return (
    <section className="flex min-h-full flex-col items-center justify-center bg-[#FAF7F2] px-6 text-center">
      <p className="font-display text-[54px] leading-none text-ink">
        Wed<span className="text-gold">ly</span>
      </p>
      <p className="mt-8 font-display text-[24px] leading-none text-ink">
        ✦ Building your personalised wedding plan...
      </p>
      <p className="mt-3 text-[14px] text-ink-muted">This takes just a moment</p>
      <div className="mt-6 flex items-center gap-3">
        {[0, 1, 2].map((index) => (
          <span
            className="onboarding-dot h-3 w-3 rounded-full bg-gold"
            key={index}
            style={{ animationDelay: `${index * 0.18}s` }}
          />
        ))}
      </div>
    </section>
  );
}

type TaskItemProps = {
  confirmDeleteTaskId: string | null;
  dateInputRef: RefObject<HTMLInputElement | null>;
  editingDueDateTaskId: string | null;
  editingDueDateValue: string;
  editInputRef: RefObject<HTMLInputElement | null>;
  editingTaskId: string | null;
  editingTaskTitle: string;
  onCancelDueDateEditing: () => void;
  onCancelDelete: () => void;
  onChangeEditingDueDateValue: (value: string) => void;
  onChangeEditingTaskTitle: (value: string) => void;
  onConfirmDelete: (taskId: string) => void;
  onDeleteTask: (task: TaskRow) => Promise<void>;
  onSaveDueDate: (task: TaskRow, nextDueDate: string | null) => Promise<void>;
  onSaveEdit: (task: TaskRow) => Promise<void>;
  onStartEditingDueDate: (task: TaskRow) => void;
  onStartEditing: (task: TaskRow) => void;
  onToggleTaskStatus: (task: TaskRow) => Promise<void>;
  removingTaskIds: string[];
  setEditingTaskId: (value: string | null) => void;
  task: TaskRow;
};

function TaskItem({
  confirmDeleteTaskId,
  dateInputRef,
  editingDueDateTaskId,
  editingDueDateValue,
  editInputRef,
  editingTaskId,
  editingTaskTitle,
  onCancelDueDateEditing,
  onCancelDelete,
  onChangeEditingDueDateValue,
  onChangeEditingTaskTitle,
  onConfirmDelete,
  onDeleteTask,
  onSaveDueDate,
  onSaveEdit,
  onStartEditingDueDate,
  onStartEditing,
  onToggleTaskStatus,
  removingTaskIds,
  setEditingTaskId,
  task,
}: TaskItemProps) {
  const isCompleted = task.status === "completed";
  const isDeleting = confirmDeleteTaskId === task.id;
  const isEditingDueDate = editingDueDateTaskId === task.id;
  const isEditing = editingTaskId === task.id;
  const isRemoving = removingTaskIds.includes(task.id);

  return (
    <div
      className="group rounded-[10px] px-2 py-2 transition-all duration-200"
      key={task.id}
      style={{
        background: isDeleting ? "#FFF1EF" : "transparent",
        opacity: isRemoving ? 0 : 1,
        transform: isRemoving ? "translateY(-6px)" : "translateY(0)",
      }}
    >
      {isDeleting ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-danger">Delete?</p>
          <div className="flex items-center gap-2">
            <button
              className="text-[12px] font-medium text-danger"
              onClick={() => onDeleteTask(task)}
              type="button"
            >
              Yes
            </button>
            <button className="text-[12px] text-ink-muted" onClick={onCancelDelete} type="button">
              No
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <button
            aria-label={isCompleted ? "Mark task as pending" : "Mark task as complete"}
            className="mt-0.5 shrink-0 text-gold"
            onClick={() => onToggleTaskStatus(task)}
            type="button"
          >
            {isCompleted ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold text-white">
                <Check className="h-3 w-3" strokeWidth={2.4} />
              </span>
            ) : (
              <Circle className="h-5 w-5" strokeWidth={1.9} />
            )}
          </button>

          <div className="min-w-0 flex-1">
            {isEditing ? (
              <input
                className="w-full border-0 border-b border-gold bg-transparent px-0 py-1 text-[13px] text-ink outline-none"
                onChange={(event) => onChangeEditingTaskTitle(event.target.value)}
                onKeyDown={async (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    await onSaveEdit(task);
                  }

                  if (event.key === "Escape") {
                    setEditingTaskId(null);
                    onChangeEditingTaskTitle("");
                  }
                }}
                ref={editInputRef}
                value={editingTaskTitle}
              />
            ) : (
              <p
                className={`text-[15px] leading-6 ${
                  isCompleted ? "text-[#B8B2A7] line-through" : "text-ink"
                }`}
              >
                {task.title}
              </p>
            )}

            {isEditingDueDate ? (
              <input
                className="mt-1 border-0 border-b bg-transparent px-0 py-0 text-[13px] text-ink outline-none"
                onBlur={async () => {
                  await onSaveDueDate(task, editingDueDateValue || null);
                }}
                onChange={async (event) => {
                  const nextValue = event.target.value;
                  onChangeEditingDueDateValue(nextValue);
                  await onSaveDueDate(task, nextValue || null);
                }}
                onKeyDown={async (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    await onSaveDueDate(task, editingDueDateValue || null);
                  }

                  if (event.key === "Escape") {
                    onCancelDueDateEditing();
                  }
                }}
                ref={dateInputRef}
                style={{
                  borderBottom: "1px solid #C9A84C",
                  borderRadius: 0,
                  fontFamily: "DM Sans, sans-serif",
                }}
                type="date"
                value={editingDueDateValue}
              />
            ) : (
              <button
                className="mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-left text-[11px] font-medium outline-none transition-colors duration-150 hover:bg-[#FBF7ED]"
                onClick={() => onStartEditingDueDate(task)}
                style={{
                  borderColor: "#E8E2D9",
                  color: getDueDateTone(task.due_date),
                  fontFamily: "DM Sans, sans-serif",
                }}
                type="button"
              >
                <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.9} />
                <span>Due {formatDueDate(task.due_date)}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: getPriorityColor(task.priority) }}
            />
            <div className="flex items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <button
                aria-label="Edit task"
                className="text-[#B8B2A7] hover:text-ink"
                onClick={() => onStartEditing(task)}
                type="button"
              >
                <Pencil className="h-4 w-4" strokeWidth={1.8} />
              </button>
              <button
                aria-label="Delete task"
                className="text-[#B8B2A7] hover:text-danger"
                onClick={() => onConfirmDelete(task.id)}
                type="button"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TimelinePage() {
  const [supabase] = useState(() => createClient());
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [monthSuggestions, setMonthSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [monthSuggestionsError, setMonthSuggestionsError] = useState<string | null>(null);
  const [isMonthSuggestionsLoading, setIsMonthSuggestionsLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("phase");
  const [displayedViewMode, setDisplayedViewMode] = useState<ViewMode>("phase");
  const [isViewVisible, setIsViewVisible] = useState(true);
  const [expandedPhases, setExpandedPhases] = useState<Record<PhaseId, boolean>>({
    foundation: false,
    "vendor-locking": false,
    communication: false,
    detailing: false,
    "final-sprint": false,
  });
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const [activeAddTarget, setActiveAddTarget] = useState<AddTarget | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [editingDueDateTaskId, setEditingDueDateTaskId] = useState<string | null>(null);
  const [editingDueDateValue, setEditingDueDateValue] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState<string | null>(null);
  const [removingTaskIds, setRemovingTaskIds] = useState<string[]>([]);

  const addInputRef = useRef<HTMLInputElement | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const hasSeededPhasesRef = useRef(false);
  const monthSuggestionsRequestKeyRef = useRef<string | null>(null);
  const currentMonthGroupRef = useRef<HTMLElement | null>(null);

  const user = useWeddingStore((state) => state.user);
  const weddingProfile = useWeddingStore((state) => state.weddingProfile);
  const setIsOnboarded = useWeddingStore((state) => state.setIsOnboarded);
  const setUser = useWeddingStore((state) => state.setUser);
  const setWeddingProfile = useWeddingStore((state) => state.setWeddingProfile);

  const currentMonthDate = useMemo(() => startOfDay(new Date()), []);
  const currentMonthKey = useMemo(() => getMonthKey(currentMonthDate), [currentMonthDate]);
  const currentMonthLabel = useMemo(() => formatMonthTitle(currentMonthDate), [currentMonthDate]);
  const currentMonthDueDate = useMemo(
    () => getLastDayOfMonthFromKey(currentMonthKey),
    [currentMonthKey],
  );
  const planStartDate = useMemo(() => getPlanStartDate(user?.created_at), [user?.created_at]);

  useEffect(() => {
    if (activeAddTarget && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [activeAddTarget]);

  useEffect(() => {
    if (editingTaskId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTaskId]);

  useEffect(() => {
    if (editingDueDateTaskId && dateInputRef.current) {
      dateInputRef.current.focus();
      dateInputRef.current.showPicker?.();
    }
  }, [editingDueDateTaskId]);

  useEffect(() => {
    if (viewMode === displayedViewMode) {
      setIsViewVisible(true);
      return;
    }

    setIsViewVisible(false);

    const timeoutId = window.setTimeout(() => {
      setDisplayedViewMode(viewMode);
      setIsViewVisible(true);
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [displayedViewMode, viewMode]);

  useEffect(() => {
    const handleDataUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string }>).detail;

      if (detail?.type === "task") {
        if (user?.id) {
          clearStoredSuggestions(user.id);
        }

        setSuggestions([]);
        setMonthSuggestions([]);
        monthSuggestionsRequestKeyRef.current = null;
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
  }, [user?.id]);

  useEffect(() => {
    let isMounted = true;

    async function loadTimeline() {
      setIsLoading(true);
      setPageError(null);

      let nextUser = user;
      let nextWeddingProfile = weddingProfile;

      try {
        if (!nextUser) {
          const {
            data: { user: fetchedUser },
            error: userError,
          } = await supabase.auth.getUser();

          if (userError) {
            throw userError;
          }

          nextUser = fetchedUser ?? null;

          if (!isMounted) {
            return;
          }

          setUser(nextUser);
        }

        if (!nextUser) {
          throw new Error("No signed-in user found.");
        }

        if (!nextWeddingProfile) {
          nextWeddingProfile = await getWeddingProfileForUser(supabase, nextUser.id);

          if (!isMounted) {
            return;
          }

          setWeddingProfile(nextWeddingProfile);
          setIsOnboarded(Boolean(nextWeddingProfile));
        }

        if (!nextWeddingProfile) {
          throw new Error("Wedding profile not found.");
        }

        const { data: existingTasks, error: tasksError } = await supabase
          .from("tasks")
          .select("*")
          .eq("user_id", nextUser.id)
          .overrideTypes<TaskRow[], { merge: false }>();

        if (tasksError) {
          throw tasksError;
        }

        let nextTasks = existingTasks ?? [];
        const hasCompletedTasks = nextTasks.some((task) => task.status === "completed");
        const hasTasksBeforePlanStart = nextTasks.some((task) => {
          const dueDate = parseLocalDate(task.due_date);
          return Boolean(dueDate && dueDate.getTime() < planStartDate.getTime());
        });

        if (nextTasks.length > 0 && !hasCompletedTasks && hasTasksBeforePlanStart) {
          const { error: deleteError } = await supabase
            .from("tasks")
            .delete()
            .eq("user_id", nextUser.id);

          if (deleteError) {
            throw deleteError;
          }

          nextTasks = [];
        }

        if (nextTasks.length === 0) {
          const response = await fetch("/api/timeline-generate", {
            body: JSON.stringify({
              budget: nextWeddingProfile.budget,
              city: nextWeddingProfile.city,
              guest_count: nextWeddingProfile.guest_count,
              partner1_name: nextWeddingProfile.partner1_name,
              plan_start_date: planStartDate.toISOString().slice(0, 10),
              wedding_date: nextWeddingProfile.wedding_date,
              wedding_type: nextWeddingProfile.wedding_type,
            }),
            headers: {
              "Content-Type": "application/json",
            },
            method: "POST",
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || "We couldn't generate your planning timeline.");
          }

          nextTasks = (await response.json()) as TaskRow[];
        }

        if (!isMounted) {
          return;
        }

        setTasks(sortTasks(nextTasks));

        if (!hasSeededPhasesRef.current) {
          const activePhase = getActivePhaseId(nextWeddingProfile.wedding_date);
          setExpandedPhases({
            foundation: activePhase === "foundation",
            "vendor-locking": activePhase === "vendor-locking",
            communication: activePhase === "communication",
            detailing: activePhase === "detailing",
            "final-sprint": activePhase === "final-sprint",
          });
          hasSeededPhasesRef.current = true;
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setPageError(
          error instanceof Error ? error.message : "We couldn't load your planning timeline.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadTimeline();

    return () => {
      isMounted = false;
    };
  }, [
    refreshTick,
    setIsOnboarded,
    setUser,
    setWeddingProfile,
    supabase,
    user,
    weddingProfile,
    planStartDate,
  ]);

  const fetchSuggestions = useCallback(
    async (forceRefresh: boolean) => {
      if (isLoading || !user || !weddingProfile || !tasks.length) {
        return;
      }

      setSuggestionsError(null);

      if (!forceRefresh) {
        const storedSuggestions = readStoredSuggestions(user.id);

        if (storedSuggestions) {
          setSuggestions(storedSuggestions);
          return;
        }
      } else {
        clearStoredSuggestions(user.id);
        setSuggestions([]);
      }

      setIsSuggestionsLoading(true);

      try {
        const response = await fetch("/api/timeline-suggestions", {
          body: JSON.stringify({
            existingTaskTitles: tasks.map((task) => task.title),
            profile: {
              budget: weddingProfile.budget,
              city: weddingProfile.city,
              guest_count: weddingProfile.guest_count,
              partner1_name: weddingProfile.partner1_name,
              wedding_date: weddingProfile.wedding_date,
              wedding_type: weddingProfile.wedding_type,
            },
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || "We couldn't generate suggestions.");
        }

        const nextSuggestions = (await response.json()) as Suggestion[];
        setSuggestions(nextSuggestions);
        writeStoredSuggestions(user.id, nextSuggestions);
      } catch (error) {
        setSuggestionsError(
          error instanceof Error ? error.message : "We couldn't load suggestions.",
        );
      } finally {
        setIsSuggestionsLoading(false);
      }
    },
    [isLoading, tasks, user, weddingProfile],
  );

  useEffect(() => {
    void fetchSuggestions(false);
  }, [fetchSuggestions]);

  useEffect(() => {
    if (viewMode !== "month" || isLoading || !weddingProfile) {
      return;
    }

    const requestKey = `${currentMonthKey}:${weddingProfile.wedding_date ?? ""}`;

    if (monthSuggestionsRequestKeyRef.current === requestKey) {
      return;
    }

    monthSuggestionsRequestKeyRef.current = requestKey;
    setIsMonthSuggestionsLoading(true);
    setMonthSuggestionsError(null);

    const loadMonthSuggestions = async () => {
      try {
        const response = await fetch("/api/timeline-suggestions", {
          body: JSON.stringify({
            currentMonth: {
              label: currentMonthLabel,
              monthKey: currentMonthKey,
            },
            existingTaskTitles: tasks.map((task) => task.title),
            profile: {
              budget: weddingProfile.budget,
              city: weddingProfile.city,
              guest_count: weddingProfile.guest_count,
              partner1_name: weddingProfile.partner1_name,
              wedding_date: weddingProfile.wedding_date,
              wedding_type: weddingProfile.wedding_type,
            },
            suggestionMode: "month",
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || "We couldn't load this month's suggestions.");
        }

        const nextSuggestions = (await response.json()) as Suggestion[];
        setMonthSuggestions(nextSuggestions);
      } catch (error) {
        setMonthSuggestionsError(
          error instanceof Error ? error.message : "We couldn't load this month's suggestions.",
        );
      } finally {
        setIsMonthSuggestionsLoading(false);
      }
    };

    void loadMonthSuggestions();
  }, [currentMonthKey, currentMonthLabel, isLoading, tasks, viewMode, weddingProfile]);

  const groupedTasks = useMemo(() => {
    const groups = PHASES.reduce<Record<PhaseId, TaskRow[]>>((accumulator, phase) => {
      accumulator[phase.id] = [];
      return accumulator;
    }, {} as Record<PhaseId, TaskRow[]>);

    tasks.forEach((task) => {
      const phaseId = task.phase_id as PhaseId;

      if (phaseId in groups) {
        groups[phaseId].push(task);
      }
    });

    return groups;
  }, [tasks]);

  const monthGroups = useMemo<MonthGroup[]>(() => {
    const groups = new Map<string, TaskRow[]>();

    tasks.forEach((task) => {
      const parsedDueDate = parseLocalDate(task.due_date);

      if (!parsedDueDate) {
        return;
      }

      const key = getMonthKey(parsedDueDate);
      const currentTasks = groups.get(key) ?? [];
      currentTasks.push(task);
      groups.set(key, currentTasks);
    });

    const currentMonthStart = new Date(
      currentMonthDate.getFullYear(),
      currentMonthDate.getMonth(),
      1,
    );

    return [...groups.entries()]
      .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
      .map(([key, monthTasks]) => {
        const monthDate = parseLocalDate(`${key}-01`);
        const isCurrentMonth = key === currentMonthKey;
        const isPastMonth = monthDate
          ? monthDate.getTime() < currentMonthStart.getTime()
          : false;
        const hasIncompleteTasks = monthTasks.some((task) => task.status !== "completed");

        return {
          isCurrentMonth,
          isOverdue: Boolean(isPastMonth && hasIncompleteTasks),
          key,
          label: monthDate ? formatMonthTitle(monthDate) : key,
          tasks: sortTasks(monthTasks),
        };
      });
  }, [currentMonthDate, currentMonthKey, tasks]);

  useEffect(() => {
    setExpandedMonths((current) => {
      const next = { ...current };
      let hasChanges = false;

      monthGroups.forEach((group) => {
        if (!(group.key in next)) {
          next[group.key] = group.isCurrentMonth;
          hasChanges = true;
        }
      });

      Object.keys(next).forEach((key) => {
        if (!monthGroups.some((group) => group.key === key)) {
          delete next[key];
          hasChanges = true;
        }
      });

      return hasChanges ? next : current;
    });
  }, [monthGroups]);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const overallProgress = totalTasks ? (completedTasks / totalTasks) * 100 : 0;
  const activePhaseId = getActivePhaseId(weddingProfile?.wedding_date ?? null);
  const currentMonthTaskCount =
    monthGroups.find((group) => group.key === currentMonthKey)?.tasks.length ?? 0;

  const togglePhase = (phaseId: PhaseId) => {
    setExpandedPhases((current) => ({
      ...current,
      [phaseId]: !current[phaseId],
    }));
  };

  const toggleMonthGroup = (monthKey: string) => {
    setExpandedMonths((current) => ({
      ...current,
      [monthKey]: !current[monthKey],
    }));
  };

  const updateTaskLocally = (taskId: string, updater: (task: TaskRow) => TaskRow) => {
    setTasks((currentTasks) =>
      sortTasks(currentTasks.map((task) => (task.id === taskId ? updater(task) : task))),
    );
  };

  const handleToggleTaskStatus = async (task: TaskRow) => {
    const previousStatus = task.status;
    const nextStatus = previousStatus === "completed" ? "pending" : "completed";

    updateTaskLocally(task.id, (currentTask) => ({
      ...currentTask,
      status: nextStatus,
    }));

    const { error } = await supabase
      .from("tasks")
      .update({ status: nextStatus } as never)
      .eq("id", task.id);

    if (error) {
      updateTaskLocally(task.id, (currentTask) => ({
        ...currentTask,
        status: previousStatus,
      }));
      setPageError(error.message);
    }
  };

  const handleAddTask = async (target: AddTarget) => {
    const trimmedTitle = newTaskTitle.trim();

    if (!trimmedTitle || !user) {
      return;
    }

    const tempId = `temp-${crypto.randomUUID()}`;
    const optimisticTask: TaskRow = {
      description: "User added task.",
      due_date: target.dueDate,
      id: tempId,
      is_user_added: true,
      phase_id: target.phaseId,
      phase_name: phaseNameById[target.phaseId],
      priority: "medium",
      status: "pending",
      title: trimmedTitle,
      user_id: user.id,
    };

    setTasks((currentTasks) => sortTasks([...currentTasks, optimisticTask]));
    setActiveAddTarget(null);
    setNewTaskTitle("");

    const insertPayload: Database["public"]["Tables"]["tasks"]["Insert"] = {
      ...optimisticTask,
      id: undefined,
    };

    const { data, error } = await supabase
      .from("tasks")
      .insert(insertPayload as never)
      .select("*")
      .single()
      .overrideTypes<TaskRow, { merge: false }>();

    if (error) {
      setTasks((currentTasks) => currentTasks.filter((task) => task.id !== tempId));
      setPageError(error.message);
      return;
    }

    setTasks((currentTasks) =>
      sortTasks(currentTasks.map((task) => (task.id === tempId ? data : task))),
    );
  };

  const handleStartEditing = (task: TaskRow) => {
    setEditingTaskId(task.id);
    setEditingTaskTitle(task.title);
  };

  const handleStartEditingDueDate = (task: TaskRow) => {
    setEditingDueDateTaskId(task.id);
    setEditingDueDateValue(task.due_date ?? "");
  };

  const handleSaveDueDate = async (task: TaskRow, nextDueDate: string | null) => {
    const normalizedDueDate = nextDueDate?.trim() || null;
    const previousDueDate = task.due_date;

    setEditingDueDateTaskId(null);
    setEditingDueDateValue("");

    if (normalizedDueDate === previousDueDate) {
      return;
    }

    updateTaskLocally(task.id, (currentTask) => ({
      ...currentTask,
      due_date: normalizedDueDate,
    }));

    const { error } = await supabase
      .from("tasks")
      .update({ due_date: normalizedDueDate } as never)
      .eq("id", task.id);

    if (error) {
      updateTaskLocally(task.id, (currentTask) => ({
        ...currentTask,
        due_date: previousDueDate,
      }));
      setPageError(error.message);
    }
  };

  const handleSaveEdit = async (task: TaskRow) => {
    const trimmedTitle = editingTaskTitle.trim();

    if (!trimmedTitle) {
      setEditingTaskId(null);
      setEditingTaskTitle("");
      return;
    }

    const previousTitle = task.title;
    setEditingTaskId(null);
    setEditingTaskTitle("");

    updateTaskLocally(task.id, (currentTask) => ({
      ...currentTask,
      title: trimmedTitle,
    }));

    const { error } = await supabase
      .from("tasks")
      .update({ title: trimmedTitle } as never)
      .eq("id", task.id);

    if (error) {
      updateTaskLocally(task.id, (currentTask) => ({
        ...currentTask,
        title: previousTitle,
      }));
      setPageError(error.message);
    }
  };

  const handleDeleteTask = async (task: TaskRow) => {
    setConfirmDeleteTaskId(null);
    setRemovingTaskIds((current) => [...current, task.id]);

    window.setTimeout(() => {
      setTasks((currentTasks) => currentTasks.filter((currentTask) => currentTask.id !== task.id));
      setRemovingTaskIds((current) => current.filter((id) => id !== task.id));
    }, 180);

    const { error } = await supabase.from("tasks").delete().eq("id", task.id);

    if (error) {
      setTasks((currentTasks) => sortTasks([...currentTasks, task]));
      setRemovingTaskIds((current) => current.filter((id) => id !== task.id));
      setPageError(error.message);
    }
  };

  const handleAddSuggestion = async (suggestion: Suggestion) => {
    if (!user) {
      return;
    }

    const nextSuggestions = suggestions.filter((item) => item.title !== suggestion.title);

    const tempId = `suggestion-${crypto.randomUUID()}`;
    const optimisticTask: TaskRow = {
      description: suggestion.reason,
      due_date: null,
      id: tempId,
      is_user_added: true,
      phase_id: suggestion.phase_id,
      phase_name: phaseNameById[suggestion.phase_id],
      priority: suggestion.priority,
      status: "pending",
      title: suggestion.title,
      user_id: user.id,
    };

    setSuggestions(nextSuggestions);
    writeStoredSuggestions(user.id, nextSuggestions);
    setTasks((currentTasks) => sortTasks([...currentTasks, optimisticTask]));

    const insertPayload: Database["public"]["Tables"]["tasks"]["Insert"] = {
      ...optimisticTask,
      id: undefined,
    };

    const { data, error } = await supabase
      .from("tasks")
      .insert(insertPayload as never)
      .select("*")
      .single()
      .overrideTypes<TaskRow, { merge: false }>();

    if (error) {
      setTasks((currentTasks) => currentTasks.filter((task) => task.id !== tempId));
      setSuggestions((currentSuggestions) => [...currentSuggestions, suggestion]);
      writeStoredSuggestions(user.id, [...nextSuggestions, suggestion]);
      setPageError(error.message);
      return;
    }

    setTasks((currentTasks) =>
      sortTasks(currentTasks.map((task) => (task.id === tempId ? data : task))),
    );
  };

  const handleAddMonthSuggestion = async (suggestion: Suggestion) => {
    if (!user || !currentMonthDueDate) {
      return;
    }

    const inferredPhaseId = getPhaseIdForDueDate(
      currentMonthDueDate,
      weddingProfile?.wedding_date ?? null,
    );
    const tempId = `month-suggestion-${crypto.randomUUID()}`;
    const optimisticTask: TaskRow = {
      description: suggestion.reason,
      due_date: currentMonthDueDate,
      id: tempId,
      is_user_added: true,
      phase_id: inferredPhaseId,
      phase_name: phaseNameById[inferredPhaseId],
      priority: suggestion.priority,
      status: "pending",
      title: suggestion.title,
      user_id: user.id,
    };

    setMonthSuggestions((currentSuggestions) =>
      currentSuggestions.filter((item) => item.title !== suggestion.title),
    );
    setTasks((currentTasks) => sortTasks([...currentTasks, optimisticTask]));

    const insertPayload: Database["public"]["Tables"]["tasks"]["Insert"] = {
      ...optimisticTask,
      id: undefined,
    };

    const { data, error } = await supabase
      .from("tasks")
      .insert(insertPayload as never)
      .select("*")
      .single()
      .overrideTypes<TaskRow, { merge: false }>();

    if (error) {
      setTasks((currentTasks) => currentTasks.filter((task) => task.id !== tempId));
      setMonthSuggestions((currentSuggestions) => [...currentSuggestions, suggestion]);
      setPageError(error.message);
      return;
    }

    setTasks((currentTasks) =>
      sortTasks(currentTasks.map((task) => (task.id === tempId ? data : task))),
    );
  };

  const renderTaskSection = ({
    addTarget,
    countLabel,
    isExpanded,
    isHighlighted,
    isOverdue,
    sectionKey,
    subtitle,
    tasks: sectionTasks,
    title,
    titleClassName,
    onToggle,
    showActiveNow,
  }: {
    addTarget: AddTarget;
    countLabel: string;
    isExpanded: boolean;
    isHighlighted?: boolean;
    isOverdue?: boolean;
    sectionKey: string;
    subtitle?: string;
    tasks: TaskRow[];
    title: string;
    titleClassName: string;
    onToggle: () => void;
    showActiveNow?: boolean;
  }) => {
    const estimatedContentHeight =
      sectionTasks.length * 86 + (activeAddTarget?.key === sectionKey ? 92 : 54) + 22;

    return (
      <section
        className="overflow-hidden rounded-[12px] border border-[#E8E2D9] bg-white transition-shadow duration-200 hover:shadow-[0_2px_8px_rgba(28,26,23,0.08)]"
        key={sectionKey}
        ref={sectionKey.startsWith("month-") && isHighlighted ? currentMonthGroupRef : undefined}
        style={{
          borderLeft: isHighlighted ? "3px solid #C9A84C" : undefined,
        }}
      >
        <button
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
          onClick={onToggle}
          type="button"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className={titleClassName}>{title}</p>
              {showActiveNow ? (
                <span className="rounded-full bg-[#F6EFE0] px-3 py-1 text-[10px] font-medium text-[#8B6B16]">
                  ● Active now
                </span>
              ) : null}
              {isOverdue ? (
                <span className="rounded-full bg-[#FFF2D8] px-3 py-1 text-[10px] font-medium text-[#B7791F]">
                  Overdue
                </span>
              ) : null}
              <span className="rounded-full bg-[#F6EFE0] px-3 py-1 text-[11px] font-medium text-[#8B6B16]">
                {countLabel}
              </span>
            </div>
            {subtitle ? <p className="mt-2 text-[12px] text-ink-muted">{subtitle}</p> : null}
          </div>

          {isExpanded ? (
            <ChevronDown className="h-5 w-5 shrink-0 text-[#8F877B]" strokeWidth={1.9} />
          ) : (
            <ChevronRight className="h-5 w-5 shrink-0 text-[#8F877B]" strokeWidth={1.9} />
          )}
        </button>

        <div
          className="overflow-hidden transition-all duration-300 ease-out"
          style={{
            maxHeight: isExpanded ? `${estimatedContentHeight}px` : "0px",
            opacity: isExpanded ? 1 : 0,
          }}
        >
          <div className="border-t border-[#F0EBE2] px-5 py-4">
            <div className="space-y-2">
              {sectionTasks.map((task) => (
                <TaskItem
                  confirmDeleteTaskId={confirmDeleteTaskId}
                  dateInputRef={dateInputRef}
                  editingDueDateTaskId={editingDueDateTaskId}
                  editingDueDateValue={editingDueDateValue}
                  editInputRef={editInputRef}
                  editingTaskId={editingTaskId}
                  editingTaskTitle={editingTaskTitle}
                  onCancelDueDateEditing={() => {
                    setEditingDueDateTaskId(null);
                    setEditingDueDateValue("");
                  }}
                  key={task.id}
                  onCancelDelete={() => setConfirmDeleteTaskId(null)}
                  onChangeEditingDueDateValue={setEditingDueDateValue}
                  onChangeEditingTaskTitle={setEditingTaskTitle}
                  onConfirmDelete={setConfirmDeleteTaskId}
                  onDeleteTask={handleDeleteTask}
                  onSaveDueDate={handleSaveDueDate}
                  onSaveEdit={handleSaveEdit}
                  onStartEditingDueDate={handleStartEditingDueDate}
                  onStartEditing={handleStartEditing}
                  onToggleTaskStatus={handleToggleTaskStatus}
                  removingTaskIds={removingTaskIds}
                  setEditingTaskId={setEditingTaskId}
                  task={task}
                />
              ))}
            </div>

            {activeAddTarget?.key === sectionKey ? (
              <div className="mt-3 rounded-[10px] border border-dashed border-[#D8C493] px-3 py-3">
                <input
                  className="w-full border-0 border-b border-gold bg-transparent px-0 py-2 text-[13px] text-ink outline-none"
                  onChange={(event) => setNewTaskTitle(event.target.value)}
                  onKeyDown={async (event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      await handleAddTask(addTarget);
                    }

                    if (event.key === "Escape") {
                      setActiveAddTarget(null);
                      setNewTaskTitle("");
                    }
                  }}
                  placeholder="Add a task"
                  ref={addInputRef}
                  value={newTaskTitle}
                />
                <div className="mt-3 flex items-center justify-end gap-3">
                  <button
                    className="text-[12px] text-ink-muted"
                    onClick={() => {
                      setActiveAddTarget(null);
                      setNewTaskTitle("");
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="text-[12px] font-medium text-gold"
                    onClick={() => handleAddTask(addTarget)}
                    type="button"
                  >
                    Add
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="mt-3 flex w-full items-center gap-2 rounded-[10px] border border-dashed border-[#D8C493] px-3 py-3 text-[13px] text-gold transition-colors hover:bg-[#FBF7ED]"
                onClick={() => {
                  setActiveAddTarget(addTarget);
                  setNewTaskTitle("");
                }}
                type="button"
              >
                <Plus className="h-4 w-4" strokeWidth={1.8} />
                Add task
              </button>
            )}
          </div>
        </div>
      </section>
    );
  };

  if (isLoading) {
    return <LoadingState />;
  }

  if (pageError && !tasks.length) {
    return (
      <section className="flex min-h-full items-center justify-center px-6 text-center">
        <p className="max-w-[720px] text-[15px] leading-7 text-danger">{pageError}</p>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-[1240px] flex-col gap-6">
      <div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-display text-[28px] leading-none text-ink">Planning Timeline</h1>
            <p className="mt-2 text-[14px] text-ink-muted">
              {completedTasks} of {totalTasks} tasks complete
            </p>
          </div>

          <div className="flex justify-start sm:justify-end">
            <div className="inline-flex rounded-full border border-[#E8E2D9] bg-[#FAF7F2] p-1">
              {[
                { label: "Phase view", value: "phase" as const },
                { label: "Month view", value: "month" as const },
              ].map((option) => {
                const isActive = viewMode === option.value;

                return (
                  <button
                    className="rounded-full px-4 py-2 text-[13px] transition-all duration-200"
                    key={option.value}
                    onClick={() => setViewMode(option.value)}
                    style={{
                      background: isActive ? "#1C1A17" : "transparent",
                      border: isActive ? "1px solid transparent" : "1px solid #E8E2D9",
                      color: isActive ? "#FAF7F2" : "#8F877B",
                      fontWeight: isActive ? 600 : 500,
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="mt-4 h-[2px] w-full overflow-hidden rounded-full bg-[#E8E2D9]">
          <div
            className="h-full bg-gold transition-[width] duration-300 ease-out"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {pageError ? (
        <div className="rounded-[12px] border border-[#F1D0C9] bg-[#FFF6F4] px-4 py-3 text-[13px] text-danger">
          {pageError}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.9fr)]">
        <div className="space-y-4">
          {displayedViewMode === "month" ? (
            <button
              className={`flex w-full items-center justify-between rounded-[12px] border border-[#E9D7AE] bg-[#FCF7E7] px-4 py-3 text-left text-[13px] text-[#8B6B16] transition-opacity duration-200 ${
                isViewVisible ? "opacity-100" : "opacity-0"
              }`}
              onClick={() =>
                currentMonthGroupRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
              type="button"
            >
              <span>✦ Wedly suggests focusing on {currentMonthTaskCount} tasks this month</span>
              <span className="text-[11px] font-medium">Go to {currentMonthLabel}</span>
            </button>
          ) : null}

          <div
            className={`space-y-4 transition-opacity duration-200 ${
              isViewVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            {displayedViewMode === "phase"
              ? PHASES.map((phase) => {
                  const phaseTasks = groupedTasks[phase.id];
                  const completedInPhase = phaseTasks.filter(
                    (task) => task.status === "completed",
                  ).length;

                  return renderTaskSection({
                    addTarget: {
                      dueDate: null,
                      key: `phase-${phase.id}`,
                      phaseId: phase.id,
                    },
                    countLabel: `${completedInPhase}/${phaseTasks.length || 0} done`,
                    isExpanded: expandedPhases[phase.id],
                    isHighlighted: activePhaseId === phase.id,
                    onToggle: () => togglePhase(phase.id),
                    sectionKey: `phase-${phase.id}`,
                    showActiveNow: isPhaseActiveNow(
                      phase.id,
                      weddingProfile?.wedding_date ?? null,
                    ),
                    subtitle: getTaskBasedPhaseTimeframeLabel(
                      phase.id,
                      phaseTasks,
                      weddingProfile?.wedding_date ?? null,
                      planStartDate,
                    ),
                    tasks: phaseTasks,
                    title: phase.name,
                    titleClassName: "font-display text-[24px] leading-none text-ink",
                  });
                })
              : monthGroups.map((group) =>
                  renderTaskSection({
                    addTarget: {
                      dueDate: getLastDayOfMonthFromKey(group.key),
                      key: `month-${group.key}`,
                      phaseId: getPhaseIdForDueDate(
                        getLastDayOfMonthFromKey(group.key),
                        weddingProfile?.wedding_date ?? null,
                      ),
                    },
                    countLabel: `${group.tasks.length} task${group.tasks.length === 1 ? "" : "s"}`,
                    isExpanded: expandedMonths[group.key] ?? false,
                    isHighlighted: group.isCurrentMonth,
                    isOverdue: group.isOverdue,
                    onToggle: () => toggleMonthGroup(group.key),
                    sectionKey: `month-${group.key}`,
                    tasks: group.tasks,
                    title: group.label,
                    titleClassName: "text-[14px] font-semibold text-ink",
                  }),
                )}

            {displayedViewMode === "month" && !monthGroups.length ? (
              <div className="rounded-[12px] border border-[#E8E2D9] bg-white px-5 py-6 text-[13px] text-ink-muted">
                No dated tasks yet. Once tasks have due dates, your monthly view will appear here.
              </div>
            ) : null}
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-7 lg:self-start">
          <div className="rounded-[12px] border border-[#E8E2D9] bg-white p-5">
            <p className="text-[11px] uppercase tracking-[0.22em] text-gold">AI suggestions</p>

            {suggestionsError ? (
              <p className="mt-4 text-[13px] leading-6 text-danger">{suggestionsError}</p>
            ) : isSuggestionsLoading ? (
              <p className="mt-4 text-[13px] leading-6 text-ink-muted">
                Refreshing suggestions for your current plan...
              </p>
            ) : suggestions.length ? (
              <div className="mt-4 space-y-3">
                {suggestions.map((suggestion) => (
                  <div
                    className="rounded-[8px] bg-[#FAF7F2] p-3"
                    key={`${suggestion.phase_id}-${suggestion.title}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-medium text-ink">{suggestion.title}</p>
                        <p className="mt-1 text-[11px] leading-5 text-ink-muted">
                          {suggestion.reason}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-[#F5EDDA] px-3 py-1 text-[11px] font-medium text-[#8B6B16]">
                        {phaseNameById[suggestion.phase_id]}
                      </span>
                    </div>

                    <button
                      className="mt-3 rounded-full border border-[#C9A84C] bg-transparent px-3 py-1 text-[11px] font-medium text-gold transition-colors hover:bg-[#FBF7ED]"
                      onClick={() => handleAddSuggestion(suggestion)}
                      type="button"
                    >
                      Add to plan +
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-[13px] leading-6 text-ink-muted">
                Your plan looks well covered right now. New AI suggestions will appear here when
                more gaps are detected.
              </p>
            )}

            <button
              className="mt-4 text-[12px] text-gold transition-opacity hover:opacity-75 disabled:opacity-50"
              disabled={isSuggestionsLoading}
              onClick={() => void fetchSuggestions(true)}
              type="button"
            >
              Refresh suggestions ↻
            </button>
          </div>

          {viewMode === "month" ? (
            <div className="rounded-[12px] border border-[#E8E2D9] bg-white p-5">
              <p className="text-[11px] uppercase tracking-[0.22em] text-gold">
                ✦ Suggested for this month
              </p>

              {monthSuggestionsError ? (
                <p className="mt-4 text-[13px] leading-6 text-danger">{monthSuggestionsError}</p>
              ) : isMonthSuggestionsLoading ? (
                <p className="mt-4 text-[13px] leading-6 text-ink-muted">
                  Looking at {currentMonthLabel.toLowerCase()} priorities...
                </p>
              ) : monthSuggestions.length ? (
                <div className="mt-4 space-y-3">
                  {monthSuggestions.map((suggestion) => (
                    <div
                      className="rounded-[8px] bg-[#FAF7F2] p-3"
                      key={`month-${suggestion.phase_id}-${suggestion.title}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[13px] font-medium text-ink">{suggestion.title}</p>
                          <p className="mt-1 text-[11px] leading-5 text-ink-muted">
                            {suggestion.reason}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-[#F5EDDA] px-3 py-1 text-[11px] font-medium text-[#8B6B16]">
                          {currentMonthLabel}
                        </span>
                      </div>

                      <button
                        className="mt-3 rounded-full border border-[#C9A84C] bg-transparent px-3 py-1 text-[11px] font-medium text-gold transition-colors hover:bg-[#FBF7ED]"
                        onClick={() => handleAddMonthSuggestion(suggestion)}
                        type="button"
                      >
                        Add to this month +
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-[13px] leading-6 text-ink-muted">
                  No extra focus tasks for this month right now.
                </p>
              )}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
