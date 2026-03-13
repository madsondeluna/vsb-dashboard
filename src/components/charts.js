/**
 * VigiSaúde Brasil — Charts Component
 * Chart.js visualizations: Cases, Rt, Incidence, Climate, Sanitation correlation
 */
import { Chart, registerables } from 'chart.js';
import { CHART_COLORS, getSanitationData, getDiseaseInfo } from '../services/api.js';

Chart.register(...registerables);

// Global Chart.js defaults — light mode
Chart.defaults.color = '#4b5563';
Chart.defaults.borderColor = 'rgba(0, 0, 0, 0.07)';
Chart.defaults.font.family = "'Ubuntu Mono', 'Courier New', monospace";
Chart.defaults.font.size = 12;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.padding = 16;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(255, 255, 255, 0.97)';
Chart.defaults.plugins.tooltip.titleColor = '#1e1e2e';
Chart.defaults.plugins.tooltip.bodyColor = '#4b5563';
Chart.defaults.plugins.tooltip.titleFont = { weight: '700', size: 13, family: "'Ubuntu Mono', monospace" };
Chart.defaults.plugins.tooltip.bodyFont = { size: 12, family: "'Ubuntu Mono', monospace" };
Chart.defaults.plugins.tooltip.padding = 12;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.borderColor = 'rgba(0, 0, 0, 0.12)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.animation = { duration: 600, easing: 'easeOutQuart' };

let mainChart = null;
let rtChart = null;
let incidenceChart = null;
let climateChart = null;
let epidemicChart = null;
let climateWeeklyChart = null;

function destroyChart(chart) {
    if (chart) chart.destroy();
    return null;
}

function formatSE(se) {
    const year = Math.floor(se / 100);
    const week = se % 100;
    return `SE ${week}/${year}`;
}

function formatSEShort(se) {
    return `SE ${se % 100}`;
}

