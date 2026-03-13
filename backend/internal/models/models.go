package models

import "time"

// Commune représente une commune française (référentiel géographique).
type Commune struct {
	ID          int64   `json:"id"`
	CodeInsee   string  `json:"code_insee"`
	CodePostal  *string `json:"code_postal,omitempty"`
	Nom         string  `json:"nom"`
	Departement string  `json:"departement"`
	Region      *string `json:"region,omitempty"`
	Population  *int    `json:"population,omitempty"`
}

// Transaction représente une mutation foncière DVF.
type Transaction struct {
	ID                 int64    `json:"id"`
	DateMutation       string   `json:"date_mutation"`        // ISO date
	NatureMutation     *string  `json:"nature_mutation,omitempty"`
	ValeurFonciere     *float64 `json:"valeur_fonciere,omitempty"`
	Adresse            *string  `json:"adresse,omitempty"`
	CodePostal         *string  `json:"code_postal,omitempty"`
	Commune            *string  `json:"commune,omitempty"`
	CodeCommune        *string  `json:"code_commune,omitempty"`
	TypeLocal          *string  `json:"type_local,omitempty"`
	SurfaceReelleBati  *float64 `json:"surface_reelle_bati,omitempty"`
	NombrePieces       *int16   `json:"nombre_pieces,omitempty"`
	Longitude          *float64 `json:"longitude,omitempty"`
	Latitude           *float64 `json:"latitude,omitempty"`
	SourceAnnee        int16    `json:"source_annee"`
}

// User représente un compte utilisateur (sans le hash du mot de passe).
type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	FullName  *string   `json:"full_name,omitempty"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

// ScoreIris représente les agrégats calculés pour une zone IRIS.
type ScoreIris struct {
	CodeIris     string   `json:"code_iris"`
	PrixM2Median *float64 `json:"prix_m2_median,omitempty"`
	PrixM2P25    *float64 `json:"prix_m2_p25,omitempty"`
	PrixM2P75    *float64 `json:"prix_m2_p75,omitempty"`
	NbTransactions *int   `json:"nb_transactions,omitempty"`
	PartClasseAB *float64 `json:"part_classe_ab,omitempty"`
	PartClasseFG *float64 `json:"part_classe_fg,omitempty"`
	ScoreGlobal  *float64 `json:"score_global,omitempty"`
	DateCalcul   *string  `json:"date_calcul,omitempty"`
}
