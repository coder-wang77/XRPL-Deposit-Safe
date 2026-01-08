// AI Checker Service for Automatic Requirement Verification
// This service simulates an AI that automatically verifies service quality requirements

/**
 * AI Checker Service
 * Automatically verifies if service requirements are met based on various signals
 */

// Simulated AI verification logic
// In production, this would integrate with actual AI services (OpenAI, Anthropic, etc.)
export class AIChecker {
  /**
   * Verify a single requirement
   * @param {string} requirement - The requirement text to verify
   * @param {Object} context - Additional context (service provider info, escrow details, etc.)
   * @returns {Promise<{verified: boolean, confidence: number, reason: string}>}
   */
  static async verifyRequirement(requirement, context = {}) {
    // Simulate AI processing delay
    await new Promise(resolve => setTimeout(resolve, 300));

    // Simulate AI analysis
    // In production, this would:
    // 1. Analyze service deliverables (code, documents, etc.)
    // 2. Check against requirement criteria
    // 3. Use ML models to assess quality
    // 4. Return verification result with confidence score

    const requirementLower = String(requirement || "").toLowerCase();
    
    // Deterministic, proof-aware scoring (no randomness)
    const proofText = String(context.proofText || "").toLowerCase();
    const proofLinks = Array.isArray(context.proofLinks) ? context.proofLinks : [];
    const hasAnyProofText = proofText.trim().length >= 30;
    const hasAnyLink = proofLinks.length > 0;

    const hasPdf = proofLinks.some((u) => String(u).toLowerCase().includes(".pdf"));
    const hasImage = proofLinks.some((u) => /\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(String(u)));

    let confidence = 0.45;
    let reasons = [];

    if (hasAnyProofText) {
      confidence += 0.2;
      reasons.push("Proof description provided");
    }
    if (hasAnyLink) {
      confidence += 0.2;
      reasons.push("Evidence link(s) provided");
    }

    // Requirement-specific boosts
    if (requirementLower.includes("pdf")) {
      if (hasPdf) {
        confidence += 0.2;
        reasons.push("PDF evidence detected");
      } else {
        reasons.push("No PDF link detected");
      }
    }
    if (requirementLower.includes("photo") || requirementLower.includes("image") || requirementLower.includes("screenshot")) {
      if (hasImage) {
        confidence += 0.2;
        reasons.push("Image evidence detected");
      } else {
        reasons.push("No image link detected");
      }
    }
    if (requirementLower.includes("test") || requirementLower.includes("pass")) {
      // look for common phrases
      if (proofText.includes("test") && (proofText.includes("pass") || proofText.includes("passed"))) {
        confidence += 0.2;
        reasons.push("Proof mentions tests passing");
      } else {
        reasons.push("Proof does not mention tests passing");
      }
    }

    confidence = Math.max(0, Math.min(0.99, confidence));
    const verified = confidence >= 0.75;
    const reason = verified
      ? `✅ AI verified: ${reasons.length ? reasons.join(", ") : "Sufficient proof provided"}`
      : `❌ AI verified: ${reasons.length ? reasons.join(", ") : "Insufficient proof"} (needs more proof/details)`;

    return {
      verified,
      confidence,
      reason,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Verify all requirements for an escrow
   * @param {Array<string>} requirements - List of requirements to verify
   * @param {Object} context - Additional context
   * @returns {Promise<{results: Array, allVerified: boolean, summary: string}>}
   */
  static async verifyAllRequirements(requirements, context = {}) {
    if (!requirements || requirements.length === 0) {
      return {
        results: [],
        allVerified: true,
        summary: "No requirements to verify",
      };
    }

    // Accept either strings or objects like { text, evidenceLinks }
    const normalized = requirements.map((r) => {
      if (typeof r === "string") return { text: r, evidenceLinks: [] };
      if (r && typeof r === "object") return { text: r.text || "", evidenceLinks: r.evidenceLinks || [] };
      return { text: "", evidenceLinks: [] };
    });

    // Verify each requirement in parallel
    const verificationPromises = normalized.map((req, index) =>
      this.verifyRequirement(req.text, { ...context, requirementIndex: index, requirement: req })
    );

    const results = await Promise.all(verificationPromises);

    const allVerified = results.every(r => r.verified);
    const verifiedCount = results.filter(r => r.verified).length;
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

    const summary = allVerified
      ? `✅ All ${requirements.length} requirements verified by AI (${(avgConfidence * 100).toFixed(1)}% confidence)`
      : `⚠️ ${verifiedCount}/${requirements.length} requirements verified by AI (${(avgConfidence * 100).toFixed(1)}% confidence)`;

    return {
      results,
      allVerified,
      verifiedCount,
      totalCount: requirements.length,
      avgConfidence,
      summary,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Continuous monitoring - re-verify requirements periodically
   * @param {number} sequence - Escrow sequence number
   * @param {Function} updateCallback - Callback to update verification status
   */
  static async monitorEscrow(sequence, updateCallback) {
    // In production, this would run as a background job
    // For now, it's called on-demand
    console.log(`[AI Checker] Monitoring escrow ${sequence}...`);
  }
}

// Export for use in other modules
export default AIChecker;