// Helper to convert Epidemiological Week (1-52) to Month (0-11) approx
function weekToMonth(week) {
    if (week <= 4) return 0; // Jan
    if (week <= 9) return 1; // Feb
    if (week <= 13) return 2; // Mar
    if (week <= 17) return 3; // Apr
    if (week <= 22) return 4; // May
    if (week <= 26) return 5; // Jun
    if (week <= 30) return 6; // Jul
    if (week <= 35) return 7; // Aug
    if (week <= 39) return 8; // Sep
    if (week <= 43) return 9; // Oct
    if (week <= 48) return 10;// Nov
    return 11;                // Dec
}

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// ===== Unified Correlation Chart =====
export function renderCorrelationChart(datasetsMap, disease = 'dengue', year = new Date().getFullYear()) {
    mainChart = destroyChart(mainChart);

    const canvas = document.getElementById('main-chart');
    const emptyState = document.getElementById('chart-empty-state');

    if (!datasetsMap || datasetsMap.size === 0) {
        canvas.classList.add('hidden');
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    canvas.classList.remove('hidden');
    if (emptyState) emptyState.classList.add('hidden');

    const datasets = [];
    let colorIdx = 0;

    for (const [locationName, data] of datasetsMap) {
        if (data.length === 0) continue;

        // Base color for this city
        const color = CHART_COLORS[colorIdx % CHART_COLORS.length];

        // 1. Aggregate Data by Month
        const monthlyData = Array.from({ length: 12 }, () => ({
            casos: 0,
            tempSum: 0, tempCount: 0,
            umidSum: 0, umidCount: 0
        }));

        data.forEach(d => {
            const m = weekToMonth(d.SE % 100);
            monthlyData[m].casos += (d.casos || 0);
            if (d.tempmed > 0) { monthlyData[m].tempSum += d.tempmed; monthlyData[m].tempCount++; }
            if (d.umidmed > 0) { monthlyData[m].umidSum += d.umidmed; monthlyData[m].umidCount++; }
        });

        const casosArray = monthlyData.map(m => m.casos);
        // Normalize temperature to 0–100 scale (15–42°C range) so it shares y1 with humidity
        const tempArray = monthlyData.map(m => m.tempCount > 0 ? ((m.tempSum / m.tempCount - 15) / (42 - 15)) * 100 : null);
        const umidArray = monthlyData.map(m => m.umidCount > 0 ? (m.umidSum / m.umidCount) : null);

        // 2. Add Cases (Bar) - primary Y axis
        datasets.push({
            label: `${locationName} - Casos`,
            data: casosArray,
            backgroundColor: color + '99',
            borderColor: color,
            borderWidth: 1,
            borderRadius: 4,
            type: 'bar',
            yAxisID: 'y',
            order: 3
        });

        // 3. Add Climate (Lines)
        datasets.push({
            label: `${locationName} - Umidade Média (%)`,
            data: umidArray,
            borderColor: '#6baed6',
            backgroundColor: 'transparent',
            tension: 0.4,
            pointRadius: 2,
            borderWidth: 2,
            borderDash: [5, 5],
            type: 'line',
            yAxisID: 'y1',
            spanGaps: true,
            order: 2
        });

        datasets.push({
            label: `${locationName} - Temp. Média (°C)`,
            data: tempArray,
            borderColor: '#f97316',
            backgroundColor: 'transparent',
            tension: 0.4,
            pointRadius: 2,
            borderWidth: 2,
            type: 'line',
            yAxisID: 'y1',
            spanGaps: true,
            order: 2
        });

        colorIdx++;
    }

    if (datasets.length === 0) return;

    const ctx = canvas.getContext('2d');

    mainChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: MONTH_LABELS, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', align: 'start', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            let label = ctx.dataset.label || '';
                            let value = ctx.parsed.y;
                            if (value === null || value === undefined) return null;
                            if (label.includes('Casos')) return `${label}: ${Math.round(value).toLocaleString('pt-BR')}`;
                            if (label.includes('Umidade')) return `${label}: ${value.toFixed(1)}%`;
                            if (label.includes('Temp')) return `${label}: ${((value / 100) * (42 - 15) + 15).toFixed(1)}°C`;
                            return `${label}: ${value}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: 'rgba(148, 163, 184, 0.08)' },
                    title: { display: true, text: 'Número de Casos Mensais', font: { size: 11, weight: '500' } },
                    ticks: { callback: (v) => v.toLocaleString('pt-BR') },
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'Umidade (%) / Temp. normalizada', font: { size: 11, weight: '500' } },
                    min: 0,
                    max: 100,
                    ticks: { callback: v => `${v}%` },
                },
            },
        },
    });
}

// ===== Sanitation Correlation Scatter (view Info) =====
export function renderSanitationCorrelation(containerId, capitalData, disease = 'dengue') {
    const existing = Chart.getChart(containerId);
    if (existing) existing.destroy();

    const canvas = document.getElementById(containerId);
    if (!canvas || !capitalData || capitalData.length === 0) return;

    const sanitationData = getSanitationData();
    const info = getDiseaseInfo(disease);

    // Scatter: X = coleta esgoto %, Y = incidência/100k
    const scatterColeta = capitalData
        .filter(c => c.latest && sanitationData[c.uf])
        .map(c => ({
            x: sanitationData[c.uf].coletaEsgoto,
            y: c.latest.p_inc100k || 0,
            label: c.name,
            uf: c.uf,
            tratamento: sanitationData[c.uf].tratamentoEsgoto,
        }));

    // Second dataset: X = tratamento esgoto %, Y = incidência/100k
    const scatterTratamento = capitalData
        .filter(c => c.latest && sanitationData[c.uf])
        .map(c => ({
            x: sanitationData[c.uf].tratamentoEsgoto,
            y: c.latest.p_inc100k || 0,
            label: c.name,
            uf: c.uf,
        }));

    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Coleta de Esgoto (%) vs Incidência',
                    data: scatterColeta,
                    backgroundColor: '#6baed680',
                    borderColor: '#6baed6',
                    borderWidth: 1.5,
                    pointRadius: 6,
                    pointHoverRadius: 9,
                },
                {
                    label: 'Tratamento de Esgoto (%) vs Incidência',
                    data: scatterTratamento,
                    backgroundColor: info.colorHex + '80',
                    borderColor: info.colorHex,
                    borderWidth: 1.5,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    pointStyle: 'triangle',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', align: 'start', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const d = ctx.raw;
                            const metrica = ctx.dataset.label.includes('Coleta') ? 'Coleta' : 'Tratamento';
                            return `${d.label} (${d.uf}): ${metrica} ${d.x}% · Inc ${d.y.toFixed(1)}/100k`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    title: { display: true, text: 'Cobertura de Esgoto (%)', font: { size: 12 } },
                    grid: { color: 'rgba(148, 163, 184, 0.08)' },
                    min: 0,
                    max: 100,
                },
                y: {
                    title: { display: true, text: `Incidência ${info.name}/100k hab.`, font: { size: 12 } },
                    grid: { color: 'rgba(148, 163, 184, 0.08)' },
                    min: 0,
                },
            },
        },
    });
}

// ===== Rt Over Time Chart (tracker view) =====
export function renderRtChart(datasetsMap, disease = 'dengue') {
    const canvas = document.getElementById('rt-chart');
    if (!canvas) return;

    const existing = Chart.getChart('rt-chart');
    if (existing) existing.destroy();

    const panel = document.getElementById('rt-chart-panel');

    if (!datasetsMap || datasetsMap.size === 0) {
        if (panel) panel.classList.add('hidden');
        return;
    }

    // Hide panel if no Rt data available
    let hasAnyRt = false;
    for (const [, data] of datasetsMap) {
        if (data.some(d => d.Rt > 0)) { hasAnyRt = true; break; }
    }
    if (!hasAnyRt) {
        if (panel) panel.classList.add('hidden');
        return;
    }
    if (panel) panel.classList.remove('hidden');

    // Collect all unique SE values across all locations
    const allSEs = new Set();
    for (const [, data] of datasetsMap) {
        data.forEach(d => allSEs.add(d.SE));
    }
    const seArray = [...allSEs].sort((a, b) => a - b);
    const labels = seArray.map(se => formatSEShort(se));

    const datasets = [];

    // Dashed reference line at Rt = 1
    datasets.push({
        label: 'Limiar Rt = 1',
        data: seArray.map(() => 1),
        borderColor: 'rgba(192, 88, 88, 0.55)',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderDash: [6, 4],
        pointRadius: 0,
        type: 'line',
        yAxisID: 'y',
        order: 99,
        spanGaps: true,
    });

    let colorIdx = 0;
    for (const [locationName, data] of datasetsMap) {
        if (data.length === 0) continue;
        const color = CHART_COLORS[colorIdx % CHART_COLORS.length];
        const seToRt = new Map(data.map(d => [d.SE, d.Rt]));
        const rtData = seArray.map(se => {
            const rt = seToRt.get(se);
            return (rt !== null && rt !== undefined && rt > 0) ? parseFloat(rt.toFixed(3)) : null;
        });

        datasets.push({
            label: `${locationName} — Rt`,
            data: rtData,
            borderColor: color,
            backgroundColor: color + '18',
            tension: 0.35,
            pointRadius: 2,
            pointHoverRadius: 5,
            borderWidth: 2,
            fill: false,
            type: 'line',
            yAxisID: 'y',
            spanGaps: true,
            order: colorIdx + 1,
        });
        colorIdx++;
    }

    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', align: 'start', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const label = ctx.dataset.label || '';
                            const value = ctx.parsed.y;
                            if (value === null || value === undefined) return null;
                            if (label.includes('Limiar')) return null;
                            const trend = value > 1 ? '↑ crescimento' : '↓ controle';
                            return `${label}: ${value.toFixed(2)} (${trend})`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 13, font: { size: 10 } },
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    min: 0,
                    suggestedMax: 2.5,
                    grid: { color: 'rgba(148, 163, 184, 0.08)' },
                    title: { display: true, text: 'Número de Reprodução (Rt)', font: { size: 11, weight: '500' } },
                    ticks: { callback: v => v.toFixed(1) },
                },
            },
        },
    });
}

// ===== Sanitation vs Incidence Comparison (tracker view) =====
// Shows coleta/tratamento % per selected location alongside incidência média
export function renderSanitationComparison(canvasId, datasetsMap, disease = 'dengue') {
    const existing = Chart.getChart(canvasId);
    if (existing) existing.destroy();

    const panel = document.getElementById('sanitation-chart-panel');
    const canvas = document.getElementById(canvasId);

    if (!canvas || !datasetsMap || datasetsMap.size === 0) {
        if (panel) panel.classList.add('hidden');
        return;
    }

    const sanitationData = getSanitationData();
    const info = getDiseaseInfo(disease);

    const labels = [];
    const coletaData = [];
    const tratamentoData = [];
    const incidenciaData = [];

    for (const [locationName, data] of datasetsMap) {
        if (data.length === 0) continue;

        // Name format: "CityName, UF"
        const parts = locationName.split(', ');
        const uf = parts.length > 1 ? parts[parts.length - 1].trim() : null;
        const san = uf ? sanitationData[uf] : null;

        const avgInc = data.length > 0
            ? data.reduce((sum, d) => sum + (d.p_inc100k || 0), 0) / data.length
            : 0;

        labels.push(parts[0]); // city name only
        coletaData.push(san ? san.coletaEsgoto : null);
        tratamentoData.push(san ? san.tratamentoEsgoto : null);
        incidenciaData.push(parseFloat(avgInc.toFixed(2)));
    }

    if (labels.length === 0) {
        if (panel) panel.classList.add('hidden');
        return;
    }

    if (panel) panel.classList.remove('hidden');

    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Coleta de Esgoto (%)',
                    data: coletaData,
                    backgroundColor: '#6baed655',
                    borderColor: '#6baed6',
                    borderWidth: 1.5,
                    borderRadius: 4,
                    yAxisID: 'y',
                    order: 2,
                },
                {
                    label: 'Tratamento de Esgoto (%)',
                    data: tratamentoData,
                    backgroundColor: '#74c49655',
                    borderColor: '#74c496',
                    borderWidth: 1.5,
                    borderRadius: 4,
                    yAxisID: 'y',
                    order: 2,
                },
                {
                    label: `Incidência ${info.name}/100k (média)`,
                    data: incidenciaData,
                    type: 'line',
                    borderColor: info.colorHex,
                    backgroundColor: info.colorHex + '33',
                    borderWidth: 2.5,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    tension: 0.3,
                    yAxisID: 'y1',
                    order: 1,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', align: 'start', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const label = ctx.dataset.label || '';
                            const val = ctx.parsed.y;
                            if (val === null || val === undefined) return `${label}: sem dados`;
                            if (label.includes('Esgoto')) return `${label}: ${val.toFixed(1)}%`;
                            return `${label}: ${val.toFixed(1)}/100k`;
                        },
                    },
                },
            },
            scales: {
                x: { grid: { display: false } },
                y: {
                    type: 'linear',
                    position: 'left',
                    min: 0,
                    max: 100,
                    title: { display: true, text: 'Cobertura de Esgoto (%)', font: { size: 11, weight: '500' } },
                    grid: { color: 'rgba(148,163,184,0.08)' },
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'Incidência/100k hab.', font: { size: 11, weight: '500' } },
                    min: 0,
                    ticks: { callback: v => v.toFixed(0) },
                },
            },
        },
    });
}

// ===== Epidemic Curve — Weekly Cases (tracker profile) =====
// datasetsMap: { 'City Name (2025)': data[], 'City Name (2024)': data[] }
export function renderEpidemicCurve(datasetsMap, disease = 'dengue') {
    epidemicChart = destroyChart(epidemicChart);

    const canvas = document.getElementById('epidemic-curve-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const datasets = [];
    let colorIdx = 0;

    for (const [label, data] of Object.entries(datasetsMap)) {
        if (!data || data.length === 0) continue;
        const color = CHART_COLORS[colorIdx % CHART_COLORS.length];
        const isPrevYear = label.includes('(') && !label.includes(String(new Date().getFullYear()));

        datasets.push({
            label,
            data: data.map(d => ({ x: formatSEShort(d.SE), y: d.casos || 0 })),
            backgroundColor: isPrevYear ? color + '44' : color + 'bb',
            borderColor: color,
            borderWidth: isPrevYear ? 1 : 1.5,
            borderDash: isPrevYear ? [4, 4] : [],
            borderRadius: 3,
            type: isPrevYear ? 'line' : 'bar',
            tension: 0.3,
            pointRadius: isPrevYear ? 0 : undefined,
            yAxisID: 'y',
            order: isPrevYear ? 2 : 1,
        });
        colorIdx++;
    }

    if (datasets.length === 0) return;

    // Build unified week labels from all datasets
    const allWeekLabels = [...new Set(
        Object.values(datasetsMap).flatMap(d => d.map(r => formatSEShort(r.SE)))
    )].sort((a, b) => parseInt(a.replace('SE ', '')) - parseInt(b.replace('SE ', '')));

    epidemicChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: allWeekLabels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', align: 'start', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${Math.round(ctx.parsed.y).toLocaleString('pt-BR')} casos`,
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 13, font: { size: 10 } },
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    min: 0,
                    grid: { color: 'rgba(148, 163, 184, 0.08)' },
                    title: { display: true, text: 'Casos por Semana Epidemiológica', font: { size: 11, weight: '500' } },
                    ticks: { callback: v => v.toLocaleString('pt-BR') },
                },
            },
        },
    });
}

