import { test, expect } from '@playwright/test';
import {
  TEST_MOSQUE_SLUG,
  loginAsAdmin,
  loginAsTeacher,
  loginAsStudent,
  loginAsParent,
  createTestSupabaseClient,
} from './helpers';

/**
 * Payment waiver E2E tests.
 *
 * Covers user stories US-W1 through US-W5:
 *   - Admin/teacher can waive payment for accepted applications on paid programs
 *   - Waived student gets full program access
 *   - Audit trail (Waived badge on admin view)
 *   - Admin can revoke a waiver
 *
 * Pre-condition: The global-setup seeds a student with a pending application
 * to "Advanced Arabic" (paid, $25/mo). Tests that need an "accepted" state
 * update the application in beforeEach.
 */

test.describe('Payment waiver — happy path', () => {
  test.beforeEach(async () => {
    // Set the student's application to "accepted" so the waive button appears
    const supabase = createTestSupabaseClient();
    const { data: mosque } = await supabase
      .from('mosques')
      .select('id')
      .eq('slug', TEST_MOSQUE_SLUG)
      .single();

    const { data: paidProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('mosque_id', mosque!.id)
      .eq('title', 'Advanced Arabic')
      .single();

    // Update application to accepted
    await supabase
      .from('program_applications')
      .update({ status: 'accepted', reviewed_at: new Date().toISOString() })
      .eq('program_id', paidProgram!.id)
      .eq('status', 'pending');

    // Clean up any existing enrollment for the student on this program
    // (in case a previous test run left one behind)
    await supabase
      .from('enrollments')
      .delete()
      .eq('program_id', paidProgram!.id)
      .neq('student_profile_id', '00000000-0000-0000-0000-000000000001');
  });

  test.afterEach(async () => {
    // Reset: remove waived enrollments and reset application back to pending
    const supabase = createTestSupabaseClient();
    const { data: mosque } = await supabase
      .from('mosques')
      .select('id')
      .eq('slug', TEST_MOSQUE_SLUG)
      .single();

    const { data: paidProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('mosque_id', mosque!.id)
      .eq('title', 'Advanced Arabic')
      .single();

    // Delete waived enrollments (except child profile)
    await supabase
      .from('enrollments')
      .delete()
      .eq('program_id', paidProgram!.id)
      .neq('student_profile_id', '00000000-0000-0000-0000-000000000001');

    // Reset application back to pending for next test run
    await supabase
      .from('program_applications')
      .update({ status: 'pending', reviewed_at: null })
      .eq('program_id', paidProgram!.id)
      .neq('student_profile_id', '00000000-0000-0000-0000-000000000001');
  });

  test('US-W1: admin sees "Waive Payment" on accepted paid application and can waive', async ({ page }) => {
    await loginAsAdmin(page);

    // Admin manages applications from the admin program detail page
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/admin/programs`);
    await page.getByRole('heading', { name: /advanced arabic/i }).click();
    await page.waitForURL(/\/admin\/programs\//);

    // Should see the Applications section with the accepted application
    await expect(page.getByText(/applications/i).first()).toBeVisible({ timeout: 10000 });

    // Look for the Waive Payment button on the accepted application
    const waiveButton = page.getByRole('button', { name: /waive payment/i }).first();
    await expect(waiveButton).toBeVisible({ timeout: 5000 });
    await waiveButton.click();

    // After waiving, the page should refresh and the student should appear in enrolled list
    // The application should show as "joined" and the student should be enrolled
    await expect(page.getByText(/waived|enrolled/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('US-W2: teacher can waive payment for accepted application in their program', async ({ page }) => {
    await loginAsTeacher(page);
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/dashboard`);

    // Teacher dashboard shows Pending Applications section
    const advancedArabic = page.getByText(/advanced arabic/i).first();
    await expect(advancedArabic).toBeVisible({ timeout: 10000 });

    // Expand the application details
    const applicationCard = page.locator('details').filter({ hasText: /advanced arabic/i }).first();
    if (await applicationCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await applicationCard.click();
    }

    // The Waive Payment button should appear for accepted paid applications
    const waiveButton = page.getByRole('button', { name: /waive payment/i }).first();
    await expect(waiveButton).toBeVisible({ timeout: 5000 });
    await waiveButton.click();

    // The application should transition to joined state
    await expect(page.getByText(/joined|waived|enrolled/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('US-W3: waived student can access the program', async ({ page }) => {
    // First, waive payment as admin via the service client directly
    const supabase = createTestSupabaseClient();
    const { data: mosque } = await supabase
      .from('mosques')
      .select('id')
      .eq('slug', TEST_MOSQUE_SLUG)
      .single();

    const { data: paidProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('mosque_id', mosque!.id)
      .eq('title', 'Advanced Arabic')
      .single();

    // Get the student profile ID
    const { data: studentMembership } = await supabase
      .from('mosque_memberships')
      .select('profile_id')
      .eq('mosque_id', mosque!.id)
      .eq('role', 'student')
      .single();

    // Get admin profile ID
    const { data: adminMembership } = await supabase
      .from('mosque_memberships')
      .select('profile_id')
      .eq('mosque_id', mosque!.id)
      .eq('role', 'mosque_admin')
      .single();

    // Create waived enrollment directly
    await supabase.from('enrollments').upsert(
      {
        program_id: paidProgram!.id,
        student_profile_id: studentMembership!.profile_id,
        payment_waived: true,
        waived_by: adminMembership!.profile_id,
        waived_at: new Date().toISOString(),
      },
      { onConflict: 'program_id,student_profile_id' }
    );

    // Update application to joined
    await supabase
      .from('program_applications')
      .update({ status: 'joined' })
      .eq('program_id', paidProgram!.id)
      .eq('student_profile_id', studentMembership!.profile_id);

    // Now log in as student and verify access
    await loginAsStudent(page);
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/programs/${paidProgram!.id}`);

    // Student should see "Enrolled" badge and "Go to Class"
    await expect(page.getByText(/enrolled/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /go to class/i })).toBeVisible();
  });

  test('US-W4: admin sees "Waived" badge on admin program detail', async ({ page }) => {
    // Set up a waived enrollment via service client
    const supabase = createTestSupabaseClient();
    const { data: mosque } = await supabase
      .from('mosques')
      .select('id')
      .eq('slug', TEST_MOSQUE_SLUG)
      .single();

    const { data: paidProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('mosque_id', mosque!.id)
      .eq('title', 'Advanced Arabic')
      .single();

    const { data: studentMembership } = await supabase
      .from('mosque_memberships')
      .select('profile_id')
      .eq('mosque_id', mosque!.id)
      .eq('role', 'student')
      .single();

    const { data: adminMembership } = await supabase
      .from('mosque_memberships')
      .select('profile_id')
      .eq('mosque_id', mosque!.id)
      .eq('role', 'mosque_admin')
      .single();

    await supabase.from('enrollments').upsert(
      {
        program_id: paidProgram!.id,
        student_profile_id: studentMembership!.profile_id,
        payment_waived: true,
        waived_by: adminMembership!.profile_id,
        waived_at: new Date().toISOString(),
      },
      { onConflict: 'program_id,student_profile_id' }
    );

    await supabase
      .from('program_applications')
      .update({ status: 'joined' })
      .eq('program_id', paidProgram!.id)
      .eq('student_profile_id', studentMembership!.profile_id);

    // Log in as admin and navigate to admin program detail
    await loginAsAdmin(page);
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/admin/programs`);
    await page.getByRole('heading', { name: /advanced arabic/i }).click();

    // Should see the student listed with a "Waived" badge
    await expect(page.getByText(/waived/i)).toBeVisible({ timeout: 10000 });
  });

  test('US-W5: admin can revoke a waiver', async ({ page }) => {
    // Set up a waived enrollment
    const supabase = createTestSupabaseClient();
    const { data: mosque } = await supabase
      .from('mosques')
      .select('id')
      .eq('slug', TEST_MOSQUE_SLUG)
      .single();

    const { data: paidProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('mosque_id', mosque!.id)
      .eq('title', 'Advanced Arabic')
      .single();

    const { data: studentMembership } = await supabase
      .from('mosque_memberships')
      .select('profile_id')
      .eq('mosque_id', mosque!.id)
      .eq('role', 'student')
      .single();

    const { data: adminMembership } = await supabase
      .from('mosque_memberships')
      .select('profile_id')
      .eq('mosque_id', mosque!.id)
      .eq('role', 'mosque_admin')
      .single();

    await supabase.from('enrollments').upsert(
      {
        program_id: paidProgram!.id,
        student_profile_id: studentMembership!.profile_id,
        payment_waived: true,
        waived_by: adminMembership!.profile_id,
        waived_at: new Date().toISOString(),
      },
      { onConflict: 'program_id,student_profile_id' }
    );

    await supabase
      .from('program_applications')
      .update({ status: 'joined' })
      .eq('program_id', paidProgram!.id)
      .eq('student_profile_id', studentMembership!.profile_id);

    // Log in as admin
    await loginAsAdmin(page);
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/admin/programs`);
    await page.getByRole('heading', { name: /advanced arabic/i }).click();

    // Find and click "Revoke Waiver" button
    const revokeButton = page.getByRole('button', { name: /revoke waiver/i }).first();
    await expect(revokeButton).toBeVisible({ timeout: 10000 });
    await revokeButton.click();

    // After revoking, the student should no longer be listed as enrolled
    // or the "Waived" badge should disappear
    await expect(page.getByText(/no students are enrolled/i)).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Payment waiver — guards and validation', () => {
  test('"Waive Payment" does NOT appear for free programs', async ({ page }) => {
    await loginAsTeacher(page);
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/dashboard`);

    // The free program (Free Quran Studies) should not have a "Waive Payment" button
    // even if there are applications for it. Student is already enrolled in the free program.
    // Check that no waive button appears near free program context
    const waiveButtons = page.getByRole('button', { name: /waive payment/i });
    // If any waive buttons exist, none should be associated with the free program
    const freeCard = page.locator('details').filter({ hasText: /free quran studies/i });
    if (await freeCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await freeCard.click();
      const waiveInFree = freeCard.getByRole('button', { name: /waive payment/i });
      await expect(waiveInFree).not.toBeVisible();
    }
  });

  test('"Waive Payment" does NOT appear for pending applications', async ({ page }) => {
    // The seed data has a pending application for Advanced Arabic
    // Do NOT set it to accepted — leave it as pending
    await loginAsTeacher(page);
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/dashboard`);

    // Find the Advanced Arabic application card
    const applicationCard = page.locator('details').filter({ hasText: /advanced arabic/i }).first();
    if (await applicationCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await applicationCard.click();
      // Should see Accept/Reject buttons but NOT Waive Payment
      await expect(applicationCard.getByRole('button', { name: /accept/i })).toBeVisible();
      await expect(applicationCard.getByRole('button', { name: /waive payment/i })).not.toBeVisible();
    }
  });

  test('"Waive Payment" does NOT appear for already-enrolled students', async ({ page }) => {
    // Create a waived enrollment first, then check the dashboard
    const supabase = createTestSupabaseClient();
    const { data: mosque } = await supabase
      .from('mosques')
      .select('id')
      .eq('slug', TEST_MOSQUE_SLUG)
      .single();

    const { data: paidProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('mosque_id', mosque!.id)
      .eq('title', 'Advanced Arabic')
      .single();

    const { data: studentMembership } = await supabase
      .from('mosque_memberships')
      .select('profile_id')
      .eq('mosque_id', mosque!.id)
      .eq('role', 'student')
      .single();

    const { data: adminMembership } = await supabase
      .from('mosque_memberships')
      .select('profile_id')
      .eq('mosque_id', mosque!.id)
      .eq('role', 'mosque_admin')
      .single();

    // Enroll the student with a waiver
    await supabase.from('enrollments').upsert(
      {
        program_id: paidProgram!.id,
        student_profile_id: studentMembership!.profile_id,
        payment_waived: true,
        waived_by: adminMembership!.profile_id,
        waived_at: new Date().toISOString(),
      },
      { onConflict: 'program_id,student_profile_id' }
    );

    await supabase
      .from('program_applications')
      .update({ status: 'joined' })
      .eq('program_id', paidProgram!.id)
      .eq('student_profile_id', studentMembership!.profile_id);

    await loginAsTeacher(page);
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/dashboard`);

    // The application should show as "joined", not "accepted",
    // so no Waive Payment button should appear
    const applicationCard = page.locator('details').filter({ hasText: /advanced arabic/i }).first();
    if (await applicationCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await applicationCard.click();
      await expect(applicationCard.getByRole('button', { name: /waive payment/i })).not.toBeVisible();
    }

    // Clean up
    await supabase
      .from('enrollments')
      .delete()
      .eq('program_id', paidProgram!.id)
      .eq('student_profile_id', studentMembership!.profile_id);

    await supabase
      .from('program_applications')
      .update({ status: 'pending', reviewed_at: null })
      .eq('program_id', paidProgram!.id)
      .eq('student_profile_id', studentMembership!.profile_id);
  });

  test('student cannot see waive payment controls', async ({ page }) => {
    await loginAsStudent(page);
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/dashboard`);

    // Student dashboard doesn't show application management controls
    await expect(page.getByRole('button', { name: /waive payment/i })).not.toBeVisible();
  });

  test('parent cannot see waive payment controls', async ({ page }) => {
    await loginAsParent(page);
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/dashboard`);

    // Parent dashboard doesn't show application management controls
    await expect(page.getByRole('button', { name: /waive payment/i })).not.toBeVisible();
  });
});
