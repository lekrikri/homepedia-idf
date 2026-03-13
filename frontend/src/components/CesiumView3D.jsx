import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

const CESIUM_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIwMjQ5MDkzYS1iZjU2LTQyMjktOGE2MC0xODZhNDhjNTM0ZWUiLCJpZCI6NDAzMjQ1LCJpYXQiOjE3NzM0Mjk1Njl9.C2tlmAUZ7wHLKcgNEp2NpH1L_MitT09cFIKeBPIu27c";

const DPE_HEX = {
  A: "#22c55e",
  B: "#4ade80",
  C: "#a3e635",
  D: "#facc15",
  E: "#fb923c",
  F: "#f87171",
  G: "#dc2626",
};

const COMMUNE_VIEWS = {
  "75056": { lon: 2.3488,  lat: 48.8534, alt: 2000, pitch: -55 },
  "92012": { lon: 2.2408,  lat: 48.8359, alt: 1400, pitch: -52 },
  "92051": { lon: 2.2698,  lat: 48.8847, alt: 1400, pitch: -52 },
  "93066": { lon: 2.4415,  lat: 48.8638, alt: 1400, pitch: -52 },
  "94028": { lon: 2.4399,  lat: 48.8477, alt: 1400, pitch: -52 },
  "78646": { lon: 2.1297,  lat: 48.8014, alt: 1600, pitch: -50 },
  "91228": { lon: 2.4452,  lat: 48.6278, alt: 1600, pitch: -50 },
  "92026": { lon: 2.2874,  lat: 48.8936, alt: 1400, pitch: -52 },
};

