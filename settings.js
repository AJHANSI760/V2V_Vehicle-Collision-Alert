const token = localStorage.getItem("v2v-token");
if (!token) window.location.href = "/login";

const authHeaders = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

const profileEl = document.getElementById("settingsProfile");
const form = document.getElementById("settingsForm");
const msg = document.getElementById("settingsMessage");

async function loadSettings() {
  const [meRes, settingsRes] = await Promise.all([
    fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } }),
    fetch("/api/settings", { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  if (meRes.status === 401 || settingsRes.status === 401) {
    localStorage.removeItem("v2v-token");
    return window.location.href = "/login";
  }
  const me = await meRes.json();
  const settings = await settingsRes.json();
  profileEl.textContent = `${me.user.name} · ${me.user.vehicle.type} · ${me.user.vehicle.model}`;
  Object.entries(settings.settings).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value;
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fields = new FormData(form);
  const payload = {
    distanceRange: Number(fields.get("distanceRange")),
    speedThreshold: Number(fields.get("speedThreshold")),
    sensitivity: fields.get("sensitivity"),
    vehicleFilter: fields.get("vehicleFilter"),
    language: fields.get("language"),
    emergencyContact: fields.get("emergencyContact"),
    soundAlerts: form.elements.soundAlerts.checked,
    popupAlerts: form.elements.popupAlerts.checked,
    smsAlerts: form.elements.smsAlerts.checked,
    darkMode: form.elements.darkMode.checked,
    autoEmergency: form.elements.autoEmergency.checked,
  };
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  msg.textContent = res.ok ? "Settings saved successfully." : data.error || "Save failed.";
  msg.classList.toggle("error", !res.ok);
});

loadSettings();
