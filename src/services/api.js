/**
 * VigiSaúde Brasil — API Service
 * Integrates: InfoDengue, IBGE Localidades, IBGE Malhas, SNIS (Saneamento)
 */

// ===== Cache =====
const cache = new Map();

function cacheKey(...args) {
    return args.join('|');
}

async function cachedFetch(key, fetcher) {
    if (cache.has(key)) return cache.get(key);
    const data = await fetcher();
    cache.set(key, data);
    return data;
}

// ===== IBGE Localidades =====

export async function fetchStates() {
    return cachedFetch('states', async () => {
        const res = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome');
        if (!res.ok) throw new Error('Falha ao carregar estados');
        return res.json();
    });
}

export async function fetchMunicipios(ufId) {
    return cachedFetch(`municipios-${ufId}`, async () => {
        const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${ufId}/municipios?orderBy=nome`);
        if (!res.ok) throw new Error('Falha ao carregar municípios');
        return res.json();
    });
}

// ===== IBGE Malhas (GeoJSON) =====

export async function fetchBrazilGeoJSON() {
    return cachedFetch('brazil-geo', async () => {
        const res = await fetch('https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF');
        if (!res.ok) throw new Error('Falha ao carregar malha geográfica');
        return res.json();
    });
}

// ===== InfoDengue API =====

export async function fetchDiseaseData(geocode, disease = 'dengue', ewStart = 1, ewEnd = 52, eyStart = 2025, eyEnd = 2025) {
    const key = cacheKey('disease', geocode, disease, ewStart, ewEnd, eyStart, eyEnd);
    return cachedFetch(key, async () => {
        // Use proxy in dev to avoid CORS, direct URL in production
        const baseUrl = import.meta.env.DEV ? '/api/infodengue' : 'https://info.dengue.mat.br/api';
        const url = `${baseUrl}/alertcity?geocode=${geocode}&disease=${disease}&format=json&ew_start=${ewStart}&ew_end=${ewEnd}&ey_start=${eyStart}&ey_end=${eyEnd}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Falha ao carregar dados de ${disease}`);
        const data = await res.json();
        // Sort by epidemiological week
        return data.sort((a, b) => a.SE - b.SE);
    });
}

// Fetch alert data for multiple capital cities (for national overview)
// Falls back to previous years if no data found (e.g. Zika)
export async function fetchNationalOverview(disease = 'dengue') {
    const key = cacheKey('national', disease);
    return cachedFetch(key, async () => {
        // Brazilian state capitals with their IBGE geocodes
        const capitals = [
            { name: 'São Paulo', geocode: 3550308, uf: 'SP' },
            { name: 'Rio de Janeiro', geocode: 3304557, uf: 'RJ' },
            { name: 'Belo Horizonte', geocode: 3106200, uf: 'MG' },
            { name: 'Salvador', geocode: 2927408, uf: 'BA' },
            { name: 'Brasília', geocode: 5300108, uf: 'DF' },
            { name: 'Fortaleza', geocode: 2304400, uf: 'CE' },
            { name: 'Manaus', geocode: 1302603, uf: 'AM' },
            { name: 'Curitiba', geocode: 4106902, uf: 'PR' },
            { name: 'Recife', geocode: 2611606, uf: 'PE' },
            { name: 'Goiânia', geocode: 5208707, uf: 'GO' },
            { name: 'Belém', geocode: 1501402, uf: 'PA' },
            { name: 'Porto Alegre', geocode: 4314902, uf: 'RS' },
            { name: 'São Luís', geocode: 2111300, uf: 'MA' },
            { name: 'Maceió', geocode: 2704302, uf: 'AL' },
            { name: 'Campo Grande', geocode: 5002704, uf: 'MS' },
            { name: 'Natal', geocode: 2408102, uf: 'RN' },
            { name: 'Teresina', geocode: 2211001, uf: 'PI' },
            { name: 'João Pessoa', geocode: 2507507, uf: 'PB' },
            { name: 'Aracaju', geocode: 2800308, uf: 'SE' },
            { name: 'Cuiabá', geocode: 5103403, uf: 'MT' },
            { name: 'Florianópolis', geocode: 4205407, uf: 'SC' },
            { name: 'Vitória', geocode: 3205309, uf: 'ES' },
            { name: 'Porto Velho', geocode: 1100205, uf: 'RO' },
            { name: 'Macapá', geocode: 1600303, uf: 'AP' },
            { name: 'Rio Branco', geocode: 1200401, uf: 'AC' },
            { name: 'Boa Vista', geocode: 1400100, uf: 'RR' },
            { name: 'Palmas', geocode: 1721000, uf: 'TO' },
        ];

        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const startOfYear = new Date(currentYear, 0, 1);
        const dayOfYear = Math.floor((currentDate - startOfYear) / 86400000);
        const currentEW = Math.min(Math.ceil(dayOfYear / 7), 52);
        const startEW = Math.max(1, currentEW - 4);

        // Helper: fetch all capitals for a given year
        async function fetchForYear(year, ewStart, ewEnd) {
            const results = await Promise.allSettled(
                capitals.map(async (cap) => {
                    try {
                        const data = await fetchDiseaseData(cap.geocode, disease, ewStart, ewEnd, year, year);
                        const latest = data.length > 0 ? data[data.length - 1] : null;
                        return { ...cap, data, latest, dataYear: year };
                    } catch {
                        return { ...cap, data: [], latest: null, dataYear: year };
                    }
                })
            );
            return results.filter(r => r.status === 'fulfilled').map(r => r.value);
        }

        // Try current year first
        let data = await fetchForYear(currentYear, startEW, currentEW);
        let hasData = data.some(d => d.latest !== null);

        // If no data, try previous years (up to 3 years back)
        if (!hasData) {
            for (let y = currentYear - 1; y >= currentYear - 3; y--) {
                data = await fetchForYear(y, 1, 52);
                hasData = data.some(d => d.latest !== null);
                if (hasData) break;
            }
        }

        return data;
    });
}

// ===== IBGE Municipality GeoJSON =====

export async function fetchStateGeoJSON(ufId) {
    return cachedFetch(`state-geo-${ufId}`, async () => {
        const res = await fetch(`https://servicodados.ibge.gov.br/api/v3/malhas/estados/${ufId}?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio`);
        if (!res.ok) throw new Error(`Falha ao carregar malha de municípios (UF ${ufId})`);
        return res.json();
    });
}

