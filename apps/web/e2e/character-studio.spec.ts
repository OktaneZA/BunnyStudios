import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { signIn, createCartoon, addScene, unique } from './helpers';

/**
 * Character Studio end to end (docs/character-studio-requirements.md §8), against a server
 * with fake generation. Proves the flow and the wording, not what a real model draws.
 */
test.describe('Character Studio', () => {
  test('make a character, choose a look, add a view, then a preview and a final with that look', async ({ page }) => {
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

    // 1. Make a character.
    await page.getByRole('button', { name: /^Cast ·/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: '+ Make a character' }).click();
    await sheet.getByLabel('What is their name?').fill('Bunny');
    await sheet.getByLabel('What do they look like?').fill('A small white rabbit with one floppy ear and a blue scarf.');
    await sheet.getByRole('button', { name: 'Make Bunny' }).click();
    await expect(sheet.getByText('No look chosen yet')).toBeVisible();

    // 2. Make choices: pictures arrive as candidates, nothing is chosen for you.
    await sheet.getByRole('button', { name: /^Make 2 pictures · about/ }).click();
    await expect(sheet.getByRole('radio', { name: 'Pick this one' })).toHaveCount(2, { timeout: 60_000 });
    await expect(sheet.getByText('No look chosen yet')).toBeVisible();
    await expect(sheet.getByText('Made for you · not chosen yet').first()).toBeVisible();
    await page.screenshot({ path: `${shots}/01-choices.png`, fullPage: true });

    // "This looks like Bunny" approves look 1.
    await sheet.getByRole('radio', { name: 'Pick this one' }).first().check();
    await sheet.getByRole('button', { name: 'This looks like Bunny' }).click();
    await expect(sheet.getByText('Look 1 chosen')).toBeVisible();

    // 3. A side view, made from the chosen picture, then "Use these pictures" makes look 2.
    await sheet.getByRole('button', { name: 'From the side' }).click();
    await expect(sheet.getByRole('checkbox', { name: 'Add' })).toHaveCount(1, { timeout: 60_000 });
    await sheet.getByRole('checkbox', { name: 'Add' }).check();
    await sheet.getByRole('button', { name: 'Use these pictures' }).click();
    await expect(sheet.getByText('Look 2 chosen')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Use this look again' })).toBeVisible();
    await page.screenshot({ path: `${shots}/02-look-approved.png`, fullPage: true });
    await page.keyboard.press('Escape');

    // 4. Bunny is in this scene, with look 2.
    const production = page.locator('section.production');
    await production.getByLabel('Add a character to this scene').selectOption({ label: 'Bunny' });
    await production.getByRole('button', { name: /^(Save who is in this scene|Yes, these are in this scene)$/ }).click();
    await expect(production.getByText('look 2')).toBeVisible();
    const preview = production.getByRole('button', { name: /^Quick preview · about/ });
    await expect(preview).toBeEnabled();
    await expect(production.getByRole('button', { name: /^Make final video · about/ })).toBeVisible();
    await page.screenshot({ path: `${shots}/03-scene-with-bunny.png`, fullPage: true });

    // 5. A quick preview, then the final from the same recipe.
    await preview.click();
    await expect(page.locator('.take-kind', { hasText: 'Preview' })).toBeVisible({ timeout: 90_000 });
    const fromPreview = production.getByRole('button', { name: /^Make final video from the preview · about/ });
    await expect(fromPreview).toBeVisible();
    await fromPreview.click();
    await expect(page.locator('.take-kind', { hasText: 'Final' })).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: `${shots}/04-preview-and-final.png`, fullPage: true });
  });
});
