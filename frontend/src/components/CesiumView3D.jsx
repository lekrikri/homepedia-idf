import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

const CESIUM_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIwMjQ5MDkzYS1iZjU2LTQyMjktOGE2MC0xODZhNDhjNTM0ZWUiLCJpZCI6NDAzMjQ1LCJpYXQiOjE3NzM0Mjk1Njl9.C2tlmAUZ7wHLKcgNEp2NpH1L_MitT09cFIKeBPIu27c";

// DPE → couleur RGBA Cesium
const DPE_CESIUM = {
  A: "color('#22c55e')",
  B: "color('#4ade80')",
  C: "color('#facc15')",
  D: "color('#fb923c')",
  E: "color('#f97316')",
  F: "color('#ef4444')",
  G: "color('#dc2626')",
};

const COMMUNE_VIEWS = {
  "75056": { lon: 2.3488,  lat: 48.8566, alt: 900,  pitch: -40 },
  "92012": { lon: 2.2408,  lat: 48.8359, alt: 600,  pitch: -40 },
  "92051": { lon: 2.2698,  lat: 48.8847, alt: 600,  pitch: -40 },
  "93066": { lon: 2.4415,  lat: 48.8638, alt: 600,  pitch: -40 },
  "94028": { lon: 2.4399,  lat: 48.8477, alt: 600,  pitch: -40 },
  "78646": { lon: 2.1297,  lat: 48.8014, alt: 700,  pitch: -35 },
  "91228": { lon: 2.4452,  lat: 48.6278, alt: 700,  pitch: -35 },
  "92026": { lon: 2.2874,  lat: 48.8936, alt: 600,  pitch: -40 },
};

