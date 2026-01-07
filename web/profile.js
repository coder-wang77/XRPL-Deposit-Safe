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

    // Load XRPL address
    try {
      const addressRes = await fetch(`${API}/debug/payer`, {
        credentials: "include",
      });
      if (addressRes.ok) {
        const addressData = await addressRes.json();
        const address = addressData.payerAddress || "Not configured";
        document.getElementById("detailAddress").textContent = address;
      }
    } catch (err) {
      console.error("Failed to load address:", err);
    }

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

loadProfile();
