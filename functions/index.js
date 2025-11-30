// functions/index.js
// =======================
// ISP EDU — Cloud Functions (Payments, Payouts, Notifications, Utilities)
// Consolidated, corrected and ready for deployment.
// - Single entrypoint for all callables and webhook
// - Robust Razorpay webhook (signature verification, safe paise->rupee handling)
// - Defensive logging; webhook DOES NOT initiate refunds
// - Permanent safe refund workflow (createRefundIntent + confirmRefund)
// =======================

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const crypto = require("crypto");
const express = require("express");

// fetch compatibility (node 18 global fetch or node-fetch v2)
let fetchImpl = globalThis.fetch;
if (!fetchImpl) {
  try {
    fetchImpl = require("node-fetch");
    if (fetchImpl && fetchImpl.default) fetchImpl = fetchImpl.default;
  } catch (e) {
    console.warn(
      "node-fetch not found and global fetch missing. Install node-fetch@2 or use Node 18+ with global fetch."
    );
    fetchImpl = null;
  }
}

// Initialize admin if not already
if (!admin.apps.length) admin.initializeApp();

// ----------------------
// Config / Helpers
// ----------------------
const ADMIN_UID =
  process.env.ADMIN_UID ||
  (functions.config && functions.config().admin?.uid) ||
  "Q3Z7mgam8IOMQWQqAdwWEQmpqNn2"; // override via env or functions.config()
const RAZORPAY_KEY_ID =
  process.env.RAZORPAY_KEY_ID ||
  (functions.config && functions.config().razorpay?.key_id) ||
  null;
const RAZORPAY_KEY_SECRET =
  process.env.RAZORPAY_KEY_SECRET ||
  (functions.config && functions.config().razorpay?.key_secret) ||
  null;
const DEFAULT_EMAIL_FROM =
  process.env.DEFAULT_EMAIL_FROM ||
  (functions.config && functions.config().mail?.from) ||
  "ISP Education <no-reply@ispeducation.in>";
const SENDGRID_KEY =
  process.env.SENDGRID_KEY ||
  (functions.config && functions.config().mail?.sendgrid_key) ||
  null;
const TWILIO_SID =
  process.env.TWILIO_SID ||
  (functions.config && functions.config().twilio?.sid) ||
  null;
const TWILIO_TOKEN =
  process.env.TWILIO_TOKEN ||
  (functions.config && functions.config().twilio?.token) ||
  null;
const TWILIO_WHATSAPP_FROM =
  process.env.TWILIO_WHATSAPP_FROM ||
  (functions.config && functions.config().twilio?.from) ||
  null;

function isAdminUid(uid) {
  return uid === ADMIN_UID;
}

async function requireAdmin(context) {
  if (!context || !context.auth) {
    console.error("❌ requireAdmin: No auth found.");
    throw new functions.https.HttpsError("unauthenticated", "Login required.");
  }
  const uid = context.auth.uid;
  // Allow admin custom claim OR ADMIN_UID constant
  const isAdminClaim =
    context.auth.token && (context.auth.token.admin === true || context.auth.token.isAdmin === true);
  if (isAdminUid(uid) || isAdminClaim) {
    console.log("✅ ADMIN VERIFIED:", uid);
    return uid;
  }
  console.warn("❌ ADMIN REJECTED:", uid);
  throw new functions.https.HttpsError("permission-denied", "Admin access required.");
}

// Lazy-initialized clients
let sgMail = null;
function getSgMail() {
  if (sgMail) return sgMail;
  const key = SENDGRID_KEY;
  if (!key) {
    console.log("getSgMail: no SendGrid key found in env or functions.config() - skipping email sends via SendGrid");
    return null;
  }
  try {
    const mail = require("@sendgrid/mail");
    mail.setApiKey(key);
    sgMail = mail;
    console.log("getSgMail: initialized sendgrid");
    return sgMail;
  } catch (e) {
    console.warn("getSgMail: failed to require '@sendgrid/mail':", e?.message || e);
    return null;
  }
}

let twClient = null;
function getTwClient() {
  if (twClient) return twClient;
  const sid = TWILIO_SID;
  const token = TWILIO_TOKEN;
  if (!sid || !token) {
    console.log("getTwClient: no Twilio SID/token found - skipping Twilio sends");
    return null;
  }
  try {
    const tw = require("twilio");
    twClient = tw(sid, token);
    console.log("getTwClient: initialized twilio");
    return twClient;
  } catch (e) {
    console.warn("getTwClient: failed to require 'twilio':", e?.message || e);
    return null;
  }
}

// Helper: verify Razorpay payment server-side (using axios)
async function verifyRazorpayPayment(paymentId, expectedAmount) {
  const keyId = process.env.RAZORPAY_KEY_ID || RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET || RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials not configured.");
  }
  const url = `https://api.razorpay.com/v1/payments/${paymentId}`;
  const resp = await axios.get(url, {
    auth: { username: keyId, password: keySecret },
    timeout: 10000,
  });
  const data = resp.data;
  if (typeof expectedAmount === "number") {
    const expectedPaise = Math.round(expectedAmount * 100);
    if ((data.amount || 0) !== expectedPaise) {
      throw new Error(`Payment amount mismatch (Razorpay: ${data.amount} paise, expected: ${expectedPaise} paise)`);
    }
  }
  return data;
}

// ===== New helper: capture Razorpay payment server-side =====
async function captureRazorpayPayment(paymentId, expectedAmountRupees) {
  const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || RAZORPAY_KEY_ID;
  const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || RAZORPAY_KEY_SECRET;
  if (!RZP_KEY_ID || !RZP_KEY_SECRET) {
    throw new Error("Razorpay keys missing: cannot capture.");
  }

  const url = `https://api.razorpay.com/v1/payments/${paymentId}/capture`;
  const payload = { amount: Math.round(Number(expectedAmountRupees || 0) * 100) }; // paise
  const resp = await axios.post(url, payload, {
    auth: { username: RZP_KEY_ID, password: RZP_KEY_SECRET },
    timeout: 10000,
  });
  return resp.data;
}
// ========================================================

// ----------------------------
// Permanent safety: Defensive axios wrapper
// ----------------------------
const _axiosPost = axios.post.bind(axios);
const _axiosRequest = axios.request ? axios.request.bind(axios) : null;

axios.post = async function (url, data, config) {
  try {
    const urlStr = typeof url === "string" ? url : (url && url.url) ? url.url : "";
    const allow = config && config.__allow_refund_call === true;
    if (urlStr && urlStr.includes("/refund")) {
      if (!allow) {
        console.error("Blocked outgoing POST to refund URL (axios wrapper). URL:", urlStr);
        const err = new Error("Outgoing refunds are blocked. Use the createRefundIntent/confirmRefund administrative flow.");
        err.code = "REFUNDS_BLOCKED";
        throw err;
      }
      if (config && config.__allow_refund_call) {
        delete config.__allow_refund_call;
      }
    }
    return await _axiosPost(url, data, config);
  } catch (e) {
    throw e;
  }
};

if (_axiosRequest) {
  axios.request = async function (config) {
    try {
      const urlStr = config && (config.url || (config.baseURL ? config.baseURL : "")) ? (config.url || "") : "";
      const full = (config.baseURL || "") + (config.url || "");
      const allow = config && config.__allow_refund_call === true;
      if ((full && full.includes("/refund")) || (urlStr && urlStr.includes("/refund"))) {
        if (!allow) {
          console.error("Blocked outgoing request to refund URL (axios.request wrapper). URL:", full || urlStr);
          const err = new Error("Outgoing refunds are blocked. Use the createRefundIntent/confirmRefund administrative flow.");
          err.code = "REFUNDS_BLOCKED";
          throw err;
        }
        delete config.__allow_refund_call;
      }
      return await _axiosRequest(config);
    } catch (e) {
      throw e;
    }
  };
}

async function doRazorpayRefund(paymentId, amountPaise = null, options = {}) {
  const keyId = process.env.RAZORPAY_KEY_ID || RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET || RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Razorpay keys not configured for refund.");

  const url = `https://api.razorpay.com/v1/payments/${paymentId}/refund`;
  const payload = {};
  if (typeof amountPaise === "number") payload.amount = Math.round(amountPaise);

  const resp = await _axiosPost(url, payload, {
    auth: { username: keyId, password: keySecret },
    timeout: 20000,
    __allow_refund_call: true,
  });
  return resp.data;
}

