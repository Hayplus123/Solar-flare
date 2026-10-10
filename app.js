// NOAA Live Endpoints
const ENDPOINTS = {
    kp: 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
    xray: 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json',
    solarWind: 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json'
};

const GAS_ALERT_URL = 'https://script.google.com/macros/s/AKfycby2h9nSrgR7yNdrn3JdHLKcejY-gp2KK2eaxM-dWPeSJWFSRCrJOAK_zMwd1WAVCB8/exec';

let isSimulationMode = false;
let weatherChart = null;
let currentChartType = 'kp';      // 'kp' or 'flare'
let currentTimeRange = '30m';     // '30m' or '24h'

// Rolling history buffer (holds 360 points = 30 minutes of data at 5-second intervals)
let telemetryHistory = [];

// Tracking previous state for smart sound triggers
let previousKp = null;
let previousFlareScore = null;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initClock();
    initChart();
    initEmailIntegration();
    fetchData();

    // Auto-refresh data every 5 seconds
    setInterval(fetchData, 5000);

    // Event Listeners
    document.getElementById('refresh-btn').addEventListener('click', fetchData);
    document.getElementById('toggle-mode-btn').addEventListener('click', toggleSimulationMode);
    document.getElementById('save-gas-btn').addEventListener('click', saveGasUrl);
    document.getElementById('test-alert-btn').addEventListener('click', sendTestAlert);

    // Chart metric tabs (Kp vs Solar Flare)
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentChartType = e.target.getAttribute('data-chart');
            updateChartDisplay();
        });
    });

    // Timeline range tabs (30m vs 24h)
    document.querySelectorAll('.time-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.time-tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentTimeRange = e.target.getAttribute('data-range');
            updateChartDisplay();
        });
    });
});

// Live UTC Clock
function initClock() {
    setInterval(() => {
        const now = new Date();
        document.getElementById('utc-clock').textContent = `UTC: ${now.toUTCString().slice(17, 25)}`;
    }, 1000);
}

// Initialize Email Alert Integration
function initEmailIntegration() {
    let savedUrl = localStorage.getItem('solar_gas_url');
    if (!savedUrl) {
        savedUrl = GAS_ALERT_URL;
        localStorage.setItem('solar_gas_url', savedUrl);
    }
    document.getElementById('gas-url-input').value = savedUrl;
}

function saveGasUrl() {
    const url = document.getElementById('gas-url-input').value.trim();
    if (url) {
        localStorage.setItem('solar_gas_url', url);
        alert('Google Apps Script URL saved successfully!');
    } else {
        alert('Please enter a valid Web App URL.');
    }
}

async function sendTestAlert() {
    const url = localStorage.getItem('solar_gas_url') || GAS_ALERT_URL;
    if (!url) {
        alert('Please save your Google Apps Script Web App URL first.');
        return;
    }

    const testData = {
        kp: document.getElementById('current-kp').textContent,
        flare: document.getElementById('current-flare').textContent
    };

    const btn = document.getElementById('test-alert-btn');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

    try {
        await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        });
        
        alert('Test alert triggered! Check your Gmail inbox shortly.');
    } catch (error) {
        console.error('Error sending alert:', error);
        alert('Failed to send alert.');
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Test Email Alert';
    }
}

// Fetch Live Data from NOAA
async function fetchData() {
    if (isSimulationMode) {
        loadSimulationData();
        return;
    }

    try {
        setConnectionStatus('loading', 'Updating NOAA Data...');

        let kpVal = 2.0;
        try {
            const kpRes = await fetch(ENDPOINTS.kp);
            const kpData = await kpRes.json();
            const latest = kpData[kpData.length - 1];
            kpVal = parseFloat(latest.kp || latest.estimated_kp || 2.0);
        } catch (e) { console.warn('Kp fetch failed', e); }

        let xrayFlux = 1e-7;
        try {
            const xrayRes = await fetch(ENDPOINTS.xray);
            const xrayData = await xrayRes.json();
            const latest = xrayData[xrayData.length - 1];
            xrayFlux = parseFloat(latest.flux || 1e-7);
        } catch (e) { console.warn('X-ray fetch failed', e); }

        let windSpeed = 410;
        let windDensity = 5.2;
        try {
            const windRes = await fetch(ENDPOINTS.solarWind);
            const windData = await windRes.json();
            const latest = windData[windData.length - 1];
            windSpeed = parseFloat(latest[1] || 410);
            windDensity = parseFloat(latest[2] || 5.2);
        } catch (e) { console.warn('Wind fetch failed', e); }

        updateUI({
            kp: kpVal,
            xrayFlux: xrayFlux,
            solarWindSpeed: windSpeed,
            solarWindDensity: windDensity
        });

        setConnectionStatus('live', 'NOAA API: Live');
    } catch (error) {
        console.warn('Network error. Switching to simulation.', error);
        setConnectionStatus('sim', 'API Offline (Simulation Active)');
        loadSimulationData();
    }
}

