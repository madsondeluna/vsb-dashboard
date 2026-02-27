/**
 * VigiSaúde Brasil — Charts Component
 * Chart.js visualizations: Cases, Rt, Incidence, Climate, Sanitation correlation
 */
import { Chart, registerables } from 'chart.js';
import { CHART_COLORS, getSanitationData, getDiseaseInfo } from '../services/api.js';

Chart.register(...registerables);

// Global Chart.js defaults for dark mode
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.1)';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.padding = 16;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(17, 24, 39, 0.95)';
Chart.defaults.plugins.tooltip.titleFont = { weight: '600', size: 13, family: "'Inter', sans-serif" };
Chart.defaults.plugins.tooltip.bodyFont = { size: 12, family: "'Inter', sans-serif" };
Chart.defaults.plugins.tooltip.padding = 12;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.borderColor = 'rgba(148, 163, 184, 0.15)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.animation = { duration: 600, easing: 'easeOutQuart' };

let mainChart = null;
let rtChart = null;
let incidenceChart = null;
let climateChart = null;

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

    const sanitationData = getSanitationData();
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
            if (d.tempmed !== null && d.tempmed !== undefined) { monthlyData[m].tempSum += d.tempmed; monthlyData[m].tempCount++; }
            if (d.umidmed !== null && d.umidmed !== undefined) { monthlyData[m].umidSum += d.umidmed; monthlyData[m].umidCount++; }
        });

        const casosArray = monthlyData.map(m => m.casos);
        const tempArray = monthlyData.map(m => m.tempCount > 0 ? (m.tempSum / m.tempCount) : null);
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

        // 3. Add Climate (Lines) - secondary Y axis
        datasets.push({
            label: `${locationName} - Umidade Média (%)`,
            data: umidArray,
            borderColor: '#38bdf8', // Blue for humidity
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
            borderColor: '#f59e0b', // Amber for temp
            backgroundColor: 'transparent',
            tension: 0.4,
            pointRadius: 2,
            borderWidth: 2,
            type: 'line',
            yAxisID: 'y1',
            spanGaps: true,
            order: 2
        });

        // 4. Add Sanitation Reference Lines (Constant) - secondary Y axis
        const parts = locationName.split(' - ');
        if (parts.length > 1) {
            const uf = parts[1].trim();
            const san = sanitationData[uf];
            if (san) {
                datasets.push({
                    label: `${locationName} - Coleta de Esgoto (%)`,
                    data: new Array(12).fill(san.coletaEsgoto),
                    borderColor: '#22c55e', // Green for collection
                    borderWidth: 1.5,
                    borderDash: [2, 2],
                    pointRadius: 0,
                    type: 'line',
                    yAxisID: 'y1',
                    order: 1
                });
                datasets.push({
                    label: `${locationName} - Trat. Esgoto (%)`,
                    data: new Array(12).fill(san.tratamentoEsgoto),
                    borderColor: '#06b6d4', // Cyan for treatment
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    type: 'line',
                    yAxisID: 'y1',
                    order: 1
                });
            }
        }

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
                            if (label.includes('Casos')) return `${label}: ${Math.round(value).toLocaleString('pt-BR')}`;
                            if (label.includes('Umidade') || label.includes('Esgoto')) return `${label}: ${value.toFixed(1)}%`;
                            if (label.includes('Temp')) return `${label}: ${value.toFixed(1)}°C`;
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
                    title: { display: true, text: 'Valores Secundários (%, °C)', font: { size: 11, weight: '500' } },
                    min: 0,
                    max: 100,
                },
            },
        },
    });
}

// ===== Sanitation Correlation Chart (for info/special view) =====
export function renderSanitationCorrelation(containerId, capitalData) {
    const existing = Chart.getChart(containerId);
    if (existing) existing.destroy();

    const canvas = document.getElementById(containerId);
    if (!canvas || !capitalData || capitalData.length === 0) return;

    const sanitationData = getSanitationData();

    // Build scatter data: X = sewage coverage %, Y = incidence
    const scatterData = capitalData
        .filter(c => c.latest && sanitationData[c.uf])
        .map(c => ({
            x: sanitationData[c.uf].coletaEsgoto,
            y: c.latest.p_inc100k || 0,
            label: c.name,
            uf: c.uf,
        }));

    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Capital (Coleta Esgoto % vs Incidência)',
                data: scatterData,
                backgroundColor: '#38bdf880',
                borderColor: '#38bdf8',
                borderWidth: 1.5,
                pointRadius: 6,
                pointHoverRadius: 9,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const d = ctx.raw;
                            return `${d.label} (${d.uf}): Esgoto ${d.x}%, Inc ${d.y.toFixed(1)}/100k`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    title: { display: true, text: 'Coleta de Esgoto (%)', font: { size: 12 } },
                    grid: { color: 'rgba(148, 163, 184, 0.08)' },
                },
                y: {
                    title: { display: true, text: 'Incidência por 100k hab.', font: { size: 12 } },
                    grid: { color: 'rgba(148, 163, 184, 0.08)' },
                },
            },
        },
    });
}
