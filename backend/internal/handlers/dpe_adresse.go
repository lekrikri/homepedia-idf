package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/cache"
)

// API publique de l'ADEME : 15 millions de diagnostics du parc existant.
const apiAdeme = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines"

type DpeVoisin struct {
	Adresse    string   `json:"adresse"`
	Etiquette  string   `json:"etiquette_dpe"`
	EtiquetteG string   `json:"etiquette_ges,omitempty"`
	Surface    *float64 `json:"surface_m2,omitempty"`
	Type       string   `json:"type_batiment,omitempty"`
	Date       string   `json:"date,omitempty"`
	ConsoM2    *float64 `json:"conso_kwh_m2_an,omitempty"`
}

type DpeAdresseResponse struct {
	Recherche    string      `json:"recherche"`
	CodePostal   string      `json:"code_postal,omitempty"`
	NbTrouves    int         `json:"nb_diagnostics"`
	Resultats    []DpeVoisin `json:"resultats"`
	Repartition  map[string]int `json:"repartition_etiquettes,omitempty"`
	PartPassoire *float64    `json:"part_passoires_pct,omitempty"`
	Message      string      `json:"message,omitempty"`
}

// GetDpeAdresse handles GET /api/v1/dpe-adresse
//
// Le DPE moyen d'une commune ne dit rien du bien visé. Cet endpoint interroge
// l'ADEME sur une adresse et renvoie les diagnostics du bâtiment et de ses
// voisins immédiats — souvent le seul moyen d'estimer la classe d'un logement
// avant d'avoir le diagnostic en main.
//
// Params : adresse (requis), code_postal, limit
func GetDpeAdresse(c *gin.Context) {
	adresse := strings.TrimSpace(c.Query("adresse"))
	if len(adresse) < 4 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "paramètre 'adresse' requis (4 caractères minimum)"})
		return
	}
	codePostal := strings.TrimSpace(c.Query("code_postal"))
	limite, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	if limite <= 0 || limite > 25 {
		limite = 10
	}

	cacheKey := "dpe_" + strings.ToLower(adresse) + "_" + codePostal
	if data, ok := cache.Global.Get(cacheKey); ok {
		c.Header("X-Cache", "HIT")
		c.Data(http.StatusOK, "application/json; charset=utf-8", data)
		return
	}

	params := url.Values{}
	params.Set("size", strconv.Itoa(limite))
	params.Set("q", adresse)
	params.Set("select", "adresse_ban,etiquette_dpe,etiquette_ges,date_etablissement_dpe,"+
		"surface_habitable_logement,type_batiment,conso_5_usages_par_m2_ep")
	if codePostal != "" {
		params.Set("code_postal_ban", codePostal)
	}

	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Get(apiAdeme + "?" + params.Encode())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "service ADEME injoignable"})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusBadGateway, gin.H{
			"error": fmt.Sprintf("réponse ADEME inattendue (%d)", resp.StatusCode)})
		return
	}

	// L'ADEME renvoie les mesures en nombres et le reste en chaînes.
	var brut struct {
		Total   int `json:"total"`
		Results []struct {
			Adresse    string   `json:"adresse_ban"`
			Etiquette  string   `json:"etiquette_dpe"`
			EtiquetteG string   `json:"etiquette_ges"`
			Date       string   `json:"date_etablissement_dpe"`
			Surface    *float64 `json:"surface_habitable_logement"`
			Type       string   `json:"type_batiment"`
			Conso      *float64 `json:"conso_5_usages_par_m2_ep"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&brut); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "réponse ADEME illisible"})
		return
	}

	// Une surface ou une consommation nulle signale une donnée absente.
	nombre := func(v *float64) *float64 {
		if v != nil && *v > 0 {
			return v
		}
		return nil
	}

	out := DpeAdresseResponse{
		Recherche: adresse, CodePostal: codePostal,
		NbTrouves: len(brut.Results), Repartition: map[string]int{},
	}
	passoires := 0
	for _, r := range brut.Results {
		if r.Etiquette == "" {
			continue
		}
		out.Resultats = append(out.Resultats, DpeVoisin{
			Adresse: r.Adresse, Etiquette: r.Etiquette, EtiquetteG: r.EtiquetteG,
			Surface: nombre(r.Surface), Type: r.Type, Date: r.Date,
			ConsoM2: nombre(r.Conso),
		})
		out.Repartition[r.Etiquette]++
		if r.Etiquette == "F" || r.Etiquette == "G" {
			passoires++
		}
	}
	out.NbTrouves = len(out.Resultats)

	if out.NbTrouves == 0 {
		out.Message = "Aucun diagnostic trouvé à cette adresse. Précisez le numéro et la voie, " +
			"ou demandez le DPE au vendeur : il est obligatoire dès l'annonce."
		out.Repartition = nil
	} else {
		part := float64(passoires) / float64(out.NbTrouves) * 100
		part = float64(int(part*10)) / 10
		out.PartPassoire = &part

		// Les diagnostics voisins renseignent sur le bâti, pas sur le lot visé :
		// deux appartements du même immeuble peuvent différer d'une classe.
		if part >= 50 {
			out.Message = fmt.Sprintf(
				"%.0f %% des diagnostics de ce secteur sont classés F ou G. Le bien visé a de "+
					"fortes chances d'être concerné : faites chiffrer les travaux avant de faire une offre.",
				part)
		} else if part > 0 {
			out.Message = fmt.Sprintf(
				"%.0f %% des diagnostics de ce secteur sont classés F ou G. Exigez le DPE du "+
					"logement précis : il est opposable et doit figurer dans l'annonce.",
				part)
		} else {
			out.Message = "Aucune passoire thermique parmi les diagnostics de ce secteur. " +
				"Le DPE du logement visé reste à vérifier individuellement."
		}
	}

	// Tri du plus récent au plus ancien : un DPE de 2021 précède la réforme de
	// juillet et n'a pas la même valeur qu'un diagnostic récent.
	sort.Slice(out.Resultats, func(i, j int) bool {
		return out.Resultats[i].Date > out.Resultats[j].Date
	})

	if data, err := json.Marshal(out); err == nil {
		cache.Global.Set(cacheKey, data, 24*time.Hour)
		c.Header("X-Cache", "MISS")
		c.Data(http.StatusOK, "application/json; charset=utf-8", data)
		return
	}
	c.JSON(http.StatusOK, out)
}
