/**
 * VigiSaúde Brasil — Main Entry Point
 * Orchestrates all components and views
 */
import { fetchNationalOverview, fetchDiseaseData, getSanitationData, getDiseaseInfo, CHART_COLORS } from './services/api.js';
import { initMap, loadGeoJSON, fitRegion, updateMapColors, setMapDisease, setMapLayer, setMapHeatmap, setMapEsgotoRelevo } from './components/map.js';
import { renderCorrelationChart, renderSanitationCorrelation } from './components/charts.js';
import { initCards, renderCards, updateNationalSummary, setActiveDisease } from './components/cards.js';
import { initRegionFilters, initTrackerSelectors, initPeriodControls, getPeriod, initSearch, initPathogenTags, initChartToggle } from './components/filters.js';

// ===== App State =====
const state = {
    currentView: 'map',
    currentDisease: 'dengue',
    nationalData: {},     // { disease: [capitalData] }
    allDiseaseData: {},   // { dengue, chikungunya, zika } — all 3 for heatmap
    trackerLocations: [], // [{ geocode, name, data }]
    trackerDatasets: new Map(),
};

// ===== View Navigation =====
function switchView(viewId) {
    state.currentView = viewId;

    // Update nav buttons
    document.querySelectorAll('.icon-nav__btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewId);
    });

    // Update view sections
    document.querySelectorAll('.view').forEach(view => {
        view.classList.toggle('view--active', view.id === `view-${viewId}`);
    });

    // Trigger map resize if switching to map
    if (viewId === 'map') {
        setTimeout(() => {
            const map = import('./components/map.js').then(m => {
                const mapInstance = m.getMap();
                if (mapInstance) mapInstance.invalidateSize();
            });
        }, 100);
    }
}

// ===== Init Navigation =====
function initNavigation() {
    document.querySelectorAll('.icon-nav__btn').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
}

