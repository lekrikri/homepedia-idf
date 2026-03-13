# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet
**HomePedia IDF** — Epitech T-DAT-902
Plateforme de données immobilières pour l'Île-de-France, avec visualisation géospatiale 3D.

## Stack technique

### Data & Cloud
- **Azure Databricks** : traitement et pipelines de données (`https://adb-7405612925607784.4.azuredatabricks.net`)
- **PostgreSQL + PostGIS** : données géospatiales et requêtes spatiales
- **MongoDB Atlas** : données non structurées / documents
- **Redis** : cache et sessions
- **ChromaDB** : vector store pour recherche sémantique / RAG

### Backend
- **Go + Gin** : API REST avec préfixe `/api/v1/`
  - `cmd/` : points d'entrée
  - `internal/handlers/` : handlers HTTP
  - `internal/models/` : modèles de données
  - `internal/services/` : logique métier
  - `pkg/` : packages réutilisables

### Frontend
- **React** : composants fonctionnels + hooks uniquement (pas de class components)
- **CesiumJS** : visualisation 3D géospatiale (globe, bâtiments)
- **MapLibre** : cartes 2D interactives

## Structure cible
```
homepedia/
├── backend/          # Go/Gin API
│   ├── cmd/
│   ├── internal/
│   │   ├── handlers/
│   │   ├── models/
│   │   └── services/
│   └── pkg/
├── frontend/         # React + CesiumJS + MapLibre
│   ├── src/
│   └── public/
├── data/             # Scripts Databricks / notebooks
└── docker-compose.yml
```

## Commandes

### Docker (environnement complet)
```bash
cp .env.example .env          # première fois
docker-compose up -d          # démarrer tous les services
docker-compose down           # arrêter
docker-compose logs -f backend
```

### Backend (Go)
```bash
cd backend
go mod tidy                   # installer les dépendances
go run cmd/server/main.go     # lancer le serveur
go test ./...                 # tous les tests
go test ./internal/handlers/  # tests d'un package
air                           # hot reload (nécessite cosmtrek/air)
```

### Frontend (React)
```bash
cd frontend
npm install
npm run dev    # dev server sur :5173 avec proxy /api → :8080
npm run build
```

## Conventions
- **Langue** : code en anglais, commentaires en français
- **Git** : branches `feature/`, `fix/`, `data/`
- **Go** : `gofmt` obligatoire, erreurs explicites (pas de `panic`)
- **API** : REST, JSON, préfixe `/api/v1/`
