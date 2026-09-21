import { test, expect } from '@playwright/test';
import { addScene, createCartoon, signIn, unique } from './helpers';

/**
 * Director Mode in the browser. With no picture-maker key the picker says so and nothing can be
 * made; with E2E_FAKE_GENERATION=1 (the server started with GENERATION_FAKE=on) the whole flow
 * runs: make a picture, pick it, make it move, pick the clip, put it together.
 */
test.describe('Director', () => {
  test('the Director tab reads the storyboard: scenes down the left, the prompt, the strip', async ({ page }) => {
    await signIn(page, 'teen');
    const title = unique('E2E director');
    await createCartoon(page, title);
    await addScene(page, 'Timmy finds the ball');
    await addScene(page, 'Sister wants a go');
    await page.getByRole('link', { name: 'Director', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Scene 1 · Timmy finds the ball/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /2 Sister wants a go/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What the picture maker will be told' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your cartoon' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Put it together/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Change how scenes join/ }).first()).toBeVisible();
    // No horizontal scroll at the tablet width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test('picture, pick, clip, pick, put it together', async ({ page }) => {
    test.skip(!process.env.E2E_FAKE_GENERATION, 'needs a server started with GENERATION_FAKE=on');
    test.setTimeout(180_000);
    await signIn(page, 'teen');
    const title = unique('E2E cartoon');
    await createCartoon(page, title);
    await addScene(page, 'Timmy finds the ball');
    await page.getByRole('link', { name: 'Timmy finds the ball', exact: true }).click();
    await page.getByLabel('Scene description').fill('Timmy spots a red beach ball on the sand.');
    await page.getByRole('link', { name: /Back to scenes/ }).click();
    await page.getByRole('link', { name: 'Director', exact: true }).click();

    await page.getByRole('button', { name: 'Make a picture' }).click();
    await expect(page.getByRole('button', { name: 'Use this one' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Use this one' }).click();
    await expect(page.getByRole('button', { name: /1 Timmy finds the ball Picture/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Make it move/ })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: 'Make it move' }).click();
    await expect(page.getByRole('button', { name: 'Use this one' })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Use this one' }).click();
    await expect(page.getByRole('button', { name: /1 Timmy finds the ball Moving/ })).toBeVisible();

    await page.getByRole('link', { name: /Put it together/ }).click();
    await page.getByRole('button', { name: 'Make my cartoon' }).click();
    await expect(page.getByRole('link', { name: 'Download' })).toBeVisible({ timeout: 90_000 });
  });
});
