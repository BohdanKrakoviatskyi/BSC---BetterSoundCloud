import { expect, test } from '@playwright/test';

test('navigation and appearance preferences persist between launches', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good evening' })).toBeVisible();

  await page.getByRole('button', { name: 'Playlists' }).click();
  await expect(page.getByRole('heading', { name: 'Your playlists will live here' })).toBeVisible();
  await page.getByRole('button', { name: 'Saved songs' }).click();
  await expect(page.getByRole('heading', { name: 'Your music collection' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open audio file' })).toBeVisible();

  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.locator('.settings-dialog select').nth(0).selectOption('dark');
  await page.locator('.settings-dialog select').nth(1).selectOption('spotify');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.reload();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.dock-source')).toContainText('spotify');
});
