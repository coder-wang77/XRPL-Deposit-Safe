// web/settings.js

const API = "http://127.0.0.1:3001";

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
      }
    }

    // Load XRPL address
    const addressRes = await fetch(`${API}/debug/payer`, {
      credentials: "include",
    });
    if (addressRes.ok) {
      const addressData = await addressRes.json();
      document.getElementById("xrplAddress").textContent = addressData.payerAddress || "Not configured";
    }
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
}

// Save settings
async function saveSettings() {
  const settings = {
    emailNotifications: document.getElementById("emailNotifications").checked,
    transactionAlerts: document.getElementById("transactionAlerts").checked,
    network: document.getElementById("networkSelect").value,
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