// ===== Major cities per UF (geocode list for bulk alerts) =====
// ~10–15 largest cities per state to avoid excessive API calls
export const MAJOR_CITIES_BY_UF = {
    11: [1100205, 1100023, 1100015, 1100122, 1100114, 1100049, 1100304, 1100320, 1100155, 1100189], // RO
    12: [1200401, 1200104, 1200203, 1200302, 1200500, 1200609, 1200138, 1200179, 1200013, 1200054], // AC
    13: [1302603, 1302702, 1301902, 1303403, 1301100, 1301209, 1300706, 1302504, 1303536, 1300508], // AM
    14: [1400100, 1400472, 1400233, 1400159, 1400050, 1400027, 1400282, 1400407, 1400456, 1400300], // RR
    15: [1501402, 1500800, 1504208, 1505536, 1502301, 1502202, 1505502, 1500602, 1502764, 1501303], // PA
    16: [1600303, 1600600, 1600154, 1600055, 1600105, 1600204, 1600279, 1600400, 1600212, 1600709], // AP
    17: [1721000, 1702109, 1716109, 1713205, 1709500, 1718204, 1703826, 1710508, 1718840, 1708205], // TO
    21: [2111300, 2105302, 2104800, 2100055, 2109106, 2103000, 2101400, 2108403, 2105153, 2112209], // MA
    22: [2211001, 2211100, 2207702, 2205003, 2201200, 2207108, 2203503, 2207553, 2202109, 2205102], // PI
    23: [2304400, 2304103, 2307304, 2309706, 2303709, 2305233, 2312908, 2306306, 2300200, 2305100], // CE
    24: [2408102, 2407104, 2411056, 2401305, 2403251, 2404408, 2408003, 2405306, 2312508, 2406155], // RN
    25: [2507507, 2504009, 2501104, 2500809, 2503704, 2408508, 2507101, 2502805, 2507200, 2505600], // PB
    26: [2611606, 2607901, 2604106, 2609600, 2607208, 2610707, 2602902, 2605459, 2606101, 2604007], // PE
    27: [2704302, 2700300, 2706307, 2704906, 2704708, 2702306, 2701506, 2703403, 2705200, 2702108], // AL
    28: [2800308, 2802106, 2803500, 2804508, 2802502, 2801504, 2803609, 2800100, 2806701, 2802007], // SE
    29: [2927408, 2910800, 2919207, 2905701, 2933307, 2918209, 2914802, 2930774, 2924009, 2907202], // BA
    31: [3106200, 3170206, 3118601, 3136702, 3106705, 3137601, 3157807, 3122306, 3154606, 3131307], // MG
    32: [3205309, 3205200, 3201308, 3205002, 3202405, 3200607, 3203205, 3205101, 3201209, 3203346], // ES
    33: [3304557, 3302403, 3303302, 3302858, 3301702, 3301009, 3302007, 3301405, 3304904, 3300456], // RJ
    35: [3550308, 3518800, 3509502, 3524402, 3548500, 3547809, 3543402, 3552205, 3549805, 3534401], // SP
    41: [4106902, 4113700, 4105805, 4109401, 4115200, 4104808, 4119905, 4125506, 4103404, 4108304], // PR
    42: [4205407, 4209102, 4204202, 4202404, 4214805, 4208203, 4200705, 4206504, 4211306, 4205191], // SC
    43: [4314902, 4303905, 4305108, 4316907, 4306106, 4310801, 4303103, 4313409, 4320008, 4318705], // RS
    50: [5002704, 5003702, 5002502, 5008305, 5006200, 5007208, 5007109, 5003504, 5004403, 5005707], // MS
    51: [5103403, 5108402, 5106422, 5107602, 5106224, 5103254, 5102678, 5103700, 5101902, 5107909], // MT
    52: [5208707, 5201405, 5200050, 5211503, 5206206, 5219753, 5200258, 5209408, 5219712, 5220405], // GO
    53: [5300108], // DF
};

