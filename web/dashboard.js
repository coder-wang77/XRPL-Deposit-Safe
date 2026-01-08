// web/dashboard.js

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
      document.getElementById("completedCount").textContent = Math.round(data.completed || 0);
      document.getElementById("pendingCount").textContent = Math.round(data.pending || 0);
    }
  } catch (err) {
    console.error("Failed to load statistics:", err);
  }
}

// XRP wallet balance removed from UI (XLUSD-only experience)

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
    withdrawal: "💸",
    transfer_in: "⬇️",
    transfer_out: "⬆️",
  };
  return icons[type] || "📝";
}

function getActivityTitle(tx) {
  if (typeof tx === 'object' && tx.type) {
    if (tx.type === 'purchase') {
      return `XLUSD Purchased: ${tx.amount} XLUSD`;
    } else if (tx.type === 'withdrawal') {
      return `XLUSD Withdrawn: ${tx.amount} XLUSD`;
    } else if (tx.type === 'transfer_in') {
      return `Transfer Received: ${tx.amount} ${tx.currency || ""}`.trim();
    } else if (tx.type === 'transfer_out') {
      return `Transfer Sent: ${tx.amount} ${tx.currency || ""}`.trim();
    }
  }
  
  // Fallback for old format
  const type = typeof tx === 'string' ? tx : tx?.type;
  const titles = { 
    create: "Escrow Created", 
    finish: "Escrow Finished", 
    cancel: "Escrow Cancelled", 
    purchase: "XLUSD Purchased",
    withdrawal: "XLUSD Withdrawn",
    transfer_in: "Transfer Received",
    transfer_out: "Transfer Sent",
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
      const walletEl = document.getElementById("xlusdWalletBalance");
      if (walletEl) walletEl.textContent = "Error";
      return;
    }

    const data = await res.json();
    if (data.ok) {
      balanceEl.textContent = `${data.balance.toFixed(2)} ${data.currency}`;
      const walletEl = document.getElementById("xlusdWalletBalance");
      if (walletEl) walletEl.textContent = `${data.balance.toFixed(2)} ${data.currency}`;
    } else {
      balanceEl.textContent = "0.00 XLUSD";
      const walletEl = document.getElementById("xlusdWalletBalance");
      if (walletEl) walletEl.textContent = "0.00 XLUSD";
    }
  } catch (e) {
    balanceEl.textContent = "Error";
    const walletEl = document.getElementById("xlusdWalletBalance");
    if (walletEl) walletEl.textContent = "Error";
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

// Client refund is time-based only (no AI status UI)
const btnQARefund = document.getElementById("btnQARefund");
const qaApproveOwnerInput = document.getElementById("qa_approve_owner");
const qaApproveSeqInput = document.getElementById("qa_approve_seq");
const resQAApprove = document.getElementById("resQAApprove");

// Service Provider Claim
const btnQAClaim = document.getElementById("btnQAClaim");
const qaClaimOwnerInput = document.getElementById("qa_claim_owner");
const qaClaimSeqInput = document.getElementById("qa_claim_seq");
const qaClaimPreimageInput = document.getElementById("qa_claim_preimage");
const resQAClaim = document.getElementById("resQAClaim");
const qaProofText = document.getElementById("qa_proof_text");
const qaProofLinksWrap = document.getElementById("qa_proof_links");
const btnQAAddProofLink = document.getElementById("btnQAAddProofLink");

// Store QA escrow data (sequence -> requirements)
const qaEscrowData = {};

// NOTE: Dashboard HTML no longer includes the freelancer escrow section, but some older
// dashboard code still referenced it. Guard these so the page (and XLUSD) still loads.
const freelancerInput = document.getElementById("freelancer");
const fDeadlineInput = document.getElementById("f_deadline");

if (fDeadlineInput) {
  // Set minimum datetime for deadline (5 minutes from now) - Freelancer escrow
  const minDeadline = new Date(Date.now() + 5 * 60 * 1000);
  fDeadlineInput.min = minDeadline.toISOString().slice(0, 16);

  // Set default deadline to 1 hour from now - Freelancer escrow
  const defaultDeadline = new Date(Date.now() + 60 * 60 * 1000);
  fDeadlineInput.value = defaultDeadline.toISOString().slice(0, 16);
}

// Set minimum datetime for deadline - QA escrow
qaDeadlineInput.min = new Date().toISOString().slice(0, 16);

// Address validation - Freelancer escrow
if (freelancerInput) {
  freelancerInput.addEventListener("blur", () => {
    const address = freelancerInput.value.trim();
    if (address && !isValidXRPLAddress(address)) {
      freelancerInput.style.borderColor = "#ef4444";
    } else {
      freelancerInput.style.borderColor = "";
    }
  });
}

// Add requirement input - QA escrow
let requirementCount = 0;

function createEvidenceLinkRow(value = "") {
  const row = document.createElement("div");
  row.className = "qa-evidence-row";
  row.style.display = "flex";
  row.style.gap = "8px";
  row.style.alignItems = "center";
  row.style.marginTop = "6px";

  row.innerHTML = `
    <input type="url"
           class="qa-evidence-link"
           placeholder="Evidence link (photo/PDF URL) – optional"
           value="${value.replace(/"/g, "&quot;")}"
           style="flex: 1; padding: 8px; border: none; border-radius: 6px; background: rgba(255,255,255,0.9); color: #1a202c; font-size: 12px;" />
    <button type="button"
            class="qa-remove-evidence"
            style="padding: 8px 10px; background: rgba(239,68,68,0.8); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;">
      ✕
    </button>
  `;

  row.querySelector(".qa-remove-evidence")?.addEventListener("click", () => row.remove());
  return row;
}

function createRequirementItem() {
  requirementCount += 1;

  const item = document.createElement("div");
  item.className = "qa-checklist-item";
  item.style.marginBottom = "12px";
  item.style.padding = "12px";
  item.style.borderRadius = "10px";
  item.style.background = "rgba(255,255,255,0.12)";
  item.style.border = "1px solid rgba(255,255,255,0.18)";

  item.innerHTML = `
    <div style="display:flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px;">
      <div style="font-weight: 700; color: rgba(255,255,255,0.95); font-size: 12px;">
        Requirement ${requirementCount}
      </div>
      <button type="button"
              class="qa-remove-requirement"
              style="padding: 6px 10px; background: rgba(239,68,68,0.85); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 12px;">
        Remove
      </button>
    </div>

    <textarea class="qa-requirement-text"
              placeholder="Describe what must be delivered (acceptance criteria, scope, etc.)"
              rows="3"
              style="width: 100%; padding: 10px; border: none; border-radius: 8px; background: rgba(255,255,255,0.95); color: #1a202c; font-size: 13px; resize: vertical; line-height: 1.4;"></textarea>

    <div class="qa-evidence" style="margin-top: 10px;">
      <div style="display:flex; justify-content: space-between; align-items:center; gap: 12px;">
        <div style="font-size: 11px; color: rgba(255,255,255,0.85); font-weight: 600;">
          Example photos / PDF (links)
        </div>
        <button type="button"
                class="qa-add-evidence"
                style="padding: 6px 10px; background: rgba(255,255,255,0.2); color: white; border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; cursor: pointer; font-size: 12px;">
          + Add link
        </button>
      </div>
      <div class="qa-evidence-list"></div>
      <div style="margin-top: 6px; font-size: 10px; color: rgba(255,255,255,0.7);">
        Tip: paste a link to a photo (e.g. hosted image) or PDF (e.g. Drive/Dropbox link).
      </div>
    </div>
  `;

  item.querySelector(".qa-remove-requirement")?.addEventListener("click", () => item.remove());

  const evidenceList = item.querySelector(".qa-evidence-list");
  const addEvidenceBtn = item.querySelector(".qa-add-evidence");
  addEvidenceBtn?.addEventListener("click", () => {
    evidenceList?.appendChild(createEvidenceLinkRow());
  });

  // Start with one evidence link row (optional)
  evidenceList?.appendChild(createEvidenceLinkRow());

  return item;
}

function ensureChecklistInitialized() {
  if (!qaChecklist) return;
  if (qaChecklist.querySelector(".qa-checklist-item")) return;
  qaChecklist.innerHTML = "";
  requirementCount = 0;
  qaChecklist.appendChild(createRequirementItem());
}

function collectRequirementsFromUI() {
  const items = Array.from(qaChecklist?.querySelectorAll(".qa-checklist-item") || []);

  const requirements = items
    .map((item) => {
      const text = item.querySelector(".qa-requirement-text")?.value?.trim() || "";
      const evidenceLinks = Array.from(item.querySelectorAll(".qa-evidence-link"))
        .map((i) => i.value?.trim())
        .filter((v) => v && v.length > 0);

      return { text, evidenceLinks };
    })
    .filter((r) => r.text.length > 0 || (r.evidenceLinks && r.evidenceLinks.length > 0));

  return requirements;
}

ensureChecklistInitialized();

btnAddRequirement?.addEventListener("click", () => {
  ensureChecklistInitialized();
  qaChecklist?.appendChild(createRequirementItem());
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
  const amountXlusd = qaAmountInput.value.trim();
  const deadlineLocal = qaDeadlineInput.value;
  
  // Get requirements
  const requirements = collectRequirementsFromUI();
  
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
  
  if (!amountXlusd) {
    show(resQACreate, false, "❌ Please enter payment amount");
    qaAmountInput.focus();
    return;
  }
  
  const amount = parseFloat(amountXlusd);
  if (!Number.isFinite(amount) || amount <= 0) {
    show(resQACreate, false, "❌ Amount must be greater than 0 XLUSD");
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
    show(resQACreate, false, "❌ Invalid deadline format");
    qaDeadlineInput.focus();
    return;
  }
  
  if (deadlineUnix <= minDeadlineUnix) {
    const minDate = new Date(minDeadlineUnix * 1000).toLocaleString();
    show(resQACreate, false, `❌ Deadline must be at least 5 minutes in the future.\nMinimum: ${minDate}`);
    qaDeadlineInput.focus();
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
        amountXlusd: amount,
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
      `Amount: ${amount} XLUSD\n` +
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
      if (qaChecklist) {
        qaChecklist.innerHTML = "";
      }
      requirementCount = 0;
      ensureChecklistInitialized();
      resQACreate.style.display = "none";
    }, 20000);
    
    loadStatistics();
    
  } catch (err) {
    console.error("Create QA escrow error:", err);
    show(resQACreate, false, `❌ Network error: ${err.message || "Cannot reach backend"}`);
  } finally {
    setButtonLoading(btnQACreate, false);
  }
});

