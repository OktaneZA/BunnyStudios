import { test, expect } from '@playwright/test';
import { addPage, createCartoon, signIn } from './helpers';

test.describe('your characters', () => {
  test.skip(!process.env.E2E_FAKE_GENERATION, 'needs the fake picture maker to choose a look');

  test('a character with a chosen look is offered in the next cartoon and on the library page, with the same picture', async ({ page }) => {
    await signIn(page, 'teen');
    const stamp = Date.now().toString(36);
    await createCartoon(page, `Pond ${stamp}`);
    await addPage(page, 'Bunny hops');

    // Bunny gets a look in the first cartoon.
    await page.getByRole('button', { name: 'Cover', exact: true }).click();
    await page.getByRole('button', { name: '+ Add a character' }).click();
    const sheet = page.getByRole('dialog', { name: 'Your characters' });
    await sheet.getByRole('button', { name: '+ Add a character' }).click();
    await sheet.getByRole('tab', { name: 'New character' }).click();
    await sheet.getByLabel('What is their name?').fill(`Bunny ${stamp}`);
    await sheet.getByLabel('What do they look like?').fill('A small white rabbit with a blue scarf.');
    await sheet.getByRole('button', { name: `Make Bunny ${stamp}` }).click();
    await sheet.getByRole('button', { name: /^Make 2 pictures · about/ }).click();
    await expect(sheet.getByRole('radio', { name: 'Pick this one' })).toHaveCount(2, { timeout: 60_000 });
    await sheet.getByRole('radio', { name: 'Pick this one' }).first().check();
    await sheet.getByRole('button', { name: 'Use this look' }).click();
    await expect(sheet.getByText('Using this look')).toBeVisible();
    const face = await sheet.locator('.cast-chip img.cast-face').first().getAttribute('src');
    await page.keyboard.press('Escape');

    // The library page lists them once, with "Use in…".
    await page.getByRole('link', { name: '← My cartoons' }).click();
    await page.getByRole('link', { name: 'Your characters' }).click();
    const card = page.locator('.library-card', { hasText: `Bunny ${stamp}` });
    await expect(card).toHaveCount(1);
    await expect(card.getByText(`In Pond ${stamp}`)).toBeVisible();
    await expect(card.getByText(/Look chosen/)).toBeVisible();

    // A second cartoon: add from your characters, and the same picture arrives.
    await page.getByRole('link', { name: '← My cartoons' }).click();
    await createCartoon(page, `Camping ${stamp}`);
    await page.getByRole('button', { name: '+ Add a character' }).click();
    const sheet2 = page.getByRole('dialog', { name: 'Your characters' });
    await sheet2.getByRole('button', { name: '+ Add a character' }).click();
    await sheet2.getByRole('tab', { name: 'From your characters' }).click();
    await sheet2.getByRole('button', { name: `Add Bunny ${stamp}` }).click();
    const chip = sheet2.locator('.cast-chip', { hasText: `Bunny ${stamp}` });
    await expect(chip).toBeVisible();
    await expect(chip.getByText('Look chosen')).toBeVisible();
    expect(await chip.locator('img.cast-face').getAttribute('src')).toBe(face);
    // Already here: the library tab no longer offers a second copy.
    await sheet2.getByRole('button', { name: '+ Add a character' }).click();
    await sheet2.getByRole('tab', { name: 'From your characters' }).click();
    await expect(sheet2.getByRole('button', { name: `Add Bunny ${stamp}` })).toHaveCount(0);
  });
});
