const token = localStorage.getItem("v2v-token");
if (!token) window.location.href = "/login";

const authHeaders = { Authorization: `Bearer ${token}` };
const driverSummary = document.getElementById("driverSummary");
const connectionState = document.getElementById("connectionState");
const closestPairText = document.getElementById("closestPairText");
const vehicleCount = document.getElementById("vehicleCount");
const lastUpdate = document.getElementById("lastUpdate");
const telemetryEl = document.getElementById("vehicleTelemetry");
const alertsEl = document.getElementById("alertHistory");
const alertBanner = document.getElementById("alertBannerInline");
const mapCanvas = document.getElementById("liveMap");
const ctx = mapCanvas.getContext("2d");

let monitoring = true;
let latestVehicles = [];

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const width = mapCanvas.clientWidth;
  const height = width * 520 / 920;
  mapCanvas.width = width * ratio;
  mapCanvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawMap(vehicles, dangerPairs) {
  const w = mapCanvas.clientWidth;
  const h = mapCanvas.clientHeight;
  ctx.fillStyle = "#09111f";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(0,170,255,.08)";
  for (let x = 0; x < w; x += 36) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += 36) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.fillStyle = "rgba(112,128,160,.24)";
  ctx.fillRect(0, h * 0.33, w, h * 0.16);
  ctx.fillRect(w * 0.42, 0, w * 0.16, h);

  const dangerIds = new Set((dangerPairs || []).flatMap((pair) => pair.ids));
  vehicles.forEach((vehicle) => {
    const x = vehicle.x * w;
    const y = vehicle.y * h;
    if (dangerIds.has(vehicle.id)) {
      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,59,59,.95)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.fillStyle = vehicle.color;
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "12px Space Grotesk";
    ctx.fillText(vehicle.label, x + 14, y - 14);
  });
}

function renderTelemetry(vehicles) {
  telemetryEl.innerHTML = vehicles.map((vehicle) => `
    <article class="telemetry-item">
      <div class="telemetry-header">
        <div class="telemetry-name">
          <span class="telemetry-dot" style="color:${vehicle.color};background:${vehicle.color};"></span>
          <strong>${vehicle.label}</strong>
        </div>
        <strong class="telemetry-speed">${vehicle.speed} km/h</strong>
      </div>
      <div class="telemetry-meta">
        <span>Heading<strong>${vehicle.heading}</strong></span>
        <span>GPS<strong>${(37.7749 + (vehicle.y - 0.5) * 0.0068).toFixed(5)}, ${(-122.4194 + (vehicle.x - 0.5) * 0.0106).toFixed(5)}</strong></span>
      </div>
    </article>
  `).join("");
}

function renderAlerts(alerts) {
  alertsEl.innerHTML = alerts.map((alert) => `
    <article class="alert-item ${alert.severity}">
      <strong>${alert.message}</strong>
      <small>${fmtTime(alert.time)}</small>
    </article>
  `).join("");
}

function renderSnapshot(snapshot) {
  latestVehicles = snapshot.vehicles || [];
  vehicleCount.textContent = String(latestVehicles.length);
  lastUpdate.textContent = fmtTime(snapshot.timestamp);
  closestPairText.textContent = snapshot.closestPair
    ? `${snapshot.closestPair.ids.join(" / ")} · ${snapshot.closestPair.distance}m`
    : "No nearby conflict";
  alertBanner.textContent = snapshot.dangerPairs?.length
    ? snapshot.dangerPairs[0].message
    : "Monitoring active";
  alertBanner.classList.toggle("danger", Boolean(snapshot.dangerPairs?.length));
  drawMap(latestVehicles, snapshot.dangerPairs || []);
  renderTelemetry(latestVehicles);
  renderAlerts(snapshot.alerts || []);
}

async function loadProfile() {
  const [meRes, alertRes] = await Promise.all([
    fetch("/api/me", { headers: authHeaders }),
    fetch("/api/alerts", { headers: authHeaders }),
  ]);
  if (meRes.status === 401) {
    localStorage.removeItem("v2v-token");
    return window.location.href = "/login";
  }
  const me = await meRes.json();
  const alertData = await alertRes.json();
  driverSummary.textContent = `${me.user.name} · ${me.user.vehicle.model} (${me.user.vehicle.number})`;
  renderAlerts(alertData.alerts || []);
}

function connectSocket() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${proto}://${window.location.host}/ws/vehicles?token=${encodeURIComponent(token)}`);
  socket.addEventListener("open", () => {
    connectionState.textContent = "Live";
    connectionState.parentElement.classList.remove("error");
  });
  socket.addEventListener("message", (event) => {
    if (!monitoring) return;
    renderSnapshot(JSON.parse(event.data));
  });
  socket.addEventListener("close", () => {
    connectionState.textContent = "Disconnected";
    setTimeout(connectSocket, 1500);
  });
}

document.getElementById("monitorToggle").addEventListener("click", (event) => {
  monitoring = !monitoring;
  event.currentTarget.textContent = monitoring ? "Stop Monitoring" : "Start Monitoring";
  alertBanner.textContent = monitoring ? "Monitoring active" : "Monitoring paused";
  if (monitoring && latestVehicles.length) drawMap(latestVehicles, []);
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("v2v-token");
  localStorage.removeItem("v2v-user");
  window.location.href = "/login";
});

window.addEventListener("resize", () => {
  resizeCanvas();
  drawMap(latestVehicles, []);
});

resizeCanvas();
loadProfile();
connectSocket();
