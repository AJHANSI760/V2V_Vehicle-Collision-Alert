const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const canvas = $("#trafficCanvas");
const ctx = canvas.getContext("2d");

const ui = {
  alert: $("#demoAlert"),
  play: $("#playPauseBtn"),
  reset: $("#resetBtn"),
  sound: $("#soundToggle"),
  telemetry: $("#telemetryList"),
  closest: $("#closestDistance"),
  tracked: $("#trackedVehicles"),
  pair: $("#alertPair"),
  gpsTime: $("#gpsTimestamp")
};

const map = {
  baseLat: 37.7749,
  baseLon: -122.4194,
  latSpan: 0.0068,
  lonSpan: 0.0106,
  mx: 780,
  my: 620
};

const labels = {
  alpha: "Vehicle Alpha",
  bravo: "Vehicle Bravo",
  charlie: "Vehicle Charlie",
  delta: "Vehicle Delta"
};

const state = {
  running: true,
  alert: false,
  last: 0,
  frame: 0,
  osc: null
};

const audio = window.AudioContext ? new AudioContext() : null;

const freshVehicles = () => ([
  { id: "alpha", color: "#00aaff", x: 0.12, y: 0.41, vx: 0.11, vy: 0, r: 12 },
  { id: "bravo", color: "#ff3b3b", x: 0.52, y: 1.08, vx: 0, vy: -0.15, r: 12 },
  { id: "charlie", color: "#9be6ff", x: 1.06, y: 0.59, vx: -0.12, vy: 0, r: 12 },
  { id: "delta", color: "#6ea8ff", x: 0.68, y: -0.14, vx: 0, vy: 0.09, r: 12 }
]);

let vehicles = freshVehicles();

const meterDistance = (a, b) =>
  Math.hypot((a.x - b.x) * map.mx, (a.y - b.y) * map.my);

const vehicleName = (id) => labels[id].replace("Vehicle ", "");

const speedKph = ({ vx, vy }) => Math.hypot(vx * map.mx, vy * map.my) * 3.6;

const heading = ({ vx, vy }) =>
  vx > 0 ? "Eastbound" : vx < 0 ? "Westbound" : vy > 0 ? "Southbound" : "Northbound";

const gps = ({ x, y }) => ({
  lat: (map.baseLat + (y - 0.5) * map.latSpan).toFixed(5),
  lon: (map.baseLon + (x - 0.5) * map.lonSpan).toFixed(5)
});

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = width * 520 / 920;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawRoad(w, h) {
  ctx.fillStyle = "#09111f";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(0,170,255,.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 36) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += 36) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  ctx.fillStyle = "rgba(112,128,160,.24)";
  ctx.fillRect(0, h * 0.33, w, h * 0.16);
  ctx.fillRect(w * 0.42, 0, w * 0.16, h);

  ctx.strokeStyle = "rgba(255,255,255,.2)";
  ctx.setLineDash([16, 14]);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, h * 0.41); ctx.lineTo(w, h * 0.41); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w * 0.5, 0); ctx.lineTo(w * 0.5, h); ctx.stroke();
  ctx.setLineDash([]);
}

function moveVehicle(v, dt) {
  v.x += v.vx * dt;
  v.y += v.vy * dt;
  if (v.vx > 0 && v.x > 1.12) v.x = -0.12;
  if (v.vx < 0 && v.x < -0.12) v.x = 1.12;
  if (v.vy > 0 && v.y > 1.12) v.y = -0.12;
  if (v.vy < 0 && v.y < -0.12) v.y = 1.12;
}

