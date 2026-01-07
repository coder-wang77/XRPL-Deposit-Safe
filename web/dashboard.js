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
const btnCreate = document.getElementById("btnCreate");
const payeeInput = document.getElementById("a_payee");
const amountInput = document.getElementById("a_amount");
const finishInput = document.getElementById("a_finish");
const cancelInput = document.getElementById("a_cancel");
const resCreate = document.getElementById("resCreate");

// Set minimum datetime to now for finish input
finishInput.min = new Date().toISOString().slice(0, 16);
finishInput.addEventListener("change", () => {
  if (finishInput.value) {
    cancelInput.min = finishInput.value;
  }
});

// Conditional escrow toggle
const useConditionCheckbox = document.getElementById("a_useCondition");
const conditionalSection = document.getElementById("a_conditionalSection");
const conditionInput = document.getElementById("a_condition");
const btnGenerateCondition = document.getElementById("btnGenerateCondition");
const conditionPairDiv = document.getElementById("a_conditionPair");
const preimageDisplay = document.getElementById("a_preimage");
const conditionDisplay = document.getElementById("a_conditionDisplay");

useConditionCheckbox.addEventListener("change", () => {
  conditionalSection.style.display = useConditionCheckbox.checked ? "block" : "none";
  if (!useConditionCheckbox.checked) {
    conditionInput.value = "";
    conditionPairDiv.style.display = "none";
  }
});

