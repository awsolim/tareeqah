import { test, expect } from '@playwright/test';
import { TEST_MOSQUE_SLUG, createTestSupabaseClient } from './helpers';

/**
 * Tests that signup flows correctly create profiles without RLS errors.
 *
 * These tests catch the "new row violates row-level security policy for table
 * profiles" bug that can occur when:
 * - INSERT/UPDATE RLS policies on profiles are missing
 * - The user session isn't established yet after signUp (email confirmation)
 * - The Supabase client uses anon key without a valid session
 */

const UNIQUE_SUFFIX = Date.now();

test.describe('Email/password signup creates profile without RLS errors', () => {
  const testEmail = `signup-test-${UNIQUE_SUFFIX}@test.tareeqah.dev`;
  const testPassword = 'test-password-123!';
  const testName = 'Signup Test User';

  test.afterAll(async () => {
    // Clean up the test user
    const supabase = createTestSupabaseClient();
    const { data: users } = await supabase.auth.admin.listUsers();
    const testUser = users?.users.find((u) => u.email === testEmail);
    if (testUser) {
      await supabase.from('mosque_memberships').delete().eq('profile_id', testUser.id);
      await supabase.from('teacher_join_requests').delete().eq('profile_id', testUser.id);
      await supabase.from('profiles').delete().eq('id', testUser.id);
      await supabase.auth.admin.deleteUser(testUser.id);
    }
  });

  test('new user can sign up and profile is created in database', async ({ page }) => {
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/signup`);

    // Select student role
    await page.locator('[data-testid="role-student"]').click();

    // Fill in signup form
    await page.getByLabel(/full name|name/i).fill(testName);
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);

    // Submit
    await page.getByRole('button', { name: /create account/i }).click();

    // Should redirect to dashboard (not show an RLS error)
    await expect(page).toHaveURL(new RegExp(`/m/${TEST_MOSQUE_SLUG}/dashboard`), {
      timeout: 15000,
    });

    // Verify profile was actually created in the database
    const supabase = createTestSupabaseClient();
    const { data: users } = await supabase.auth.admin.listUsers();
    const createdUser = users?.users.find((u) => u.email === testEmail);
    expect(createdUser).toBeTruthy();

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', createdUser!.id)
      .single();

    expect(profile).toBeTruthy();
    expect(profile!.full_name).toBe(testName);
    expect(profile!.email).toBe(testEmail);
  });

  test('new user signup as teacher creates profile + join request', async ({ page }) => {
    const teacherEmail = `signup-teacher-${UNIQUE_SUFFIX}@test.tareeqah.dev`;

    await page.goto(`/m/${TEST_MOSQUE_SLUG}/signup`);

    // Select teacher role
    await page.locator('[data-testid="role-teacher"]').click();
    await expect(page.getByText(/admin approval/i)).toBeVisible();

    // Fill in signup form
    await page.getByLabel(/full name|name/i).fill('Teacher Signup Test');
    await page.getByLabel(/email/i).fill(teacherEmail);
    await page.getByLabel(/password/i).fill(testPassword);

    // Submit
    await page.getByRole('button', { name: /create account/i }).click();

    // Should redirect to dashboard (not RLS error)
    await expect(page).toHaveURL(new RegExp(`/m/${TEST_MOSQUE_SLUG}/dashboard`), {
      timeout: 15000,
    });

    // Verify profile, membership, and teacher request exist
    const supabase = createTestSupabaseClient();
    const { data: users } = await supabase.auth.admin.listUsers();
    const createdUser = users?.users.find((u) => u.email === teacherEmail);
    expect(createdUser).toBeTruthy();

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', createdUser!.id)
      .single();
    expect(profile).toBeTruthy();

    const { data: mosque } = await supabase
      .from('mosques')
      .select('id')
      .eq('slug', TEST_MOSQUE_SLUG)
      .single();

    // Should have student membership (teachers start as student pending approval)
    const { data: membership } = await supabase
      .from('mosque_memberships')
      .select('role')
      .eq('profile_id', createdUser!.id)
      .eq('mosque_id', mosque!.id)
      .single();
    expect(membership?.role).toBe('student');

    // Should have a pending teacher join request
    const { data: joinRequest } = await supabase
      .from('teacher_join_requests')
      .select('status')
      .eq('profile_id', createdUser!.id)
      .eq('mosque_id', mosque!.id)
      .single();
    expect(joinRequest?.status).toBe('pending');

    // Clean up
    await supabase.from('teacher_join_requests').delete().eq('profile_id', createdUser!.id);
    await supabase.from('mosque_memberships').delete().eq('profile_id', createdUser!.id);
    await supabase.from('profiles').delete().eq('id', createdUser!.id);
    await supabase.auth.admin.deleteUser(createdUser!.id);
  });
});

test.describe('Signup form validation', () => {
  test('signup with empty name shows form validation', async ({ page }) => {
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/signup`);
    // Don't fill in name, fill email and password
    await page.getByLabel(/email/i).fill('empty-name@test.dev');
    await page.getByLabel(/password/i).fill('test-password-123!');
    await page.getByRole('button', { name: /create account/i }).click();

    // HTML5 validation should prevent submission (required field)
    // The page should NOT navigate away
    await expect(page).toHaveURL(new RegExp(`/m/${TEST_MOSQUE_SLUG}/signup`));
  });

  test('signup with invalid email shows form validation', async ({ page }) => {
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/signup`);
    await page.getByLabel(/full name|name/i).fill('Test User');
    await page.getByLabel(/email/i).fill('not-an-email');
    await page.getByLabel(/password/i).fill('test-password-123!');
    await page.getByRole('button', { name: /create account/i }).click();

    // HTML5 validation should prevent submission
    await expect(page).toHaveURL(new RegExp(`/m/${TEST_MOSQUE_SLUG}/signup`));
  });

  test('signup with empty password shows form validation', async ({ page }) => {
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/signup`);
    await page.getByLabel(/full name|name/i).fill('Test User');
    await page.getByLabel(/email/i).fill('empty-pass@test.dev');
    // Leave password empty
    await page.getByRole('button', { name: /create account/i }).click();

    // HTML5 validation should prevent submission
    await expect(page).toHaveURL(new RegExp(`/m/${TEST_MOSQUE_SLUG}/signup`));
  });
});
