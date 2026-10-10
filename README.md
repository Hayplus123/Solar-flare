# SolarWatch - Space Weather & Kp Index Dashboard

A real-time space weather monitoring dashboard built with HTML5, CSS3, JavaScript, and Chart.js. It pulls telemetry from NOAA Space Weather Prediction Center (SWPC) APIs to track Kp geomagnetic indices, solar flare X-ray flux, and solar wind conditions.

## Features
- **Real-Time NOAA Telemetry:** Live data feeds for planetary K-index, X-ray solar flares, and solar wind speed.
- **Simulation Mode Toggle:** Built-in simulation fallback mode to test UI responsiveness and aesthetics instantly.
- **Interactive Charts:** Toggleable Chart.js graphs tracking 24-hour Kp trends and solar flare radiation levels.
- **NOAA Scale Reference:** Quick-lookup geomagnetic storm scales (G0 through G5) and aurora visibility bands.

## How to Host on GitHub Pages (Free)
1. Create a new repository on GitHub (e.g., `solar-dashboard`).
2. Upload all four files (`index.html`, `style.css`, `app.js`, and `README.md`) to the repository main branch.
3. Go to your repository **Settings** -> **Pages**.
4. Under **Build and deployment**, set the source branch to `main` (or `master`) and `/ (root)`.
5. Click **Save**, and your live website URL will appear within a minute!