// functions/index.js
// =======================
// ISP EDU — Cloud Functions (Payments, Payouts, Notifications, Utilities)
// Consolidated, robust cloud functions file ready for deployment.
// =======================

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

// fetch compatibility (node 18 global fetch or node-fetch v2)
let fetchImpl = globalThis.fetch;
if (!fetchImpl) {
  try {
    // node-fetch v2 exports function directly via require
    fetchImpl = require("node-fetch");
    if (fetchImpl && fetchImpl.default) fetchImpl = fetchImpl.default;
  } catch (e) {
    console.warn("node-fetch not found and global fetch missing. Install node-fetch@2 or use Node 18+ with global fetch.");
    fetchImpl = null;
  }
}

admin.initializeApp();

// ----------------------
// Config / Helpers
// ----------------------
const ADMIN_UID = "Q3Z7mgam8IOMQWQqAdwWEQmpqNn2"; // change if required

function isAdminUid(uid) {
  return uid === ADMIN_UID;
}

async function requireAdmin(context) {
  if (!context || !context.auth) {
    console.error("❌ requireAdmin: No auth found.");
    throw new functions.https.HttpsError("unauthenticated", "Login required.");
  }
  const uid = context.auth.uid;
  console.log("🔐 requireAdmin -> Caller UID =", uid);
  if (isAdminUid(uid)) {
    console.log("✅ ADMIN VERIFIED:", uid);
    return uid;
  }
  console.warn("❌ ADMIN REJECTED:", uid);
  throw new functions.https.HttpsError("permission-denied", "Admin access required.");
}

// Environment / config extraction (prefers runtime env vars, fallbacks to functions.config())
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || functions.config().razorpay?.key_id || null;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || functions.config().razorpay?.key_secret || null;
const DEFAULT_EMAIL_FROM = process.env.DEFAULT_EMAIL_FROM || functions.config().mail?.from || "ISP Education <no-reply@ispeducation.in>";
const SENDGRID_KEY = process.env.SENDGRID_KEY || functions.config().mail?.sendgrid_key || null;
const TWILIO_SID = process.env.TWILIO_SID || functions.config().twilio?.sid || null;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || functions.config().twilio?.token || null;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || functions.config().twilio?.from || null;

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

/* =====================================================
   getPromoterStudents (callable)
   Returns students matched by referralId/referral/promoterUid/promoterId/promoter_id
   Validates caller is promoter or admin.
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

      // Admin bypass allowed
      const callerIsAdmin = isAdminUid(callerUid);

      // If caller is not admin, ensure they are the promoter in question
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

      // Try referralId/referral queries first (most common)
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

      // promoterDocId -> promoterId match
      if (promoterDocId) {
        try {
          const q3 = await usersCol.where("promoterId", "==", promoterDocId).get();
          q3.forEach((d) => pushIfNew(d));
          console.log("getPromoterStudents: promoterId hits:", q3.size);
        } catch (e) {
          console.warn("getPromoterStudents: q(promoterId) failed:", e);
        }
      }

      // promoterUid match (either caller or admin-supplied doc)
      const promoterUidToCheck = promoterDocId ? promoterDocId : (callerIsAdmin ? promoterDocId : callerUid);
      if (promoterUidToCheck) {
        try {
          const q4 = await usersCol.where("promoterUid", "==", promoterUidToCheck).get();
          q4.forEach((d) => pushIfNew(d));
          console.log("getPromoterStudents: promoterUid hits:", q4.size);
        } catch (e) {
          console.warn("getPromoterStudents: q(promoterUid) failed:", e);
        }
      }

      // If still none and promoterUniqueId present, attempt broader variants and full-scan fallback (for small datasets)
      if (Object.keys(results).length === 0 && promoterUniqueId) {
        // attempt other possible fields
        const altFields = ["referredBy", "referrer", "referred_by", "referral_id", "promoter_id"];
        for (const field of altFields) {
          try {
            const q = await usersCol.where(field, "==", promoterUniqueId).get();
            q.forEach((d) => pushIfNew(d));
            if (q.size) console.log(`getPromoterStudents: alt ${field} hits:`, q.size);
          } catch (e) {
            // many schemas won't have these fields; ignore failure
          }
        }
      }

      // Final fallback: case-insensitive scan (use with caution on large collections)
      if (Object.keys(results).length === 0 && promoterUniqueId) {
        try {
          console.warn("getPromoterStudents: no direct matches — performing full collection scan as fallback (may be slow).");
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

/* ----------------------
   CREATE PAYOUT INTENT
   ---------------------- */
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

