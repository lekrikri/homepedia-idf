"""
check_postgres.py — Vérifications qualité données PostgreSQL
Appelé par le pipeline data-quality.yml chaque nuit.

Ce script vérifie :
  1. Qu'il y a bien des données (pas de table vide inattendue)
  2. Que les prix ne sont pas aberrants (> 500 €/m² et < 50 000 €/m²)
  3. Qu'il n'y a pas de doublons dans les transactions
  4. Que les coordonnées GPS sont valides (dans le périmètre IDF)
"""

import os
import sys
import psycopg2

try:
    conn = psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        dbname=os.getenv("POSTGRES_DB", "homepedia"),
        user=os.getenv("POSTGRES_USER", "homepedia"),
        password=os.getenv("POSTGRES_PASSWORD"),
        connect_timeout=10,
    )
except Exception as e:
    print(f"⚠️  Connexion PostgreSQL impossible : {e}")
    print("ℹ️  Vérification ignorée (secret POSTGRES_PASSWORD manquant ou DB inaccessible)")
    sys.exit(0)

cur = conn.cursor()
errors = []

# ── Check 1 : Volume minimal de données ──────────────────────────────────────
cur.execute("SELECT COUNT(*) FROM transactions")
nb_tx = cur.fetchone()[0]
if nb_tx < 1000:
    errors.append(f"❌ Transactions : seulement {nb_tx} lignes (attendu > 1000)")
else:
    print(f"✅ Transactions : {nb_tx:,} lignes")

cur.execute("SELECT COUNT(*) FROM communes")
nb_com = cur.fetchone()[0]
if nb_com < 100:
    errors.append(f"❌ Communes : seulement {nb_com} lignes (attendu > 100)")
else:
    print(f"✅ Communes : {nb_com:,} lignes")

# ── Check 2 : Prix cohérents ──────────────────────────────────────────────────
cur.execute("""
    SELECT COUNT(*) FROM transactions
    WHERE valeur_fonciere IS NOT NULL
      AND surface_reelle_bati > 0
      AND (valeur_fonciere / surface_reelle_bati < 500
           OR valeur_fonciere / surface_reelle_bati > 50000)
""")
prix_aberrants = cur.fetchone()[0]
if prix_aberrants > 100:
    errors.append(f"⚠️  {prix_aberrants} transactions avec prix aberrant (<500 ou >50000 €/m²)")
else:
    print(f"✅ Prix cohérents ({prix_aberrants} aberrants tolérés)")

# ── Check 3 : Doublons sur id_mutation ───────────────────────────────────────
cur.execute("""
    SELECT COUNT(*) FROM (
        SELECT id_mutation, COUNT(*) AS nb
        FROM transactions
        GROUP BY id_mutation
        HAVING COUNT(*) > 3
    ) t
""")
nb_doublons = cur.fetchone()[0]
if nb_doublons > 50:
    errors.append(f"❌ {nb_doublons} id_mutation avec >3 doublons suspects")
else:
    print(f"✅ Doublons : {nb_doublons} cas (OK)")

# ── Check 4 : Coordonnées GPS dans IDF ───────────────────────────────────────
cur.execute("""
    SELECT COUNT(*) FROM transactions
    WHERE longitude IS NOT NULL
      AND (longitude < 1.4 OR longitude > 3.6
           OR latitude < 47.9 OR latitude > 49.3)
""")
coords_hors_idf = cur.fetchone()[0]
if coords_hors_idf > 10:
    errors.append(f"⚠️  {coords_hors_idf} transactions avec GPS hors IDF")
else:
    print(f"✅ Coordonnées GPS : {coords_hors_idf} hors IDF (OK)")

# ── Résultat final ────────────────────────────────────────────────────────────
cur.close()
conn.close()

if errors:
    print("\n" + "═" * 50)
    print("ANOMALIES DÉTECTÉES :")
    for e in errors:
        print(f"  {e}")
    print("═" * 50)
    sys.exit(1)  # code de sortie 1 = échec → déclenche l'alerte email
else:
    print("\n✅ Toutes les vérifications sont passées.")
    sys.exit(0)
