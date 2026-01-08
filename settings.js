// web/settings.js

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

// Clicking the bottom-left profile area should open the Profile tab
document.querySelector(".sidebar-footer .user-info")?.addEventListener("click", () => {
  window.location.href = `profile.html${window.location.search || ""}`;
});

// Load user info
async function loadUser() {
  try {
    const res = await fetch(`${API}/api/me`, {
      credentials: "include",
    });

    if (!res.ok) {
      window.location.href = "index.html";
      return;
    }

    const data = await res.json();
    const email = data.user?.email || "Unknown";
    document.getElementById("sidebarUser").textContent = email.split("@")[0];
    document.getElementById("sidebarEmail").textContent = email;
    document.getElementById("userInitial").textContent = email.charAt(0).toUpperCase();
    document.getElementById("settingsEmail").textContent = email;
  } catch (e) {
    window.location.href = "index.html";
  }
}

// Load settings
async function loadSettings() {
  try {
    const res = await fetch(`${API}/api/settings`, {
      credentials: "include",
    });

    if (res.ok) {
      const data = await res.json();
      if (data.settings) {
        document.getElementById("emailNotifications").checked = data.settings.emailNotifications !== false;
        document.getElementById("transactionAlerts").checked = data.settings.transactionAlerts !== false;
        document.getElementById("networkSelect").value = data.settings.network || "testnet";
        const addrInput = document.getElementById("xrplAddressInput");
        if (addrInput) addrInput.value = data.settings.defaultXrplAddress || "";
        renderXrplStatus(data.settings);
      }
    }
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
}

function renderXrplStatus(settings) {
  const el = document.getElementById("xrplAddressStatus");
  if (!el) return;
  const currentAddr = document.getElementById("xrplAddressInput")?.value?.trim() || "";
  const addr = String(settings?.defaultXrplAddress || currentAddr || "").trim();
  const verified = settings?.defaultXrplVerified === true;
  const at = settings?.defaultXrplVerifiedAt;

  if (!addr) {
    el.textContent = "No address set";
    el.style.color = "#718096";
    return;
  }
  if (verified) {
    el.textContent = `✅ Verified on ledger${at ? ` • ${new Date(at).toLocaleString()}` : ""}`;
    el.style.color = "#10b981";
    return;
  }
  el.textContent = "Not verified";
  el.style.color = "#f59e0b";
}

// Save settings
async function saveSettings() {
  const settings = {
    emailNotifications: document.getElementById("emailNotifications").checked,
    transactionAlerts: document.getElementById("transactionAlerts").checked,
    network: document.getElementById("networkSelect").value,
    defaultXrplAddress: document.getElementById("xrplAddressInput")?.value?.trim() || "",
  };

  try {
    const res = await fetch(`${API}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(settings),
    });

    if (res.ok) {
      showNotification("Settings saved successfully!");
    } else {
      showNotification("Failed to save settings", true);
    }
  } catch (err) {
    showNotification("Error saving settings", true);
  }
}

// Change password
document.getElementById("btnChangePassword").addEventListener("click", () => {
  const oldPassword = prompt("Enter current password:");
  if (!oldPassword) return;

  const newPassword = prompt("Enter new password (min 6 characters):");
  if (!newPassword || newPassword.length < 6) {
    alert("Password must be at least 6 characters");
    return;
  }

  const confirmPassword = prompt("Confirm new password:");
  if (newPassword !== confirmPassword) {
    alert("Passwords do not match");
    return;
  }

  // TODO: Implement password change endpoint
  alert("Password change feature coming soon!");
});

// Delete account
document.getElementById("btnDeleteAccount").addEventListener("click", () => {
  if (!confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
    return;
  }

  if (!confirm("This will permanently delete all your data. Type DELETE to confirm:")) {
    return;
  }

  // TODO: Implement account deletion
  alert("Account deletion feature coming soon!");
});

// Settings change handlers
document.getElementById("emailNotifications").addEventListener("change", saveSettings);
document.getElementById("transactionAlerts").addEventListener("change", saveSettings);
document.getElementById("networkSelect").addEventListener("change", saveSettings);
document.getElementById("xrplAddressInput")?.addEventListener("change", saveSettings);
document.getElementById("xrplAddressInput")?.addEventListener("blur", saveSettings);
document.getElementById("xrplAddressInput")?.addEventListener("input", () => {
  // Update UI status immediately while typing
  renderXrplStatus({ defaultXrplVerified: false, defaultXrplVerifiedAt: null });
});

// Verify address (ledger existence/activation check)
document.getElementById("btnVerifyXrplAddress")?.addEventListener("click", async () => {
  const btn = document.getElementById("btnVerifyXrplAddress");
  const input = document.getElementById("xrplAddressInput");
  const address = input?.value?.trim() || "";

  if (!address) {
    showNotification("Please enter an XRPL address first", true);
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Verifying...";
  }

  try {
    const res = await fetch(`${API}/api/settings/verify-address`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ address }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showNotification(data.error || "Verification failed", true);
      renderXrplStatus({ defaultXrplAddress: address, defaultXrplVerified: false });
      return;
    }

    if (data.verified) {
      showNotification(`Verified! Balance: ${Number(data.balanceXrp || 0).toFixed(2)} XRP`);
      // Reload from server so timestamp matches DB
      loadSettings();
    } else {
      showNotification(data.hint || "Not activated on ledger", true);
      renderXrplStatus({ defaultXrplAddress: address, defaultXrplVerified: false });
    }
  } catch (err) {
    showNotification(`Error verifying address: ${err?.message || "Failed to reach backend"} (${API})`, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Verify";
    }
  }
});

function showNotification(message, isError = false) {
  const notification = document.createElement("div");
  notification.className = `notification ${isError ? "error" : "success"}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add("show");
  }, 10);

  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

loadUser();
loadSettings();
