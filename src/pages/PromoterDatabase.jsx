/* eslint-disable */
import React, { useEffect, useState, useRef } from "react";
import { db, auth, storage } from "../firebase/firebaseConfig";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
  getDoc,
  query,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useNavigate } from "react-router-dom";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";

/**
 * PromoterDatabase.jsx
 *
 * - Robust matching between payments <-> promoters
 * - Commission table (collapse/toggle)
 * - Manual Add Payment + Mark Row Paid (receipt upload)
 * - IMPORTANT CHANGE: when commission rows are fetched we now compute the pending total
 *   and update the promoters state so the left column shows the same pending total as the table.
 */

// ========== ADMIN UID (same as Cloud Functions) ==========
const ADMIN_UID = "Q3Z7mgam8IOMQWQqAdwWEQmpqNn2";
// ========================================================

/* helper utils */
function safeNumber(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}
function safeString(v) {
  return v === undefined || v === null ? "" : String(v);
}
function safeDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.toMillis === "function") return new Date(v.toMillis());
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function formatDateTime(v) {
  const d = safeDate(v);
  if (!d) return "—";
  try {
    return d.toLocaleString("en-IN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return d.toString();
  }
}

/* CSV helpers */
function escapeCsvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function rowsToCsv(headers, rows) {
  const hdr = headers.map(escapeCsvCell).join(",");
  const lines = rows.map((r) => headers.map((h) => escapeCsvCell(r[h])).join(","));
  return [hdr, ...lines].join("\n");
}

export default function PromoterDatabase() {
  const [promoters, setPromoters] = useState([]);
  const [loadingPromoters, setLoadingPromoters] = useState(true);
  const [selectedPromoter, setSelectedPromoter] = useState(null);

  const [rows, setRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState("");

  const [showAddPayModal, setShowAddPayModal] = useState(false);
  const [addPaidAmount, setAddPaidAmount] = useState("");
  const [addPaidNote, setAddPaidNote] = useState("");
  const [addReceiptFile, setAddReceiptFile] = useState(null);
  const [processingAdd, setProcessingAdd] = useState(false);

  const [showMarkModal, setShowMarkModal] = useState(false);
  const [markingRow, setMarkingRow] = useState(null);
  const [markReceiptFile, setMarkReceiptFile] = useState(null);
  const [processingMark, setProcessingMark] = useState(false);

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [isNarrow, setIsNarrow] = useState(typeof window !== "undefined" ? window.innerWidth < 820 : false);

  const navigate = useNavigate();
  const panelRef = useRef(null);

  useEffect(() => {
    function onResize() {
      setIsNarrow(window.innerWidth < 820);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    loadPromoters();
  }, []);

  /* -------------------------
     Robust matching: use many fields from payments & promoters
     ------------------------- */
  const loadPromoters = async () => {
    setLoadingPromoters(true);
    try {
      const usersSnap = await getDocs(collection(db, "users"));
      const promoterList = usersSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.role === "promoter" || p.alsoPromoter === true);

      // load all payments once
      const paymentsSnap = await getDocs(collection(db, "payments"));
      const payments = paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // initialize promoter map
      const promoterMap = {};
      for (const p of promoterList) {
        promoterMap[p.id] = {
          ...p,
          computed_pendingAmount: 0,
          computed_totalCommission: 0,
          computed_lastPaymentAt: p.lastPayment || null,
          computed_commissionRowsCount: 0,
        };
      }

      // build promoter identifier sets (for faster matching)
      const norm = (v) => (v || "").toString().toLowerCase().trim();
      const promoterIdentifiers = {}; // id -> Set(...)
      for (const p of promoterList) {
        const ids = new Set();
        [
          p.id,
          p.uid,
          p.uniqueId,
          p.uniqueID,
          p.unique_id,
          p.referralId,
          p.referral,
          p.promoterId,
          p.promoterUid,
          p.promoter,
          p.referredBy,
          p.referrer,
          p.referral_id,
        ]
          .filter(Boolean)
          .map((x) => norm(x))
          .forEach((s) => ids.add(s));

        // also add name/email for fallback matching (lower priority)
        if (p.email) ids.add(norm(p.email));
        if (p.name) ids.add(norm(p.name));

        promoterIdentifiers[p.id] = ids;
      }

      // utility: extract many identifiers from payment doc
      const paymentToIdentifiers = (pay) => {
        const ids = new Set();
        const candidates = [
          pay.promoterUid,
          pay.promoterId,
          pay.promoter,
          pay.promoter_id,
          pay.promoterUniqueId,
          pay.promoterUniqueID,
          pay.mappedPromoter,
          pay.promoterDocId,
          pay.promoter_docId,
          pay.promoter_referral,
          pay.promoterResolved && (pay.promoterResolved.uniqueId || pay.promoterResolved.uniqueID || pay.promoterResolved.promoterUid || pay.promoterResolved.promoterUniqueId),
          pay.referralId,
          pay.referral,
          pay.studentUniqueId,
          pay.studentId,
          pay.student,
          pay.paymentId,
          pay.id,
        ];
        candidates.filter(Boolean).map((x) => norm(x)).forEach((s) => ids.add(s));

        // include packages' identified strings
        if (Array.isArray(pay.packages)) {
          for (const pkg of pay.packages) {
            if (pkg.packageId) ids.add(norm(pkg.packageId));
            if (pkg.packageName) ids.add(norm(pkg.packageName));
            if (pkg.promoterId) ids.add(norm(pkg.promoterId));
            if (pkg.promoterUid) ids.add(norm(pkg.promoterUid));
            if (pkg.promoterUniqueId) ids.add(norm(pkg.promoterUniqueId));
          }
        }

        // last-resort: stringify raw JSON payload and index tokens (cheap)
        try {
          if (pay.raw) {
            const s = JSON.stringify(pay.raw).toLowerCase();
            // add any promoter-like tokens (split on non-alphanum, take short tokens)
            s.split(/[^a-z0-9]+/).filter(Boolean).slice(0, 40).forEach((t) => ids.add(t));
          }
        } catch (e) {
          // ignore
        }
        return ids;
      };

      // Now scan payments and match to promoter(s)
      for (const pay of payments) {
        // compute commission amount for this payment doc
        let commissionAmount = 0;
        if (pay.commissionTotal) commissionAmount = Number(pay.commissionTotal) || 0;
        else if (pay.commissionAmount) commissionAmount = Number(pay.commissionAmount) || 0;
        else if (Array.isArray(pay.packages)) {
          commissionAmount = pay.packages.reduce((s, x) => s + (Number(x.commissionAmount || x.commission || 0) || 0), 0);
        } else {
          commissionAmount = Number(pay.promoterCommissionAmount || pay.commission || 0) || 0;
        }

        // detect if commission already paid / marked
        const commissionPaidFlag =
          pay.promoterPaid === true ||
          pay.commissionPaid === true ||
          pay.adminMarked === true ||
          ["commission_paid", "settled", "completed"].includes((pay.status || pay.paymentStatus || pay.settlementStatus || "").toString().toLowerCase());

        // gather payment identifiers
        const payIds = paymentToIdentifiers(pay);

        // 1) try fast direct matches on a few canonical fields
        let matchedPromoterId = null;
        const keysToTry = [
          norm(pay.promoterDocId || pay.promoterId || pay.promoterUid || pay.promoter || pay.promoterUniqueId || pay.promoterUniqueID || pay.mappedPromoter),
        ].filter(Boolean);
        for (const k of keysToTry) {
          for (const pid of Object.keys(promoterIdentifiers)) {
            if (promoterIdentifiers[pid].has(k)) {
              matchedPromoterId = pid;
              break;
            }
          }
          if (matchedPromoterId) break;
        }

        // 2) if no match yet, try intersection of identifier sets
        if (!matchedPromoterId) {
          for (const pid of Object.keys(promoterIdentifiers)) {
            // intersection?
            for (const t of payIds) {
              if (promoterIdentifiers[pid].has(t)) {
                matchedPromoterId = pid;
                break;
              }
            }
            if (matchedPromoterId) break;
          }
        }

        // 3) (fallback) try partial name/email matches (low priority) - only if still unmatched
        if (!matchedPromoterId) {
          const payLower = [...payIds].join(" ");
          for (const p of promoterList) {
            const maybe = `${safeString(p.name)} ${safeString(p.email)} ${safeString(p.uniqueId || p.referralId || "")}`.toLowerCase();
            if (maybe && payLower.includes(maybe.split(" ").slice(0, 3).join(" "))) {
              matchedPromoterId = p.id;
              break;
            }
          }
        }

        if (!matchedPromoterId) continue; // not attributable

        const m = promoterMap[matchedPromoterId];
        if (!m) continue;
        m.computed_totalCommission = (m.computed_totalCommission || 0) + commissionAmount;
        if (!commissionPaidFlag) m.computed_pendingAmount = (m.computed_pendingAmount || 0) + commissionAmount;
        m.computed_commissionRowsCount = (m.computed_commissionRowsCount || 0) + 1;

        // update last payment date
        const candidateDate = pay.paidAt || pay.createdAt || pay.createdAtClient || null;
        const candTime = candidateDate && candidateDate.seconds ? candidateDate.seconds * 1000 : candidateDate ? new Date(candidateDate).getTime() : 0;
        const prevTime = m.computed_lastPaymentAt ? (m.computed_lastPaymentAt.seconds ? m.computed_lastPaymentAt.seconds * 1000 : new Date(m.computed_lastPaymentAt).getTime()) : 0;
        if (candTime && candTime > prevTime) {
          m.computed_lastPaymentAt = candidateDate;
        }
      } // end payments loop

      // final array
      const finalPromoters = Object.values(promoterMap).map((p) => ({
        ...p,
        computed_pendingAmount: Number(p.computed_pendingAmount || 0),
        computed_totalCommission: Number(p.computed_totalCommission || 0),
        computed_commissionRowsCount: Number(p.computed_commissionRowsCount || 0),
      }));

      setPromoters(finalPromoters);
    } catch (err) {
      console.error("loadPromoters error:", err);
      alert("Failed to load promoters — check console.");
    } finally {
      setLoadingPromoters(false);
    }
  };

  /* -------------------------
     fetch commission rows (same robust logic as PromoterCommission)
     When rows are built we update the promoters state to reflect the pending total
     so left panel shows the exact same pending number as the commission table.
     ------------------------- */
  const fetchCommissionRows = async (promoter) => {
    setRows([]);
    setRowsError("");
    setLoadingRows(true);

    const promoterDocId = promoter?.uid || promoter?.id || promoter?.docId || promoter?.promoterDocId || promoter?.promoterId || null;
    const promoterUniqueId = promoter?.uniqueId || promoter?.uniqueID || promoter?.unique_id || promoter?.referralId || null;

    if (!promoterDocId && !promoterUniqueId) {
      setRowsError("Cannot determine promoter identifiers.");
      setLoadingRows(false);
      return;
    }

    try {
      const paymentsCol = collection(db, "payments");
      const accum = [];

      const pushPaymentPackages = (p) => {
        const purchaseCandidate =
          p.paymentDate || p.paidAt || p.paid_on || p.payment_time || p.createdAt || p.created_at || p.created || null;
        const purchaseAt = safeDate(purchaseCandidate);
        const packages = Array.isArray(p.packages) && p.packages.length ? p.packages : (p.packagesMapAsArray || []);
        if (packages && packages.length) {
          packages.forEach((pkg) => {
            const packageName = safeString(pkg.packageName || pkg.name || pkg.package || pkg.packageId);
            const packageCost = safeNumber(pkg.packageCost ?? pkg.price ?? pkg.totalPayable ?? pkg.amount);
            const discount = safeNumber(pkg.discount ?? pkg.studentDiscount ?? 0);
            const commissionPercent = safeNumber(pkg.commissionPercent ?? pkg.commission ?? p.commissionPercent ?? 0);
            const commissionAmount = safeNumber(pkg.commissionAmount ?? pkg.promoterCommission ?? p.commissionAmount ?? (packageCost * commissionPercent) / 100);
            const studentUniqueId = safeString(p.studentUniqueId || p.studentUnique || p.studentId || p.student || "");
            const studentName = safeString(p.studentName || p.student || p.name || p.studentDisplayName || "");
            const totalPaid = safeNumber(p.amount ?? p.totalPackageCost ?? p.paidAmount ?? packageCost);

            const commissionPaidFlag =
              Boolean(pkg.commissionPaid ?? p.commissionPaid ?? p.promoterPaid) ||
              Boolean(p.promoterPaidAt) ||
              Boolean(p.payoutId) ||
              Boolean(p.payoutDocId) ||
              String(pkg.commissionPaid ?? p.commissionPaid ?? p.promoterPaid ?? "").toLowerCase() === "true";

            const adminPaidCandidate =
              p.promoterPaidAt || p.promoter_paid_at || pkg.promoterPaidAt || pkg.promoter_paid_at || null;

            accum.push({
              id: `${p.id || p.paymentId || "pay"}_${packageName}_${Math.random().toString(36).slice(2, 7)}`,
              paymentDocId: p.id || p.paymentId || "",
              paymentId: safeString(p.paymentId || p.id || p.paymentDocId || ""),
              studentName,
              studentUniqueId,
              packageName,
              packageCost,
              discount,
              totalPaid,
              commissionPercent,
              commissionAmount,
              commissionStatus: commissionPaidFlag ? "Paid" : "Pending",
              purchaseAt,
              adminPaidAt: adminPaidCandidate ? safeDate(adminPaidCandidate) : (commissionPaidFlag && p.promoterPaidAt ? safeDate(p.promoterPaidAt) : null),
              receiptUrl: safeString(p.receiptUrl || p.receipt || pkg.receiptUrl || pkg.receipt || ""),
              rawPaymentDoc: p,
              pkgRef: pkg,
            });
          });
        } else {
          const packageName = safeString(p.packageName || p.packages?.[0]?.packageName || "Package");
          const packageCost = safeNumber(p.amount ?? p.totalPackageCost ?? (p.packages?.[0]?.packageCost) ?? 0);
          const discount = safeNumber(p.discount ?? 0);
          const commissionPercent = safeNumber(p.commissionPercent ?? p.commission ?? (p.packages?.[0]?.commissionPercent) ?? 0);
          const commissionAmount = safeNumber(p.commissionAmount ?? (packageCost * commissionPercent) / 100);
          const studentUniqueId = safeString(p.studentUniqueId || p.studentUnique || p.studentId || p.student || "");
          const studentName = safeString(p.studentName || p.student || "");
          const totalPaid = safeNumber(p.amount ?? p.totalPackageCost ?? p.paidAmount ?? packageCost);

          const commissionPaidFlag =
            Boolean(p.commissionPaid ?? p.promoterPaid) ||
            Boolean(p.promoterPaidAt) ||
            Boolean(p.payoutId) ||
            Boolean(p.payoutDocId) ||
            String(p.commissionPaid ?? p.promoterPaid ?? "").toLowerCase() === "true";

          const adminPaidCandidate = p.promoterPaidAt || p.promoter_paid_at || null;
          const purchaseCandidate = p.paymentDate || p.paidAt || p.createdAt || p.created_at || null;
          const purchaseAt = safeDate(purchaseCandidate);

          accum.push({
            id: `${p.id || p.paymentId || "pay"}_${Math.random().toString(36).slice(2, 7)}`,
            paymentDocId: p.id || p.paymentId || "",
            paymentId: safeString(p.paymentId || p.id || ""),
            studentName,
            studentUniqueId,
            packageName,
            packageCost,
            discount,
            totalPaid,
            commissionPercent,
            commissionAmount,
            commissionStatus: commissionPaidFlag ? "Paid" : "Pending",
            purchaseAt,
            adminPaidAt: adminPaidCandidate ? safeDate(adminPaidCandidate) : (commissionPaidFlag && p.promoterPaidAt ? safeDate(p.promoterPaidAt) : null),
            receiptUrl: safeString(p.receiptUrl || p.receipt || ""),
            rawPaymentDoc: p,
            pkgRef: null,
          });
        }
      };

      try {
        // indexed attempts
        if (promoterDocId) {
          try {
            const q = query(paymentsCol, where("promoterDocId", "==", promoterDocId));
            const snap = await getDocs(q);
            snap.forEach((d) => {
              const data = d.data() || {};
              data.id = d.id;
              pushPaymentPackages(data);
            });
          } catch (e) {
            console.warn("Query by promoterDocId failed:", e?.message || e);
          }
        }

        if (promoterUniqueId) {
          try {
            const q2 = query(paymentsCol, where("promoterUniqueId", "==", promoterUniqueId));
            const snap2 = await getDocs(q2);
            snap2.forEach((d) => {
              const data = d.data() || {};
              data.id = d.id;
              pushPaymentPackages(data);
            });
          } catch (e) {
            console.warn("Query by promoterUniqueId failed:", e?.message || e);
          }
        }

        if (rows.length === 0 && promoterDocId) {
          const altFields = ["promoterId", "promoterUid", "promoter"];
          for (const field of altFields) {
            try {
              const qx = query(paymentsCol, where(field, "==", promoterDocId));
              const sx = await getDocs(qx);
              sx.forEach((d) => {
                const data = d.data() || {};
                data.id = d.id;
                pushPaymentPackages(data);
              });
            } catch (e) {
              // ignore
            }
          }
        }
      } catch (err) {
        console.warn("Indexed payments queries failed:", err);
      }

      // fallback: full payments scan
      if (accum.length === 0) {
        try {
          const allSnap = await getDocs(paymentsCol);
          allSnap.forEach((d) => {
            const data = d.data() || {};
            data.id = d.id;
            const possible = [
              safeString(data.promoterDocId),
              safeString(data.promoterId),
              safeString(data.promoterUid),
              safeString(data.promoterUniqueId),
              safeString(data.promoter),
              safeString((data.promoterResolved && (data.promoterResolved.uniqueId || data.promoterResolved.uniqueID)) || "")
            ].filter(Boolean).map((x) => x.toLowerCase().trim());

            if (promoterDocId && possible.includes(String(promoterDocId).toLowerCase().trim())) {
              pushPaymentPackages(data);
            } else if (promoterUniqueId && possible.includes(String(promoterUniqueId).toLowerCase().trim())) {
              pushPaymentPackages(data);
            }
          });
        } catch (e) {
          console.error("Full payments collection fallback failed:", e);
          setRowsError("Failed to load payments. Check Firestore rules or network.");
        }
      }

      // ===== NEW: sync left-panel pending total with computed pending from rows =====
      setRows(accum);

      // compute pending sum from accum (same logic as table)
      const pendingSum = accum.reduce((a, r) => a + (r.commissionStatus !== "Paid" ? safeNumber(r.commissionAmount) : 0), 0);

      // update promoters state so left shows same pending number
      setPromoters((prev) =>
        prev.map((pp) => {
          try {
            if (!promoter) return pp;
            // match by id if available else by unique id/referral
            const matchById = pp.id === promoter.id || pp.uid === promoter.uid || pp.id === promoter.uid;
            const matchByUnique = (pp.uniqueId || pp.referralId || "").toString().toLowerCase().trim() === (promoter.uniqueId || promoter.referralId || "").toString().toLowerCase().trim();
            if (matchById || matchByUnique) {
              return { ...pp, computed_pendingAmount: Number(pendingSum || 0) };
            }
            return pp;
          } catch {
            return pp;
          }
        })
      );

      if (accum.length === 0) setRowsError("No payments found for this promoter.");
    } catch (e) {
      console.error("fetchCommissionRows error:", e);
      setRowsError("Failed to fetch payments. See console.");
    } finally {
      setLoadingRows(false);
    }
  };

  /* -------------------------
     upload helper
     ------------------------- */
  const uploadFileWithTimeout = (file, path, timeoutMs = 120000) =>
    new Promise((resolve, reject) => {
      if (!storage) return reject(new Error("Firebase storage not initialized."));
      try {
        const sref = storageRef(storage, path);
        const task = uploadBytesResumable(sref, file);

        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          try {
            if (typeof task.cancel === "function") task.cancel();
          } catch (e) {}
          reject(new Error(`Upload timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        task.on(
          "state_changed",
          () => {},
          (err) => {
            clearTimeout(timer);
            if (timedOut) return;
            reject(err);
          },
          async () => {
            clearTimeout(timer);
            if (timedOut) return;
            try {
              const url = await getDownloadURL(task.snapshot.ref);
              resolve(url);
            } catch (e) {
              reject(e);
            }
          }
        );
      } catch (err) {
        reject(err);
      }
    });

  /* -------------------------
     create manual payment (admin)
     ------------------------- */
  const submitAddManualPayment = async () => {
    if (!selectedPromoter) return alert("Select a promoter first.");
    const amt = Number(addPaidAmount);
    if (!amt || amt <= 0) return alert("Enter a valid paid amount.");

    const current = auth.currentUser;
    if (!current) return alert("Please log in as admin to mark payment.");
    if (current.uid !== ADMIN_UID) return alert("Only admin (configured UID) can mark payments from this UI.");

    setProcessingAdd(true);
    try {
      let receiptUrl = null;
      if (addReceiptFile) {
        try {
          const safeName = `${selectedPromoter.id}_${Date.now()}_${addReceiptFile.name.replace(/\s+/g, "_")}`;
          receiptUrl = await uploadFileWithTimeout(addReceiptFile, `receipts/${safeName}`, 120000);
        } catch (err) {
          const keep = window.confirm("Receipt upload failed: " + (err?.message || err) + "\nContinue without receipt?");
          if (!keep) throw err;
        }
      }

      const promoterDocId = selectedPromoter.id;
      const promoterUid = selectedPromoter.uid || selectedPromoter.id;
      const promoterUniqueId = selectedPromoter.uniqueId || selectedPromoter.referralId || selectedPromoter.uniqueID || null;

      const payload = {
        promoterId: promoterDocId,
        promoterDocId: promoterDocId,
        promoterUid,
        promoterUniqueId,
        promoterName: selectedPromoter.name || null,
        amount: amt,
        commissionAmount: amt,
        commissionPaid: true,
        promoterPaid: true,
        currency: "INR",
        note: addPaidNote || "",
        status: "commission_paid",
        receiptUrl: receiptUrl || null,
        paidBy: current.uid,
        paidAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        adminMarked: true,
        meta: { markedByAdmin: current.uid, markedAt: new Date().toISOString() },
      };

      let paymentDocId = null;
      try {
        const functions = getFunctions();
        const fn = httpsCallable(functions, "adminCreatePayment");
        const resp = await fn({ payment: payload });
        if (resp && resp.data && (resp.data.id || resp.data.paymentId || resp.data.payment?.id)) {
          paymentDocId = resp.data.id || resp.data.paymentId || resp.data.payment?.id;
        }
      } catch (fnErr) {
        console.warn("adminCreatePayment callable failed:", fnErr);
      }

      if (!paymentDocId) {
        const pRef = await addDoc(collection(db, "payments"), { ...payload, paidAt: serverTimestamp(), createdAt: serverTimestamp() });
        paymentDocId = pRef.id;
        try {
          await updateDoc(doc(db, "payments", paymentDocId), {
            paymentId: paymentDocId,
            promoterId: promoterDocId,
            promoterDocId: promoterDocId,
            promoterUid,
            promoterUniqueId,
          });
        } catch (updErr) {
          console.warn("Failed to add canonical fields to payment doc:", updErr);
        }
      }

      await loadPromoters();
      await fetchCommissionRows(selectedPromoter);

      alert("Manual payment created and marked as paid.");
      setShowAddPayModal(false);
      setAddPaidAmount("");
      setAddPaidNote("");
      setAddReceiptFile(null);
    } catch (err) {
      console.error("submitAddManualPayment error:", err);
      alert("Failed to create payment: " + (err?.message || err));
    } finally {
      setProcessingAdd(false);
    }
  };

  /* -------------------------
     mark existing payment/package row as paid
     (uses ISO strings for nested promoterPaidAt to avoid serverTimestamp-in-array error)
     ------------------------- */
  const submitMarkRowPaid = async () => {
    if (!markingRow) return;
    const current = auth.currentUser;
    if (!current) return alert("Please login as admin.");
    if (current.uid !== ADMIN_UID) return alert("Only admin can mark payout here.");

    setProcessingMark(true);
    try {
      let receiptUrl = null;
      if (markReceiptFile) {
        try {
          const safeName = `${markingRow.paymentDocId || markingRow.paymentId}_${Date.now()}_${markReceiptFile.name.replace(/\s+/g, "_")}`;
          receiptUrl = await uploadFileWithTimeout(markReceiptFile, `receipts/${safeName}`, 120000);
        } catch (err) {
          const keep = window.confirm("Receipt upload failed: " + (err?.message || err) + "\nContinue without receipt?");
          if (!keep) throw err;
        }
      }

      const paymentDocRef = doc(db, "payments", markingRow.paymentDocId);
      const paymentSnap = await getDoc(paymentDocRef);
      if (!paymentSnap.exists()) throw new Error("Payment document no longer exists.");
      const paymentDoc = paymentSnap.data();

      const promoterPaidAtVar = new Date().toISOString();

      const updates = {
        commissionPaid: true,
        promoterPaid: true,
        promoterPaidAt: promoterPaidAtVar,
        adminMarked: true,
        lastMarkedByAdmin: current.uid,
      };
      if (receiptUrl) updates.receiptUrl = receiptUrl;

      if (markingRow.pkgRef && Array.isArray(paymentDoc.packages)) {
        const updatedPackages = paymentDoc.packages.map((pkg) => {
          const same =
            (pkg.packageName && pkg.packageName === markingRow.pkgRef.packageName) ||
            (pkg.packageId && pkg.packageId === markingRow.pkgRef.packageId) ||
            (pkg.commissionAmount && Number(pkg.commissionAmount) === Number(markingRow.pkgRef.commissionAmount));
          if (same) {
            return {
              ...pkg,
              commissionPaid: true,
              promoterPaid: true,
              promoterPaidAt: promoterPaidAtVar,
              ...(receiptUrl ? { receiptUrl } : {}),
            };
          }
          return pkg;
        });
        updates.packages = updatedPackages;
      } else {
        if (Array.isArray(paymentDoc.packages) && paymentDoc.packages.length === 1) {
          const updatedPackages = paymentDoc.packages.map((pkg) => ({
            ...pkg,
            commissionPaid: true,
            promoterPaid: true,
            promoterPaidAt: promoterPaidAtVar,
            ...(receiptUrl ? { receiptUrl } : {}),
          }));
          updates.packages = updatedPackages;
        }
      }

      const promoterDocId = selectedPromoter?.id || paymentDoc.promoterDocId || paymentDoc.promoterId || paymentDoc.promoterUid || null;
      if (promoterDocId) {
        updates.promoterId = promoterDocId;
        updates.promoterDocId = promoterDocId;
        updates.promoterUid = paymentDoc.promoterUid || paymentDoc.promoterId || promoterDocId;
      }

      let callableSucceeded = false;
      try {
        const functions = getFunctions();
        const fn = httpsCallable(functions, "adminUpdatePayment");
        const resp = await fn({ paymentId: markingRow.paymentDocId, updates });
        if (resp && resp.data && (resp.data.success || resp.data.updated)) {
          callableSucceeded = true;
        }
      } catch (fnErr) {
        console.warn("adminUpdatePayment callable failed (will fall back to client update):", fnErr);
      }

      if (!callableSucceeded) {
        // client-side update
        await updateDoc(paymentDocRef, {
          ...updates,
          updatedAt: serverTimestamp(),
        });
      }

      await loadPromoters();
      if (selectedPromoter) await fetchCommissionRows(selectedPromoter);

      alert("Marked as paid. Receipt attached (if uploaded).");
      setShowMarkModal(false);
      setMarkingRow(null);
      setMarkReceiptFile(null);
    } catch (err) {
      console.error("submitMarkRowPaid error:", err);
      if (err?.message && err.message.toLowerCase().includes("permission")) {
        alert(
          "Failed to mark paid: insufficient permissions. Recommended: deploy a server-side callable (functions.https.onCall) named 'adminUpdatePayment' and let it perform admin updates. See console for details."
        );
      } else if (err?.message && err.message.toLowerCase().includes("cors")) {
        alert(
          "Failed to call adminUpdatePayment due to CORS. Ensure your cloud function is implemented as an onCall function (not onRequest) or add proper CORS headers to onRequest handlers."
        );
      } else {
        alert("Failed to mark paid: " + (err?.message || String(err)));
      }
    } finally {
      setProcessingMark(false);
    }
  };

  /* -------------------------
     UI: selection & toggle
     ------------------------- */
  const handleSelectPromoter = (p) => {
    setSelectedPromoter(p);
    // intentionally do not auto-open commission (toggle button handles that)
  };

  const toggleCommissionForPromoter = async (p) => {
    if (selectedPromoter && p && selectedPromoter.id === p.id && rows && rows.length > 0) {
      // collapse
      setRows([]);
      setRowsError("");
      return;
    }
    setSelectedPromoter(p);
    await fetchCommissionRows(p);
  };

  const openMarkModalForRow = (row) => {
    setMarkingRow(row);
    setMarkReceiptFile(null);
    setShowMarkModal(true);
  };

  function handleExportCsv() {
    if (!rows || !rows.length) {
      alert("No rows to export.");
      return;
    }
    const headers = [
      "paymentId",
      "studentName",
      "studentUniqueId",
      "packageName",
      "packageCost",
      "discount",
      "totalPaid",
      "commissionPercent",
      "commissionAmount",
      "commissionStatus",
      "purchaseAt",
      "adminPaidAt",
      "receiptUrl",
    ];
    const csvRows = rows.map((r) => ({
      paymentId: r.paymentId || "",
      studentName: r.studentName || "",
      studentUniqueId: r.studentUniqueId || "",
      packageName: r.packageName || "",
      packageCost: safeNumber(r.packageCost).toFixed(2),
      discount: safeNumber(r.discount).toFixed(2),
      totalPaid: safeNumber(r.totalPaid).toFixed(2),
      commissionPercent: safeNumber(r.commissionPercent).toFixed(2),
      commissionAmount: safeNumber(r.commissionAmount).toFixed(2),
      commissionStatus: r.commissionStatus || "",
      purchaseAt: formatDateTime(r.purchaseAt),
      adminPaidAt: formatDateTime(r.adminPaidAt),
      receiptUrl: r.receiptUrl || "",
    }));
    const csv = rowsToCsv(headers, csvRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, "-");
    a.download = `promoter-commission-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openReceipt(url) {
    if (!url) return;
    try {
      window.open(url, "_blank");
    } catch (e) {
      window.location.href = url;
    }
  }

  // New: downloadReceipt uses fetch to force a download (works with many storage URLs).
  async function downloadReceipt(url) {
    if (!url) return;
    try {
      // Try to fetch the resource as a blob
      const resp = await fetch(url, { mode: "cors" });
      if (!resp.ok) {
        console.warn("Fetch failed with status", resp.status, "; falling back to opening URL.");
        try {
          window.open(url, "_blank");
        } catch (e) {
          window.location.href = url;
        }
        return;
      }
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;

      // infer filename
      try {
        const parts = url.split("/");
        const rawName = parts[parts.length - 1].split("?")[0] || "receipt";
        a.download = rawName;
      } catch {
        a.download = "receipt";
      }

      document.body.appendChild(a);
      a.click();
      a.remove();

      // revoke after a short delay to ensure download starts
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    } catch (err) {
      console.warn("downloadReceipt failed:", err);
      // fallback: open in new tab
      try {
        window.open(url, "_blank");
      } catch (e) {
        window.location.href = url;
      }
    }
  }

  const totalCommissionPaid = rows.reduce((a, r) => a + (r.commissionStatus === "Paid" ? safeNumber(r.commissionAmount) : 0), 0);
  const totalCommissionPending = rows.reduce((a, r) => a + (r.commissionStatus !== "Paid" ? safeNumber(r.commissionAmount) : 0), 0);

  /* -------------------------
     Render (unchanged)
     ------------------------- */
  const thtdStyle = { border: "1px solid #ddd", padding: "8px 10px", textAlign: "left" };
  const containerStyle = { padding: 20, background: "#f9fafb", minHeight: "100vh" };
  const promotersCol = { width: isNarrow ? "100%" : 360, marginRight: isNarrow ? 0 : 20 };
  const rightCol = { flex: 1 };

  return (
    <div style={containerStyle}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: isNarrow ? "wrap" : "nowrap" }}>
        {/* Left: promoters list */}
        <div style={promotersCol}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, color: "#0284c7" }}>Promoter Database</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={loadPromoters} style={{ background: "#0ea5e9", color: "#fff", padding: "6px 10px", borderRadius: 8, border: "none" }}>Refresh</button>
              <button onClick={() => navigate("/admin-dashboard")} style={{ background: "#0284c7", color: "#fff", padding: "6px 10px", borderRadius: 8, border: "none" }}>← Back</button>
            </div>
          </div>

          <div style={{ marginTop: 8, color: "#334155" }}>
            Pending totals computed from <code>/payments</code>.
          </div>

          <div style={{ marginTop: 12, background: "#fff", padding: 12, borderRadius: 8 }}>
            {loadingPromoters ? (
              <div style={{ color: "#64748b" }}>Loading promoters…</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#eef2ff" }}>
                    <th style={thtdStyle}>Name</th>
                    <th style={thtdStyle}>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {promoters.map((p) => (
                    <tr key={p.id} style={{ cursor: "pointer", background: selectedPromoter?.id === p.id ? "#f1f5f9" : "white" }}>
                      <td style={thtdStyle} onClick={() => handleSelectPromoter(p)}>
                        <div style={{ fontWeight: 700 }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>{p.email}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>{p.uniqueId || p.referralId || "-"}</div>
                      </td>
                      <td style={thtdStyle}>
                        ₹{Number(p.computed_pendingAmount || 0).toLocaleString("en-IN")}
                        <div style={{ marginTop: 6 }}>
                          <button onClick={() => toggleCommissionForPromoter(p)} style={{ padding: "6px 8px", borderRadius: 6 }}>
                            {selectedPromoter && selectedPromoter.id === p.id && rows && rows.length > 0 ? "Collapse Commission" : "View Commission"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: commission rows */}
        <div style={rightCol}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: 0 }}>Commission — Payments</h2>
              <div style={{ color: "#475569", marginTop: 6 }}>
                {selectedPromoter ? `Showing for: ${selectedPromoter.name} (${selectedPromoter.uniqueId || selectedPromoter.referralId || selectedPromoter.id})` : "Select a promoter to view commissions."}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
                <option value="all">All</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
              </select>
              <input placeholder="Search name / payment id / course / student id" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: 8, borderRadius: 8, minWidth: 220 }} />
              <button onClick={() => { setSearch(""); setStatusFilter("all"); }} style={{ padding: "8px 10px", borderRadius: 8 }}>Reset</button>
              <button onClick={handleExportCsv} style={{ padding: "8px 10px", borderRadius: 8, background: "#0ea5e9", color: "#fff", border: "none" }}>Export CSV</button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            {loadingRows ? (
              <div style={{ padding: 28, background: "#fff", borderRadius: 10, textAlign: "center" }}>Loading payments…</div>
            ) : rowsError ? (
              <div style={{ padding: 12, background: "#fff7ed", borderRadius: 8, color: "#92400e" }}>{rowsError}</div>
            ) : !rows || rows.length === 0 ? (
              <div style={{ padding: 28, background: "#fff", borderRadius: 10, textAlign: "center", color: "#64748b" }}>No payment records for this promoter.</div>
            ) : (
              <>
                {!isNarrow ? (
                  <div style={{ overflowX: "auto", borderRadius: 8, marginTop: 8 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
                      <thead>
                        <tr style={{ background: "linear-gradient(90deg,#f1f5f9,#eef2ff)" }}>
                          <th style={thtdStyle}>Student</th>
                          <th style={thtdStyle}>Course</th>
                          <th style={thtdStyle}>Course Cost (₹)</th>
                          <th style={thtdStyle}>Discount (₹)</th>
                          <th style={thtdStyle}>Total Paid (₹)</th>
                          <th style={thtdStyle}>Commission %</th>
                          <th style={thtdStyle}>Commission (₹)</th>
                          <th style={thtdStyle}>Status</th>
                          <th style={thtdStyle}>Purchase</th>
                          <th style={thtdStyle}>Admin payout</th>
                          <th style={thtdStyle}>Receipt</th>
                          <th style={thtdStyle}>Payment ID</th>
                          <th style={thtdStyle}>Student Unique ID</th>
                          <th style={thtdStyle}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows
                          .filter((r) => {
                            if (statusFilter === "paid" && r.commissionStatus !== "Paid") return false;
                            if (statusFilter === "pending" && r.commissionStatus === "Paid") return false;
                            if (!search) return true;
                            const q = String(search).toLowerCase();
                            return (
                              String(r.studentName || "").toLowerCase().includes(q) ||
                              String(r.paymentId || "").toLowerCase().includes(q) ||
                              String(r.packageName || "").toLowerCase().includes(q) ||
                              String(r.studentUniqueId || "").toLowerCase().includes(q)
                            );
                          })
                          .map((r) => (
                            <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                              <td style={thtdStyle}>{r.studentName || "—"}</td>
                              <td style={thtdStyle}>{r.packageName || "—"}</td>
                              <td style={thtdStyle}>₹{safeNumber(r.packageCost).toFixed(2)}</td>
                              <td style={thtdStyle}>₹{safeNumber(r.discount).toFixed(2)}</td>
                              <td style={{ ...thtdStyle, fontWeight: 700 }}>₹{safeNumber(r.totalPaid).toFixed(2)}</td>
                              <td style={thtdStyle}>{safeNumber(r.commissionPercent).toFixed(2)}%</td>
                              <td style={{ ...thtdStyle, color: "#16a34a", fontWeight: 700 }}>₹{safeNumber(r.commissionAmount).toFixed(2)}</td>
                              <td style={thtdStyle}>{r.commissionStatus}</td>
                              <td style={thtdStyle}>{formatDateTime(r.purchaseAt)}</td>
                              <td style={thtdStyle}>{formatDateTime(r.adminPaidAt)}</td>
                              <td style={thtdStyle}>
                                {r.receiptUrl ? (
                                  <div style={{ display: "flex", gap: 6 }}>
                                    <button onClick={() => openReceipt(r.receiptUrl)} style={{ padding: "6px 8px", borderRadius: 6, background: "#eef2ff", border: "none" }}>
                                      View
                                    </button>
                                    <button onClick={() => downloadReceipt(r.receiptUrl)} style={{ padding: "6px 8px", borderRadius: 6, background: "#fff", border: "1px solid #e6e6e6" }}>
                                      Download
                                    </button>
                                  </div>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td style={thtdStyle}>{r.paymentId || "—"}</td>
                              <td style={thtdStyle}>{r.studentUniqueId || "—"}</td>
                              <td style={thtdStyle}>
                                {r.commissionStatus === "Paid" ? (
                                  <button onClick={() => { if (r.receiptUrl) openReceipt(r.receiptUrl); else alert("Already marked paid."); }} style={{ padding: "6px 8px", borderRadius: 6 }}>
                                    View
                                  </button>
                                ) : (
                                  <button onClick={() => openMarkModalForRow(r)} style={{ padding: "6px 8px", borderRadius: 6, background: "#059669", color: "#fff", border: "none" }}>
                                    Mark Paid
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {rows.map((r) => (
                      <div key={r.id} style={{ background: "#fff", padding: 12, borderRadius: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <div style={{ fontWeight: 800 }}>{r.studentName || "—"}</div>
                          {/* removed UID from top so buttons remain within viewport; it'll be last below */}
                          <div style={{ color: "#64748b" }}>{/* UID intentionally left out here */}</div>
                        </div>
                        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 12, color: "#64748b" }}>Course</div>
                            <div style={{ fontWeight: 700 }}>{r.packageName || "—"}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 12, color: "#64748b" }}>Paid</div>
                            <div style={{ fontWeight: 700 }}>₹{safeNumber(r.totalPaid).toFixed(2)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 12, color: "#64748b" }}>Commission</div>
                            <div style={{ color: "#16a34a", fontWeight: 700 }}>₹{safeNumber(r.commissionAmount).toFixed(2)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 12, color: "#64748b" }}>Status</div>
                            <div style={{ fontWeight: 700 }}>{r.commissionStatus}</div>
                          </div>
                        </div>
                        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                          {r.receiptUrl ? (
                            <>
                              <button onClick={() => openReceipt(r.receiptUrl)} style={{ padding: "6px 8px", borderRadius: 6 }}>View</button>
                              <button onClick={() => downloadReceipt(r.receiptUrl)} style={{ padding: "6px 8px", borderRadius: 6 }}>Download</button>
                            </>
                          ) : (
                            <button onClick={() => openMarkModalForRow(r)} style={{ padding: "6px 8px", borderRadius: 6, background: "#059669", color: "#fff", border: "none" }}>Mark Paid</button>
                          )}
                          <div style={{ marginLeft: "auto", color: "#475569", fontSize: 12 }}>{formatDateTime(r.purchaseAt)}</div>
                        </div>

                        {/* Student UID relocated to last position in card */}
                        <div style={{ marginTop: 8, color: "#64748b", fontSize: 13 }}>
                          UID: {r.studentUniqueId || "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 18, display: "flex", gap: 12, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ background: "#ecfccb", padding: 12, borderRadius: 8, color: "#365314", fontWeight: 700 }}>Commission paid: ₹{totalCommissionPaid.toFixed(2)}</div>
                  <div style={{ background: "#fff7ed", padding: 12, borderRadius: 8, color: "#92400e", fontWeight: 700 }}>Commission pending: ₹{totalCommissionPending.toFixed(2)}</div>
                  <div style={{ background: "#eef2ff", padding: 12, borderRadius: 8, color: "#3730a3", fontWeight: 700 }}>Entries: {rows.filter(r => {
                    if (statusFilter === "paid" && r.commissionStatus !== "Paid") return false;
                    if (statusFilter === "pending" && r.commissionStatus === "Paid") return false;
                    if (!search) return true;
                    const q = String(search).toLowerCase();
                    return (
                      String(r.studentName || "").toLowerCase().includes(q) ||
                      String(r.paymentId || "").toLowerCase().includes(q) ||
                      String(r.packageName || "").toLowerCase().includes(q) ||
                      String(r.studentUniqueId || "").toLowerCase().includes(q)
                    );
                  }).length}</div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Add Manual Payment Modal */}
      {showAddPayModal && selectedPromoter && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 2000 }}>
          <div ref={panelRef} style={{ width: 520, background: "white", borderRadius: 8, padding: 20 }}>
            <h3 style={{ marginTop: 0 }}>Add Paid Details — {selectedPromoter.name}</h3>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label>Paid amount (INR)</label>
                <input type="number" value={addPaidAmount} onChange={(e) => setAddPaidAmount(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
              </div>
              <div>
                <label>Note (optional)</label>
                <input value={addPaidNote} onChange={(e) => setAddPaidNote(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
              </div>
              <div>
                <label>Upload receipt (image or PDF)</label>
                <input type="file" accept="image/*,application/pdf" onChange={(e) => setAddReceiptFile(e.target.files?.[0] || null)} />
                {addReceiptFile && <div style={{ marginTop: 8, fontSize: 13 }}>{addReceiptFile.name}</div>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={submitAddManualPayment} disabled={processingAdd} style={{ padding: "8px 12px", background: "#059669", color: "#fff", borderRadius: 8, border: "none" }}>
                  {processingAdd ? "Processing..." : "Submit & Mark Paid"}
                </button>
                <button onClick={() => { if (processingAdd) return alert("Processing..."); setShowAddPayModal(false); }} style={{ padding: "8px 12px", borderRadius: 8 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mark Single Row Paid Modal */}
      {showMarkModal && markingRow && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 2000 }}>
          <div style={{ width: 520, background: "white", borderRadius: 8, padding: 20 }}>
            <h3 style={{ marginTop: 0 }}>Mark Paid — {markingRow.studentName || markingRow.paymentId}</h3>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, color: "#475569" }}>Payment ID: {markingRow.paymentId}</div>
                <div style={{ fontSize: 13, color: "#475569" }}>Course: {markingRow.packageName}</div>
                <div style={{ fontSize: 13, color: "#475569" }}>Commission: ₹{safeNumber(markingRow.commissionAmount).toFixed(2)}</div>
              </div>
              <div>
                <label>Upload receipt (image or PDF)</label>
                <input type="file" accept="image/*,application/pdf" onChange={(e) => setMarkReceiptFile(e.target.files?.[0] || null)} />
                {markReceiptFile && <div style={{ marginTop: 8, fontSize: 13 }}>{markReceiptFile.name}</div>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={submitMarkRowPaid} disabled={processingMark} style={{ padding: "8px 12px", background: "#059669", color: "#fff", borderRadius: 8, border: "none" }}>
                  {processingMark ? "Processing..." : "Mark Paid"}
                </button>
                <button onClick={() => { if (processingMark) return alert("Processing..."); setShowMarkModal(false); setMarkingRow(null); }} style={{ padding: "8px 12px", borderRadius: 8 }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
