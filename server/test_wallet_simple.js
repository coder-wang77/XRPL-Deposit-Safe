// Simple test to check wallet and XLUSD purchase
import xrpl from "xrpl";
import dotenv from "dotenv";

dotenv.config();

async function testWallet() {
  console.log("🔍 Wallet & XLUSD Purchase Test\n");
  console.log("=".repeat(60));

  // Check if PAYER_SEED exists
  const payerSeed = process.env.PAYER_SEED;
  
  if (!payerSeed) {
    console.error("❌ PAYER_SEED not found in .env file");
    console.log("\nTo set up:");
    console.log("1. Generate a wallet: https://xrpl.org/xrp-testnet-faucet.html");
    console.log("2. Add to .env: PAYER_SEED=your_seed_here");
    return;
  }

  // Validate seed format
  console.log("\n1️⃣ Validating Seed Format...");
  try {
    const wallet = xrpl.Wallet.fromSeed(payerSeed);
    console.log("✅ Seed is valid");
    console.log(`   Address: ${wallet.classicAddress}`);
  } catch (err) {
    console.error("❌ Invalid seed format!");
    console.error(`   Error: ${err.message}`);
    console.log("\n💡 Seed should be:");
    console.log("   - Format: 's...' (starts with 's')");
    console.log("   - Example: 'sYourSecretSeedHere...'");
    console.log("   - No underscores or special characters");
    console.log("\nGenerate a new wallet at: https://xrpl.org/xrp-testnet-faucet.html");
    return;
  }

  const wallet = xrpl.Wallet.fromSeed(payerSeed);
  const xlusdIssuer = process.env.XLUSD_ISSUER || "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq";

  // Connect to XRPL
  console.log("\n2️⃣ Connecting to XRPL Testnet...");
  try {
    const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
    await client.connect();
    console.log("✅ Connected");

    // Check account balance
    console.log("\n3️⃣ Checking Account Balance...");
    const accountInfo = await client.request({
      command: "account_info",
      account: wallet.classicAddress,
      ledger_index: "validated",
    });

    const xrpBalance = xrpl.dropsToXrp(accountInfo.result.account_data.Balance);
    console.log(`   XRP Balance: ${xrpBalance} XRP`);

    if (parseFloat(xrpBalance) < 10) {
      console.log("\n⚠️  LOW BALANCE WARNING!");
      console.log("   Your wallet needs more XRP to make transactions.");
      console.log("   Get test XRP from: https://xrpl.org/xrp-testnet-faucet.html");
      console.log(`   Your address: ${wallet.classicAddress}`);
    } else {
      console.log("✅ Sufficient balance for transactions");
    }

    // Check XLUSD trustline
    console.log("\n4️⃣ Checking XLUSD Trustline...");
    const accountLines = await client.request({
      command: "account_lines",
      account: wallet.classicAddress,
      ledger_index: "validated",
    });

    const xlusdLine = accountLines.result.lines?.find(
      (line) => line.currency === "XLUSD" && line.account === xlusdIssuer
    );

    if (xlusdLine) {
      console.log("✅ XLUSD trustline exists");
      console.log(`   Balance: ${xlusdLine.balance} XLUSD`);
    } else {
      console.log("⚠️  No XLUSD trustline");
      console.log("   (Will be created automatically on first purchase)");
    }

    // Check DEX for XLUSD
    console.log("\n5️⃣ Checking XLUSD on DEX...");
    try {
      const orderBook = await client.request({
        command: "book_offers",
        taker_pays: { currency: "XRP" },
        taker_gets: { currency: "XLUSD", issuer: xlusdIssuer },
        limit: 3,
      });

      if (orderBook.result.offers && orderBook.result.offers.length > 0) {
        const best = orderBook.result.offers[0];
        const xrp = typeof best.TakerPays === "string" 
          ? parseFloat(xrpl.dropsToXrp(best.TakerPays))
          : parseFloat(best.TakerPays.value || 0);
        const xlusd = typeof best.TakerGets === "string"
          ? parseFloat(best.TakerGets)
          : parseFloat(best.TakerGets.value || 0);
        
        const price = xlusd > 0 ? xrp / xlusd : 0;
        console.log("✅ XLUSD available on DEX");
        console.log(`   Price: ${price.toFixed(6)} XRP per XLUSD`);
        console.log(`   Best offer: ${xlusd} XLUSD for ${xrp} XRP`);
      } else {
        console.log("⚠️  No XLUSD offers on DEX");
        console.log("   You can still buy via the purchase endpoint");
      }
    } catch (err) {
      console.log("⚠️  Could not check DEX (this is OK)");
    }

    // Test purchase endpoint (if server is running)
    console.log("\n6️⃣ Testing Purchase Endpoint...");
    try {
      const testRes = await fetch("http://localhost:3001/health");
      if (testRes.ok) {
        console.log("✅ Server is running");
        console.log("   You can test purchase at: http://localhost:3001/api/xlusd/purchase");
      } else {
        console.log("⚠️  Server not responding");
      }
    } catch (err) {
      console.log("⚠️  Server not running on port 3001");
      console.log("   Start it with: cd server && npm start");
    }

    await client.disconnect();

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("\n📊 Summary:");
    console.log(`   ✅ Wallet: ${wallet.classicAddress}`);
    console.log(`   ${parseFloat(xrpBalance) >= 10 ? "✅" : "⚠️ "} XRP: ${xrpBalance} XRP`);
    console.log(`   ${xlusdLine ? "✅" : "⚠️ "} XLUSD: ${xlusdLine ? xlusdLine.balance : "0"} XLUSD`);
    
    console.log("\n💡 To buy XLUSD:");
    console.log("   1. Make sure server is running");
    console.log("   2. Log in to the web app");
    console.log("   3. Go to 'Buy XLUSD' page");
    console.log("   4. Enter amount and payment method");

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    if (err.message.includes("actNotFound")) {
      console.error("\n   Your wallet address doesn't exist on XRPL yet.");
      console.error("   Fund it first: https://xrpl.org/xrp-testnet-faucet.html");
    }
  }
}

testWallet();
