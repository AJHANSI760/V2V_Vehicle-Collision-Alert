const API = "";
const tokenKey = "v2v-token";
const messageEl = document.getElementById("authMessage");
const tabs = document.querySelectorAll(".tab-button");
const forms = document.querySelectorAll(".auth-form");

const setMessage = (text, isError = false) => {
  messageEl.textContent = text;
  messageEl.classList.toggle("error", isError);
};

const passwordIssues = (password) => [
  [password.length >= 12, "12+ characters"],
  [/[a-z]/.test(password), "lowercase letter"],
  [/[A-Z]/.test(password), "uppercase letter"],
  [/\d/.test(password), "number"],
  [/[^A-Za-z0-9]/.test(password), "symbol"],
].filter(([passed]) => !passed).map(([, label]) => label);

const storeSession = ({ token, user }) => {
  localStorage.setItem(tokenKey, token);
  localStorage.setItem("v2v-user", JSON.stringify(user));
  window.location.href = "/dashboard";
};

tabs.forEach((button) => {
  button.addEventListener("click", () => {
    tabs.forEach((tab) => tab.classList.toggle("active", tab === button));
    forms.forEach((form) => form.classList.toggle("active", form.id.startsWith(button.dataset.tab)));
    setMessage("");
  });
});

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const res = await fetch(`${API}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(form.entries())),
  });
  const data = await res.json();
  if (!res.ok) return setMessage(data.error || "Login failed", true);
  storeSession(data);
});

document.getElementById("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const issues = passwordIssues(form.get("password") || "");
  if (issues.length) return setMessage(`Password needs: ${issues.join(", ")}`, true);
  const payload = {
    name: form.get("name"),
    email: form.get("email"),
    phone: form.get("phone"),
    password: form.get("password"),
    vehicle: {
      type: form.get("vehicleType"),
      model: form.get("vehicleModel"),
      number: form.get("vehicleNumber"),
    },
  };
  const res = await fetch(`${API}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) return setMessage(data.error || "Registration failed", true);
  storeSession(data);
});
