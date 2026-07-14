"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { FlatButton } from "@/components/ui/flat-button";
import { getDefaultLandingHref, loadUserAccessByMosqueSlug } from "@/lib/authz";
import { normalizePhoneNumber, phoneCountryCodes } from "@/lib/phone";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type AuthMode = "login" | "signup";
type AccountType = "student" | "parent" | "teacher";
type DevSwitchAccountType = "student" | "parent" | "teacher" | "admin";

const accountTypes: Array<{ value: AccountType; label: string }> = [
  { value: "student", label: "Student" },
  { value: "parent", label: "Parent" },
  { value: "teacher", label: "Teacher" },
];

const devSwitchAccountsStorageKey = "tareeqah:dev-switch-accounts";

function isDevSwitchAccountType(value: string | null | undefined): value is DevSwitchAccountType {
  return value === "student" || value === "parent" || value === "teacher" || value === "admin";
}

function saveDevSwitchAccountForTesting(account: { label: string; email: string; password: string; accountType: DevSwitchAccountType }) {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production" || !account.email || !account.password) {
    return;
  }

  try {
    const existingRaw = window.localStorage.getItem(devSwitchAccountsStorageKey);
    const existingParsed: unknown = existingRaw ? JSON.parse(existingRaw) : [];
    const existingAccounts = Array.isArray(existingParsed) ? existingParsed : [];
    const validAccounts = existingAccounts.filter((entry): entry is typeof account => {
      if (!entry || typeof entry !== "object") {
        return false;
      }

      const maybeAccount = entry as Partial<typeof account>;
      return (
        typeof maybeAccount.label === "string" &&
        typeof maybeAccount.email === "string" &&
        typeof maybeAccount.password === "string" &&
        isDevSwitchAccountType(maybeAccount.accountType)
      );
    });
    const nextAccounts = [account, ...validAccounts.filter((entry) => entry.email.toLowerCase() !== account.email.toLowerCase())].slice(0, 12);
    window.localStorage.setItem(devSwitchAccountsStorageKey, JSON.stringify(nextAccounts));
  } catch {
    // Test-only convenience cache. Ignore storage failures.
  }
}

