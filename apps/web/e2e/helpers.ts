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

/** A new cartoon opens as its storybook: the cover, and an obvious first-page action (SB-02). */
export async function createCartoon(page: Page, title: string) {
  await page.getByRole('link', { name: '+ New cartoon' }).click();
  await page.getByLabel("What's it called?").fill(title);
  await page.getByRole('button', { name: 'Create cartoon' }).click();
  await expect(page).toHaveURL(/\/director$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add your first page' })).toBeVisible();
}

/** Add a page at the end and give it a name; it opens for editing. */
export async function addPage(page: Page, title: string) {
  const before = await page.locator('.story-page').count();
  await page.getByRole('button', { name: before === 0 ? '+ Add your first page' : '+ Add a page', exact: true }).click();
  await expect(page.locator('.story-page')).toHaveCount(before + 1);
  // The new page opens for editing: wait for its own editor, not the one it replaces.
  const name = page.getByLabel('Scene name');
  await expect(name).toHaveValue(`Scene ${before + 1}`);
  await name.fill(title);
  await name.blur();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ }).first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Story pages' }).getByRole('button', { name: new RegExp(`\\d\\d\\s+${escape(title)}$`) })).toBeVisible();
}

/** Open a page from the index. */
export async function openPage(page: Page, title: string) {
  await page.getByRole('navigation', { name: 'Story pages' }).getByRole('button', { name: new RegExp(`\\d\\d\\s+${escape(title)}$`) }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`^Scene \\d+ · ${escape(title)}$`) })).toBeVisible();
}

/** The older scene manager (order by drag, the bin), reached from the toolbar menu. */
export async function openManageScenes(page: Page) {
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('link', { name: 'Manage scenes and the bin' }).click();
  await expect(page).toHaveURL(/\/scenes$/);
}

/** Add a scene on the scene manager page. */
export async function addScene(page: Page, title: string) {
  await page.getByPlaceholder('Scene name').fill(title);
  await page.getByRole('button', { name: 'Add scene' }).click();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
}

/** Scene titles on the board, in order. */
export async function boardTitles(page: Page): Promise<string[]> {
  return page.locator('.scene-list h4').allInnerTexts().then((t) => t.map((s) => s.trim()));
}

/** Page titles in the storybook index, in order. */
export async function pageTitles(page: Page): Promise<string[]> {
  return page.locator('.page-index .index-title').allInnerTexts().then((t) => t.map((s) => s.trim()));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
