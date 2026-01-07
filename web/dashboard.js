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
   QUALITY ASSURANCE ESCROW WORKFLOW
====================== */
const btnQACreate = document.getElementById("btnQACreate");
const qaProviderInput = document.getElementById("qa_provider");
const qaAmountInput = document.getElementById("qa_amount");
const qaDeadlineInput = document.getElementById("qa_deadline");
const qaChecklist = document.getElementById("qa_checklist");
const btnAddRequirement = document.getElementById("btnAddRequirement");
const resQACreate = document.getElementById("resQACreate");
const qaApprovalSection = document.getElementById("qa_approvalSection");
const qaPreimageInput = document.getElementById("qa_preimage");

const btnQALoadRequirements = document.getElementById("btnQALoadRequirements");
const btnQAApprove = document.getElementById("btnQAApprove");
const btnQARefund = document.getElementById("btnQARefund");
const qaApproveOwnerInput = document.getElementById("qa_approve_owner");
const qaApproveSeqInput = document.getElementById("qa_approve_seq");
const qaVerifyChecklist = document.getElementById("qa_verify_checklist");
const resQAApprove = document.getElementById("resQAApprove");

// Service Provider Claim
const btnQAClaim = document.getElementById("btnQAClaim");
const qaClaimOwnerInput = document.getElementById("qa_claim_owner");
const qaClaimSeqInput = document.getElementById("qa_claim_seq");
const qaClaimPreimageInput = document.getElementById("qa_claim_preimage");
const resQAClaim = document.getElementById("resQAClaim");

// Store QA escrow data (sequence -> requirements)
const qaEscrowData = {};

// Set minimum datetime for deadline (5 minutes from now) - Freelancer escrow
const minDeadline = new Date(Date.now() + 5 * 60 * 1000);
fDeadlineInput.min = minDeadline.toISOString().slice(0, 16);

// Set default deadline to 1 hour from now - Freelancer escrow
const defaultDeadline = new Date(Date.now() + 60 * 60 * 1000);
fDeadlineInput.value = defaultDeadline.toISOString().slice(0, 16);

// Set minimum datetime for deadline - QA escrow
qaDeadlineInput.min = new Date().toISOString().slice(0, 16);

// Address validation - Freelancer escrow
freelancerInput.addEventListener("blur", () => {
  const address = freelancerInput.value.trim();
  if (address && !isValidXRPLAddress(address)) {
    freelancerInput.style.borderColor = "#ef4444";
  } else {
    freelancerInput.style.borderColor = "";
  }
});

// Add requirement input - QA escrow
let requirementCount = 1;
btnAddRequirement.addEventListener("click", () => {
  requirementCount++;
  const item = document.createElement("div");
  item.className = "qa-checklist-item";
  item.style.marginBottom = "8px";
  item.innerHTML = `
    <div style="display: flex; gap: 8px; align-items: center;">
      <input type="text" placeholder="Requirement ${requirementCount}" 
             class="qa-requirement-input" 
             style="flex: 1; padding: 8px; border: none; border-radius: 4px; background: rgba(255,255,255,0.9); color: #1a202c;" />
      <button type="button" class="qa-remove-requirement" 
              style="padding: 8px 12px; background: rgba(239,68,68,0.8); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
        ✕
      </button>
    </div>
  `;
  qaChecklist.appendChild(item);
  
  // Add remove functionality
  item.querySelector(".qa-remove-requirement").addEventListener("click", () => {
    item.remove();
  });
});

// Address validation
qaProviderInput.addEventListener("blur", () => {
  const address = qaProviderInput.value.trim();
  if (address && !isValidXRPLAddress(address)) {
    qaProviderInput.style.borderColor = "#ef4444";
  } else {
    qaProviderInput.style.borderColor = "";
  }
});

