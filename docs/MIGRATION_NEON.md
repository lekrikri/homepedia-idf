# Runbook — Migration Supabase → Neon (HomePedia IDF)

> ✅ **MIGRATION EFFECTUÉE le 21/10/2026.** Base sur Neon (Frankfurt, 1 Go, PG18),
> 22 tables migrées (transactions 867 877, rag_documents 5 117 + embeddings, postgis OK),
> backend/RAG/chatbot repointés et testés (latence 21 ms). Supabase gardé en **fallback**
> quelques jours. Reste : décommissionner Supabase + (option) secret GitHub `POSTGRES_PASSWORD`.
> Ce document reste la référence du *comment* (et du rollback).

> Plan de bascule de la base PostgreSQL de **Supabase (free)** vers **Neon (free)**.
> HomePedia utilise Supabase **uniquement comme Postgres** (pas de Storage/Auth/Realtime :
> documents en `bytea`, auth JWT dans le backend Go) → migration = `pg_dump`/`pg_restore`.
>
> **Ne rien supprimer côté Supabase tant que la bascule n'est pas validée** (rollback).
> **Aucun mot de passe en clair ici** (repo public) : tout passe par des variables d'env.

---

## 0. Décision préalable — quelle limite dépasse-t-on ?

Avant de migrer, vérifier **Supabase → Settings → Usage** :

- **Taille DB** (~461/500 Mo) → Neon (1 Go) résout. ✅ migrer a du sens.
- **Egress / bande passante** (5 Go/mois) → **Neon free a aussi un cap egress** → migrer ne
  résout rien ; le vrai fix est le cache (déjà en place) ou réduire les payloads.

Migrer surtout si c'est la **taille** ou la **pause 7 j** qui gênent.

---

## 1. Ce qui doit exister sur Neon (cible)

- Compte Neon + projet, **région UE** proche de Cloud Run `europe-west1` → **AWS `eu-central-1` (Frankfurt)** (latence backend↔DB ~qq ms).
- Récupérer **2 chaînes de connexion** :
  - **pooled** (`...-pooler.eu-central-1.aws.neon.tech`) → pour l'**app** (backend, RAG, chatbot).
  - **direct** (sans `-pooler`) → pour le **dump/restore** et les migrations.
- Free tier : 1 Go stockage, 100 CU-h/mois, **scale-to-zero** (auto-suspend ~5 min, reprise ~2-5 s). Pas de pause 7 j, **pas besoin de keep-alive**.

