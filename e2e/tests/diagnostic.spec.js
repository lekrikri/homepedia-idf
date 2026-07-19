const { test } = require("@playwright/test");

/**
 * Diagnostic : que se passe-t-il réellement dans l'autocomplete de commune ?
 * Les tests de parcours échouent au clic sur la suggestion, il faut voir ce que
 * la liste propose avant de corriger le sélecteur — ou le composant.
 */
test("autocomplete commune sur /estimation", async ({ page }) => {
  const erreurs = [];
  page.on("console", m => m.type() === "error" && erreurs.push(m.text().slice(0, 160)));
  page.on("pageerror", e => erreurs.push("pageerror: " + String(e).slice(0, 160)));

  await page.goto("/estimation");
  await page.waitForTimeout(2500); // chargement de la liste des communes

  const champ = page.getByPlaceholder(/Aubervilliers/);
  console.log("  champ commune visible :", await champ.isVisible());

  await champ.fill("Auber");
  await page.waitForTimeout(1200);

  // Combien de suggestions, et que contiennent-elles ?
  const boutons = page.locator("button").filter({ hasText: /Auber/i });
  const n = await boutons.count();
  console.log("  suggestions contenant 'Auber' :", n);
  for (let i = 0; i < Math.min(n, 5); i++) {
    console.log(`    [${i}] ${(await boutons.nth(i).innerText()).replace(/\n/g, " | ")}`);
  }

  await page.screenshot({ path: "resultats/diag-autocomplete.png", fullPage: true });
  console.log("  erreurs console :", erreurs.length ? erreurs.join(" || ") : "aucune");
});

test("etat de la page /loyer", async ({ page }) => {
  const erreurs = [];
  page.on("console", m => m.type() === "error" && erreurs.push(m.text().slice(0, 160)));
  page.on("pageerror", e => erreurs.push("pageerror: " + String(e).slice(0, 160)));

  await page.goto("/loyer");
  await page.waitForTimeout(2500);

  await page.getByPlaceholder(/Aubervilliers/).fill("Paris");
  await page.waitForTimeout(1200);
  const suggestions = page.locator("button").filter({ hasText: /Paris/i });
  const n = await suggestions.count();
  console.log("  suggestions 'Paris' :", n);
  for (let i = 0; i < Math.min(n, 4); i++) {
    console.log(`    [${i}] ${(await suggestions.nth(i).innerText()).replace(/\n/g, " | ")}`);
  }

  if (n > 0) {
    await suggestions.first().click();
    await page.getByPlaceholder("40").fill("40");
    await page.getByPlaceholder("750").fill("1600");
    await page.getByRole("button", { name: "Vérifier" }).click();
    await page.waitForTimeout(6000);
    const texte = await page.locator("body").innerText();
    console.log("  'Verdict' présent      :", texte.includes("Verdict"));
    console.log("  'plafond légal' présent:", texte.includes("plafond légal"));
    console.log("  'encadrement' présent  :", /encadrement/i.test(texte));
    await page.screenshot({ path: "resultats/diag-loyer.png", fullPage: true });
  }
  console.log("  erreurs console :", erreurs.length ? erreurs.join(" || ") : "aucune");
});