// ===== Fetch disease alerts for multiple municipalities =====
export async function fetchBulkMunicipioAlerts(geocodes, disease = 'dengue') {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const dayOfYear = Math.floor((currentDate - startOfYear) / 86400000);
    const currentEW = Math.min(Math.ceil(dayOfYear / 7), 52);
    const startEW = Math.max(1, currentEW - 2);

    const results = await Promise.allSettled(
        geocodes.map(async (geocode) => {
            try {
                const data = await fetchDiseaseData(geocode, disease, startEW, currentEW, currentYear, currentYear);
                const latest = data.length > 0 ? data[data.length - 1] : null;
                return { geocode, data, latest };
            } catch {
                return { geocode, data: [], latest: null };
            }
        })
    );

    const alertMap = {};
    results
        .filter(r => r.status === 'fulfilled')
        .forEach(r => {
            const val = r.value;
            if (val.latest) {
                alertMap[val.geocode] = val.latest;
            }
        });

    return alertMap;
}

// ===== SNIS — Sanitation (Sewage) Data =====
// We use pre-built data representing sewage coverage by state
// Source: SNIS 2023 / Atlas Esgotos - ANA
// Columns: % population with sewage collection, % sewage treated

export function getSanitationData() {
    // Latest available SNIS data (reference year 2022/2023)
    // Source: SNIS - Diagnóstico Temático Serviços de Água e Esgoto
    return {
        AC: { coletaEsgoto: 14.4, tratamentoEsgoto: 20.8, idh: 0.663, nome: 'Acre' },
        AL: { coletaEsgoto: 29.6, tratamentoEsgoto: 30.1, idh: 0.631, nome: 'Alagoas' },
        AM: { coletaEsgoto: 14.2, tratamentoEsgoto: 33.5, idh: 0.674, nome: 'Amazonas' },
        AP: { coletaEsgoto: 6.1, tratamentoEsgoto: 11.8, idh: 0.708, nome: 'Amapá' },
        BA: { coletaEsgoto: 35.8, tratamentoEsgoto: 52.4, idh: 0.660, nome: 'Bahia' },
        CE: { coletaEsgoto: 29.9, tratamentoEsgoto: 42.1, idh: 0.682, nome: 'Ceará' },
        DF: { coletaEsgoto: 90.5, tratamentoEsgoto: 82.3, idh: 0.824, nome: 'Distrito Federal' },
        ES: { coletaEsgoto: 57.4, tratamentoEsgoto: 51.7, idh: 0.740, nome: 'Espírito Santo' },
        GO: { coletaEsgoto: 58.0, tratamentoEsgoto: 67.3, idh: 0.735, nome: 'Goiás' },
        MA: { coletaEsgoto: 13.7, tratamentoEsgoto: 17.8, idh: 0.639, nome: 'Maranhão' },
        MG: { coletaEsgoto: 71.4, tratamentoEsgoto: 46.5, idh: 0.731, nome: 'Minas Gerais' },
        MS: { coletaEsgoto: 46.5, tratamentoEsgoto: 62.8, idh: 0.729, nome: 'Mato Grosso do Sul' },
        MT: { coletaEsgoto: 36.2, tratamentoEsgoto: 63.7, idh: 0.725, nome: 'Mato Grosso' },
        PA: { coletaEsgoto: 8.4, tratamentoEsgoto: 15.2, idh: 0.646, nome: 'Pará' },
        PB: { coletaEsgoto: 36.7, tratamentoEsgoto: 43.2, idh: 0.658, nome: 'Paraíba' },
        PE: { coletaEsgoto: 32.8, tratamentoEsgoto: 39.5, idh: 0.673, nome: 'Pernambuco' },
        PI: { coletaEsgoto: 12.8, tratamentoEsgoto: 22.1, idh: 0.646, nome: 'Piauí' },
        PR: { coletaEsgoto: 74.4, tratamentoEsgoto: 83.1, idh: 0.749, nome: 'Paraná' },
        RJ: { coletaEsgoto: 65.3, tratamentoEsgoto: 41.8, idh: 0.761, nome: 'Rio de Janeiro' },
        RN: { coletaEsgoto: 26.9, tratamentoEsgoto: 34.7, idh: 0.684, nome: 'Rio Grande do Norte' },
        RO: { coletaEsgoto: 7.5, tratamentoEsgoto: 13.9, idh: 0.690, nome: 'Rondônia' },
        RR: { coletaEsgoto: 22.6, tratamentoEsgoto: 41.2, idh: 0.707, nome: 'Roraima' },
        RS: { coletaEsgoto: 33.2, tratamentoEsgoto: 44.6, idh: 0.746, nome: 'Rio Grande do Sul' },
        SC: { coletaEsgoto: 30.8, tratamentoEsgoto: 46.2, idh: 0.774, nome: 'Santa Catarina' },
        SE: { coletaEsgoto: 23.0, tratamentoEsgoto: 36.8, idh: 0.665, nome: 'Sergipe' },
        SP: { coletaEsgoto: 89.6, tratamentoEsgoto: 73.4, idh: 0.783, nome: 'São Paulo' },
        TO: { coletaEsgoto: 27.4, tratamentoEsgoto: 55.3, idh: 0.699, nome: 'Tocantins' },
    };
}

