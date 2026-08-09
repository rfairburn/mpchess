// Browser integration tests: computer player
import { test, expect } from '@playwright/test';
import {
  joinGame,
  resetAndGiveUp,
  openMenu,
  closeMenu,
  makeMove2d,
  waitForMoveLog,
} from './helpers.js';

test.describe.serial('Computer player', () => {
  let page = null;
  let ctx = null;

  test.afterEach(async () => {
    if (page) {
      const joinVisible = await page
        .locator('#join-overlay')
        .isVisible()
        .catch(() => false);
      if (!joinVisible) {
        await resetAndGiveUp(page);
      }
    }
    if (ctx) await ctx.close();
    page = ctx = null;
  });

  test('Start game vs computer', async ({ browser }) => {
    ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    page = await ctx.newPage();
    await page.goto('/');

    // Join as white
    await joinGame(page, 'white');
    await expect(page.locator('#role-badge')).toContainText('White');

    // Open menu, select skill, activate computer
    await openMenu(page);
    await page.locator('#menu-computer-skill-dropdown').selectOption('beginner');
    await page.locator('#btn-menu-activate-computer').click();

    // Wait for computer activation toast
    await expect(page.locator('#error-toast')).toBeVisible({ timeout: 10000 });

    // Close menu if still open
    const menuVisible = await page
      .locator('#menu-overlay')
      .isVisible()
      .catch(() => false);
    if (menuVisible) await closeMenu(page);

    // Reopen menu to verify skill change section is visible with correct skill
    await openMenu(page);
    await expect(page.locator('#menu-skill-change-section')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#menu-computer-section')).not.toBeVisible();

    // Verify the skill dropdown shows beginner
    const skillValue = await page.locator('#menu-skill-change-dropdown').inputValue();
    expect(skillValue).toBe('beginner');

    await closeMenu(page);

    // Computer thinking should NOT be visible (it's white's turn)
    await expect(page.locator('#computer-thinking')).not.toBeVisible();
  });

  test('Computer responds to player move', async ({ browser }) => {
    ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    page = await ctx.newPage();
    await page.goto('/');

    // Join as white
    await joinGame(page, 'white');

    // Activate computer at beginner level
    await openMenu(page);
    await page.locator('#menu-computer-skill-dropdown').selectOption('beginner');
    await page.locator('#btn-menu-activate-computer').click();
    await expect(page.locator('#error-toast')).toBeVisible({ timeout: 10000 });
    const menuVisible = await page
      .locator('#menu-overlay')
      .isVisible()
      .catch(() => false);
    if (menuVisible) await closeMenu(page);

    // White makes e4
    await makeMove2d(page, 4, 1, 4, 3); // e2 → e4
    await waitForMoveLog(page, 'e4');

    // Computer should start thinking (black's turn)
    await expect(page.locator('#computer-thinking')).toBeVisible({ timeout: 30000 });

    // Computer should respond — thinking indicator hides
    await expect(page.locator('#computer-thinking')).not.toBeVisible({ timeout: 30000 });

    // Move log should show both moves (e4 and black's response)
    await expect(page.locator('#move-log')).toHaveText(/1\.\s+e4\s+\S+/, { timeout: 30000 });
  });

  test('Change computer skill mid-game', async ({ browser }) => {
    ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    page = await ctx.newPage();
    await page.goto('/');

    // Join as white
    await joinGame(page, 'white');

    // Activate computer at beginner
    await openMenu(page);
    await page.locator('#menu-computer-skill-dropdown').selectOption('beginner');
    await page.locator('#btn-menu-activate-computer').click();
    await expect(page.locator('#error-toast')).toBeVisible({ timeout: 10000 });
    const menuVisible1 = await page
      .locator('#menu-overlay')
      .isVisible()
      .catch(() => false);
    if (menuVisible1) await closeMenu(page);

    // Verify beginner skill is set
    await openMenu(page);
    let skillValue = await page.locator('#menu-skill-change-dropdown').inputValue();
    expect(skillValue).toBe('beginner');
    await closeMenu(page);

    // Open menu and change skill to advanced
    await openMenu(page);
    await page.locator('#menu-skill-change-dropdown').selectOption('advanced');
    await page.locator('#btn-menu-change-skill').click();

    // Wait for skill change confirmation toast
    await expect(page.locator('#error-toast')).toBeVisible({ timeout: 10000 });

    const menuVisible2 = await page
      .locator('#menu-overlay')
      .isVisible()
      .catch(() => false);
    if (menuVisible2) await closeMenu(page);

    // Verify skill updated to advanced
    await openMenu(page);
    skillValue = await page.locator('#menu-skill-change-dropdown').inputValue();
    expect(skillValue).toBe('advanced');
    await closeMenu(page);
  });
});
