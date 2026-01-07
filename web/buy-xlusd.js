// web/buy-xlusd.js

const API = "http://127.0.0.1:3001";

const amountInput = document.getElementById("amount");
const totalAmountEl = document.getElementById("totalAmount");
const priceInfoEl = document.getElementById("priceInfo");
const tabButtons = document.querySelectorAll(".tab-btn");
const paymentForms = document.querySelectorAll(".payment-form");
const processBtn = document.getElementById("btnProcessPayment");
const paymentResult = document.getElementById("paymentResult");

let currentPaymentMethod = "creditcard";
const pricePerXLUSD = 1.00; // $1 USD per XLUSD

// Tab switching
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const method = btn.dataset.method;
    currentPaymentMethod = method;

    // Update active tab
    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // Update active form
    paymentForms.forEach((f) => f.classList.remove("active"));
    document.getElementById(`${method}-form`).classList.add("active");

    // Update PayNow details if needed
    if (method === "paynow") {
      updatePayNowDetails();
    }
  });
});

// Calculate total when amount changes
amountInput.addEventListener("input", () => {
  const amount = parseFloat(amountInput.value) || 0;
  const total = amount * pricePerXLUSD;
  totalAmountEl.textContent = `$${total.toFixed(2)} USD`;
  
  // Enable/disable process button
  processBtn.disabled = amount <= 0;

  // Update PayNow details if on PayNow tab
  if (currentPaymentMethod === "paynow") {
    updatePayNowDetails();
  }
});

// Format card number input
document.getElementById("cardNumber")?.addEventListener("input", (e) => {
  let value = e.target.value.replace(/\s/g, "");
  let formatted = value.match(/.{1,4}/g)?.join(" ") || value;
  e.target.value = formatted;
});

// Format expiry input
document.getElementById("expiry")?.addEventListener("input", (e) => {
  let value = e.target.value.replace(/\D/g, "");
  if (value.length >= 2) {
    value = value.substring(0, 2) + "/" + value.substring(2, 4);
  }
  e.target.value = value;
});