export default function CesiumView3D({ selectedCommune, transactions }) {
  const containerRef = useRef(null);
  const viewerRef    = useRef(null);
  const tilesetRef   = useRef(null);
  const entitiesRef  = useRef([]);

  // ── Init ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    Cesium.Ion.defaultAccessToken = CESIUM_TOKEN;

    const viewer = new Cesium.Viewer(containerRef.current, {
      terrain:            Cesium.Terrain.fromWorldTerrain(),
      animation:          false,
      baseLayerPicker:    false,
      fullscreenButton:   false,
      geocoder:           false,
      homeButton:         false,
      infoBox:            true,
      sceneModePicker:    false,
      selectionIndicator: true,
      timeline:           false,
      navigationHelpButton:              false,
      navigationInstructionsInitiallyVisible: false,
      requestRenderMode:  false,
      skyBox:             false,
      skyAtmosphere:      new Cesium.SkyAtmosphere(),
    });

    // ── Imagery : Bing Aerial via Cesium Ion ──────────────────────────────────
    viewer.imageryLayers.removeAll();
    Cesium.IonImageryProvider.fromAssetId(2).then(provider => {
      viewer.imageryLayers.addImageryProvider(provider);
    }).catch(() => {
      // fallback Natural Earth II
      viewer.imageryLayers.addImageryProvider(
        new Cesium.TileMapServiceImageryProvider({
          url: Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
        })
      );
    });

    // ── Globe settings ────────────────────────────────────────────────────────
    viewer.scene.globe.enableLighting       = false;  // terrain uniforme
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.fog.enabled               = false;
    viewer.scene.backgroundColor           = Cesium.Color.fromCssColorString("#060d18");
    viewer.scene.skyAtmosphere.show        = false;

    // ── DirectionalLight depuis le dessus de Paris (ECEF correct) ────────────
    // eastNorthUpToFixedFrame donne la matrice de transformation locale pour Paris
    // On en extrait le vecteur "up" (Z local) → inversé = direction de la lumière
    const parisECEF  = Cesium.Cartesian3.fromDegrees(2.35, 48.85);
    const enuMatrix  = Cesium.Transforms.eastNorthUpToFixedFrame(parisECEF);
    const localUp    = new Cesium.Cartesian3(0, 0, 1);
    const upECEF     = new Cesium.Cartesian3();
    Cesium.Matrix4.multiplyByPointAsVector(enuMatrix, localUp, upECEF);
    Cesium.Cartesian3.normalize(upECEF, upECEF);
    const lightDir   = Cesium.Cartesian3.negate(upECEF, new Cesium.Cartesian3());
    viewer.scene.light = new Cesium.DirectionalLight({
      direction: lightDir,
      intensity: 5.0,   // haute intensité → toits presque blancs, murs quasi noirs
    });

    // ── Post-processing : FXAA + bloom subtil pour glow des barres DPE ───────
    if (viewer.scene.postProcessStages) {
      viewer.scene.postProcessStages.fxaa.enabled = true;
      const bloom = viewer.scene.postProcessStages.bloom;
      if (bloom) {
        bloom.enabled             = true;
        bloom.uniforms.glowOnly   = false;
        bloom.uniforms.contrast   = 128;
        bloom.uniforms.brightness = -0.2;  // légèrement négatif → évite que le ciel grise
        bloom.uniforms.delta      = 1.0;
        bloom.uniforms.sigma      = 1.1;   // bas → glow subtil, pas de blur global
        bloom.uniforms.stepSize   = 1.0;
      }
    }
    const ao = viewer.scene.postProcessStages.ambientOcclusion;
    if (ao) ao.enabled = false;

    // ── OSM Buildings : MIX + DirectionalLight haute intensité ───────────────
    // intensity: 5.0 → faces hautes (toits) = presque blanches → mélangé avec bleu = bleu clair
    //                    faces verticales (murs) = presque noires → mélangé avec bleu = bleu très sombre
    // colorBlendAmount: 0.75 → laisse assez de contraste PBR visible
    Cesium.Cesium3DTileset.fromIonAssetId(96188).then(tileset => {
      viewer.scene.primitives.add(tileset);
      tilesetRef.current = tileset;

      tileset.colorBlendMode   = Cesium.Cesium3DTileColorBlendMode.MIX;
      tileset.colorBlendAmount = 0.75;

      tileset.style = new Cesium.Cesium3DTileStyle({
        color: "color('#2563eb', 1.0)",
      });
    }).catch(e => console.warn("[Cesium] OSM Buildings:", e));

    // ── Vue initiale : Paris vue oblique ─────────────────────────────────────
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(2.3488, 48.845, 3000),
      orientation: {
        heading: Cesium.Math.toRadians(20),
        pitch:   Cesium.Math.toRadians(-50),
        roll:    0,
      },
    });

    // ── InfoBox dark style ───────────────────────────────────────────────────
    const style = document.createElement("style");
    style.textContent = `
      .cesium-infoBox { background: rgba(10,20,40,0.95) !important; border: 1px solid rgba(60,131,246,0.4) !important; border-radius: 12px !important; }
      .cesium-infoBox-title { background: rgba(60,131,246,0.15) !important; color: #e2e8f0 !important; font-family: Inter, sans-serif !important; }
      .cesium-infoBox-close { color: #64748b !important; }
      .cesium-infoBox iframe { filter: invert(1) hue-rotate(180deg); }
      .cesium-widget-credits { display: none !important; }
    `;
    document.head.appendChild(style);

    // ── Contraindre le pitch : empêcher vue rasante ───────────────────────────
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 200;
    viewer.scene.screenSpaceCameraController.tiltEventTypes      = [
      Cesium.CameraEventType.RIGHT_DRAG,
      Cesium.CameraEventType.PINCH,
    ];

    viewerRef.current = viewer;
    return () => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  // ── Fly to commune ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!viewerRef.current || !selectedCommune) return;
    const v = COMMUNE_VIEWS[selectedCommune.code_insee];
    if (!v) return;
    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(v.lon, v.lat, v.alt),
      orientation: {
        heading: Cesium.Math.toRadians(10),
        pitch:   Cesium.Math.toRadians(v.pitch),
        roll:    0,
      },
      duration: 2.0,
    });
  }, [selectedCommune]);

  // ── Barres prix (vertical bars colored by DPE) ────────────────────────────
  useEffect(() => {
    if (!viewerRef.current) return;

    // Nettoyer les anciennes entités
    entitiesRef.current.forEach(e => {
      try { viewerRef.current.entities.remove(e); } catch {}
    });
    entitiesRef.current = [];

    transactions.forEach(t => {
      if (!t.longitude || !t.latitude || !t.valeur_fonciere || !t.surface_reelle_bati) return;

      const prixM2  = t.valeur_fonciere / t.surface_reelle_bati;
      // Hauteur = prix/m² / 25, entre 15m et 400m pour être visible
      const barH    = Math.min(400, Math.max(15, prixM2 / 25));
      const hexColor = t.classe_energie ? DPE_HEX[t.classe_energie] : "#3c83f6";
      const cesColor = Cesium.Color.fromCssColorString(hexColor);

      const prix = t.valeur_fonciere >= 1e6
        ? `${(t.valeur_fonciere / 1e6).toFixed(2)}M€`
        : `${(t.valeur_fonciere / 1000).toFixed(0)}k€`;

      // ── Barre verticale ──────────────────────────────────────────────────
      const bar = viewerRef.current.entities.add({
        position: Cesium.Cartesian3.fromDegrees(t.longitude, t.latitude, barH / 2),
        cylinder: {
          length:        barH,
          topRadius:     8,
          bottomRadius:  8,
          material:      cesColor.withAlpha(0.9),
          outline:       true,
          outlineColor:  cesColor.brighten(0.5, new Cesium.Color()).withAlpha(0.8),
          outlineWidth:  2,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          shadowMode:    Cesium.ShadowMode.DISABLED,
        },
        description: `
          <div style="font-family:Inter,sans-serif;padding:12px;color:#e2e8f0;background:#0a1428;min-width:200px">
            <div style="font-size:22px;font-weight:900;color:${hexColor};letter-spacing:-0.5px">${prix}</div>
            <div style="font-size:12px;color:#94a3b8;margin:4px 0">${t.type_local || "Bien"} · ${t.surface_reelle_bati?.toFixed(0) ?? "?"}m²</div>
            <div style="font-size:11px;color:#64748b">${Math.round(prixM2).toLocaleString()} €/m²</div>
            ${t.classe_energie ? `<div style="margin-top:8px;padding:3px 10px;border-radius:6px;display:inline-block;font-weight:900;font-size:13px;background:${hexColor}25;color:${hexColor};border:1px solid ${hexColor}50">DPE ${t.classe_energie}</div>` : ""}
            <div style="font-size:10px;color:#475569;margin-top:6px">${[t.adresse_numero, t.adresse].filter(Boolean).join(" ") || "—"}</div>
          </div>
        `,
      });

      // ── Sphère lumineuse au sommet ────────────────────────────────────────
      const sphere = viewerRef.current.entities.add({
        position: Cesium.Cartesian3.fromDegrees(t.longitude, t.latitude, barH),
        ellipsoid: {
          radii:    new Cesium.Cartesian3(18, 18, 18),
          material: cesColor.withAlpha(0.95),
          outline:  false,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          shadowMode: Cesium.ShadowMode.DISABLED,
        },
      });

      // ── Label prix ────────────────────────────────────────────────────────
      const label = viewerRef.current.entities.add({
        position: Cesium.Cartesian3.fromDegrees(t.longitude, t.latitude, barH + 25),
        label: {
          text:             prix,
          font:             "bold 12px Inter",
          fillColor:        Cesium.Color.WHITE,
          outlineColor:     Cesium.Color.BLACK,
          outlineWidth:     2,
          style:            Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:      new Cesium.Cartesian2(0, 0),
          heightReference:  Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance:  new Cesium.NearFarScalar(300, 1.2, 2000, 0.4),
          translucencyByDistance: new Cesium.NearFarScalar(500, 1.0, 3000, 0.0),
        },
      });

      entitiesRef.current.push(bar, sphere, label);
    });
  }, [transactions]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Legend */}
      <div className="absolute top-4 left-4 z-10 px-3 py-3 rounded-xl"
        style={{ background: "rgba(6,13,24,0.88)", backdropFilter: "blur(12px)", border: "1px solid rgba(60,131,246,0.25)" }}>
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

      {/* Hint */}
      <div className="absolute bottom-10 left-4 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] text-slate-400"
        style={{ background: "rgba(6,13,24,0.8)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>touch_app</span>
        Clic sur une barre · Glisser pour orbiter · Scroll pour zoomer
      </div>
    </div>
  );
}
