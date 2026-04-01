"use client";

import { useState } from "react";
import { BookOpen, GraduationCap, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SubmitButton from "@/components/ui/SubmitButton";
import { completeOAuthSignup } from "@/app/actions/auth";

type Role = "student" | "parent" | "teacher";

const roles: Array<{
  value: Role;
  label: string;
  description: string;
  icon: typeof GraduationCap;
}> = [
  {
    value: "student",
    label: "Student",
    description: "Enroll in programs and track your progress.",
    icon: GraduationCap,
  },
  {
    value: "parent",
    label: "Parent",
    description: "Manage your children's enrollments.",
    icon: Users,
  },
  {
    value: "teacher",
    label: "Teacher",
    description: "Teach classes (requires admin approval).",
    icon: BookOpen,
  },
];

interface CompleteSignupFormProps {
  slug: string;
  mosqueId: string;
  fullName: string;
  email: string;
  primaryColor: string;
}

export function CompleteSignupForm({
  slug,
  mosqueId,
  fullName,
  email,
  primaryColor,
}: CompleteSignupFormProps) {
  const [role, setRole] = useState<Role>("student");

  return (
    <form action={completeOAuthSignup} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="mosqueId" value={mosqueId} />
      <input type="hidden" name="role" value={role} />

      {/* Editable full name (pre-filled from Google) */}
      <div className="space-y-1.5">
        <Label htmlFor="full_name">Full Name</Label>
        <Input
          id="full_name"
          name="full_name"
          type="text"
          required
          defaultValue={fullName}
          placeholder="Your full name"
          className="h-11"
        />
      </div>

      {/* Email (read-only, from Google) */}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <div
          className="flex h-11 w-full items-center rounded-xl border bg-muted/50 px-3 text-sm text-muted-foreground"
          data-testid="complete-signup-email"
        >
          {email}
        </div>
      </div>

      {/* Role selector */}
      <div className="space-y-3">
        <Label>Choose your role</Label>
        <div className="space-y-2">
          {roles.map(({ value, label, description, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setRole(value)}
              className="flex w-full items-start gap-4 rounded-xl border-2 p-4 text-left transition-colors"
              style={{
                borderColor: role === value ? primaryColor : "#e5e7eb",
                backgroundColor:
                  role === value ? `${primaryColor}08` : "transparent",
              }}
              data-testid={`role-${value}`}
            >
              <Icon
                className="mt-0.5 h-5 w-5 shrink-0"
                style={{ color: role === value ? primaryColor : "#6b7280" }}
              />
              <div>
                <p className="text-sm font-semibold">{label}</p>
                <p className="mt-0.5 text-xs text-gray-500">{description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {role === "teacher" ? (
        <p className="text-xs text-muted-foreground">
          Teacher accounts require admin approval after sign-up.
        </p>
      ) : null}

      <SubmitButton
        pendingText="Joining..."
        style={{ backgroundColor: primaryColor }}
      >
        Complete Signup
      </SubmitButton>
    </form>
  );
}
