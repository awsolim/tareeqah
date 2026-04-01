"use client";

import { useState } from "react";
import { BookOpen, GraduationCap, Users } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { AuthDivider } from "@/components/auth/AuthDivider";

type Role = "student" | "parent" | "teacher";

interface SignupFormWithRoleProps {
  slug: string;
  siteUrl: string;
  primaryColor: string;
  children: React.ReactNode; // The email/password form fields
}

const roles: Array<{ value: Role; label: string; icon: typeof GraduationCap }> = [
  { value: "student", label: "STUDENT", icon: GraduationCap },
  { value: "parent", label: "PARENT", icon: Users },
  { value: "teacher", label: "TEACHER", icon: BookOpen },
];

export function SignupFormWithRole({
  slug,
  siteUrl,
  primaryColor,
  children,
}: SignupFormWithRoleProps) {
  const [role, setRole] = useState<Role>("student");

  // Google OAuth redirects to complete-signup (no role needed — user picks role after auth)
  const googleRedirectTo = `${siteUrl}/auth/callback?next=/m/${slug}/complete-signup&slug=${slug}`;

  return (
    <>
      <GoogleSignInButton redirectTo={googleRedirectTo} />

      <AuthDivider />

      <input type="hidden" name="role" value={role} />
      <div className="grid grid-cols-3 gap-3">
        {roles.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setRole(value)}
            className="flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors"
            style={{
              borderColor: role === value ? primaryColor : "var(--border)",
              backgroundColor: role === value ? `${primaryColor}08` : "transparent",
            }}
            data-testid={`role-${value}`}
          >
            <Icon
              className="h-6 w-6"
              style={{ color: role === value ? primaryColor : undefined }}
            />
            <span className="text-sm font-medium">{label}</span>
          </button>
        ))}
      </div>

      {role === "teacher" ? (
        <p className="text-xs text-muted-foreground">
          Teacher accounts require admin approval after sign-up.
        </p>
      ) : null}

      {children}
    </>
  );
}
