import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { signIn, createCartoon, addScene, unique } from './helpers';

/**
 * Character Studio and the scene composer end to end (docs/character-studio-requirements.md §8,
 * docs/teen-ui-review.md), against a server with fake generation. Proves the flow and the
 * wording, not what a real model draws.
 */
test.describe('Character Studio', () => {
  test('describe a character, use a look, add an angle, then a preview, a final and another version', async ({ page }) => {
    test.skip(!process.env.E2E_FAKE_GENERATION, 'needs a server started with GENERATION_FAKE=on');
    test.setTimeout(240_000);
    const shots = fileURLToPath(new URL('../../../docs/screenshots/studio', import.meta.url));
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E studio'));
    await addScene(page, 'Carrot heist');
    await page.getByRole('link', { name: 'Carrot heist', exact: true }).click();
    await page.getByLabel('Scene description').fill('Bunny tiptoes past the sleeping farmer and grabs a carrot.');
    await page.getByRole('link', { name: /All scenes/ }).click();
    await page.getByRole('navigation', { name: 'Cartoon steps' }).getByRole('link', { name: 'Make clips', exact: true }).click();

    // 1. Describe.
    await page.getByRole('button', { name: /^Characters ·/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Your characters' });
    await sheet.getByRole('button', { name: '+ Make a character' }).click();
    await sheet.getByLabel('What is their name?').fill('Bunny');
    await sheet.getByLabel('What do they look like?').fill('A small white rabbit with one floppy ear and a blue scarf.');
    await sheet.getByRole('button', { name: 'Make Bunny' }).click();
    await expect(sheet.getByText('No look chosen yet')).toBeVisible();

    // 2. Choose a picture: pictures arrive as ideas, nothing is chosen for you.
    await sheet.getByRole('button', { name: /^Make 2 pictures · about/ }).click();
    await expect(sheet.getByRole('radio', { name: 'Pick this one' })).toHaveCount(2, { timeout: 60_000 });
    await expect(sheet.getByText('No look chosen yet')).toBeVisible();
    await page.screenshot({ path: `${shots}/01-choices.png`, fullPage: true });
    await sheet.getByRole('radio', { name: 'Pick this one' }).first().check();
    await sheet.getByRole('button', { name: 'Use this look' }).click();

    // 3. Ready: optional angles and earlier looks are folded away.
    await expect(sheet.getByRole('heading', { name: 'Bunny is ready' })).toBeVisible();
    await sheet.getByText('Add more angles (optional)').click();
    await sheet.getByRole('button', { name: 'From the side' }).click();
    await expect(sheet.getByRole('checkbox', { name: 'Add' })).toHaveCount(1, { timeout: 60_000 });
    await sheet.getByRole('checkbox', { name: 'Add' }).check();
    await sheet.getByRole('button', { name: 'Add these angles' }).click();
    await sheet.getByText('Earlier looks (1)').click();
    await expect(sheet.getByRole('button', { name: 'Use this look again' })).toBeVisible();
    await page.screenshot({ path: `${shots}/02-ready.png`, fullPage: true });
    await page.keyboard.press('Escape');

    // 4. Bunny is in the scene; the chosen look is used automatically.
    await page.getByRole('button', { name: 'Edit characters' }).click();
    await page.getByLabel('Add a character to this scene').selectOption({ label: 'Bunny' });
    await page.getByRole('button', { name: 'Save characters' }).click();
    await expect(page.locator('.portrait', { hasText: 'Bunny' })).toContainText('Using your chosen look');
    const main = page.getByRole('button', { name: /^Make preview · about/ });
    await expect(main).toBeEnabled();
    await page.screenshot({ path: `${shots}/03-composer.png`, fullPage: true });

    // 5. One action: a preview, then the final from it.
    await main.click();
    await expect(page.locator('.clip-label')).toContainText('In your cartoon · Preview', { timeout: 90_000 });
    await page.getByRole('button', { name: 'Final', exact: true }).click();
    const final = page.getByRole('button', { name: /^Make final clip · about/ });
    await expect(final).toBeEnabled();
    await expect(page.getByText(/Makes a new video from your preview/)).toBeVisible();
    await final.click();
    await expect(page.getByText('Other versions (1)')).toBeVisible({ timeout: 90_000 });

    // 6. Another version keeps the clip's recipe and asks for a fresh price first.
    await page.getByRole('button', { name: 'Make another version', exact: true }).click();
    await page.getByLabel('What should be different? (optional)').fill('Make it snow.');
    await expect(page.getByRole('button', { name: /^Make another version · about/ })).toBeEnabled();
    await page.screenshot({ path: `${shots}/04-clips.png`, fullPage: true });
  });
});
