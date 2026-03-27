import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

const CESIUM_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIwMjQ5MDkzYS1iZjU2LTQyMjktOGE2MC0xODZhNDhjNTM0ZWUiLCJpZCI6NDAzMjQ1LCJpYXQiOjE3NzM0Mjk1Njl9.C2tlmAUZ7wHLKcgNEp2NpH1L_MitT09cFIKeBPIu27c";

const DPE_HEX = {
  A: "#22c55e", B: "#4ade80", C: "#a3e635",
  D: "#facc15", E: "#fb923c", F: "#f87171", G: "#dc2626",
};

const COMMUNE_VIEWS = {
  "75056": { lon: 2.3488, lat: 48.8534, alt: 2000, pitch: -55 },
  "92012": { lon: 2.2408, lat: 48.8359, alt: 1400, pitch: -52 },
  "92051": { lon: 2.2698, lat: 48.8847, alt: 1400, pitch: -52 },
  "93066": { lon: 2.4415, lat: 48.8638, alt: 1400, pitch: -52 },
  "94028": { lon: 2.4399, lat: 48.8477, alt: 1400, pitch: -52 },
  "78646": { lon: 2.1297, lat: 48.8014, alt: 1600, pitch: -50 },
  "91228": { lon: 2.4452, lat: 48.6278, alt: 1600, pitch: -50 },
  "92026": { lon: 2.2874, lat: 48.8936, alt: 1400, pitch: -52 },
};

const BUILDING_TYPE_LABELS = {
  residential: "Résidentiel", commercial: "Commercial", office: "Bureaux",
  industrial: "Industriel", retail: "Commerce", school: "École",
  hospital: "Hôpital", church: "Église", hotel: "Hôtel",
  apartments: "Appartements", house: "Maison",
};

// ── Helper : extraire les props d'un Cesium3DTileFeature ──────────────────────
function extractFeatureProps(feature) {
  const ids = feature.getPropertyIds();
  const props = {};
  ids.forEach(id => { props[id] = feature.getProperty(id); });
  return props;
}

