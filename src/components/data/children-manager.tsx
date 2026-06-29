"use client";

import { FormEvent, useEffect, useState } from "react";
import { EmptyState } from "@/components/data/empty-state";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export function ChildrenManager({ slug }: { slug: string }) {
  const [children, setChildren] = useState<Profile[]>([]);
  const [parentId, setParentId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone_number, avatar_url, teacher_credentials, age, gender, account_type, global_role, date_of_birth, created_at, updated_at")
      .in("id", childIds);

    if (profilesError) {
      setError(profilesError.message);
      setLoading(false);
      return;
    }

    setChildren(profiles ?? []);
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

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-16 animate-pulse rounded-2xl bg-[#EEF2F4]" />
        <div className="h-16 animate-pulse rounded-2xl bg-[#EEF2F4]" />
      </div>
    );
  }

  if (!parentId) {
    return <EmptyState title="Sign in to manage children" text="Parent accounts can add child profiles from this page after logging in." />;
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        {children.length === 0 ? (
          <div className="rounded-[24px] bg-white p-5 text-center text-sm leading-6 text-[#6B747B] shadow-[0_14px_34px_rgba(38,50,58,0.07)] ring-1 ring-[#E4EAEE]">
            No children have been added yet.
          </div>
        ) : (
          children.map((child) => (
            <div key={child.id} className="flex items-center gap-3 rounded-[24px] bg-white p-4 shadow-[0_14px_34px_rgba(38,50,58,0.07)] ring-1 ring-[#E4EAEE]">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EAF5F7] text-sm font-semibold text-[#2F8FB3]">
                {initials(child.full_name ?? "Child")}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-semibold text-[#26323A]">{child.full_name ?? "Child"}</h3>
                <p className="mt-0.5 text-sm text-[#6B747B]">
                  {childAge(child.date_of_birth, child.age)} • {child.gender ? titleCase(child.gender) : "Gender not set"}
                </p>
              </div>
            </div>
          ))
        )}
      </section>

      {formOpen ? (
        <form onSubmit={addChild} className="space-y-4 rounded-[28px] bg-white p-5 shadow-[0_18px_45px_rgba(38,50,58,0.08)] ring-1 ring-[#E4EAEE]">
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
        <button type="button" onClick={() => setFormOpen(true)} className="min-h-12 w-full rounded-full bg-[#17624F] px-5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(23,98,79,0.18)]">
          Add Child
        </button>
      )}

      {error ? <p className="rounded-2xl border border-[#F1C3BD] bg-[#FDEDEA] px-4 py-3 text-sm text-[#9D2E23]">{error}</p> : null}
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
