import { test, expect } from '@playwright/test';
import { accounts, acceptNextConfirm, addScene, boardTitles, createCartoon, dragHandle, signIn, unique } from './helpers';

test.describe('sign in', () => {
  test('the origin is insecure, like the NAS, and the page still loads', async ({ page }) => {
    await page.goto('/');
    const ctx = await page.evaluate(() => ({ secure: window.isSecureContext, randomUUID: typeof crypto.randomUUID }));
    test.info().annotations.push({ type: 'origin', description: JSON.stringify(ctx) });
    await expect(page.getByRole('heading', { name: /Bunny Studio/ })).toBeVisible();
    await expect(page.locator('.version-tag')).toHaveText(/^v\d+\.\d+\.\d+/);
  });

  test('a wrong password is explained in plain words', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(accounts.teen.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Email or password is incorrect');
  });

  test('the teen lands in Simple mode, the adult in Advanced', async ({ page }) => {
    await signIn(page, 'teen');
    await expect(page.getByText('Simple mode')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn(page, 'adult');
    await expect(page.getByText('Advanced mode')).toBeVisible();
  });
});

test.describe('cartoons and scenes', () => {
  test('create a cartoon, add scenes, reorder by arrows and by drag', async ({ page }) => {
    await signIn(page, 'teen');
    const title = unique('E2E cartoon');
    await createCartoon(page, title);
    await addScene(page, 'Morning');
    await addScene(page, 'Lunch');
    await addScene(page, 'Night');
    expect(await boardTitles(page)).toEqual(['Morning', 'Lunch', 'Night']);

    await page.getByRole('button', { name: 'Move scene 3 (Night) earlier' }).click();
    await expect.poll(() => boardTitles(page)).toEqual(['Morning', 'Night', 'Lunch']);

    await dragHandle(page, 'Reorder scene 3, Lunch', 'Reorder scene 1, Morning');
    await expect.poll(() => boardTitles(page)).toEqual(['Lunch', 'Morning', 'Night']);

    // The order is the server's, not the client's: a reload shows the same board.
    await page.reload();
    await expect.poll(() => boardTitles(page)).toEqual(['Lunch', 'Morning', 'Night']);
  });

  test('a scene is edited and saved with its version, and survives a reload', async ({ page }) => {
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E edit'));
    await addScene(page, 'Beach');
    await page.getByRole('link', { name: 'Open scene 1: Beach' }).click();
    // Camera, time and mood live in a collapsed section in Simple mode.
    await page.getByText('Camera, time and mood').click();
    await page.getByRole('button', { name: /Dusk/ }).click();
    const description = page.getByLabel('Scene description');
    await description.fill('Timmy looks for his mum along the shoreline.');
    await description.blur();
    await expect(page.locator('.save-state')).toContainText('All changes saved', { timeout: 15_000 });
    await page.reload();
    await expect(page.getByLabel('Scene description')).toHaveValue('Timmy looks for his mum along the shoreline.');
    await page.getByText('Camera, time and mood').click();
    await expect(page.getByRole('button', { name: /Dusk/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('deleting a scene moves it to the bin and "Put back" returns it at the end', async ({ page }) => {
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E scene bin'));
    await addScene(page, 'One');
    await addScene(page, 'Two');
    await addScene(page, 'Three');
    acceptNextConfirm(page);
    await page.getByRole('button', { name: 'Delete scene 2 (Two)' }).click();
    await expect.poll(() => boardTitles(page)).toEqual(['One', 'Three']);
    await page.getByRole('button', { name: 'Bin (1)' }).click();
    await page.getByRole('button', { name: 'Put back' }).click();
    await expect.poll(() => boardTitles(page)).toEqual(['One', 'Three', 'Two']);
    await expect(page.getByRole('button', { name: /^Bin \(/ })).toHaveCount(0);
  });

  test('deleting a cartoon moves it to the bin and "Put back" restores it with its scenes', async ({ page }) => {
    await signIn(page, 'teen');
    const title = unique('E2E cartoon bin');
    await createCartoon(page, title);
    await addScene(page, 'Kept');
    acceptNextConfirm(page);
    await page.getByRole('button', { name: 'Delete this cartoon' }).click();
    await expect(page.getByRole('heading', { name: 'Your cartoons' }).or(page.getByRole('heading', { name: 'No cartoons yet' }))).toBeVisible();
    await expect(page.getByRole('heading', { name: title })).toHaveCount(0);
    await page.getByRole('button', { name: /^Bin \(\d+\)$/ }).click();
    const row = page.locator('.bin-list li', { hasText: title });
    await row.getByRole('button', { name: 'Put back' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.getByRole('heading', { name: title }).click();
    await expect(page).toHaveURL(/\/director$/);
    await page.getByText('View', { exact: true }).click();
    await page.getByRole('link', { name: 'Manage scenes', exact: true }).click();
    await expect.poll(() => boardTitles(page)).toEqual(['Kept']);
  });

  test('cartoons are private to the account that made them', async ({ page }) => {
    await signIn(page, 'teen');
    const title = unique('E2E private');
    await createCartoon(page, title);
    const url = page.url();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn(page, 'adult');
    await expect(page.getByRole('heading', { name: title })).toHaveCount(0);
    await page.goto(url);
    await expect(page.getByRole('alert')).toContainText(/not found/i);
  });
});

test.describe('tablet app download', () => {
  test('the sign-in page links to the APK exactly when the server serves one', async ({ page }) => {
    const head = await page.request.head('/downloads/bunny-studios.apk');
    const served = head.ok() && (head.headers()['content-type'] ?? '').includes('android');
    await page.goto('/');
    await expect(page.locator('.apk-link')).toHaveCount(served ? 1 : 0);
    const link = page.getByRole('link', { name: 'Get the tablet app' });
    await expect(link).toHaveCount(served ? 1 : 0);
    if (served) await expect(link).toHaveAttribute('href', '/downloads/bunny-studios.apk');
    // A missing download is a real 404, never the app shell.
    const missing = await page.request.get('/downloads/does-not-exist.apk');
    expect(missing.status()).toBe(404);
    expect(missing.headers()['content-type']).toContain('application/problem+json');
  });
});

test.describe('AI', () => {
  test('when AI is not configured the scene page says so in plain words', async ({ page }) => {
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E ai'));
    await addScene(page, 'Sketch me');
    await page.getByRole('link', { name: 'Open scene 1: Sketch me' }).click();
    const settings = await page.request.get('/api/v1/settings/ai', {
      headers: { authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('storyboard.token'))}` },
    }).then((r) => r.json());
    // The sketch is optional (D42), so it sits in a folded section until opened.
    await page.getByText('Optional: a quick sketch of this scene').click();
    if (settings.thumbnails_enabled) {
      test.info().annotations.push({ type: 'note', description: 'AI is enabled on this server; the disabled-state message is not exercised.' });
      await expect(page.getByRole('button', { name: /Make a thumbnail|Improve for me/ }).first()).toBeVisible();
    } else {
      await expect(page.getByText('Thumbnails are not set up yet')).toBeVisible();
    }
  });
});
