import { test, expect } from '@playwright/test';
import { signIn, createCartoon, addPage, openPage, unique } from './helpers';

/**
 * The same characters and one look in every scene (docs/video-optimisation-plan.md §6–§7),
 * against a server with fake generation. Screenshots land in .playwright-results for review.
 */
test.describe('Continuity', () => {
  test('a words-only clip says so, the cartoon check lists it, and a new look is offered for every scene', async ({ page }) => {
    test.skip(!process.env.E2E_FAKE_GENERATION, 'needs fake generation');
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1024, height: 768 });
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E continuity'));
    await addPage(page, 'Bunny hops');
    await page.getByLabel('What happens?').fill('Bunny hops onto a log by the pond.');
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
    await addPage(page, 'Bunny waves');
    await openPage(page, 'Bunny hops');

    // A character with a chosen look, in both scenes.
    await page.getByRole('button', { name: 'Cover', exact: true }).click();
    await page.getByRole('button', { name: '+ Add a character' }).click();
    const sheet = page.getByRole('dialog', { name: 'Your characters' });
    await sheet.getByRole('button', { name: '+ Make a character' }).click();
    await sheet.getByLabel('What is their name?').fill('Bunny');
    await sheet.getByLabel('What do they look like?').fill('A small white rabbit with a blue scarf.');
    await sheet.getByRole('button', { name: 'Make Bunny' }).click();
    await sheet.getByRole('button', { name: /^Make 2 pictures · about/ }).click();
    await expect(sheet.getByRole('radio', { name: 'Pick this one' })).toHaveCount(2, { timeout: 60_000 });
    await sheet.getByRole('radio', { name: 'Pick this one' }).first().check();
    await sheet.getByRole('button', { name: 'Use this look' }).click();
    await expect(sheet.getByText('Using this look')).toBeVisible();
    await page.keyboard.press('Escape');
    for (const scene of ['Bunny hops', 'Bunny waves']) {
      await openPage(page, scene);
      await page.getByRole('button', { name: 'Who’s in it' }).click();
      await page.getByLabel('Add a character to this scene').selectOption({ label: 'Bunny' });
      await page.getByRole('button', { name: 'Save characters' }).click();
      await expect(page.locator('.scene-faces img')).toHaveCount(1);
    }
    await openPage(page, 'Bunny hops');

    // The whole cartoon has one look, on the cover; a page only speaks up with a look of its own.
    await expect(page.locator('.composer-field').filter({ has: page.locator('.label-text', { hasText: /^Look$/ }) })).toHaveCount(0);

    // Words only is an explicit choice, and the screen says what it means before and after.
    await page.getByText('More options', { exact: true }).click();
    await page.getByLabel(/Make it from the words only/).check();
    await page.getByText('More options', { exact: true }).click();
    await expect(page.getByText(/Made from the words only: Bunny may not look like their picture/)).toBeVisible();
    await page.screenshot({ path: '.playwright-results/continuity-01-words-only.png', fullPage: true });
    await page.getByRole('button', { name: /^Make preview · about/ }).click();
    await expect(page.locator('.clip-label')).toContainText('Made from words only', { timeout: 90_000 });

    // Watch lists what may not match, with a way back to the page.
    await page.getByRole('link', { name: '▶ Watch cartoon' }).click();
    const check = page.getByRole('region', { name: 'Things that may not match' });
    await expect(check).toContainText('scene 1 was made from the words only');
    await expect(check.getByRole('link', { name: 'Open scene 1' })).toBeVisible();
    await page.screenshot({ path: '.playwright-results/continuity-02-together.png', fullPage: true });

    // A new look for Bunny is offered for every scene; nothing changes until it is chosen.
    await page.getByRole('link', { name: '← Back to your story' }).click();
    await page.getByRole('button', { name: 'Cover', exact: true }).click();
    await page.getByRole('button', { name: /^Bunny: .* Open Bunny’s sheet$/ }).click();
    await sheet.getByRole('button', { name: /Change how Bunny looks/ }).click();
    await sheet.getByRole('button', { name: /^Make 2 pictures · about/ }).click();
    // The earlier picture that was not chosen is still offered, next to the two new ones.
    await expect(sheet.getByRole('radio', { name: 'Pick this one' })).toHaveCount(3, { timeout: 60_000 });
    await sheet.getByRole('radio', { name: 'Pick this one' }).last().check();
    await sheet.getByRole('button', { name: 'Use this look' }).click();
    const offer = sheet.getByRole('region', { name: 'Use this look in every scene' });
    await expect(offer).toContainText(/still use.? an earlier look of Bunny/);
    await page.screenshot({ path: '.playwright-results/continuity-03-new-look.png', fullPage: true });
    await offer.getByRole('button', { name: 'Use this look in every scene' }).click();
    await expect(sheet.getByText(/Bunny now uses this look in/)).toBeVisible();
    await expect(offer).toHaveCount(0);
  });
});
