let mode = "login"; // "login" or "signup"

const form = document.getElementById("authForm");
const switchMode = document.getElementById("switchMode");
const switchText = document.getElementById("switchText");
const submitBtn = document.getElementById("submitBtn");
const msg = document.getElementById("msg");

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
    const res = await fetch(`http://127.0.0.1:3001${endpoint}`, {
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