export default function CesiumView3D({ selectedCommune, transactions }) {
  const containerRef = useRef(null);
  const viewerRef    = useRef(null);
  const tilesetRef   = useRef(null);
  const entitiesRef  = useRef([]);

  // ── Init viewer ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    Cesium.Ion.defaultAccessToken = CESIUM_TOKEN;

    const viewer = new Cesium.Viewer(containerRef.current, {
      terrainProvider:    new Cesium.EllipsoidTerrainProvider(),
      animation:          false,
      baseLayerPicker:    false,
      fullscreenButton:   false,
      geocoder:           false,
      homeButton:         false,
      infoBox:            false,
      sceneModePicker:    false,
      selectionIndicator: false,
      timeline:           false,
      navigationHelpButton:              false,
      navigationInstructionsInitiallyVisible: false,
      requestRenderMode:  false,
      // Fond noir
      skyBox:  false,
      skyAtmosphere: false,
    });

    // Fond sombre
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#101722");
    viewer.scene.globe.baseColor  = Cesium.Color.fromCssColorString("#0d1520");
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.fog.enabled = false;

    // Imagery sombre : Natural Earth II (sans clé)
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(
      new Cesium.TileMapServiceImageryProvider({
        url: Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
      })
    );

    // OSM Buildings (asset ID 96188 = tileset mondial gratuit Cesium Ion)
    Cesium.Cesium3DTileset.fromIonAssetId(96188).then(tileset => {
      viewer.scene.primitives.add(tileset);
      tilesetRef.current = tileset;
      applyBuildingStyle(tileset, null);
    }).catch(e => console.warn("[Cesium] OSM Buildings:", e));

    // Vue initiale — Paris IDF
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(2.3488, 48.85, 8000),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch:   Cesium.Math.toRadians(-50),
        roll:    0,
      },
    });

    viewerRef.current = viewer;

    return () => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  // ── Style bâtiments selon DPE dominant de la commune ────────────────────────
  function applyBuildingStyle(tileset, dpePrincipal) {
    const baseColor = dpePrincipal && DPE_CESIUM[dpePrincipal]
      ? DPE_CESIUM[dpePrincipal]
      : "color('#1a3a5c', 0.95)";

    tileset.style = new Cesium.Cesium3DTileStyle({
      color: {
        conditions: [
          ["true", baseColor],
        ],
      },
    });
  }

  // ── Fly to commune + markers transactions ────────────────────────────────────
  useEffect(() => {
    if (!viewerRef.current || !selectedCommune) return;

    const view = COMMUNE_VIEWS[selectedCommune.code_insee];
    if (view) {
      viewerRef.current.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(view.lon, view.lat, view.alt),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch:   Cesium.Math.toRadians(view.pitch),
          roll:    0,
        },
        duration: 1.8,
      });
    }

    // Update building color based on DPE
    if (tilesetRef.current) {
      const dpeCounts = transactions.reduce((acc, t) => {
        if (t.classe_energie) acc[t.classe_energie] = (acc[t.classe_energie] || 0) + 1;
        return acc;
      }, {});
      const dpePrincipal = Object.entries(dpeCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
      applyBuildingStyle(tilesetRef.current, dpePrincipal);
    }
  }, [selectedCommune]);

  // ── Transaction markers ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!viewerRef.current) return;

    // Remove old entities
    entitiesRef.current.forEach(e => viewerRef.current.entities.remove(e));
    entitiesRef.current = [];

    transactions.forEach(t => {
      if (!t.longitude || !t.latitude) return;

      const prixM2 = t.valeur_fonciere && t.surface_reelle_bati
        ? Math.round(t.valeur_fonciere / t.surface_reelle_bati) : null;

      const dpeColor = t.classe_energie
        ? Cesium.Color.fromCssColorString(
            { A:"#22c55e", B:"#4ade80", C:"#facc15", D:"#fb923c", E:"#f97316", F:"#ef4444", G:"#dc2626" }
            [t.classe_energie] || "#3c83f6"
          )
        : Cesium.Color.fromCssColorString("#3c83f6");

      const prix = t.valeur_fonciere
        ? t.valeur_fonciere >= 1e6
          ? `${(t.valeur_fonciere / 1e6).toFixed(2)}M€`
          : `${(t.valeur_fonciere / 1000).toFixed(0)}k€`
        : "—";

      const entity = viewerRef.current.entities.add({
        position: Cesium.Cartesian3.fromDegrees(t.longitude, t.latitude, 20),
        point: {
          pixelSize:        10,
          color:            dpeColor.withAlpha(0.9),
          outlineColor:     Cesium.Color.WHITE.withAlpha(0.7),
          outlineWidth:     1.5,
          heightReference:  Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text:             prix,
          font:             "bold 11px Inter",
          fillColor:        Cesium.Color.WHITE,
          outlineColor:     Cesium.Color.BLACK,
          outlineWidth:     2,
          style:            Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:      new Cesium.Cartesian2(0, -18),
          heightReference:  Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show:             true,
        },
        description: `
          <div style="font-family:Inter,sans-serif;padding:8px;background:#0f1724;color:#e2e8f0;min-width:160px;border-radius:8px">
            <div style="font-size:18px;font-weight:900;color:#3c83f6">${prix}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:4px">${t.type_local || "Bien"} · ${t.surface_reelle_bati?.toFixed(0) ?? "?"}m²</div>
            ${prixM2 ? `<div style="font-size:11px;color:#64748b;margin-top:2px">${prixM2.toLocaleString()} €/m²</div>` : ""}
            ${t.classe_energie ? `<div style="margin-top:6px"><span style="background:${dpeColor.toCssHexString()}40;color:${dpeColor.toCssHexString()};padding:2px 8px;border-radius:4px;font-weight:900;font-size:11px">DPE ${t.classe_energie}</span></div>` : ""}
          </div>
        `,
      });
      entitiesRef.current.push(entity);
    });
  }, [transactions]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Legend overlay */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-1.5 px-3 py-2 rounded-xl"
        style={{ background: "rgba(16,23,34,0.85)", backdropFilter: "blur(8px)", border: "1px solid rgba(60,131,246,0.2)" }}>
        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">DPE Bâtiments</p>
        {Object.entries({ A:"#22c55e", B:"#4ade80", C:"#facc15", D:"#fb923c", E:"#f97316", F:"#ef4444", G:"#dc2626" }).map(([cls, col]) => (
          <div key={cls} className="flex items-center gap-2">
            <div className="size-2.5 rounded-sm" style={{ background: col }} />
            <span className="text-[9px] text-slate-300 font-bold">{cls}</span>
          </div>
        ))}
      </div>

      {/* Hint */}
      <div className="absolute bottom-10 left-4 z-10 px-3 py-1.5 rounded-lg text-[10px] text-slate-400"
        style={{ background: "rgba(16,23,34,0.8)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <span className="material-symbols-outlined align-middle mr-1" style={{ fontSize: 13 }}>mouse</span>
        Clic sur un point · Glisser pour orbiter · Scroll pour zoomer
      </div>
    </div>
  );
}