// Generate condition-fulfillment pair
btnGenerateCondition.addEventListener("click", async () => {
  try {
    const res = await fetch(`${API}/escrow/generate-condition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      alert(`Failed to generate condition: ${data.error || "Unknown error"}`);
      return;
    }

    // Display the pair
    conditionInput.value = data.condition;
    preimageDisplay.textContent = data.preimage;
    conditionDisplay.textContent = data.condition;
    conditionPairDiv.style.display = "block";

    // Copy preimage to clipboard (optional feature)
    navigator.clipboard?.writeText(data.preimage).then(() => {
      const btn = btnGenerateCondition;
      const originalText = btn.textContent;
      btn.textContent = "✅ Copied!";
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    });
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
});

// Real-time address validation
payeeInput.addEventListener("blur", () => {
  const address = payeeInput.value.trim();
  if (address && !isValidXRPLAddress(address)) {
    payeeInput.style.borderColor = "#ef4444";
    payeeInput.title = "Invalid XRPL address format";
  } else {
    payeeInput.style.borderColor = "";
    payeeInput.title = "";
  }
});

// Amount validation
amountInput.addEventListener("input", () => {
  const amount = parseFloat(amountInput.value);
  if (amount && amount < 0.000001) {
    amountInput.style.borderColor = "#ef4444";
    amountInput.title = "Minimum amount is 0.000001 XRP";
  } else {
    amountInput.style.borderColor = "";
    amountInput.title = "";
  }
});

btnCreate.addEventListener("click", async () => {
  const payeeAddress = payeeInput.value.trim();
  const amountXrp = amountInput.value.trim();
  const finishLocal = finishInput.value;
  const cancelLocal = cancelInput.value;
  const useCondition = useConditionCheckbox.checked;
  const condition = useCondition ? conditionInput.value.trim() : null;

  // Clear previous results
  resCreate.style.display = "none";

  // Validation
  if (!payeeAddress) {
    show(resCreate, false, "❌ Please enter a payee XRPL address");
    payeeInput.focus();
    return;
  }

  if (!isValidXRPLAddress(payeeAddress)) {
    show(resCreate, false, `❌ Invalid XRPL address format: ${formatAddress(payeeAddress)}`);
    payeeInput.focus();
    return;
  }

  if (!amountXrp) {
    show(resCreate, false, "❌ Please enter an amount in XRP");
    amountInput.focus();
    return;
  }

  const amount = parseFloat(amountXrp);
  if (!Number.isFinite(amount) || amount <= 0) {
    show(resCreate, false, "❌ Amount must be a positive number");
    amountInput.focus();
    return;
  }

  if (amount < 0.000001) {
    show(resCreate, false, "❌ Minimum amount is 0.000001 XRP");
    amountInput.focus();
    return;
  }

  if (!finishLocal) {
    show(resCreate, false, "❌ Please select a release time (FinishAfter)");
    finishInput.focus();
    return;
  }

  const finishAfterUnix = toUnixSeconds(finishLocal);
  if (!finishAfterUnix || finishAfterUnix <= Math.floor(Date.now() / 1000)) {
    show(resCreate, false, "❌ Release time must be in the future");
    finishInput.focus();
    return;
  }

  let cancelAfterUnix = null;
  if (cancelLocal) {
    cancelAfterUnix = toUnixSeconds(cancelLocal);
    if (!cancelAfterUnix || cancelAfterUnix <= finishAfterUnix) {
      show(resCreate, false, "❌ Cancel time must be after the release time");
      cancelInput.focus();
      return;
    }
  }

  // Validate condition if conditional escrow is enabled
  if (useCondition && !condition) {
    show(resCreate, false, "❌ Conditional escrow enabled but no condition provided. Click 'Generate' to create one.");
    conditionInput.focus();
    return;
  }

  if (useCondition && condition) {
    // Basic hex validation
    if (!/^[0-9A-Fa-f]+$/.test(condition.replace(/\s+/g, ""))) {
      show(resCreate, false, "❌ Condition must be a valid hex string");
      conditionInput.focus();
      return;
    }
    
    if (condition.replace(/\s+/g, "").length < 32) {
      show(resCreate, false, "❌ Condition must be at least 32 hex characters (16 bytes)");
      conditionInput.focus();
      return;
    }
  }

  setButtonLoading(btnCreate, true, "Create Escrow");

  try {
    const res = await fetch(`${API}/escrow/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        payeeAddress,
        amountXrp: amount,
        finishAfterUnix,
        cancelAfterUnix,
        condition: useCondition ? condition.replace(/\s+/g, "").toUpperCase() : null,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      const errorMsg = formatError(data.error || data.txResult || "Unknown error");
      show(
        resCreate,
        false,
        `❌ Escrow creation failed\n\n${errorMsg}${data.engine_result_message ? `\n\nDetails: ${data.engine_result_message}` : ""}`
      );
      return;
    }

    // Success
    const txHash = data.txHash || "N/A";
    const txUrl = `https://testnet.xrpl.org/transactions/${txHash}`;
    let successMsg = `✅ Escrow Created Successfully!\n\n` +
      `Amount: ${amount} XRP\n` +
      `Payee: ${formatAddress(payeeAddress)}\n` +
      `Sequence: ${data.offerSequence}\n` +
      `Release Time: ${formatDateTime(finishAfterUnix)}\n` +
      `${cancelAfterUnix ? `Cancel Time: ${formatDateTime(cancelAfterUnix)}\n` : ""}`;
    
    if (useCondition && data.hasCondition) {
      successMsg += `\n🔐 Conditional Escrow: YES\n`;
      successMsg += `Condition: ${condition.substring(0, 32)}...\n`;
      if (preimageDisplay.textContent) {
        successMsg += `\n⚠️ IMPORTANT: Save this preimage!\n`;
        successMsg += `Preimage: ${preimageDisplay.textContent}\n`;
        successMsg += `You'll need it to finish this escrow.\n`;
      }
    }
    
    successMsg += `\nTransaction: ${txHash}\n\n` +
      `View on XRPL Explorer:\n${txUrl}`;
    
    show(resCreate, true, successMsg);

    // Reset form after success
    setTimeout(() => {
      payeeInput.value = "";
      amountInput.value = "";
      finishInput.value = "";
      cancelInput.value = "";
      conditionInput.value = "";
      useConditionCheckbox.checked = false;
      conditionalSection.style.display = "none";
      conditionPairDiv.style.display = "none";
      payeeInput.style.borderColor = "";
      amountInput.style.borderColor = "";
      resCreate.style.display = "none";
    }, 15000); // Keep success message longer for conditional escrows (15 seconds)

    // Refresh statistics
    loadStatistics();

  } catch (err) {
    console.error("Create escrow error:", err);
    show(resCreate, false, `❌ Network error: ${err.message || "Cannot reach backend. Is the server running?"}`);
  } finally {
    setButtonLoading(btnCreate, false);
  }
});

