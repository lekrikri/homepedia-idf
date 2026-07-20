const { test, expect } = require("@playwright/test");

test("le didacticiel ne bloque plus les pages internes", async ({ page }) => {
  await page.goto("/estimation");
  await page.waitForTimeout(2500);
  const bloque = await page.locator(".fixed.inset-0").filter({ hasText: /Étape/ }).isVisible().catch(() => false);
  console.log("  didacticiel ouvert sur /estimation :", bloque, bloque ? "(PROBLEME)" : "(corrige)");
  expect(bloque).toBeFalsy();
});

test("le sommaire s ouvre en premier sur l accueil", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2500);
  const champ = page.getByPlaceholder(/Chercher une rubrique/);
  const visible = await champ.isVisible().catch(() => false);
  console.log("  champ de recherche visible d emblee :", visible);
  if (visible) {
    await champ.fill("loyer");
    await page.waitForTimeout(400);
    const n = await page.locator("button").filter({ hasText: /Ce loyer est-il correct/ }).count();
    console.log("  rubrique 'loyer' trouvee :", n > 0);
    await page.screenshot({ path: "resultats/didacticiel-sommaire.png" });
  }
  expect(visible).toBeTruthy();
});
