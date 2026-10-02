import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/** Pre-paid picture money: the adult adds to a pot under Grown-ups; the child sees it on Create. */
test('an adult adds money to the pot and the history shows it', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signIn(page, 'adult');
  await page.getByRole('link', { name: /Grown-ups/ }).click();
  const card = page.locator('section.card', { hasText: "Test creator's picture money" });
  await expect(card.getByText('In the pot')).toBeVisible();
  const pounds = (text: string | null) => Number.parseFloat((text ?? '0').replace(/[£,]/g, ''));
  const before = pounds(await card.locator('.pot-amount').textContent());
  await card.getByLabel(/Add to Test creator's pot/).fill('£2.50');
  await card.getByLabel('Note for this top-up').fill('Pocket money');
  await card.getByRole('button', { name: 'Add to the pot' }).click();
  await expect.poll(async () => pounds(await card.locator('.pot-amount').textContent())).toBeCloseTo(before + 2.5, 2);
  await card.getByRole('button', { name: 'See what was added' }).click();
  await expect(card.locator('.topup-list').first()).toContainText('£2.50');
  await expect(card.locator('.topup-list').first()).toContainText('Pocket money');
  await expect(card.getByText('Each month')).toHaveCount(0);
  await page.screenshot({ path: '.playwright-results/pot-01-grownups.png', fullPage: true });
});
