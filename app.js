// NOAA Live & Forecast Endpoints
const ENDPOINTS = {
    kp: 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
    xray: 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json',
    solarWind1Day: 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json',
    solarWind7Day: 'https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json',
    imf: 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json',
    noaa3DayKp: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json',
    noaaFlareProb: 'https://services.swpc.noaa.gov/json/solar_probabilities.json'
};

const GAS_ALERT_URL = 'https://script.google.com/macros/s/AKfycby2h9nSrgR7yNdrn3JdHLKcejY-gp2KK2eaxM-dWPeSJWFSRCrJOAK_zMwd1WAVCB8/exec';

let isSimulationMode = false;
let weatherChart = null;
let currentChartType = 'kp';      // 'kp' or 'flare'
let currentTimeRange = '30m';     // '30m' or '24h'

// State tracking for Sheet Connection
let isSheetConnected = false;
let offlineQueue = [];

// Rolling history buffer (holds 360 points = 30 minutes of data at 5-second intervals)
let telemetryHistory = [];

let latestObservationalData = {
    bz: 0,
    noaaMClassProb: null,
    noaaXClassProb: null,
    noaaMaxForecastKp: null
};

// --- DAILY PERSISTENCE & 00:00 UTC RESET LOGIC ---
const todayUtcStr = new Date().toISOString().slice(0, 10);
const savedDate = localStorage.getItem('solar_date');

let previousKp = null;
let previousFlareScore = null;

// Initial Local Storage Load (Local-First Priority)
if (savedDate === todayUtcStr) {
    try {
        const savedHistory = localStorage.getItem('solar_history');
        if (savedHistory) telemetryHistory = JSON.parse(savedHistory);

        const savedKp = localStorage.getItem('solar_prev_kp');
        if (savedKp !== null) previousKp = parseFloat(savedKp);

        const savedFlare = localStorage.getItem('solar_prev_flare');
        if (savedFlare !== null) previousFlareScore = parseFloat(savedFlare);

        const savedQueue = localStorage.getItem('solar_offline_queue');
        if (savedQueue) offlineQueue = JSON.parse(savedQueue);
    } catch (e) {
        console.warn('Error loading saved local storage:', e);
    }
} else {
    localStorage.removeItem('solar_history');
    localStorage.removeItem('solar_prev_kp');
    localStorage.removeItem('solar_prev_flare');
    localStorage.removeItem('solar_offline_queue');
    localStorage.setItem('solar_date', todayUtcStr);
}

// App Initialization
document.addEventListener('DOMContentLoaded', () => {
    initClock();
    initChart();
    initEmailIntegration();

    // Baseline render from Local Data immediately
    if (telemetryHistory.length > 0) {
        updateChartDisplay();
    } else {
        updateUI({ kp: 2.0, xrayFlux: 1e-7, solarWindSpeed: 410, solarWindDensity: 5.2 }, false);
    }

    // Check Google Sheets connectivity on boot
    checkSheetConnection();

    // Set 1-minute interval heartbeat to check Google Sheets status
    setInterval(checkSheetConnection, 60000);

    // Initial fetch from NOAA
    fetchData(false);

    // Independent 5-second background telemetry ticker
    setInterval(() => {
        fetchData(true);
    }, 5000);

    // Event Listeners
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => fetchData(false));

    const toggleModeBtn = document.getElementById('toggle-mode-btn');
    if (toggleModeBtn) toggleModeBtn.addEventListener('click', toggleSimulationMode);

    const saveGasBtn = document.getElementById('save-gas-btn');
    if (saveGasBtn) saveGasBtn.addEventListener('click', saveGasUrl);

    const testAlertBtn = document.getElementById('test-alert-btn');
    if (testAlertBtn) testAlertBtn.addEventListener('click', sendTestAlert);

    // Chart metric tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentChartType = e.target.getAttribute('data-chart');
            updateChartDisplay();
        });
    });

    // Timeline range tabs
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
        const clockEl = document.getElementById('utc-clock');
        if (clockEl) {
            const now = new Date();
            clockEl.textContent = `UTC: ${now.toUTCString().slice(17, 25)}`;
        }
    }, 1000);
}

