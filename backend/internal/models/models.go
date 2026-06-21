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
	AdresseNumero      *string  `json:"adresse_numero,omitempty"`
	Adresse            *string  `json:"adresse,omitempty"`
	CodePostal         *string  `json:"code_postal,omitempty"`
	Commune            *string  `json:"commune,omitempty"`
	CodeCommune        *string  `json:"code_commune,omitempty"`
	TypeLocal          *string  `json:"type_local,omitempty"`
	SurfaceReelleBati  *float64 `json:"surface_reelle_bati,omitempty"`
	NombrePieces       *int16   `json:"nombre_pieces,omitempty"`
	Longitude          *float64 `json:"longitude,omitempty"`
	Latitude           *float64 `json:"latitude,omitempty"`
	ClasseEnergie      *string  `json:"classe_energie,omitempty"`
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

// CommuneGold représente une commune avec ses métriques Gold agrégées depuis les transactions.
type CommuneGold struct {
	CodeInsee       string   `json:"code_insee"`
	Nom             string   `json:"nom"`
	Departement     string   `json:"departement"`
	Population      *int     `json:"population,omitempty"`
	NbTransactions  int      `json:"nb_transactions"`
	PrixM2Median    *float64 `json:"prix_m2_median,omitempty"`
	PrixM2Moyen     *float64 `json:"prix_m2_moyen,omitempty"`
	ScoreDPEMoyen   *float64 `json:"score_dpe_moyen,omitempty"`  // 1=A … 7=G
	DPEDominant     *string  `json:"dpe_dominant,omitempty"`
	PctAppartements *float64 `json:"pct_appartements,omitempty"` // %
	SurfaceMoyenne  *float64 `json:"surface_moyenne,omitempty"`  // m²
}

// CommuneAgregat représente une commune avec toutes les métriques Gold
// importées depuis BigQuery + enrichies (DPE, IPS, énergie, scores composites).
type CommuneAgregat struct {
	CodeCommune           string   `json:"code_commune"`
	City                  string   `json:"city"`
	CodeDepartement       string   `json:"code_departement"`
	CentroidLon           *float64 `json:"centroid_lon,omitempty"`
	CentroidLat           *float64 `json:"centroid_lat,omitempty"`
	SurfaceKm2            *float64 `json:"surface_km2,omitempty"`
	PopulationTotale      *int64   `json:"population_totale,omitempty"`
	PopulationMunicipale  *int64   `json:"population_municipale,omitempty"`
	DensitePopKm2         *float64 `json:"densite_pop_km2,omitempty"`
	PrixMedianM2          *float64 `json:"prix_median_m2,omitempty"`
	PrixMoyenM2           *float64 `json:"prix_moyen_m2,omitempty"`
	NbTransactions        *int64   `json:"nb_transactions,omitempty"`
	SurfaceMoyenne        *float64 `json:"surface_moyenne,omitempty"`
	PrixMedianTransaction *float64 `json:"prix_median_transaction,omitempty"`
	// DPE
	ScoreDPEMoyen         *float64 `json:"score_dpe_moyen,omitempty"`
	ConsoEnergieMoyenne   *float64 `json:"conso_energie_moyenne,omitempty"`
	EmissionGESMoyenne    *float64 `json:"emission_ges_moyenne,omitempty"`
	NbDPE                 *int64   `json:"nb_dpe,omitempty"`
	PctDPEBon             *float64 `json:"pct_dpe_bon,omitempty"`
	// POI OSM
	NbPOITotal            *int64   `json:"nb_poi_total,omitempty"`
	NbTransport           *int64   `json:"nb_transport,omitempty"`
	NbEducation           *int64   `json:"nb_education,omitempty"`
	NbSante               *int64   `json:"nb_sante,omitempty"`
	NbCommerce            *int64   `json:"nb_commerce,omitempty"`
	NbRestauration        *int64   `json:"nb_restauration,omitempty"`
	NbParcs               *int64   `json:"nb_parcs,omitempty"`
	NbServices            *int64   `json:"nb_services,omitempty"`
	NbBioBobo             *int64   `json:"nb_bio_bobo,omitempty"`
	// Énergie ENEDIS/GRDF
	ConsoElecParLogement  *float64 `json:"conso_elec_par_logement,omitempty"`
	ConsoGazParLogement   *float64 `json:"conso_gaz_par_logement,omitempty"`
	// IPS écoles
	IPSMoyen              *float64 `json:"ips_moyen,omitempty"`
	PctEcolesFavorisees   *float64 `json:"pct_ecoles_favorisees,omitempty"`
	NbEcoles              *int64   `json:"nb_ecoles,omitempty"`
	// Scores composites (0-100)
	ScoreQualiteVie       *float64 `json:"score_qualite_vie,omitempty"`
	ScoreInvestissement   *float64 `json:"score_investissement,omitempty"`
	ScoreStabilite        *float64 `json:"score_stabilite,omitempty"`
	// Sécurité / délinquance (source SSMSI — niveau département)
	TauxCambriolages      *float64 `json:"taux_cambriolages,omitempty"`   // pour 1 000 logements
	TauxVolsViolence      *float64 `json:"taux_vols_violence,omitempty"`  // pour 1 000 habitants
	ScoreSecurite         *float64 `json:"score_securite,omitempty"`      // 0-100 (100 = très sûr)
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
