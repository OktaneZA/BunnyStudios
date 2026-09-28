import { test, expect, type Page } from '@playwright/test';
import { signIn, createCartoon, unique } from './helpers';

async function workspace(page: Page) {
  await signIn(page, 'teen');
  await createCartoon(page, unique('Inline scene'));
  await page.getByRole('navigation', { name: 'Cartoon steps' }).getByRole('link', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
  await expect(page.getByLabel('Scene name', { exact: true })).toHaveValue('Scene 1');
}

test('write and generate in one workspace; later edits keep the clip and flag it as older', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_GENERATION, 'requires fake generation');
  await workspace(page);
  await page.getByLabel('Scene name', { exact: true }).fill('A leaf falls');
  await page.getByLabel('What happens?').fill('A red leaf lands on a quiet pond.');
  await page.getByText('Camera, time and mood', { exact: true }).click();
  await page.getByRole('button', { name: /Dusk/ }).click();
  await page.getByRole('button', { name: /High angle/i }).click();
  await page.getByRole('button', { name: /Cosy/i }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Make preview · about/ }).click();
  await expect(page.locator('.clip-label')).toContainText('In your cartoon', { timeout: 60_000 });
  await page.getByLabel('What happens?').fill('A blue leaf lands on a quiet pond.');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByText(/You changed this scene since making this clip/)).toBeVisible();
  await expect(page.locator('.clip-label')).toContainText('In your cartoon');
  await page.reload();
  await expect(page.getByLabel('What happens?')).toHaveValue('A blue leaf lands on a quiet pond.');
  await expect(page.getByLabel('Scene name', { exact: true })).toHaveValue('A leaf falls');
  await page.getByText('Camera, time and mood', { exact: true }).click();
  await expect(page.getByRole('button', { name: /Dusk/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /High angle/i })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Cosy/i })).toHaveAttribute('aria-pressed', 'true');
});

test('typing during a slow save is kept; generation waits; switching scenes saves the draft', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_GENERATION, 'requires fake generation');
  await workspace(page);
  let release!: () => void;
  const hold = new Promise<void>((r) => { release = r; });
  let captured = false;
  await page.route('**/api/v1/scenes/*', async (route) => {
    if (route.request().method() === 'PATCH' && !captured) { captured = true; await hold; }
    await route.continue();
  });
  await page.getByLabel('What happens?').fill('First idea.');
  await expect.poll(() => captured).toBe(true);
  await page.getByLabel('What happens?').fill('The newest idea stays here.');
  await expect(page.getByRole('button', { name: /^Make preview/ })).toBeDisabled();
  release();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Make preview · about/ })).toBeEnabled();
  await page.getByLabel('What happens?').fill('Saved even when I immediately switch scenes.');
  await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
  await expect(page.getByLabel('Scene name', { exact: true })).toHaveValue('Scene 2');
  await page.getByRole('button', { name: /^1 Scene 1 / }).click();
  await expect(page.getByLabel('What happens?')).toHaveValue('Saved even when I immediately switch scenes.');
});

test('failed and conflicting saves keep text and offer explicit recovery', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_GENERATION, 'requires fake generation');
  await workspace(page);
  let failure = 503;
  await page.route('**/api/v1/scenes/*', async (route) => {
    if (route.request().method() !== 'PATCH' || !failure) return route.continue();
    await route.fulfill({ status: failure, contentType: 'application/problem+json', body: JSON.stringify({ status: failure, title: 'Save failed', detail: 'Please try again.' }) });
  });
  await page.getByLabel('What happens?').fill('Keep this idea after an error.');
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Make preview/ })).toBeDisabled();
  failure = 0;
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  failure = 409;
  await page.getByLabel('What happens?').fill('Keep my new idea after a conflict.');
  await expect(page.getByRole('button', { name: 'Save my changes' })).toBeVisible();
  failure = 0;
  await page.getByRole('button', { name: 'Save my changes' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('What happens?')).toHaveValue('Keep my new idea after a conflict.');
});

test('typing while a new scene is being added never overwrites the previous scene', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_GENERATION, 'requires fake generation');
  await workspace(page);
  await page.getByLabel('Scene name', { exact: true }).fill('Keep me');
  await page.getByLabel('What happens?').fill('The first scene must keep these words.');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  // Hold the new scene's creation so the old editor is still on screen.
  let release!: () => void;
  const hold = new Promise<void>((r) => { release = r; });
  let held = false;
  await page.route('**/api/v1/projects/*/scenes', async (route) => {
    if (route.request().method() === 'POST' && !held) { held = true; await hold; }
    await route.continue();
  });
  await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
  await expect.poll(() => held).toBe(true);
  await page.getByLabel('What happens?').click({ force: true, timeout: 2_000 }).catch(() => {});
  await page.keyboard.type('WRONG SCENE');
  release();
  await expect(page.getByLabel('Scene name', { exact: true })).toHaveValue('Scene 2');
  await page.getByRole('button', { name: /^1 Keep me/ }).click();
  await expect(page.getByLabel('What happens?')).toHaveValue('The first scene must keep these words.');
  await expect(page.getByLabel('Scene name', { exact: true })).toHaveValue('Keep me');
});
