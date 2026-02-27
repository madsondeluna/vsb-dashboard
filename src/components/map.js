/**
 * VigiSaúde Brasil — Map Component
 * Interactive Leaflet map with:
 * - Disease alert choropleth (single disease)
 * - Multi-pathogen heatmap (3 diseases simultaneously)
 * - Sewage relief layer (circle size = collection, color = treatment)
 * - Municipality-level zoom
 */
import L from 'leaflet';
import {
    fetchBrazilGeoJSON, fetchStateGeoJSON, fetchBulkMunicipioAlerts,
    getUFAbbreviation, getSanitationData, getAlertColorHex, getRegionForUF,
    MAJOR_CITIES_BY_UF
} from '../services/api.js';

let map = null;
let geoLayer = null;       // State-level choropleth layer
let currentRegion = 'all';
let onStateClick = null;
let currentDisease = 'dengue';
let currentMapLayer = 'disease';  // 'disease' | 'heatmap' | 'coletaEsgoto' | 'tratamentoEsgoto' | 'esgotoRelevo'
let lastCapitalData = [];

// ===== Heatmap state =====
let allDiseaseDataForHeatmap = {};  // { disease: [capitalData] }

// ===== Sewage relief layer (circleMarkers) =====
let esgotoRelevoLayer = null;

// Municipality zoom management
const MUNICIPIO_ZOOM_THRESHOLD = 6;
const loadedMunicipioLayers = {};
const loadingStates = new Set();
const municipioAlertCache = {};

const regionBounds = {
    all: [[-33.75, -73.99], [5.27, -34.79]],
    norte: [[-3.0, -74.0], [5.3, -44.0]],
    nordeste: [[-18.0, -49.0], [-1.0, -34.8]],
    sudeste: [[-25.5, -53.5], [-14.0, -39.5]],
    sul: [[-33.8, -57.7], [-22.5, -48.0]],
    'centro-oeste': [[-24.5, -61.5], [-5.5, -45.5]],
};

// State centroids (approximate lat/lng for circle placement)
const UF_CENTROIDS = {
    AC: [-9.02, -70.81], AL: [-9.57, -36.78], AM: [-4.38, -65.00],
    AP: [1.41, -51.77], BA: [-12.96, -41.70], CE: [-5.50, -39.32],
    DF: [-15.83, -47.86], ES: [-19.57, -40.67], GO: [-15.83, -49.62],
    MA: [-5.42, -45.44], MG: [-18.51, -44.56], MS: [-20.51, -54.54],
    MT: [-12.98, -56.09], PA: [-3.41, -52.29], PB: [-7.24, -36.78],
    PE: [-8.38, -37.86], PI: [-7.72, -42.73], PR: [-25.09, -51.50],
    RJ: [-22.33, -42.70], RN: [-5.81, -36.59], RO: [-10.90, -62.00],
    RR: [2.05, -61.38], RS: [-30.17, -53.50], SC: [-27.45, -50.95],
    SE: [-10.57, -37.45], SP: [-22.28, -48.56], TO: [-10.17, -48.33],
};

const UF_IDS = [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33, 35, 41, 42, 43, 50, 51, 52, 53];

