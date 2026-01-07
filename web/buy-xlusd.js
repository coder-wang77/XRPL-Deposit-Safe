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
      const cardNumber = document.getElementById("cardNumber").value.replace(/\s/g, "");
      const expiry = document.getElementById("expiry").value;
      const cvv = document.getElementById("cvv").value;
      const cardName = document.getElementById("cardName").value;
      const billingEmail = document.getElementById("billingEmail").value;

      if (!cardNumber || !expiry || !cvv || !cardName || !billingEmail) {
        showResult(false, "Please fill in all credit card details");
        processBtn.disabled = false;
        processBtn.textContent = "Process Payment";
        return;
      }

      paymentData.cardDetails = {
        number: cardNumber,
        expiry,
        cvv,
        name: cardName,
        email: billingEmail,
      };
    } else if (currentPaymentMethod === "paynow") {
      const ref = document.getElementById("paynowRef").textContent;
      paymentData.paynowRef = ref;
    }

    const res = await fetch(`${API}/api/xlusd/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(paymentData),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      showResult(
        false,
        `Payment failed: ${data.error || data.message || "Unknown error"}`
      );
    } else {
      showResult(
        true,
        `✅ Payment successful!\n` +
        `You received ${data.amountXlusd} XLUSD\n` +
        `Transaction ID: ${data.txHash || data.paymentId}\n` +
        `Redirecting to dashboard...`
      );
      
      // Redirect to dashboard after 3 seconds
      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 3000);
    }
  } catch (err) {
    showResult(false, "❌ Cannot reach backend. Is the server running?");
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
  } catch (e) {
    window.location.href = "index.html";
  }
}

checkAuth();