// ===== UF code to abbreviation mapping =====
export function getUFAbbreviation(ufId) {
    const map = {
        11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
        21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
        31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
        41: 'PR', 42: 'SC', 43: 'RS',
        50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF'
    };
    return map[ufId] || '';
}

// ===== Region mapping =====
export function getRegionForUF(ufAbbr) {
    const regions = {
        norte: ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'],
        nordeste: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
        sudeste: ['ES', 'MG', 'RJ', 'SP'],
        sul: ['PR', 'RS', 'SC'],
        'centro-oeste': ['DF', 'GO', 'MS', 'MT']
    };
    for (const [region, ufs] of Object.entries(regions)) {
        if (ufs.includes(ufAbbr)) return region;
    }
    return 'all';
}

// ===== Alert Level helpers =====
export function getAlertLevel(nivel) {
    const levels = {
        1: { label: 'Verde', color: 'var(--alert-green)', bg: 'rgba(34, 197, 94, 0.15)', class: 'badge--green' },
        2: { label: 'Atenção', color: 'var(--alert-yellow)', bg: 'rgba(234, 179, 8, 0.15)', class: 'badge--yellow' },
        3: { label: 'Alerta', color: 'var(--alert-orange)', bg: 'rgba(249, 115, 22, 0.15)', class: 'badge--orange' },
        4: { label: 'Emergência', color: 'var(--alert-red)', bg: 'rgba(239, 68, 68, 0.15)', class: 'badge--red' },
    };
    return levels[nivel] || levels[1];
}

export function getAlertColorHex(nivel) {
    const colors = { 1: '#22c55e', 2: '#eab308', 3: '#f97316', 4: '#ef4444' };
    return colors[nivel] || colors[1];
}

// ===== Disease display info =====
export function getDiseaseInfo(disease) {
    const info = {
        dengue: { name: 'Dengue', icon: '<svg class="disease-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>', color: 'var(--color-dengue)', colorHex: '#f59e0b' },
        chikungunya: { name: 'Chikungunya', icon: '<svg class="disease-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2"/><path d="M12 7V2M12 22v-5M17 12h5M2 12h5"/></svg>', color: 'var(--color-chikungunya)', colorHex: '#ec4899' },
        zika: { name: 'Zika', icon: '<svg class="disease-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>', color: 'var(--color-zika)', colorHex: '#8b5cf6' },
    };
    return info[disease] || info.dengue;
}

// Chart colors for multiple series
export const CHART_COLORS = [
    '#38bdf8', '#f59e0b', '#34d399', '#ec4899', '#a78bfa',
    '#fb923c', '#22d3ee', '#f472b6', '#4ade80', '#c084fc'
];