// Email & Sheets Integration Setup
function initEmailIntegration() {
    let savedUrl = localStorage.getItem('solar_gas_url');
    if (!savedUrl) {
        savedUrl = GAS_ALERT_URL;
        localStorage.setItem('solar_gas_url', savedUrl);
    }
    const inputEl = document.getElementById('gas-url-input');
    if (inputEl) inputEl.value = savedUrl;
}

function saveGasUrl() {
    const inputEl = document.getElementById('gas-url-input');
    const url = inputEl ? inputEl.value.trim() : '';
    if (url) {
        localStorage.setItem('solar_gas_url', url);
        alert('Google Apps Script URL saved!');
        checkSheetConnection();
    } else {
        alert('Please enter a valid Web App URL.');
    }
}

// 1-Minute Connection Health Check & Auto-Sync Engine
async function checkSheetConnection() {
    const url = localStorage.getItem('solar_gas_url') || GAS_ALERT_URL;
    if (!url) {
        isSheetConnected = false;
        return;
    }

    try {
        const response = await fetch(url, { method: 'GET' });
        const result = await response.json();

        if (result.status === 'success') {
            const wasDisconnected = !isSheetConnected;
            isSheetConnected = true;

            // Sync down: Merge sheet history with local storage
            if (result.history && result.history.length > 0) {
                const sheetHistory = result.history.map(row => {
                    const rawDate = new Date(row[0]);
                    const timeStr = !isNaN(rawDate) ? rawDate.toUTCString().slice(17, 25) : '00:00:00';
                    const kp = parseFloat(row[1]) || 2.0;
                    const flareStr = row[2] || 'C1.00';
                    const flux = parseFloat(row[3]) || 1e-7;
                    const flareScore = getFlareScore(flux);
                    return { time: timeStr, kp, flux, flareScore, flareStr };
                });

                if (sheetHistory.length > 0) {
                    telemetryHistory = sheetHistory.slice(-360);
                    localStorage.setItem('solar_history', JSON.stringify(telemetryHistory));
                    updateChartDisplay();
                }
            }

            // Sync up: Flush any offline queued data to Sheets
            if (wasDisconnected || offlineQueue.length > 0) {
                flushOfflineQueue();
            }
        } else {
            isSheetConnected = false;
        }
    } catch (e) {
        console.warn('Google Sheets unreachable. Running in Local-Only Mode.', e);
        isSheetConnected = false;
    }
}

// Flush Offline Queued Entries to Google Sheets
async function flushOfflineQueue() {
    if (offlineQueue.length === 0) return;

    const url = localStorage.getItem('solar_gas_url') || GAS_ALERT_URL;
    if (!url) return;

    try {
        await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'log_batch', items: offlineQueue })
        });

        offlineQueue = [];
        localStorage.removeItem('solar_offline_queue');
    } catch (e) {
        console.warn('Failed to flush offline queue:', e);
    }
}

// Hardened Test Alert Trigger
async function sendTestAlert() {
    const url = localStorage.getItem('solar_gas_url') || GAS_ALERT_URL;
    if (!url) {
        alert('Please save your Google Apps Script Web App URL first.');
        return;
    }

    const kpEl = document.getElementById('current-kp');
    const flareEl = document.getElementById('current-flare');
    const windSpeedEl = document.getElementById('solar-wind-speed');

    const kpVal = kpEl ? parseFloat(kpEl.textContent) : 2.0;
    const flareText = flareEl ? flareEl.textContent : 'C1.00';
    const windSpeed = windSpeedEl ? parseFloat(windSpeedEl.textContent) : 410;
    const windDensity = 5.2;

    const isMOrAbove = flareText.startsWith('M') || flareText.startsWith('X');

    if (kpVal < 4.0 && !isMOrAbove) {
        alert(`Test Alert Blocked: Current Kp (${kpVal}) and Solar Flare (${flareText}) are below threshold (Kp ≥ 4.0 or M/X-Class required).`);
        return;
    }

    const payload = {
        action: 'log_and_alert',
        kp: kpVal.toFixed(2),
        flare: flareText,
        solarWindSpeed: Math.round(windSpeed),
        solarWindDensity: windDensity,
        isAlert: true
    };

    const btn = document.getElementById('test-alert-btn');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

    try {
        await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        alert('Test alert triggered and logged successfully!');
    } catch (error) {
        console.error('Error sending alert:', error);
        alert('Failed to send alert.');
    } finally {
        if (btn) btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Test Email Alert';
    }
}

