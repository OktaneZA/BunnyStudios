import { test, expect } from '@playwright/test';
import { addPage, createCartoon, signIn } from './helpers';

// UI review 5 Oct 2026: cover saves, the stacked editor, the light theme's links and the page's name.
test.describe('cover and page details', () => {
  test('a slow cover save never overwrites words typed after it left; a failed save keeps them and can be retried', async ({ page }) => {
    await signIn(page, 'teen');
    const stamp = Date.now().toString(36);
    await createCartoon(page, `Slow ${stamp}`);
    const title = page.getByLabel('Cartoon name');
    const summary = page.getByLabel('What is your cartoon about?');

    // Hold every cover save for a moment, and record what each one sent.
    const sent: Record<string, unknown>[] = [];
    let fail = false;
    await page.route(/\/api\/v1\/projects\/[0-9a-f-]+$/, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      await new Promise((r) => setTimeout(r, 1200));
      if (fail) return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Busy', status: 503, detail: 'Please try again.' }) });
      return route.continue();
    });

    await title.fill(`Renamed ${stamp}`);
    await summary.click(); // blurs the name: its save leaves now
    await summary.pressSequentially('A story about a very slow snail.', { delay: 10 });
    // The name's reply lands while the summary is being written, and must not reset it.
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
    await expect(summary).toHaveValue('A story about a very slow snail.');
    await title.click(); // blurs the summary
    await expect.poll(() => sent.length).toBeGreaterThanOrEqual(2);
    expect(sent[0]).toEqual({ title: `Renamed ${stamp}` });
    expect(sent.at(-1)).toEqual({ logline: 'A story about a very slow snail.' });
    await expect(title).toHaveValue(`Renamed ${stamp}`);

    // A failed save keeps the words, says so, and "Try again" sends them.
    fail = true;
    await summary.fill('A story about a very fast snail.');
    await title.click();
    await expect(page.getByText('The cover’s words are not saved yet.')).toBeVisible();
    await expect(summary).toHaveValue('A story about a very fast snail.');
    await page.reload(); // the draft survives a reload
    await expect(page.getByLabel('What is your cartoon about?')).toHaveValue('A story about a very fast snail.');
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('The cover’s words are not saved yet.')).toHaveCount(0);
    await page.unroute(/\/api\/v1\/projects\/[0-9a-f-]+$/);
    await page.reload();
    await expect(page.getByLabel('What is your cartoon about?')).toHaveValue('A story about a very fast snail.');
    await expect(page.getByLabel('Cartoon name')).toHaveValue(`Renamed ${stamp}`);
  });

  test('an open page is named by its heading; at 768px the make action sits beside the words; white-theme links are readable', async ({ page }) => {
    await signIn(page, 'teen');
    await createCartoon(page, `Details ${Date.now().toString(36)}`);
    await addPage(page, 'Bunny hops');

    // P3: the selected article points at the heading that is actually rendered.
    const article = page.locator('article.story-page.selected');
    const labelledBy = await article.getAttribute('aria-labelledby');
    await expect(page.locator(`[id="${labelledBy}"]`)).toHaveText(/Scene 1 · Bunny hops/);
    await expect(page.getByRole('article', { name: /Scene 1 · Bunny hops/ })).toBeVisible();

    // P2: side by side at 1024 there is one make button; stacked at 768 a compact one is in view with the words.
    const compact = page.getByRole('group', { name: 'Make your clip, next to the words' });
    await expect(compact).toBeHidden();
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(compact).toBeVisible();
    await page.getByLabel('What happens?').scrollIntoViewIfNeeded();
    const words = await page.getByLabel('What happens?').boundingBox();
    const button = await compact.getByRole('button').boundingBox();
    expect(button!.y - (words!.y + words!.height)).toBeLessThan(160);
    await page.setViewportSize({ width: 1024, height: 768 });

    // P2: link text in the white theme is at least 4.5:1 against the page.
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: /White/ }).click();
    const ratio = await page.locator('.link-button').first().evaluate((el) => {
      const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = ([r, g, b]: number[]) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!); };
      const fg = lum(rgb(getComputedStyle(el).color));
      const bg = lum(rgb(getComputedStyle(document.body).backgroundColor));
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('button', { name: /Black/ }).click();
  });
});
