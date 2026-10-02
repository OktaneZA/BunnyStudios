import { test, expect } from '@playwright/test';
import { addScene, createCartoon, signIn, unique, acceptNextConfirm } from './helpers';

/**
 * Director Mode in the browser. With no clip-maker key the screen says so and nothing can be
 * made; with E2E_FAKE_GENERATION=1 (the server started with GENERATION_FAKE=on) the whole flow
 * runs: make it move, the clip lands in the cartoon by itself, put it together.
 */
test.describe('Director', () => {
  test('styles persist and each workspace adapts; floating panels move and reset', async ({ page }) => {
    await signIn(page, 'teen');
    await createCartoon(page, unique('Design review'));
    await addScene(page, 'The biscuit escape');
    await addScene(page, 'The plan goes wrong');
    await addScene(page, 'Caught red-pawed');
    await addScene(page, 'The big finale');
    await page.getByRole('link', { name: 'The biscuit escape', exact: true }).click();
    await page.getByLabel('Scene description').fill('A small rabbit carries a biscuit through a sunny garden.');
    await page.getByRole('button', { name: /Make this scene.s clip/ }).click();
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Look for the whole cartoon' }).getByRole('button')).toHaveCount(5);
    await expect(page.getByLabel('Anything to add? (optional)')).toHaveCount(0);
    await page.getByRole('button', { name: 'Watercolour', exact: true }).click();
    await expect(page.getByText('Look saved for the whole cartoon')).toBeVisible();
    await page.reload();
    await expect(page.locator('.composer-field').filter({ has: page.locator('.label-text', { hasText: /^Look$/ }) })).toContainText('Watercolour · whole cartoon');
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Watercolour', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.prompt-box')).toContainText("children's storybook watercolour illustration");
    // The camera move reaches the clip instructions (video template, §5.1).
    await page.getByText('Scene details').click();
    await page.getByRole('group', { name: 'Camera moves' }).getByRole('button', { name: /Camera moves closer/ }).click();
    await expect(page.locator('.prompt-box')).toContainText('slow dolly in toward the subject', { timeout: 15_000 });
    await page.getByText('Scene details').click();
    // One look for the whole cartoon: another scene uses it too.
    await page.getByRole('button', { name: /^2 The plan goes wrong/ }).click();
    await expect(page.getByRole('heading', { name: 'Scene 2 · The plan goes wrong' })).toBeVisible();
    await expect(page.locator('.composer-field').filter({ has: page.locator('.label-text', { hasText: /^Look$/ }) })).toContainText('Watercolour · whole cartoon');
    await page.getByRole('button', { name: /^1 The biscuit escape/ }).click();
    for (const seconds of [5, 10, 15, 30]) await expect(page.getByRole('button', { name: `${seconds} seconds`, exact: true })).toBeVisible();
    // One button, no Preview/Final switch; skipping the preview is under More options.
    await expect(page.getByRole('button', { name: 'Final', exact: true })).toHaveCount(0);
    await page.getByText('More options', { exact: true }).click();
    await expect(page.getByLabel(/Skip the preview/)).toBeVisible();
    await page.getByText('More options', { exact: true }).click();
    await page.getByText('View', { exact: true }).click();
    for (const design of ['Film Strip', 'Scene Board']) {
      await page.getByRole('button', { name: design, exact: true }).click();
      for (const mode of ['Black', 'White']) {
        await page.getByRole('button', { name: new RegExp(mode) }).click();
        await expect(page.locator('html')).toHaveAttribute('data-director-theme', mode.toLowerCase());
        for (const width of [1440, 1024, 768, 390]) {
          await page.setViewportSize({ width, height: 900 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        }
        await page.setViewportSize({ width: 1024, height: 1000 });
        await page.screenshot({ path: `docs/screenshots/director-designs/${design.toLowerCase().replace(' ', '-')}-${mode.toLowerCase()}.png`, fullPage: true, animations: 'disabled' });
      }
    }
    await page.reload();
    // Layout and colour are remembered; they live in the View menu, closed after a reload.
    await page.getByText('View', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Scene Board', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-director-theme', 'white');
    await page.getByRole('button', { name: /2 The plan goes wrong/ }).click();
    await expect(page.getByRole('heading', { name: /Scene 2 · The plan goes wrong/ })).toBeVisible();
    await page.getByRole('button', { name: 'Movable panels', exact: true }).click();
    await page.getByRole('button', { name: 'Float Clip settings', exact: true }).click();
    const window = page.locator('.floating-panel');
    const before = await window.boundingBox();
    await page.getByRole('button', { name: 'Move Clip settings; use arrow keys', exact: true }).press('ArrowRight');
    expect((await window.boundingBox())!.x).not.toBe(before!.x);
    const grip = await page.getByRole('button', { name: 'Move Clip settings; use arrow keys', exact: true }).boundingBox();
    const dragStart = (await window.boundingBox())!;
    await page.mouse.move(grip!.x + 30, grip!.y + 20);
    await page.mouse.down();
    await page.mouse.move(grip!.x - 30, grip!.y - 20, { steps: 8 });
    await page.mouse.up();
    expect((await window.boundingBox())!.x).toBeLessThan(dragStart.x);
    await page.getByRole('button', { name: 'Reset layout', exact: true }).click();
    await expect(page.locator('.floating-panel')).toHaveCount(0);
    await page.getByRole('button', { name: /Change how scenes join/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('link', { name: 'Manage scenes', exact: true }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-director-theme');
    await page.getByRole('navigation', { name: 'Cartoon steps' }).getByRole('link', { name: 'Create', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-director-theme', 'white');
  });
  test('the Director tab reads the storyboard: scene strip, cost levels and selected scene', async ({ page }) => {
    await signIn(page, 'teen');
    const title = unique('E2E director');
    await createCartoon(page, title);
    await addScene(page, 'Timmy finds the ball');
    await addScene(page, 'Sister wants a go');
    await page.getByRole('navigation', { name: 'Cartoon steps' }).getByRole('link', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Scene 1 · Timmy finds the ball/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /2 Sister wants a go/ })).toBeVisible();
    await expect(page.getByLabel('What happens?')).toHaveValue('');
    await expect(page.getByLabel('What happens?')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Make preview/ })).toBeDisabled();
    await expect(page.getByText('Describe what happens in this scene first.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your cartoon' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Cartoon steps' }).getByRole('link', { name: /Put it together/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Change how scenes join/ }).first()).toBeVisible();
    // No horizontal scroll at the tablet width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test('save the description before continuing, and make missing scenes easy to find', async ({ page }) => {
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E guided story'));
    await addScene(page, 'Find the map');
    await addScene(page, 'Follow the map');
    await page.getByRole('link', { name: 'Write the next scene' }).click();
    await page.getByLabel('Scene description').fill('Milo finds a map under a tree.');
    await page.getByRole('button', { name: /Make this scene.s clip/ }).click();
    await expect(page.getByRole('heading', { name: /Scene 1 · Find the map/ })).toBeVisible();
    await expect(page.getByLabel('What happens?')).toHaveValue('Milo finds a map under a tree.');
    await expect(page.locator('.prompt-details')).not.toHaveAttribute('open');
    await page.getByRole('navigation', { name: 'Cartoon steps' }).getByRole('link', { name: /Put it together/ }).click();
    const missing = page.getByRole('region', { name: 'Scenes missing from your cartoon' });
    await expect(missing).toBeVisible();
    await missing.getByRole('link', { name: 'Make scene 2' }).click();
    await expect(page.getByRole('heading', { name: /Scene 2 · Follow the map/ })).toBeVisible();
  });

  test('the cast sheet contains keyboard focus and returns it when closed', async ({ page }) => {
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E cast access'));
    await page.getByRole('navigation', { name: 'Cartoon steps' }).getByRole('link', { name: 'Create', exact: true }).click();
    const opener = page.locator('.cast-button');
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Your characters' });
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog).toContainText('Your characters');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
  });

  test('make it move, the clip lands in the cartoon, put it together', async ({ page }) => {
    test.skip(!process.env.E2E_FAKE_GENERATION, 'needs a server started with GENERATION_FAKE=on');
    test.setTimeout(240_000);
    await signIn(page, 'teen');
    const title = unique('E2E cartoon');
    await createCartoon(page, title);
    await addScene(page, 'Timmy finds the ball');
    await page.getByRole('link', { name: 'Timmy finds the ball', exact: true }).click();
    await page.getByLabel('Scene description').fill('Timmy spots a red beach ball on the sand.');
    await page.getByRole('link', { name: /All scenes/ }).click();
    await page.getByRole('navigation', { name: 'Cartoon steps' }).getByRole('link', { name: 'Create', exact: true }).click();

    // Choosing a look sets it for the whole cartoon (docs/video-optimisation-plan.md §7.1).
    const saved = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/style'));
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await page.getByRole('button', { name: 'Pixar-like 3D', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(page.locator('.prompt-box')).toContainText('stylised 3D animated film look');
    await page.getByRole('button', { name: '15 seconds', exact: true }).click();
    await page.getByText('Price details').click();
    await expect(page.getByText(/shorter clips joined together/)).toBeVisible();
    await page.getByRole('button', { name: /^Make preview · about/ }).click();
    await expect(page.getByRole('button', { name: /1 Timmy finds the ball In the cartoon/ })).toBeVisible({ timeout: 90_000 });

    await page.getByRole('navigation', { name: 'Cartoon steps' }).getByRole('link', { name: /Put it together/ }).click();
    await page.getByRole('button', { name: 'Make my cartoon' }).click();
    await expect(page.getByRole('link', { name: 'Save video' })).toBeVisible({ timeout: 90_000 });
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Save video' }).click();
    await (await download).saveAs('.playwright-results/joined-cartoon.mp4');
  });

  test('a scene can go to the bin from Create, and the next scene is shown', async ({ page }) => {
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E bin from create'));
    await addScene(page, 'Keep me');
    await addScene(page, 'Bin me');
    await page.getByRole('link', { name: 'Bin me', exact: true }).click();
    await page.getByLabel('Scene description').fill('A scene that should not be here.');
    await page.getByRole('button', { name: /Make this scene.s clip/ }).click();
    await expect(page.getByRole('heading', { name: 'Scene 2 · Bin me' })).toBeVisible();
    acceptNextConfirm(page);
    await page.getByRole('button', { name: 'Move to the bin' }).click();
    await expect(page.getByRole('heading', { name: 'Scene 1 · Keep me' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Bin me/ })).toHaveCount(0);
    // Manage scenes still has it, and can put it back.
    await page.getByText('View', { exact: true }).click();
    await page.getByRole('link', { name: 'Manage scenes' }).click();
    await page.getByRole('button', { name: /^Bin \(1\)/ }).click();
    await expect(page.getByText('Bin me')).toBeVisible();
  });

  test('the steps stay put, and a scene opened from Make clips goes back there', async ({ page }) => {
    await signIn(page, 'teen');
    await createCartoon(page, unique('E2E steps'));
    await addScene(page, 'Find the map');
    await addScene(page, 'Follow the map');
    const steps = page.getByRole('navigation', { name: 'Cartoon steps' });
    // Write is lit on the board and on a scene's own page.
    await expect(steps.getByRole('link', { name: 'Create', exact: true })).toHaveAttribute('aria-current', 'step');
    await page.getByRole('link', { name: 'Find the map', exact: true }).click();
    await expect(steps.getByRole('link', { name: 'Create', exact: true })).toHaveAttribute('aria-current', 'step');
    await expect(page.getByText('Scene 1 of 2').first()).toBeVisible();
    // The arrows move between scenes; the dock stays on screen at tablet size.
    await page.getByRole('button', { name: 'Next scene' }).click();
    await expect(page.getByRole('heading', { name: 'Follow the map' })).toBeVisible();
    await page.getByLabel('Scene description').fill('Milo follows the map to the pond.');
    await expect(page.getByRole('button', { name: /Make this scene.s clip/ })).toBeInViewport();
    await page.getByRole('button', { name: /Make this scene.s clip/ }).click();
    await expect(steps.getByRole('link', { name: 'Create', exact: true })).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('heading', { name: /Scene 2 · Follow the map/ })).toBeVisible();
    // Writing from Make clips returns to the same scene's clip, not to the board.
    await page.getByText('More options', { exact: true }).click();
    await page.getByRole('link', { name: 'Open the full scene page' }).click();
    await expect(page.getByRole('heading', { name: 'Follow the map' })).toBeVisible();
    await page.getByRole('link', { name: /Back to Create/ }).click();
    await expect(page.getByRole('heading', { name: /Scene 2 · Follow the map/ })).toBeVisible();
    // The board shows the same state words as the film strip.
    await page.getByText('View', { exact: true }).click();
    await page.getByRole('link', { name: 'Manage scenes', exact: true }).click();
    await expect(page.locator('.scene-row').nth(0)).toContainText('Needs a description');
    await expect(page.locator('.scene-row').nth(1)).toContainText('No clip yet');
  });
});
