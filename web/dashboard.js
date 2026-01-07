// web/dashboard.js

const API = "http://127.0.0.1:3001";

const whoEl = document.getElementById("who");
whoEl.textContent = "Loading...";

// Utility function to show results
function show(el, ok, text) {
  el.textContent = text;
  el.className = "result " + (ok ? "ok" : "bad");
  el.style.display = "block";
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Validate XRPL address format
function isValidXRPLAddress(address) {
  if (!address || typeof address !== "string") return false;
  // XRPL addresses start with 'r' and are 25-34 characters
  return /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(address.trim());
}

// Format XRPL address for display (shorten long addresses)
function formatAddress(address) {
  if (!address) return "";
  const trimmed = address.trim();
  if (trimmed.length > 20) {
    return `${trimmed.slice(0, 8)}...${trimmed.slice(-8)}`;
  }
  return trimmed;
}

// Set button loading state
function setButtonLoading(button, isLoading, originalText = null) {
  if (isLoading) {
    if (!originalText) {
      button.dataset.originalText = button.textContent;
    }
    button.disabled = true;
    button.textContent = "⏳ Processing...";
    button.style.opacity = "0.7";
  } else {
    button.disabled = false;
    button.textContent = originalText || button.dataset.originalText || button.textContent;
    button.style.opacity = "1";
  }
}

// Format date/time for display
function formatDateTime(timestamp) {
  if (!timestamp) return "N/A";
  try {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  } catch (e) {
    return timestamp;
  }
}

// Format error message for display
function formatError(error) {
  if (!error) return "Unknown error occurred";
  
  // Extract key information from error messages
  if (typeof error === "string") {
    return error;
  }
  
  // Handle structured error objects
  if (error.message) {
    return error.message;
  }
  
  return String(error);
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
      document.getElementById("totalEscrows").textContent = Math.round(data.totalEscrows || 0);
      const totalValue = parseFloat(data.totalValue || 0);
      document.getElementById("totalValue").textContent = `${totalValue.toFixed(2)} XRP`;
      document.getElementById("completedCount").textContent = Math.round(data.completed || 0);
      document.getElementById("pendingCount").textContent = Math.round(data.pending || 0);
    }
  } catch (err) {
    console.error("Failed to load statistics:", err);
  }
}

// Load XRP wallet balance (same as profile page)
async function loadXRPWalletBalance() {
  try {
    const res = await fetch(`${API}/api/wallet/status`, {
      credentials: "include",
    });

    const balanceEl = document.getElementById("xrpWalletBalance");
    if (!balanceEl) return;

    if (res.ok) {
      const data = await res.json();
      
      if (data.wallet && data.connected && data.wallet.balanceXrp !== undefined) {
        balanceEl.textContent = `${data.wallet.balanceXrp.toFixed(2)} XRP`;
        balanceEl.style.color = "#10b981";
      } else if (data.wallet && data.connected && data.wallet.existsOnLedger === false) {
        balanceEl.textContent = "Not Activated";
        balanceEl.style.color = "#f59e0b";
      } else {
        balanceEl.textContent = "Not Connected";
        balanceEl.style.color = "#718096";
      }
    } else {
      balanceEl.textContent = "Error";
      balanceEl.style.color = "#ef4444";
    }
  } catch (err) {
    console.error("Failed to load XRP wallet balance:", err);
    const balanceEl = document.getElementById("xrpWalletBalance");
    if (balanceEl) {
      balanceEl.textContent = "Error";
      balanceEl.style.color = "#ef4444";
    }
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
      console.log("History response:", data);
      
      if (data.history && data.history.length > 0) {
        console.log(`Displaying ${data.history.length} history items`);
        activityList.innerHTML = data.history.map(tx => {
          const timestamp = tx.timestamp || tx.date;
          const formattedDate = formatDate(timestamp);
          const status = tx.status || 'pending';
          
          return `
          <div class="activity-item">
            <div class="activity-icon">${getActivityIcon(tx.type)}</div>
            <div class="activity-content">
              <div class="activity-title">${getActivityTitle(tx)}</div>
              <div class="activity-meta">${formattedDate}</div>
            </div>
            <div class="activity-status ${status}">${status}</div>
          </div>
        `;
        }).join("");
      } else {
        console.log("No history items returned");
        activityList.innerHTML = '<div class="activity-empty">No recent activity</div>';
      }
    } else {
      const errorText = await res.text();
      console.error("History API error:", res.status, errorText);
      activityList.innerHTML = '<div class="activity-empty">No recent activity</div>';
    }
  } catch (err) {
    console.error("Failed to load recent activity:", err);
    activityList.innerHTML = '<div class="activity-empty">No recent activity</div>';
  }
}