// Create QA Escrow
btnQACreate.addEventListener("click", async () => {
  const providerAddress = qaProviderInput.value.trim();
  const amountXrp = qaAmountInput.value.trim();
  const deadlineLocal = qaDeadlineInput.value;
  
  // Get requirements
  const requirementInputs = qaChecklist.querySelectorAll(".qa-requirement-input");
  const requirements = Array.from(requirementInputs)
    .map(input => input.value.trim())
    .filter(req => req.length > 0);
  
  resQACreate.style.display = "none";
  
  // Validation
  if (!providerAddress) {
    show(resQACreate, false, "❌ Please enter service provider address");
    qaProviderInput.focus();
    return;
  }
  
  if (!isValidXRPLAddress(providerAddress)) {
    show(resQACreate, false, `❌ Invalid XRPL address: ${formatAddress(providerAddress)}`);
    qaProviderInput.focus();
    return;
  }
  
  if (!amountXrp) {
    show(resQACreate, false, "❌ Please enter payment amount");
    qaAmountInput.focus();
    return;
  }
  
  const amount = parseFloat(amountXrp);
  if (!Number.isFinite(amount) || amount < 0.000001) {
    show(resQACreate, false, "❌ Amount must be at least 0.000001 XRP");
    qaAmountInput.focus();
    return;
  }
  
  if (!deadlineLocal) {
    show(resQACreate, false, "❌ Please select a deadline");
    qaDeadlineInput.focus();
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
  
  // Requirements are optional - no validation needed
  
  setButtonLoading(btnQACreate, true, "⏳ Creating QA Escrow...");
  
  try {
    const res = await fetch(`${API}/escrow/qa/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        providerAddress,
        amountXrp: amount,
        deadlineUnix,
        requirements, // Send requirements to store
      }),
    });
    
    const data = await res.json();
    
    if (!res.ok || !data.ok) {
      show(resQACreate, false, `❌ Failed to create QA escrow\n${data.error || "Unknown error"}`);
      return;
    }
    
    // Store requirements with sequence for later retrieval
    qaEscrowData[data.offerSequence] = {
      requirements,
      preimage: data.preimage,
      condition: data.condition,
    };
    
    // Show success
    const txHash = data.txHash || "N/A";
    const txUrl = `https://testnet.xrpl.org/transactions/${txHash}`;
    const successMsg = `✅ QA Escrow Created!\n\n` +
      `Amount: ${amount} XRP\n` +
      `Provider: ${formatAddress(providerAddress)}\n` +
      `Sequence: ${data.offerSequence}\n` +
      `Deadline: ${formatDateTime(deadlineUnix)}\n` +
      `Requirements: ${requirements.length} item(s)\n\n` +
      `Transaction: ${txHash}\n${txUrl}`;
    
    show(resQACreate, true, successMsg);
    
    // Reset form
    setTimeout(() => {
      qaProviderInput.value = "";
      qaAmountInput.value = "";
      qaDeadlineInput.value = "";
      qaChecklist.innerHTML = `
        <div class="qa-checklist-item" style="margin-bottom: 8px;">
          <input type="text" placeholder="Requirement 1" 
                 class="qa-requirement-input" 
                 style="width: 100%; padding: 8px; border: none; border-radius: 4px; background: rgba(255,255,255,0.9); color: #1a202c;" />
        </div>
      `;
      requirementCount = 1;
      resQACreate.style.display = "none";
    }, 20000);
    
    loadStatistics();
    loadXRPWalletBalance();
    
  } catch (err) {
    console.error("Create QA escrow error:", err);
    show(resQACreate, false, `❌ Network error: ${err.message || "Cannot reach backend"}`);
  } finally {
    setButtonLoading(btnQACreate, false);
  }
});

// Load requirements for verification
btnQALoadRequirements.addEventListener("click", async () => {
  const seq = qaApproveSeqInput.value.trim();
  
  if (!seq) {
    alert("Please enter escrow sequence number");
    return;
  }
  
  // Check if we have it stored locally
  if (qaEscrowData[seq]) {
    const data = qaEscrowData[seq];
    displayRequirementsForVerification(data.requirements);
    return;
  }
  
  // Try to fetch from server
  try {
    const res = await fetch(`${API}/escrow/qa/requirements/${seq}`, {
      credentials: "include",
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.requirements !== undefined) {
        qaEscrowData[seq] = data;
        displayRequirementsForVerification(
          data.requirements || [], 
          data.verifiedRequirements || {},
          data.aiVerificationStatus || "pending",
          data.aiSummary || null
        );
      } else {
        qaVerifyChecklist.innerHTML = `<p style="color: rgba(255,255,255,0.7);">Requirements not found for this escrow.</p>`;
      }
    } else {
      qaVerifyChecklist.innerHTML = `<p style="color: rgba(255,255,255,0.7);">Could not load requirements. They may not be stored.</p>`;
    }
  } catch (err) {
    qaVerifyChecklist.innerHTML = `<p style="color: rgba(255,255,255,0.7);">Error loading requirements.</p>`;
  }
});

function displayRequirementsForVerification(requirements, verifiedRequirements = {}, aiStatus = "pending", aiSummary = null) {
  if (!requirements || requirements.length === 0) {
    qaVerifyChecklist.innerHTML = `<p style="color: rgba(255,255,255,0.7); font-size: 12px;">No requirements for this escrow.</p>`;
    return;
  }
  
  let statusBadge = "";
  if (aiStatus === "in_progress") {
    statusBadge = `<div style="padding: 8px; background: rgba(59,130,246,0.3); border-radius: 4px; margin-bottom: 12px; text-align: center;">
      <span style="color: #3b82f6;">🤖 AI Verification in Progress...</span>
    </div>`;
  } else if (aiStatus === "completed") {
    const allVerified = Object.values(verifiedRequirements).every(v => v.verified === true);
    statusBadge = `<div style="padding: 8px; background: ${allVerified ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}; border-radius: 4px; margin-bottom: 12px;">
      <div style="color: ${allVerified ? '#10b981' : '#f59e0b'}; font-weight: 600; margin-bottom: 4px;">🤖 AI Verification Complete</div>
      ${aiSummary ? `<div style="font-size: 11px; color: rgba(255,255,255,0.8);">${aiSummary}</div>` : ''}
    </div>`;
  } else if (aiStatus === "error") {
    statusBadge = `<div style="padding: 8px; background: rgba(239,68,68,0.3); border-radius: 4px; margin-bottom: 12px; text-align: center;">
      <span style="color: #ef4444;">❌ AI Verification Error</span>
    </div>`;
  }
  
  const requirementsHtml = requirements.map((req, idx) => {
    const verification = verifiedRequirements[idx];
    const isVerified = verification?.verified === true;
    const confidence = verification?.confidence || 0;
    const reason = verification?.reason || "";
    
    return `
      <div style="margin-bottom: 12px; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 4px; ${isVerified ? 'border-left: 3px solid #10b981;' : 'border-left: 3px solid #f59e0b;'}">
        <div style="display: flex; align-items: start; gap: 8px; margin-bottom: 4px;">
          <span style="font-size: 18px;">${isVerified ? '✅' : '⏳'}</span>
          <div style="flex: 1;">
            <div style="color: rgba(255,255,255,0.9); font-size: 13px; font-weight: 500; margin-bottom: 4px;">${req}</div>
            ${verification ? `
              <div style="font-size: 11px; color: rgba(255,255,255,0.7); margin-top: 4px;">
                ${reason}
              </div>
              <div style="font-size: 10px; color: rgba(255,255,255,0.6); margin-top: 2px;">
                Confidence: ${(confidence * 100).toFixed(1)}%
              </div>
            ` : '<div style="font-size: 11px; color: rgba(255,255,255,0.6);">AI verification pending...</div>'}
          </div>
        </div>
      </div>
    `;
  }).join("");
  
  qaVerifyChecklist.innerHTML = statusBadge + requirementsHtml;
}

// Approve and release payment
// Trigger AI Verification
btnQATriggerAI.addEventListener("click", async () => {
  const ownerAddress = qaApproveOwnerInput.value.trim();
  const seqValue = qaApproveSeqInput.value.trim();
  
  resQAApprove.style.display = "none";
  
  if (!ownerAddress || !isValidXRPLAddress(ownerAddress)) {
    show(resQAApprove, false, "❌ Invalid owner address");
    return;
  }
  
  if (!seqValue) {
    show(resQAApprove, false, "❌ Invalid sequence number");
    return;
  }
  
  if (!confirm(`Re-run AI verification?\n\nThis will trigger the AI checker to verify all requirements again.\n\nSequence: ${seqValue}`)) {
    return;
  }
  
  setButtonLoading(btnQATriggerAI, true, "⏳ Running AI Verification...");
  
  try {
    const res = await fetch(`${API}/escrow/qa/ai-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        sequence: Number(seqValue),
      }),
    });
    
    const data = await res.json();
    
    if (!res.ok || !data.ok) {
      show(resQAApprove, false, `❌ AI verification failed\n${data.error || "Unknown error"}`);
      return;
    }
    
    show(resQAApprove, true, 
      `🤖 AI Verification Complete!\n\n` +
      `${data.summary}\n\n` +
      `Verified: ${data.verifiedCount}/${data.totalCount} requirements\n` +
      `Average Confidence: ${(data.avgConfidence * 100).toFixed(1)}%\n\n` +
      `${data.allVerified ? "✅ All requirements verified! Service provider can now claim payment." : "⚠️ Some requirements need attention."}`
    );
    
    // Reload requirements to show updated status
    setTimeout(() => {
      btnQALoadRequirements.click();
    }, 2000);

  } catch (err) {
    console.error("AI verification error:", err);
    show(resQAApprove, false, `❌ Network error: ${err.message || "Cannot reach backend"}`);
  } finally {
    setButtonLoading(btnQATriggerAI, false);
  }
});

// Old verify function removed - AI handles verification automatically
  const ownerAddress = qaApproveOwnerInput.value.trim();
  const seqValue = qaApproveSeqInput.value.trim();
  
  resQAApprove.style.display = "none";
  
  if (!ownerAddress || !isValidXRPLAddress(ownerAddress)) {
    show(resQAApprove, false, "❌ Invalid owner address");
    return;
  }
  
  if (!seqValue) {
    show(resQAApprove, false, "❌ Invalid sequence number");
    return;
  }
  
  if (!confirm(`Re-run AI verification?\n\nThis will trigger the AI checker to verify all requirements again.\n\nSequence: ${seqValue}`)) {
    return;
  }

  setButtonLoading(btnQATriggerAI, true, "⏳ Running AI Verification...");

  try {
    const res = await fetch(`${API}/escrow/qa/ai-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        sequence: Number(seqValue),
      }),
    });
    
    const data = await res.json();
    
    if (!res.ok || !data.ok) {
      show(resQAApprove, false, `❌ AI verification failed\n${data.error || "Unknown error"}`);
      return;
    }
    
    show(resQAApprove, true, 
      `🤖 AI Verification Complete!\n\n` +
      `${data.summary}\n\n` +
      `Verified: ${data.verifiedCount}/${data.totalCount} requirements\n` +
      `Average Confidence: ${(data.avgConfidence * 100).toFixed(1)}%\n\n` +
      `${data.allVerified ? "✅ All requirements verified! Service provider can now claim payment." : "⚠️ Some requirements need attention."}`
    );
    
    // Reload requirements to show updated status
    setTimeout(() => {
      btnQALoadRequirements.click();
    }, 2000);

  } catch (err) {
    console.error("AI verification error:", err);
    show(resQAApprove, false, `❌ Network error: ${err.message || "Cannot reach backend"}`);
  } finally {
    setButtonLoading(btnQATriggerAI, false);
  }
});

