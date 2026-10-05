import { test, expect } from '@playwright/test';
import { addPage, createCartoon, openPage, pageTitles, signIn, unique, acceptNextConfirm } from './helpers';

/**
 * The storybook (docs/storybook-rebuild-requirements.md) in the browser: the cover, pages that
 * open in place, ordering without dragging, the bin, Watch and old links. With
 * E2E_FAKE_GENERATION=1 a clip is made and the cartoon put together and downloaded.
 */
test.describe('Storybook', () => {
  test('an empty cartoon: two pages written without any character pictures, kept across a reload', async ({ page }) => {
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E empty'));
    await addPage(page, 'Find the map');
    await page.getByLabel('What happens?').fill('Milo finds a map under a tree.');
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
    await addPage(page, 'Follow the map');
    await page.getByLabel('What happens?').fill('Milo follows the map to the pond.');
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
    expect(await pageTitles(page)).toEqual(['Find the map', 'Follow the map']);
    await page.reload();
    await expect.poll(() => pageTitles(page)).toEqual(['Find the map', 'Follow the map']);
    await expect(page.getByLabel('What happens?')).toHaveValue('Milo follows the map to the pond.');
    await openPage(page, 'Find the map');
    await expect(page.getByLabel('What happens?')).toHaveValue('Milo finds a map under a tree.');
    // The folded page shows its words and an honest empty state; the make button needs words first.
    await expect(page.locator('.story-page').nth(1)).toContainText('Follow the map');
    await expect(page.locator('.story-page').nth(1)).toContainText('Empty');
    // With a clip maker connected the priced action is live; without one the page says so instead.
    if (process.env.E2E_FAKE_GENERATION) await expect(page.getByRole('button', { name: /^Make preview/ })).toBeEnabled();
    else await expect(page.getByText(/Picture making isn’t switched on yet/).filter({ visible: true })).toBeVisible();
    // No horizontal scroll at the tablet width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });

  test('pages move earlier and later, go to the bin, and keep their ids', async ({ page }) => {
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E order'));
    await addPage(page, 'Morning');
    await addPage(page, 'Lunch');
    await addPage(page, 'Night');
    const url = page.url();
    await page.locator('.story-page').nth(2).getByRole('button', { name: 'Move this page earlier' }).click();
    await expect.poll(() => pageTitles(page)).toEqual(['Morning', 'Night', 'Lunch']);
    await page.locator('.story-page').nth(0).getByRole('button', { name: 'Move this page later' }).click();
    await expect.poll(() => pageTitles(page)).toEqual(['Night', 'Morning', 'Lunch']);
    await page.reload();
    await expect.poll(() => pageTitles(page)).toEqual(['Night', 'Morning', 'Lunch']);
    expect(page.url()).toBe(url);
    // A page between two others.
    await page.locator('.story-page').nth(0).getByRole('button', { name: '+ Add a page here' }).click();
    await expect.poll(() => pageTitles(page)).toEqual(['Night', 'Scene 4', 'Morning', 'Lunch']);
    acceptNextConfirm(page);
    await page.locator('.story-page').nth(1).getByRole('button', { name: /to the bin$/ }).click();
    await expect.poll(() => pageTitles(page)).toEqual(['Night', 'Morning', 'Lunch']);
    // The bin, on the scene manager, can put it back.
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('link', { name: 'Manage scenes and the bin' }).click();
    await page.getByRole('button', { name: /^Bin \(1\)/ }).click();
    await expect(page.getByText('Scene 4')).toBeVisible();
  });

  test('the colour mode is remembered and old links open the storybook', async ({ page }) => {
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E links'));
    await addPage(page, 'First');
    const sceneUrl = page.url();
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: /White/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-director-theme', 'white');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-director-theme', 'white');
    const projectId = sceneUrl.match(/projects\/([^/]+)/)![1];
    const sceneId = new URL(sceneUrl).searchParams.get('scene')!;
    // Old links keep working: the cartoon, Put it together, Characters and a scene.
    await page.goto(`/projects/${projectId}`);
    await expect(page).toHaveURL(/\/director$/);
    await page.goto(`/projects/${projectId}/together?scene=${sceneId}`);
    await expect(page).toHaveURL(new RegExp(`/watch\\?scene=${sceneId}$`));
    await expect(page.getByRole('heading', { name: 'Watch your cartoon' })).toBeVisible();
    await page.getByRole('link', { name: '← Back to your story' }).click();
    await expect(page.getByRole('heading', { name: 'Scene 1 · First' })).toBeVisible();
    await page.goto(`/projects/${projectId}/characters?scene=${sceneId}`);
    await expect(page.getByRole('dialog', { name: 'Your characters' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Scene 1 · First' })).toBeVisible();
  });

  test('make a clip, it lands on its page, put the cartoon together and download it', async ({ page }) => {
    test.skip(!process.env.E2E_FAKE_GENERATION, 'needs a server started with GENERATION_FAKE=on');
    test.setTimeout(240_000);
    await signIn(page, 'teen');
    const title = unique('E2E cartoon');
    await createCartoon(page, title);
    await addPage(page, 'Timmy finds the ball');
    await page.getByLabel('What happens?').fill('Timmy spots a red beach ball on the sand.');
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();

    // The cover owns the cartoon's look (SB-08).
    await page.getByRole('button', { name: 'Cover', exact: true }).click();
    const saved = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/style'));
    await page.getByRole('region', { name: 'Cover' }).getByRole('button', { name: 'Change', exact: true }).click();
    await page.getByRole('button', { name: '3D animated film', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await openPage(page, 'Timmy finds the ball');
    await page.getByText('More options', { exact: true }).click();
    await page.getByText('See the clip instructions').click();
    await expect(page.locator('.prompt-box')).toContainText('stylised 3D animated film look');
    await page.getByText('More options', { exact: true }).click();
    await page.getByRole('button', { name: '15 seconds', exact: true }).click();
    await page.getByText('Price details').click();
    await expect(page.getByText(/shorter clips joined together/)).toBeVisible();
    await page.getByRole('button', { name: /^Make preview · about/ }).click();
    await expect(page.locator('.clip-label')).toContainText('In your cartoon', { timeout: 90_000 });
    await expect(page.getByRole('navigation', { name: 'Story pages' }).locator('.index-dot.state-set')).toHaveCount(1);

    await page.getByRole('link', { name: '▶ Watch cartoon' }).click();
    await page.getByRole('button', { name: 'Make my cartoon' }).click();
    await expect(page.getByRole('link', { name: 'Download video' })).toBeVisible({ timeout: 90_000 });
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download video' }).click();
    await (await download).saveAs('.playwright-results/joined-cartoon.mp4');
    // Watch comes back to the page it was opened from (SB-36).
    await page.getByRole('link', { name: '← Back to your story' }).click();
    await expect(page.getByRole('heading', { name: 'Scene 1 · Timmy finds the ball' })).toBeVisible();
  });
});
