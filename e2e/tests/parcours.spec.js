const { test, expect } = require("@playwright/test");

/**
 * Vérification visuelle des trois parcours livrés.
 *
 * Ces écrans ont été construits, déployés et validés par leurs API sans qu'aucun
 * navigateur ne les ait jamais rendus. Ces tests exercent le parcours réel — on
 * remplit, on soumet, on regarde ce qui s'affiche — et capturent les erreurs de
 * console, qui sont le symptôme le plus courant d'un composant cassé.
 */

// Une page qui déborde horizontalement est le défaut le plus visible sur mobile.
async function debordeHorizontalement(page) {
  return page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  );
}

function collecterErreurs(page) {
  const erreurs = [];
  page.on("console", m => {
    if (m.type() === "error") erreurs.push(m.text().slice(0, 200));
  });
  page.on("pageerror", e => erreurs.push("pageerror: " + String(e).slice(0, 200)));
  return erreurs;
}

test.describe("Parcours acheteur et locataire", () => {

  // Le didacticiel s'ouvre automatiquement au premier passage et couvre toute la
  // page (fixed inset-0 z-[200]) : sans cela, chaque clic est intercepté. On se
  // place donc dans la peau d'un utilisateur qui l'a déjà vu.
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => localStorage.setItem("hp_tour_done", "1"));
  });

  test("Dossier — recherche multi-communes", async ({ page }) => {
    const erreurs = collecterErreurs(page);
    await page.goto("/dossier");

    await expect(page.getByRole("heading", { name: /Dossier de recherche/i })).toBeVisible();

    // La recherche se lance seule au premier rendu : on attend le tableau.
    const lignes = page.locator("table tbody tr");
    await expect(lignes.first()).toBeVisible({ timeout: 30000 });
    const n = await lignes.count();
    expect(n).toBeGreaterThan(3);

    // Le critère doit changer le classement, c'est tout l'intérêt de l'écran.
    const premiereAvant = await lignes.first().innerText();
    await page.getByRole("button", { name: "La qualité énergétique" }).click();
    await page.getByRole("button", { name: "Chercher" }).click();
    await page.waitForTimeout(4000);
    const premiereApres = await lignes.first().innerText();

    await page.screenshot({ path: "resultats/dossier.png", fullPage: true });
    console.log(`  communes affichées : ${n}`);
    console.log(`  1re par prix   : ${premiereAvant.split("\n")[0]}`);
    console.log(`  1re par DPE    : ${premiereApres.split("\n")[0]}`);
    console.log(`  erreurs console: ${erreurs.length ? erreurs.join(" | ") : "aucune"}`);
    expect(erreurs).toHaveLength(0);
  });

  test("Estimation — parcours complet", async ({ page }) => {
    const erreurs = collecterErreurs(page);
    await page.goto("/estimation");

    // Sélection de commune via l'autocomplete.
    await page.getByPlaceholder(/Aubervilliers/).fill("Aubervilliers");
    await page.locator("button").filter({ hasText: /^Aubervilliers/ }).first().click();
    await page.getByPlaceholder("40").fill("40");
    await page.getByPlaceholder("185000").fill("185000");
    await page.getByRole("button", { name: "Estimer" }).click();

    // Le percentile est le cœur du résultat.
    await expect(page.getByText(/percentile/i).first()).toBeVisible({ timeout: 30000 });

    const blocs = {
      "distribution": /Distribution des ventes/i,
      "coût de détention": /Ce que le bien coûtera ensuite/i,
      "copropriété": /Le parc en copropriété/i,
      "DPE adresse": /Le DPE à cette adresse/i,
      "capacité d'emprunt": /Puis-je l'acheter/i,
      "travaux": /Chiffrer les travaux/i,
      "conseils": /Comment lire ce résultat/i,
    };
    for (const [nom, motif] of Object.entries(blocs)) {
      const vu = await page.getByText(motif).first().isVisible().catch(() => false);
      console.log(`  bloc ${nom.padEnd(20)} : ${vu ? "affiché" : "ABSENT"}`);
    }

    await page.screenshot({ path: "resultats/estimation.png", fullPage: true });
    console.log(`  débordement horizontal : ${await debordeHorizontalement(page)}`);
    console.log(`  erreurs console: ${erreurs.length ? erreurs.join(" | ") : "aucune"}`);
    expect(erreurs).toHaveLength(0);
  });

  test("Loyer — contrôle de l'encadrement", async ({ page }) => {
    const erreurs = collecterErreurs(page);
    await page.goto("/loyer");

    await page.getByPlaceholder(/Aubervilliers/).fill("Paris");
    await page.locator("button").filter({ hasText: /^Paris/ }).first().click();
    await page.getByPlaceholder("40").fill("40");
    await page.getByPlaceholder("750").fill("1600");
    await page.getByRole("button", { name: "Vérifier" }).click();

    // À 40 €/m² sur Paris, le dépassement doit être détecté et chiffré.
    await expect(page.getByText(/dépasse le plafond légal/i)).toBeVisible({ timeout: 30000 });
    const recuperable = await page.getByText(/Récupérable sur 3 ans/i).isVisible().catch(() => false);

    await page.screenshot({ path: "resultats/loyer.png", fullPage: true });
    console.log(`  dépassement détecté   : oui`);
    console.log(`  montant récupérable   : ${recuperable ? "affiché" : "ABSENT"}`);
    console.log(`  erreurs console: ${erreurs.length ? erreurs.join(" | ") : "aucune"}`);
    expect(erreurs).toHaveLength(0);
  });

  test("Coller une annonce", async ({ page }) => {
    await page.goto("/estimation");
    await page.getByRole("button", { name: /Coller une annonce/i }).click();
    await page.locator("textarea").fill(
      "Appartement 2 pièces 40 m² - 185 000 €\n93300 Aubervilliers\nDPE : D. Charges 120 €/mois."
    );
    await page.waitForTimeout(600);

    // Les champs extraits sont annoncés sous forme de puces.
    const prix = await page.getByText(/Prix · 185/).isVisible().catch(() => false);
    const commune = await page.getByText(/Commune · Aubervilliers/).isVisible().catch(() => false);
    console.log(`  prix extrait    : ${prix}`);
    console.log(`  commune extraite: ${commune}`);
    await page.screenshot({ path: "resultats/annonce.png" });
    expect(prix && commune).toBeTruthy();
  });

  test("Didacticiel — sommaire cherchable", async ({ page }) => {
    await page.goto("/");
    // Le tour s'ouvre depuis l'icône d'aide de l'en-tête.
    const aide = page.locator("header").getByText("help", { exact: true });
    if (await aide.isVisible().catch(() => false)) {
      await aide.click();
      await page.waitForTimeout(800);
      const ouvert = await page.getByText(/Étape 1 \/ 12/).isVisible().catch(() => false);
      console.log(`  didacticiel ouvert : ${ouvert}`);
      if (ouvert) {
        await page.getByTitle("Chercher une rubrique").click();
        await page.getByPlaceholder(/Chercher une rubrique/).fill("loyer");
        await page.waitForTimeout(400);
        await page.screenshot({ path: "resultats/didacticiel.png" });
      }
    } else {
      console.log("  bouton d'aide introuvable dans l'en-tête");
    }
  });
});
