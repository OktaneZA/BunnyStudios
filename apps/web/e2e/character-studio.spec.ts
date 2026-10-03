import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { signIn, createCartoon, addPage, openPage, unique } from './helpers';

/**
 * Character Studio and the scene composer end to end (docs/character-studio-requirements.md §8,
 * docs/teen-ui-review.md), against a server with fake generation. Proves the flow and the
 * wording, not what a real model draws.
 */
test.describe('Character Studio', () => {
  test('approving a missing look from a scene refreshes its portrait on return', async ({ page }) => {
    test.skip(!process.env.E2E_FAKE_GENERATION, 'needs fake generation');
    test.setTimeout(120_000);
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E portrait refresh'));
    await addPage(page, 'Fox runs');
    await page.getByLabel('What happens?').fill('Fox runs through the garden.');
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Cover', exact: true }).click();
    await page.getByRole('button', { name: '+ Add a character' }).click();
    const sheet = page.getByRole('dialog', { name: 'Your characters' });
    await sheet.getByRole('button', { name: '+ Make a character' }).click();
    await sheet.getByLabel('What is their name?').fill('Fox');
    await sheet.getByLabel('What do they look like?').fill('An orange fox wearing a green scarf.');
    await sheet.getByRole('button', { name: 'Make Fox' }).click();
    await expect(sheet.getByText('No look chosen yet')).toBeVisible();
    await page.keyboard.press('Escape');
    await openPage(page, 'Fox runs');
    await page.getByRole('button', { name: 'Who’s in it' }).click();
    await page.getByLabel('Add a character to this scene').selectOption({ label: 'Fox' });
    await page.getByRole('button', { name: 'Save characters' }).click();
    // Fox has no look yet: the scene says so, and the link goes to the Characters page.
    await page.getByRole('button', { name: 'Choose Fox’s look' }).first().click();
    await sheet.getByRole('button', { name: /^Make 2 pictures · about/ }).click();
    await expect(sheet.getByRole('radio', { name: 'Pick this one' })).toHaveCount(2, { timeout: 60_000 });
    await sheet.getByRole('radio', { name: 'Pick this one' }).first().check();
    await sheet.getByRole('button', { name: 'Use this look' }).click();
    await sheet.getByRole('button', { name: 'Return to the scene' }).click();
    const faces = page.locator('.scene-faces');
    await expect(faces.locator('img')).toHaveCount(1);
    await expect.poll(() => faces.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Choose Fox’s look' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Make preview · about/ })).toBeEnabled();
    await page.reload();
    await expect(faces.locator('img')).toHaveCount(1);
  });

  test('describe a character, use a look, add an angle, then a preview, a final and another version', async ({ page }) => {
    test.skip(!process.env.E2E_FAKE_GENERATION, 'needs a server started with GENERATION_FAKE=on');
    test.setTimeout(240_000);
    const shots = fileURLToPath(new URL('../../../docs/screenshots/studio', import.meta.url));
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E studio'));
    await addPage(page, 'Carrot heist');
    await page.getByLabel('What happens?').fill('Bunny tiptoes past the sleeping farmer and grabs a carrot.');
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();

    // 1. Describe.
    await page.getByRole('button', { name: 'Cover', exact: true }).click();
    await page.getByRole('button', { name: '+ Add a character' }).click();
    const sheet = page.getByRole('dialog', { name: 'Your characters' });
    await sheet.getByRole('button', { name: '+ Make a character' }).click();
    await sheet.getByLabel('What is their name?').fill('Bunny');
    await sheet.getByLabel('What do they look like?').fill('A small white rabbit with one floppy ear and a blue scarf.');
    await page.route('**/api/v1/characters/*/jobs/quote', (route) => route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unavailable', status: 503, detail: 'Try again.' }) }));
    await sheet.getByRole('button', { name: 'Make Bunny' }).click();
    await expect(sheet.getByText('No look chosen yet')).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^Make 2 pictures/ })).toBeDisabled();
    await expect(sheet.getByRole('button', { name: 'Check prices again' })).toBeVisible();
    await page.unroute('**/api/v1/characters/*/jobs/quote');
    await sheet.getByRole('button', { name: 'Check prices again' }).click();

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
    await sheet.getByRole('button', { name: /^From the side · about/ }).click();
    await expect(sheet.getByRole('checkbox', { name: 'Add' })).toHaveCount(1, { timeout: 60_000 });
    await sheet.getByRole('checkbox', { name: 'Add' }).check();
    await sheet.getByRole('button', { name: 'Add these angles' }).click();
    await sheet.getByText('Earlier looks (1)').click();
    await expect(sheet.getByRole('button', { name: 'Use this look again' })).toBeVisible();
    await page.screenshot({ path: `${shots}/02-ready.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await openPage(page, 'Carrot heist');

    // 4. Bunny is in the scene; the chosen look is used automatically.
    await page.getByRole('button', { name: 'Who’s in it' }).click();
    await page.getByLabel('Add a character to this scene').selectOption({ label: 'Bunny' });
    await page.getByRole('button', { name: 'Save characters' }).click();
    await expect(page.locator('.scene-faces img')).toHaveCount(1);
    const main = page.getByRole('button', { name: /^Make preview · about/ });
    await expect(main).toBeEnabled();
    await page.screenshot({ path: `${shots}/03-composer.png`, fullPage: true });

    // 5. One action: a preview, then the final from it.
    await main.click();
    await expect(page.locator('.clip-label')).toContainText('In your cartoon · Preview', { timeout: 90_000 });
    // With a preview on screen, the one button becomes its final.
    const final = page.getByRole('button', { name: /^Make final clip · about/ });
    await expect(final).toBeEnabled();
    await expect(page.getByText(/from your preview’s recipe/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Settings from your preview' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Who’s in it', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Use my current scene settings instead' }).click();
    await expect(page.getByRole('button', { name: 'Who’s in it', exact: true })).toBeVisible();
    // And back to the preview's saved recipe.
    await page.getByRole('button', { name: 'Use the preview’s saved settings instead' }).click();
    await expect(page.getByRole('region', { name: 'Settings from your preview' })).toBeVisible();
    await final.click();
    await expect(page.getByText('Other versions (1)')).toBeVisible({ timeout: 90_000 });

    // 6. Another version keeps the clip's recipe and asks for a fresh price first.
    await page.getByRole('button', { name: 'Make another version', exact: true }).click();
    await page.getByLabel('What should be different? (optional)').fill('Make it snow.');
    await expect(page.getByRole('button', { name: /^Make another version · about/ })).toBeEnabled();
    await page.screenshot({ path: `${shots}/04-clips.png`, fullPage: true });
  });

  test('a failed clip quote can be retried without changing scene settings', async ({ page }) => {
    test.skip(!process.env.E2E_FAKE_GENERATION, 'needs a server started with GENERATION_FAKE=on');
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E quote recovery'));
    await addPage(page, 'A falling leaf');
    await page.route('**/api/v1/shots/*/videos/quote', (route) => route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unavailable', status: 503, detail: 'Try again.' }) }));
    await page.getByLabel('What happens?').fill('A red leaf drifts slowly onto a pond.');
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check price again' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Make preview/ })).toBeDisabled();
    await page.unroute('**/api/v1/shots/*/videos/quote');
    await page.getByRole('button', { name: 'Check price again' }).click();
    await expect(page.getByRole('button', { name: /^Make preview · about/ })).toBeEnabled();
  });
});
