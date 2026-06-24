let map = L.map("map").setView([25.08, 121.93], 11);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

let staMarker = null;
let apMarker = null;
let pathLine = null;
let clickStep = 0;
let chart = null;

const staCoord = document.getElementById("staCoord");
const apCoord = document.getElementById("apCoord");

function parseCoord(text) {
  const p = text.trim().split(/[,\s]+/).filter(Boolean);
  if (p.length !== 2) return null;

  const lat = parseFloat(p[0]);
  const lon = parseFloat(p[1]);

  if (isNaN(lat) || isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return { lat, lon };
}

function formatCoord(ll) {
  return ll.lat.toFixed(8) + ", " + ll.lng.toFixed(8);
}

function clearObjects() {
  if (staMarker) map.removeLayer(staMarker);
  if (apMarker) map.removeLayer(apMarker);
  if (pathLine) map.removeLayer(pathLine);
  staMarker = null;
  apMarker = null;
  pathLine = null;
}

function clearMapPoints() {
  clearObjects();
  staCoord.value = "";
  apCoord.value = "";
  clickStep = 0;
}

function redrawMap() {
  clearObjects();

  const sta = parseCoord(staCoord.value);
  const ap = parseCoord(apCoord.value);

  if (sta) {
    staMarker = L.marker([sta.lat, sta.lon]).addTo(map).bindPopup("STA");
  }

  if (ap) {
    apMarker = L.marker([ap.lat, ap.lon]).addTo(map).bindPopup("AP");
  }

  if (sta && ap) {
    pathLine = L.polyline([[sta.lat, sta.lon], [ap.lat, ap.lon]], { weight: 4 }).addTo(map);
    map.fitBounds(pathLine.getBounds(), { padding: [40, 40] });
    clickStep = 2;
  }
}

function setSta(ll) {
  staCoord.value = formatCoord(ll);
  if (staMarker) map.removeLayer(staMarker);
  staMarker = L.marker(ll).addTo(map).bindPopup("STA").openPopup();
}

function setAp(ll) {
  apCoord.value = formatCoord(ll);
  if (apMarker) map.removeLayer(apMarker);
  apMarker = L.marker(ll).addTo(map).bindPopup("AP").openPopup();
}

function updateLine() {
  if (pathLine) map.removeLayer(pathLine);

  const sta = parseCoord(staCoord.value);
  const ap = parseCoord(apCoord.value);

  if (sta && ap) {
    pathLine = L.polyline([[sta.lat, sta.lon], [ap.lat, ap.lon]], { weight: 4 }).addTo(map);
  }
}

map.on("click", e => {
  if (clickStep === 0 || clickStep >= 2) {
    clearMapPoints();
    setSta(e.latlng);
    clickStep = 1;
  } else {
    setAp(e.latlng);
    updateLine();
    clickStep = 2;
  }
});

staCoord.addEventListener("change", redrawMap);
apCoord.addEventListener("change", redrawMap);

function updateKFactor() {
  const v = document.getElementById("kPreset").value;
  if (v !== "custom") {
    document.getElementById("kFactor").value = v;
  }
}

function haversineKm(a, b) {
  const R = 6371;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function interpolatePoint(a, b, t) {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t
  };
}

function earthBulgeM(d1m, d2m, k) {
  return d1m * d2m / (2 * 6371000 * k);
}

function fresnelM(d1km, d2km, fGHz, totalKm) {
  if (d1km <= 0 || d2km <= 0) return 0;
  return 17.32 * Math.sqrt((d1km * d2km) / (fGHz * totalKm));
}

function getFreqs() {
  let f = [];

  document.querySelectorAll(".freqCheck:checked").forEach(e => {
    f.push(parseFloat(e.value));
  });

  const custom = document.getElementById("customFreqs").value.trim();

  if (custom) {
    custom.split(/[,\s]+/).forEach(v => {
      const x = parseFloat(v);
      if (!isNaN(x) && x > 0) f.push(x);
    });
  }

  return [...new Set(f)];
}

async function fetchElevations(points) {
  const batchSize = 80;
  let elevations = [];

  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    const lats = batch.map(p => p.lat.toFixed(6)).join(",");
    const lons = batch.map(p => p.lon.toFixed(6)).join(",");
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;

    const resp = await fetch(url);

    if (!resp.ok) {
      throw new Error("Elevation API request failed");
    }

    const data = await resp.json();

    if (!data.elevation || !Array.isArray(data.elevation)) {
      throw new Error("Elevation API response format error");
    }

    elevations = elevations.concat(data.elevation.map(v => {
      if (v === null || v === undefined || Number.isNaN(v)) return 0;
      return Number(v);
    }));
  }

  return elevations;
}

