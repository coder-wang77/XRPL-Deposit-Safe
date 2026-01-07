// Test script to verify wallet and XLUSD purchase functionality
import xrpl from "xrpl";
import dotenv from "dotenv";

dotenv.config();

const TESTNET_URL = "wss://s.altnet.rippletest.net:51233";

async function testWallet() {
  console.log("🔍 Testing Wallet and XLUSD Purchase Functionality\n");
  console.log("=" .repeat(60));

  // 1. Check environment variables
  console.log("\n1️⃣ Checking Environment Variables...");
  const payerSeed = process.env.PAYER_SEED;
  const xlusdIssuer = process.env.XLUSD_ISSUER || "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq";
  
  if (!payerSeed) {
    console.error("❌ PAYER_SEED not found in .env file");
    return;
  }
  console.log("✅ PAYER_SEED found");

  try {
    const payerWallet = xrpl.Wallet.fromSeed(payerSeed);
    console.log(`✅ Wallet Address: ${payerWallet.classicAddress}`);
    console.log(`✅ XLUSD Issuer: ${xlusdIssuer}`);

    // 2. Connect to XRPL
    console.log("\n2️⃣ Connecting to XRPL Testnet...");
    const client = new xrpl.Client(TESTNET_URL);
    await client.connect();
    console.log("✅ Connected to XRPL Testnet");

    // 3. Check account info and balance
    console.log("\n3️⃣ Checking Account Info...");
    const accountInfo = await client.request({
      command: "account_info",
      account: payerWallet.classicAddress,
      ledger_index: "validated",
    });

    const xrpBalance = accountInfo.result.account_data.Balance;
    const xrpBalanceFormatted = xrpl.dropsToXrp(xrpBalance);
    console.log(`✅ XRP Balance: ${xrpBalanceFormatted} XRP`);
    
    if (parseFloat(xrpBalanceFormatted) < 10) {
      console.warn("⚠️  Low XRP balance. You may need to fund your wallet.");
      console.log("   Get test XRP from: https://xrpl.org/xrp-testnet-faucet.html");
    }

    // 4. Check trustlines
    console.log("\n4️⃣ Checking Trustlines...");
    const accountLines = await client.request({
      command: "account_lines",
      account: payerWallet.classicAddress,
      ledger_index: "validated",
    });

    const xlusdLine = accountLines.result.lines?.find(
      (line) => line.currency === "XLUSD" && line.account === xlusdIssuer
    );

    if (xlusdLine) {
      console.log(`✅ XLUSD Trustline exists`);
      console.log(`   Balance: ${xlusdLine.balance} XLUSD`);
      console.log(`   Limit: ${xlusdLine.limit}`);
    } else {
      console.log("⚠️  No XLUSD trustline found");
      console.log("   You may need to create a trustline first");
    }

    // 5. Check DEX order book for XLUSD
    console.log("\n5️⃣ Checking XLUSD Order Book...");
    try {
      const orderBook = await client.request({
        command: "book_offers",
        taker_pays: {
          currency: "XRP",
        },
        taker_gets: {
          currency: "XLUSD",
          issuer: xlusdIssuer,
        },
        limit: 5,
      });

      if (orderBook.result.offers && orderBook.result.offers.length > 0) {
        console.log(`✅ Found ${orderBook.result.offers.length} XLUSD offers on DEX`);
        
        const bestOffer = orderBook.result.offers[0];
        const takerGets = bestOffer.TakerGets;
        const takerPays = bestOffer.TakerPays;
        
        const xrpAmount = typeof takerPays === "string" 
          ? parseFloat(xrpl.dropsToXrp(takerPays))
          : parseFloat(takerPays.value || 0);
        const xlusdAmount = typeof takerGets === "string"
          ? parseFloat(takerGets)
          : parseFloat(takerGets.value || 0);
        
        const pricePerXlusd = xlusdAmount > 0 ? xrpAmount / xlusdAmount : 0;
        console.log(`\n   Best Offer:`);
        console.log(`   - Get: ${xlusdAmount} XLUSD`);
        console.log(`   - Pay: ${xrpAmount} XRP`);
        console.log(`   - Price: ${pricePerXlusd.toFixed(6)} XRP per XLUSD`);
        console.log(`   - Price: $${(pricePerXlusd * 0.6).toFixed(4)} USD (approx)`);
      } else {
        console.log("⚠️  No XLUSD offers found on DEX");
        console.log("   You may need to create offers or use the purchase endpoint");
      }
    } catch (err) {
      console.log(`⚠️  Could not fetch order book: ${err.message}`);
      console.log("   This is normal if XLUSD is not traded on DEX");
    }

    // 6. Test balance endpoint
    console.log("\n6️⃣ Testing Balance Endpoint...");
    try {
      const balanceRes = await fetch("http://localhost:3001/api/xlusd/balance", {
        credentials: "include",
      });
      
      if (balanceRes.ok) {
        const balanceData = await balanceRes.json();
        console.log("✅ Balance endpoint working");
        console.log(`   Balance: ${balanceData.balance} ${balanceData.currency}`);
      } else {
        console.log(`⚠️  Balance endpoint returned: ${balanceRes.status}`);
      }
    } catch (err) {
      console.log(`⚠️  Could not test balance endpoint: ${err.message}`);
      console.log("   Make sure the server is running on port 3001");
    }

    // 7. Summary
    console.log("\n" + "=".repeat(60));
    console.log("\n📊 Summary:");
    console.log(`   Wallet Address: ${payerWallet.classicAddress}`);
    console.log(`   XRP Balance: ${xrpBalanceFormatted} XRP`);
    console.log(`   XLUSD Balance: ${xlusdLine ? xlusdLine.balance : "0"} XLUSD`);
    console.log(`   Trustline: ${xlusdLine ? "✅ Exists" : "❌ Missing"}`);
    
    if (parseFloat(xrpBalanceFormatted) < 10) {
      console.log("\n⚠️  RECOMMENDATION: Fund your wallet with test XRP");
      console.log("   Visit: https://xrpl.org/xrp-testnet-faucet.html");
    }
    
    if (!xlusdLine) {
      console.log("\n⚠️  RECOMMENDATION: Create XLUSD trustline");
      console.log("   The purchase endpoint will create it automatically");
    }

    await client.disconnect();
    console.log("\n✅ Test completed successfully!");

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    console.error(err);
  }
}

testWallet();
