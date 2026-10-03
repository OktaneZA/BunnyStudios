import { test, expect, type Page } from '@playwright/test';
import { signIn, createCartoon, unique } from './helpers';

async function workspace(page: Page) {
  await signIn(page, 'teen');
  await createCartoon(page, unique('Inline scene'));
  await page.getByRole('button', { name: '+ Add your first page', exact: true }).click();
  await expect(page.getByLabel('Scene name', { exact: true })).toHaveValue('Scene 1');
}

test('write and generate in one workspace; later edits keep the clip and flag it as older', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_GENERATION, 'requires fake generation');
  await workspace(page);
  await page.getByLabel('Scene name', { exact: true }).fill('A leaf falls');
  await page.getByLabel('What happens?').fill('A red leaf lands on a quiet pond.');
  // Optional choices start folded, with selected values visible in the summary.
  await expect(page.getByRole('group', { name: 'Time of day' })).toBeHidden();
  await page.locator('.scene-detail-options > summary').click();
  const time = page.getByRole('group', { name: 'Time of day' });
  const mood = page.getByRole('group', { name: 'Mood' });
  const camera = page.getByRole('group', { name: 'Camera' });
  await time.getByRole('button', { name: 'Getting dark' }).click();
  await camera.getByRole('button', { name: 'Looking down at them' }).click();
  await mood.getByRole('button', { name: 'Tense' }).click();
  await mood.getByRole('button', { name: 'Tense' }).click(); // tapping again clears it
  await expect(mood.getByRole('button', { name: 'Tense' })).toHaveAttribute('aria-pressed', 'false');
  await mood.getByRole('button', { name: 'Warm and safe' }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Make preview · about/ }).click();
  await expect(page.locator('.clip-label')).toContainText('In your cartoon', { timeout: 60_000 });
  await page.getByLabel('What happens?').fill('A blue leaf lands on a quiet pond.');
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/You changed this scene since making this clip/)).toBeVisible();
  // The writing stays editable after a preview; the final then follows the scene as it is now.
  await expect(page.getByText(/since the preview, so the final clip is made from the scene as it is now/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Make final clip · about/ })).toBeEnabled();
  await expect(page.locator('.clip-label')).toContainText('In your cartoon');
  await page.reload();
  await expect(page.getByLabel('What happens?')).toHaveValue('A blue leaf lands on a quiet pond.');
  await expect(page.getByLabel('Scene name', { exact: true })).toHaveValue('A leaf falls');
  await expect(page.locator('.scene-detail-options > summary')).toContainText('Getting dark');
  await page.locator('.scene-detail-options > summary').click();
  await expect(page.getByRole('group', { name: 'Time of day' }).getByRole('button', { name: 'Getting dark' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Camera' }).getByRole('button', { name: 'Looking down at them' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Mood' }).getByRole('button', { name: 'Warm and safe' })).toHaveAttribute('aria-pressed', 'true');
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
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Make preview · about/ })).toBeEnabled();
  await page.getByLabel('What happens?').fill('Saved even when I immediately switch scenes.');
  await page.getByRole('button', { name: '+ Add a page', exact: true }).click();
  await expect(page.getByLabel('Scene name', { exact: true })).toHaveValue('Scene 2');
  await page.getByRole('navigation', { name: 'Story pages' }).getByRole('button', { name: /01\s+Scene 1$/ }).click();
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
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  failure = 409;
  await page.getByLabel('What happens?').fill('Keep my new idea after a conflict.');
  await expect(page.getByRole('button', { name: 'Save my changes' })).toBeVisible();
  failure = 0;
  await page.getByRole('button', { name: 'Save my changes' }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('What happens?')).toHaveValue('Keep my new idea after a conflict.');
});

test('typing while a new scene is being added never overwrites the previous scene', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_GENERATION, 'requires fake generation');
  await workspace(page);
  await page.getByLabel('Scene name', { exact: true }).fill('Keep me');
  await page.getByLabel('What happens?').fill('The first scene must keep these words.');
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  // Hold the new scene's creation so the old editor is still on screen.
  let release!: () => void;
  const hold = new Promise<void>((r) => { release = r; });
  let held = false;
  await page.route('**/api/v1/projects/*/scenes', async (route) => {
    if (route.request().method() === 'POST' && !held) { held = true; await hold; }
    await route.continue();
  });
  await page.getByRole('button', { name: '+ Add a page', exact: true }).click();
  await expect.poll(() => held).toBe(true);
  await page.getByLabel('What happens?').click({ force: true, timeout: 2_000 }).catch(() => {});
  await page.keyboard.type('WRONG SCENE');
  release();
  await expect(page.getByLabel('Scene name', { exact: true })).toHaveValue('Scene 2');
  await page.getByRole('navigation', { name: 'Story pages' }).getByRole('button', { name: /01\s+Keep me$/ }).click();
  await expect(page.getByLabel('What happens?')).toHaveValue('The first scene must keep these words.');
  await expect(page.getByLabel('Scene name', { exact: true })).toHaveValue('Keep me');
});

test('Let AI help improves the scene in Create; nothing changes until the suggestion is chosen', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_GENERATION, 'requires fake generation');
  await workspace(page);
  const suggestion = 'A small white rabbit tiptoes through moonlit grass, ears twitching, toward a sleeping farmer.';
  let askedWith = '';
  // Only the AI replies are faked (tests never call Claude); saving the scene is real.
  await page.route('**/api/v1/settings/ai', (route) => route.fulfill({ json: { thumbnails_enabled: false, improve_enabled: true, daily_limit: 30, message: null } }));
  await page.route('**/api/v1/scenes/*/description-proposals**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'GET' && /description-proposals$/.test(url)) return route.fulfill({ json: { proposal: null } });
    if (request.method() === 'POST' && /description-proposals$/.test(url)) {
      const sceneId = url.split('/scenes/')[1]!.split('/')[0]!;
      askedWith = (await (await page.request.get(`/api/v1/scenes/${sceneId}`, { headers: { authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('storyboard.token'))}` } })).json()).description;
      return route.fulfill({ json: { id: 'p1', status: 'ready', preview: null, error: null, text: suggestion } });
    }
    if (request.method() === 'POST' && url.endsWith('/accept')) {
      // Stand in for the server applying the accepted text to the scene.
      const sceneId = url.split('/scenes/')[1]!.split('/')[0]!;
      const auth = { authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('storyboard.token'))}` };
      const scene = await (await page.request.get(`/api/v1/scenes/${sceneId}`, { headers: auth })).json();
      await page.request.patch(`/api/v1/scenes/${sceneId}`, { headers: { ...auth, 'if-match': String(scene.version) }, data: { description: suggestion } });
      return route.fulfill({ json: { status: 'accepted' } });
    }
    return route.fulfill({ json: { status: 'cancelled' } });
  });
  await page.reload();
  await page.getByLabel('What happens?').fill('Bunny sneaks past the farmer.');
  await page.getByText('✦ Let AI help', { exact: true }).click();
  await page.getByRole('button', { name: 'Improve for me' }).click();
  await expect(page.getByText(suggestion)).toBeVisible();
  expect(askedWith, 'the words were saved before asking for help').toBe('Bunny sneaks past the farmer.');
  await expect(page.getByLabel('What happens?')).toHaveValue('Bunny sneaks past the farmer.');
  await page.getByRole('button', { name: 'Use this description' }).click();
  await expect(page.getByLabel('What happens?')).toHaveValue(suggestion);
  await page.reload();
  await expect(page.getByLabel('What happens?')).toHaveValue(suggestion);
});
