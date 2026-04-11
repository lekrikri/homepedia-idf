# HomePedia DBT — Pipeline de transformation SQL

## Pourquoi DBT plutôt que Spark ?

| Critère | Spark (PySpark) | DBT + BigQuery |
|---|---|---|
| Langage | Python + API Spark | **SQL pur** |
| Coût | Cluster Databricks (€€€) | **BigQuery free tier** (1TB/mois) |
| Tests qualité | Manuels | **Intégrés** (schema.yml) |
| Documentation | À part | **Auto-générée** (`dbt docs`) |
| Courbe d'apprentissage | Steep | **Faible** (SQL = universel) |
| Débogage | Logs Spark complexes | **SQL lisible** |

## Architecture du pipeline

```
GCS Parquet (bronze/dvf/, bronze/dpe/)
        ↓
   BigQuery raw tables (chargement externe)
        ↓
   bronze_transactions / bronze_dpe     ← vue, données brutes
        ↓ (nettoyage, déduplication, filtrage)
   silver_transactions / silver_dpe     ← table incrémentale
        ↓ (agrégation par commune)
   gold_communes_agregat                ← table finale
        ↓
   Export → Supabase PostgreSQL (API Go → Frontend)
```

## Tests qualité intégrés

### Tests automatiques (schema.yml)
- `unique` + `not_null` sur toutes les clés primaires
- `accepted_values` sur classe_energie (A-G), categorie (appartement/maison/...)
- `expression_is_true` sur prix_m2 (500-50000 €/m²), score_dpe (1-7)

### Tests personnalisés (tests/)
| Test | Ce qu'il vérifie |
|---|---|
| `test_no_paris_arrondissements` | Paris normalisé en 75056 |
| `test_silver_no_doublons` | Pas de doublons après déduplication |
| `test_gold_volume_minimum` | Gold contient >= 900 communes |
| `test_prix_coherents` | Prix médians entre 1000 et 20000 €/m² |

## Lancer le pipeline

```bash
# Installer les dépendances
dbt deps

# Vérifier la syntaxe SQL sans exécuter
dbt compile

# Exécuter + tester en une commande
dbt build

# Générer la documentation interactive
dbt docs generate && dbt docs serve
```

## Alerting

Si un test échoue → GitHub Actions envoie un email à `ludovicbetam@gmail.com`
(configuré dans `.github/workflows/data-quality.yml`)