// ===== Load National Data for Map View =====
async function loadNationalData(disease = 'dengue') {
    try {
        // Fetch data for the active disease (for map, cards, summary)
        const data = await fetchNationalOverview(disease);
        state.nationalData[disease] = data;

        // Also fetch the other two diseases in background for cards + heatmap
        const allDiseases = ['dengue', 'chikungunya', 'zika'];
        const otherDiseases = allDiseases.filter(d => d !== disease);
        const otherResults = await Promise.allSettled(
            otherDiseases.map(async d => {
                if (state.nationalData[d]) return { disease: d, data: state.nationalData[d] };
                const result = await fetchNationalOverview(d);
                state.nationalData[d] = result;
                return { disease: d, data: result };
            })
        );

        const diseaseDataMap = { [disease]: data };
        otherResults.forEach(r => {
            if (r.status === 'fulfilled') {
                diseaseDataMap[r.value.disease] = r.value.data;
            }
        });

        // Update disease cards with per-disease data
        const cardsContainer = document.getElementById('disease-cards');
        renderCards(cardsContainer, diseaseDataMap);

        // Update national summary (active disease)
        updateNationalSummary(data);

        // Update map colors — pass all disease data so heatmap has it ready
        await loadGeoJSON(data);
        // Store all data for heatmap use
        state.allDiseaseData = diseaseDataMap;

        // If currently in heatmap mode, refresh heatmap with new data
        const activeLayerBtn = document.querySelector('.layer-btn.active');
        if (activeLayerBtn?.dataset.layer === 'heatmap') {
            setMapHeatmap(diseaseDataMap);
        }

        // Update last update date
        const lastUpdateEl = document.getElementById('last-update');
        if (lastUpdateEl) {
            const now = new Date();
            lastUpdateEl.textContent = `Atualizado: ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        }

        // Render sanitation correlation if the canvas exists
        if (document.getElementById('sanitation-correlation')) {
            renderSanitationCorrelation('sanitation-correlation', data);
        }

    } catch (err) {
        console.error('Erro ao carregar dados nacionais:', err);
    }
}

// ===== Tracker: Add Location =====
async function addTrackerLocation(geocode, name) {
    // Check if already added
    if (state.trackerLocations.find(l => l.geocode === geocode)) return;

    const period = getPeriod();

    try {
        const data = await fetchDiseaseData(geocode, state.currentDisease, period.ewStart, period.ewEnd, period.eyStart, period.eyEnd);
        const location = { geocode, name, data };
        state.trackerLocations.push(location);

        // Update datasets map
        state.trackerDatasets.set(name, data);

        // Update UI
        renderTrackerLocations();
        updateTrackerCharts();
        updateChartTitle();

    } catch (err) {
        console.error(`Erro ao carregar dados de ${name}:`, err);
    }
}

// ===== Tracker: Remove Location =====
function removeTrackerLocation(geocode) {
    const idx = state.trackerLocations.findIndex(l => l.geocode === geocode);
    if (idx === -1) return;

    const name = state.trackerLocations[idx].name;
    state.trackerLocations.splice(idx, 1);
    state.trackerDatasets.delete(name);

    renderTrackerLocations();
    updateTrackerCharts();
    updateChartTitle();
}

// ===== Render Selected Locations in Sidebar =====
function renderTrackerLocations() {
    const container = document.getElementById('selected-locations');
    const countEl = document.getElementById('loc-count');

    if (countEl) {
        countEl.textContent = `${state.trackerLocations.length} selecionada${state.trackerLocations.length !== 1 ? 's' : ''}`;
    }

    container.innerHTML = state.trackerLocations.map((loc, idx) => {
        const color = CHART_COLORS[idx % CHART_COLORS.length];
        return `
      <div class="selected-location">
        <span class="selected-location__color" style="background: ${color}"></span>
        <span class="selected-location__name">${loc.name}</span>
        <button class="selected-location__remove" data-geocode="${loc.geocode}" title="Remover">✕</button>
      </div>
    `;
    }).join('');

    // Remove button handlers
    container.querySelectorAll('.selected-location__remove').forEach(btn => {
        btn.addEventListener('click', () => removeTrackerLocation(btn.dataset.geocode));
    });
}

// ===== Update Chart Title =====
function updateChartTitle() {
    const titleEl = document.getElementById('chart-main-title');
    const info = getDiseaseInfo(state.currentDisease);

    if (state.trackerLocations.length === 0) {
        titleEl.textContent = `${info.name} — Selecione uma localidade`;
    } else if (state.trackerLocations.length === 1) {
        titleEl.textContent = `${info.name} — ${state.trackerLocations[0].name}`;
    } else {
        titleEl.textContent = `${info.name} — ${state.trackerLocations.length} localidades`;
    }
}

// ===== Update Tracker Charts =====
function updateTrackerCharts() {
    renderCorrelationChart(state.trackerDatasets, state.currentDisease, new Date().getFullYear());
}

// ===== Reload Tracker Data (on disease or period change) =====
async function reloadTrackerData() {
    if (state.trackerLocations.length === 0) return;

    const period = getPeriod();
    state.trackerDatasets.clear();

    await Promise.all(
        state.trackerLocations.map(async (loc) => {
            try {
                const data = await fetchDiseaseData(loc.geocode, state.currentDisease, period.ewStart, period.ewEnd, period.eyStart, period.eyEnd);
                loc.data = data;
                state.trackerDatasets.set(loc.name, data);
            } catch (err) {
                console.error(`Erro ao recarregar ${loc.name}:`, err);
            }
        })
    );

    updateTrackerCharts();
    updateChartTitle();
}

// ===== Init Tracker Toggle Listeners =====
function initTrackerToggles() {

    // Period change listeners
    ['ew-start', 'ew-end', 'ey-start', 'ey-end'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            reloadTrackerData();
        });
    });

    // Share button
    document.getElementById('btn-share')?.addEventListener('click', () => {
        const url = window.location.href;
        navigator.clipboard?.writeText(url).then(() => {
            const btn = document.getElementById('btn-share');
            const orig = btn.innerHTML;
            btn.innerHTML = '✓ Copiado!';
            setTimeout(() => { btn.innerHTML = orig; }, 2000);
        });
    });
}

// ===== Init Map Search → Switch to Tracker =====
function initMapSearchToTracker(geocode, name) {
    // Switch to tracker and add location
    switchView('tracker');
    addTrackerLocation(geocode, name);
}

// ===== App Init =====
async function init() {
    console.log('VigiSaude Brasil — Inicializando...');

    // Navigation
    initNavigation();

    // Map view
    initMap('map', (ufId, ufAbbr, ufName) => {
        // On state click → switch to tracker with a capital from that state
        console.log(`Estado clicado: ${ufName} (${ufAbbr})`);
    });

    // Region filters
    initRegionFilters((region) => {
        fitRegion(region);
    });

    // Map layer toggles
    const layerBtns = document.querySelectorAll('.layer-btn');
    layerBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Update active styling
            layerBtns.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');

            const layer = e.currentTarget.dataset.layer;

            if (layer === 'heatmap') {
                // Pass all collected disease data to the heatmap renderer
                const allData = state.allDiseaseData || state.nationalData;
                setMapHeatmap(allData);
            } else if (layer === 'esgotoRelevo') {
                setMapEsgotoRelevo();
            } else {
                setMapLayer(layer);
            }
        });
    });

    // Search
    initSearch(initMapSearchToTracker);

    // Disease cards
    const cardsContainer = document.getElementById('disease-cards');
    initCards(cardsContainer, async (disease) => {
        state.currentDisease = disease;
        setMapDisease(disease);
        await loadNationalData(disease);
    });

    // Tracker view
    await initTrackerSelectors(addTrackerLocation);
    initPeriodControls();
    initPathogenTags(async (disease) => {
        state.currentDisease = disease;
        setActiveDisease(disease);
        updateChartTitle();
        await reloadTrackerData();
    });
    initChartToggle((chartType) => {
        // Could switch chart type; for now line chart is default
        console.log(`Tipo de gráfico: ${chartType}`);
    });
    initTrackerToggles();

    // Load initial data
    await loadNationalData('dengue');

    console.log('✅ VigiSaúde Brasil — Pronto!');
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