function getActivityIcon(type) {
  const icons = { 
    create: "📦", 
    finish: "✅", 
    cancel: "❌", 
    purchase: "💰",
    withdrawal: "💸"
  };
  return icons[type] || "📝";
}

function getActivityTitle(tx) {
  if (typeof tx === 'object' && tx.type) {
    if (tx.type === 'purchase') {
      return `XLUSD Purchased: ${tx.amount} XLUSD`;
    } else if (tx.type === 'withdrawal') {
      return `XLUSD Withdrawn: ${tx.amount} XLUSD`;
    }
  }
  
  // Fallback for old format
  const type = typeof tx === 'string' ? tx : tx?.type;
  const titles = { 
    create: "Escrow Created", 
    finish: "Escrow Finished", 
    cancel: "Escrow Cancelled", 
    purchase: "XLUSD Purchased",
    withdrawal: "XLUSD Withdrawn"
  };
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
loadXRPWalletBalance();
setInterval(loadStatistics, 30000); // Refresh every 30 seconds
setInterval(loadXRPWalletBalance, 30000); // Refresh XRP wallet balance every 30 seconds

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

// Refresh balance and activity when page becomes visible (e.g., after returning from buy page)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    loadXLUSDBalance();
    loadRecentActivity();
  }
});

// Also refresh on page focus
window.addEventListener('focus', () => {
  loadXLUSDBalance();
  loadRecentActivity();
});

// Buy XLUSD button handler - navigate to payment page
buyBtn.addEventListener("click", () => {
  window.location.href = "buy-xlusd.html";
});

/* ======================
   FREELANCER PAYMENT WORKFLOW
====================== */
const btnFreelancerCreate = document.getElementById("btnFreelancerCreate");
const freelancerInput = document.getElementById("f_freelancer");
const fAmountInput = document.getElementById("f_amount");
const fDeadlineInput = document.getElementById("f_deadline");
const resFreelancerCreate = document.getElementById("resFreelancerCreate");

const btnFreelancerRelease = document.getElementById("btnFreelancerRelease");
const btnFreelancerRefund = document.getElementById("btnFreelancerRefund");
const fReleaseOwnerInput = document.getElementById("f_release_owner");
const fReleaseSeqInput = document.getElementById("f_release_seq");
const fPreimageSection = document.getElementById("f_preimageSection");
const fPreimageInput = document.getElementById("f_preimage");
const btnCopyPreimage = document.getElementById("btnCopyPreimage");
const resFreelancerRelease = document.getElementById("resFreelancerRelease");

// Store preimage when escrow is created
let savedPreimages = {}; // {sequence: preimage}

// Set minimum datetime for deadline (5 minutes from now)
const minDeadline = new Date(Date.now() + 5 * 60 * 1000);
fDeadlineInput.min = minDeadline.toISOString().slice(0, 16);

// Set default deadline to 1 hour from now
const defaultDeadline = new Date(Date.now() + 60 * 60 * 1000);
fDeadlineInput.value = defaultDeadline.toISOString().slice(0, 16);

// Address validation
freelancerInput.addEventListener("blur", () => {
  const address = freelancerInput.value.trim();
  if (address && !isValidXRPLAddress(address)) {
    freelancerInput.style.borderColor = "#ef4444";
  } else {
    freelancerInput.style.borderColor = "";
  }
});

fReleaseOwnerInput.addEventListener("blur", () => {
  const address = fReleaseOwnerInput.value.trim();
  if (address && !isValidXRPLAddress(address)) {
    fReleaseOwnerInput.style.borderColor = "#ef4444";
  } else {
    fReleaseOwnerInput.style.borderColor = "";
  }
});

