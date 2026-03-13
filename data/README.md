# data/

This directory contains Databricks notebooks and data pipeline definitions for the HomePedia IDF platform.

## Structure (planned)

```
data/
├── notebooks/        # Databricks notebooks (.py / .ipynb)
│   ├── ingestion/    # DVF, INSEE, DPE raw data ingestion
│   ├── transform/    # Cleaning, enrichment, feature engineering
│   └── export/       # Export to PostgreSQL / MongoDB Atlas
├── pipelines/        # Pipeline orchestration configs (e.g., Databricks Workflows)
├── schemas/          # JSON / Avro schemas for datasets
└── sql/              # DDL scripts for PostgreSQL + PostGIS
```

## Data sources

- **DVF** (Demandes de Valeurs Foncières) — property transaction records
- **INSEE** — demographic and socio-economic data by commune / IRIS
- **DPE** (Diagnostic de Performance Energétique) — energy efficiency ratings
- **IGN / OpenStreetMap** — geospatial layers for Île-de-France

## Notes

- Raw data files (`.parquet`, `.csv`) are excluded from version control via `.gitignore`.
- Processed data is written to PostgreSQL (PostGIS) for the API and MongoDB Atlas for document-style queries.
- ChromaDB is used for vector embeddings (semantic search over property descriptions).