// Client refund is time-based only (AI proof verification is provider-side)

// Service Provider: Claim Payment
btnQAClaim.addEventListener("click", async () => {
  const ownerAddress = qaClaimOwnerInput.value.trim(); // kept for display consistency
  const seqValue = qaClaimSeqInput.value.trim();
  const proofText = qaProofText?.value?.trim() || "";
  const proofLinks = Array.from(qaProofLinksWrap?.querySelectorAll(".qa-proof-link") || [])
    .map((i) => i.value.trim())
    .filter((v) => v.length > 0);
  
  resQAClaim.style.display = "none";
  
  if (!ownerAddress || !isValidXRPLAddress(ownerAddress)) {
    show(resQAClaim, false, "❌ Invalid owner address");
    return;
  }
  
  if (!seqValue || !Number.isFinite(Number(seqValue))) {
    show(resQAClaim, false, "❌ Invalid sequence number");
    return;
  }

  if (proofText.length < 10 && proofLinks.length === 0) {
    show(resQAClaim, false, "❌ Please submit proof: add a description (min 10 chars) and/or at least one evidence link.");
    return;
  }
  
  if (!confirm(`Submit proof & claim payment?\n\nThe platform will:\n1) Run AI verification against the requirements\n2) If verified, unlock the escrow and credit you in XLUSD\n\nContinue?`)) {
    return;
  }
  
  setButtonLoading(btnQAClaim, true, "⏳ Verifying & Claiming...");
  
  try {
    // 1) Submit proof -> AI verify -> finish + convert (if verified)
    const res = await fetch(`${API}/escrow/qa/proof/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        sequence: Number(seqValue),
        proofText,
        proofLinks,
      }),
    });
    
    const data = await res.json();
    
    if (!res.ok || !data.ok) {
      show(resQAClaim, false, `❌ Proof submission failed\n${data.error || "Unknown error"}`);
      return;
    }

    const allVerified = data.allVerified === true;
    if (!allVerified) {
      show(
        resQAClaim,
        false,
        `⚠️ Proof received, but AI did not verify all requirements yet.\n\n${data.ai?.summary || ""}\n\nAdd more detail/links and try again.`
      );
      return;
    }

    if (!data.finish?.ok) {
      show(resQAClaim, false, `❌ AI verified, but escrow unlock failed.\n${data.finish?.txResult || data.finish?.error || "Unknown error"}`);
      return;
    }

    const txHash = data.finish.txHash || "N/A";
    const txUrl = `https://testnet.xrpl.org/transactions/${txHash}`;
    const delivered = data.conversion?.deliveredXlusd;
    const conversionNote =
      data.conversion?.ok
        ? `\n✅ Auto-converted to XLUSD${delivered !== null && delivered !== undefined ? `: ${Number(delivered).toFixed(2)} XLUSD` : ""}`
        : data.conversion?.skipped
          ? `\n⚠️ Conversion skipped: ${data.conversion.reason || "Unknown reason"}`
          : data.conversion?.error
            ? `\n⚠️ Conversion failed: ${data.conversion.error}`
            : "";

    show(
      resQAClaim,
      true,
      `✅ Payment unlocked!\n\nTransaction: ${txHash}\n${txUrl}${conversionNote}`
    );
    
    // Clear form
    if (qaProofText) qaProofText.value = "";
    Array.from(qaProofLinksWrap?.querySelectorAll(".qa-proof-link") || []).forEach((i, idx) => {
      if (idx === 0) i.value = "";
      else i.remove();
    });
    loadStatistics();
    
  } catch (err) {
    console.error("Claim payment error:", err);
    show(resQAClaim, false, `❌ Network error: ${err.message || "Cannot reach backend"}`);
  } finally {
    setButtonLoading(btnQAClaim, false);
  }
});

btnQAAddProofLink?.addEventListener("click", () => {
  if (!qaProofLinksWrap) return;
  const input = document.createElement("input");
  input.className = "qa-proof-link";
  input.type = "url";
  input.placeholder = "https://... (optional)";
  input.style.padding = "10px";
  input.style.border = "none";
  input.style.borderRadius = "8px";
  input.style.background = "rgba(255,255,255,0.95)";
  input.style.color = "#1a202c";
  input.style.fontSize = "13px";
  qaProofLinksWrap.appendChild(input);
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
    
  } catch (err) {
    console.error("Refund QA escrow error:", err);
    show(resQAApprove, false, `❌ Network error: ${err.message || "Cannot reach backend"}`);
  } finally {
    setButtonLoading(btnQARefund, false);
  }
});