export function AuthPanel({ mode, slug }: { mode: AuthMode; slug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [accountType, setAccountType] = useState<AccountType>("student");
  const [fullName, setFullName] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState("+1");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthSubmitting, setOauthSubmitting] = useState(false);

  const isSignup = mode === "signup";
  const routeSlug = pathname.match(/^\/m\/([^/]+)/)?.[1];
  const activeSlug = routeSlug ?? slug;
  const submitLabel = useMemo(() => (isSignup ? "Create Account" : "Log In"), [isSignup]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);

    const supabase = createSupabaseBrowserClient();

    if (isSignup) {
      const normalizedPhone = normalizePhoneNumber(phone, phoneCountryCode);
      if (normalizedPhone.error) {
        setSubmitting(false);
        setError(normalizedPhone.error);
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/m/${activeSlug}/portal`,
          data: {
            account_type: accountType,
            full_name: fullName,
            phone: normalizedPhone.value,
            gender: accountType === "student" ? gender : "",
            date_of_birth: accountType === "student" ? dateOfBirth : "",
            age: "",
            mosque_slug: activeSlug,
          },
        },
      });

      setSubmitting(false);

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      if (data.session) {
        const access = await loadUserAccessByMosqueSlug(activeSlug);
        saveDevSwitchAccountForTesting({
          label: fullName.trim() || email,
          email,
          password,
          accountType,
        });
        router.push(getDefaultLandingHref(activeSlug, access));
        router.refresh();
        return;
      }

      setMessage("Account created. Check your email to confirm your account before logging in.");
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    const access = await loadUserAccessByMosqueSlug(activeSlug);
    const loginAccountType = access.accountType?.toLowerCase();
    saveDevSwitchAccountForTesting({
      label: email,
      email,
      password,
      accountType: isDevSwitchAccountType(loginAccountType) ? loginAccountType : "student",
    });
    router.push(getDefaultLandingHref(activeSlug, access));
    router.refresh();
  }

  async function continueWithGoogle() {
    setOauthSubmitting(true);
    setError(null);
    setMessage(null);

    const supabase = createSupabaseBrowserClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/m/${activeSlug}/auth/callback`,
        queryParams: {
          prompt: "select_account",
        },
      },
    });

    if (oauthError) {
      setOauthSubmitting(false);
      setError(oauthError.message);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="grid grid-cols-2 border-b border-[#D6DCE0]">
        <Link
          href={`/m/${activeSlug}/login`}
          className={cn(
            "flex min-h-12 items-center justify-center text-sm font-medium",
            mode === "login" ? "border-b-2 border-[#2F8FB3] text-[#2F8FB3]" : "text-[#6B747B]",
          )}
        >
          Log In
        </Link>
        <Link
          href={`/m/${activeSlug}/signup`}
          className={cn(
            "flex min-h-12 items-center justify-center text-sm font-medium",
            mode === "signup" ? "border-b-2 border-[#2F8FB3] text-[#2F8FB3]" : "text-[#6B747B]",
          )}
        >
          Create Account
        </Link>
      </div>

      <form onSubmit={submit} className="space-y-4 p-4 md:p-6">
        <button
          type="button"
          onClick={continueWithGoogle}
          disabled={submitting || oauthSubmitting}
          className="flex min-h-12 w-full items-center justify-center gap-3 border border-[#D6DCE0] bg-white px-4 text-sm font-semibold text-[#26323A] shadow-[0_12px_24px_rgba(38,50,58,0.06)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F2F4F5] text-base font-bold text-[#2F8FB3]">G</span>
          {oauthSubmitting ? "Connecting..." : "Continue with Google"}
        </button>

        <div className="flex items-center gap-3 text-xs font-medium uppercase text-[#8A949B]">
          <span className="h-px flex-1 bg-[#E1E6E9]" />
          <span>Email</span>
          <span className="h-px flex-1 bg-[#E1E6E9]" />
        </div>

        {isSignup ? (
          <fieldset>
            <legend className="text-sm font-medium text-[#26323A]">Account type</legend>
            <div className="mt-2 grid grid-cols-3 border border-[#D6DCE0]">
              {accountTypes.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setAccountType(type.value)}
                  suppressHydrationWarning
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
                Teacher accounts start with no teacher abilities. An organization admin must approve the account before you can access classes or tools.
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {isSignup ? (
          <>
            <AuthInput label="Full name" name="fullName" value={fullName} onChange={setFullName} autoComplete="name" required />
            <PhoneInput
              countryCode={phoneCountryCode}
              onCountryCodeChange={setPhoneCountryCode}
              phone={phone}
              onPhoneChange={setPhone}
            />
            {accountType === "student" ? (
              <>
                <AuthSelect
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
                <AuthInput label="Date of birth" name="dateOfBirth" value={dateOfBirth} onChange={setDateOfBirth} type="date" autoComplete="bday" required />
              </>
            ) : null}
          </>
        ) : null}

        <AuthInput label="Email" name="email" value={email} onChange={setEmail} type="email" autoComplete="email" required />
        <AuthInput
          label="Password"
          name="password"
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          required
        />

        {error ? <p className="border-l-4 border-[#E25241] bg-[#FDEDEA] px-3 py-2 text-sm text-[#9D2E23]">{error}</p> : null}
        {message ? <p className="border-l-4 border-[#2F8FB3] bg-[#E7F3F8] px-3 py-2 text-sm text-[#257B9C]">{message}</p> : null}

        <FlatButton variant="primary" className="w-full" disabled={submitting}>
          {submitting ? "Please wait..." : submitLabel}
        </FlatButton>
      </form>
    </div>
  );
}

function PhoneInput({
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
          suppressHydrationWarning
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
          suppressHydrationWarning
          className="h-11 w-full border border-[#B9C3C8] bg-white px-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
        />
      </div>
    </label>
  );
}

function AuthSelect({
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
        suppressHydrationWarning
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

function AuthInput({
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
        suppressHydrationWarning
        className="mt-1 h-11 w-full border border-[#B9C3C8] bg-white px-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
      />
    </label>
  );
}
