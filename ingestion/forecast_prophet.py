#!/usr/bin/env python3
"""
HomePedia — Prévision des prix immobiliers par commune (Prophet).

Pipeline :
  1. Lit le prix médian/m² annuel par commune depuis `transactions` (DVF 2019-2024)
  2. Entraîne un modèle Prophet par commune (min 3 années de données)
  3. Génère les prévisions 2025 et 2026 avec intervalles de confiance 80%
  4. Écrit le tout dans `prix_forecast` (historique + prévisions)

Usage :
  pip install prophet psycopg2-binary pandas
  python ingestion/forecast_prophet.py
"""

import os
import logging
from datetime import datetime

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from prophet import Prophet

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# Supabase connection (pooler)
DB_DSN = (
    "host=aws-0-eu-west-1.pooler.supabase.com "
    "port=5432 "
    "user=postgres.iugsfmvqddburvufzacy "
    "dbname=postgres "
    "sslmode=require "
    f"password={os.getenv('POSTGRES_PASSWORD')}"
)

# Années de prévision à générer (après les données historiques)
FORECAST_YEARS = [2025, 2026]
# Nombre minimum d'années historiques pour entraîner Prophet
MIN_YEARS = 3


def fetch_historique(conn) -> pd.DataFrame:
    """Charge le prix médian/m² annuel par commune depuis les transactions DVF."""
    sql = """
        SELECT
            code_commune,
            date_part('year', date_mutation)::int AS annee,
            ROUND(
                PERCENTILE_CONT(0.5) WITHIN GROUP (
                    ORDER BY valeur_fonciere / NULLIF(surface_reelle_bati, 0)
                )::numeric, 0
            ) AS prix_m2,
            COUNT(*) AS nb_transactions
        FROM transactions
        WHERE valeur_fonciere IS NOT NULL
          AND surface_reelle_bati > 5
          AND valeur_fonciere / surface_reelle_bati BETWEEN 500 AND 50000
          AND type_local IN ('Appartement', 'Maison')
          AND code_commune IS NOT NULL
        GROUP BY code_commune, annee
        ORDER BY code_commune, annee
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=["code_commune", "annee", "prix_m2", "nb_transactions"])
    log.info(f"📊 {len(df)} points historiques chargés ({df['code_commune'].nunique()} communes)")
    return df


def run_prophet(commune_df: pd.DataFrame) -> pd.DataFrame | None:
    """
    Entraîne Prophet sur la série temporelle d'une commune.
    Retourne un DataFrame avec colonnes : annee, prix_m2_pred, prix_m2_lower, prix_m2_upper, is_forecast
    """
    if len(commune_df) < MIN_YEARS:
        return None

    # Prophet attend : ds (date), y (valeur)
    train = pd.DataFrame({
        "ds": pd.to_datetime(commune_df["annee"].astype(str) + "-07-01"),
        "y": commune_df["prix_m2"].astype(float),
    })

    # Modèle conservative : croissance linéaire, intervalles 80%
    # changepoint_prior_scale faible = tendance lisse (évite surajustement sur 5 points)
    m = Prophet(
        growth="linear",
        yearly_seasonality=False,
        weekly_seasonality=False,
        daily_seasonality=False,
        interval_width=0.80,
        changepoint_prior_scale=0.05,
    )
    m.fit(train)

    # Prévisions pour les années futures
    last_year = commune_df["annee"].max()
    future_years = [y for y in FORECAST_YEARS if y > last_year]
    if not future_years:
        return None

    future_dates = pd.DataFrame({
        "ds": pd.to_datetime([f"{y}-07-01" for y in future_years])
    })
    forecast = m.predict(future_dates)

    rows = []
    # Historique : pred = valeur réelle, sans intervalles
    for _, row in commune_df.iterrows():
        rows.append({
            "annee": int(row["annee"]),
            "prix_m2_pred": round(float(row["prix_m2"]), 0),
            "prix_m2_lower": None,
            "prix_m2_upper": None,
            "is_forecast": False,
        })
    # Prévisions
    for _, frow in forecast.iterrows():
        y = int(frow["ds"].year)
        # Clamp : le prix ne peut pas descendre sous 1000 ni exploser × 3 vs dernier connu
        last_known = float(commune_df["prix_m2"].iloc[-1])
        pred = max(1000.0, min(float(frow["yhat"]), last_known * 3))
        lower = max(500.0, float(frow["yhat_lower"]))
        upper = max(pred, float(frow["yhat_upper"]))
        rows.append({
            "annee": y,
            "prix_m2_pred": round(pred, 0),
            "prix_m2_lower": round(lower, 0),
            "prix_m2_upper": round(upper, 0),
            "is_forecast": True,
        })

    return pd.DataFrame(rows)


def upsert_forecasts(conn, records: list[tuple]) -> None:
    sql = """
        INSERT INTO prix_forecast
            (code_commune, annee, prix_m2_pred, prix_m2_lower, prix_m2_upper, is_forecast, generated_at)
        VALUES %s
        ON CONFLICT (code_commune, annee) DO UPDATE SET
            prix_m2_pred  = EXCLUDED.prix_m2_pred,
            prix_m2_lower = EXCLUDED.prix_m2_lower,
            prix_m2_upper = EXCLUDED.prix_m2_upper,
            is_forecast   = EXCLUDED.is_forecast,
            generated_at  = EXCLUDED.generated_at
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, records, template=None, page_size=500)
    conn.commit()


def main():
    log.info("🚀 Démarrage forecast Prophet HomePedia...")
    conn = psycopg2.connect(DB_DSN)

    try:
        df = fetch_historique(conn)
        communes = df["code_commune"].unique()
        log.info(f"🏘️  {len(communes)} communes à traiter")

        all_records = []
        ok, skip = 0, 0
        now = datetime.utcnow()

        for code in communes:
            commune_df = df[df["code_commune"] == code].copy()
            result = run_prophet(commune_df)
            if result is None:
                skip += 1
                continue
            for _, row in result.iterrows():
                all_records.append((
                    code,
                    int(row["annee"]),
                    row["prix_m2_pred"],
                    row["prix_m2_lower"],
                    row["prix_m2_upper"],
                    bool(row["is_forecast"]),
                    now,
                ))
            ok += 1
            if ok % 100 == 0:
                log.info(f"  → {ok}/{len(communes)} communes traitées")

        log.info(f"✅ {ok} communes modélisées, {skip} ignorées (<{MIN_YEARS} ans)")
        log.info(f"💾 Upsert {len(all_records)} lignes dans prix_forecast...")
        upsert_forecasts(conn, all_records)
        log.info("🎉 Forecast Prophet terminé !")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