export default function CesiumView3D({ selectedCommune, transactions, initCenter, flyTarget }) {
  const containerRef    = useRef(null);
  const viewerRef       = useRef(null);
  const tilesetRef      = useRef(null);
  const entitiesRef     = useRef([]);
  const handlerRef      = useRef(null);

  const [selectedBuilding, setSelectedBuilding] = useState(null); // { props, nearbyTx, clickLat, clickLon }
  // Ref pour accès depuis les callbacks Cesium (fermeture stable)
  const setSelectedBuildingRef = useRef(setSelectedBuilding);
  useEffect(() => { setSelectedBuildingRef.current = setSelectedBuilding; }, []);
  // Ref pour accès aux transactions depuis le handler Cesium (closure stable)
  const transactionsRef = useRef(transactions);
  useEffect(() => { transactionsRef.current = transactions; }, [transactions]);
  // Ref pour accès à initCenter dans l'effet d'init (closure stable)
  const initCenterRef = useRef(initCenter);
  // Ref pour ignorer le premier montage dans fly-to-commune
  const isMountedRef = useRef(false);

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    Cesium.Ion.defaultAccessToken = CESIUM_TOKEN;

    // Désactiver infoBox natif → on utilise notre panel React
    const viewer = new Cesium.Viewer(containerRef.current, {
      terrain:            Cesium.Terrain.fromWorldTerrain(),
      animation:          false,
      baseLayerPicker:    false,
      fullscreenButton:   false,
      geocoder:           false,
      homeButton:         false,
      infoBox:            false,   // ← désactivé, remplacé par panel React
      selectionIndicator: false,   // ← désactivé, on gère le highlight nous-mêmes
      sceneModePicker:    false,
      timeline:           false,
      navigationHelpButton:              false,
      navigationInstructionsInitiallyVisible: false,
      requestRenderMode:  false,
      skyBox:             false,
      skyAtmosphere:      new Cesium.SkyAtmosphere(),
    });

    // ── Imagery : Bing Aerial ─────────────────────────────────────────────────
    viewer.imageryLayers.removeAll();
    Cesium.IonImageryProvider.fromAssetId(2).then(provider => {
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      layer.brightness = 0.88;
      layer.saturation = 0.9;
      layer.contrast   = 1.0;
      layer.hue        = 0.0;
      layer.gamma      = 1.0;
    }).catch(() => {
      viewer.imageryLayers.addImageryProvider(
        new Cesium.TileMapServiceImageryProvider({
          url: Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
        })
      );
    });

    // ── Globe ─────────────────────────────────────────────────────────────────
    viewer.scene.globe.enableLighting       = false;
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.fog.enabled               = false;
    viewer.scene.backgroundColor           = Cesium.Color.fromCssColorString("#060d18");
    viewer.scene.skyAtmosphere.show        = false;

    // ── Lumière directionnelle douce ──────────────────────────────────────────
    const parisECEF = Cesium.Cartesian3.fromDegrees(2.35, 48.85);
    const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(parisECEF);
    const localUp   = new Cesium.Cartesian3(0, 0, 1);
    const upECEF    = new Cesium.Cartesian3();
    Cesium.Matrix4.multiplyByPointAsVector(enuMatrix, localUp, upECEF);
    Cesium.Cartesian3.normalize(upECEF, upECEF);
    viewer.scene.light = new Cesium.DirectionalLight({
      direction: Cesium.Cartesian3.negate(upECEF, new Cesium.Cartesian3()),
      intensity: 1.4,
    });

    // ── Post-processing ───────────────────────────────────────────────────────
    if (viewer.scene.postProcessStages) {
      viewer.scene.postProcessStages.fxaa.enabled = true;
      const bloom = viewer.scene.postProcessStages.bloom;
      if (bloom) {
        bloom.enabled             = true;
        bloom.uniforms.glowOnly   = false;
        bloom.uniforms.contrast   = 80;
        bloom.uniforms.brightness = -0.35;
        bloom.uniforms.delta      = 1.0;
        bloom.uniforms.sigma      = 0.9;
        bloom.uniforms.stepSize   = 1.0;
      }
    }
    const ao = viewer.scene.postProcessStages.ambientOcclusion;
    if (ao) ao.enabled = false;

    // ── OSM Buildings ─────────────────────────────────────────────────────────
    const highlighted = { feature: null, savedColor: new Cesium.Color() };

    Cesium.Cesium3DTileset.fromIonAssetId(96188).then(tileset => {
      viewer.scene.primitives.add(tileset);
      tilesetRef.current = tileset;
      tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.REPLACE;
      tileset.style = new Cesium.Cesium3DTileStyle({
        color: "color('#3b82f6', 0.95)",
      });
    }).catch(e => console.warn("[Cesium] OSM Buildings:", e));

    // ── Hover highlight ───────────────────────────────────────────────────────
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handlerRef.current = handler;

    handler.setInputAction(({ endPosition }) => {
      // Restaurer la couleur du feature précédent
      if (highlighted.feature) {
        highlighted.feature.color = highlighted.savedColor.clone();
        highlighted.feature = null;
      }
      const picked = viewer.scene.pick(endPosition);
      if (Cesium.defined(picked) && picked instanceof Cesium.Cesium3DTileFeature) {
        Cesium.Color.clone(picked.color, highlighted.savedColor);
        highlighted.feature = picked;
        // Bleu clair lumineux au hover
        picked.color = Cesium.Color.fromCssColorString("#93c5fd").withAlpha(1.0); // blue-300
        viewer.scene.canvas.style.cursor = "pointer";
      } else {
        viewer.scene.canvas.style.cursor = "";
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // ── Clic → panel custom React ─────────────────────────────────────────────
    handler.setInputAction(({ position }) => {
      const picked = viewer.scene.pick(position);
      if (Cesium.defined(picked) && picked instanceof Cesium.Cesium3DTileFeature) {
        const props = extractFeatureProps(picked);

        // Récupérer coordonnées au SOL via rayon caméra → terrain
        // (globe.pick ignore les tuiles 3D et donne la position au sol, ce qui
        //  correspond aux coordonnées DVF qui sont en général au niveau de la rue)
        let clickLat = null, clickLon = null;
        try {
          const ray = viewer.camera.getPickRay(position);
          // 1er essai : position sur le globe (terrain)
          let cartesian = Cesium.defined(ray)
            ? viewer.scene.globe.pick(ray, viewer.scene)
            : undefined;
          // 2ème essai : pickPosition si le terrain n'a pas encore chargé
          if (!Cesium.defined(cartesian) && viewer.scene.pickPositionSupported) {
            cartesian = viewer.scene.pickPosition(position);
          }
          if (Cesium.defined(cartesian)) {
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            clickLat = Cesium.Math.toDegrees(carto.latitude);
            clickLon = Cesium.Math.toDegrees(carto.longitude);
          }
        } catch {}

        // Trouver transactions DVF dans un rayon de 120m
        // (rayon généreux car coords DVF = centroïde parcelle/rue, pas forcément le bâtiment exact)
        let nearbyTx = [];
        if (clickLat !== null) {
          nearbyTx = transactionsRef.current.filter(t => {
            if (!t.latitude || !t.longitude) return false;
            const dLat = (t.latitude  - clickLat) * Math.PI / 180;
            const dLon = (t.longitude - clickLon) * Math.PI / 180;
            const a = Math.sin(dLat/2)**2
              + Math.cos(clickLat * Math.PI/180) * Math.cos(t.latitude * Math.PI/180) * Math.sin(dLon/2)**2;
            const distM = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            return distM <= 120;
          }).sort((a, b) => (b.valeur_fonciere || 0) - (a.valeur_fonciere || 0));
        }

        setSelectedBuildingRef.current({ props, nearbyTx, clickLat, clickLon });
      } else {
        setSelectedBuildingRef.current(null);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // ── Vue initiale : synchronisée avec la vue 2D ────────────────────────────
    const ic = initCenterRef.current;
    const initLon = ic?.lng  ?? 2.3488;
    const initLat = ic?.lat  ?? 48.845;
    // Conversion zoom MapLibre → altitude Cesium (approx)
    const initAlt = ic ? Math.max(200, Math.round(2000 * Math.pow(2, 13 - ic.zoom))) : 3000;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(initLon, initLat, initAlt),
      orientation: {
        heading: Cesium.Math.toRadians(20),
        pitch:   Cesium.Math.toRadians(-50),
        roll:    0,
      },
    });

    // Masquer les crédits Cesium
    const style = document.createElement("style");
    style.textContent = `.cesium-widget-credits { display: none !important; }`;
    document.head.appendChild(style);

    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 200;
    viewer.scene.screenSpaceCameraController.tiltEventTypes = [
      Cesium.CameraEventType.RIGHT_DRAG,
      Cesium.CameraEventType.PINCH,
    ];

    viewerRef.current = viewer;
    return () => {
      if (handlerRef.current) { handlerRef.current.destroy(); handlerRef.current = null; }
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  // ── Fly to commune (seulement si commune/transactions changent APRÈS le montage) ──
  useEffect(() => {
    // Ne pas overrider initCenter au premier montage
    if (!isMountedRef.current) { isMountedRef.current = true; return; }
    if (!viewerRef.current || !selectedCommune) return;

    // Centroïde calculé depuis les transactions (même logique que MapView 2D)
    const withCoords = transactions.filter(t => t.longitude && t.latitude);

    let lon, lat, alt, pitch;
    if (withCoords.length > 0) {
      lon   = withCoords.reduce((s, t) => s + t.longitude, 0) / withCoords.length;
      lat   = withCoords.reduce((s, t) => s + t.latitude,  0) / withCoords.length;
      alt   = 1400;
      pitch = -52;
    } else {
      const v = COMMUNE_VIEWS[selectedCommune.code_insee];
      if (!v) return;
      lon = v.lon; lat = v.lat; alt = v.alt; pitch = v.pitch;
    }

    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
      orientation: { heading: Cesium.Math.toRadians(10), pitch: Cesium.Math.toRadians(pitch), roll: 0 },
      duration: 2.0,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCommune, transactions]);

  // ── Fly to adresse recherchée (depuis Header search) ──────────────────────
  useEffect(() => {
    if (!viewerRef.current || !flyTarget) return;
    const alt = Math.max(200, Math.round(2000 * Math.pow(2, 13 - (flyTarget.zoom || 16))));
    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(flyTarget.lng, flyTarget.lat, alt),
      orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-45), roll: 0 },
      duration: 1.5,
    });
  }, [flyTarget]);

  // ── Barres DPE ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!viewerRef.current) return;
    entitiesRef.current.forEach(e => { try { viewerRef.current.entities.remove(e); } catch {} });
    entitiesRef.current = [];

    transactions.forEach(t => {
      if (!t.longitude || !t.latitude || !t.valeur_fonciere || !t.surface_reelle_bati) return;
      const prixM2   = t.valeur_fonciere / t.surface_reelle_bati;
      const barH     = Math.min(400, Math.max(15, prixM2 / 25));
      const hexColor = t.classe_energie ? DPE_HEX[t.classe_energie] : "#3c83f6";
      const cesColor = Cesium.Color.fromCssColorString(hexColor);
      const prix     = t.valeur_fonciere >= 1e6
        ? `${(t.valeur_fonciere / 1e6).toFixed(2)}M€`
        : `${(t.valeur_fonciere / 1000).toFixed(0)}k€`;

      const bar = viewerRef.current.entities.add({
        position: Cesium.Cartesian3.fromDegrees(t.longitude, t.latitude, barH / 2),
        cylinder: {
          length: barH, topRadius: 8, bottomRadius: 8,
          material: cesColor.withAlpha(0.9),
          outline: true,
          outlineColor: cesColor.brighten(0.5, new Cesium.Color()).withAlpha(0.8),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          shadowMode: Cesium.ShadowMode.DISABLED,
        },
      });
      const sphere = viewerRef.current.entities.add({
        position: Cesium.Cartesian3.fromDegrees(t.longitude, t.latitude, barH),
        ellipsoid: {
          radii: new Cesium.Cartesian3(18, 18, 18),
          material: cesColor.withAlpha(0.95),
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          shadowMode: Cesium.ShadowMode.DISABLED,
        },
      });
      const label = viewerRef.current.entities.add({
        position: Cesium.Cartesian3.fromDegrees(t.longitude, t.latitude, barH + 25),
        label: {
          text: prix, font: "bold 12px Inter",
          fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(300, 1.2, 2000, 0.4),
          translucencyByDistance: new Cesium.NearFarScalar(500, 1.0, 3000, 0.0),
        },
      });
      entitiesRef.current.push(bar, sphere, label);
    });
  }, [transactions]);

  // ── Rendu ─────────────────────────────────────────────────────────────────
  const b        = selectedBuilding?.props;
  const nearbyTx = selectedBuilding?.nearbyTx ?? [];
  const buildingName = b?.name || b?.["addr:street"] || "Bâtiment OSM";
  const buildingType = b?.building
    ? (BUILDING_TYPE_LABELS[b.building] ?? b.building)
    : null;
  const levels   = b?.["building:levels"];
  const height   = b?.["cesium#estimatedHeight"];
  const addr     = b?.["addr:street"]
    ? `${b["addr:housenumber"] ?? ""} ${b["addr:street"]}`.trim()
    : null;

  const infoRows = [
    ["Type", buildingType],
    ["Niveaux", levels],
    ["Hauteur estimée", height ? `${Math.round(height)} m` : null],
    ["Adresse OSM", addr],
  ].filter(([, v]) => v != null && v !== "");

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* ── Légende DPE ─────────────────────────────────────────────────── */}
      <div className="absolute top-4 left-4 z-10 px-3 py-3 rounded-xl"
        style={{ background: "rgba(6,13,24,0.88)", backdropFilter: "blur(12px)", border: "1px solid rgba(52,112,210,0.25)" }}>
        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Barres · DPE · Prix</p>
        <div className="space-y-1.5">
          {Object.entries(DPE_HEX).map(([cls, hex]) => (
            <div key={cls} className="flex items-center gap-2">
              <div className="w-2 h-5 rounded-sm" style={{ background: hex, boxShadow: `0 0 6px ${hex}` }} />
              <span className="text-[9px] text-slate-300 font-bold">{cls}</span>
              <span className="text-[8px] text-slate-500">
                {{ A:"< 3k", B:"3–5k", C:"5–7k", D:"7–10k", E:"10–13k", F:"13–16k", G:"16k+" }[cls]} €/m²
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-2 border-t border-slate-800">
          <p className="text-[8px] text-slate-500">Hauteur barre = prix / m²</p>
        </div>
      </div>

      {/* ── Panel bâtiment custom ─────────────────────────────────────────── */}
      {selectedBuilding && (
        <div
          className="absolute top-4 right-4 z-20 w-80 rounded-2xl overflow-hidden overflow-y-auto"
          style={{
            maxHeight: "calc(100% - 2rem)",
            background:    "rgba(6,13,28,0.95)",
            backdropFilter:"blur(24px)",
            border:        "1px solid rgba(52,112,210,0.35)",
            boxShadow:     "0 8px 40px rgba(0,0,0,0.5)",
          }}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-4 py-3 sticky top-0 z-10"
            style={{ background: "rgba(52,112,210,0.12)", borderBottom: "1px solid rgba(52,112,210,0.2)" }}>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(52,112,210,0.2)" }}>
                <span className="material-symbols-outlined text-blue-400" style={{ fontSize: 18 }}>apartment</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate leading-tight">{buildingName}</p>
                {buildingType && (
                  <p className="text-[11px] text-blue-400 font-medium mt-0.5">{buildingType}</p>
                )}
              </div>
            </div>
            <button onClick={() => setSelectedBuilding(null)}
              className="shrink-0 ml-2 w-6 h-6 rounded-md flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 transition-all">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>

          {/* Infos OSM */}
          {infoRows.length > 0 && (
            <div className="px-4 py-3 space-y-2 border-b border-slate-800/60">
              {infoRows.map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-3">
                  <span className="text-[11px] text-slate-500 shrink-0 pt-px">{label}</span>
                  <span className="text-[11px] text-slate-200 text-right leading-snug">{String(value)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Transactions DVF à proximité */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Transactions DVF · rayon 120m
              </p>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: nearbyTx.length ? "rgba(60,131,246,0.2)" : "rgba(100,116,139,0.15)", color: nearbyTx.length ? "#3c83f6" : "#64748b" }}>
                {nearbyTx.length}
              </span>
            </div>

            {nearbyTx.length === 0 ? (
              <div className="text-center py-4">
                <span className="material-symbols-outlined text-slate-700 block mb-1" style={{ fontSize: 24 }}>search_off</span>
                <p className="text-[11px] text-slate-600">Aucune transaction DVF<br/>dans ce bâtiment</p>
              </div>
            ) : (
              <div className="space-y-2">
                {nearbyTx.map((t, i) => {
                  const prix = t.valeur_fonciere
                    ? t.valeur_fonciere >= 1e6
                      ? `${(t.valeur_fonciere / 1e6).toFixed(2)}M€`
                      : `${(t.valeur_fonciere / 1000).toFixed(0)}k€`
                    : "—";
                  const prixM2 = t.valeur_fonciere && t.surface_reelle_bati
                    ? Math.round(t.valeur_fonciere / t.surface_reelle_bati) : null;
                  const dpeColor = t.classe_energie ? DPE_HEX[t.classe_energie] : "#475569";
                  return (
                    <div key={t.id || i} className="rounded-xl p-3"
                      style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(60,131,246,0.1)" }}>
                      {/* Ligne 1 : prix + DPE */}
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-base font-black mono-nums" style={{ color: "#3c83f6" }}>{prix}</span>
                        <div className="flex items-center gap-1.5">
                          {t.classe_energie && (
                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
                              style={{ background: `${dpeColor}20`, color: dpeColor, border: `1px solid ${dpeColor}50` }}>
                              DPE {t.classe_energie}
                            </span>
                          )}
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{t.source_annee}</span>
                        </div>
                      </div>
                      {/* Ligne 2 : type + surface */}
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-300">{t.type_local || "Bien"} · {t.surface_reelle_bati?.toFixed(0) ?? "?"}m²{t.nombre_pieces ? ` · T${t.nombre_pieces}` : ""}</span>
                        {prixM2 && <span className="text-slate-500 mono-nums">€{prixM2.toLocaleString()}/m²</span>}
                      </div>
                      {/* Ligne 3 : adresse + date */}
                      <div className="flex items-center justify-between mt-1 text-[10px] text-slate-600">
                        <span className="truncate mr-2">{[t.adresse_numero, t.adresse].filter(Boolean).join(" ") || "—"}</span>
                        <span className="shrink-0">{t.date_mutation}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 flex items-center justify-between"
            style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <span className="text-[9px] text-slate-600">OSM Buildings · DVF 2019–2024</span>
            <span className="text-[9px] text-slate-600">rayon 120m</span>
          </div>
        </div>
      )}

      {/* ── Hint bas ──────────────────────────────────────────────────────── */}
      <div className="absolute bottom-10 left-4 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] text-slate-400"
        style={{ background: "rgba(6,13,24,0.8)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>touch_app</span>
        Survol pour illuminer · Clic pour détails · Scroll pour zoomer
      </div>
    </div>
  );
}
