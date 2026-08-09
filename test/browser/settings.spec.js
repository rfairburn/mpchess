// Browser integration tests: settings persistence
import { test, expect } from '@playwright/test';
import { joinGame, openMenu, closeMenu, resetAndGiveUp } from './helpers.js';

test.describe.serial('Settings persistence', () => {
  test.afterEach(async ({ page }) => {
    const joinVisible = await page.locator('#join-overlay').isVisible();
    if (!joinVisible) {
      await resetAndGiveUp(page);
    }
  });

  test('Mouse sensitivity persists across reload', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load and join as white
    await expect(page.locator('#join-overlay')).toBeVisible({ timeout: 10000 });
    await joinGame(page, 'white');

    // Open menu then settings
    await openMenu(page);
    await page.locator('#btn-settings').click();
    await expect(page.locator('#settings-overlay')).toBeVisible({ timeout: 5000 });

    // Read initial slider value
    const initialValue = await page.locator('#sensitivity-slider').inputValue();

    // Change sensitivity slider to a different value
    const newValue = initialValue === '50' ? '80' : '50';
    await page.locator('#sensitivity-slider').fill(newValue);
    await expect(page.locator('#sensitivity-value')).toContainText(newValue, { timeout: 3000 });

    // Close settings and menu
    await page.locator('#btn-settings-close').click();
    const menuVisible = await page.locator('#menu-overlay').isVisible();
    if (menuVisible) {
      await closeMenu(page);
    }

    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Wait for the app to reinitialize and rejoin
    await expect(page.locator('#join-overlay')).toBeVisible({ timeout: 10000 });
    await joinGame(page, 'white');

    // Open menu then settings again
    await openMenu(page);
    await page.locator('#btn-settings').click();
    await expect(page.locator('#settings-overlay')).toBeVisible({ timeout: 5000 });

    // Verify the slider persisted the new value
    const persistedValue = await page.locator('#sensitivity-slider').inputValue();
    expect(persistedValue).toBe(newValue);

    // Close settings and menu
    await page.locator('#btn-settings-close').click();
    const menuStillVisible = await page.locator('#menu-overlay').isVisible();
    if (menuStillVisible) {
      await closeMenu(page);
    }
  });

  test('Language change updates UI', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load and join as white
    await expect(page.locator('#join-overlay')).toBeVisible({ timeout: 10000 });
    await joinGame(page, 'white');

    // Open menu then settings
    await openMenu(page);
    await page.locator('#btn-settings').click();
    await expect(page.locator('#settings-overlay')).toBeVisible({ timeout: 5000 });

    // Change language to German
    await page.locator('#select-language').selectOption('de');

    // Close settings
    await page.locator('#btn-settings-close').click();

    // Close menu and reopen to see translated text
    const menuVisible = await page.locator('#menu-overlay').isVisible();
    if (menuVisible) {
      await closeMenu(page);
    }

    // Reopen menu to verify translated text
    await openMenu(page);

    // Verify the settings button text is in German ("Einstellungen")
    await expect(page.locator('#btn-settings')).toContainText('Einstellungen', {
      timeout: 5000,
    });

    // Close menu
    await closeMenu(page);

    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Wait for the app to reinitialize and rejoin
    await expect(page.locator('#join-overlay')).toBeVisible({ timeout: 10000 });
    await joinGame(page, 'white');

    // Open menu and verify language persisted
    await openMenu(page);
    await expect(page.locator('#btn-settings')).toContainText('Einstellungen', {
      timeout: 5000,
    });

    // Close menu
    await closeMenu(page);
  });
});
