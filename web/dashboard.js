// show who is signed in (from login page)
document.getElementById("who").textContent =
  localStorage.getItem("userEmail") || "Unknown";

// For now we just demo UI wiring.
// Next step: connect to backend XRPL endpoints.
function show(el, ok, text) {
  el.textContent = text;
  el.className = "result " + (ok ? "ok" : "bad");
}

// Create Escrow (placeholder)
document.getElementById("btnCreate").addEventListener("click", async () => {
  const payee = document.getElementById("a_payee").value.trim();
  const amount = document.getElementById("a_amount").value.trim();
  const finish = document.getElementById("a_finish").value;
  const cancel = document.getElementById("a_cancel").value;

  const out = document.getElementById("resCreate");

  // For now: just show what would be sent
  show(
    out,
    true,
    `Ready to create escrow ✅\nPayee: ${payee}\nAmount: ${amount} XRP\nFinishAfter: ${finish}\nCancelAfter: ${cancel || "(none)"}`
  );

  // Next step (later): POST to backend /api/escrow/create
});

// Finish Escrow (placeholder)
document.getElementById("btnFinish").addEventListener("click", async () => {
  const owner = document.getElementById("b_owner").value.trim();
  const seq = document.getElementById("b_seq").value.trim();
  const out = document.getElementById("resFinish");

  show(out, true, `Ready to finish escrow ✅\nOwner: ${owner}\nSequence: ${seq}`);

  // Next step: POST /api/escrow/finish
});

// Cancel Escrow (placeholder)
document.getElementById("btnCancel").addEventListener("click", async () => {
  const owner = document.getElementById("c_owner").value.trim();
  const seq = document.getElementById("c_seq").value.trim();
  const out = document.getElementById("resCancel");

  show(out, true, `Ready to cancel escrow ✅\nOwner: ${owner}\nSequence: ${seq}`);

  // Next step: POST /api/escrow/cancel
});
