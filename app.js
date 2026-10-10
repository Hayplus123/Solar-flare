// Your pre-configured Google Apps Script Web App URL
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycby2h9nSrgR7yNdrn3JdHLKcejY-gp2KK2eaxM-dWPeSJWFSRCrJOAK_zMwd1WAVCB8/exec';

let isSimulationMode = false;
let weatherChart = null;
let currentChartType = 'kp';

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initClock();
    initChart();
    initEmailIntegration();
    fetchData();

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
        savedUrl = DEFAULT_GAS_URL;
        localStorage.setItem('solar_gas_url', savedUrl);
    }
    document.getElementById('gas-url-input').value = savedUrl;
}

function saveGasUrl() {
    const url = document.getElementById('gas-url-input').value.trim();
    if (url) {
        localStorage.setItem('solar_gas_url', url);
        alert('Google Apps Script URL saved successfully!');
        fetchData();
    } else {
        alert('Please enter a valid Web App URL.');
    }
}

async function sendTestAlert() {
    const url = localStorage.getItem('solar_gas_url') || document.getElementById('gas-url-input').value.trim();
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
        alert('Failed to send alert. Check your Web App URL.');
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Test Email Alert';
    }
}

// Fetch Live Telemetry via Google Apps Script Proxy (NOAA + NASA DONKI)
async function fetchData() {
    if (isSimulationMode) {
        loadSimulationData();
        return;
    }

    const gasUrl = localStorage.getItem('solar_gas_url') || DEFAULT_GAS_URL;
    if (!gasUrl) {
        loadSimulationData();
        return;
    }

    try {
        setConnectionStatus('loading', 'Fetching NASA & NOAA Data...');
        
        const response = await fetch(gasUrl);
        const result = await response.json();

        if (result.status === 'success') {
            const latestKp = result.kp;
            const latestFlare = result.flare;
            const latestWind = result.wind;

            updateUI({
                kp: latestKp.kp || latestKp.estimated_kp || 2.33,
                flareClass: latestFlare.classType || 'C1.0',
                flareTime: latestFlare.peakTime ? `Peak: ${latestFlare.peakTime.slice(11, 16)} UTC` : 'Recent Event',
                solarWindSpeed: latestWind[1] || 410,
                solarWindDensity: latestWind[2] || 5.2
            });

            setConnectionStatus('live', 'NASA/NOAA API: Live');
        } else {
            throw new Error('Proxy returned error');
        }
    } catch (error) {
        console.warn('Network error fetching via proxy. Switching to simulation mode.', error);
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
    const simulatedData = {
        kp: (Math.random() * 4 + 1).toFixed(2),
        flareClass: ['C2.1', 'M1.4', 'B4.5', 'X1.2'][Math.floor(Math.random() * 4)],
        flareTime: 'Peak: 14:25 UTC',
        solarWindSpeed: (350 + Math.random() * 150).toFixed(1),
        solarWindDensity: (3 + Math.random() * 8).toFixed(1)
    };
    updateUI(simulatedData);
}

// Update UI Elements
function updateUI(data) {
    const kpNum = parseFloat(data.kp);
    document.getElementById('current-kp').textContent = kpNum.toFixed(1);
    document.getElementById('kp-progress').style.width = `${(kpNum / 9) * 100}%`;
    
    let statusText = 'Quiet Conditions';
    if (kpNum >= 5) statusText = 'G1-G3 Geomagnetic Storm Warning';
    else if (kpNum >= 4) statusText = 'Active Geomagnetic Activity';
    document.getElementById('kp-status-label').textContent = statusText;

    // Solar Flare (NASA DONKI data)
    document.getElementById('current-flare').textContent = data.flareClass;
    document.getElementById('flare-time').textContent = data.flareTime;

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
                data: [2.1, 2.3, 2.0, 2.7, 3.1, 2.9, 2.5],
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
            (latestValue - 0.5).toFixed(1),
            (latestValue - 0.3).toFixed(1),
            (latestValue - 0.4).toFixed(1),
            (latestValue + 0.1).toFixed(1),
            (latestValue - 0.2).toFixed(1),
            (latestValue + 0.2).toFixed(1),
            latestValue
        ];
    } else {
        weatherChart.data.datasets[0].label = 'Solar Flare Activity Index';
        weatherChart.data.datasets[0].borderColor = '#10b981';
        weatherChart.data.datasets[0].backgroundColor = 'rgba(16, 185, 129, 0.1)';
        weatherChart.options.scales.y.max = 5;
        weatherChart.data.datasets[0].data = [1, 2, 1, 3, 4, 2, 3];
    }
    weatherChart.update();
}