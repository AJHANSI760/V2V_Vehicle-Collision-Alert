const canvas = document.getElementById("publicMap");
const ctx = canvas.getContext("2d");
const vehicleCount = document.getElementById("publicVehicleCount");
const closestPair = document.getElementById("publicClosestPair");
const updated = document.getElementById("publicUpdated");
const telemetry = document.getElementById("publicTelemetry");
const badge = document.getElementById("publicAlertBadge");

const timeText = (iso) => new Date(iso).toLocaleTimeString([], {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = width * 520 / 920;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawMap(vehicles, dangerPairs) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dangerIds = new Set((dangerPairs || []).flatMap((pair) => pair.ids));

  ctx.fillStyle = "#09111f";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(0,170,255,.08)";
  for (let x = 0; x < width; x += 36) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += 36) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  ctx.fillStyle = "rgba(112,128,160,.24)";
  ctx.fillRect(0, height * 0.33, width, height * 0.16);
  ctx.fillRect(width * 0.42, 0, width * 0.16, height);

  vehicles.forEach((vehicle) => {
    const x = vehicle.x * width;
    const y = vehicle.y * height;
    if (dangerIds.has(vehicle.id)) {
      ctx.beginPath();
      ctx.arc(x, y, 25, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,59,59,.9)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.fillStyle = vehicle.color;
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "12px Space Grotesk";
    ctx.fillText(vehicle.label, x + 15, y - 12);
  });
}

function render(snapshot) {
  const vehicles = snapshot.vehicles || [];
  vehicleCount.textContent = vehicles.length;
  updated.textContent = timeText(snapshot.timestamp);
  closestPair.textContent = snapshot.closestPair
    ? `${snapshot.closestPair.ids.join(" / ")} · ${snapshot.closestPair.distance}m`
    : "No conflict";
  badge.textContent = snapshot.dangerPairs?.length ? snapshot.dangerPairs[0].message : "Read only";
  badge.classList.toggle("danger", Boolean(snapshot.dangerPairs?.length));
  drawMap(vehicles, snapshot.dangerPairs || []);

  telemetry.innerHTML = vehicles.map((vehicle) => `
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
        <span>Status<strong>${snapshot.dangerPairs?.some((pair) => pair.ids.includes(vehicle.id)) ? "Risk" : "Safe"}</strong></span>
      </div>
    </article>
  `).join("");
}

async function refresh() {
  const response = await fetch("/api/vehicles");
  render(await response.json());
}

window.addEventListener("resize", () => {
  resizeCanvas();
  refresh();
});

resizeCanvas();
refresh();
setInterval(refresh, 1000);