function drawVehicle(v, w, h, danger) {
  const x = v.x * w;
  const y = v.y * h;

  if (danger) {
    ctx.beginPath();
    ctx.arc(x, y, 26 + Math.sin(performance.now() / 130) * 4, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,59,59,.9)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.fillStyle = v.color;
  ctx.shadowColor = danger ? "rgba(255,59,59,.7)" : "rgba(0,170,255,.55)";
  ctx.shadowBlur = danger ? 26 : 18;
  ctx.arc(x, y, v.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.beginPath();
  ctx.fillStyle = "#fff";
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function analyzeScene(w, h) {
  const danger = new Set();
  let closest = null;
  const threshold = Math.min(w, h) * 0.12;

  for (let i = 0; i < vehicles.length; i += 1) {
    for (let j = i + 1; j < vehicles.length; j += 1) {
      const a = vehicles[i];
      const b = vehicles[j];
      const px = Math.hypot(a.x * w - b.x * w, a.y * h - b.y * h);
      const meters = meterDistance(a, b);

      if (!closest || meters < closest.distance) {
        closest = { ids: [a.id, b.id], distance: meters };
      }
      if (px < threshold) {
        danger.add(a.id);
        danger.add(b.id);
      }
    }
  }

  const telemetry = vehicles.map((v) => {
    const nearest = vehicles
      .filter((o) => o.id !== v.id)
      .map((o) => ({ id: o.id, distance: meterDistance(v, o) }))
      .sort((a, b) => a.distance - b.distance)[0];

    return {
      ...v,
      nearest,
      speed: speedKph(v),
      dir: heading(v),
      gps: gps(v)
    };
  });

  return { danger, closest, telemetry };
}

function stopBeep() {
  if (!state.osc) return;
  try { state.osc.stop(); } catch {}
  state.osc = null;
}

function beep() {
  if (!audio || !ui.sound.checked) return;
  stopBeep();
  if (audio.state === "suspended") audio.resume().catch(() => {});
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "square";
  osc.frequency.value = 880;
  gain.gain.value = 0.0001;
  osc.connect(gain);
  gain.connect(audio.destination);
  const now = audio.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.035, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  osc.start(now);
  osc.stop(now + 0.18);
  osc.onended = () => { if (state.osc === osc) state.osc = null; };
  state.osc = osc;
}

function setAlert(active) {
  if (state.alert === active) return;
  state.alert = active;
  ui.alert.classList.toggle("active", active);
  active ? beep() : stopBeep();
}

function renderTelemetry({ telemetry, closest }) {
  ui.tracked.textContent = telemetry.length;
  ui.closest.textContent = closest ? `${closest.distance.toFixed(1)} m` : "-- m";
  ui.pair.textContent = state.alert && closest ? closest.ids.map(vehicleName).join(" / ") : "None";
  ui.gpsTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  ui.telemetry.innerHTML = telemetry.map((v) => `
    <article class="telemetry-item">
      <div class="telemetry-header">
        <div class="telemetry-name">
          <span class="telemetry-dot" style="color:${v.color};background:${v.color};"></span>
          <strong>${labels[v.id]}</strong>
        </div>
        <strong class="telemetry-speed">${v.speed.toFixed(1)} km/h</strong>
      </div>
      <div class="telemetry-meta">
        <span>Nearest vehicle<strong>${vehicleName(v.nearest.id)} · ${v.nearest.distance.toFixed(1)} m</strong></span>
        <span>Heading<strong>${v.dir}</strong></span>
      </div>
      <div class="telemetry-gps">GPS ${v.gps.lat}, ${v.gps.lon}</div>
    </article>
  `).join("");
}

function loop(time) {
  if (!state.last) state.last = time;
  const dt = Math.min((time - state.last) / 1000, 0.05);
  state.last = time;

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  drawRoad(w, h);
  if (state.running) vehicles.forEach((v) => moveVehicle(v, dt));

  const scene = analyzeScene(w, h);
  setAlert(scene.danger.size > 0);
  vehicles.forEach((v) => drawVehicle(v, w, h, scene.danger.has(v.id)));

  if (++state.frame % 6 === 0) renderTelemetry(scene);
  requestAnimationFrame(loop);
}

function reset() {
  vehicles = freshVehicles();
  state.last = 0;
  state.frame = 0;
  setAlert(false);
  renderTelemetry(analyzeScene(canvas.clientWidth, canvas.clientHeight));
}

function observeOnce(selector, callback, threshold) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      callback(entry.target);
      observer.unobserve(entry.target);
    });
  }, { threshold });
  $$(selector).forEach((el) => observer.observe(el));
}

function animateCounter(el) {
  const target = Number(el.dataset.target || 0);
  const prefix = el.dataset.prefix || "";
  const suffix = el.dataset.suffix || "";
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min((now - start) / 1500, 1);
    el.textContent = `${prefix}${Math.round(target * (1 - (1 - p) ** 3))}${suffix}`;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

$$(".faq-question").forEach((btn) => btn.addEventListener("click", () => {
  const item = btn.closest(".faq-item");
  const open = btn.getAttribute("aria-expanded") === "true";
  item.classList.toggle("open", !open);
  btn.setAttribute("aria-expanded", String(!open));
}));

ui.play.addEventListener("click", () => {
  state.running = !state.running;
  ui.play.textContent = state.running ? "Pause" : "Play";
});

ui.reset.addEventListener("click", reset);
ui.sound.addEventListener("change", () => !ui.sound.checked ? stopBeep() : state.alert && beep());
window.addEventListener("resize", resizeCanvas);

observeOnce(".reveal", (el) => el.classList.add("is-visible"), 0.2);
observeOnce(".counter", animateCounter, 0.6);

resizeCanvas();
reset();
requestAnimationFrame(loop);