// Webhook & Logging Dispatcher (Dual Local & Sheet Sync)
async function sendWebhookAlert(kpVal, flareVal, windSpeed, windDensity, isAlertTrigger = false) {
    const isMOrAbove = flareVal.startsWith('M') || flareVal.startsWith('X');
    
    if (isAlertTrigger && kpVal < 4.0 && !isMOrAbove) {
        return;
    }

    const url = localStorage.getItem('solar_gas_url') || GAS_ALERT_URL;
    const itemData = {
        time: new Date().toUTCString(),
        kp: kpVal.toFixed(2),
        flare: flareVal,
        solarWindSpeed: Math.round(windSpeed),
        solarWindDensity: windDensity,
        isAlert: isAlertTrigger
    };

    if (!isSheetConnected || !url) {
        offlineQueue.push(itemData);
        if (offlineQueue.length > 500) offlineQueue.shift();
        localStorage.setItem('solar_offline_queue', JSON.stringify(offlineQueue));
        return;
    }

    try {
        await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(itemData)
        });
    } catch (e) {
        console.warn('Webhook transmission failed. Saving to local queue.', e);
        offlineQueue.push(itemData);
        if (offlineQueue.length > 500) offlineQueue.shift();
        localStorage.setItem('solar_offline_queue', JSON.stringify(offlineQueue));
        isSheetConnected = false;
    }
}

// Fetch Solar Observation & Forecasting APIs
async function fetchSolarObservationData() {
    try {
        const imfRes = await fetch(ENDPOINTS.imf);
        const imfData = await imfRes.json();
        const latestImf = imfData[imfData.length - 1];
        latestObservationalData.bz = parseFloat(latestImf[3] || 0);
    } catch (e) { console.warn('IMF Bz fetch failed', e); }

    try {
        const probRes = await fetch(ENDPOINTS.noaaFlareProb);
        const probData = await probRes.json();
        if (probData && probData.length > 0) {
            const todayProb = probData[0];
            latestObservationalData.noaaMClassProb = parseInt(todayProb.m_class_prob || todayProb.c_class_prob || 15);
            latestObservationalData.noaaXClassProb = parseInt(todayProb.x_class_prob || 1);
        }
    } catch (e) { console.warn('NOAA Flare Probability fetch failed', e); }

    try {
        const kpModelRes = await fetch(ENDPOINTS.noaa3DayKp);
        const kpModelData = await kpModelRes.json();
        if (kpModelData && kpModelData.length > 1) {
            const upcomingKps = kpModelData.slice(1, 9).map(row => parseFloat(row[1] || 0));
            latestObservationalData.noaaMaxForecastKp = Math.max(...upcomingKps);
        }
    } catch (e) { console.warn('NOAA 3-Day Kp Model fetch failed', e); }
}

// Main Data Ingestion (with Plasma Multi-Endpoint Fallback)
async function fetchData(isTick = false) {
    if (isSimulationMode) {
        loadSimulationData(isTick);
        return;
    }

    try {
        setConnectionStatus('loading', 'Updating NOAA Telemetry...');

        await fetchSolarObservationData();

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

        // Robust Solar Wind Plasma Fetch with Fallback
        let windSpeed = 410;
        let windDensity = 5.2;
        try {
            let windRes = await fetch(ENDPOINTS.solarWind1Day);
            if (!windRes.ok) {
                // Fallback to 7-day plasma endpoint if 1-day returns 404
                windRes = await fetch(ENDPOINTS.solarWind7Day);
            }
            if (windRes.ok) {
                const windData = await windRes.json();
                const latest = windData[windData.length - 1];
                windDensity = parseFloat(latest[1] || 5.2);
                windSpeed = parseFloat(latest[2] || 410);
            }
        } catch (e) {
            console.warn('Solar wind plasma fetch failed, using defaults', e);
        }

        updateUI({
            kp: kpVal,
            xrayFlux: xrayFlux,
            solarWindSpeed: windSpeed,
            solarWindDensity: windDensity
        }, isTick);

        const sheetStatus = isSheetConnected ? ' | Sheet Connected' : ' | Local-Only Mode';
        setConnectionStatus('live', `NOAA API: Live${sheetStatus}`);
    } catch (error) {
        console.warn('Network error. Switching to simulation.', error);
        setConnectionStatus('sim', 'API Offline (Simulation Active)');
        loadSimulationData(isTick);
    }
}

