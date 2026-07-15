"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { FlatButton } from "@/components/ui/flat-button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function ForgotPasswordPanel({ slug }: { slug: string }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setSubmitting(false);
      setError("Email is required.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: `${window.location.origin}/m/${slug}/auth/reset-password`,
    });

    setSubmitting(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setMessage("If an account exists for that email, a password reset link has been sent.");
  }

  return (
    <div className="mx-auto max-w-xl">
      <form onSubmit={submit} className="space-y-4 p-4 md:p-6">
        <p className="text-sm leading-6 text-[#6B747B]">Enter your account email and we will send you a link to set a new password.</p>
        <label className="block">
          <span className="text-sm font-medium text-[#26323A]">Email</span>
          <input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            className="mt-1 h-11 w-full border border-[#B9C3C8] bg-white px-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
          />
        </label>

        {error ? <p className="border-l-4 border-[#E25241] bg-[#FDEDEA] px-3 py-2 text-sm text-[#9D2E23]">{error}</p> : null}
        {message ? <p className="border-l-4 border-[#2F8FB3] bg-[#E7F3F8] px-3 py-2 text-sm text-[#257B9C]">{message}</p> : null}

        <FlatButton variant="primary" className="w-full" disabled={submitting}>
          {submitting ? "Sending..." : "Send reset link"}
        </FlatButton>

        <Link href={`/m/${slug}/login`} className="block text-center text-sm font-semibold text-[#2F6B53]">
          Back to login
        </Link>
      </form>
    </div>
  );
}

export function ResetPasswordPanel({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handledRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(searchParams.get("error_description") ?? searchParams.get("error"));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (handledRef.current || error) {
      return;
    }

    handledRef.current = true;

    async function prepareRecoverySession() {
      const supabase = createSupabaseBrowserClient();
      const code = searchParams.get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          throw exchangeError;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        throw new Error("This reset link is invalid or expired. Request a new password reset link.");
      }

      setReady(true);
    }

    prepareRecoverySession().catch((resetError: unknown) => {
      setError(resetError instanceof Error ? resetError.message : "Could not open the password reset link.");
    });
  }, [error, searchParams]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);

    const passwordError = validatePassword(password);
    if (passwordError) {
      setSubmitting(false);
      setError(passwordError);
      return;
    }

    if (password !== confirmPassword) {
      setSubmitting(false);
      setError("Passwords do not match.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessage("Password updated. You can now log in with your new password.");
    await supabase.auth.signOut();
    window.setTimeout(() => {
      router.replace(`/m/${slug}/login`);
    }, 1400);
  }

  if (!ready && !error) {
    return (
      <div className="flex min-h-[240px] items-center justify-center p-6">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#DDEFF4] border-t-[#2F8FB3]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <form onSubmit={submit} className="space-y-4 p-4 md:p-6">
        <p className="text-sm leading-6 text-[#6B747B]">Choose a new password for your account.</p>

        <PasswordField label="New password" name="password" value={password} onChange={setPassword} visible={showPassword} onToggleVisible={() => setShowPassword((current) => !current)} />
        <PasswordField label="Confirm new password" name="confirmPassword" value={confirmPassword} onChange={setConfirmPassword} visible={showConfirmPassword} onToggleVisible={() => setShowConfirmPassword((current) => !current)} />

        {error ? <p className="border-l-4 border-[#E25241] bg-[#FDEDEA] px-3 py-2 text-sm text-[#9D2E23]">{error}</p> : null}
        {message ? <p className="border-l-4 border-[#2F8FB3] bg-[#E7F3F8] px-3 py-2 text-sm text-[#257B9C]">{message}</p> : null}

        <FlatButton variant="primary" className="w-full" disabled={submitting || Boolean(error)}>
          {submitting ? "Saving..." : "Set new password"}
        </FlatButton>

        <Link href={`/m/${slug}/forgot-password`} className="block text-center text-sm font-semibold text-[#2F6B53]">
          Request a new link
        </Link>
      </form>
    </div>
  );
}

function PasswordField({
  label,
  name,
  value,
  onChange,
  visible,
  onToggleVisible,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#26323A]">{label}</span>
      <span className="relative mt-1 block">
        <input
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="new-password"
          required
          className="h-11 w-full border border-[#B9C3C8] bg-white px-3 pr-12 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
        />
        <button type="button" onClick={onToggleVisible} className="absolute inset-y-0 right-2 flex h-11 w-8 items-center justify-center rounded-full text-[#6B747B] hover:bg-[#F2F4F5] hover:text-[#26323A]" aria-label={visible ? `Hide ${label}` : `Show ${label}`}>
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </span>
    </label>
  );
}

function validatePassword(value: string) {
  if (value.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    return "Password must include uppercase, lowercase, number, and symbol.";
  }
  return null;
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.7" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 3 18 18" />
      <path d="M10.7 5.2A10.6 10.6 0 0 1 12 5c6 0 9.5 7 9.5 7a14.6 14.6 0 0 1-3.1 3.9" />
      <path d="M6.5 6.8C3.9 8.5 2.5 12 2.5 12s3.5 7 9.5 7a9 9 0 0 0 4.2-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
