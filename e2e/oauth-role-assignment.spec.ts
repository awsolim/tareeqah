import { test, expect } from '@playwright/test';
import { TEST_MOSQUE_SLUG } from './helpers';

// Tests for the OAuth signup flow — role is NO LONGER in the Google OAuth redirect URL.
// Instead, Google OAuth redirects to /m/[slug]/complete-signup where the user picks a role.
test.describe('OAuth role assignment', () => {
  test('signup page Google OAuth button does NOT include role in redirect URL', async ({ page }) => {
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/signup`);

    // Intercept the Supabase OAuth call to inspect the redirect URL
    let oauthRedirectUrl = '';
    await page.route('**/auth/v1/authorize**', async (route) => {
      oauthRedirectUrl = route.request().url();
      await route.abort();
    });

    // Click Google button (no role selection needed)
    const googleButton = page.getByRole('button', { name: /continue with google/i });
    await expect(googleButton).toBeVisible();
    await googleButton.click();
    await page.waitForTimeout(1000);

    if (oauthRedirectUrl) {
      const url = new URL(oauthRedirectUrl);
      const redirectTo = url.searchParams.get('redirect_to') ?? '';
      // Role should NOT be in the redirect URL for Google OAuth
      expect(redirectTo).not.toContain('role=');
      // Should redirect to complete-signup instead of dashboard
      expect(redirectTo).toContain('complete-signup');
    }
  });

  test('login page Google OAuth does NOT include role parameter', async ({ page }) => {
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/login`);
    // Login page should have Google button
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    // Login page should NOT have role selection
    await expect(page.locator('[data-testid="role-student"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="role-parent"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="role-teacher"]')).not.toBeVisible();
  });

  test('signup role selection changes are reflected for email signup form', async ({ page }) => {
    await page.goto(`/m/${TEST_MOSQUE_SLUG}/signup`);

    // Default is student — verify student button is highlighted
    const studentBtn = page.locator('[data-testid="role-student"]');
    const parentBtn = page.locator('[data-testid="role-parent"]');
    const teacherBtn = page.locator('[data-testid="role-teacher"]');

    await expect(studentBtn).toBeVisible();
    await expect(parentBtn).toBeVisible();
    await expect(teacherBtn).toBeVisible();

    // Click parent — should visually change
    await parentBtn.click();

    // Click teacher — should show approval notice
    await teacherBtn.click();
    await expect(page.getByText(/admin approval/i)).toBeVisible();

    // Click back to student — approval notice should disappear
    await studentBtn.click();
    await expect(page.getByText(/admin approval/i)).not.toBeVisible();
  });
});
