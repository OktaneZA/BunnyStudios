import { expect, type Page } from '@playwright/test';

/** Accounts seeded by the server under test (E2E_* override the defaults used in CI/release). */
export const accounts = {
  adult: { email: process.env.E2E_ADULT_EMAIL ?? 'adult@example.com', password: process.env.E2E_ADULT_PASSWORD ?? 'e2e-adult-password' },
  teen: { email: process.env.E2E_TEEN_EMAIL ?? 'teen@example.com', password: process.env.E2E_TEEN_PASSWORD ?? 'e2e-teen-password' },
};

export async function signIn(page: Page, who: keyof typeof accounts) {
  await page.goto('/');
  await page.getByLabel('Email').fill(accounts[who].email);
  await page.getByLabel('Password').fill(accounts[who].password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Signed in as')).toBeVisible();
}

/** A title unique to this run so tests never collide with real data or each other. */
export const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

export async function createCartoon(page: Page, title: string) {
  await page.getByRole('link', { name: '+ New cartoon' }).click();
  await page.getByLabel("What's it called?").fill(title);
  await page.getByRole('button', { name: 'Create cartoon' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page).toHaveURL(/\/director$/);
  const steps = page.getByRole('navigation', { name: 'Cartoon steps' });
  await expect(steps.getByRole('link')).toHaveCount(2);
  await expect(steps.getByRole('link', { name: 'Create', exact: true })).toHaveAttribute('aria-current', 'step');
  await expect(steps.getByRole('link', { name: 'Write', exact: true })).toHaveCount(0);
  // Older editing/ordering tests still exercise the optional scene manager.
  await page.getByText('View', { exact: true }).click();
  await page.getByRole('link', { name: 'Manage scenes', exact: true }).click();
}

export async function addScene(page: Page, title: string) {
  await page.getByPlaceholder('Scene name').fill(title);
  await page.getByRole('button', { name: 'Add scene' }).click();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
}

/** Scene titles on the board, in order. */
export async function boardTitles(page: Page): Promise<string[]> {
  return page.locator('.scene-list h4').allInnerTexts().then((t) => t.map((s) => s.trim()));
}

/**
 * Drag with real pointer events. Playwright's dragTo issues one move, which dnd-kit ignores by
 * design (a 6px distance constraint), so the drag must be dispatched as a sequence of moves.
 */
export async function dragHandle(page: Page, fromHandle: string, toHandle: string) {
  const from = page.getByRole('button', { name: fromHandle });
  const to = page.getByRole('button', { name: toHandle });
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const end = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(start.x + ((end.x - start.x) * i) / steps, start.y + ((end.y - start.y) * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

/** Accept the next confirm() dialog, which the app uses for "move to the bin". */
export function acceptNextConfirm(page: Page) {
  page.once('dialog', (d) => void d.accept());
}
