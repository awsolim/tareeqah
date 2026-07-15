"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FlatButton } from "@/components/ui/flat-button";
import { getDefaultLandingHref, loadUserAccessByMosqueSlug } from "@/lib/authz";
import { normalizePhoneNumber, phoneCountryCodes } from "@/lib/phone";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type AccountType = "student" | "parent" | "teacher";

const accountTypes: Array<{ value: AccountType; label: string }> = [
  { value: "student", label: "Student" },
  { value: "parent", label: "Parent" },
  { value: "teacher", label: "Teacher" },
];

export function OAuthProfileCompletion({ slug }: { slug: string }) {
  const router = useRouter();
  const [accountType, setAccountType] = useState<AccountType>("student");
  const [fullName, setFullName] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState("+1");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSession() {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        router.replace(`/m/${slug}/login`);
        return;
      }

      const metadata = data.session.user.user_metadata;
      setFullName(String(metadata.full_name ?? metadata.name ?? ""));
      setEmail(data.session.user.email ?? "");
      setLoading(false);
    }

    loadSession().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load your Google profile.");
      setLoading(false);
    });
  }, [router, slug]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const normalizedPhone = normalizePhoneNumber(phone, phoneCountryCode);
    if (normalizedPhone.error) {
      setSaving(false);
      setError(normalizedPhone.error);
      return;
    }

    if (!fullName.trim()) {
      setSaving(false);
      setError("Full name is required.");
      return;
    }

    if ((accountType === "student" || accountType === "parent") && (!gender || !dateOfBirth)) {
      setSaving(false);
      setError("Date of birth and gender are required.");
      return;
    }

    if (accountType === "student" && !isAtLeastAge(dateOfBirth, 13)) {
      setSaving(false);
      setError("Student accounts require the student to be 13 or older.");
      return;
    }

    if (accountType === "parent" && !isAtLeastAge(dateOfBirth, 18)) {
      setSaving(false);
      setError("Parent accounts require the parent to be 18 or older.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { error: rpcError } = await supabase.rpc("complete_oauth_profile", {
      signup_account_type: accountType,
      signup_full_name: fullName.trim(),
      signup_phone: normalizedPhone.value,
      signup_gender: accountType === "student" || accountType === "parent" ? gender : "",
      signup_date_of_birth: accountType === "student" || accountType === "parent" ? dateOfBirth : null,
      signup_mosque_slug: slug,
    });

    if (rpcError) {
      setSaving(false);
      setError(rpcError.message);
      return;
    }

    const access = await loadUserAccessByMosqueSlug(slug);
    router.replace(getDefaultLandingHref(slug, access));
    router.refresh();
  }

  if (loading) {
    return (
      <div className="flex min-h-[260px] items-center justify-center p-6">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#DDEFF4] border-t-[#2F8FB3]" />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5 p-5 md:p-6">
      <div>
        <p className="text-xl font-semibold text-[#26323A]">Finish your profile</p>
        <p className="mt-1 text-sm text-[#6B747B]">{email ? `Signed in as ${email}.` : "Google sign in is connected."}</p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-[#26323A]">Account type</legend>
        <div className="mt-2 grid grid-cols-3 border border-[#D6DCE0]">
          {accountTypes.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => setAccountType(type.value)}
              className={cn(
                "min-h-11 border-r border-[#D6DCE0] px-2 text-sm last:border-r-0",
                accountType === type.value ? "bg-[#E7F3F8] text-[#2F8FB3]" : "bg-white text-[#26323A]",
              )}
            >
              {type.label}
            </button>
          ))}
        </div>
        {accountType === "teacher" ? (
          <p className="mt-2 border-l-4 border-[#DFAE3F] bg-[#FFF7E0] px-3 py-2 text-sm text-[#7A5416]">
            Teacher accounts start pending. You will not have teacher abilities until the organization approves you.
          </p>
        ) : null}
      </fieldset>

      <CompletionInput label="Full name" name="fullName" value={fullName} onChange={setFullName} autoComplete="name" required />
      <CompletionPhoneInput
        countryCode={phoneCountryCode}
        onCountryCodeChange={setPhoneCountryCode}
        phone={phone}
        onPhoneChange={setPhone}
      />

      {accountType === "student" || accountType === "parent" ? (
        <>
          <CompletionSelect
            label="Gender"
            name="gender"
            value={gender}
            onChange={setGender}
            options={[
              { value: "", label: "Select gender" },
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
            ]}
            required
          />
          <CompletionInput label="Date of birth" name="dateOfBirth" value={dateOfBirth} onChange={setDateOfBirth} type="date" autoComplete="bday" required />
        </>
      ) : null}

      {error ? <p className="border-l-4 border-[#E25241] bg-[#FDEDEA] px-3 py-2 text-sm text-[#9D2E23]">{error}</p> : null}

      <FlatButton variant="primary" className="w-full" disabled={saving}>
        {saving ? "Saving..." : "Continue"}
      </FlatButton>
    </form>
  );
}

function isAtLeastAge(dateValue: string, minimumAge: number) {
  if (!dateValue) {
    return false;
  }
  const birthDate = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) {
    return false;
  }
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDifference = today.getMonth() - birthDate.getMonth();
  if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age >= minimumAge;
}

function CompletionPhoneInput({
  countryCode,
  onCountryCodeChange,
  phone,
  onPhoneChange,
}: {
  countryCode: string;
  onCountryCodeChange: (value: string) => void;
  phone: string;
  onPhoneChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#26323A]">Phone number</span>
      <div className="mt-1 grid grid-cols-[116px_minmax(0,1fr)]">
        <select
          name="phoneCountryCode"
          value={countryCode}
          onChange={(event) => onCountryCodeChange(event.target.value)}
          required
          className="h-11 border border-r-0 border-[#B9C3C8] bg-white px-2 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
        >
          {phoneCountryCodes.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          name="phone"
          type="tel"
          value={phone}
          onChange={(event) => onPhoneChange(event.target.value)}
          autoComplete="tel-national"
          required
          inputMode="tel"
          placeholder={countryCode === "+1" ? "780 555 1234" : "Phone number"}
          className="h-11 w-full border border-[#B9C3C8] bg-white px-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
        />
      </div>
    </label>
  );
}

function CompletionSelect({
  label,
  name,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#26323A]">{label}</span>
      <select
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="mt-1 h-11 w-full border border-[#B9C3C8] bg-white px-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
      >
        {options.map((option) => (
          <option key={option.value || "empty"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompletionInput({
  label,
  name,
  value,
  onChange,
  type = "text",
  autoComplete,
  required,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#26323A]">{label}</span>
      <input
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required={required}
        className="mt-1 h-11 w-full border border-[#B9C3C8] bg-white px-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
      />
    </label>
  );
}