/* =====================================================
   adminUpdatePayment (callable)
   - Performs safe admin-only updates to a payments document
   - Sanitizes arrays so no FieldValue.serverTimestamp() is placed inside arrays
   - Reconciles top-level server timestamps safely
   ===================================================== */
exports.adminUpdatePayment = functions
  .runWith({ memory: "256MB", timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
    await requireAdmin(context);

    const { paymentId, updates } = data || {};
    if (!paymentId) {
      throw new functions.https.HttpsError("invalid-argument", "paymentId required.");
    }
    if (!updates || typeof updates !== "object") {
      throw new functions.https.HttpsError("invalid-argument", "updates object required.");
    }

    try {
      const paymentsRef = admin.firestore().collection("payments").doc(String(paymentId));
      const snap = await paymentsRef.get();
      if (!snap.exists) {
        throw new functions.https.HttpsError("not-found", "Payment document not found.");
      }

      // Deep clone updates to avoid mutating input
      const sanitized = JSON.parse(JSON.stringify(updates));

      const isServerTimestampToken = (v) =>
        v === "__SERVER_TIMESTAMP__" ||
        (v && typeof v === "object" && v.__type === "serverTimestamp");

      function sanitizeValue(val, path = []) {
        if (Array.isArray(val)) {
          return val.map((it, idx) => sanitizeValue(it, path.concat([idx])));
        } else if (val && typeof val === "object") {
          const out = {};
          for (const k of Object.keys(val)) {
            out[k] = sanitizeValue(val[k], path.concat([k]));
          }
          return out;
        } else {
          if (isServerTimestampToken(val)) {
            if (path.length === 1) {
              return { __SANITIZED_AS_SERVER_TIMESTAMP__: true };
            }
            return new Date().toISOString();
          }
          return val;
        }
      }

      const topLevelTimestampFields = {};
      for (const k of Object.keys(sanitized)) {
        const v = sanitized[k];
        const s = sanitizeValue(v, [k]);
        sanitized[k] = s;
        if (s && typeof s === "object" && s.__SANITIZED_AS_SERVER_TIMESTAMP__ === true) {
          topLevelTimestampFields[k] = true;
          delete sanitized[k];
        }
      }

      const finalUpdates = { ...sanitized };
      const topLevelKeys = Object.keys(topLevelTimestampFields);
      topLevelKeys.forEach((k) => {
        finalUpdates[k] = admin.firestore.FieldValue.serverTimestamp();
      });

      finalUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      if (Array.isArray(finalUpdates.packages)) {
        finalUpdates.packages = finalUpdates.packages.map((pkg) => {
          if (pkg === null || pkg === undefined) return pkg;
          if (typeof pkg === "object") {
            const cleaned = {};
            Object.keys(pkg).forEach((pk) => {
              const val = pkg[pk];
              if (val && typeof val === "object" && val.__SANITIZED_AS_SERVER_TIMESTAMP__ === true) {
                cleaned[pk] = new Date().toISOString();
              } else {
                cleaned[pk] = val;
              }
            });
            return cleaned;
          }
          return pkg;
        });
      }

      await paymentsRef.update(finalUpdates);

      return { success: true, updated: true, paymentId };
    } catch (err) {
      console.error("adminUpdatePayment error:", err);
      if (err instanceof functions.https.HttpsError) throw err;
      throw new functions.https.HttpsError("internal", err.message || "Internal error");
    }
  });

/* =====================================================
   getPromoterStudents (callable)
   ===================================================== */
