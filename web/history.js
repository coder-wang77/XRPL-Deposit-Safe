// web/history.js

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

// Load user info for sidebar
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
  } catch (e) {
    window.location.href = "index.html";
  }
}

// Load transaction history
async function loadHistory() {
  const historyList = document.getElementById("historyList");
  historyList.innerHTML = '<div class="loading-state">Loading history...</div>';

  try {
    const res = await fetch(`${API}/api/history`, {
      credentials: "include",
    });

    if (!res.ok) {
      historyList.innerHTML = '<div class="empty-state">Failed to load history</div>';
      return;
    }

    const data = await res.json();
    
    if (!data.history || data.history.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📜</div>
          <h3>No transactions yet</h3>
          <p>Your transaction history will appear here</p>
        </div>
      `;
      return;
    }

    const filterType = document.getElementById("filterType").value;
    const filterStatus = document.getElementById("filterStatus").value;

    let filtered = data.history;
    if (filterType !== "all") {
      filtered = filtered.filter(t => t.type === filterType);
    }
    if (filterStatus !== "all") {
      filtered = filtered.filter(t => t.status === filterStatus);
    }

    historyList.innerHTML = filtered.map(transaction => `
      <div class="history-item ${transaction.status}">
        <div class="history-icon">${getTransactionIcon(transaction.type)}</div>
        <div class="history-content">
          <div class="history-header">
            <h4>${getTransactionTitle(transaction.type)}</h4>
            <span class="history-status ${transaction.status}">${transaction.status}</span>
          </div>
          <div class="history-details">
            <span class="history-amount">${transaction.amount || "N/A"}</span>
            <span class="history-date">${formatDate(transaction.timestamp)}</span>
          </div>
          ${transaction.txHash ? `<div class="history-tx">Tx: ${transaction.txHash.substring(0, 20)}...</div>` : ""}
        </div>
      </div>
    `).join("");
  } catch (err) {
    historyList.innerHTML = '<div class="empty-state">Error loading history</div>';
  }
}

function getTransactionIcon(type) {
  const icons = {
    create: "📦",
    finish: "✅",
    cancel: "❌",
    purchase: "💰"
  };
  return icons[type] || "📝";
}

function getTransactionTitle(type) {
  const titles = {
    create: "Escrow Created",
    finish: "Escrow Finished",
    cancel: "Escrow Cancelled",
    purchase: "XLUSD Purchased"
  };
  return titles[type] || "Transaction";
}

function formatDate(timestamp) {
  if (!timestamp) return "Unknown";
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}

// Filter handlers
document.getElementById("filterType").addEventListener("change", loadHistory);
document.getElementById("filterStatus").addEventListener("change", loadHistory);

loadUser();
loadHistory();
