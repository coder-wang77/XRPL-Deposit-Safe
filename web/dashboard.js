// web/dashboard.js

const API = "http://127.0.0.1:3001";

const whoEl = document.getElementById("who");
whoEl.textContent = "Loading...";

function show(el, ok, text) {
  el.textContent = text;
  el.className = "result " + (ok ? "ok" : "bad");
}

// Convert <input type="datetime-local"> value to unix seconds
function toUnixSeconds(datetimeLocalValue) {
  if (!datetimeLocalValue) return null;
  const ms = new Date(datetimeLocalValue).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

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
    whoEl.textContent = email;
    
    // Update sidebar
    const sidebarUser = document.getElementById("sidebarUser");
    const sidebarEmail = document.getElementById("sidebarEmail");
    const userInitial = document.getElementById("userInitial");
    if (sidebarUser) sidebarUser.textContent = email.split("@")[0];
    if (sidebarEmail) sidebarEmail.textContent = email;
    if (userInitial) userInitial.textContent = email.charAt(0).toUpperCase();
  } catch (e) {
    window.location.href = "index.html";
  }
}

// Load statistics
async function loadStatistics() {
  try {
    const res = await fetch(`${API}/api/stats`, {
      credentials: "include",
    });

    if (res.ok) {
      const data = await res.json();
      document.getElementById("totalEscrows").textContent = data.totalEscrows || 0;
      document.getElementById("totalValue").textContent = `${data.totalValue || 0} XRP`;
      document.getElementById("completedCount").textContent = data.completed || 0;
      document.getElementById("pendingCount").textContent = data.pending || 0;
    }
  } catch (err) {
    console.error("Failed to load statistics:", err);
  }
}

// Load recent activity
async function loadRecentActivity() {
  const activityList = document.getElementById("recentActivity");
  if (!activityList) return;

  try {
    const res = await fetch(`${API}/api/history?limit=5`, {
      credentials: "include",
    });

    if (res.ok) {
      const data = await res.json();
      if (data.history && data.history.length > 0) {
        activityList.innerHTML = data.history.map(tx => `
          <div class="activity-item">
            <div class="activity-icon">${getActivityIcon(tx.type)}</div>
            <div class="activity-content">
              <div class="activity-title">${getActivityTitle(tx.type)}</div>
              <div class="activity-meta">${formatDate(tx.timestamp)}</div>
            </div>
            <div class="activity-status ${tx.status}">${tx.status}</div>
          </div>
        `).join("");
      } else {
        activityList.innerHTML = '<div class="activity-empty">No recent activity</div>';
      }
    } else {
      activityList.innerHTML = '<div class="activity-empty">No recent activity</div>';
    }
  } catch (err) {
    activityList.innerHTML = '<div class="activity-empty">No recent activity</div>';
  }
}

function getActivityIcon(type) {
  const icons = { create: "📦", finish: "✅", cancel: "❌", purchase: "💰" };
  return icons[type] || "📝";
}

function getActivityTitle(type) {
  const titles = { create: "Escrow Created", finish: "Escrow Finished", cancel: "Escrow Cancelled", purchase: "XLUSD Purchased" };
  return titles[type] || "Transaction";
}

function formatDate(timestamp) {
  if (!timestamp) return "Unknown";
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

loadUser();
loadStatistics();
loadRecentActivity();
setInterval(loadStatistics, 30000); // Refresh every 30 seconds

/* ======================
   XLUSD BALANCE & BUY
====================== */

const balanceEl = document.getElementById("xlusdBalance");
const buyBtn = document.getElementById("btnBuyXLUSD");

async function loadXLUSDBalance() {
  try {
    const res = await fetch(`${API}/api/xlusd/balance`, {
      credentials: "include",
    });

    if (!res.ok) {
      balanceEl.textContent = "Error";
      return;
    }

    const data = await res.json();
    if (data.ok) {
      balanceEl.textContent = `${data.balance.toFixed(2)} ${data.currency}`;
    } else {
      balanceEl.textContent = "0.00 XLUSD";
    }
  } catch (e) {
    balanceEl.textContent = "Error";
    console.error("Failed to load XLUSD balance:", e);
  }
}

// Load balance on page load and refresh every 10 seconds
loadXLUSDBalance();
setInterval(loadXLUSDBalance, 10000);

// Buy XLUSD button handler - navigate to payment page
buyBtn.addEventListener("click", () => {
  window.location.href = "buy-xlusd.html";
});

/* ======================
   CREATE ESCROW
====================== */
document.getElementById("btnCreate").addEventListener("click", async () => {
  const payeeAddress = document.getElementById("a_payee").value.trim();
  const amountXrp = document.getElementById("a_amount").value.trim();
  const finishLocal = document.getElementById("a_finish").value;
  const cancelLocal = document.getElementById("a_cancel").value;

  const out = document.getElementById("resCreate");

  const finishAfterUnix = toUnixSeconds(finishLocal);
  const cancelAfterUnix = cancelLocal ? toUnixSeconds(cancelLocal) : null;

  if (!payeeAddress || !amountXrp || !finishAfterUnix) {
    show(out, false, "❌ Missing payee / amount / finish time");
    return;
  }

  try {
    const res = await fetch(`${API}/escrow/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        payeeAddress,
        amountXrp,
        finishAfterUnix,
        cancelAfterUnix,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      show(
        out,
        false,
        `❌ Create failed\n${data.error || data.txResult || "Unknown error"}\n${
          data.engine_result_message || ""
        }`
      );
      return;
    }

    show(
      out,
      true,
      `✅ Escrow created\nTx: ${data.txHash}\nOfferSequence: ${data.offerSequence}\nResult: ${data.txResult}`
    );
  } catch (err) {
    show(out, false, "❌ Cannot reach backend. Is the server running?");
  }
});

/* ======================
   FINISH ESCROW
====================== */
document.getElementById("btnFinish").addEventListener("click", async () => {
  const ownerAddress = document.getElementById("b_owner").value.trim();
  const offerSequence = Number(document.getElementById("b_seq").value.trim());

  const out = document.getElementById("resFinish");

  if (!ownerAddress || !Number.isFinite(offerSequence)) {
    show(out, false, "❌ Missing owner address / valid sequence");
    return;
  }

  try {
    const res = await fetch(`${API}/escrow/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ownerAddress, offerSequence }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      show(out, false, `❌ Finish failed\n${data.error || "Unknown error"}`);
      return;
    }

    show(
      out,
      true,
      `✅ Escrow finished\nTx: ${data.txHash}\nResult: ${data.txResult}\nValidated: ${data.validated}`
    );
  } catch (err) {
    show(out, false, "❌ Cannot reach backend. Is the server running?");
  }
});

/* ======================
   CANCEL ESCROW
====================== */
document.getElementById("btnCancel").addEventListener("click", async () => {
  const ownerAddress = document.getElementById("c_owner").value.trim();
  const offerSequence = Number(document.getElementById("c_seq").value.trim());

  const out = document.getElementById("resCancel");

  if (!ownerAddress || !Number.isFinite(offerSequence)) {
    show(out, false, "❌ Missing owner address / valid sequence");
    return;
  }

  try {
    const res = await fetch(`${API}/escrow/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ownerAddress, offerSequence }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      show(out, false, `❌ Cancel failed\n${data.error || "Unknown error"}`);
      return;
    }

    show(
      out,
      true,
      `✅ Escrow cancelled\nTx: ${data.txHash}\nResult: ${data.txResult}\nValidated: ${data.validated}`
    );
  } catch (err) {
    show(out, false, "❌ Cannot reach backend. Is the server running?");
  }
});