// Service Provider: Claim Payment
btnQAClaim.addEventListener("click", async () => {
  const ownerAddress = qaClaimOwnerInput.value.trim();
  const seqValue = qaClaimSeqInput.value.trim();
  
  resQAClaim.style.display = "none";
  
  if (!ownerAddress || !isValidXRPLAddress(ownerAddress)) {
    show(resQAClaim, false, "❌ Invalid owner address");
    return;
  }
  
  if (!seqValue || !Number.isFinite(Number(seqValue))) {
    show(resQAClaim, false, "❌ Invalid sequence number");
    return;
  }
  
  if (!confirm(`Claim payment?\n\nThis will finish the escrow and send the payment to your wallet.\n\nYou can only claim BEFORE the deadline passes.`)) {
    return;
  }
  
  setButtonLoading(btnQAClaim, true, "⏳ Claiming Payment...");
  
  try {
    // Use the new QA claim endpoint (automatically handles preimage if requirements exist)
    const res = await fetch(`${API}/escrow/qa/claim`, {
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
      show(resQAClaim, false, `❌ Failed to claim payment\n${data.error || "Unknown error"}\n\nNote: You can only claim before the deadline passes. If escrow has requirements, all must be verified by client first.`);
      return;
    }
    
    const txHash = data.txHash || "N/A";
    const txUrl = `https://testnet.xrpl.org/transactions/${txHash}`;
    show(resQAClaim, true, 
      `✅ Payment Claimed Successfully!\n\n` +
      `The payment has been released to your wallet.\n\n` +
      `Transaction: ${txHash}\n${txUrl}`
    );
    
    // Clear form
    qaClaimOwnerInput.value = "";
    qaClaimSeqInput.value = "";
    loadStatistics();
    loadXRPWalletBalance();
    
  } catch (err) {
    console.error("Claim payment error:", err);
    show(resQAClaim, false, `❌ Network error: ${err.message || "Cannot reach backend"}`);
  } finally {
    setButtonLoading(btnQAClaim, false);
  }
});

// Refund after deadline
btnQARefund.addEventListener("click", async () => {
  const ownerAddress = qaApproveOwnerInput.value.trim();
  const seqValue = qaApproveSeqInput.value.trim();
  
  resQAApprove.style.display = "none";
  
  if (!ownerAddress || !isValidXRPLAddress(ownerAddress)) {
    show(resQAApprove, false, "❌ Invalid owner address");
    return;
  }
  
  if (!seqValue) {
    show(resQAApprove, false, "❌ Invalid sequence number");
    return;
  }
  
  if (!confirm(`Refund payment?\n\nThis will cancel the escrow and return funds to you.\n\nOnly works after the deadline has passed.`)) {
    return;
  }
  
  setButtonLoading(btnQARefund, true, "⏳ Processing Refund...");
  
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
      show(resQAApprove, false, `❌ Refund failed\n${data.error || "Unknown error"}\n\nNote: Refund only works after the deadline has passed.`);
      return;
    }
    
    const txHash = data.txHash || "N/A";
    const txUrl = `https://testnet.xrpl.org/transactions/${txHash}`;
    show(resQAApprove, true, 
      `✅ Refund Successful!\n\n` +
      `Funds have been returned to your account.\n\n` +
      `Transaction: ${txHash}\n${txUrl}`
    );
    
    loadStatistics();
    loadXRPWalletBalance();
    
  } catch (err) {
    console.error("Refund QA escrow error:", err);
    show(resQAApprove, false, `❌ Network error: ${err.message || "Cannot reach backend"}`);
  } finally {
    setButtonLoading(btnQARefund, false);
  }
});