exports.getPromoterStudents = functions
  .runWith({ memory: "256MB", timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
    try {
      if (!context || !context.auth || !context.auth.uid) {
        throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
      }
      const callerUid = context.auth.uid;
      const { promoterUniqueId = null, promoterDocId = null } = data || {};

      if (!promoterUniqueId && !promoterDocId) {
        throw new functions.https.HttpsError("invalid-argument", "promoterUniqueId or promoterDocId required.");
      }

      const callerIsAdmin = isAdminUid(callerUid) || (context.auth.token && context.auth.token.admin === true);

      if (!callerIsAdmin) {
        const callerSnap = await admin.firestore().collection("users").doc(callerUid).get();
        const callerData = callerSnap.exists ? callerSnap.data() : null;
        if (!callerData) {
          throw new functions.https.HttpsError("permission-denied", "Caller user doc not found.");
        }
        const callerUnique = callerData.uniqueId || callerData.uniqueID || callerData.unique_id || null;
        const callerDoc = callerSnap.id;

        if (promoterUniqueId && callerUnique && promoterUniqueId !== callerUnique) {
          throw new functions.https.HttpsError("permission-denied", "Not authorized for that promoterUniqueId.");
        }
        if (promoterDocId && promoterDocId !== callerDoc) {
          throw new functions.https.HttpsError("permission-denied", "Not authorized for that promoterDocId.");
        }
      }

      const usersCol = admin.firestore().collection("users");
      const results = {};
      const pushIfNew = (docSnap) => {
        if (!docSnap || !docSnap.exists) return;
        results[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
      };

      if (promoterUniqueId) {
        try {
          const q1 = await usersCol.where("referralId", "==", promoterUniqueId).get();
          q1.forEach((d) => pushIfNew(d));
          console.log("getPromoterStudents: referralId hits:", q1.size);
        } catch (e) {
          console.warn("getPromoterStudents: q(referralId) failed:", e);
        }
        try {
          const q2 = await usersCol.where("referral", "==", promoterUniqueId).get();
          q2.forEach((d) => pushIfNew(d));
          console.log("getPromoterStudents: referral hits:", q2.size);
        } catch (e) {
          console.warn("getPromoterStudents: q(referral) failed:", e);
        }
      }

      if (promoterDocId) {
        try {
          const q3 = await usersCol.where("promoterId", "==", promoterDocId).get();
          q3.forEach((d) => pushIfNew(d));
          console.log("getPromoterStudents: promoterId hits:", q3.size);
        } catch (e) {
          console.warn("getPromoterStudents: q(promoterId) failed:", e);
        }
      }

      const promoterUidToCheck = promoterDocId ? promoterDocId : (!callerIsAdmin ? callerUid : null);
      if (promoterUidToCheck) {
        try {
          const q4 = await usersCol.where("promoterUid", "==", promoterUidToCheck).get();
          q4.forEach((d) => pushIfNew(d));
          console.log("getPromoterStudents: promoterUid hits:", q4.size);
        } catch (e) {
          console.warn("getPromoterStudents: q(promoterUid) failed:", e);
        }
      }

      if (Object.keys(results).length === 0 && promoterUniqueId) {
        const altFields = ["referredBy", "referrer", "referred_by", "referral_id", "promoter_id"];
        for (const field of altFields) {
          try {
            const q = await usersCol.where(field, "==", promoterUniqueId).get();
            q.forEach((d) => pushIfNew(d));
            if (q.size) console.log(`getPromoterStudents: alt ${field} hits:`, q.size);
          } catch (e) {
            // ignore
          }
        }
      }

      if (Object.keys(results).length === 0 && promoterUniqueId) {
        try {
          console.warn("getPromoterStudents: performing full collection scan as fallback (may be slow).");
          const all = await usersCol.get();
          all.forEach((d) => {
            const u = d.data();
            const possibles = [
              u.referralId, u.referral, u.promoterId, u.promoterUid, u.promoter_id,
              u.referredBy, u.referrer, u.referral_id
            ].filter(Boolean).map((v) => String(v).toLowerCase().trim());
            if (possibles.includes(String(promoterUniqueId).toLowerCase().trim())) pushIfNew(d);
          });
          console.log("getPromoterStudents: full-scan found:", Object.keys(results).length);
        } catch (e) {
          console.warn("getPromoterStudents: full-scan fallback failed:", e);
        }
      }

      const arr = Object.values(results);
      console.log("getPromoterStudents: returning", arr.length, "students.");
      return { success: true, students: arr, count: arr.length };
    } catch (err) {
      console.error("getPromoterStudents error:", err);
      if (err instanceof functions.https.HttpsError) throw err;
      throw new functions.https.HttpsError("internal", err.message || "Internal error");
    }
  });

/* =====================================================
   getPromoterPayments (callable)
   ===================================================== */
exports.getPromoterPayments = functions
  .runWith({ memory: "256MB", timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
    try {
      if (!context || !context.auth || !context.auth.uid) {
        throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
      }
      const callerUid = context.auth.uid;
      const { promoterUniqueId = null, promoterDocId = null, limit = 500 } = data || {};

      if (!promoterUniqueId && !promoterDocId) {
        throw new functions.https.HttpsError("invalid-argument", "promoterUniqueId or promoterDocId required.");
      }

      const callerIsAdmin = isAdminUid(callerUid) || (context.auth.token && context.auth.token.admin === true);

      if (!callerIsAdmin) {
        const callerSnap = await admin.firestore().collection("users").doc(callerUid).get();
        if (!callerSnap.exists) {
          throw new functions.https.HttpsError("permission-denied", "Caller user doc not found.");
        }
        const callerData = callerSnap.data() || {};
        const callerUnique = callerData.uniqueId || callerData.uniqueID || null;
        if (promoterUniqueId && callerUnique && promoterUniqueId !== callerUnique) {
          throw new functions.https.HttpsError("permission-denied", "Not authorized for that promoterUniqueId.");
        }
        if (promoterDocId && promoterDocId !== callerSnap.id) {
          throw new functions.https.HttpsError("permission-denied", "Not authorized for that promoterDocId.");
        }
      }

      const paymentsCol = admin.firestore().collection("payments");
      const results = [];
      const push = (docSnap) => {
        if (!docSnap || !docSnap.exists) return;
        const data = docSnap.data() || {};
        results.push({ id: docSnap.id, ...data });
      };

      if (promoterDocId) {
        try {
          const q1 = await paymentsCol.where("promoterId", "==", promoterDocId).orderBy("createdAt", "desc").limit(limit).get();
          q1.forEach(push);
          console.log("getPromoterPayments: promoterId hits:", q1.size);
        } catch (e) {
          console.warn("getPromoterPayments: q(promoterId) failed:", e);
        }
      }

      if (results.length === 0 && promoterUniqueId) {
        try {
          const q2 = await paymentsCol.where("promoterUniqueId", "==", promoterUniqueId).orderBy("createdAt", "desc").limit(limit).get();
          q2.forEach(push);
          console.log("getPromoterPayments: promoterUniqueId hits:", q2.size);
        } catch (e) {
          console.warn("getPromoterPayments: q(promoterUniqueId) failed:", e);
        }
      }

      if (results.length === 0 && promoterDocId) {
        const altFields = ["promoterUid", "promoter", "promoter_id"];
        for (const field of altFields) {
          try {
            const q = await paymentsCol.where(field, "==", promoterDocId).orderBy("createdAt", "desc").limit(limit).get();
            q.forEach(push);
            if (q.size) console.log(`getPromoterPayments: alt ${field} hits:`, q.size);
          } catch (e) {
            // ignore
          }
        }
      }

      if (results.length === 0 && (promoterUniqueId || promoterDocId)) {
        try {
          console.warn("getPromoterPayments: attempting fallback via users collection scan (may be slow).");
          const usersCol = admin.firestore().collection("users");
          let qUsers = null;
          if (promoterUniqueId) qUsers = await usersCol.where("referralId", "==", promoterUniqueId).get();
          else qUsers = await usersCol.where("promoterId", "==", promoterDocId).get();

          const studentIds = qUsers.docs.map((d) => d.id);
          for (let i = 0; i < studentIds.length; i += 10) {
            const slice = studentIds.slice(i, i + 10);
            try {
              const q = await paymentsCol.where("studentId", "in", slice).orderBy("createdAt", "desc").limit(limit).get();
              q.forEach(push);
            } catch (e) {
              console.warn("getPromoterPayments fallback payments in() failed:", e);
            }
          }
        } catch (e) {
          console.warn("getPromoterPayments: users fallback failed:", e);
        }
      }

      console.log("getPromoterPayments: returning", results.length, "payments.");
      return { success: true, payments: results, count: results.length };
    } catch (err) {
      console.error("getPromoterPayments error:", err);
      if (err instanceof functions.https.HttpsError) throw err;
      throw new functions.https.HttpsError("internal", err.message || "Internal error");
    }
  });

/* ===========================
   createPayoutIntent, confirmPayout
   =========================== */

exports.createPayoutIntent = functions
  .runWith({ secrets: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"], memory: "256MB", timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
    await requireAdmin(context);

    const {
      promoterId,
      promoterUniqueId = null,
      amount,
      currency = "INR",
      note = "",
      promoterBankDetails = null,
      meta = null,
    } = data || {};

    console.log("📤 createPayoutIntent -> Data:", JSON.stringify({ promoterId, amount, currency, note, promoterBankDetails: !!promoterBankDetails, meta: !!meta }));

    if (!promoterId || amount === undefined || amount === null || Number(amount) <= 0) {
      throw new functions.https.HttpsError("invalid-argument", "promoterId and valid amount required.");
    }

    const payload = {
      promoterId,
      promoterUniqueId,
      amount: Number(amount),
      currency,
      note,
      promoterBankDetails: promoterBankDetails || null,
      status: "created",
      meta: meta || null,
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

exports.confirmPayout = functions
  .runWith({ secrets: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"], memory: "512MB", timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
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
    console.log("📄 Payout Data:", JSON.stringify(payout));

    if (payout.status === "sent" || payout.status === "confirmed") {
      console.log("ℹ️ Payout already processed:", payoutId);
      return { success: false, message: "Payout already processed." };
    }

    const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || RAZORPAY_KEY_ID;
    const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || RAZORPAY_KEY_SECRET;

    if (!RZP_KEY_ID || !RZP_KEY_SECRET) {
      console.error("❌ Razorpay keys missing in environment.");
      throw new functions.https.HttpsError("failed-precondition", "Razorpay keys missing.");
    }

    const promoterBank = payout.promoterBankDetails || {};
    const hasUpi = Boolean(promoterBank.upiId);
    const hasBank =
      Boolean(promoterBank.accountNumber) && Boolean(promoterBank.ifsc) && Boolean(promoterBank.beneficiaryName);

    if (!hasUpi && !hasBank) {
      console.error("❌ Promoter bank/UPI details missing or incomplete:", promoterBank);
      throw new functions.https.HttpsError("failed-precondition", "Promoter bank/UPI details missing or incomplete.");
    }

    const providerPayload = {
      amount: Math.round(Number(payout.amount) * 100),
      currency: payout.currency || "INR",
      narration: payout.note || `Payout to promoter ${payout.promoterId}`,
      notes: {
        payoutDocId: payoutId,
        createdBy: payout.createdBy || null,
      },
    };

    if (hasUpi) {
      providerPayload.mode = "upi";
      providerPayload.vpa = promoterBank.upiId;
    } else {
      providerPayload.mode = "bank";
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
      console.log("📤 Sending payout request to Razorpay:", JSON.stringify(providerPayload));

      // Use fetchImpl if available, otherwise axios
      let resp;
      if (fetchImpl) {
        resp = await fetchImpl(providerUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(providerPayload),
        });
      } else {
        resp = await axios.post(providerUrl, providerPayload, {
          headers: { Authorization: `Basic ${basicAuth}` },
          timeout: 20000,
        });
      }

      let json;
      let status;
      if (resp && resp.json) {
        status = resp.status;
        json = await resp.json();
      } else if (resp && resp.data) {
        status = resp.status || 200;
        json = resp.data;
      } else {
        throw new Error("Unexpected response from provider");
      }

      providerResponse = { status, body: json };

      if (!(status >= 200 && status < 300)) {
        console.error("❌ Razorpay rejected payout:", providerResponse);
        await docRef.update({
          status: "failed",
          providerResponse,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        throw new Error(`Razorpay error: ${JSON.stringify(json)}`);
      }

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
      console.error("❌ confirmPayout error:", err?.message || err);

      try {
        await docRef.update({
          status: "failed",
          providerResponse: { error: err.message || String(err) },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (uErr) {
        console.error("❌ Failed to update payout doc on error:", uErr);
      }

      throw new functions.https.HttpsError("internal", "Payout failed: " + (err.message || String(err)));
    }
  });

/* ============================================================
   processCreatePayment, createPaymentRecord, adminCreatePayment,
   onPaymentCreated, onUserCreatedSendEmails
   (full implementations)
   ============================================================ */

/*
  REPLACED processCreatePayment — updated to store per-package fields:
  - paidPrice, regularDiscountAmount, additionalDiscountAmount, discountAmount
  - regularDiscountPercent, additionalDiscountPercent
  - totalPayable, price
  - rawPackage for debugging
  - createPerPackage branch now writes single-payment docs with those fields
*/

async function processCreatePayment(data, context, options = {}) {
  if (!context || !context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }
  const callerUid = context.auth.uid;
  const {
    paymentId,
    packages,
    totalAmount,
    mappedPromoter = null,
    createPerPackage = false,
  } = data || {};

  if (!paymentId || !Array.isArray(packages) || packages.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "paymentId and non-empty packages array required.");
  }

  const db = admin.firestore();
  const paymentsCol = db.collection("payments");
  const studentDbCol = db.collection("studentDatabase");
  const usersCol = db.collection("users");

  // (Optional) server-side verify with Razorpay (best-effort) + capture if needed
  let rp = null;
  try {
    rp = await verifyRazorpayPayment(paymentId, totalAmount);
  } catch (e) {
    console.warn("Razorpay verify warning:", e.message || e);
  }

  // If we have a Razorpay object and it's not captured, attempt server-side capture
  try {
    const needsCapture = rp && (rp.captured === false || String(rp.status || "").toLowerCase() === "authorized");
    if (needsCapture) {
      try {
        console.log("Attempting server-side capture for payment:", paymentId, "expected amount:", totalAmount);
        const cap = await captureRazorpayPayment(paymentId, totalAmount);
        console.log("Razorpay capture response:", cap && cap.id ? "OK captured" : cap);
        rp = cap || rp;
      } catch (capErr) {
        console.warn("Razorpay capture attempt failed:", capErr?.response?.data || capErr?.message || capErr);
      }
    }
  } catch (err) {
    console.warn("Capture flow error (non-fatal):", err);
  }

  // Resolve promoter doc id (try as uid first, then uniqueId lookup)
  let promoterDocId = null;
  let promoterData = null;
  if (mappedPromoter) {
    try {
      if (typeof mappedPromoter === "string" && mappedPromoter.length >= 20 && mappedPromoter.length <= 36) {
        const snap = await usersCol.doc(mappedPromoter).get();
        if (snap.exists) {
          promoterDocId = snap.id;
          promoterData = snap.data();
        }
      }
    } catch (e) {
      // ignore
    }
    if (!promoterDocId) {
      try {
        const q = await usersCol.where("uniqueId", "==", mappedPromoter).limit(1).get();
        if (!q.empty) {
          promoterDocId = q.docs[0].id;
          promoterData = q.docs[0].data();
        }
      } catch (e) {
        // ignore
      }
    }
  }

  // Attempt to read user doc to populate name/email/phone if token doesn't have them
  let callerUserDoc = null;
  try {
    const uSnap = await usersCol.doc(callerUid).get();
    if (uSnap.exists) callerUserDoc = uSnap.data();
  } catch (e) {
    console.warn("Could not read users/{uid} in processCreatePayment:", e?.message || e);
  }

  // DEBUG: log incoming payload to help debug packages / commission parsing
  console.log("createPaymentRecord payload:", {
    callerUid,
    paymentId,
    totalAmount,
    mappedPromoter,
    promoterDocId,
    packagesSummary: packages.map((p) => ({
      id: p.id,
      packageId: p.packageId,
      packageName: p.packageName || p.package || p.name,
      price: p.packageCost ?? p.price ?? p.totalPayable,
      commission: p.commission ?? p.promoterCommission ?? p.commissionPercent ?? null,
      commissionAmount: p.commissionAmount ?? null,
    })),
    createPerPackage: !!createPerPackage,
  });

  const createdPaymentDocIds = [];
  let commissionTotal = 0;
  const nowIso = new Date().toISOString();

  await db.runTransaction(async (tx) => {
    const promoterRef = promoterDocId ? usersCol.doc(promoterDocId) : null;

    let promoterExistingData = null;
    let currentPending = 0;
    if (promoterRef) {
      const pSnap = await tx.get(promoterRef);
      if (pSnap.exists) {
        promoterExistingData = pSnap.data() || {};
        currentPending = Number(promoterExistingData.pendingAmount || 0) || 0;
      } else {
        promoterExistingData = null;
        currentPending = 0;
      }
    }

    const computedPackages = [];
    let transCommissionTotal = 0;
    for (const pkg of packages) {
      // normalize numeric fields defensively
      const pkgPrice = Number(pkg.packageCost ?? pkg.price ?? pkg.totalPayable ?? pkg.paidPrice ?? 0) || 0;
      const commissionPercent = Number(pkg.commission ?? pkg.promoterCommission ?? pkg.commissionPercent ?? 0) || 0;
      const commissionAmountRaw =
        pkg.commissionAmount !== undefined && pkg.commissionAmount !== null
          ? Number(pkg.commissionAmount)
          : (pkgPrice * commissionPercent) / 100;
      const commissionAmount = Number((Number(commissionAmountRaw) || 0).toFixed(2));

      // Gather per-package discount + price fields if provided by client
      const discountAmount = Number(pkg.discountAmount ?? pkg.discount ?? 0) || 0;
      const regularDiscountAmount = Number(pkg.regularDiscountAmount ?? pkg.regular_discount_amount ?? 0) || 0;
      const additionalDiscountAmount = Number(pkg.additionalDiscountAmount ?? pkg.additional_discount_amount ?? 0) || 0;
      const regularDiscountPercent = pkg.regularDiscountPercent ?? pkg.regular_discount_percent ?? pkg.regularDiscount ?? pkg.regular ?? 0;
      const additionalDiscountPercent = pkg.additionalDiscountPercent ?? pkg.additional_discount_percent ?? pkg.additionalDiscount ?? pkg.additional ?? 0;
      const paidPrice = Number(pkg.paidPrice ?? pkg.paidAmount ?? pkg.totalPayable ?? pkg.price ?? pkg.packageCost ?? 0) || 0;
      const totalPayable = Number(pkg.totalPayable ?? pkg.paidPrice ?? pkg.paidAmount ?? paidPrice) || paidPrice;
      const price = Number(pkg.price ?? pkg.packageCost ?? pkg.totalPayable ?? pkg.paidPrice ?? 0) || 0;

      const computed = {
        id: pkg.id || null,
        packageId: pkg.packageId || pkg.id || null,
        packageName: pkg.packageName || pkg.concept || pkg.name || null,
        subject: pkg.subject || null,
        subtopic: pkg.subtopic || null,
        chapter: pkg.chapter || null,
        packageCost: Number(pkgPrice || 0),
        price: Number(price || 0),
        totalPayable: Number(totalPayable || 0),
        paidPrice: Number(paidPrice || 0),
        discountAmount: Number(discountAmount || 0),
        regularDiscountAmount: Number(regularDiscountAmount || 0),
        additionalDiscountAmount: Number(additionalDiscountAmount || 0),
        regularDiscountPercent: Number(regularDiscountPercent || 0),
        additionalDiscountPercent: Number(additionalDiscountPercent || 0),
        commissionPercent,
        commissionAmount,
        meta: pkg.meta || null,
        rawPackage: pkg, // keep full original package payload for debugging / future migrations
      };
      computedPackages.push(computed);
      transCommissionTotal += commissionAmount;
    }

    const studentNameFromToken = context.auth.token ? (context.auth.token.name || null) : null;
    const studentEmailFromToken = context.auth.token ? (context.auth.token.email || null) : null;
    const studentPhoneFromToken = context.auth.token ? (context.auth.token.phone || null) : null;

    const finalStudentName = studentNameFromToken || (callerUserDoc && callerUserDoc.name) || null;
    const finalStudentEmail = studentEmailFromToken || (callerUserDoc && callerUserDoc.email) || null;
    const finalStudentPhone = studentPhoneFromToken || (callerUserDoc && (callerUserDoc.phone || callerUserDoc.contact || callerUserDoc.mobile)) || null;

    // compute totals
    const computedPackageTotal = computedPackages.reduce((s, x) => s + (Number(x.packageCost || 0)), 0);
    const computedPaidSum = computedPackages.reduce((s, x) => s + (Number(x.paidPrice || x.totalPayable || 0)), 0);
    const computedDiscountSum = computedPackages.reduce((s, x) => s + (Number(x.discountAmount || 0)), 0);

    if (createPerPackage) {
      const perPackageRefs = [];
      for (const cPkg of computedPackages) {
        const singlePaymentDoc = {
          studentId: callerUid,
          studentName: finalStudentName,
          email: finalStudentEmail,
          phone: finalStudentPhone,
          packages: [cPkg],
          // also add explicit top-level convenience fields
          packageId: cPkg.packageId || null,
          packageName: cPkg.packageName || null,
          packageCost: cPkg.packageCost || 0,
          price: cPkg.price || 0,
          totalPayable: cPkg.totalPayable || 0,
          paidPrice: cPkg.paidPrice || 0,
          discountAmount: cPkg.discountAmount || 0,
          regularDiscountAmount: cPkg.regularDiscountAmount || 0,
          additionalDiscountAmount: cPkg.additionalDiscountAmount || 0,
          regularDiscountPercent: cPkg.regularDiscountPercent || 0,
          additionalDiscountPercent: cPkg.additionalDiscountPercent || 0,
          commissionPercent: cPkg.commissionPercent || 0,
          commissionAmount: cPkg.commissionAmount || 0,
          paymentId,
          paymentMethod: "razorpay",
          status: "paid",
          settlementStatus: "pending",
          promoterDocId: promoterDocId || null,
          promoterId: promoterDocId || null,
          promoterUid: promoterDocId || null,
          promoterResolved: promoterData || promoterExistingData || null,
          commissionTotal: Number(cPkg.commissionAmount || 0),
          commissionPaid: false,
          promoterPaid: false,
          paymentDate: nowIso,
          createdAt: nowIso,
          rawRazorpay: rp || null,
          meta: cPkg.meta || null,
        };

        const newRef = paymentsCol.doc();
        tx.set(newRef, {
          ...singlePaymentDoc,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        createdPaymentDocIds.push(newRef.id);
        perPackageRefs.push(newRef.id);
      }

      // create studentDatabase record referencing the per-package docs (array)
      const studentRecordRef = studentDbCol.doc();
      tx.set(studentRecordRef, {
        studentId: callerUid,
        name: finalStudentName || null,
        email: finalStudentEmail || "",
        phone: finalStudentPhone || "",
        packages: computedPackages,
        totalPackageCost: Number(totalAmount || computedPackageTotal),
        amount: Number(totalAmount || computedPaidSum || computedPackageTotal),
        paymentId,
        paymentStatus: "Paid",
        paymentDate: nowIso,
        promoterDocId: promoterDocId || null,
        promoterApproved: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paymentsRefIds: perPackageRefs,
      });
      createdPaymentDocIds.push(studentRecordRef.id);
    } else {
      const paymentDoc = {
        studentId: callerUid,
        studentName: finalStudentName,
        email: finalStudentEmail,
        phone: finalStudentPhone,
        packages: computedPackages,
        paymentId,
        paymentMethod: "razorpay",
        status: "paid",
        settlementStatus: "pending",
        promoterDocId: promoterDocId || null,
        promoterId: promoterDocId || null,
        promoterUid: promoterDocId || null,
        promoterResolved: promoterData || promoterExistingData || null,
        commissionTotal: Number(transCommissionTotal.toFixed(2)),
        commissionPaid: false,
        promoterPaid: false,
        paymentDate: nowIso,
        createdAt: nowIso,
        rawRazorpay: rp || null,
        amount: Number(totalAmount != null ? totalAmount : computedPaidSum),
        totalPackageCost: Number(totalAmount != null ? totalAmount : computedPackageTotal),
      };

      const newPaymentRef = paymentsCol.doc();
      tx.set(newPaymentRef, {
        ...paymentDoc,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      createdPaymentDocIds.push(newPaymentRef.id);

      const studentRecordRef = studentDbCol.doc();
      tx.set(studentRecordRef, {
        studentId: callerUid,
        name: paymentDoc.studentName || null,
        email: paymentDoc.email || null,
        phone: paymentDoc.phone || null,
        packages: paymentDoc.packages,
        totalPackageCost: paymentDoc.totalPackageCost,
        amount: paymentDoc.amount,
        paymentId,
        paymentStatus: "Paid",
        paymentDate: nowIso,
        promoterDocId: promoterDocId || null,
        promoterApproved: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paymentsRefId: newPaymentRef.id,
      });
      createdPaymentDocIds.push(studentRecordRef.id);
    }

    if (promoterRef && transCommissionTotal > 0 && promoterExistingData !== null) {
      const newPending = Number((currentPending + transCommissionTotal).toFixed(2));
      tx.update(promoterRef, {
        pendingAmount: newPending,
        lastPayment: nowIso,
        lastPaidAmount: admin.firestore.FieldValue.increment(0),
        lastCommissionAdded: admin.firestore.FieldValue.serverTimestamp(),
        lastPaymentDoc: createdPaymentDocIds.length ? createdPaymentDocIds[0] : null,
        lastCommissionValue: transCommissionTotal,
      });
    }

    commissionTotal = Number(transCommissionTotal.toFixed(2));
    return;
  });

  return {
    success: true,
    paymentDocIds: createdPaymentDocIds,
    details: createdPaymentDocIds.map((id) => ({ paymentDocId: id })),
    commissionTotal,
  };
}

exports.createPaymentRecord = functions
  .runWith({ secrets: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"], memory: "256MB", timeoutSeconds: 90 })
  .https.onCall(async (data, context) => {
    if (!context || !context.auth) throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
    try {
      const res = await processCreatePayment(data, context, { requireAdmin: false });
      return res;
    } catch (err) {
      console.error("createPaymentRecord error (outer):", err);
      if (err instanceof functions.https.HttpsError) throw err;
      throw new functions.https.HttpsError("internal", "Failed to create payment record: " + (err.message || err));
    }
  });

exports.adminCreatePayment = functions
  .runWith({ secrets: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"], memory: "256MB", timeoutSeconds: 90 })
  .https.onCall(async (data, context) => {
    await requireAdmin(context);
    try {
      const payload = data.payment || data;
      const res = await processCreatePayment(payload, context, { requireAdmin: true });
      return res;
    } catch (err) {
      console.error("adminCreatePayment error:", err);
      if (err instanceof functions.https.HttpsError) throw err;
      throw new functions.https.HttpsError("internal", "Admin create payment failed: " + (err.message || err));
    }
  });

exports.onPaymentCreated = functions
  .runWith({ secrets: ["SENDGRID_KEY", "TWILIO_SID", "TWILIO_TOKEN"], memory: "256MB", timeoutSeconds: 30 })
  .firestore.document("payments/{paymentId}")
  .onCreate(async (snap, ctx) => {
    try {
      const payment = snap.data() || {};
      const id = ctx.params.paymentId;
      const studentEmail = payment.email || payment.studentEmail || null;
      let studentPhone = payment.phone || payment.studentPhone || payment.contact || null;
      const studentName = payment.studentName || payment.name || "Student";
      const packageNames = (payment.packages && Array.isArray(payment.packages)) ? payment.packages.map(p => p.packageName || p.packageId || p.id).join(", ") : (payment.packageName || "Package");
      const amount = Number(payment.amount || payment.totalPackageCost || payment.packages?.reduce((s,p)=>s+(Number(p.packageCost||0)),0) || 0);
      const paymentId = payment.paymentId || null;
      let receiptUrl = payment.receiptUrl || null;

      // try to fetch short_url from Razorpay if keys available and paymentId present
      if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET && paymentId) {
        try {
          const rr = await axios.get(`https://api.razorpay.com/v1/payments/${paymentId}`, {
            auth: { username: RAZORPAY_KEY_ID, password: RAZORPAY_KEY_SECRET },
            timeout: 10000,
          });
          if (rr?.data?.short_url) receiptUrl = rr.data.short_url;
        } catch (e) {
          console.warn("Razorpay fetch failed in onPaymentCreated:", e?.response?.data || e.message || e);
        }
      }

      if (receiptUrl) {
        try {
          await snap.ref.update({ receiptUrl }).catch((e) => console.warn("Could not update receiptUrl:", e.message || e));
        } catch (e) {
          // ignore
        }
      }

      // Defensive: Update promoter doc pendingAmount if payment contains promoterDocId and commissionTotal but promoter.pendingAmount missing
      try {
        const promoterDocId = payment.promoterDocId || payment.promoterId || payment.promoterUid || payment.promoter || payment.promoter_id || null;
        if (promoterDocId && Number(payment.commissionTotal || 0) > 0) {
          const promoterRef = admin.firestore().collection("users").doc(promoterDocId);
          await admin.firestore().runTransaction(async (tx) => {
            const pSnap = await tx.get(promoterRef);
            if (!pSnap.exists) return;
            const pData = pSnap.data() || {};
            const currentPending = Number(pData.pendingAmount || 0) || 0;
            const newPending = Number((currentPending + Number(payment.commissionTotal || 0)).toFixed(2));
            tx.update(promoterRef, {
              pendingAmount: newPending,
              lastPayment: admin.firestore.FieldValue.serverTimestamp(),
              lastCommissionAdded: admin.firestore.FieldValue.serverTimestamp(),
              lastCommissionValue: Number(payment.commissionTotal || 0),
              lastPaymentDoc: ctx.params.paymentId,
            });
          }).catch((e) => console.warn("Promoter transaction in onPaymentCreated failed:", e));
        }
      } catch (e) {
        console.warn("Promoter update in onPaymentCreated error:", e);
      }

      // If student phone missing, attempt to fetch from users/{studentId}
      if (!studentPhone) {
        try {
          const studentId = payment.studentId || payment.student || null;
          if (studentId) {
            const uSnap = await admin.firestore().collection("users").doc(studentId).get();
            if (uSnap.exists) {
              const u = uSnap.data() || {};
              studentPhone = studentPhone || u.phone || u.contact || u.mobile || null;
              if (studentPhone) {
                try {
                  await snap.ref.update({ phone: studentPhone }).catch(() => {});
                } catch (e) {
                  // ignore
                }
              }
            }
          }
        } catch (e) {
          console.warn("onPaymentCreated: could not fetch users/{studentId} fallback:", e);
        }
      }

      // Send emails via SendGrid
      const mailClient = getSgMail();
      if (studentEmail && mailClient) {
        const purchaseHtml = `
          <p>Hi ${studentName},</p>
          <p>Thanks for purchasing <strong>${packageNames}</strong> for <strong>₹${amount.toFixed(2)}</strong>.</p>
          <ul>
            <li>Payment ID: ${paymentId || "—"}</li>
            ${receiptUrl ? `<li>Receipt: <a href="${receiptUrl}">Download</a></li>` : ""}
          </ul>
          <p>If you have questions, reply to this email.</p>
          <p>Thanks,<br/>ISP Education</p>
        `;
        try {
          await mailClient.send({ to: studentEmail, from: DEFAULT_EMAIL_FROM, subject: `Receipt: ${packageNames}`, html: purchaseHtml });
        } catch (e) {
          console.warn("SendGrid purchase failed:", e?.response?.body || e.message || e);
        }
      }

      // Send WhatsApp via Twilio (if configured)
      const tw = getTwClient();
      if (tw && TWILIO_WHATSAPP_FROM && studentPhone) {
        try {
          let toNumber = String(studentPhone).replace(/[^+\d]/g, "");
          if (!toNumber.startsWith("+")) {
            if (toNumber.length === 10) toNumber = "+91" + toNumber;
            else toNumber = "+" + toNumber;
          }
          const fromNumber = TWILIO_WHATSAPP_FROM;
          const text = `Hi ${studentName}, thanks for purchasing ${packageNames}. Amount: ₹${amount.toFixed(2)}. Payment ID: ${paymentId || "—"}. ${receiptUrl ? "Receipt: " + receiptUrl : ""}`;
          await tw.messages.create({ body: text, from: `whatsapp:${fromNumber}`, to: `whatsapp:${toNumber}` });
        } catch (e) {
          console.warn("Twilio WhatsApp send failed:", e?.message || e);
        }
      } else {
        if (!tw) console.log("Twilio client not configured or missing credentials - skipping WhatsApp send.");
        if (!TWILIO_WHATSAPP_FROM) console.log("TWILIO_WHATSAPP_FROM not configured - skipping WhatsApp send.");
        if (!studentPhone) console.log("Student phone missing - cannot send WhatsApp.");
      }

      console.log("onPaymentCreated done for", id);
      return null;
    } catch (err) {
      console.error("onPaymentCreated handler error:", err);
      return null;
    }
  });

exports.onUserCreatedSendEmails = functions
  .runWith({ secrets: ["SENDGRID_KEY"], memory: "128MB", timeoutSeconds: 30 })
  .firestore.document("users/{uid}")
  .onCreate(async (snap, ctx) => {
    try {
      const user = snap.data() || {};
      const uid = ctx.params.uid;
      const name = user.name || "";
      const email = user.email || null;
      const role = user.role || "student";
      const referralId = user.referralId || user.referral || null;
      const uniqueId = user.uniqueId || null;
      const phone = user.phone || null;

      console.log("onUserCreatedSendEmails -> new user:", uid, "role:", role, "referralId:", referralId);

      const mailClient = getSgMail();

      if (email && mailClient) {
        const subject = `Welcome to ISP Education${name ? ", " + name : ""}!`;
        const html = `
          <p>Hi ${name || "there"},</p>
          <p>Welcome to <strong>ISP Education</strong> — we're excited to have you onboard!</p>
          <ul>
            <li>Your Unique ID: <strong>${uniqueId || "Not assigned yet"}</strong></li>
            <li>Role: <strong>${role}</strong></li>
          </ul>
          <p>Visit your dashboard to get started.</p>
          <p>Best,<br/>ISP Education Team</p>
        `;
        const text = `Hi ${name || ""}, Welcome to ISP Education! Your Unique ID: ${uniqueId || "N/A"}. Role: ${role}.`;

        try {
          await mailClient.send({ to: email, from: DEFAULT_EMAIL_FROM, subject, html, text });
          console.log("Welcome email sent to", email);
        } catch (e) {
          console.warn("SendGrid welcome send failed:", e?.response?.body || e.message || e);
        }
      } else {
        console.log("No email present on new user or SendGrid not configured — skipping welcome email.");
      }

      if (role === "student" && referralId) {
        try {
          const db = admin.firestore();
          const q = await db.collection("users").where("uniqueId", "==", referralId).limit(1).get();

          if (q.empty) {
            console.log("No promoter found for referralId:", referralId);
          } else {
            const promoterDoc = q.docs[0];
            const promoter = promoterDoc.data();

            if (promoter && promoter.email && mailClient) {
              const pEmail = promoter.email;
              const pName = promoter.name || "Promoter";
              const studentName = name || "New Student";

              const pSubject = `New student joined using your referral: ${studentName}`;
              const pHtml = `
                <p>Hi ${pName},</p>
                <p>A new student joined using your referral ID <strong>${referralId}</strong>.</p>
                <p><strong>Student details:</strong></p>
                <ul>
                  <li>Name: ${studentName}</li>
                  <li>Email: ${email || "N/A"}</li>
                  <li>Phone: ${phone || "N/A"}</li>
                  <li>Class: ${user.classGrade || "N/A"}</li>
                  <li>Syllabus: ${user.syllabus || "N/A"}</li>
                </ul>
                <p>Check your promoter dashboard for rewards and tracking.</p>
                <p>Thanks,<br/>ISP Education Team</p>
              `;
              const pText = `Hi ${pName}, a new student (${studentName}) joined using your referral ${referralId}. Student email: ${email || "N/A"}.`;

              try {
                await mailClient.send({ to: pEmail, from: DEFAULT_EMAIL_FROM, subject: pSubject, html: pHtml, text: pText });
                console.log("Promoter notification email sent to", pEmail);
              } catch (e) {
                console.warn("SendGrid promoter notify failed:", e?.response?.body || e.message || e);
              }
            } else {
              console.log("Promoter found but no email configured or SendGrid missing:", promoterDoc.id, promoter);
            }

            try {
              await promoterDoc.ref.update({
                teamCount: admin.firestore.FieldValue.increment(1),
                lastTeamUpdate: admin.firestore.FieldValue.serverTimestamp(),
              });
              console.log("Incremented promoter.teamCount for", promoterDoc.id);
            } catch (incErr) {
              console.warn("Failed incrementing promoter teamCount:", incErr);
            }
          }
        } catch (e) {
          console.error("Error notifying promoter for referral:", e);
        }
      } else {
        console.log("Not a student or no referralId — skipping promoter notification.");
      }

      return null;
    } catch (err) {
      console.error("onUserCreatedSendEmails handler error:", err);
      return null;
    }
  });

/*
 * Razorpay Webhook Handler
 *
 * Robust webhook handler for Razorpay events:
 * - verifies signature (HMAC-SHA256) using timingSafeEqual
 * - updates payments docs for payment/refund related events
 * - fallback: writes an entry to `refunds` collection when no payment doc found
 *
 * NOTE: This webhook handler DOES NOT initiate refunds. It attaches refund events to payment docs
 * and records orphan/refund docs for reconciliation. If refunds are being triggered automatically,
 * search your repo for explicit refund API calls. This repository now permanently blocks any
 * outgoing /refund requests except via the confirmRefund admin callable above.
 */

const getWebhookSecret = () => {
  return (
    process.env.RAZORPAY_WEBHOOK_SECRET ||
    (functions.config && functions.config().razorpay && functions.config().razorpay.webhook_secret) ||
    null
  );
};

const app = express();

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

function verifySignature(rawBodyBuffer, signatureHeader, secret) {
  if (!secret) {
    console.warn("No webhook secret configured for verification.");
    return false;
  }
  try {
    const expected = crypto.createHmac("sha256", secret).update(rawBodyBuffer).digest("hex");
    const sigBuf = Buffer.from(signatureHeader || "", "utf8");
    const expBuf = Buffer.from(expected || "", "utf8");
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch (e) {
    console.error("verifySignature error", e);
    return false;
  }
}

async function findPaymentDocByRazorpayId(db, rzpPaymentId) {
  if (!rzpPaymentId) return null;
  const paymentsCol = db.collection("payments");

  try {
    const q1 = await paymentsCol.where("paymentId", "==", rzpPaymentId).limit(10).get();
    if (!q1.empty) return q1.docs[0];
  } catch (e) {
    console.warn("Query paymentId failed:", e?.message || e);
  }

  try {
    const q2 = await paymentsCol.where("rawRazorpay.id", "==", rzpPaymentId).limit(10).get();
    if (!q2.empty) return q2.docs[0];
  } catch (e) {
    console.warn("Query rawRazorpay.id failed (or unsupported) - will fallback to client-side scan:", e?.message || e);
  }

  try {
    const docSnap = await paymentsCol.doc(rzpPaymentId).get();
    if (docSnap.exists) return docSnap;
  } catch (e) {}

  try {
    console.warn("findPaymentDocByRazorpayId: performing full scan fallback (may be slow).");
    const all = await paymentsCol.limit(1000).get();
    for (const d of all.docs) {
      const data = d.data() || {};
      const candidates = [
        String(data.paymentId || "").trim(),
        String(data.id || "").trim(),
        String((data.rawRazorpay && data.rawRazorpay.id) || "").trim(),
        String(data.paymentID || "").trim(),
        String(data.payment_id || "").trim(),
      ].filter(Boolean);
      for (const c of candidates) {
        if (c === rzpPaymentId) {
          return d;
        }
      }
    }
  } catch (e) {
    console.warn("Full-scan fallback failed:", e?.message || e);
  }

  return null;
}

app.post("/", async (req, res) => {
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const sig = (req.get("X-Razorpay-Signature") || req.get("x-razorpay-signature") || "").toString();
  const secret = getWebhookSecret();

  if (!verifySignature(rawBody, sig, secret)) {
    console.warn("Razorpay signature mismatch. Rejecting webhook.");
    return res.status(400).json({ ok: false, error: "signature_mismatch" });
  }

  const event = (req.body && req.body.event) || null;
  const contains = (req.body && req.body.contains) || [];
  const payload = req.body && req.body.payload ? req.body.payload : {};

  console.log("Incoming Razorpay event:", event, "contains:", contains);

  const db = admin.firestore();

  try {
    if (event && event.startsWith("refund")) {
      const refundEntity = payload.refund && payload.refund.entity ? payload.refund.entity : null;
      const rzpRefundId = (refundEntity && refundEntity.id) || (payload.refund && payload.refund.id) || null;
      const rzpPaymentId =
        (refundEntity && refundEntity.payment_id) ||
        (refundEntity && refundEntity.paymentId) ||
        (req.body && req.body.payload && req.body.payload.payment && (req.body.payload.payment.entity && req.body.payload.payment.entity.id)) ||
        (req.body && req.body.payload && req.body.payload.payment && req.body.payload.payment.id) ||
        (req.body && req.body.payload && req.body.payload.refund && req.body.payload.refund.entity && req.body.payload.refund.entity.payment_id) ||
        null;

      const refundAmount = refundEntity && (refundEntity.amount || refundEntity.amount_refunded || refundEntity.value) ? Number(refundEntity.amount || refundEntity.amount_refunded || refundEntity.value) : null;
      const refundStatus = refundEntity && refundEntity.status ? String(refundEntity.status) : (req.body && req.body.payload && req.body.payload.refund && req.body.payload.refund.entity && req.body.payload.refund.entity.status) || null;
      const refundReason = refundEntity && refundEntity.reason ? String(refundEntity.reason) : null;
      const refundCreatedAt = refundEntity && refundEntity.created_at ? new Date((refundEntity.created_at||0) * 1000) : new Date();

      console.log("Refund event:", { rzpRefundId, rzpPaymentId, refundAmount, refundStatus, refundReason });

      let paymentsDoc = null;
      if (rzpPaymentId) {
        paymentsDoc = await findPaymentDocByRazorpayId(db, rzpPaymentId);
      }

      if (!paymentsDoc) {
        const note = {
          rzpRefundId,
          rzpPaymentId,
          refundAmount,
          refundStatus,
          refundReason,
          rawEvent: req.body,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const refDoc = await db.collection("refunds").add(note);
        console.log("No matching payment doc — created refunds doc:", refDoc.id);
        return res.status(200).json({ ok: true, note: "no_matching_payment_doc", refundsDocId: refDoc.id });
      }

      const payRef = paymentsDoc.ref;
      const payData = paymentsDoc.data() || {};

      let refundAmountRupees = null;
      if (typeof refundAmount === "number") {
        if (Math.abs(refundAmount) >= 1000 || (Math.abs(refundAmount) >= 100 && refundAmount % 100 === 0)) {
          refundAmountRupees = Math.round((refundAmount / 100) * 100) / 100;
        } else {
          refundAmountRupees = Math.round((refundAmount) * 100) / 100;
        }
      }

      const updates = {
        refundId: rzpRefundId || admin.firestore.FieldValue.delete,
        refundStatus: refundStatus || admin.firestore.FieldValue.delete,
        refundReason: refundReason || admin.firestore.FieldValue.delete,
        amount_refunded: refundAmountRupees != null ? refundAmountRupees : (admin.firestore.FieldValue.delete && payData.amount_refunded),
        refund_raw_event: req.body,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (refundStatus && refundStatus.toLowerCase() === "processed") {
        updates.settlementStatus = "refunded";
        updates.status = "refunded";
      } else if (refundStatus && refundStatus.toLowerCase() === "failed") {
        updates.settlementStatus = "refund_failed";
      }

      if (Array.isArray(payData.packages) && rzpRefundId) {
        try {
          const updatedPackages = payData.packages.map((pkg) => {
            const clone = { ...pkg };
            if (!Array.isArray(clone.refunds)) clone.refunds = clone.refunds || [];
            clone.refunds.push({
              refundId: rzpRefundId,
              amount: refundAmountRupees,
              status: refundStatus,
              reason: refundReason,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return clone;
          });
          updates.packages = updatedPackages;
        } catch (e) {
          console.warn("Unable to update packages array with refund info:", e?.message || e);
        }
      }

      await payRef.update(updates);

      console.log("Updated payment doc with refund info:", payRef.id);
      return res.status(200).json({ ok: true, note: "refund_attached", paymentDocId: payRef.id });
    }

    if (event === "payment.captured" || event === "payment.authorized" || event === "payment.failed") {
      const paymentEntity =
        (req.body && req.body.payload && req.body.payload.payment && req.body.payload.payment.entity) || req.body.payload || null;
      const rzpPaymentId = (paymentEntity && (paymentEntity.id || paymentEntity.payment_id)) || null;
      const status = (paymentEntity && paymentEntity.status) || (event === "payment.captured" ? "captured" : event === "payment.authorized" ? "authorized" : "failed");
      const amount = paymentEntity && (paymentEntity.amount || paymentEntity.amount_paid || paymentEntity.amount_refunded) ? Number(paymentEntity.amount || paymentEntity.amount_paid || paymentEntity.amount_refunded) : null;

      console.log("Payment event:", { rzpPaymentId, event, status, amount });

      let paymentsDoc = null;
      if (rzpPaymentId) paymentsDoc = await findPaymentDocByRazorpayId(db, rzpPaymentId);

      if (!paymentsDoc) {
        const orphan = {
          rzpPaymentId,
          event,
          status,
          amount,
          rawEvent: req.body,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const ref = await db.collection("orphanPayments").add(orphan);
        console.log("No matching payment doc for payment event — created orphanPayments doc:", ref.id);
        return res.status(200).json({ ok: true, note: "no_matching_payment_doc", orphanId: ref.id });
      }

      const payRef = paymentsDoc.ref;
      const toSet = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), rawWebhookEvent: req.body };
      if (status) toSet.status = status;
      if (typeof amount === "number") {
        let amountRupees = amount;
        if (Math.abs(amount) >= 1000 || (Math.abs(amount) >= 100 && amount % 100 === 0)) amountRupees = Math.round((amount / 100) * 100) / 100;
        toSet.amount = amountRupees;
      }
      if (event === "payment.captured") toSet.settlementStatus = "captured";
      if (event === "payment.authorized") toSet.settlementStatus = "authorized";
      if (event === "payment.failed") toSet.settlementStatus = "failed";

      try {
        const shortUrl = (paymentEntity && (paymentEntity.short_url || paymentEntity.shortUrl)) || null;
        if (shortUrl) toSet.receiptUrl = shortUrl;
      } catch (e) {}

      await payRef.update(toSet);
      console.log("Updated payment doc for payment event:", payRef.id);
      return res.status(200).json({ ok: true, note: "payment_attached", paymentDocId: payRef.id });
    }

    console.log("Unhandled event (accepted):", event);
    return res.status(200).json({ ok: true, note: "unhandled_event" });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Export Cloud Function
exports.razorpayWebhook = functions.https.onRequest(app);

/* -----------------------------
   New permanent refund workflow
   ----------------------------- */

exports.createRefundIntent = functions
  .runWith({ memory: "256MB", timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
    await requireAdmin(context);
    const { paymentDocId = null, rzpPaymentId = null, amount = null, reason = "", meta = null } = data || {};
    if (!paymentDocId && !rzpPaymentId) {
      throw new functions.https.HttpsError("invalid-argument", "paymentDocId or rzpPaymentId required.");
    }

    try {
      const note = {
        paymentDocId: paymentDocId || null,
        rzpPaymentId: rzpPaymentId || null,
        amount: amount != null ? Number(amount) : null,
        amountPaise: amount != null ? Math.round(Number(amount) * 100) : null,
        reason: reason || "",
        meta: meta || null,
        status: "pending",
        createdBy: context.auth.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        history: [
          { ts: admin.firestore.FieldValue.serverTimestamp(), by: context.auth.uid, note: "intent_created" },
        ],
      };
      const ref = await admin.firestore().collection("refunds").add(note);
      console.log("createRefundIntent: created refund intent:", ref.id);
      return { success: true, refundId: ref.id };
    } catch (err) {
      console.error("createRefundIntent error:", err);
      throw new functions.https.HttpsError("internal", "Failed to create refund intent: " + (err.message || err));
    }
  });

exports.confirmRefund = functions
  .runWith({ secrets: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"], memory: "512MB", timeoutSeconds: 90 })
  .https.onCall(async (data, context) => {
    await requireAdmin(context);

    const { refundId, captureAmountPaise = null, note = "" } = data || {};
    if (!refundId) {
      throw new functions.https.HttpsError("invalid-argument", "refundId required.");
    }

    const refundsCol = admin.firestore().collection("refunds");
    const rRef = refundsCol.doc(refundId);
    const rSnap = await rRef.get();
    if (!rSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Refund intent not found.");
    }
    const rDoc = rSnap.data() || {};
    if (rDoc.status === "processed" || rDoc.status === "failed") {
      console.log("confirmRefund: refund already finalized:", refundId, rDoc.status);
      return { success: false, message: "Refund already finalized", status: rDoc.status };
    }

    const rzpPaymentId = rDoc.rzpPaymentId || null;
    if (!rzpPaymentId) {
      throw new functions.https.HttpsError("failed-precondition", "rzpPaymentId missing on refund intent.");
    }

    await rRef.update({
      status: "processing",
      processingBy: context.auth.uid,
      processingAt: admin.firestore.FieldValue.serverTimestamp(),
      history: admin.firestore.FieldValue.arrayUnion({
        ts: admin.firestore.FieldValue.serverTimestamp(),
        by: context.auth.uid,
        note: "processing_started",
      }),
    });

    try {
      const resp = await doRazorpayRefund(rzpPaymentId, captureAmountPaise != null ? Number(captureAmountPaise) : rDoc.amountPaise || null);

      await rRef.update({
        providerResponse: resp,
        status: "processed",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedBy: context.auth.uid,
        history: admin.firestore.FieldValue.arrayUnion({
          ts: admin.firestore.FieldValue.serverTimestamp(),
          by: context.auth.uid,
          note: "processed",
          providerId: resp?.id || null,
        }),
        note: note || rDoc.note || null,
      });

      if (rDoc.paymentDocId) {
        try {
          const payRef = admin.firestore().collection("payments").doc(rDoc.paymentDocId);
          await payRef.update({
            refundId: resp?.id || null,
            refundStatus: resp?.status || "processed",
            amount_refunded: (resp && resp.amount) ? (Number(resp.amount) >= 100 ? Math.round((resp.amount / 100) * 100) / 100 : Math.round(resp.amount * 100) / 100) : admin.firestore.FieldValue.delete,
            refund_raw_event: resp,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (uErr) {
          console.warn("confirmRefund: failed to update payment doc after refund:", uErr);
        }
      }

      console.log("confirmRefund: refund processed:", refundId, resp?.id || resp);
      return { success: true, refundId, providerResponse: resp };
    } catch (err) {
      console.error("confirmRefund error:", err);
      try {
        await rRef.update({
          status: "failed",
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          failedBy: context.auth.uid,
          providerError: err?.response?.data || err?.message || String(err),
          history: admin.firestore.FieldValue.arrayUnion({
            ts: admin.firestore.FieldValue.serverTimestamp(),
            by: context.auth.uid,
            note: "failed",
            error: err?.message || String(err),
          }),
        });
      } catch (uErr) {
        console.error("confirmRefund: failed to update refund doc on error:", uErr);
      }
      throw new functions.https.HttpsError("internal", "Refund failed: " + (err?.message || String(err)));
    }
  });
