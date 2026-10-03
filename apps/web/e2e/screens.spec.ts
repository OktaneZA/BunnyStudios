import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { signIn, unique } from './helpers';

/**
 * Screen walkthrough for visual review: every main screen, full page, at the tablet floor
 * (1024×768), a phone (390) and a desktop (1440), in both colour modes. Opt-in only:
 *   E2E_SCREENS=1 E2E_FAKE_GENERATION=1 E2E_BASE_URL=http://<lan-ip>:<port> npx playwright test -c apps/web/e2e screens.spec.ts
 * Writes PNGs and findings.json (console errors, horizontal overflow) to docs/screenshots/validation.
 */
const out = fileURLToPath(new URL('../../../docs/screenshots/validation', import.meta.url));
const findings: { screen: string; width: number; overflow: boolean; consoleErrors: string[] }[] = [];

async function shot(page: Page, name: string, errors: string[]) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  findings.push({ screen: name, width, overflow, consoleErrors: [...errors] });
  errors.length = 0;
  await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true, animations: 'disabled' });
}

test.describe('screen walkthrough', () => {
  test.skip(!process.env.E2E_SCREENS || !process.env.E2E_FAKE_GENERATION, 'opt-in: E2E_SCREENS=1 with fake generation');

  test('every screen, captured for review', async ({ page }) => {
    test.setTimeout(420_000);
    mkdirSync(out, { recursive: true });
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
    await page.setViewportSize({ width: 1024, height: 768 });

    // Sign in and the cartoon list.
    await page.goto('/');
    await shot(page, '01-sign-in', errors);
    await signIn(page, 'teen');
    await shot(page, '02-cartoons', errors);

    // A new cartoon opens Create.
    await page.getByRole('link', { name: '+ New cartoon' }).click();
    await shot(page, '03-new-cartoon', errors);
    await page.getByLabel("What's it called?").fill(unique('The Carrot Heist'));
    await page.getByRole('button', { name: 'Create cartoon' }).click();
    await expect(page).toHaveURL(/\/director$/);
    await shot(page, '04-create-empty', errors);

    await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
    await expect(page.getByLabel('Scene name', { exact: true })).toHaveValue('Scene 1');
    await page.getByLabel('Scene name', { exact: true }).fill('Tiptoe past the farmer');
    await page.getByLabel('What happens?').fill('Bunny tiptoes past the sleeping farmer and grabs a carrot.');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
    await expect(page.getByLabel('Scene name', { exact: true })).toHaveValue('Scene 2');
    await page.getByLabel('Scene name', { exact: true }).fill('The getaway');
    await page.getByLabel('What happens?').fill('Bunny runs across the field with the carrot.');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^1 Tiptoe past the farmer/ }).click();
    await shot(page, '05-create-scene', errors);

    // Characters: describe, choices, ready.
    await page.getByRole('link', { name: /^Characters:/ }).click();
    const sheet = page.getByRole('region', { name: 'Your characters' });
    await shot(page, '06-characters-empty', errors);
    await sheet.getByRole('button', { name: '+ Make a character' }).click();
    await sheet.getByLabel('What is their name?').fill('Bunny');
    await sheet.getByLabel('What do they look like?').fill('A small white rabbit with one floppy ear and a blue scarf.');
    await sheet.getByRole('button', { name: 'Make Bunny' }).click();
    await expect(sheet.getByRole('button', { name: /^Make 2 pictures · about/ })).toBeEnabled();
    await shot(page, '07-studio-describe', errors);
    await sheet.getByRole('button', { name: /^Make 2 pictures · about/ }).click();
    await expect(sheet.getByRole('radio', { name: 'Pick this one' })).toHaveCount(2, { timeout: 60_000 });
    await shot(page, '08-studio-choose', errors);
    await sheet.getByRole('radio', { name: 'Pick this one' }).first().check();
    await sheet.getByRole('button', { name: 'Use this look' }).click();
    await expect(sheet.getByRole('heading', { name: 'Bunny is ready' })).toBeVisible();
    await shot(page, '09-studio-ready', errors);
    await page.getByRole('link', { name: '← Back to Create' }).click();

    // Bunny in the scene, then a preview.
    await page.getByRole('button', { name: 'Who’s in it' }).click();
    await page.getByLabel('Add a character to this scene').selectOption({ label: 'Bunny' });
    await page.getByRole('button', { name: 'Save characters' }).click();
    await expect(page.locator('.portrait', { hasText: 'Bunny' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Make preview · about/ })).toBeEnabled();
    await shot(page, '10-composer-ready', errors);
    await page.getByRole('button', { name: /^Make preview · about/ }).click();
    await expect(page.locator('.clip-label')).toContainText('In your cartoon', { timeout: 90_000 });
    await shot(page, '11-after-preview', errors);

    // Final from the preview: the same button, now "Make final clip".
    await expect(page.getByRole('button', { name: /^Make final clip · about/ })).toBeEnabled();
    await shot(page, '12-final-from-preview', errors);
    await page.getByRole('button', { name: /^Make final clip · about/ }).click();
    await expect(page.getByText(/Other versions \(1\)/)).toBeVisible({ timeout: 90_000 });
    // The finished final is shown at once, marked new; the preview stays in the cartoon until chosen.
    await expect(page.locator('.clip-label')).toContainText('New · Not in your cartoon yet · Final');
    await expect(page.getByRole('button', { name: 'Use this clip' })).toBeVisible();
    await shot(page, '13-after-final', errors);

    // Other widths and the white theme on Create.
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await shot(page, '14-create-with-clip', errors);
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.getByText('View', { exact: true }).click();
    await page.getByRole('button', { name: /White/ }).click();
    await shot(page, '15-create-white', errors);
    await page.getByRole('button', { name: /Black/ }).click();

    // Put it together.
    await page.getByRole('navigation', { name: 'Cartoon steps' }).getByRole('link', { name: /Put it together/ }).click();
    await expect(page.getByRole('heading', { name: 'Watch your cartoon' })).toBeVisible();
    await shot(page, '16-together', errors);
    await page.getByRole('button', { name: 'Make my cartoon' }).click();
    await expect(page.getByRole('link', { name: 'Save video' })).toBeVisible({ timeout: 90_000 });
    await shot(page, '17-together-made', errors);
    await page.setViewportSize({ width: 390, height: 900 });
    await shot(page, '17-together-made', errors);
    await page.setViewportSize({ width: 1024, height: 768 });

    // The scene manager and a scene's own page, now outside the numbered steps.
    await page.getByRole('navigation', { name: 'Cartoon steps' }).getByRole('link', { name: 'Create', exact: true }).click();
    await page.getByText('View', { exact: true }).click();
    await page.getByRole('link', { name: 'Manage scenes', exact: true }).click();
    await shot(page, '18-manage-scenes', errors);
    await page.getByRole('link', { name: 'Tiptoe past the farmer', exact: true }).click();
    await shot(page, '19-scene-page', errors);

    // The adult's Grown-ups page.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn(page, 'adult');
    await page.getByRole('link', { name: /Grown-ups/ }).click();
    await shot(page, '20-grownups', errors);

    writeFileSync(`${out}/findings.json`, JSON.stringify(findings, null, 2));
  });
});