// ===== Climate Chart — Weekly Temperature & Humidity (tracker profile) =====
export function renderClimateChart(data, cityName = '') {
    climateWeeklyChart = destroyChart(climateWeeklyChart);

    const canvas = document.getElementById('climate-chart');
    const panel = document.getElementById('climate-chart-panel');
    if (!canvas) return;

    // Filter weeks with valid climate data
    const weeks = data.filter(d => d.tempmed > 0 || d.umidmed > 0);
    if (weeks.length === 0) {
        if (panel) panel.classList.add('hidden');
        return;
    }
    if (panel) panel.classList.remove('hidden');

    const labels = weeks.map(d => formatSEShort(d.SE));
    const tempData = weeks.map(d => d.tempmed > 0 ? parseFloat(d.tempmed.toFixed(1)) : null);
    const umidData = weeks.map(d => d.umidmed > 0 ? parseFloat(d.umidmed.toFixed(1)) : null);

    const ctx = canvas.getContext('2d');
    climateWeeklyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Temperatura Média (°C)',
                    data: tempData,
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249,115,22,0.08)',
                    tension: 0.4,
                    pointRadius: 2,
                    borderWidth: 2,
                    yAxisID: 'yTemp',
                    spanGaps: true,
                    fill: true,
                },
                {
                    label: 'Umidade Média (%)',
                    data: umidData,
                    borderColor: '#6baed6',
                    backgroundColor: 'transparent',
                    tension: 0.4,
                    pointRadius: 2,
                    borderWidth: 2,
                    borderDash: [5, 4],
                    yAxisID: 'yUmid',
                    spanGaps: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', align: 'start', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const v = ctx.parsed.y;
                            if (v === null) return null;
                            return ctx.dataset.label.includes('Temp')
                                ? `${ctx.dataset.label}: ${v.toFixed(1)}°C`
                                : `${ctx.dataset.label}: ${v.toFixed(1)}%`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 13, font: { size: 10 } },
                },
                yTemp: {
                    type: 'linear',
                    position: 'left',
                    grid: { color: 'rgba(148, 163, 184, 0.08)' },
                    title: { display: true, text: 'Temperatura (°C)', font: { size: 11, weight: '500' } },
                    ticks: { callback: v => `${v}°C` },
                },
                yUmid: {
                    type: 'linear',
                    position: 'right',
                    min: 0,
                    max: 100,
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'Umidade (%)', font: { size: 11, weight: '500' } },
                    ticks: { callback: v => `${v}%` },
                },
            },
        },
    });
}
