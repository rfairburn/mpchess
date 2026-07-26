// Browser integration test: camera buttons visible in compact landscape Camera Mode
//
// Validates that #camera-positions remains visible (display !== 'none') when
// Camera Mode is activated under a coarse-pointer compact landscape viewport.
// This catches CSS regressions where a media query unconditionally hides the
// element, overriding the JavaScript .visible class.

import { test, expect } from '@playwright/test';

test('camera buttons visible in compact landscape Camera Mode', async ({ page }) => {
  // Navigate to the production page
  await page.goto('/');

  // Wait for the app to load
  await page.waitForSelector('#camera-positions', { state: 'attached' });

  // Hide the connection error overlay via JS so it doesn't block clicks
  // (the server cannot connect to a game server in this test environment)
  await page.evaluate(() => {
    const overlay = document.getElementById('connection-error-overlay');
    if (overlay) overlay.style.display = 'none';
    const joinOverlay = document.getElementById('join-overlay');
    if (joinOverlay) joinOverlay.style.display = 'none';
  });

  // Enter Camera Mode by clicking the mode toggle button
  // (top bar on mobile, or #mouse-mode on desktop)
  const modeToggle = page.locator('#btn-mode-toggle, #mouse-mode').first();
  await modeToggle.click();

  // Wait for camera buttons to become visible
  await page.waitForSelector('#camera-positions.visible', { timeout: 5000 });

  // Assert computed display is not 'none'
  const display = await page.evaluate(() => {
    const el = document.getElementById('camera-positions');
    return el ? getComputedStyle(el).display : 'missing';
  });

  expect(display, 'camera-positions display in Camera Mode').not.toBe('none');
  expect(display, 'camera-positions display in Camera Mode').not.toBe('');
});