### Extensions à activer sur Neon AVANT le restore
```sql
-- sur la base Neon (via psql "$NEON_DIRECT_URL")
CREATE EXTENSION IF NOT EXISTS postgis;        -- 3.3+ (tuiles MVT, geometry)
CREATE EXTENSION IF NOT EXISTS vector;         -- pgvector (RAG, embeddings 768-dim)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```
> **On IGNORE** `supabase_vault` (spécifique Supabase, non utilisé par l'app) et
> `postgis_topology` (installé mais a priori non utilisé — à confirmer : `\dn` ne doit pas
> montrer de table `topology.*` peuplée). `pg_stat_statements` : optionnel.

### Rôles Supabase référencés par les policies RLS
Les policies RLS (`backend/migrations/003_rls_policies.sql`) ciblent des rôles Supabase.
Les créer en NOLOGIN sur Neon **avant le restore**, sinon les `CREATE POLICY ... TO <role>` échouent :
```sql
CREATE ROLE IF NOT EXISTS service_role NOLOGIN;
CREATE ROLE IF NOT EXISTS authenticated NOLOGIN;
CREATE ROLE IF NOT EXISTS anon NOLOGIN;
-- (Postgres < 16 n'a pas IF NOT EXISTS sur ROLE : encadrer d'un DO $$ ... $$ ou ignorer l'erreur "already exists".)
```
> Le backend Go se connecte avec un rôle privilégié et **bypasse la RLS** (cf. commentaire
> migration 003) : ces rôles ne servent qu'à faire passer le restore des policies.

---

## 2. Dump depuis Supabase (source)

```bash
# Chaîne DIRECTE Supabase (Settings → Database → Connection string → URI).
# NE PAS commiter ce mot de passe ; export en session uniquement.
export SUPABASE_DB_URL='postgresql://postgres:<MDP>@db.iugsfmvqddburvufzacy.supabase.co:5432/postgres?sslmode=require'

pg_dump "$SUPABASE_DB_URL" \
  --format=custom \
  --no-owner --no-privileges \
  --schema=public \
  --exclude-table=spatial_ref_sys \
  --exclude-table-data=audit_logs \
  -f homepedia.dump
```
- `--no-owner --no-privileges` : évite les erreurs sur les rôles/ownership Supabase.
- `--schema=public` : ne migre QUE les données de l'app (ignore `auth`, `storage`, `vault`, `realtime`… internes à Supabase).
- `--exclude-table=spatial_ref_sys` : cette table est **recréée par l'extension postgis** → éviter les conflits au restore.
- `--exclude-table-data=audit_logs` : optionnel (logs jetables).

> Si la connexion directe Supabase échoue (IPv6), utiliser le **Session Pooler** (port 5432,
> user `postgres.iugsfmvqddburvufzacy`) comme source du `pg_dump`.

---

## 3. Restore vers Neon (cible)

```bash
export NEON_DIRECT_URL='postgresql://<user>:<MDP>@ep-xxx.eu-central-1.aws.neon.tech/<db>?sslmode=require'

# 1) Extensions + rôles (section 1) d'abord :
psql "$NEON_DIRECT_URL" -f prep_neon.sql   # contient les CREATE EXTENSION + CREATE ROLE

# 2) Restore des données :
pg_restore --no-owner --no-privileges \
  --disable-triggers \
  -d "$NEON_DIRECT_URL" \
  homepedia.dump
```
- Quelques **warnings** sont normaux (ex. `spatial_ref_sys` déjà présent, extensions déjà créées) → non bloquants.
- Si l'index pgvector (ivfflat/hnsw) n'est pas recréé proprement : `REINDEX TABLE rag_documents;`
  ou recréer l'index depuis `rag/02_index_pgvector.py` / `05_index_legal_prod.py`.

---

## 4. Vérification (avant de basculer quoi que ce soit)

```sql
-- comptes RÉELS (pg_stat est faux après un ANALYZE manquant) :
SELECT 'transactions'      AS t, count(*) FROM transactions       -- attendu 867 877
UNION ALL SELECT 'communes_agregat', count(*) FROM communes_agregat  -- 1 268
UNION ALL SELECT 'rag_documents',    count(*) FROM rag_documents      -- 5 117
UNION ALL SELECT 'poi_communes',     count(*) FROM poi_communes;      -- 1 268

-- pgvector OK :
SELECT count(*) FROM rag_documents WHERE embedding IS NOT NULL;  -- ~5 117
-- postgis OK (tuiles) :
SELECT postgis_version();
SELECT count(*) FROM communes_agregat WHERE centroid_lon IS NOT NULL;

ANALYZE;  -- rafraîchir les stats du planner sur la nouvelle base
```

---

## 5. Repointer TOUS les services vers Neon

La chaîne Postgres est définie à **beaucoup** d'endroits (`grep -rl "pooler.supabase\|iugsfmvqddburvufzacy\|POSTGRES_HOST"`). À mettre à jour :

| Où | Quoi changer |
|---|---|
| **Secret Manager GCP** | `homepedia-supabase-password` → nouvelle valeur (MDP Neon). Idéalement créer `homepedia-neon-password` et pointer dessus. |
| **Cloud Run `homepedia-backend`** | env `POSTGRES_HOST/PORT/DB/USER/SSLMODE` (host pooler Neon, user Neon, `sslmode=require`) + secret MDP. Défini dans `cloudbuild.yaml`. |
| **Cloud Run `homepedia-rag`** | même DB (pgvector). Voir `cloudbuild-rag.yaml`. |
| **Cloud Run `homepedia-chat`** | requêtes SQL communes. Voir `cloudbuild-chatbot.yaml`. |
| **`cloudbuild.yaml`** | étape 0 quality-check (env POSTGRES_*) **et** `deploy-backend` (`--set-env-vars`). |
| **GitHub secret `POSTGRES_PASSWORD`** | utilisé par `data-quality.yml` ; host/user Neon dans ces workflows. |
| **`.github/workflows/keep-alive.yml`** | **SUPPRIMER** (Neon reprend tout seul, plus besoin). |
| **Scripts d'ingestion** (`ingestion/**`, `.github/scripts/check_postgres.py`, `chatbot/sql_executor.py`, `data/silver_to_postgres.py`) | `DATABASE_URL` / `POSTGRES_*` locaux. |
| **`backend/internal/db/db.go`** | aucune modif code (lit les env vars) — vérifier que pgx accepte le pooler Neon. |

> **Note pooler Neon** : le pooler Neon (PgBouncer, mode transaction) ne supporte pas les
> *prepared statements* nommés persistants. Avec **pgx** (Go), utiliser la connexion
> **pooled** avec `default_query_exec_mode=simple_protocol` OU `statement_cache_mode=describe`
> si des erreurs « prepared statement already exists » apparaissent. Pour les **scripts
> Python/psycopg2**, préférer la connexion **directe** (pas le pooler).

---

## 6. Bascule (cutover) + rollback

1. Déployer backend + RAG + chatbot avec la **nouvelle** chaîne → ils tapent sur Neon.
2. Tester **end-to-end** : carte (tuiles MVT = postgis), transactions, estimation,
   **RAG légal** (pgvector), gestion locative (upload/download doc = bytea), chatbot.
3. **Garder Supabase vivant 3-7 jours** (fallback). En cas de pépin : remettre les anciennes
   env/secret → retour instantané sur Supabase. C'est pour ça qu'on ne supprime rien tout de suite.

---

## 7. Nettoyage post-migration (après période de confiance)

- Supprimer `keep-alive.yml` (déjà fait en 5) + le secret associé si inutile.
- Mettre à jour la mémoire / `T-DAT-902.md` avec la connexion Neon.
- Mettre en pause ou supprimer le projet Supabase.
- `VACUUM ANALYZE` global sur Neon.

---

## Risques / pièges à connaître

- **PostGIS** : c'est la partie la plus délicate du dump/restore. Activer l'extension **avant**, exclure `spatial_ref_sys` du dump. Vérifier les tuiles MVT après bascule.
- **Cold start Neon** (~2-5 s à la 1ʳᵉ requête après auto-suspend) : acceptable pour un portfolio, mais un recruteur qui clique attend un peu. Option : compute minimal non nul (consomme des CU-h) si on veut éviter le froid.
- **Pooler Neon + pgx** : voir note §5 (prepared statements).
- **Egress** : si c'était ça le problème Supabase, Neon ne le règle pas.
- **Rôles RLS** : créer `service_role/authenticated/anon` avant restore (§1).

---

## Checklist express

- [ ] Identifier la limite dépassée (§0)
- [ ] Projet Neon UE + 2 chaînes (pooled/direct) (§1)
- [ ] Extensions + rôles sur Neon (§1)
- [ ] `pg_dump` Supabase (§2)
- [ ] `pg_restore` Neon (§3)
- [ ] Vérif comptes + pgvector + postgis (§4)
- [ ] Repointer backend / RAG / chatbot / CI / scripts (§5)
- [ ] Supprimer keep-alive (§5)
- [ ] Cutover + tests end-to-end, Supabase gardé en fallback (§6)
- [ ] Nettoyage après 3-7 j OK (§7)

Voir aussi [[homepedia_supabase_quota]] (quota 500 Mo) et le README.