function setBusy(isBusy, msg = "") {
  const btn = document.getElementById("analyzeBtn");
  const status = document.getElementById("status");
  btn.disabled = isBusy;
  btn.textContent = isBusy ? "Analyzing..." : "Analyze";
  status.textContent = msg;
}


function fsplDb(freqMHz, distanceKm) {
  if (freqMHz <= 0 || distanceKm <= 0) return 0;
  return 32.44 + 20 * Math.log10(distanceKm) + 20 * Math.log10(freqMHz);
}

function linkBudget(freqMHz, distanceKm) {
  const txPower = parseFloat(document.getElementById("txPowerDbm").value);
  const staGain = parseFloat(document.getElementById("staAntGainDbi").value);
  const apGain = parseFloat(document.getElementById("apAntGainDbi").value);
  const cableLoss = parseFloat(document.getElementById("cableLossDb").value);
  const rxSensitivity = parseFloat(document.getElementById("rxSensitivityDbm").value);
  const targetMargin = parseFloat(document.getElementById("fadeMarginTargetDb").value);

  const fspl = fsplDb(freqMHz, distanceKm);
  const rxPower = txPower + staGain + apGain - cableLoss - fspl;
  const fadeMargin = rxPower - rxSensitivity;

  let result = "PASS";
  let cls = "budget-pass";

  if (fadeMargin < 0) {
    result = "FAIL";
    cls = "budget-fail";
  } else if (fadeMargin < targetMargin) {
    result = "MARGINAL";
    cls = "budget-warn";
  }

  return {
    fspl,
    rxPower,
    fadeMargin,
    result,
    cls
  };
}

function calculateSmartHeightRecommendation(rows) {
  // rows contain min clearance for each frequency.
  // If worst clearance >= 0, no extra height needed.
  let worst = null;

  rows.forEach(r => {
    if (worst === null || r.min < worst.min) {
      worst = r;
    }
  });

  const need = worst.min < 0 ? Math.abs(worst.min) : 0;

  // Approximate practical guidance:
  // Adding the same height to both endpoints lifts the full LOS by that height everywhere.
  // Adding height to only one endpoint has position-dependent effect, so as a conservative
  // simple estimate, use 2x the worst deficit for single-side-only fixes.
  return {
    worstFreq: worst.freq,
    worstClearance: worst.min,
    bothSidesEach: need,
    staOnly: need * 2,
    apOnly: need * 2,
    status: need <= 0 ? "PASS" : "NEED_HEIGHT"
  };
}