// Copy preimage to clipboard
btnCopyPreimage.addEventListener("click", () => {
  const preimage = fPreimageInput.value;
  if (preimage) {
    navigator.clipboard?.writeText(preimage).then(() => {
      btnCopyPreimage.textContent = "✅ Copied!";
      setTimeout(() => {
        btnCopyPreimage.textContent = "📋 Copy Preimage";
      }, 2000);
    });
  }
});

// Create freelancer payment escrow
btnFreelancerCreate.addEventListener("click", async () => {
  const freelancerAddress = freelancerInput.value.trim();
  const amountXrp = fAmountInput.value.trim();
  const deadlineLocal = fDeadlineInput.value;

  resFreelancerCreate.style.display = "none";

  // Validation
  if (!freelancerAddress) {
    show(resFreelancerCreate, false, "❌ Please enter freelancer address");
    freelancerInput.focus();
    return;
  }

  if (!isValidXRPLAddress(freelancerAddress)) {
    show(resFreelancerCreate, false, `❌ Invalid XRPL address: ${formatAddress(freelancerAddress)}`);
    freelancerInput.focus();
    return;
  }

  if (!amountXrp) {
    show(resFreelancerCreate, false, "❌ Please enter payment amount");
    fAmountInput.focus();
    return;
  }

  const amount = parseFloat(amountXrp);
  if (!Number.isFinite(amount) || amount <= 0 || amount < 0.000001) {
    show(resFreelancerCreate, false, "❌ Amount must be at least 0.000001 XRP");
    fAmountInput.focus();
    return;
  }

  if (!deadlineLocal) {
    show(resFreelancerCreate, false, "❌ Please select a deadline");
    fDeadlineInput.focus();
    return;
  }

  const deadlineUnix = toUnixSeconds(deadlineLocal);
  const nowUnix = Math.floor(Date.now() / 1000);
  const minDeadlineUnix = nowUnix + 300; // Require at least 5 minutes in the future
  
  if (!deadlineUnix) {
    show(resFreelancerCreate, false, "❌ Invalid deadline format");
    fDeadlineInput.focus();
    return;
  }
  
  if (deadlineUnix <= minDeadlineUnix) {
    const minDate = new Date(minDeadlineUnix * 1000).toLocaleString();
    show(resFreelancerCreate, false, `❌ Deadline must be at least 5 minutes in the future.\nMinimum: ${minDate}`);
    fDeadlineInput.focus();
    return;
  }

  setButtonLoading(btnFreelancerCreate, true, "⏳ Locking Payment...");

  try {
    const res = await fetch(`${API}/escrow/freelancer/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        freelancerAddress,
        amountXrp: amount,
        deadlineUnix,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      show(resFreelancerCreate, false, `❌ Failed to lock payment\n${data.error || "Unknown error"}`);
      return;
    }

    // Store preimage by sequence
    savedPreimages[data.offerSequence] = data.preimage;
    
    // Show preimage section
    fPreimageInput.value = data.preimage;
    fPreimageSection.style.display = "block";
    fReleaseSeqInput.value = data.offerSequence;
    fReleaseOwnerInput.value = ""; // Will need to fill manually or get from response

    const txHash = data.txHash || "N/A";
    const txUrl = `https://testnet.xrpl.org/transactions/${txHash}`;
    const successMsg = `✅ Payment Locked Successfully!\n\n` +
      `Amount: ${amount} XRP\n` +
      `Freelancer: ${formatAddress(freelancerAddress)}\n` +
      `Sequence: ${data.offerSequence}\n` +
      `Deadline: ${formatDateTime(deadlineUnix)}\n` +
      `\n💡 Workflow:\n` +
      `1. Freelancer delivers work\n` +
      `2. If satisfied: Share preimage with freelancer → They claim payment\n` +
      `3. If not satisfied by deadline: Click "Refund" to get money back\n` +
      `\nTransaction: ${txHash}\n${txUrl}`;
    
    show(resFreelancerCreate, true, successMsg);
    loadStatistics();
    loadXRPWalletBalance();

  } catch (err) {
    console.error("Create freelancer escrow error:", err);
    show(resFreelancerCreate, false, `❌ Network error: ${err.message || "Cannot reach backend"}`);
  } finally {
    setButtonLoading(btnFreelancerCreate, false);
  }
});

// Release payment (client shares preimage for freelancer to claim)
btnFreelancerRelease.addEventListener("click", async () => {
  const ownerAddress = fReleaseOwnerInput.value.trim();
  const seqValue = fReleaseSeqInput.value.trim();
  const preimage = savedPreimages[seqValue] || fPreimageInput.value.trim();

  resFreelancerRelease.style.display = "none";

  if (!ownerAddress || !isValidXRPLAddress(ownerAddress)) {
    show(resFreelancerRelease, false, "❌ Invalid owner address");
    fReleaseOwnerInput.focus();
    return;
  }

  if (!seqValue || !Number.isFinite(Number(seqValue))) {
    show(resFreelancerRelease, false, "❌ Invalid sequence number");
    fReleaseSeqInput.focus();
    return;
  }

  if (!preimage) {
    show(resFreelancerRelease, false, "❌ No preimage found. Please enter the preimage from escrow creation.");
    fPreimageInput.focus();
    return;
  }

  // Copy to clipboard automatically
  navigator.clipboard?.writeText(preimage).then(() => {
    // Show instructions for sharing
    show(resFreelancerRelease, true, 
      `✅ Preimage Copied to Clipboard!\n\n` +
      `📋 Share this preimage with your freelancer:\n\n` +
      `Preimage: ${preimage.substring(0, 40)}...\n\n` +
      `How to Share:\n` +
      `1. Send the preimage to your freelancer securely\n` +
      `2. Freelancer uses it to claim payment:\n` +
      `   • Go to "Flow B - Release Deposit"\n` +
      `   • Enter Owner: ${formatAddress(ownerAddress)}\n` +
      `   • Enter Sequence: ${seqValue}\n` +
      `   • Paste Fulfillment: ${preimage.substring(0, 20)}...\n` +
      `   • Click "Claim Deposit"\n\n` +
      `Once freelancer claims, payment is released! 💰`
    );
  }).catch(() => {
    // If clipboard fails, just show the message
    show(resFreelancerRelease, true, 
      `✅ Ready to Share Preimage!\n\n` +
      `Preimage: ${preimage}\n\n` +
      `Send this to your freelancer. They'll use it in "Flow B - Release Deposit" to claim payment.`
    );
  });
});

// Refund after deadline
btnFreelancerRefund.addEventListener("click", async () => {
  const ownerAddress = fReleaseOwnerInput.value.trim();
  const seqValue = fReleaseSeqInput.value.trim();

  if (!ownerAddress || !isValidXRPLAddress(ownerAddress)) {
    show(resFreelancerRelease, false, "❌ Invalid owner address");
    fReleaseOwnerInput.focus();
    return;
  }

  if (!seqValue || !Number.isFinite(Number(seqValue))) {
    show(resFreelancerRelease, false, "❌ Invalid sequence number");
    fReleaseSeqInput.focus();
    return;
  }

  if (!confirm(`Are you sure you want to refund?\n\nThis will cancel the escrow and return funds to you.\n\nOnly works after the deadline has passed.`)) {
    return;
  }

  setButtonLoading(btnFreelancerRefund, true, "⏳ Processing Refund...");

  try {
    const res = await fetch(`${API}/escrow/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        ownerAddress,
        offerSequence: Number(seqValue),
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      show(resFreelancerRelease, false, `❌ Refund failed\n${data.error || "Unknown error"}\n\nNote: Refund only works after the deadline has passed.`);
      return;
    }

    const txHash = data.txHash || "N/A";
    const txUrl = `https://testnet.xrpl.org/transactions/${txHash}`;
    show(resFreelancerRelease, true, 
      `✅ Refund Successful!\n\n` +
      `Funds have been returned to your account.\n` +
      `Transaction: ${txHash}\n${txUrl}`
    );
    loadStatistics();

  } catch (err) {
    console.error("Refund error:", err);
    show(resFreelancerRelease, false, `❌ Network error: ${err.message || "Cannot reach backend"}`);
  } finally {
    setButtonLoading(btnFreelancerRefund, false);
  }
});