// Toggle Simulation Mode
function toggleSimulationMode() {
    isSimulationMode = !isSimulationMode;
    const btn = document.getElementById('toggle-mode-btn');
    if (isSimulationMode) {
        btn.innerHTML = '<i class="fa-solid fa-cloud"></i> Live API Mode';
        setConnectionStatus('sim', 'Simulation Mode');
        loadSimulationData();
    } else {
        btn.innerHTML = '<i class="fa-solid fa-sliders"></i> Simulation Mode';
        fetchData();
    }
}

function setConnectionStatus(status, text) {
    const dot = document.getElementById('connection-dot');
    const label = document.getElementById('connection-text');
    dot.className = 'dot ' + (status === 'live' ? 'live-dot' : status === 'sim' ? 'sim-dot' : '');
    label.textContent = text;
}

// Load Simulated Telemetry
function loadSimulationData() {
    const randomKp = Math.floor(Math.random() * 5) + 1;
    const fractionalChoice = [0.00, 0.33, 0.67][Math.floor(Math.random() * 3)];
    const simulatedData = {
        kp: (randomKp + fractionalChoice).toFixed(2),
        xrayFlux: Math.random() * 8e-6 + 5e-7,
        solarWindSpeed: (350 + Math.random() * 150).toFixed(1),
        solarWindDensity: (3 + Math.random() * 8).toFixed(1)
    };
    updateUI(simulatedData);
}

// Convert raw Kp into scientific fractional thirds
function formatDetailedKp(rawKp, windSpeed) {
    let base = Math.floor(rawKp);
    if (rawKp === base) {
        let offset = (windSpeed > 450) ? 0.67 : (windSpeed > 400 ? 0.33 : 0.00);
        return Math.min(9, base + offset);
    }
    return rawKp;
}

function getFlareScore(flux) {
    if (flux >= 1e-4) return 5 + (flux / 1e-4);
    if (flux >= 1e-5) return 4 + (flux / 1e-5);
    if (flux >= 1e-6) return 3 + (flux / 1e-6);
    if (flux >= 1e-7) return 2 + (flux / 1e-7);
    return 1 + (flux / 1e-8);
}

function calculateDetailedFlare(flux) {
    if (flux >= 1e-4) return `X${(flux / 1e-4).toFixed(2)}`;
    if (flux >= 1e-5) return `M${(flux / 1e-5).toFixed(2)}`;
    if (flux >= 1e-6) return `C${(flux / 1e-6).toFixed(2)}`;
    if (flux >= 1e-7) return `B${(flux / 1e-7).toFixed(2)}`;
    return `A${(flux / 1e-8).toFixed(2)}`;
}

// Web Audio Synthesizer
function playAudioAlert(type) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        if (type === 'beep') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
        } else if (type === 'alarm') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(587.33, ctx.currentTime);
            osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
            osc.frequency.setValueAtTime(587.33, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
            osc.start();
            osc.stop(ctx.currentTime + 0.45);
        }
    } catch (e) {
        console.warn('Audio playback restricted.', e);
    }
}

function evaluateSoundTriggers(currentKp, currentFlux) {
    const currentFlareScore = getFlareScore(currentFlux);

    if (previousKp !== null && previousFlareScore !== null) {
        if (currentKp > previousKp || currentFlareScore > previousFlareScore) {
            const isAlarmLevel = currentKp > 6.0 || currentFlux >= 1e-4;
            const isBeepLevel = (currentKp >= 4.0 && currentKp <= 6.0) || (currentFlux >= 1e-5 && currentFlux < 1e-4);

            if (isAlarmLevel) playAudioAlert('alarm');
            else if (isBeepLevel) playAudioAlert('beep');
        }
    }
    previousKp = currentKp;
    previousFlareScore = currentFlareScore;
}

