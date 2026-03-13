/**
 * VigiSaúde Brasil — Main Entry Point
 * Orchestrates all components and views
 */
import { fetchNationalOverview, fetchDiseaseData, getSanitationData, getDiseaseInfo, CHART_COLORS, getAlertColorHex, getAlertLevel } from './services/api.js';
import { initMap, loadGeoJSON, fitRegion, updateMapColors, setMapDisease, setMapLayer } from './components/map.js';
import { renderSanitationCorrelation, renderRtChart, renderEpidemicCurve, renderClimateChart } from './components/charts.js';
import { initCards, renderCards, updateNationalSummary, setActiveDisease } from './components/cards.js';
import { initRegionFilters, initTrackerSelectors, initSearch, initPathogenTags } from './components/filters.js';

// ===== App State =====
const state = {
    currentView: 'map',
    currentDisease: 'dengue',
    nationalData: {},   // { disease: [capitalData] }
    currentCity: null,  // { geocode, name, data, prevYearData }
};

// ===== View Navigation =====
function switchView(viewId) {
    state.currentView = viewId;

    document.querySelectorAll('.icon-nav__btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewId);
    });
    document.querySelectorAll('.view').forEach(view => {
        view.classList.toggle('view--active', view.id === `view-${viewId}`);
    });

    if (viewId === 'map') {
        setTimeout(() => {
            import('./components/map.js').then(m => {
                const mapInstance = m.getMap();
                if (mapInstance) mapInstance.invalidateSize();
            });
        }, 100);
    }

    if (viewId === 'info') {
        const data = state.nationalData[state.currentDisease];
        if (data && data.length > 0) {
            renderSanitationCorrelation('sanitation-correlation', data, state.currentDisease);
        }
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
        const data = await fetchNationalOverview(disease);
        state.nationalData[disease] = data;

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
            if (r.status === 'fulfilled') diseaseDataMap[r.value.disease] = r.value.data;
        });

        const cardsContainer = document.getElementById('disease-cards');
        renderCards(cardsContainer, diseaseDataMap);
        updateNationalSummary(data);
        renderHotspots(data, disease);

        await loadGeoJSON(data);

        const lastUpdateEl = document.getElementById('last-update');
        if (lastUpdateEl) {
            const now = new Date();
            lastUpdateEl.textContent = `Atualizado: ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        }

        if (state.currentView === 'info' && document.getElementById('sanitation-correlation')) {
            renderSanitationCorrelation('sanitation-correlation', data, disease);
        }
    } catch (err) {
        console.error('Erro ao carregar dados nacionais:', err);
    }
}

// ===== Render Top Hotspots in Map Sidebar =====
function renderHotspots(data, disease) {
    const section = document.getElementById('hotspots-section');
    const list = document.getElementById('hotspots-list');
    const label = document.getElementById('hotspots-disease-label');

    if (!section || !list || !data || data.length === 0) return;

    const info = getDiseaseInfo(disease || state.currentDisease);
    if (label) label.textContent = `(${info.name.toLowerCase()})`;

    const sorted = data
        .filter(c => c.latest && c.latest.p_inc100k > 0)
        .sort((a, b) => (b.latest.p_inc100k || 0) - (a.latest.p_inc100k || 0))
        .slice(0, 5);

    if (sorted.length === 0) { section.style.display = 'none'; return; }
    section.style.display = '';

    const maxInc = sorted[0].latest.p_inc100k;
    list.innerHTML = sorted.map((cap, idx) => {
        const inc = cap.latest.p_inc100k || 0;
        const pct = maxInc > 0 ? (inc / maxInc) * 100 : 0;
        const alertColor = getAlertColorHex(cap.latest.nivel || 1);
        return `
            <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(148,163,184,0.08);">
                <span style="font-size:0.65rem;font-weight:700;color:var(--text-tertiary);width:14px;text-align:right;">${idx + 1}</span>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;">
                        <span style="font-size:0.75rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cap.name}</span>
                        <span style="font-size:0.7rem;color:${alertColor};font-weight:700;margin-left:4px;white-space:nowrap;">${inc.toFixed(1)}/100k</span>
                    </div>
                    <div style="height:3px;background:var(--surface-1);border-radius:2px;overflow:hidden;">
                        <div style="width:${pct}%;height:100%;background:${alertColor};border-radius:2px;transition:width 0.4s;"></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ===== Tracker: Update KPI Cards =====
function updateKpiCards(data) {
    if (!data || data.length === 0) return;
    const latest = data[data.length - 1];

    // Alert level
    const alertInfo = getAlertLevel(latest.nivel || 1);
    const alertColor = getAlertColorHex(latest.nivel || 1);
    const kpiAlert = document.getElementById('kpi-alert');
    if (kpiAlert) kpiAlert.style.setProperty('--kpi-accent', alertColor);
    const alertVal = document.getElementById('kpi-alert-value');
    if (alertVal) alertVal.textContent = `Nível ${latest.nivel || 1}`;
    const alertSub = document.getElementById('kpi-alert-sub');
    if (alertSub) alertSub.textContent = alertInfo.label;

    // Rt
    const rt = latest.Rt;
    const rtVal = document.getElementById('kpi-rt-value');
    const rtSub = document.getElementById('kpi-rt-sub');
    const kpiRt = document.getElementById('kpi-rt');
    if (rtVal) rtVal.textContent = rt > 0 ? rt.toFixed(2) : '--';
    if (rtSub && rt > 0) {
        const trend = rt > 1 ? '↑ crescendo' : '↓ controlando';
        rtSub.textContent = trend;
        rtSub.style.color = rt > 1 ? 'var(--alert-red)' : 'var(--alert-green)';
        if (kpiRt) kpiRt.style.setProperty('--kpi-accent', rt > 1 ? 'var(--alert-red)' : 'var(--alert-green)');
    }

    // Cases
    const casosEst = latest.casos_est || latest.casos || 0;
    const casosNot = latest.casos || 0;
    const casosVal = document.getElementById('kpi-cases-value');
    const casosSub = document.getElementById('kpi-cases-sub');
    if (casosVal) casosVal.textContent = Math.round(casosEst).toLocaleString('pt-BR');
    if (casosSub) casosSub.textContent = `${Math.round(casosNot).toLocaleString('pt-BR')} notificados`;

    // Incidence
    const inc = latest.p_inc100k || 0;
    const prt1 = latest.p_rt1 != null ? (latest.p_rt1 * 100).toFixed(0) : null;
    const incVal = document.getElementById('kpi-inc-value');
    const incSub = document.getElementById('kpi-inc-sub');
    if (incVal) incVal.textContent = inc > 0 ? inc.toFixed(1) : '--';
    if (incSub) incSub.textContent = prt1 != null ? `Prob. Rt>1: ${prt1}%` : 'por 100k hab.';
}

// ===== Tracker: Update City Info in Sidebar =====
function updateCityInfoCard(name, data, year) {
    const section = document.getElementById('city-info-section');
    const card = document.getElementById('city-info-card');
    if (!section || !card) return;

    const totalCases = data.reduce((s, d) => s + (d.casos || 0), 0);
    const latest = data[data.length - 1];
    section.style.display = '';
    card.innerHTML = `
        <div style="font-weight:700;color:var(--text-primary);margin-bottom:6px;">${name}</div>
        <div style="color:var(--text-secondary);line-height:1.8;">
            <div>Ano analisado: <strong>${year}</strong></div>
            <div>Total de semanas: <strong>${data.length}</strong></div>
            <div>Total casos (ano): <strong>${totalCases.toLocaleString('pt-BR')}</strong></div>
            ${latest ? `<div>Última SE: <strong>SE ${latest.SE % 100}</strong></div>` : ''}
        </div>
    `;
}

// ===== Tracker: Show/Hide Profile State =====
function setTrackerState(state_) {
    // states: 'empty' | 'loading' | 'profile'
    document.getElementById('tracker-empty-state')?.classList.toggle('hidden', state_ !== 'empty');
    document.getElementById('tracker-loading')?.classList.toggle('hidden', state_ !== 'loading');
    document.getElementById('tracker-profile')?.classList.toggle('hidden', state_ !== 'profile');
}

// ===== Tracker: Load City Profile =====
async function loadCityProfile(geocode, name) {
    const year = new Date().getFullYear();
    const comparePrev = document.getElementById('compare-prev-year')?.checked;

    // Update header
    const titleEl = document.getElementById('chart-main-title');
    const info = getDiseaseInfo(state.currentDisease);
    if (titleEl) titleEl.textContent = `${info.name} — ${name}`;

    const badgeEl = document.getElementById('tracker-year-badge');
    if (badgeEl) { badgeEl.textContent = `${year}`; badgeEl.style.display = ''; }

    setTrackerState('loading');

    try {
        const data = await fetchDiseaseData(geocode, state.currentDisease, 1, 52, year, year);
        let prevData = null;

        if (comparePrev) {
            try {
                prevData = await fetchDiseaseData(geocode, state.currentDisease, 1, 52, year - 1, year - 1);
                if (badgeEl) badgeEl.textContent = `${year - 1} vs ${year}`;
            } catch { /* ignore prev year errors */ }
        }

        state.currentCity = { geocode, name, data, prevYearData: prevData };

        // Update KPI cards with latest week data
        updateKpiCards(data);

        // Update sidebar city info
        updateCityInfoCard(name, data, year);

        // Build epidemic curve datasets
        const epicDatasets = { [`${name} (${year})`]: data };
        if (prevData && prevData.length > 0) {
            // Remap prevData SE to same week numbers for overlay alignment
            epicDatasets[`${name} (${year - 1})`] = prevData;
        }

        // Render charts
        renderEpidemicCurve(epicDatasets, state.currentDisease);
        renderRtChart(new Map([[`${name} (${year})`, data]]), state.currentDisease);
        renderClimateChart(data, name);

        setTrackerState('profile');

    } catch (err) {
        console.error(`Erro ao carregar perfil de ${name}:`, err);
        setTrackerState('empty');
    }
}

// ===== Init Map Search → Switch to Tracker =====
function initMapSearchToTracker(geocode, name) {
    switchView('tracker');
    loadCityProfile(geocode, name);
}

// ===== App Init =====
async function init() {
    console.log('VigiSaude Brasil — Inicializando...');

    initNavigation();

    // Map view
    initMap('map', (ufId, ufAbbr, ufName) => {
        console.log(`Estado clicado: ${ufName} (${ufAbbr})`);
    });

    initRegionFilters((region) => { fitRegion(region); });

    // Map layer toggles
    const layerBtns = document.querySelectorAll('.layer-btn');
    layerBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            layerBtns.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            setMapLayer(e.currentTarget.dataset.layer);
        });
    });

    // Map search
    initSearch(initMapSearchToTracker);

    // Disease cards (map view)
    const cardsContainer = document.getElementById('disease-cards');
    initCards(cardsContainer, async (disease) => {
        state.currentDisease = disease;
        setMapDisease(disease);
        await loadNationalData(disease);
    });

    // Tracker — city selector
    await initTrackerSelectors(loadCityProfile);

    // Tracker — disease toggle
    initPathogenTags(async (disease) => {
        state.currentDisease = disease;
        setActiveDisease(disease);
        const info = getDiseaseInfo(disease);
        const titleEl = document.getElementById('chart-main-title');
        if (state.currentCity) {
            if (titleEl) titleEl.textContent = `${info.name} — ${state.currentCity.name}`;
            await loadCityProfile(state.currentCity.geocode, state.currentCity.name);
        } else {
            if (titleEl) titleEl.textContent = 'Selecione um município';
        }
    });

    // Tracker — compare previous year toggle
    document.getElementById('compare-prev-year')?.addEventListener('change', () => {
        if (state.currentCity) {
            loadCityProfile(state.currentCity.geocode, state.currentCity.name);
        }
    });

    // Share button
    document.getElementById('btn-share')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(window.location.href).then(() => {
            const btn = document.getElementById('btn-share');
            const orig = btn.innerHTML;
            btn.innerHTML = '✓ Copiado!';
            setTimeout(() => { btn.innerHTML = orig; }, 2000);
        });
    });

    // Load initial map data
    await loadNationalData('dengue');

    console.log('✅ VigiSaúde Brasil — Pronto!');
}

document.addEventListener('DOMContentLoaded', init);
