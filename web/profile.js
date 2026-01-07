// web/profile.js

const API = "http://127.0.0.1:3001";

async function loadProfile() {
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
    const name = email.split("@")[0];
    const initial = email.charAt(0).toUpperCase();

    // Update sidebar
    document.getElementById("sidebarUser").textContent = name;
    document.getElementById("sidebarEmail").textContent = email;
    document.getElementById("userInitial").textContent = initial;

    // Update profile
    document.getElementById("profileName").textContent = name;
    document.getElementById("profileEmail").textContent = email;
    document.getElementById("profileInitial").textContent = initial;
    document.getElementById("detailEmail").textContent = email;

    // Load wallet info
    if (data.wallet) {
      const addressEl = document.getElementById("detailAddress");
      const statusEl = document.getElementById("walletStatus");
      
      if (addressEl) {
        addressEl.textContent = data.wallet.address;
        addressEl.style.fontFamily = "monospace";
        addressEl.style.fontSize = "13px";
      }
      
      if (statusEl) {
        if (data.wallet.isVerified) {
          statusEl.textContent = "✅ Verified";
          statusEl.style.color = "#10b981";
        } else {
          statusEl.textContent = "⚠️ Not Verified";
          statusEl.style.color = "#f59e0b";
        }
      }
      
      // Hide/show connect section and verify section based on wallet status
      const connectSection = document.getElementById("walletConnectSection");
      const verifySection = document.getElementById("walletVerifySection");
      
      if (connectSection) {
        connectSection.style.display = "none"; // Hide connect section when wallet is connected
      }
      
      if (verifySection) {
        // Show verify section if wallet is connected but not verified
        if (!data.wallet.isVerified) {
          verifySection.style.display = "block";
        } else {
          verifySection.style.display = "none";
        }
      }
    } else {
      const addressEl = document.getElementById("detailAddress");
      const statusEl = document.getElementById("walletStatus");
      
      if (addressEl) {
        addressEl.textContent = "Not Connected";
      }
      if (statusEl) {
        statusEl.textContent = "Not Connected";
        statusEl.style.color = "#718096";
      }
    }
    
    // Also load detailed wallet status
    loadWalletStatus();

    // Load statistics
    try {
      const statsRes = await fetch(`${API}/api/stats`, {
        credentials: "include",
      });
      if (statsRes.ok) {
        const stats = await statsRes.json();
        document.getElementById("profileEscrows").textContent = stats.totalEscrows || 0;
        document.getElementById("profileBalance").textContent = `${stats.xlusdBalance || 0} XLUSD`;
      }
    } catch (err) {
      console.error("Failed to load stats:", err);
    }

    // Load XLUSD balance
    try {
      const balanceRes = await fetch(`${API}/api/xlusd/balance`, {
        credentials: "include",
      });
      if (balanceRes.ok) {
        const balanceData = await balanceRes.json();
        if (balanceData.ok) {
          document.getElementById("profileBalance").textContent = `${balanceData.balance.toFixed(2)} XLUSD`;
        }
      }
    } catch (err) {
      console.error("Failed to load balance:", err);
    }

    // Set member since (mock data for now)
    document.getElementById("profileJoined").textContent = new Date().toLocaleDateString("en-US", { 
      month: "short", 
      year: "numeric" 
    });

    // Set last login
    document.getElementById("lastLogin").textContent = new Date().toLocaleString();
  } catch (e) {
    window.location.href = "index.html";
  }
}

// Wallet connection handlers
const btnConnectWallet = document.getElementById("btnConnectWallet");
const btnVerifyWallet = document.getElementById("btnVerifyWallet");
const walletSeedInput = document.getElementById("walletSeedInput");

btnConnectWallet?.addEventListener("click", async () => {
  const seed = walletSeedInput?.value.trim();
  
  if (!seed) {
    alert("Please enter your wallet seed");
    return;
  }

  if (!seed || seed.trim().length === 0) {
    alert("Please enter your wallet seed");
    walletSeedInput.focus();
    return;
  }

  if (!seed.trim().startsWith("s")) {
    alert("Invalid XRPL seed format.\n\nSeeds must start with 's'.\n\nMake sure you're entering the SEED (secret), not the wallet address.\n\nThe seed looks like: sYourSecretSeedHere...\n\nThe wallet address looks like: rYourWalletAddressHere...");
    walletSeedInput.focus();
    return;
  }

  btnConnectWallet.disabled = true;
  btnConnectWallet.textContent = "Connecting...";

  try {
    const res = await fetch(`${API}/api/wallet/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ seed }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      const errorMsg = data.error || "Unknown error";
      // Show error in a more readable format
      alert(`Failed to connect wallet:\n\n${errorMsg.replace(/\\n/g, '\n')}\n\nMake sure:\n• You copied the full seed (not the address)\n• The seed starts with 's'\n• There are no extra spaces\n• You got it from: https://xrpl.org/xrp-testnet-faucet.html`);
      return;
    }

    alert("✅ Wallet connected successfully! Please verify ownership.");
    walletSeedInput.value = ""; // Clear the input
    loadProfile(); // Reload profile to show wallet info
  } catch (err) {
    alert(`Error: ${err.message || "Failed to connect wallet"}`);
  } finally {
    btnConnectWallet.disabled = false;
    btnConnectWallet.textContent = "Connect Wallet";
  }
});