export function initMap(containerId, stateClickCallback) {
    onStateClick = stateClickCallback;

    map = L.map(containerId, {
        center: [-14.5, -51.0],
        zoom: 4,
        minZoom: 3,
        maxZoom: 12,
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> | Dados: InfoDengue, IBGE, SNIS',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(map);

    map.on('zoomend', handleZoomChange);
    map.on('moveend', handleZoomChange);

    return map;
}

// ===== Zoom Handler =====
function handleZoomChange() {
    const zoom = map.getZoom();

    if (zoom >= MUNICIPIO_ZOOM_THRESHOLD && currentMapLayer === 'disease') {
        const bounds = map.getBounds();
        const visibleUFs = getVisibleUFs(bounds);
        visibleUFs.forEach(ufId => loadMunicipioLayer(ufId));

        if (geoLayer) {
            geoLayer.setStyle({ fillOpacity: 0.1, weight: 0.5 });
        }
    } else {
        removeMunicipioLayers();

        if (geoLayer) {
            geoLayer.eachLayer(layer => {
                geoLayer.resetStyle(layer);
            });
        }
    }
}

function getVisibleUFs(bounds) {
    if (!geoLayer) return [];

    const visible = [];
    geoLayer.eachLayer(layer => {
        if (layer.feature && layer.getBounds) {
            try {
                const layerBounds = layer.getBounds();
                if (bounds.intersects(layerBounds)) {
                    const ufId = Number(layer.feature.properties.codarea);
                    if (UF_IDS.includes(ufId)) {
                        visible.push(ufId);
                    }
                }
            } catch { /* skip */ }
        }
    });
    return visible;
}

// ===== Municipality Layer =====
async function loadMunicipioLayer(ufId) {
    if (loadedMunicipioLayers[ufId] || loadingStates.has(ufId)) return;
    if (!MAJOR_CITIES_BY_UF[ufId]) return;

    loadingStates.add(ufId);

    try {
        const [geojson, alertMap] = await Promise.all([
            fetchStateGeoJSON(ufId),
            fetchBulkMunicipioAlerts(MAJOR_CITIES_BY_UF[ufId], currentDisease),
        ]);

        municipioAlertCache[ufId] = alertMap;

        const municipioLayer = L.geoJSON(geojson, {
            style: (feature) => {
                const geocode = Number(feature.properties.codarea);
                const alert = alertMap[geocode];

                let fillColor = 'rgba(30, 41, 59, 0.4)';
                let fillOpacity = 0.25;

                if (alert) {
                    fillColor = getAlertColorHex(alert.nivel);
                    fillOpacity = 0.6;
                }

                return { fillColor, fillOpacity, weight: 0.8, color: 'rgba(148, 163, 184, 0.25)', dashArray: '' };
            },
            onEachFeature: (feature, layer) => {
                const geocode = Number(feature.properties.codarea);
                const alert = alertMap[geocode];

                if (alert) {
                    const alertInfo = { 1: 'Verde', 2: 'Atenção', 3: 'Alerta', 4: 'Emergência' };
                    const alertClass = { 1: 'badge--green', 2: 'badge--yellow', 3: 'badge--orange', 4: 'badge--red' };

                    let popupHTML = `<div class="popup-content">`;
                    popupHTML += `<h4>${alert.municipio_nome || `Município ${geocode}`}</h4>`;
                    popupHTML += `<div class="popup-stats">`;
                    popupHTML += `<div class="popup-stat"><span class="popup-stat__label">Casos (SE ${alert.SE % 100})</span><span class="popup-stat__value">${(alert.casos || 0).toLocaleString('pt-BR')}</span></div>`;
                    popupHTML += `<div class="popup-stat"><span class="popup-stat__label">Rt</span><span class="popup-stat__value">${alert.Rt ? alert.Rt.toFixed(2) : '--'}</span></div>`;
                    popupHTML += `<div class="popup-stat"><span class="popup-stat__label">Inc/100k</span><span class="popup-stat__value">${alert.p_inc100k ? alert.p_inc100k.toFixed(1) : '--'}</span></div>`;
                    popupHTML += `<div class="popup-stat"><span class="popup-stat__label">Acum. Ano</span><span class="popup-stat__value">${(alert.notif_accum_year || 0).toLocaleString('pt-BR')}</span></div>`;
                    popupHTML += `</div>`;
                    popupHTML += `<span class="popup-alert-badge badge ${alertClass[alert.nivel] || 'badge--green'}">${alertInfo[alert.nivel] || 'Verde'}</span>`;
                    popupHTML += `</div>`;
                    layer.bindPopup(popupHTML);
                }

                layer.on('mouseover', function () {
                    this.setStyle({ weight: 2, color: '#38bdf8', fillOpacity: alert ? 0.8 : 0.35 });
                    this.bringToFront();
                });

                layer.on('mouseout', function () {
                    municipioLayer.resetStyle(this);
                });
            },
        });

        municipioLayer.addTo(map);
        loadedMunicipioLayers[ufId] = municipioLayer;

    } catch (err) {
        console.error(`Erro ao carregar municípios da UF ${ufId}:`, err);
    } finally {
        loadingStates.delete(ufId);
    }
}

function removeMunicipioLayers() {
    for (const ufId of Object.keys(loadedMunicipioLayers)) {
        if (loadedMunicipioLayers[ufId]) {
            map.removeLayer(loadedMunicipioLayers[ufId]);
            delete loadedMunicipioLayers[ufId];
        }
    }
}

export function setMapDisease(disease) {
    currentDisease = disease;
    for (const ufId of Object.keys(loadedMunicipioLayers)) {
        if (loadedMunicipioLayers[ufId]) {
            map.removeLayer(loadedMunicipioLayers[ufId]);
            delete loadedMunicipioLayers[ufId];
        }
        delete municipioAlertCache[ufId];
    }
    if (map && map.getZoom() >= MUNICIPIO_ZOOM_THRESHOLD) {
        handleZoomChange();
    }
}

// ===== Sanitation color gradient =====
function getSanitationColor(percent) {
    if (percent >= 80) return '#06b6d4';
    if (percent >= 60) return '#22d3ee';
    if (percent >= 40) return '#67e8f9';
    if (percent >= 20) return '#f59e0b';
    return '#ef4444';
}

function getSanitationOpacity(percent) {
    return 0.35 + (percent / 100) * 0.4;
}

// ===== HEATMAP MULTI-PATÓGENO (SVG overlay com blur) =====

// Disease color definitions for SVG heatmap
const HEAT_DISEASE_CONFIGS = {
    dengue: { stops: ['#7a3500', '#f59e0b', '#fde68a'], opacity: 0.75 },
    chikungunya: { stops: ['#7c1060', '#ec4899', '#fce7f3'], opacity: 0.68 },
    zika: { stops: ['#3b0764', '#8b5cf6', '#ede9fe'], opacity: 0.62 },
};

// SVG heatmap overlay container
let heatmapSvgOverlay = null;

function clearHeatLayers() {
    if (heatmapSvgOverlay) {
        map.removeLayer(heatmapSvgOverlay);
        heatmapSvgOverlay = null;
    }
}

/**
 * Render multi-pathogen heatmap using a custom SVG overlay.
 * allData: { dengue: [capitalData], chikungunya: [...], zika: [...] }
 */
export function setMapHeatmap(allData) {
    allDiseaseDataForHeatmap = allData;
    clearHeatLayers();

    // Make GeoLayer translucent backdrop
    if (geoLayer) {
        geoLayer.setStyle({
            fillColor: '#050c1f',
            fillOpacity: 0.75,
            weight: 1,
            color: 'rgba(148,163,184,0.15)',
        });
    }

    const diseases = ['dengue', 'chikungunya', 'zika'];

    // Find global max cases across all diseases for normalization
    let globalMax = 1;
    diseases.forEach(disease => {
        const data = allData[disease];
        if (!data) return;
        data.forEach(d => {
            if (d.latest?.casos > globalMax) globalMax = d.latest.casos;
        });
    });

    // Build SVG content
    // We use a custom Leafet SVG layer covering the whole map
    const svgNS = 'http://www.w3.org/2000/svg';

    // Create the SVG overlay using Leaflet's SVGOverlay
    // Bounds that cover all of Brazil
    const brazilBounds = L.latLngBounds([[-33.75, -73.99], [5.27, -34.79]]);

    const svgElement = document.createElementNS(svgNS, 'svg');
    svgElement.setAttribute('xmlns', svgNS);
    svgElement.setAttribute('viewBox', '0 0 1000 800');
    svgElement.style.overflow = 'visible';

    // Add defs for gradients and filters
    const defs = document.createElementNS(svgNS, 'defs');

    // Add blur filter
    const filter = document.createElementNS(svgNS, 'filter');
    filter.setAttribute('id', 'heat-blur');
    filter.setAttribute('x', '-50%');
    filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%');
    filter.setAttribute('height', '200%');
    const feGaussianBlur = document.createElementNS(svgNS, 'feGaussianBlur');
    feGaussianBlur.setAttribute('stdDeviation', '28');
    feGaussianBlur.setAttribute('result', 'blur');
    filter.appendChild(feGaussianBlur);
    defs.appendChild(filter);

    svgElement.appendChild(defs);

    // Group per disease (layered on top of each other)
    diseases.forEach(disease => {
        const data = allData[disease];
        if (!data || data.length === 0) return;
        const cfg = HEAT_DISEASE_CONFIGS[disease];

        const group = document.createElementNS(svgNS, 'g');
        group.setAttribute('style', `mix-blend-mode: screen;`);
        group.setAttribute('opacity', cfg.opacity);

        data.forEach(cap => {
            if (!cap.latest || !cap.latest.casos) return;
            const centroid = UF_CENTROIDS[cap.uf];
            if (!centroid) return;

            // Map lat/lng to SVG coordinates (simplified linear mapping for Brazil)
            // Brazil: lat -33.75 to 5.27, lng -73.99 to -34.79
            const svgX = ((centroid[1] - (-73.99)) / (-34.79 - (-73.99))) * 1000;
            const svgY = ((centroid[0] - 5.27) / (-33.75 - 5.27)) * 800;

            // Radius proportional to sqrt of cases
            const intensity = Math.sqrt(cap.latest.casos / globalMax);
            const r = 40 + intensity * 160;

            // Create radial gradient for this circle
            const gradId = `grad-${disease}-${cap.uf}`;
            const grad = document.createElementNS(svgNS, 'radialGradient');
            grad.setAttribute('id', gradId);
            grad.setAttribute('cx', '50%');
            grad.setAttribute('cy', '50%');
            grad.setAttribute('r', '50%');

            const stop0 = document.createElementNS(svgNS, 'stop');
            stop0.setAttribute('offset', '0%');
            stop0.setAttribute('stop-color', cfg.stops[2]);
            stop0.setAttribute('stop-opacity', '0.9');

            const stop1 = document.createElementNS(svgNS, 'stop');
            stop1.setAttribute('offset', '35%');
            stop1.setAttribute('stop-color', cfg.stops[1]);
            stop1.setAttribute('stop-opacity', '0.65');

            const stop2 = document.createElementNS(svgNS, 'stop');
            stop2.setAttribute('offset', '70%');
            stop2.setAttribute('stop-color', cfg.stops[0]);
            stop2.setAttribute('stop-opacity', '0.3');

            const stop3 = document.createElementNS(svgNS, 'stop');
            stop3.setAttribute('offset', '100%');
            stop3.setAttribute('stop-color', cfg.stops[0]);
            stop3.setAttribute('stop-opacity', '0');

            grad.appendChild(stop0);
            grad.appendChild(stop1);
            grad.appendChild(stop2);
            grad.appendChild(stop3);
            defs.appendChild(grad);

            // Create circle
            const circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('cx', svgX);
            circle.setAttribute('cy', svgY);
            circle.setAttribute('r', r);
            circle.setAttribute('fill', `url(#${gradId})`);
            circle.setAttribute('filter', 'url(#heat-blur)');

            group.appendChild(circle);
        });

        svgElement.appendChild(group);
    });

    // Create SVG layer over Brazil
    heatmapSvgOverlay = L.svgOverlay(svgElement, brazilBounds, {
        opacity: 1,
        interactive: false,
        zIndex: 400,
    });
    heatmapSvgOverlay.addTo(map);

    updateLegend('heatmap');
}

// ===== SEWAGE RELIEF LAYER =====

/**
 * Color for treatment coverage: blue=good, red=bad
 */
function getTreatmentColor(percent) {
    // Invert: higher treatment = cooler (blue/teal); lower = warmer (amber/red)
    if (percent >= 70) return '#06b6d4'; // great
    if (percent >= 55) return '#22d3ee';
    if (percent >= 40) return '#a3e635'; // lime
    if (percent >= 25) return '#f59e0b'; // amber
    return '#ef4444';                   // poor
}

function clearEsgotoRelevoLayer() {
    if (esgotoRelevoLayer) {
        map.removeLayer(esgotoRelevoLayer);
        esgotoRelevoLayer = null;
    }
}

export function setMapEsgotoRelevo() {
    clearEsgotoRelevoLayer();
    clearHeatLayers();

    const sanitationData = getSanitationData();

    // Restore geoLayer as subtle backdrop
    if (geoLayer) {
        geoLayer.setStyle({
            fillColor: '#0f172a',
            fillOpacity: 0.55,
            weight: 1.2,
            color: 'rgba(148,163,184,0.25)',
        });
    }

    // Min/max collection for radius scaling
    const coletas = Object.values(sanitationData).map(s => s.coletaEsgoto);
    const minColeta = Math.min(...coletas);
    const maxColeta = Math.max(...coletas);

    const markerGroup = L.layerGroup();

    Object.entries(sanitationData).forEach(([uf, data]) => {
        const centroid = UF_CENTROIDS[uf];
        if (!centroid) return;

        // Radius: 10–55 based on collection coverage
        const normalized = (data.coletaEsgoto - minColeta) / (maxColeta - minColeta);
        const radius = 10 + normalized * 45;

        // Fill color derived from treatment percentage
        const fillColor = getTreatmentColor(data.tratamentoEsgoto);

        // Outer glow ring
        const outerCircle = L.circleMarker([centroid[0], centroid[1]], {
            radius: radius + 5,
            fillColor: fillColor,
            fillOpacity: 0.08,
            color: fillColor,
            weight: 1.2,
            opacity: 0.4,
        });

        // Main circle
        const circle = L.circleMarker([centroid[0], centroid[1]], {
            radius: radius,
            fillColor: fillColor,
            fillOpacity: 0.45,
            color: fillColor,
            weight: 2,
            opacity: 0.9,
        });

        // Inner bright dot
        const innerDot = L.circleMarker([centroid[0], centroid[1]], {
            radius: Math.max(4, radius * 0.18),
            fillColor: '#ffffff',
            fillOpacity: 0.6,
            color: 'transparent',
            weight: 0,
        });

        // UF label
        const label = L.marker([centroid[0], centroid[1]], {
            icon: L.divIcon({
                className: '',
                html: `<div style="
                    color:#fff;
                    font-size:9px;
                    font-weight:700;
                    font-family:'JetBrains Mono',monospace;
                    text-align:center;
                    text-shadow:0 1px 3px rgba(0,0,0,0.9);
                    pointer-events:none;
                    white-space:nowrap;
                    transform:translate(-50%,-50%);
                    position:absolute;
                    top:0;left:0;
                ">${uf}</div>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
            }),
        });

        // Popup with both metrics
        const popupHTML = `
            <div class="popup-content">
                <h4>${data.nome}</h4>
                <div class="popup-stats">
                    <div class="popup-stat">
                        <span class="popup-stat__label">Coleta de Esgoto</span>
                        <span class="popup-stat__value" style="color:${fillColor}">${data.coletaEsgoto}%</span>
                    </div>
                    <div class="popup-stat">
                        <span class="popup-stat__label">Tratamento de Esgoto</span>
                        <span class="popup-stat__value" style="color:${fillColor}">${data.tratamentoEsgoto}%</span>
                    </div>
                    <div class="popup-stat">
                        <span class="popup-stat__label">IDH</span>
                        <span class="popup-stat__value">${data.idh}</span>
                    </div>
                </div>
                <div style="margin-top:8px;font-size:0.73rem;color:var(--text-tertiary)">
                    ⬤ Tamanho do círculo → % coleta<br>
                    ⬤ Cor → % tratamento (azul=bom, vermelho=ruim)
                </div>
            </div>`;

        outerCircle.bindPopup(popupHTML);
        circle.bindPopup(popupHTML);

        outerCircle.on('mouseover', function () { this.setStyle({ fillOpacity: 0.15, opacity: 0.7 }); });
        outerCircle.on('mouseout', function () { this.setStyle({ fillOpacity: 0.08, opacity: 0.4 }); });
        circle.on('mouseover', function () { this.setStyle({ fillOpacity: 0.7, weight: 3 }); });
        circle.on('mouseout', function () { this.setStyle({ fillOpacity: 0.45, weight: 2 }); });

        markerGroup.addLayer(outerCircle);
        markerGroup.addLayer(circle);
        markerGroup.addLayer(innerDot);
        markerGroup.addLayer(label);
    });

    markerGroup.addTo(map);
    esgotoRelevoLayer = markerGroup;

    updateLegend('esgotoRelevo');
}

// ===== Set Map Layer =====
export function setMapLayer(layer) {
    currentMapLayer = layer;

    // Clean up special layers when switching away
    // Always remove municipality disease layers when switching layers
    removeMunicipioLayers();

    if (layer !== 'heatmap') clearHeatLayers();
    if (layer !== 'esgotoRelevo') clearEsgotoRelevoLayer();

    if (layer === 'heatmap') {
        if (Object.keys(allDiseaseDataForHeatmap).length > 0) {
            setMapHeatmap(allDiseaseDataForHeatmap);
        }
    } else if (layer === 'esgotoRelevo') {
        setMapEsgotoRelevo();
    } else {
        updateLegend(layer);
        if (geoLayer) {
            loadGeoJSON(lastCapitalData);
        }
    }
}

// ===== Legend =====
function updateLegend(layer) {
    const legendEl = document.getElementById('map-legend');
    if (!legendEl) return;

    if (layer === 'heatmap') {
        legendEl.innerHTML = `
            <div style="font-size:0.72rem;color:var(--text-tertiary);margin-bottom:6px;">Intensidade por nº de casos</div>
            <div class="legend-item">
                <span class="legend-color" style="background:linear-gradient(90deg,#f59e0b,#fb923c,#fbbf24)"></span>
                <span style="color:#f59e0b">Dengue</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background:linear-gradient(90deg,#ec4899,#f472b6,#fce7f3)"></span>
                <span style="color:#ec4899">Chikungunya</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background:linear-gradient(90deg,#8b5cf6,#a78bfa,#ede9fe)"></span>
                <span style="color:#a78bfa">Zika</span>
            </div>
        `;
    } else if (layer === 'esgotoRelevo') {
        legendEl.innerHTML = `
            <div style="font-size:0.72rem;color:var(--text-tertiary);margin-bottom:6px;">Tamanho = % coleta · Cor = % tratamento</div>
            <div class="legend-item"><span class="legend-color" style="background:#06b6d4"></span>≥ 70% tratamento</div>
            <div class="legend-item"><span class="legend-color" style="background:#22d3ee"></span>55–69%</div>
            <div class="legend-item"><span class="legend-color" style="background:#a3e635"></span>40–54%</div>
            <div class="legend-item"><span class="legend-color" style="background:#f59e0b"></span>25–39%</div>
            <div class="legend-item"><span class="legend-color" style="background:#ef4444"></span>&lt; 25% tratamento</div>
            <div style="margin-top:8px;font-size:0.72rem;color:var(--text-tertiary)">Círculo maior = mais coleta</div>
        `;
    } else if (layer === 'disease') {
        legendEl.innerHTML = `
            <div class="legend-item"><span class="legend-color" style="background: var(--alert-green)"></span>Nível 1 — Verde</div>
            <div class="legend-item"><span class="legend-color" style="background: var(--alert-yellow)"></span>Nível 2 — Atenção</div>
            <div class="legend-item"><span class="legend-color" style="background: var(--alert-orange)"></span>Nível 3 — Alerta</div>
            <div class="legend-item"><span class="legend-color" style="background: var(--alert-red)"></span>Nível 4 — Emergência</div>
        `;
    } else {
        const label = layer === 'coletaEsgoto' ? 'Coleta de Esgoto' : 'Tratamento de Esgoto';
        legendEl.innerHTML = `
            <div class="legend-item"><span class="legend-color" style="background: #06b6d4"></span>≥ 80% ${label}</div>
            <div class="legend-item"><span class="legend-color" style="background: #22d3ee"></span>60–79%</div>
            <div class="legend-item"><span class="legend-color" style="background: #67e8f9"></span>40–59%</div>
            <div class="legend-item"><span class="legend-color" style="background: #f59e0b"></span>20–39%</div>
            <div class="legend-item"><span class="legend-color" style="background: #ef4444"></span>&lt; 20%</div>
        `;
    }
}

// ===== Load State-Level GeoJSON (choropleth) =====
export async function loadGeoJSON(capitalData = []) {
    const loadingEl = document.getElementById('map-loading');
    lastCapitalData = capitalData;

    try {
        const geojson = await fetchBrazilGeoJSON();
        const sanitationData = getSanitationData();

        const diseaseByUF = {};
        if (capitalData.length > 0) {
            capitalData.forEach(cap => {
                if (cap.latest) {
                    diseaseByUF[cap.uf] = cap;
                }
            });
        }

        if (geoLayer) {
            map.removeLayer(geoLayer);
        }

        geoLayer = L.geoJSON(geojson, {
            style: (feature) => {
                const ufId = feature.properties.codarea;
                const ufAbbr = getUFAbbreviation(Number(ufId));
                const region = getRegionForUF(ufAbbr);
                const sanitation = sanitationData[ufAbbr];

                let fillColor = '#1e293b';
                let fillOpacity = 0.6;

                if (currentRegion !== 'all' && region !== currentRegion) {
                    fillOpacity = 0.15;
                }

                if (currentMapLayer === 'disease') {
                    const capData = diseaseByUF[ufAbbr];
                    if (capData && capData.latest) {
                        fillColor = getAlertColorHex(capData.latest.nivel);
                        fillOpacity = currentRegion !== 'all' && region !== currentRegion ? 0.15 : 0.55;
                    }
                } else if (currentMapLayer === 'heatmap') {
                    fillColor = '#0d1427';
                    fillOpacity = 0.3;
                } else if (currentMapLayer === 'esgotoRelevo') {
                    fillColor = '#0f172a';
                    fillOpacity = 0.55;
                } else if (sanitation) {
                    const val = sanitation[currentMapLayer] || 0;
                    fillColor = getSanitationColor(val);
                    fillOpacity = currentRegion !== 'all' && region !== currentRegion ? 0.15 : getSanitationOpacity(val);
                }

                if (map.getZoom() >= MUNICIPIO_ZOOM_THRESHOLD && currentMapLayer === 'disease') {
                    fillOpacity = 0.1;
                }

                return {
                    fillColor,
                    fillOpacity,
                    weight: 1.5,
                    color: 'rgba(148, 163, 184, 0.3)',
                    dashArray: '',
                };
            },
            onEachFeature: (feature, layer) => {
                const ufId = Number(feature.properties.codarea);
                const ufAbbr = getUFAbbreviation(ufId);
                const sanitation = sanitationData[ufAbbr];
                const capData = diseaseByUF[ufAbbr];

                let popupHTML = `<div class="popup-content">`;
                popupHTML += `<h4>${sanitation ? sanitation.nome : ufAbbr}</h4>`;

                if (capData && capData.latest) {
                    const d = capData.latest;
                    const alertInfo = { 1: 'Verde', 2: 'Atenção', 3: 'Alerta', 4: 'Emergência' };
                    const alertClass = { 1: 'badge--green', 2: 'badge--yellow', 3: 'badge--orange', 4: 'badge--red' };

                    popupHTML += `<div class="popup-stats">`;
                    popupHTML += `<div class="popup-stat"><span class="popup-stat__label">Casos (SE ${d.SE % 100})</span><span class="popup-stat__value">${(d.casos || 0).toLocaleString('pt-BR')}</span></div>`;
                    popupHTML += `<div class="popup-stat"><span class="popup-stat__label">Rt</span><span class="popup-stat__value">${d.Rt ? d.Rt.toFixed(2) : '--'}</span></div>`;
                    popupHTML += `<div class="popup-stat"><span class="popup-stat__label">Inc/100k</span><span class="popup-stat__value">${d.p_inc100k ? d.p_inc100k.toFixed(1) : '--'}</span></div>`;
                    popupHTML += `<div class="popup-stat"><span class="popup-stat__label">Acum. Ano</span><span class="popup-stat__value">${(d.notif_accum_year || 0).toLocaleString('pt-BR')}</span></div>`;
                    popupHTML += `</div>`;
                    popupHTML += `<span class="popup-alert-badge badge ${alertClass[d.nivel] || 'badge--green'}">${alertInfo[d.nivel] || 'Verde'}</span>`;
                }

                if (sanitation) {
                    const highlightColeta = currentMapLayer === 'coletaEsgoto' ? 'color:var(--accent-primary);font-weight:600' : '';
                    const highlightTrat = currentMapLayer === 'tratamentoEsgoto' ? 'color:var(--accent-primary);font-weight:600' : '';
                    popupHTML += `<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(148,163,184,0.15)">`;
                    popupHTML += `<span class="popup-stat__label" style="display:block;margin-bottom:4px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14" style="vertical-align:-2px;margin-right:4px"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0L12 2.69z"/></svg>Saneamento (SNIS)</span>`;
                    popupHTML += `<div class="popup-stats">`;
                    popupHTML += `<div class="popup-stat"><span class="popup-stat__label" style="${highlightColeta}">Coleta Esgoto</span><span class="popup-stat__value" style="${highlightColeta}">${sanitation.coletaEsgoto}%</span></div>`;
                    popupHTML += `<div class="popup-stat"><span class="popup-stat__label" style="${highlightTrat}">Trat. Esgoto</span><span class="popup-stat__value" style="${highlightTrat}">${sanitation.tratamentoEsgoto}%</span></div>`;
                    popupHTML += `</div></div>`;
                }

                popupHTML += `</div>`;
                layer.bindPopup(popupHTML);

                layer.on('mouseover', function () {
                    // No hover highlight in heatmap or esgoto modes — would break the visualization
                    if (currentMapLayer === 'heatmap' || currentMapLayer === 'esgotoRelevo') return;
                    this.setStyle({ weight: 2.5, color: '#38bdf8', fillOpacity: 0.75 });
                    this.bringToFront();
                });
                layer.on('mouseout', function () {
                    if (currentMapLayer === 'heatmap' || currentMapLayer === 'esgotoRelevo') return;
                    geoLayer.resetStyle(this);
                });
                layer.on('click', function () {
                    if (onStateClick) {
                        onStateClick(ufId, ufAbbr, sanitation ? sanitation.nome : ufAbbr);
                    }
                });
            },
        }).addTo(map);

        if (loadingEl) loadingEl.classList.add('hidden');

        fitRegion(currentRegion);

        // Re-render special layers on top after geo reload
        if (currentMapLayer === 'heatmap' && Object.keys(allDiseaseDataForHeatmap).length > 0) {
            setMapHeatmap(allDiseaseDataForHeatmap);
        } else if (currentMapLayer === 'esgotoRelevo') {
            setMapEsgotoRelevo();
        }

    } catch (err) {
        console.error('Erro ao carregar GeoJSON:', err);
        if (loadingEl) {
            loadingEl.innerHTML = '<span style="color: var(--alert-red)">Erro ao carregar mapa</span>';
        }
    }
}

export function fitRegion(region) {
    currentRegion = region;
    const bounds = regionBounds[region] || regionBounds.all;
    map.fitBounds(bounds, { padding: [20, 20], animate: true, duration: 0.5 });
}

export function updateMapColors(capitalData) {
    if (geoLayer) {
        loadGeoJSON(capitalData);
    }
}

export function getMap() {
    return map;
}
