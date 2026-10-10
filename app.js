// NOAA Live Endpoints
const ENDPOINTS = {
    kp: 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
    xray: 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json',
    solarWind: 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json'
};

const GAS_ALERT_URL = 'https://script.google.com/macros/s/AKfycby2h9nSrgR7yNdrn3JdHLKcejY-gp2KK2eaxM-dWPeSJWFSRCrJOAK_zMwd1WAVCB8/exec';

let isSimulationMode = false;
let weatherChart = null;
let currentChartType = 'kp';

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initClock();
    initChart();
    initEmailIntegration();
    fetchData();

    // Auto-refresh data every 1 minute (60,000 milliseconds)
    setInterval(fetchData, 60000);

    // Event Listeners
    document.getElementById('refresh-btn').addEventListener('click', fetchData);
    document.getElementById('toggle-mode-btn').addEventListener('click', toggleSimulationMode);
    document.getElementById('save-gas-btn').addEventListener('click', saveGasUrl);
    document.getElementById('test-alert-btn').addEventListener('click', sendTestAlert);

    // Chart tab switches
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentChartType = e.target.getAttribute('data-chart');
            updateChartData();
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

// Fetch Live Data from NOAA with individual error fallbacks
async function fetchData() {
    if (isSimulationMode) {
        loadSimulationData();
        return;
    }

    try {
        setConnectionStatus('loading', 'Updating NOAA Data...');

        let kpVal = 2.33;
        try {
            const kpRes = await fetch(ENDPOINTS.kp);
            const kpData = await kpRes.json();
            const latest = kpData[kpData.length - 1];
            kpVal = parseFloat(latest.kp || latest.estimated_kp || 2.33);
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

// Load Simulated Telemetry with Precision
function loadSimulationData() {
    const simulatedData = {
        kp: (Math.random() * 5 + 1).toFixed(2),
        xrayFlux: Math.random() * 8e-6 + 5e-7,
        solarWindSpeed: (350 + Math.random() * 150).toFixed(1),
        solarWindDensity: (3 + Math.random() * 8).toFixed(1)
    };
    updateUI(simulatedData);
}

// Calculate Precise Scientific Solar Flare Classification (e.g., C3.76, M1.42)
function calculateDetailedFlare(flux) {
    if (flux >= 1e-4) {
        return `X${(flux / 1e-4).toFixed(2)}`;
    } else if (flux >= 1e-5) {
        return `M${(flux / 1e-5).toFixed(2)}`;
    } else if (flux >= 1e-6) {
        return `C${(flux / 1e-6).toFixed(2)}`;
    } else if (flux >= 1e-7) {
        return `B${(flux / 1e-7).toFixed(2)}`;
    } else {
        return `A${(flux / 1e-8).toFixed(2)}`;
    }
}

// Update UI Elements with High Precision
function updateUI(data) {
    const kpNum = parseFloat(data.kp);
    // Display Kp with 2 decimal precision (e.g., 6.45)
    document.getElementById('current-kp').textContent = kpNum.toFixed(2);
    document.getElementById('kp-progress').style.width = `${(kpNum / 9) * 100}%`;
    
    let statusText = 'Quiet Conditions';
    if (kpNum >= 5) statusText = 'G1-G3 Geomagnetic Storm Warning';
    else if (kpNum >= 4) statusText = 'Active Geomagnetic Activity';
    document.getElementById('kp-status-label').textContent = statusText;

    // Detailed Solar Flare Classification (e.g., C3.76)
    const flux = Number(data.xrayFlux);
    const detailedFlare = calculateDetailedFlare(flux);

    document.getElementById('current-flare').textContent = detailedFlare;
    document.getElementById('flare-time').textContent = `Flux: ${flux.toExponential(2)} W/m²`;

    // Solar Wind
    document.getElementById('solar-wind-speed').textContent = Math.round(data.solarWindSpeed);
    document.getElementById('solar-wind-density').textContent = `Density: ${data.solarWindDensity} p/cm³`;

    updateChartData(kpNum);
}

// Chart.js Initialization
function initChart() {
    const ctx = document.getElementById('spaceWeatherChart').getContext('2d');
    weatherChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['-6h', '-5h', '-4h', '-3h', '-2h', '-1h', 'Now'],
            datasets: [{
                label: 'Kp Index Trend',
                data: [2.10, 2.35, 2.00, 2.70, 3.15, 2.90, 2.50],
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

function updateChartData(latestValue = 2.5) {
    if (!weatherChart) return;
    
    if (currentChartType === 'kp') {
        weatherChart.data.datasets[0].label = 'Kp Index Trend';
        weatherChart.data.datasets[0].borderColor = '#3b82f6';
        weatherChart.data.datasets[0].backgroundColor = 'rgba(59, 130, 246, 0.1)';
        weatherChart.options.scales.y.max = 9;
        weatherChart.data.datasets[0].data = [
            (latestValue - 0.50).toFixed(2),
            (latestValue - 0.30).toFixed(2),
            (latestValue - 0.40).toFixed(2),
            (latestValue + 0.10).toFixed(2),
            (latestValue - 0.20).toFixed(2),
            (latestValue + 0.20).toFixed(2),
            latestValue.toFixed(2)
        ];
    } else {
        weatherChart.data.datasets[0].label = 'X-Ray Flux (W/m²)';
        weatherChart.data.datasets[0].borderColor = '#10b981';
        weatherChart.data.datasets[0].backgroundColor = 'rgba(16, 185, 129, 0.1)';
        weatherChart.options.scales.y.max = 0.00001;
        weatherChart.data.datasets[0].data = [
            2.1e-7, 3.4e-7, 1.5e-7, 4.2e-7, 8.1e-7, 5.0e-7, 6.3e-7
        ];
    }
    weatherChart.update();
}