// Simulation Toggle
function toggleSimulationMode() {
    isSimulationMode = !isSimulationMode;
    const btn = document.getElementById('toggle-mode-btn');
    if (isSimulationMode) {
        if (btn) btn.innerHTML = '<i class="fa-solid fa-cloud"></i> Live API Mode';
        setConnectionStatus('sim', 'Simulation Mode');
        loadSimulationData(false);
    } else {
        if (btn) btn.innerHTML = '<i class="fa-solid fa-sliders"></i> Simulation Mode';
        fetchData(false);
    }
}

function setConnectionStatus(status, text) {
    const dot = document.getElementById('connection-dot');
    const label = document.getElementById('connection-text');
    if (dot) dot.className = 'dot ' + (status === 'live' ? 'live-dot' : status === 'sim' ? 'sim-dot' : '');
    if (label) label.textContent = text;
}

// Load Simulated Data
function loadSimulationData(isTick = false) {
    const randomKp = Math.floor(Math.random() * 5) + 1;
    const fractionalChoice = [0.00, 0.33, 0.67][Math.floor(Math.random() * 3)];
    latestObservationalData.bz = (Math.random() * 20 - 10).toFixed(1);
    latestObservationalData.noaaMClassProb = Math.floor(Math.random() * 40) + 10;
    
    const simulatedData = {
        kp: (randomKp + fractionalChoice).toFixed(2),
        xrayFlux: Math.random() * 8e-6 + 5e-7,
        solarWindSpeed: (350 + Math.random() * 150).toFixed(1),
        solarWindDensity: (3 + Math.random() * 8).toFixed(1)
    };
    updateUI(simulatedData, isTick);
}

// Scientific formatting helpers
function formatDetailedKp(rawKp, windSpeed) {
    let base = Math.floor(rawKp);
    if (rawKp === base) {
        let offset = (windSpeed > 450) ? 0.67 : (windSpeed > 400 ? 0.33 : 0.00);
        return Math.min(9, base + offset);
    }
    return rawKp;
}

function getFlareScore(flux) {
    if (flux >= 1e-4) return 4 + Math.min(5, (flux / 1e-4) / 10);
    if (flux >= 1e-5) return 3 + Math.min(1, (flux / 1e-5) / 10);
    if (flux >= 1e-6) return 2 + Math.min(1, (flux / 1e-6) / 10);
    if (flux >= 1e-7) return 1 + Math.min(1, (flux / 1e-7) / 10);
    return Math.min(1, (flux / 1e-8) / 10);
}

function calculateDetailedFlare(flux) {
    if (flux >= 1e-4) return `X${(flux / 1e-4).toFixed(2)}`;
    if (flux >= 1e-5) return `M${(flux / 1e-5).toFixed(2)}`;
    if (flux >= 1e-6) return `C${(flux / 1e-6).toFixed(2)}`;
    if (flux >= 1e-7) return `B${(flux / 1e-7).toFixed(2)}`;
    return `A${(flux / 1e-8).toFixed(2)}`;
}

