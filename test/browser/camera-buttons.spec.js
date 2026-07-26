// Browser integration test: camera buttons always visible
//
// Validates that #camera-positions is always visible (display !== 'none')
// across mobile portrait, mobile landscape, and both Piece and Camera modes.
// This catches CSS regressions where a media query or rule hides the element.

import { test, expect } from '@playwright/test';

const viewports = [
  { label: 'mobile portrait', width: 390, height: 844 },
  { label: 'mobile landscape', width: 844, height: 390 },
];

for (const vp of viewports) {
  test(`camera buttons visible in ${vp.label}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/');

    // Wait for the app to load
    await page.waitForSelector('#camera-positions', { state: 'attached' });

    // Hide overlays that block interaction
    await page.evaluate(() => {
      for (const id of ['connection-error-overlay', 'join-overlay']) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      }
    });

    // Check visibility in default Piece Mode
    let display = await page.evaluate(() => {
      const el = document.getElementById('camera-positions');
      return el ? getComputedStyle(el).display : 'missing';
    });
    expect(display, `${vp.label} Piece Mode display`).not.toBe('none');
    expect(display, `${vp.label} Piece Mode display`).not.toBe('');

    // Toggle into Camera Mode
    const modeToggle = page.locator('#btn-mode-toggle, #mouse-mode').first();
    await modeToggle.click();
    await page.waitForTimeout(200);

    // Check visibility in Camera Mode
    display = await page.evaluate(() => {
      const el = document.getElementById('camera-positions');
      return el ? getComputedStyle(el).display : 'missing';
    });
    expect(display, `${vp.label} Camera Mode display`).not.toBe('none');
    expect(display, `${vp.label} Camera Mode display`).not.toBe('');
  });
}

test('touch-action: none on joystick surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');

  await page.waitForSelector('#virtual-joystick', { state: 'attached' });

  // Hide overlays
  await page.evaluate(() => {
    for (const id of ['connection-error-overlay', 'join-overlay']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
  });

  const touchActions = await page.evaluate(() => {
    const ids = ['virtual-joystick', 'virtual-look-area', 'vertical-joystick'];
    const result = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      result[id] = el ? getComputedStyle(el).touchAction : 'missing';
    }
    return result;
  });

  for (const [id, val] of Object.entries(touchActions)) {
    expect(val, `${id} touch-action`).toBe('none');
  }
});