btnVerifyWallet?.addEventListener("click", async () => {
  if (!confirm("Verify wallet ownership?\n\nThis will:\n• Check if your wallet exists on XRPL\n• Validate the connection\n• Get your wallet balance\n\nContinue?")) {
    return;
  }

  btnVerifyWallet.disabled = true;
  btnVerifyWallet.textContent = "⏳ Verifying...";

  try {
    const res = await fetch(`${API}/api/wallet/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });

    // Check if we got logged out (401)
    if (res.status === 401) {
      alert("❌ Session expired. Please log in again.");
      window.location.href = "index.html";
      return;
    }

    const data = await res.json();

    if (!res.ok || !data.ok) {
      const errorMsg = data.error || "Unknown error";
      const walletAddr = data.walletAddress ? `\n\nWallet: ${data.walletAddress}` : "";
      alert(`❌ Verification failed:\n\n${errorMsg}${walletAddr}\n\nMake sure your wallet has been funded with XRP to activate it on the ledger.`);
      return;
    }

    const balance = data.wallet?.balanceXrp || 0;
    alert(`✅ Wallet verified successfully!\n\nAddress: ${data.wallet.address}\nBalance: ${balance.toFixed(2)} XRP\n\nYour wallet is now verified and ready to use for escrow operations.`);
    
    // Reload profile to show verified status and balance
    loadProfile();
    loadWalletStatus();
  } catch (err) {
    alert(`❌ Error: ${err.message || "Failed to verify wallet"}`);
  } finally {
    btnVerifyWallet.disabled = false;
    btnVerifyWallet.textContent = "Verify Wallet";
  }
});

// Load wallet status periodically
async function loadWalletStatus() {
  try {
    const res = await fetch(`${API}/api/wallet/status`, {
      credentials: "include",
    });

    if (res.ok) {
      const data = await res.json();
      
      if (data.wallet && data.connected) {
        // Update wallet status display
        const statusEl = document.getElementById("walletStatus");
        const balanceEl = document.getElementById("walletBalance");
        const balanceItem = document.getElementById("walletBalanceItem");
        
        if (statusEl) {
          if (data.verified) {
            statusEl.textContent = "✅ Verified";
            statusEl.style.color = "#10b981";
          } else if (data.wallet.existsOnLedger === false) {
            statusEl.textContent = "⚠️ Not Activated (Fund with XRP)";
            statusEl.style.color = "#f59e0b";
          } else {
            statusEl.textContent = "⚠️ Not Verified";
            statusEl.style.color = "#f59e0b";
          }
        }

        // Show balance if available
        if (balanceEl && balanceItem && data.wallet.balanceXrp !== undefined) {
          balanceEl.textContent = `${data.wallet.balanceXrp.toFixed(2)} XRP`;
          balanceItem.style.display = "flex";
          balanceItem.style.justifyContent = "space-between";
          balanceItem.style.alignItems = "center";
        }

        // Show/hide verify button
        if (btnVerifyWallet) {
          if (!data.verified && data.wallet.existsOnLedger !== false) {
            btnVerifyWallet.style.display = "block";
          } else {
            btnVerifyWallet.style.display = "none";
          }
        }
      } else if (!data.connected) {
        // Wallet not connected - show connect section, hide verify section
        const balanceItem = document.getElementById("walletBalanceItem");
        const connectSection = document.getElementById("walletConnectSection");
        const verifySection = document.getElementById("walletVerifySection");
        
        if (balanceItem) balanceItem.style.display = "none";
        if (verifySection) verifySection.style.display = "none";
        if (connectSection) connectSection.style.display = "block";
      }
    }
  } catch (err) {
    console.error("Failed to load wallet status:", err);
  }
}

// Load wallet status on page load and refresh every 30 seconds
loadWalletStatus();
setInterval(loadWalletStatus, 30000);

loadProfile();
