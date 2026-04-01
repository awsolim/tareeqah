/**
 * Integration tests that call the actual /auth/callback route handler.
 *
 * These tests mock ONLY the Google-dependent part (exchangeCodeForSession)
 * and let all DB operations hit real Supabase. This catches bugs like:
 * - #23: Redirect URL ignoring x-forwarded-host (Netlify)
 * - #22: New users redirected to choose-role instead of auto-joining as student
 *
 * Run: npx vitest tests/oauth-callback-handler.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

// ── Service client for DB setup/teardown/assertions ─────────────────────

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

const supabase = getServiceClient();

// ── Test state ──────────────────────────────────────────────────────────

const testMosqueSlug = `handler-test-${Date.now()}`;
let testMosqueId: string;

// New user — no profile, no membership
let newUserEmail: string;
let newUserId: string;

// Existing user — already has admin membership
let existingUserEmail: string;
let existingUserId: string;

// ── Setup/Teardown ──────────────────────────────────────────────────────

beforeAll(async () => {
  // Create test mosque
  const { data: mosque, error: mErr } = await supabase
    .from("mosques")
    .insert({ name: "Handler Test Mosque", slug: testMosqueSlug })
    .select()
    .single();
  if (mErr) throw new Error(mErr.message);
  testMosqueId = mosque.id;

  // New user (simulates first-time Google OAuth)
  newUserEmail = `handler-new-${Date.now()}@test.tareeqah.dev`;
  const { data: u1, error: e1 } = await supabase.auth.admin.createUser({
    email: newUserEmail,
    password: "test-password-123!",
    email_confirm: true,
    user_metadata: { full_name: "New Google User", name: "New Google User" },
  });
  if (e1) throw new Error(e1.message);
  newUserId = u1.user.id;

  // Existing admin user
  existingUserEmail = `handler-admin-${Date.now()}@test.tareeqah.dev`;
  const { data: u2, error: e2 } = await supabase.auth.admin.createUser({
    email: existingUserEmail,
    password: "test-password-123!",
    email_confirm: true,
    user_metadata: { full_name: "Existing Admin" },
  });
  if (e2) throw new Error(e2.message);
  existingUserId = u2.user.id;

  await supabase.from("profiles").upsert({
    id: existingUserId,
    full_name: "Existing Admin",
    email: existingUserEmail,
  });
  await supabase.from("mosque_memberships").insert({
    mosque_id: testMosqueId,
    profile_id: existingUserId,
    role: "mosque_admin",
  });
});

afterAll(async () => {
  await supabase
    .from("mosque_memberships")
    .delete()
    .eq("mosque_id", testMosqueId);
  await supabase.from("profiles").delete().eq("id", newUserId);
  await supabase.from("profiles").delete().eq("id", existingUserId);
  await supabase.from("mosques").delete().eq("id", testMosqueId);
  await supabase.auth.admin.deleteUser(newUserId);
  await supabase.auth.admin.deleteUser(existingUserId);
});

// ── Mock @supabase/ssr so the route handler uses our controlled client ──

// We need to mock BEFORE importing the route handler.
// The mock intercepts createServerClient and returns a client where:
//   - auth.exchangeCodeForSession() → succeeds (skips Google)
//   - auth.getUser() → returns the user we specify
//   - from() → delegates to the real service client (real DB operations)

let mockUserId: string;
let mockUserEmail: string;
let mockUserMetadata: Record<string, string>;

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      getUser: vi.fn().mockImplementation(() =>
        Promise.resolve({
          data: {
            user: {
              id: mockUserId,
              email: mockUserEmail,
              user_metadata: mockUserMetadata,
            },
          },
          error: null,
        })
      ),
    },
    from: (table: string) => supabase.from(table),
  }),
}));

// Import AFTER mocking
const { GET, getRedirectBase } = await import("@/app/auth/callback/route");
const { NextRequest } = await import("next/server");

// ── Tests ───────────────────────────────────────────────────────────────

describe("#23: x-forwarded-host redirect handling", () => {
  it("redirects to x-forwarded-host in production, not internal origin", async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    mockUserId = existingUserId;
    mockUserEmail = existingUserEmail;
    mockUserMetadata = { full_name: "Existing Admin" };

    const req = new NextRequest(
      "https://internal-netlify.app/auth/callback?code=test-code&next=/m/" +
        testMosqueSlug +
        "/dashboard&slug=" +
        testMosqueSlug,
      { headers: { "x-forwarded-host": "tareeqah.ca" } }
    );

    const response = await GET(req);

    // Should redirect to public host, NOT internal-netlify.app
    expect(response.status).toBe(307);
    const location = response.headers.get("location")!;
    expect(location).toContain("tareeqah.ca");
    expect(location).not.toContain("internal-netlify");
    expect(location).toContain(`/m/${testMosqueSlug}/dashboard`);

    process.env.NODE_ENV = origEnv;
  });

  it("falls back to origin when no x-forwarded-host", async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    mockUserId = existingUserId;
    mockUserEmail = existingUserEmail;
    mockUserMetadata = { full_name: "Existing Admin" };

    const req = new NextRequest(
      "https://tareeqah.ca/auth/callback?code=test-code&next=/m/" +
        testMosqueSlug +
        "/dashboard&slug=" +
        testMosqueSlug
    );

    const response = await GET(req);
    const location = response.headers.get("location")!;
    expect(location).toContain("tareeqah.ca");
    expect(location).toContain(`/m/${testMosqueSlug}/dashboard`);

    process.env.NODE_ENV = origEnv;
  });

  it("uses origin in development even if x-forwarded-host is set", async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    mockUserId = existingUserId;
    mockUserEmail = existingUserEmail;
    mockUserMetadata = { full_name: "Existing Admin" };

    const req = new NextRequest(
      "http://localhost:3000/auth/callback?code=test-code&next=/&slug=" +
        testMosqueSlug,
      { headers: { "x-forwarded-host": "tareeqah.ca" } }
    );

    const response = await GET(req);
    const location = response.headers.get("location")!;
    expect(location).toContain("localhost:3000");
    expect(location).not.toContain("tareeqah.ca");

    process.env.NODE_ENV = origEnv;
  });

  it("rejects absolute URLs in next param (open-redirect prevention)", async () => {
    mockUserId = existingUserId;
    mockUserEmail = existingUserEmail;
    mockUserMetadata = { full_name: "Existing Admin" };

    const req = new NextRequest(
      "http://localhost:3000/auth/callback?code=test-code&next=https://evil.com&slug=" +
        testMosqueSlug
    );

    const response = await GET(req);
    const location = response.headers.get("location")!;
    // next should have been sanitized to "/"
    expect(location).not.toContain("evil.com");
  });
});

describe("#22: redirect new OAuth user to complete-signup", () => {
  it("redirects a new user to complete-signup (not auto-create membership)", async () => {
    mockUserId = newUserId;
    mockUserEmail = newUserEmail;
    mockUserMetadata = { full_name: "New Google User", name: "New Google User" };

    const req = new NextRequest(
      `http://localhost:3000/auth/callback?code=test-code&next=/m/${testMosqueSlug}/complete-signup&slug=${testMosqueSlug}`
    );

    const response = await GET(req);

    // Should redirect to complete-signup so user can pick a role
    const location = response.headers.get("location")!;
    expect(location).toContain("complete-signup");
    expect(location).not.toContain("choose-role");

    // No membership should have been created yet
    const { data: membership } = await supabase
      .from("mosque_memberships")
      .select("role")
      .eq("profile_id", newUserId)
      .eq("mosque_id", testMosqueId)
      .maybeSingle();

    expect(membership).toBeNull();
  });

  it("upserts a profile from OAuth metadata", async () => {
    // Profile should have been created by the previous test's callback
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", newUserId)
      .single();

    expect(profile).toBeTruthy();
    expect(profile!.full_name).toBe("New Google User");
    expect(profile!.email).toBe(newUserEmail);
  });

  it("does NOT create a duplicate membership for existing admin", async () => {
    mockUserId = existingUserId;
    mockUserEmail = existingUserEmail;
    mockUserMetadata = { full_name: "Existing Admin" };

    const req = new NextRequest(
      `http://localhost:3000/auth/callback?code=test-code&next=/m/${testMosqueSlug}/dashboard&slug=${testMosqueSlug}`
    );

    const response = await GET(req);
    const location = response.headers.get("location")!;
    expect(location).toContain(`/m/${testMosqueSlug}/dashboard`);

    // Should still have exactly 1 membership, role unchanged
    const { data: memberships } = await supabase
      .from("mosque_memberships")
      .select("role")
      .eq("profile_id", existingUserId)
      .eq("mosque_id", testMosqueId);

    expect(memberships).toHaveLength(1);
    expect(memberships![0].role).toBe("mosque_admin");
  });

  it("redirects to /create-masjid for global signup with no memberships", async () => {
    // Create a truly fresh user with zero memberships anywhere
    const freshEmail = `handler-fresh-${Date.now()}@test.tareeqah.dev`;
    const { data: freshUser } = await supabase.auth.admin.createUser({
      email: freshEmail,
      password: "test-password-123!",
      email_confirm: true,
    });
    const freshId = freshUser.user!.id;

    mockUserId = freshId;
    mockUserEmail = freshEmail;
    mockUserMetadata = {};

    // No slug = global signup
    const req = new NextRequest(
      "http://localhost:3000/auth/callback?code=test-code&next=/"
    );

    const response = await GET(req);
    const location = response.headers.get("location")!;
    expect(location).toContain("/create-masjid");

    // Clean up
    await supabase.from("profiles").delete().eq("id", freshId);
    await supabase.auth.admin.deleteUser(freshId);
  });
});
