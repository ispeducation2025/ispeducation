// =======================
// ISP EDU — Payout Functions (Final Stable Build)
// =======================

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();

// =======================================
// FIXED ADMIN UID CHECK (guaranteed working)
// =======================================
const ADMIN_UID = "Q3Z7mgam8IOMQWQqAdwWEQmpqNn2";  // your UID

async function requireAdmin(context) {
  // Check auth
  if (!context || !context.auth) {
    console.error("❌ requireAdmin: No auth found.");
    throw new functions.https.HttpsError("unauthenticated", "Login required.");
  }

  const uid = context.auth.uid;

  // Log every call
  console.log("🔐 requireAdmin -> Caller UID =", uid);

  // Accept EXACT UID (your admin account)
  if (uid === ADMIN_UID) {
    console.log("✅ ADMIN VERIFIED:", uid);
    return uid;
  }

  // If someone else tries
  console.warn("❌ ADMIN REJECTED:", uid);
  throw new functions.https.HttpsError("permission-denied", "Admin access required.");
}

// ===========================
// CREATE PAYOUT INTENT
// ===========================
exports.createPayoutIntent = functions
  .runWith({ secrets: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"] })
  .https.onCall(async (data, context) => {
    // Admin check
    await requireAdmin(context);

    const {
      promoterId,
      promoterUniqueId = null,
      amount,
      currency = "INR",
      note = "",
      promoterBankDetails = null,
    } = data || {};

    console.log("📤 createPayoutIntent -> Data:", data);

    if (!promoterId || !amount || Number(amount) <= 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "promoterId and valid amount required."
      );
    }

    const payload = {
      promoterId,
      promoterUniqueId,
      amount: Number(amount),
      currency,
      note,
      promoterBankDetails: promoterBankDetails || null,
      status: "created",
      createdBy: context.auth.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    try {
      const docRef = await admin.firestore().collection("payouts").add(payload);
      console.log("✅ Payout Document Created:", docRef.id);
      return { success: true, payoutId: docRef.id };
    } catch (err) {
      console.error("❌ Error writing payout:", err);
      throw new functions.https.HttpsError("internal", "Failed to create payout intent.");
    }
  });

// ===========================
// CONFIRM PAYOUT
// ===========================
exports.confirmPayout = functions
  .runWith({ secrets: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"] })
  .https.onCall(async (data, context) => {
    // Admin check
    await requireAdmin(context);

    const { payoutId } = data || {};
    if (!payoutId) {
      throw new functions.https.HttpsError("invalid-argument", "payoutId required.");
    }

    console.log("📥 confirmPayout -> payoutId:", payoutId);

    const payoutsRef = admin.firestore().collection("payouts");
    const docRef = payoutsRef.doc(payoutId);

    const snap = await docRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Payout not found.");
    }

    const payout = snap.data();
    console.log("📄 Payout Data:", payout);

    if (payout.status === "sent" || payout.status === "confirmed") {
      return { success: false, message: "Payout already processed." };
    }

    // Razorpay Keys
    const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID;
    const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

    if (!RZP_KEY_ID || !RZP_KEY_SECRET) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Razorpay keys missing."
      );
    }

    // Bank/UPI details check
    const promoterBank = payout.promoterBankDetails || {};
    if (!promoterBank || (!promoterBank.accountNumber && !promoterBank.upiId)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Promoter bank/UPI details missing."
      );
    }

    // Build request
    const providerPayload = {
      mode: promoterBank.upiId ? "upi" : "bank",
      amount: Math.round(Number(payout.amount) * 100),
      currency: payout.currency || "INR",
      narration: payout.note || `Payout to promoter ${payout.promoterId}`,
      notes: {
        payoutDocId: payoutId,
        createdBy: payout.createdBy || null,
      },
    };

    if (promoterBank.upiId) {
      providerPayload.vpa = promoterBank.upiId;
    } else {
      providerPayload.fund_account = {
        account_number: promoterBank.accountNumber,
        ifsc: promoterBank.ifsc,
        name: promoterBank.beneficiaryName || "Promoter",
      };
    }

    const basicAuth = Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString("base64");
    const providerUrl = "https://api.razorpay.com/v1/payouts";

    let providerResponse = null;

    try {
      console.log("📤 Sending payout request to Razorpay:", providerPayload);

      const resp = await fetch(providerUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(providerPayload),
      });

      const json = await resp.json();
      providerResponse = { status: resp.status, body: json };

      if (!resp.ok) {
        console.error("❌ Razorpay rejected payout:", providerResponse);
        await docRef.update({
          status: "failed",
          providerResponse,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        throw new Error(JSON.stringify(json));
      }

      // Mark as sent
      await docRef.update({
        status: "sent",
        providerResponse,
        providerPayoutId: json?.id || null,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        confirmedBy: context.auth.uid,
      });

      console.log("✅ Payout sent successfully:", json?.id);

      return { success: true, message: "Payout submitted", providerResponse };
    } catch (err) {
      console.error("❌ confirmPayout error:", err);
      await docRef.update({
        status: "failed",
        providerResponse: { error: err.message },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      throw new functions.https.HttpsError("internal", "Payout failed: " + err.message);
    }
  });