/* ======================
   FINISH ESCROW
====================== */
const btnFinish = document.getElementById("btnFinish");
const ownerFinishInput = document.getElementById("b_owner");
const seqFinishInput = document.getElementById("b_seq");
const resFinish = document.getElementById("resFinish");
const conditionalFinishSection = document.getElementById("b_conditionalSection");
const fulfillmentInput = document.getElementById("b_fulfillment");

// Real-time address validation
ownerFinishInput.addEventListener("blur", () => {
  const address = ownerFinishInput.value.trim();
  if (address && !isValidXRPLAddress(address)) {
    ownerFinishInput.style.borderColor = "#ef4444";
    ownerFinishInput.title = "Invalid XRPL address format";
  } else {
    ownerFinishInput.style.borderColor = "";
    ownerFinishInput.title = "";
  }
});

// Sequence validation
seqFinishInput.addEventListener("input", () => {
  const seq = seqFinishInput.value.trim();
  if (seq && (!Number.isFinite(Number(seq)) || Number(seq) <= 0)) {
    seqFinishInput.style.borderColor = "#ef4444";
    seqFinishInput.title = "Sequence must be a positive integer";
  } else {
    seqFinishInput.style.borderColor = "";
    seqFinishInput.title = "";
  }
});

btnFinish.addEventListener("click", async () => {
  const ownerAddress = ownerFinishInput.value.trim();
  const seqValue = seqFinishInput.value.trim();
  const fulfillment = fulfillmentInput.value.trim();

  // Clear previous results
  resFinish.style.display = "none";

  // Validation
  if (!ownerAddress) {
    show(resFinish, false, "❌ Please enter the escrow owner (payer) address");
    ownerFinishInput.focus();
    return;
  }

  if (!isValidXRPLAddress(ownerAddress)) {
    show(resFinish, false, `❌ Invalid XRPL address format: ${formatAddress(ownerAddress)}`);
    ownerFinishInput.focus();
    return;
  }

  if (!seqValue) {
    show(resFinish, false, "❌ Please enter the escrow sequence number");
    seqFinishInput.focus();
    return;
  }

  const offerSequence = Number(seqValue);
  if (!Number.isFinite(offerSequence) || offerSequence <= 0 || !Number.isInteger(offerSequence)) {
    show(resFinish, false, "❌ Sequence must be a positive integer");
    seqFinishInput.focus();
    return;
  }

  setButtonLoading(btnFinish, true, "Claim Deposit");

  try {
    const res = await fetch(`${API}/escrow/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ 
        ownerAddress, 
        offerSequence,
        fulfillment: fulfillment || null, // Optional fulfillment for conditional escrows
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      const errorMsg = formatError(data.error || "Unknown error");
      show(resFinish, false, `❌ Failed to finish escrow\n\n${errorMsg}`);
      return;
    }

    // Success
    const txHash = data.txHash || "N/A";
    const txUrl = `https://testnet.xrpl.org/transactions/${txHash}`;
    const successMsg = `✅ Escrow Finished Successfully!\n\n` +
      `Owner: ${formatAddress(ownerAddress)}\n` +
      `Sequence: ${offerSequence}\n` +
      `Transaction: ${txHash}\n` +
      `Result: ${data.txResult || "tesSUCCESS"}\n` +
      `Validated: ${data.validated ? "Yes" : "Pending"}\n\n` +
      `View on XRPL Explorer:\n${txUrl}`;
    
    show(resFinish, true, successMsg);

    // Reset form after success
    setTimeout(() => {
      ownerFinishInput.value = "";
      seqFinishInput.value = "";
      ownerFinishInput.style.borderColor = "";
      seqFinishInput.style.borderColor = "";
      resFinish.style.display = "none";
    }, 10000);

    // Refresh statistics
    loadStatistics();

  } catch (err) {
    console.error("Finish escrow error:", err);
    show(resFinish, false, `❌ Network error: ${err.message || "Cannot reach backend. Is the server running?"}`);
  } finally {
    setButtonLoading(btnFinish, false);
  }
});

/* ======================
   CANCEL ESCROW
====================== */
const btnCancel = document.getElementById("btnCancel");
const ownerCancelInput = document.getElementById("c_owner");
const seqCancelInput = document.getElementById("c_seq");
const resCancel = document.getElementById("resCancel");

// Real-time address validation
ownerCancelInput.addEventListener("blur", () => {
  const address = ownerCancelInput.value.trim();
  if (address && !isValidXRPLAddress(address)) {
    ownerCancelInput.style.borderColor = "#ef4444";
    ownerCancelInput.title = "Invalid XRPL address format";
  } else {
    ownerCancelInput.style.borderColor = "";
    ownerCancelInput.title = "";
  }
});

// Sequence validation
seqCancelInput.addEventListener("input", () => {
  const seq = seqCancelInput.value.trim();
  if (seq && (!Number.isFinite(Number(seq)) || Number(seq) <= 0)) {
    seqCancelInput.style.borderColor = "#ef4444";
    seqCancelInput.title = "Sequence must be a positive integer";
  } else {
    seqCancelInput.style.borderColor = "";
    seqCancelInput.title = "";
  }
});

btnCancel.addEventListener("click", async () => {
  const ownerAddress = ownerCancelInput.value.trim();
  const seqValue = seqCancelInput.value.trim();

  // Clear previous results
  resCancel.style.display = "none";

  // Validation
  if (!ownerAddress) {
    show(resCancel, false, "❌ Please enter the escrow owner (payer) address");
    ownerCancelInput.focus();
    return;
  }

  if (!isValidXRPLAddress(ownerAddress)) {
    show(resCancel, false, `❌ Invalid XRPL address format: ${formatAddress(ownerAddress)}`);
    ownerCancelInput.focus();
    return;
  }

  if (!seqValue) {
    show(resCancel, false, "❌ Please enter the escrow sequence number");
    seqCancelInput.focus();
    return;
  }

  const offerSequence = Number(seqValue);
  if (!Number.isFinite(offerSequence) || offerSequence <= 0 || !Number.isInteger(offerSequence)) {
    show(resCancel, false, "❌ Sequence must be a positive integer");
    seqCancelInput.focus();
    return;
  }

  // Confirm cancellation
  if (!confirm(`Are you sure you want to cancel escrow?\n\nOwner: ${formatAddress(ownerAddress)}\nSequence: ${offerSequence}\n\nThis will refund the escrowed XRP to the owner.`)) {
    return;
  }

  setButtonLoading(btnCancel, true, "Cancel & Refund");

  try {
    const res = await fetch(`${API}/escrow/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ownerAddress, offerSequence }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      const errorMsg = formatError(data.error || "Unknown error");
      show(resCancel, false, `❌ Failed to cancel escrow\n\n${errorMsg}`);
      return;
    }

    // Success
    const txHash = data.txHash || "N/A";
    const txUrl = `https://testnet.xrpl.org/transactions/${txHash}`;
    const successMsg = `✅ Escrow Cancelled Successfully!\n\n` +
      `Owner: ${formatAddress(ownerAddress)}\n` +
      `Sequence: ${offerSequence}\n` +
      `Transaction: ${txHash}\n` +
      `Result: ${data.txResult || "tesSUCCESS"}\n` +
      `Validated: ${data.validated ? "Yes" : "Pending"}\n\n` +
      `Funds have been refunded to the owner.\n\n` +
      `View on XRPL Explorer:\n${txUrl}`;
    
    show(resCancel, true, successMsg);

    // Reset form after success
    setTimeout(() => {
      ownerCancelInput.value = "";
      seqCancelInput.value = "";
      ownerCancelInput.style.borderColor = "";
      seqCancelInput.style.borderColor = "";
      resCancel.style.display = "none";
    }, 10000);

    // Refresh statistics
    loadStatistics();

  } catch (err) {
    console.error("Cancel escrow error:", err);
    show(resCancel, false, `❌ Network error: ${err.message || "Cannot reach backend. Is the server running?"}`);
  } finally {
    setButtonLoading(btnCancel, false);
  }
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

// Set minimum datetime for deadline
fDeadlineInput.min = new Date().toISOString().slice(0, 16);

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
  if (!deadlineUnix || deadlineUnix <= Math.floor(Date.now() / 1000)) {
    show(resFreelancerCreate, false, "❌ Deadline must be in the future");
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
