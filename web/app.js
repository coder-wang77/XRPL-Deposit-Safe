let mode = "login"; // "login" or "signup"

const form = document.getElementById("authForm");
const switchMode = document.getElementById("switchMode");
const switchText = document.getElementById("switchText");
const submitBtn = document.getElementById("submitBtn");
const msg = document.getElementById("msg");

function getApiBase() {
  const params = new URLSearchParams(window.location.search);
  const port =
    params.get("apiPort") ||
    localStorage.getItem("API_PORT") ||
    "3001";
  const host =
    params.get("apiHost") ||
    localStorage.getItem("API_HOST") ||
    window.location.hostname ||
    "127.0.0.1";
  const proto =
    params.get("apiProto") ||
    localStorage.getItem("API_PROTO") ||
    (window.location.protocol === "https:" ? "https:" : "http:");
  return `${proto}//${host}:${port}`;
}

const API = getApiBase();

function setMode(newMode) {
  mode = newMode;

  if (mode === "login") {
    submitBtn.textContent = "Sign In";
    switchText.textContent = "No account?";
    switchMode.textContent = "Create one";
  } else {
    submitBtn.textContent = "Create Account";
    switchText.textContent = "Already have an account?";
    switchMode.textContent = "Sign in";
  }

  msg.textContent = "";
}

switchMode.addEventListener("click", (e) => {
  e.preventDefault();
  setMode(mode === "login" ? "signup" : "login");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Working...";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const rememberMe = document.getElementById("rememberMe")?.checked || false;


  const endpoint = mode === "login" ? "/api/login" : "/api/signup";

  try {
    const res = await fetch(`${API}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // IMPORTANT (sessions)
      body: JSON.stringify({ email, password, rememberMe }),
    });

    const data = await res.json();

    if (!res.ok) {
      msg.textContent = data.error || "Something went wrong";
      return;
    }

    const shownEmail = data.user?.email || data.received?.email || email;
    msg.textContent = `✅ ${mode === "login" ? "Signed in" : "Account created"}: ${shownEmail}`;

    localStorage.setItem("userEmail", shownEmail);
    window.location.href = "dashboard.html";

  } catch (err) {
    msg.textContent =
      "❌ Cannot reach backend. Make sure server is running: cd server && npm start";
  }
});

// initialize
setMode("login");