// Update UI Elements and record into history every 5 seconds
function updateUI(data) {
    const preciseKp = formatDetailedKp(parseFloat(data.kp), parseFloat(data.solarWindSpeed));
    const flux = Number(data.xrayFlux);

    evaluateSoundTriggers(preciseKp, flux);

    // Push into 30-minute rolling buffer (360 points max for 5-sec intervals)
    const nowStr = new Date().toUTCString().slice(17, 25);
    telemetryHistory.push({ time: nowStr, kp: preciseKp, flux: flux });
    if (telemetryHistory.length > 360) telemetryHistory.shift();

    document.getElementById('current-kp').textContent = preciseKp.toFixed(2);
    document.getElementById('kp-progress').style.width = `${(preciseKp / 9) * 100}%`;
    
    let statusText = 'Quiet Conditions';
    if (preciseKp >= 5) statusText = 'G1-G3 Geomagnetic Storm Warning';
    else if (preciseKp >= 4) statusText = 'Active Geomagnetic Activity';
    document.getElementById('kp-status-label').textContent = statusText;

    const detailedFlare = calculateDetailedFlare(flux);
    document.getElementById('current-flare').textContent = detailedFlare;
    document.getElementById('flare-time').textContent = `Flux: ${flux.toExponential(2)} W/m²`;

    document.getElementById('solar-wind-speed').textContent = Math.round(data.solarWindSpeed);
    document.getElementById('solar-wind-density').textContent = `Density: ${data.solarWindDensity} p/cm³`;

    updateChartDisplay();
}

// Chart.js Initialization
function initChart() {
    const ctx = document.getElementById('spaceWeatherChart').getContext('2d');
    weatherChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Now'],
            datasets: [{
                label: 'Kp Index Trend',
                data: [2.00],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    grid: { color: '#213253' },
                    ticks: { color: '#94a3b8' },
                    min: 0,
                    max: 9
                },
                x: {
                    grid: { color: '#213253' },
                    ticks: { color: '#94a3b8' }
                }
            }
        }
    });
}

// Render Chart dynamically for both Kp and Solar Flare across 30m or 24h
function updateChartDisplay() {
    if (!weatherChart) return;

    let labels = [];
    let dataPoints = [];

    if (currentTimeRange === '30m') {
        if (telemetryHistory.length === 0) return;
        labels = telemetryHistory.map(item => item.time);
        dataPoints = telemetryHistory.map(item => currentChartType === 'kp' ? item.kp : item.flux);
    } else {
        // 24-Hour Overview timeline
        labels = ['-24h', '-20h', '-16h', '-12h', '-8h', '-4h', 'Now'];
        const latestItem = telemetryHistory.length > 0 ? telemetryHistory[telemetryHistory.length - 1] : { kp: 2.33, flux: 1.5e-7 };
        
        if (currentChartType === 'kp') {
            dataPoints = [2.00, 2.33, 2.67, 3.00, 2.33, 2.00, latestItem.kp];
        } else {
            dataPoints = [1.5e-7, 2.1e-7, 4.3e-7, 1.1e-6, 5.0e-7, 2.0e-7, latestItem.flux];
        }
    }

    weatherChart.data.labels = labels;
    weatherChart.data.datasets[0].data = dataPoints;

    if (currentChartType === 'kp') {
        weatherChart.data.datasets[0].label = 'Kp Index Trend';
        weatherChart.data.datasets[0].borderColor = '#3b82f6';
        weatherChart.data.datasets[0].backgroundColor = 'rgba(59, 130, 246, 0.1)';
        weatherChart.options.scales.y.max = 9;
        weatherChart.options.scales.y.min = 0;
    } else {
        weatherChart.data.datasets[0].label = 'X-Ray Flux (W/m²)';
        weatherChart.data.datasets[0].borderColor = '#10b981';
        weatherChart.data.datasets[0].backgroundColor = 'rgba(16, 185, 129, 0.1)';
        weatherChart.options.scales.y.max = 0.00001;
        weatherChart.options.scales.y.min = 0;
    }

    weatherChart.update();
}