async function analyze() {
  const sta = parseCoord(staCoord.value);
  const ap = parseCoord(apCoord.value);

  if (!sta || !ap) {
    alert("請輸入 STA / AP 座標，格式例如：25.146156, 121.804896");
    return;
  }

  const staAgl = parseFloat(document.getElementById("staAgl").value);
  const apAgl = parseFloat(document.getElementById("apAgl").value);
  const k = parseFloat(document.getElementById("kFactor").value);
  const freqs = getFreqs();
  const N = parseInt(document.getElementById("samples").value, 10);

  if (freqs.length === 0) {
    alert("請至少勾選一個頻率");
    return;
  }

  try {
    setBusy(true, "正在取得 DEM 高程資料...");

    const D = haversineKm(sta, ap);
    const Dm = D * 1000;

    let points = [];
    for (let i = 0; i < N; i++) {
      points.push(interpolatePoint(sta, ap, i / (N - 1)));
    }

    const terrain = await fetchElevations(points);

    setBusy(true, "正在計算 Fresnel / LOS...");

    const staGround = terrain[0];
    const apGround = terrain[terrain.length - 1];
    const staAnt = staGround + staAgl;
    const apAnt = apGround + apAgl;

    let labels = [];
    let curved = [];
    let los = [];

    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const d1m = Dm * t;
      const d2m = Dm - d1m;
      const bulge = earthBulgeM(d1m, d2m, k);
      const l = staAnt + (apAnt - staAnt) * t;

      labels.push((D * t).toFixed(2));
      curved.push(terrain[i] + bulge);
      los.push(l);
    }

    let datasets = [
      {
        label: "DEM Terrain / Sea Level",
        data: terrain,
        borderWidth: 2,
        pointRadius: 0,
        fill: true
      },
      {
        label: "LOS Line",
        data: los,
        borderWidth: 2,
        pointRadius: 0
      },
      {
        label: "Terrain + Earth Curvature",
        data: curved,
        borderWidth: 2,
        pointRadius: 0,
        borderDash: [5, 5]
      }
    ];

    let rows = [];
    let overall = true;
    let worst = null;
    let worstF = null;
    let worstIndex = 0;
    let worstLowerEdge = null;

    freqs.forEach(freq => {
      let lower = [];
      let min = Infinity;
      let minIndex = 0;

      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const d1 = D * t;
        const d2 = D - d1;

        const lowerEdge = los[i] - 0.6 * fresnelM(d1, d2, freq / 1000, D);
        const clearance = lowerEdge - curved[i];

        lower.push(lowerEdge);

        if (clearance < min) {
          min = clearance;
          minIndex = i;
        }
      }

      const mid = fresnelM(D / 2, D / 2, freq / 1000, D);
      const res = min >= 0 ? "PASS" : "FAIL";

      if (res === "FAIL") overall = false;

      if (worst === null || min < worst) {
        worst = min;
        worstF = freq;
        worstIndex = minIndex;
        worstLowerEdge = lower[minIndex];
      }

      datasets.push({
        label: `60% Fresnel Lower Edge @ ${freq} MHz`,
        data: lower,
        borderWidth: 2,
        pointRadius: 0,
        borderDash: [8, 4]
      });

      const budget = linkBudget(freq, D);

      rows.push({
        freq,
        mid,
        mid60: mid * 0.6,
        min,
        res,
        budget
      });
    });

    const worstMarkerData = new Array(N).fill(null);
    if (worstIndex !== null && worstLowerEdge !== null) {
      worstMarkerData[worstIndex] = worstLowerEdge;
      datasets.push({
        label: `Worst Obstruction @ ${labels[worstIndex]} km`,
        data: worstMarkerData,
        borderWidth: 0,
        pointRadius: 7,
        pointHoverRadius: 9,
        showLine: false
      });
    }

    document.getElementById("resultCard").style.display = "block";
    document.getElementById("chartCard").style.display = "block";

    document.getElementById("summary").innerHTML = `
      <div class="item"><b>Distance</b>${D.toFixed(2)} km</div>
      <div class="item"><b>K Factor</b>${k.toFixed(2)}</div>
      <div class="item"><b>Overall Result</b><span class="${overall ? "pass" : "fail"}">${overall ? "PASS" : "FAIL"}</span></div>
      <div class="item"><b>STA Ground Elev</b>${staGround.toFixed(1)} m</div>
      <div class="item"><b>AP Ground Elev</b>${apGround.toFixed(1)} m</div>
      <div class="item"><b>Worst Clearance</b>${worst.toFixed(2)} m @ ${worstF} MHz</div>
      <div class="item"><b>Worst Obstruction</b>${labels[worstIndex]} km from STA</div>
      <div class="item"><b>STA Ant Elev</b>${staAnt.toFixed(1)} m</div>
      <div class="item"><b>AP Ant Elev</b>${apAnt.toFixed(1)} m</div>
      <div class="item"><b>DEM Samples</b>${N}</div>
    `;

    document.getElementById("freqTable").innerHTML = rows.map(r => `
      <tr>
        <td>${r.freq} MHz</td>
        <td>${r.mid.toFixed(2)} m</td>
        <td>${r.mid60.toFixed(2)} m</td>
        <td>${r.min.toFixed(2)} m</td>
        <td><span class="${r.res === "PASS" ? "pass" : "fail"}">${r.res}</span></td>
        <td>${r.budget.fspl.toFixed(2)} dB</td>
        <td>${r.budget.rxPower.toFixed(2)} dBm</td>
        <td>${r.budget.fadeMargin.toFixed(2)} dB</td>
        <td><span class="${r.budget.cls}">${r.budget.result}</span></td>
      </tr>
    `).join("");

    const reco = calculateSmartHeightRecommendation(rows);
    document.getElementById("recommendCard").style.display = "block";

    if (reco.status === "PASS") {
      document.getElementById("heightRecommendation").innerHTML = `
        <div class="reco-box">
          <b>Overall</b>
          <div class="reco-value pass">PASS</div>
        </div>
        <div class="reco-box">
          <b>Worst Frequency</b>
          <div class="reco-value">${reco.worstFreq} MHz</div>
        </div>
        <div class="reco-box">
          <b>Worst Clearance</b>
          <div class="reco-value pass">${reco.worstClearance.toFixed(2)} m</div>
        </div>
        <div class="reco-box">
          <b>Extra Height Needed</b>
          <div class="reco-value pass">0 m</div>
        </div>
        <div class="reco-note" style="grid-column:1/-1;">
          目前所有勾選頻率皆通過 60% Fresnel clearance。暫不需要額外增加 STA/AP 天線高度。
        </div>
      `;
    } else {
      document.getElementById("heightRecommendation").innerHTML = `
        <div class="reco-box">
          <b>Worst Frequency</b>
          <div class="reco-value fail">${reco.worstFreq} MHz</div>
        </div>
        <div class="reco-box">
          <b>Current Worst Clearance</b>
          <div class="reco-value fail">${reco.worstClearance.toFixed(2)} m</div>
        </div>
        <div class="reco-box">
          <b>STA + AP 平均分攤</b>
          <div class="reco-value">${reco.bothSidesEach.toFixed(1)} m each</div>
        </div>
        <div class="reco-box">
          <b>單邊加高估算</b>
          <div class="reco-value">${reco.staOnly.toFixed(1)} m</div>
        </div>
        <div class="reco-note" style="grid-column:1/-1;">
          建議解讀：最差頻率為 ${reco.worstFreq} MHz，目前最小淨空為 ${reco.worstClearance.toFixed(2)} m。
          若 STA 與 AP 兩端一起加高，初步可抓兩端各增加 ${reco.bothSidesEach.toFixed(1)} m。
          若只想加高單邊，先用保守估算約 ${reco.staOnly.toFixed(1)} m；實際最佳加高位置會依最差遮擋點靠近 STA 或 AP 而不同。
        </div>
      `;
    }

    if (chart) chart.destroy();

    chart = new Chart(document.getElementById("profileChart").getContext("2d"), {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            title: { display: true, text: "Distance from STA to AP (km)" }
          },
          y: {
            title: { display: true, text: "Height (m)" }
          }
        }
      }
    });

    redrawMap();
    setBusy(false, "完成。已產生 Worst Obstruction / Link Budget / Smart Height Recommendation。");
  } catch (err) {
    setBusy(false, "");
    alert("分析失敗：" + err.message);
  }
}

redrawMap();