// Update PayNow details
function updatePayNowDetails() {
  const amount = parseFloat(amountInput.value) || 0;
  const total = amount * pricePerXLUSD;
  const ref = `XLUSD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  document.getElementById("paynowAmount").textContent = `$${total.toFixed(2)}`;
  document.getElementById("paynowRef").textContent = ref;
  
  // Generate QR code (simplified - in production, use a QR library)
  const paynowQR = document.getElementById("paynowQR");
  paynowQR.innerHTML = `
    <div class="qr-placeholder">
      <p>PayNow QR Code</p>
      <p class="muted">UEN: TXXLLC1234</p>
      <p class="muted">Ref: ${ref}</p>
      <p class="muted">Amount: $${total.toFixed(2)}</p>
      <p class="hint">In production, this would show a scannable QR code</p>
    </div>
  `;
}

// Process payment
processBtn.addEventListener("click", async () => {
  const amount = parseFloat(amountInput.value);
  
  if (!amount || amount <= 0) {
    showResult(false, "Please enter a valid amount");
    return;
  }

  processBtn.disabled = true;
  processBtn.textContent = "Processing...";
  showResult(null, "");

  try {
    let paymentData = {
      amountXlusd: amount,
      paymentMethod: currentPaymentMethod,
    };

    if (currentPaymentMethod === "creditcard") {
      const cardNumber = document.getElementById("cardNumber").value.replace(/\s/g, "").trim();
      const expiry = document.getElementById("expiry").value.trim();
      const cvv = document.getElementById("cvv").value.trim();
      const cardName = document.getElementById("cardName").value.trim();
      const billingEmail = document.getElementById("billingEmail").value.trim();

      // Card details are optional in test mode
      // If any card field has a value, all must be filled
      const hasAnyCardField = cardNumber || expiry || cvv || cardName || billingEmail;
      const hasAllCardFields = cardNumber && expiry && cvv && cardName && billingEmail;
      
      if (hasAnyCardField && !hasAllCardFields) {
        showResult(false, "Please fill in all credit card details, or leave all fields empty for test mode");
        processBtn.disabled = false;
        processBtn.textContent = "Process Payment";
        return;
      }
      
      // Only include cardDetails if all fields are provided
      if (hasAllCardFields) {
        paymentData.cardDetails = {
          number: cardNumber,
          expiry,
          cvv,
          name: cardName,
          email: billingEmail,
        };
        console.log("Card details provided - will attempt real payment if Stripe is configured");
      } else {
        // No card details provided - backend will use fake payment
        console.log("No card details provided - using test/fake payment mode");
        // Explicitly don't include cardDetails in the request
      }
    } else if (currentPaymentMethod === "paynow") {
      const ref = document.getElementById("paynowRef").textContent;
      paymentData.paynowRef = ref;
    }

    console.log("Sending purchase request:", { 
      amountXlusd: amount, 
      paymentMethod: currentPaymentMethod,
      hasCardDetails: !!paymentData.cardDetails 
    });
    
    const res = await fetch(`${API}/api/xlusd/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(paymentData),
    });

    const data = await res.json();
    console.log("Purchase response:", data);

    if (!res.ok || !data.ok) {
      const errorMsg = data.error || data.message || "Unknown error";
      const hint = data.hint ? `\n\n💡 Hint: ${data.hint}` : "";
      showResult(
        false,
        `❌ Payment failed: ${errorMsg}${hint}`
      );
    } else {
      const isTestPayment = data.paymentId?.includes("_test_") || data.paymentId?.startsWith("cc_test") || data.paymentId?.startsWith("pn_test");
      const isSimulated = data.simulated === true;
      
      let paymentNote = "";
      if (isSimulated) {
        paymentNote = "\n💰 Simulated Mode: XLUSD recorded in database (no XRPL transaction)";
      } else if (isTestPayment) {
        paymentNote = "\n💰 Test Mode: Fake payment used (no real money charged)";
      }
      
      showResult(
        true,
        `✅ Payment successful!\n` +
        `You received ${data.amountXlusd} XLUSD\n` +
        `Transaction ID: ${data.txHash || data.paymentId}\n` +
        paymentNote +
        (data.message ? `\n${data.message}` : "") +
        `\nRedirecting to dashboard...`
      );
      
      // Redirect to dashboard after 2 seconds (give time to see success message)
      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 2000);
    }
  } catch (err) {
    console.error("Purchase error:", err);
    showResult(false, `❌ Cannot reach backend: ${err.message || "Unknown error"}\n\nMake sure the server is running at ${API}`);
  } finally {
    processBtn.disabled = false;
    processBtn.textContent = "Process Payment";
  }
});

function showResult(ok, text) {
  paymentResult.textContent = text;
  paymentResult.className = "result";
  if (ok === true) {
    paymentResult.classList.add("ok");
  } else if (ok === false) {
    paymentResult.classList.add("bad");
  }
}

// Check authentication on load and load user info
async function checkAuth() {
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
    const sidebarUser = document.getElementById("sidebarUser");
    const sidebarEmail = document.getElementById("sidebarEmail");
    const userInitial = document.getElementById("userInitial");
    
    if (sidebarUser) sidebarUser.textContent = email.split("@")[0];
    if (sidebarEmail) sidebarEmail.textContent = email;
    if (userInitial) userInitial.textContent = email.charAt(0).toUpperCase();
    
    // Check if user has a verified wallet (optional in test/simulate mode)
    const wallet = data.wallet;
    if (!wallet || !wallet.isVerified) {
      // Show info message but don't disable - simulate mode doesn't need wallet
      const infoMsg = "ℹ️  No verified wallet connected. " +
        "You can still purchase XLUSD in test/simulate mode (will be recorded in database).\n\n" +
        "For real XRPL transactions, connect your wallet in Settings.";
      showResult(null, infoMsg);
      // Keep button enabled - allow purchases in simulate mode
      processBtn.disabled = false;
      amountInput.disabled = false;
    }
  } catch (e) {
    window.location.href = "index.html";
  }
}

checkAuth();
