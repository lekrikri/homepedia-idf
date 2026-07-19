const { test, expect } = require('@playwright/test');

test.describe('HomePedia IDF — Tests E2E', () => {

  test("Page d'accueil se charge", async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/HomePedia/i);
    await expect(page.locator('text=HomePedia')).toBeVisible({ timeout: 10000 });
  });

  test('Navigation vers la carte', async ({ page }) => {
    await page.goto('/carte');
    // Attendre que MapLibre se charge
    await page.waitForSelector('canvas', { timeout: 15000 });
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('Portfolio — simulation basique', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.locator('text=Rendement brut')).toBeVisible({ timeout: 10000 });
    // Vérifier que le calcul se met à jour (changer le prix)
    const input = page.locator('input[type=range]').first();
    if (await input.isVisible()) {
      await input.fill('400000');
    }
  });

  test('Portfolio — URL partageable', async ({ page }) => {
    await page.goto('/portfolio?prix=350000&loyer=1200&tmi=30&regime=reel');
    await expect(page.locator('text=Rendement')).toBeVisible({ timeout: 10000 });
  });

  test('Pareto Front se charge', async ({ page }) => {
    await page.goto('/pareto');
    await expect(page.locator('text=Pareto')).toBeVisible({ timeout: 15000 });
  });

  test('Transactions — tableau visible', async ({ page }) => {
    await page.goto('/transactions');
    await expect(page.locator('table, [role=table], text=Commune')).toBeVisible({ timeout: 15000 });
  });

  test('Chatbot — bouton visible', async ({ page }) => {
    await page.goto('/');
    // Le ChatWidget doit être visible
    const chatBtn = page.locator('[title*="chat"], [title*="Chat"], button:has(span:text("smart_toy"))').first();
    await expect(chatBtn).toBeVisible({ timeout: 10000 });
  });

  test('Page commune SEO', async ({ page }) => {
    await page.goto('/commune/versailles');
    await expect(page.locator('h1')).toContainText(/Versailles/i, { timeout: 15000 });
    // Vérifier meta description
    const desc = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');
    expect(desc.length).toBeGreaterThan(50);
  });

  test('Sitemap.xml accessible', async ({ page }) => {
    // Le sitemap est servi par le backend
    const response = await page.request.get('https://homepedia-backend-714876351060.europe-west1.run.app/sitemap.xml');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('<urlset');
    expect(body).toContain('versailles');
  });

  test("Search bar — saisie d'une commune", async ({ page }) => {
    await page.goto('/');
    const searchInput = page.locator('input[placeholder*="commune"], input[placeholder*="Commune"], input[placeholder*="Rechercher"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Versailles');
      await page.waitForTimeout(500);
      // Vérifier qu'une suggestion apparaît
      const suggestion = page.locator('text=Versailles').first();
      await expect(suggestion).toBeVisible({ timeout: 5000 });
    }
  });
});