/* ----------------------
   CONFIRM PAYOUT
   ---------------------- */
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

/* ----------------------
   createPaymentRecord (callable) - secure server-side payment recording
   - Writes /payments (one doc per top-level payment containing packages array OR optionally one doc per package)
   - Writes /studentDatabase entries
   - Atomically updates promoter's pendingAmount in users/{promoterDocId}
   - Returns created doc ids
   ---------------------- */
exports.createPaymentRecord = functions
  .runWith({ secrets: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"], memory: "256MB", timeoutSeconds: 90 })
  .https.onCall(async (data, context) => {
    if (!context || !context.auth) throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
    const callerUid = context.auth.uid;
    const { paymentId, packages, totalAmount, mappedPromoter = null, createPerPackage = false } = data || {};

    if (!paymentId || !Array.isArray(packages) || packages.length === 0) {
      throw new functions.https.HttpsError("invalid-argument", "paymentId and non-empty packages array required.");
    }

    const db = admin.firestore();
    const paymentsCol = db.collection("payments");
    const studentDbCol = db.collection("studentDatabase");
    const usersCol = db.collection("users");

    try {
      // (Optional) server-side verify with Razorpay
      let rp = null;
      try {
        rp = await verifyRazorpayPayment(paymentId, totalAmount);
      } catch (e) {
        console.warn("Razorpay verify warning:", e.message || e);
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

      // Transaction: READ promoter doc first (if exists), then perform writes
      await db.runTransaction(async (tx) => {
        const promoterRef = promoterDocId ? usersCol.doc(promoterDocId) : null;

        // READ promoter (if present) before any writes
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

        // compute per-package commission details first (no writes)
        const computedPackages = [];
        let transCommissionTotal = 0;
        for (const pkg of packages) {
          const pkgPrice = Number(pkg.packageCost ?? pkg.price ?? pkg.totalPayable ?? 0) || 0;
          const commissionPercent = Number(pkg.commission ?? pkg.promoterCommission ?? pkg.commissionPercent ?? 0) || 0;
          const commissionAmountRaw =
            pkg.commissionAmount !== undefined && pkg.commissionAmount !== null
              ? Number(pkg.commissionAmount)
              : (pkgPrice * commissionPercent) / 100;
          const commissionAmount = Number((Number(commissionAmountRaw) || 0).toFixed(2));

          const computed = {
            id: pkg.id || null,
            packageId: pkg.packageId || pkg.id || null,
            packageName: pkg.packageName || pkg.concept || pkg.name || null,
            subject: pkg.subject || null,
            subtopic: pkg.subtopic || null,
            chapter: pkg.chapter || null,
            packageCost: pkgPrice,
            commissionPercent,
            commissionAmount,
            meta: pkg.meta || null,
          };
          computedPackages.push(computed);
          transCommissionTotal += commissionAmount;
        }

        // Option A: create separate payment doc per package
        if (createPerPackage) {
          for (const cPkg of computedPackages) {
            const singlePaymentDoc = {
              studentId: callerUid,
              studentName: context.auth.token ? (context.auth.token.name || null) : null,
              email: context.auth.token ? (context.auth.token.email || null) : null,
              phone: null,
              packages: [cPkg],
              paymentId,
              paymentMethod: "razorpay",
              status: "paid",
              settlementStatus: "pending",
              promoterDocId: promoterDocId || null,
              promoterResolved: promoterData || promoterExistingData || null,
              commissionTotal: Number(cPkg.commissionAmount || 0),
              commissionPaid: false,
              promoterPaid: false,
              paymentDate: nowIso,
              createdAt: nowIso,
              rawRazorpay: rp || null,
            };

            const newRef = paymentsCol.doc();
            tx.set(newRef, {
              ...singlePaymentDoc,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              paidAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            createdPaymentDocIds.push(newRef.id);
          }

          // create a single studentDatabase entry referencing the group of payments
          const studentRecordRef = studentDbCol.doc();
          tx.set(studentRecordRef, {
            studentId: callerUid,
            name: context.auth.token ? (context.auth.token.name || null) : null,
            email: context.auth.token ? (context.auth.token.email || null) : null,
            phone: null,
            packages: computedPackages,
            totalPackageCost: Number(totalAmount || computedPackages.reduce((s, x) => s + (Number(x.packageCost || 0)), 0).toFixed(2)),
            amount: Number(totalAmount || computedPackages.reduce((s, x) => s + (Number(x.packageCost || 0)), 0).toFixed(2)),
            paymentId,
            paymentStatus: "Paid",
            paymentDate: nowIso,
            promoterDocId: promoterDocId || null,
            promoterApproved: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            paymentsRefIds: createdPaymentDocIds,
          });
          createdPaymentDocIds.push(studentRecordRef.id);
        } else {
          // Option B: create one top-level payment doc containing all packages
          const paymentDoc = {
            studentId: callerUid,
            studentName: context.auth.token ? (context.auth.token.name || null) : null,
            email: context.auth.token ? (context.auth.token.email || null) : null,
            phone: null,
            packages: computedPackages,
            paymentId,
            paymentMethod: "razorpay",
            status: "paid",
            settlementStatus: "pending",
            promoterDocId: promoterDocId || null,
            promoterResolved: promoterData || promoterExistingData || null,
            commissionTotal: Number(transCommissionTotal.toFixed(2)),
            commissionPaid: false,
            promoterPaid: false,
            paymentDate: nowIso,
            createdAt: nowIso,
            rawRazorpay: rp || null,
          };

          const newPaymentRef = paymentsCol.doc();
          tx.set(newPaymentRef, {
            ...paymentDoc,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          createdPaymentDocIds.push(newPaymentRef.id);

          // studentDatabase record
          const studentRecordRef = studentDbCol.doc();
          tx.set(studentRecordRef, {
            studentId: callerUid,
            name: paymentDoc.studentName || null,
            email: paymentDoc.email || null,
            phone: paymentDoc.phone || null,
            packages: paymentDoc.packages,
            totalPackageCost: Number(totalAmount || paymentDoc.packages.reduce((s, x) => s + (Number(x.packageCost || 0)), 0).toFixed(2)),
            amount: Number(totalAmount || paymentDoc.packages.reduce((s, x) => s + (Number(x.packageCost || 0)), 0).toFixed(2)),
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

        // Update promoter pendingAmount atomically (if promoter exists)
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

        // finalize commissionTotal for return
        commissionTotal = Number(transCommissionTotal.toFixed(2));
        return;
      }); // end transaction

      return { success: true, paymentDocIds: createdPaymentDocIds, commissionTotal };
    } catch (err) {
      console.error("createPaymentRecord error:", err);
      throw new functions.https.HttpsError("internal", "Failed to create payment record: " + (err.message || err));
    }
  });

/* ----------------------
   onPaymentCreated trigger - sends email and whatsapp notifications
   Also ensures promoter doc fields are updated if needed (defensive).
   ---------------------- */
exports.onPaymentCreated = functions
  .runWith({ secrets: ["SENDGRID_KEY", "TWILIO_SID", "TWILIO_TOKEN"], memory: "256MB", timeoutSeconds: 30 })
  .firestore.document("payments/{paymentId}")
  .onCreate(async (snap, ctx) => {
    try {
      const payment = snap.data() || {};
      const id = ctx.params.paymentId;
      const studentEmail = payment.email || payment.studentEmail || null;
      const studentPhone = payment.phone || payment.studentPhone || payment.contact || null;
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
        const promoterDocId = payment.promoterDocId || payment.promoterUid || payment.promoter_id || payment.promoter;
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

      // Send emails via SendGrid
      const mailClient = getSgMail();
      if (studentEmail && mailClient) {
        // purchase email
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
      }

      console.log("onPaymentCreated done for", id);
      return null;
    } catch (err) {
      console.error("onPaymentCreated handler error:", err);
      return null;
    }
  });

/* ----------------------
   onUserCreatedSendEmails - welcome + promoter notification
   ---------------------- */
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

// End of file
