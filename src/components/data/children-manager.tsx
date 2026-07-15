"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/data/empty-state";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Enrollment = Database["public"]["Tables"]["enrollments"]["Row"];
type Program = Database["public"]["Tables"]["programs"]["Row"];
type ProgramTrack = Database["public"]["Tables"]["program_tracks"]["Row"];

type ChildProgram = {
  enrollment: Enrollment;
  program: Program | null;
  tracks: ProgramTrack[];
};

type ChildWithDetails = Profile & {
  classes: ChildProgram[];
};

type EditFields = {
  fullName: string;
  gender: string;
  dateOfBirth: string;
};

export function ChildrenManager({ slug }: { slug: string }) {
  const [children, setChildren] = useState<ChildWithDetails[]>([]);
  const [parentId, setParentId] = useState<string | null>(null);
  const [mosqueId, setMosqueId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [expandedChildId, setExpandedChildId] = useState<string | null>(null);
  const [editingChildId, setEditingChildId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<EditFields>({ fullName: "", gender: "", dateOfBirth: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyChildId, setBusyChildId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function loadChildren() {
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;

    if (!userId) {
      setParentId(null);
      setLoading(false);
      return;
    }

    setParentId(userId);

    const { data: mosque, error: mosqueError } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
    if (mosqueError || !mosque) {
      setError(mosqueError?.message ?? "Masjid not found.");
      setLoading(false);
      return;
    }
    setMosqueId(mosque.id);

    const { data: links, error: linksError } = await supabase
      .from("parent_child_links")
      .select("child_profile_id")
      .eq("parent_profile_id", userId)
      .eq("mosque_id", mosque.id);

    if (linksError) {
      setError(linksError.message);
      setLoading(false);
      return;
    }

    const childIds = (links ?? []).map((link) => link.child_profile_id);
    if (childIds.length === 0) {
      setChildren([]);
      setLoading(false);
      return;
    }

    const [{ data: profiles, error: profilesError }, { data: enrollments }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email, phone_number, avatar_url, teacher_credentials, teacher_whatsapp_number, age, gender, account_type, global_role, date_of_birth, created_at, updated_at")
        .in("id", childIds),
      supabase.from("enrollments").select("*").in("student_profile_id", childIds),
    ]);

    if (profilesError) {
      setError(profilesError.message);
      setLoading(false);
      return;
    }

    const enrollmentRows = enrollments ?? [];
    const enrollmentIds = enrollmentRows.map((enrollment) => enrollment.id);
    const programIds = Array.from(new Set(enrollmentRows.map((enrollment) => enrollment.program_id)));
    const [{ data: enrollmentTracks }, { data: programs }, { data: tracks }] = await Promise.all([
      enrollmentIds.length ? supabase.from("enrollment_tracks").select("enrollment_id, program_track_id").in("enrollment_id", enrollmentIds) : Promise.resolve({ data: [] as Array<{ enrollment_id: string; program_track_id: string }> }),
      programIds.length ? supabase.from("programs").select("*").in("id", programIds).order("title", { ascending: true }) : Promise.resolve({ data: [] as Program[] }),
      programIds.length ? supabase.from("program_tracks").select("*").in("program_id", programIds).order("sort_order", { ascending: true }) : Promise.resolve({ data: [] as ProgramTrack[] }),
    ]);

    const nextChildren = (profiles ?? [])
      .map((profile) => ({
        ...profile,
        classes: enrollmentRows
          .filter((enrollment) => enrollment.student_profile_id === profile.id)
          .map((enrollment) => {
            const trackIds = (enrollmentTracks ?? [])
              .filter((row) => row.enrollment_id === enrollment.id)
              .map((row) => row.program_track_id)
              .concat(enrollment.program_track_id ? [enrollment.program_track_id] : [])
              .filter((trackId, index, all) => all.indexOf(trackId) === index);
            return {
              enrollment,
              program: (programs ?? []).find((program) => program.id === enrollment.program_id) ?? null,
              tracks: (tracks ?? []).filter((track) => trackIds.includes(track.id)),
            };
          }),
      }))
      .sort((left, right) => (left.full_name ?? "").localeCompare(right.full_name ?? ""));

    setChildren(nextChildren);
    setLoading(false);
  }

  async function addChild(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parentId || !fullName.trim() || !gender || !dateOfBirth) {
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: rpcError } = await supabase.rpc("create_parent_child_profile", {
      child_full_name: fullName.trim(),
      child_gender: gender,
      child_date_of_birth: dateOfBirth,
      child_mosque_slug: slug,
    });

    if (rpcError) {
      setError(rpcError.message);
      setSaving(false);
      return;
    }

    setFullName("");
    setGender("");
    setDateOfBirth("");
    setFormOpen(false);
    setSaving(false);
    await loadChildren();
  }

  function openEdit(child: ChildWithDetails) {
    setExpandedChildId(child.id);
    setEditingChildId(child.id);
    setEditFields({
      fullName: child.full_name ?? "",
      gender: child.gender ?? "",
      dateOfBirth: child.date_of_birth ?? "",
    });
  }

  async function saveChild(childId: string) {
    if (!editFields.fullName.trim() || !editFields.gender || !editFields.dateOfBirth) {
      setError("Name, gender, and date of birth are required.");
      return;
    }

    setBusyChildId(childId);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: rpcError } = await supabase.rpc("update_parent_child_profile", {
      child_profile_id: childId,
      child_full_name: editFields.fullName.trim(),
      child_gender: editFields.gender,
      child_date_of_birth: editFields.dateOfBirth,
      child_mosque_slug: slug,
    });

    if (rpcError) {
      setError(rpcError.message);
      setBusyChildId(null);
      return;
    }

    setEditingChildId(null);
    setBusyChildId(null);
    await loadChildren();
  }

  async function removeChild(child: ChildWithDetails) {
    if (!parentId || !mosqueId) {
      return;
    }
    const childName = child.full_name?.trim() || "this child";
    if (!window.confirm(`Remove ${childName} from your family? This will not delete their class history.`)) {
      return;
    }

    setBusyChildId(child.id);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: deleteError } = await supabase
      .from("parent_child_links")
      .delete()
      .eq("parent_profile_id", parentId)
      .eq("child_profile_id", child.id)
      .eq("mosque_id", mosqueId);

    if (deleteError) {
      setError(deleteError.message);
      setBusyChildId(null);
      return;
    }

    setBusyChildId(null);
    setExpandedChildId((current) => (current === child.id ? null : current));
    await loadChildren();
  }

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center px-6 py-10" aria-label="Loading">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="h-11 w-11 animate-spin rounded-full border-4 border-[#DDEFF4] border-t-[#2F8FB3]" aria-hidden />
          <span className="text-sm font-semibold text-[#52616A]">Loading</span>
        </div>
      </div>
    );
  }

  if (!parentId) {
    return <EmptyState title="Sign in to manage children" text="Parent accounts can add child profiles from this page after logging in." />;
  }

  return (
    <div className="space-y-5">
      {error ? <p className="rounded-2xl border border-[#F1C3BD] bg-[#FDEDEA] px-4 py-3 text-sm text-[#9D2E23]">{error}</p> : null}

      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#7B858C]">Children</h2>
          <span className="text-xs font-semibold text-[#9AA4AA]">{children.length}</span>
        </div>
        {children.length === 0 ? (
          <div className="rounded-[20px] bg-[#F7FAFB] px-5 py-6 text-center text-sm leading-6 text-[#6B747B]">
            No children have been added yet.
          </div>
        ) : (
          <div className="divide-y divide-[#EEF2F4]">
            {children.map((child) => (
              <FamilyChildRow
                key={child.id}
                child={child}
                expanded={expandedChildId === child.id}
                editing={editingChildId === child.id}
                busy={busyChildId === child.id}
                editFields={editFields}
                onExpand={() => setExpandedChildId((current) => (current === child.id ? null : child.id))}
                onEdit={() => openEdit(child)}
                onEditFieldsChange={setEditFields}
                onCancelEdit={() => setEditingChildId(null)}
                onSave={() => saveChild(child.id)}
                onRemove={() => removeChild(child)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-[28px] bg-gradient-to-br from-[#F6FBF7] via-white to-[#EAF5F7] p-1 shadow-[0_16px_42px_rgba(38,50,58,0.08)] ring-1 ring-[#E4EAEE]">
        {formOpen ? (
          <form onSubmit={addChild} className="space-y-4 rounded-[24px] bg-white/90 p-5">
            <div>
              <p className="text-lg font-semibold text-[#26323A]">Add child</p>
              <p className="mt-1 text-sm leading-6 text-[#6B747B]">Create a child student profile connected to this family.</p>
            </div>
            <FamilyInput label="Name" value={fullName} onChange={setFullName} required />
            <label className="block">
              <span className="text-sm font-semibold text-[#26323A]">Gender</span>
              <select
                value={gender}
                onChange={(event) => setGender(event.target.value)}
                className="mt-2 h-12 w-full rounded-2xl border border-[#D6DCE0] bg-white px-4 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
                required
                suppressHydrationWarning
              >
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <FamilyInput label="Date of birth" value={dateOfBirth} onChange={setDateOfBirth} type="date" required />
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setFormOpen(false)} className="min-h-12 rounded-full bg-[#EEF2F4] px-4 text-sm font-semibold text-[#52616A]">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="min-h-12 rounded-full bg-[#17624F] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(23,98,79,0.18)] disabled:opacity-60">
                {saving ? "Adding..." : "Add to Family"}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setFormOpen(true)} className="flex w-full items-center gap-4 rounded-[26px] bg-white/80 px-5 py-4 text-left transition hover:bg-white">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#17624F] text-white shadow-[0_12px_24px_rgba(23,98,79,0.18)]">
              <PlusIcon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-[#26323A]">Add Child</span>
              <span className="mt-1 block text-sm leading-5 text-[#6B747B]">Create another child profile for applications and classes.</span>
            </span>
          </button>
        )}
      </section>
    </div>
  );
}

function FamilyChildRow({
  child,
  expanded,
  editing,
  busy,
  editFields,
  onExpand,
  onEdit,
  onEditFieldsChange,
  onCancelEdit,
  onSave,
  onRemove,
}: {
  child: ChildWithDetails;
  expanded: boolean;
  editing: boolean;
  busy: boolean;
  editFields: EditFields;
  onExpand: () => void;
  onEdit: () => void;
  onEditFieldsChange: (fields: EditFields) => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const childName = child.full_name?.trim() || "Child";

  return (
    <article>
      <div className="flex items-center gap-3 py-3">
        <FamilyAvatar src={child.avatar_url} name={childName} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-5 text-[#26323A]">{childName}</h3>
          <p className="mt-0.5 truncate text-xs font-medium text-[#7B858C]">
            {childAge(child.date_of_birth, child.age)} • {child.gender ? titleCase(child.gender) : "Gender not set"}
          </p>
        </div>
        <button
          type="button"
          onClick={onExpand}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#52616A] hover:bg-[#EEF3F5]"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide child details" : "Show child details"}
        >
          <ChevronIcon expanded={expanded} />
        </button>
        <FamilyActionMenu busy={busy} onEdit={onEdit} onRemove={onRemove} />
      </div>
      <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className="space-y-3 pb-4 pl-0 pr-2">
            {editing ? (
              <div className="rounded-[18px] bg-[#F7FAFB] px-4 py-4">
                <div className="space-y-3">
                  <FamilyInput label="Name" value={editFields.fullName} onChange={(value) => onEditFieldsChange({ ...editFields, fullName: value })} required />
                  <label className="block">
                    <span className="text-sm font-semibold text-[#26323A]">Gender</span>
                    <select
                      value={editFields.gender}
                      onChange={(event) => onEditFieldsChange({ ...editFields, gender: event.target.value })}
                      className="mt-2 h-12 w-full rounded-2xl border border-[#D6DCE0] bg-white px-4 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
                      required
                      suppressHydrationWarning
                    >
                      <option value="">Select gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </label>
                  <FamilyInput label="Date of birth" value={editFields.dateOfBirth} onChange={(value) => onEditFieldsChange({ ...editFields, dateOfBirth: value })} type="date" required />
                </div>
                <div className="mt-4 flex items-center justify-end gap-3">
                  <button type="button" onClick={onCancelEdit} className="px-2 py-2 text-sm font-semibold text-[#6B747B]">
                    Cancel
                  </button>
                  <button type="button" onClick={onSave} disabled={busy} className="rounded-full bg-[#17624F] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                    {busy ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-[18px] bg-[#F7FAFB] px-4 py-3 text-sm">
                <FamilyDetail label="Name" value={child.full_name} singleLine />
                <FamilyDetail label="Age" value={childAge(child.date_of_birth, child.age)} />
                <FamilyDetail label="Gender" value={child.gender ? titleCase(child.gender) : "Not set" } />
                <FamilyDetail label="Date of birth" value={formatDate(child.date_of_birth)} />
              </dl>
            )}
            <div className="rounded-[18px] bg-[#FCFDFD] px-4 py-3 ring-1 ring-[#EEF2F4]">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#9AA4AA]">Classes</p>
              <FamilyClassList classes={child.classes} />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function FamilyActionMenu({ busy, onEdit, onRemove }: { busy: boolean; onEdit: () => void; onRemove: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((value) => !value);
        }}
        className={cn("flex h-9 w-9 items-center justify-center rounded-full transition-colors", menuOpen ? "bg-[#26323A] text-white" : "text-[#52616A] hover:bg-[#EEF3F5] hover:text-[#26323A]")}
        aria-label="Child actions"
      >
        <MoreVerticalIcon />
      </button>
      {menuOpen ? (
        <span className="absolute right-0 top-11 z-30 w-44 overflow-hidden rounded-[16px] border border-[#DDE5E9] bg-white p-1 text-sm shadow-[0_18px_44px_rgba(38,50,58,0.18)]">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen(false);
              onEdit();
            }}
            className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left font-semibold text-[#26323A] hover:bg-[#F4F8F9]"
          >
            Edit information
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (busy) {
                return;
              }
              setMenuOpen(false);
              onRemove();
            }}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left font-semibold text-[#C83F31] hover:bg-[#FFF1EF] disabled:opacity-50"
          >
            {busy ? "Removing..." : "Remove from family"}
          </button>
        </span>
      ) : null}
    </span>
  );
}

function FamilyClassList({ classes }: { classes: ChildProgram[] }) {
  const sortedClasses = useMemo(
    () => classes.slice().sort((left, right) => (left.program?.title ?? "").localeCompare(right.program?.title ?? "")),
    [classes],
  );

  if (sortedClasses.length === 0) {
    return <p className="mt-2 text-sm font-medium text-[#6B747B]">Not enrolled in any classes.</p>;
  }

  return (
    <div className="mt-2 divide-y divide-[#EEF2F4]">
      {sortedClasses.map((item) => (
        <div key={item.enrollment.id} className="py-2.5">
          <p className="truncate text-sm font-semibold text-[#26323A]">{item.program?.title ?? "Class"}</p>
          <p className="mt-0.5 text-xs font-medium text-[#7B858C]">
            {item.tracks.length ? item.tracks.map((track) => track.name).join(", ") : "All tracks"}
          </p>
        </div>
      ))}
    </div>
  );
}

function FamilyDetail({ label, value, singleLine = false }: { label: string; value?: string | null; singleLine?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.12em] text-[#9AA4AA]">{label}</dt>
      <dd className={cn("mt-1 text-sm font-semibold text-[#26323A]", singleLine ? "truncate" : "break-words")}>{value || "Not set"}</dd>
    </div>
  );
}

function FamilyInput({ label, value, onChange, type = "text", required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-[#26323A]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="mt-2 h-12 w-full rounded-2xl border border-[#D6DCE0] bg-white px-4 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
        suppressHydrationWarning
      />
    </label>
  );
}

function FamilyAvatar({ src, name }: { src: string | null; name: string }) {
  if (src) {
    return <img src={src} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />;
  }

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#E7F3F8] text-sm font-semibold text-[#2F8FB3]">
      {initials(name)}
    </div>
  );
}

function childAge(dateOfBirth: string | null, fallbackAge: string | null) {
  const calculated = calculateAge(dateOfBirth);
  if (calculated !== null) {
    return `${calculated} years old`;
  }
  return fallbackAge ? `${fallbackAge} years old` : "Age not set";
}

function calculateAge(dateOfBirth: string | null) {
  if (!dateOfBirth) {
    return null;
  }
  const birthDate = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not set";
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={cn("h-5 w-5 transition-transform", expanded ? "rotate-180" : "")} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function MoreVerticalIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