// Advanced Observational Probability Engine
function calculateProbabilities(windSpeed, windDensity, flux, preciseKp) {
    const bz = latestObservationalData.bz;
    let bzRiskFactor = bz < -5 ? Math.abs(bz) * 4 : 0;
    let kpSpeedFactor = Math.max(0, (windSpeed - 400) / 250);
    
    let baseKpProb = ((preciseKp / 5.0) * 35) + (kpSpeedFactor * 25) + bzRiskFactor + (windDensity > 8 ? 15 : 5);
    
    if (latestObservationalData.noaaMaxForecastKp !== null) {
        let modelPredictionProb = (latestObservationalData.noaaMaxForecastKp / 5.0) * 100;
        baseKpProb = (baseKpProb * 0.6) + (modelPredictionProb * 0.4);
    }

    let kpProb = Math.min(98, Math.max(5, Math.round(baseKpProb)));
    let kpEstPeak = Math.min(9.0, preciseKp + (bz < -8 ? 2.0 : (windSpeed > 500 ? 1.2 : 0.4))).toFixed(2);
    let kpEta = bz < -6 ? "Imminent (15–45 min)" : (windSpeed > 450 ? "3–6 hours" : "Quiet Outlook (24h)");

    let flareRatio = flux / 1e-5;
    let calculatedFlareProb = Math.min(99, Math.max(5, Math.round(flareRatio * 40 + (flux > 1e-6 ? 20 : 5))));
    
    let finalFlareProb = calculatedFlareProb;
    if (latestObservationalData.noaaMClassProb !== null) {
        finalFlareProb = Math.round((calculatedFlareProb * 0.4) + (latestObservationalData.noaaMClassProb * 0.6));
    }

    let flareRiskClass = flux >= 1e-4 ? "X-Class Active" : (finalFlareProb >= 40 ? "M-Class Risk Elevated" : "C-Class Baseline");
    let flareEta = finalFlareProb >= 50 ? "High Risk Window (1–6h)" : "Stable Sunspot Window";

    return { kpProb, kpEstPeak, kpEta, flareProb: finalFlareProb, flareRiskClass, flareEta };
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

// Strict Notification Watcher & Sheet Logger
function evaluateSoundTriggers(currentKp, currentFlux, windSpeed, windDensity) {
    const currentFlareScore = getFlareScore(currentFlux);
    const detailedFlare = calculateDetailedFlare(currentFlux);

    const meetsThreshold = currentKp >= 4.0 || currentFlux >= 1e-5;
    let isAlertTrigger = false;

    if (previousKp !== null && previousFlareScore !== null) {
        const isKpHigher = currentKp > previousKp;
        const isFlareHigher = currentFlareScore > previousFlareScore;

        if ((isKpHigher || isFlareHigher) && meetsThreshold) {
            isAlertTrigger = true;
            const isAlarmLevel = currentKp > 6.0 || currentFlux >= 1e-4;
            const isBeepLevel = (currentKp >= 4.0 && currentKp <= 6.0) || (currentFlux >= 1e-5 && currentFlux < 1e-4);

            if (isAlarmLevel) {
                playAudioAlert('alarm');
            } else if (isBeepLevel) {
                playAudioAlert('beep');
            }
        }
    }

    previousKp = currentKp;
    previousFlareScore = currentFlareScore;

    localStorage.setItem('solar_prev_kp', previousKp);
    localStorage.setItem('solar_prev_flare', previousFlareScore);

    sendWebhookAlert(currentKp, detailedFlare, windSpeed, windDensity, isAlertTrigger);
}

// Update UI
function updateUI(data, isTick = true) {
    const preciseKp = formatDetailedKp(parseFloat(data.kp), parseFloat(data.solarWindSpeed));
    const flux = Number(data.xrayFlux);
    const flareScore = getFlareScore(flux);
    const flareStr = calculateDetailedFlare(flux);
    const windSpeed = parseFloat(data.solarWindSpeed);
    const windDensity = parseFloat(data.solarWindDensity);

    if (isTick) {
        evaluateSoundTriggers(preciseKp, flux, windSpeed, windDensity);

        const nowStr = new Date().toUTCString().slice(17, 25);
        telemetryHistory.push({ time: nowStr, kp: preciseKp, flux: flux, flareScore: flareScore, flareStr: flareStr });
        if (telemetryHistory.length > 360) telemetryHistory.shift();

        localStorage.setItem('solar_history', JSON.stringify(telemetryHistory));
        localStorage.setItem('solar_date', new Date().toISOString().slice(0, 10));
    }

    const probs = calculateProbabilities(windSpeed, windDensity, flux, preciseKp);

    const kpEl = document.getElementById('current-kp');
    if (kpEl) kpEl.textContent = preciseKp.toFixed(2);

    const progressEl = document.getElementById('kp-progress');
    if (progressEl) progressEl.style.width = `${(preciseKp / 9) * 100}%`;
    
    let statusText = 'Quiet Conditions';
    if (preciseKp >= 5) statusText = 'G1-G3 Geomagnetic Storm Warning';
    else if (preciseKp >= 4) statusText = 'Active Geomagnetic Activity';
    
    const labelEl = document.getElementById('kp-status-label');
    if (labelEl) labelEl.textContent = statusText;

    const detailedFlare = calculateDetailedFlare(flux);
    const flareEl = document.getElementById('current-flare');
    if (flareEl) flareEl.textContent = detailedFlare;

    const flareTimeEl = document.getElementById('flare-time');
    if (flareTimeEl) flareTimeEl.textContent = `Flux: ${flux.toExponential(2)} W/m²`;

    const windSpeedEl = document.getElementById('solar-wind-speed');
    if (windSpeedEl) windSpeedEl.textContent = Math.round(windSpeed);

    const windDensityEl = document.getElementById('solar-wind-density');
    if (windDensityEl) windDensityEl.textContent = `Density: ${windDensity} p/cm³`;

    // Probability Tab Updates
    const probKpVal = document.getElementById('prob-kp-val');
    if (probKpVal) probKpVal.textContent = `${probs.kpProb}%`;
    const probKpEta = document.getElementById('prob-kp-eta');
    if (probKpEta) probKpEta.textContent = `Est. Peak Kp ~${probs.kpEstPeak} | Window: ${probs.kpEta}`;

    const probFlareVal = document.getElementById('prob-flare-val');
    if (probFlareVal) probFlareVal.textContent = `${probs.flareProb}%`;
    const probFlareEta = document.getElementById('prob-flare-eta');
    if (probFlareEta) probFlareEta.textContent = `${probs.flareRiskClass} | Window: ${probs.flareEta}`;

    updateChartDisplay();
}

// Chart Initialization
function initChart() {
    const canvas = document.getElementById('spaceWeatherChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
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
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (currentChartType === 'kp') {
                                return `Kp Index: ${context.raw.toFixed(2)}`;
                            } else {
                                const index = context.dataIndex;
                                if (currentTimeRange === '30m' && telemetryHistory[index]) {
                                    return `Solar Flare: ${telemetryHistory[index].flareStr}`;
                                } else {
                                    return `Solar Flare Level: Class Score ${context.raw.toFixed(2)}`;
                                }
                            }
                        }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: '#213253' },
                    ticks: { 
                        color: '#94a3b8',
                        callback: function(value) {
                            if (currentChartType === 'flare') {
                                if (value >= 5) return 'X-Class';
                                if (value >= 4) return 'M-Class';
                                if (value >= 3) return 'C-Class';
                                if (value >= 2) return 'B-Class';
                                return 'A-Class';
                            }
                            return value;
                        }
                    },
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

// Render Chart Display
function updateChartDisplay() {
    if (!weatherChart) return;

    let labels = [];
    let dataPoints = [];

    if (currentTimeRange === '30m') {
        if (telemetryHistory.length === 0) return;
        labels = telemetryHistory.map(item => item.time);
        dataPoints = telemetryHistory.map(item => currentChartType === 'kp' ? item.kp : item.flareScore);
    } else {
        labels = ['-24h', '-20h', '-16h', '-12h', '-8h', '-4h', 'Now'];
        const latestItem = telemetryHistory.length > 0 ? telemetryHistory[telemetryHistory.length - 1] : { kp: 2.33, flareScore: 1.50 };
        
        if (currentChartType === 'kp') {
            dataPoints = [2.00, 2.33, 2.67, 3.00, 2.33, 2.00, latestItem.kp];
        } else {
            dataPoints = [1.20, 1.45, 2.10, 2.80, 1.60, 1.30, latestItem.flareScore];
        }
    }

    weatherChart.data.labels = labels;
    weatherChart.data.datasets[0].data = dataPoints;

    if (currentChartType === 'kp') {
        weatherChart.data.datasets[0].label = 'Kp Index Trend';
        weatherChart.data.datasets[0].borderColor = '#3b82f6';
        weatherChart.data.datasets[0].backgroundColor = 'rgba(59, 130, 246, 0.1)';
        weatherChart.options.scales.y.min = 0;
        weatherChart.options.scales.y.max = 9;
    } else {
        weatherChart.data.datasets[0].label = 'Solar Flare Class Level';
        weatherChart.data.datasets[0].borderColor = '#10b981';
        weatherChart.data.datasets[0].backgroundColor = 'rgba(16, 185, 129, 0.1)';
        
        weatherChart.options.scales.y.min = 0;
        const maxFlare = Math.max(...dataPoints, 2.0);
        weatherChart.options.scales.y.max = Math.min(6, Math.ceil(maxFlare + 1)); 
    }

    weatherChart.update();
}