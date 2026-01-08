// web/withdraw.js

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
  } catch (e) {
    window.location.href = "index.html";
  }
}

// Load XLUSD balance
async function loadBalance() {
  try {
    const res = await fetch(`${API}/api/xlusd/balance`, {
      credentials: "include",
    });

    if (res.ok) {
      const data = await res.json();
      if (data.ok) {
        document.getElementById("availableBalance").textContent = 
          `${data.balance.toFixed(2)} XLUSD`;
      }
    }
  } catch (err) {
    console.error("Failed to load balance:", err);
  }
}

// Load withdrawal history
async function loadWithdrawalHistory() {
  const historyList = document.getElementById("withdrawHistory");
  
  try {
    const res = await fetch(`${API}/api/withdrawals`, {
      credentials: "include",
    });

    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.withdrawals && data.withdrawals.length > 0) {
        historyList.innerHTML = data.withdrawals.slice(0, 5).map(w => `
          <div class="withdraw-history-item">
            <div class="withdraw-history-icon">💸</div>
            <div class="withdraw-history-content">
              <div class="withdraw-history-header">
                <span class="withdraw-history-amount">${w.amountXlusd} XLUSD</span>
                <span class="withdraw-history-status ${w.status}">${w.status}</span>
              </div>
              <div class="withdraw-history-meta">
                ${w.withdrawalMethod === "bank" ? "🏦 Bank Transfer" : "📱 PayNow"} • 
                ${new Date(w.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        `).join("");
      } else {
        historyList.innerHTML = '<div class="empty-state">No withdrawal history</div>';
      }
    } else {
      historyList.innerHTML = '<div class="empty-state">No withdrawal history</div>';
    }
  } catch (err) {
    historyList.innerHTML = '<div class="empty-state">Failed to load history</div>';
  }
}

// Tab switching
let currentWithdrawalMethod = "bank";
const tabButtons = document.querySelectorAll(".tab-btn");
const paymentForms = document.querySelectorAll(".payment-form");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const method = btn.dataset.method;
    currentWithdrawalMethod = method;

    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    paymentForms.forEach((f) => f.classList.remove("active"));
    document.getElementById(`${method}-form`).classList.add("active");
  });
});

// Calculate total
const withdrawAmountInput = document.getElementById("withdrawAmount");
const withdrawTotalEl = document.getElementById("withdrawTotal");
const processBtn = document.getElementById("btnProcessWithdrawal");

withdrawAmountInput.addEventListener("input", () => {
  const amount = parseFloat(withdrawAmountInput.value) || 0;
  const total = amount * 1.0; // $1 per XLUSD
  withdrawTotalEl.textContent = `$${total.toFixed(2)} USD`;
  
  processBtn.disabled = amount <= 0;
});

// Process withdrawal
processBtn.addEventListener("click", async () => {
  const amount = parseFloat(withdrawAmountInput.value);
  
  if (!amount || amount <= 0) {
    showResult(false, "Please enter a valid amount");
    return;
  }

  processBtn.disabled = true;
  processBtn.textContent = "Processing...";
  showResult(null, "");

  try {
    let accountDetails = {};

    if (currentWithdrawalMethod === "bank") {
      const bankName = document.getElementById("bankName").value.trim();
      const accountNumber = document.getElementById("accountNumber").value.trim();
      const accountName = document.getElementById("accountName").value.trim();
      const swiftCode = document.getElementById("swiftCode").value.trim();

      if (!bankName || !accountNumber || !accountName) {
        showResult(false, "Please fill in all required bank details");
        processBtn.disabled = false;
        processBtn.textContent = "Process Withdrawal";
        return;
      }

      accountDetails = {
        bankName,
        accountNumber,
        accountName,
        swiftCode,
      };
    } else if (currentWithdrawalMethod === "paynow") {
      const mobile = document.getElementById("paynowMobile").value.trim();
      const name = document.getElementById("paynowName").value.trim();

      if (!mobile || !name) {
        showResult(false, "Please fill in all required PayNow details");
        processBtn.disabled = false;
        processBtn.textContent = "Process Withdrawal";
        return;
      }

      accountDetails = {
        mobile,
        name,
      };
    }

    const res = await fetch(`${API}/api/xlusd/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        amountXlusd: amount,
        withdrawalMethod: currentWithdrawalMethod,
        accountDetails,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      showResult(
        false,
        `Withdrawal failed: ${data.error || data.message || "Unknown error"}`
      );
    } else {
      showResult(
        true,
        `✅ Withdrawal initiated!\n` +
        `Amount: ${data.amountXlusd} XLUSD ($${data.amountUsd.toFixed(2)} USD)\n` +
        `Transaction ID: ${data.txHash || data.withdrawalId}\n` +
        `Status: ${data.status}\n\n` +
        `${data.message || "Your withdrawal is being processed."}`
      );
      
      // Clear form
      withdrawAmountInput.value = "";
      withdrawTotalEl.textContent = "$0.00 USD";
      
      // Reload balance and history
      setTimeout(() => {
        loadBalance();
        loadWithdrawalHistory();
      }, 1000);
    }
  } catch (err) {
    showResult(false, "❌ Cannot reach backend. Is the server running?");
  } finally {
    processBtn.disabled = false;
    processBtn.textContent = "Process Withdrawal";
  }
});

function showResult(ok, text) {
  const resultEl = document.getElementById("withdrawalResult");
  resultEl.textContent = text;
  resultEl.className = "result";
  if (ok === true) {
    resultEl.classList.add("ok");
  } else if (ok === false) {
    resultEl.classList.add("bad");
  }
}

loadUser();
loadBalance();
loadWithdrawalHistory();
