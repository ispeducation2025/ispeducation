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

// ========== ADMIN UID (same as Cloud Functions) ==========
const ADMIN_UID = "Q3Z7mgam8IOMQWQqAdwWEQmpqNn2";
// ========================================================

export default function PromoterDatabase() {
  const [promoters, setPromoters] = useState([]);
  const [selectedPromoter, setSelectedPromoter] = useState(null);
  const [studentsForPromoter, setStudentsForPromoter] = useState([]);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const panelRef = useRef(null);
  const navigate = useNavigate();

  // Manual payment modal state
  const [showPayModal, setShowPayModal] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [paidNote, setPaidNote] = useState("");
  const [receiptFile, setReceiptFile] = useState(null);
  const [processing, setProcessing] = useState(false);

  // Payments cache
  const [paymentsCache, setPaymentsCache] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Combined loader: promoters + payments
  const loadAllData = async () => {
    setLoading(true);
    try {
      // 1) load users (promoters)
      const usersSnap = await getDocs(collection(db, "users"));
      const promoterList = usersSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.role === "promoter" || p.alsoPromoter === true);

      // 2) load payments (only necessary fields)
      const paymentsSnap = await getDocs(collection(db, "payments"));
      const payments = paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      setPaymentsCache(payments);

      // 3) compute derived promoter fields from payments
      const promoterMap = {};
      // helper normalize
      const norm = (v) => (v || "").toString().toLowerCase().trim();

      for (const p of promoterList) {
        promoterMap[p.id] = {
          ...p,
          computed_pendingAmount: 0,
          computed_totalCommission: 0,
          computed_lastPaymentAt: p.lastPayment || null,
          computed_lastPaidAmount: p.lastPaidAmount || null,
          computed_commissionRowsCount: 0,
        };
      }

      // Build a fast lookup by promoter unique identifiers too (uniqueId values)
      const uidToPromoterId = {};
      for (const p of promoterList) {
        const keys = [
          p.id && p.id.toString(),
          p.uid && p.uid.toString(),
          p.uniqueId && p.uniqueId.toString(),
          p.referralId && p.referralId.toString(),
          p.promoterId && p.promoterId.toString(),
        ].filter(Boolean);
        keys.forEach((k) => {
          uidToPromoterId[norm(k)] = p.id;
        });
      }

      // scan payments and attribute to promoter map
      for (const pay of payments) {
        // gather many variants to match
        const candidates = new Set();
        [
          pay.promoterUid,
          pay.promoterId,
          pay.promoter,
          pay.promoter_id,
          pay.promoterUniqueId,
          pay.promoterUniqueID,
          pay.mappedPromoter,
          pay.promoterUniqueId || (pay.promoterResolved && pay.promoterResolved.promoterUniqueId),
          pay.promoterUid || (pay.promoterResolved && pay.promoterResolved.promoterUid),
        ]
          .filter(Boolean)
          .forEach((x) => candidates.add(norm(x)));

        // also check payment.raw fields (some gateway payload)
        if (pay.raw && typeof pay.raw === "object") {
          const raw = JSON.stringify(pay.raw);
          // cheap: if promoter unique id string appears anywhere - not perfect but okay as fallback
          // (we avoid making heavy parsing here)
          // skip for now
        }

        // try direct matches to user doc id or mapped unique id
        let matchedPromoterId = null;
        for (const c of candidates) {
          if (uidToPromoterId[c]) {
            matchedPromoterId = uidToPromoterId[c];
            break;
          }
        }

        // fallback: try to match by exact strings stored in user fields
        if (!matchedPromoterId) {
          // attempt brute force: check every promoter against common fields in payment
          for (const p of promoterList) {
            const possible = [
              p.referralId,
              p.referral,
              p.promoterId,
              p.promoterUid,
              p.promoter,
              p.referredBy,
              p.referrer,
              p.referral_id,
              p.uniqueId,
            ]
              .filter(Boolean)
              .map((v) => norm(v));
            const has = [...candidates].some((c) => possible.includes(c));
            if (has) {
              matchedPromoterId = p.id;
              break;
            }
          }
        }

        if (!matchedPromoterId) continue; // payment not attributable to any promoter in list

        // compute commission amount for this payment
        // Payment may carry commissionTotal or commissionAmount fields or packages[] with commissionAmount
        let commissionAmount = 0;
        if (pay.commissionTotal) commissionAmount = Number(pay.commissionTotal) || 0;
        else if (pay.commissionAmount) commissionAmount = Number(pay.commissionAmount) || 0;
        else if (Array.isArray(pay.packages)) {
          commissionAmount = pay.packages.reduce((s, x) => s + (Number(x.commissionAmount || x.commission || 0) || 0), 0);
        } else {
          // try common single-field fallbacks
          commissionAmount = Number(pay.promoterCommissionAmount || pay.commission || 0) || 0;
        }

        // determine if commission already marked paid to promoter
        const commissionPaidFlag =
          pay.promoterPaid === true ||
          pay.commissionPaid === true ||
          pay.adminMarked === true ||
          ["commission_paid", "settled", "completed"].includes((pay.status || pay.paymentStatus || pay.settlementStatus || "").toString().toLowerCase());

        // update promoter map
        const m = promoterMap[matchedPromoterId];
        if (!m) continue;
        m.computed_totalCommission = (m.computed_totalCommission || 0) + commissionAmount;
        if (!commissionPaidFlag) {
          m.computed_pendingAmount = (m.computed_pendingAmount || 0) + commissionAmount;
        }
        m.computed_commissionRowsCount = (m.computed_commissionRowsCount || 0) + 1;

        // update last payment info (use paidAt or createdAt)
        const candidateDate = pay.paidAt || pay.paidAt?.seconds ? pay.paidAt : pay.createdAt || pay.createdAtClient || pay.paidAt;
        const candTime = candidateDate && candidateDate.seconds ? candidateDate.seconds * 1000 : candidateDate ? new Date(candidateDate).getTime() : 0;
        const prevTime = m.computed_lastPaymentAt ? (m.computed_lastPaymentAt.seconds ? m.computed_lastPaymentAt.seconds * 1000 : new Date(m.computed_lastPaymentAt).getTime()) : 0;
        if (candTime && candTime > prevTime) {
          m.computed_lastPaymentAt = candidateDate;
          m.computed_lastPaidAmount = pay.amount || pay.commissionAmount || commissionAmount || m.computed_lastPaidAmount;
        }
      } // end payments loop

      // Build final promoters array with computed fields
      const finalPromoters = Object.values(promoterMap).map((p) => ({
        ...p,
        // ensure numeric
        computed_pendingAmount: Number(p.computed_pendingAmount || 0),
        computed_totalCommission: Number(p.computed_totalCommission || 0),
        computed_commissionRowsCount: Number(p.computed_commissionRowsCount || 0),
      }));

      setPromoters(finalPromoters);
    } catch (err) {
      console.error("Error loading promoters/payments:", err);
      alert("Failed to load data — check console.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setSelectedPromoter(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const openAddPaidModal = (promoter) => {
    setSelectedPromoter(promoter);
    setPaidAmount(promoter?.computed_pendingAmount ? String(promoter.computed_pendingAmount) : String(promoter.pendingAmount || ""));
    setPaidNote("");
    setReceiptFile(null);
    setShowPayModal(true);
  };

  const closeAddPaidModal = () => {
    setShowPayModal(false);
    setSelectedPromoter(null);
    setPaidAmount("");
    setPaidNote("");
    setReceiptFile(null);
  };

  const uploadFileWithTimeout = (file, path, timeoutMs = 60_000) => {
    return new Promise((resolve, reject) => {
      if (!storage) {
        return reject(new Error("Firebase storage not initialized."));
      }
      try {
        const sref = storageRef(storage, path);
        const task = uploadBytesResumable(sref, file);

        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          try {
            if (typeof task.cancel === "function") task.cancel();
          } catch (e) {
            console.warn("Error cancelling upload after timeout:", e);
          }
          reject(new Error(`Upload timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        task.on(
          "state_changed",
          (snapshot) => {
            const pct = snapshot.totalBytes ? ((snapshot.bytesTransferred / snapshot.totalBytes) * 100).toFixed(1) : "0";
            console.log(`Upload progress: ${pct}% (${snapshot.bytesTransferred}/${snapshot.totalBytes})`);
          },
          (error) => {
            clearTimeout(timer);
            if (timedOut) return;
            console.error("Upload failed:", error);
            reject(error);
          },
          async () => {
            clearTimeout(timer);
            if (timedOut) return;
            try {
              const url = await getDownloadURL(task.snapshot.ref);
              resolve(url);
            } catch (e) {
              console.error("getDownloadURL failed:", e);
              reject(e);
            }
          }
        );
      } catch (err) {
        reject(err);
      }
    });
  };

  const refreshPromoters = async () => {
    await loadAllData();
  };

  // upload receipt to storage and create payments doc + update promoter doc
  const submitManualPayment = async () => {
    if (!selectedPromoter) return alert("No promoter selected.");
    const amt = Number(paidAmount);
    if (!amt || amt <= 0) return alert("Enter a valid paid amount.");

    // Admin auth check
    const current = auth.currentUser;
    if (!current) return alert("Please log in as admin to mark payment.");
    if (current.uid !== ADMIN_UID) return alert("Only admin (configured UID) can mark payments from this UI.");

    setProcessing(true);

    try {
      // 1) Upload receipt if provided
      let receiptUrl = null;
      if (receiptFile) {
        try {
          const safeName = `${selectedPromoter.id}_${Date.now()}_${receiptFile.name.replace(/\s+/g, "_")}`;
          const remotePath = `receipts/${safeName}`;
          receiptUrl = await uploadFileWithTimeout(receiptFile, remotePath, 120000);
        } catch (uploadErr) {
          const keepProceed = window.confirm(
            "Receipt upload failed: " + (uploadErr?.message || uploadErr) + "\n\nDo you want to continue and mark payment without uploading receipt?"
          );
          if (!keepProceed) {
            throw uploadErr;
          }
        }
      }

      // 2) Prepare payment payload
      const paymentPayload = {
        promoterId: selectedPromoter.id,
        promoterName: selectedPromoter.name || null,
        amount: amt, // this is commission paid now
        commissionAmount: amt,
        commissionPaid: true,
        promoterPaid: true,
        currency: "INR",
        note: paidNote || "",
        status: "commission_paid", // explicit status for promoter commission payouts
        receiptUrl: receiptUrl || null,
        paidBy: current.uid,
        paidAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        adminMarked: true,
      };

      // 3) Preferred path: call Cloud Function 'adminCreatePayment' (callable)
      let paymentDocId = null;
      const functions = getFunctions();
      try {
        const fn = httpsCallable(functions, "adminCreatePayment");
        const resp = await fn({ payment: paymentPayload });
        if (resp && resp.data && (resp.data.success || resp.data.id)) {
          paymentDocId = resp.data.id || resp.data.paymentId || null;
        }
      } catch (fnErr) {
        // callable may fail; fall back
      }

      // 4) Fallback: attempt client-side addDoc only if callable didn't create doc
      if (!paymentDocId) {
        try {
          const pRef = await addDoc(collection(db, "payments"), {
            ...paymentPayload,
            paidAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          });
          paymentDocId = pRef.id;
        } catch (addDocErr) {
          throw new Error(
            "Could not create payment record. Deploy a server callable 'adminCreatePayment' to create payments server-side, or allow admin writes to /payments."
          );
        }
      }

      // 5) (Optional) attempt to update promoter user doc to reflect lastPayment, pending etc.
      // It's safer to keep computed values derived from /payments (we refresh below).
      try {
        const userRef = doc(db, "users", selectedPromoter.id);
        await updateDoc(userRef, {
          lastPayment: new Date().toISOString(),
          lastPaidAmount: amt,
          promoterPaid: true,
          // do NOT rely on pendingAmount here; recompute from payments on next refresh instead
        });
      } catch (udErr) {
        console.warn("Failed to update promoter doc after payment:", udErr);
      }

      // 6) Refresh promoter entry locally (recompute from payments)
      await refreshPromoters();

      alert("Marked commission as paid and uploaded receipt (if provided).");
      closeAddPaidModal();
    } catch (err) {
      console.error("submitManualPayment error:", err);
      alert("Failed to submit payment: " + (err?.message || String(err)));
    } finally {
      setProcessing(false);
    }
  };

  // New: fetch students attached to a promoter (admin-only)
  const fetchStudentsForPromoter = async (promoter) => {
    if (!promoter) return setStudentsForPromoter([]);
    try {
      const results = [];
      const seen = new Set();

      const uid = promoter.id || promoter.uid;
      const uniqueId = promoter.uniqueId || promoter.referralId || promoter.uniqueID || promoter.unique_id || null;

      if (uniqueId) {
        const q1 = query(collection(db, "users"), where("referralId", "==", uniqueId));
        const snap1 = await getDocs(q1);
        snap1.forEach((d) => {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            results.push({ id: d.id, ...d.data() });
          }
        });

        const q2 = query(collection(db, "users"), where("referral", "==", uniqueId));
        const snap2 = await getDocs(q2);
        snap2.forEach((d) => {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            results.push({ id: d.id, ...d.data() });
          }
        });
      }

      if (uid) {
        const q3 = query(collection(db, "users"), where("promoterUid", "==", uid));
        const snap3 = await getDocs(q3);
        snap3.forEach((d) => {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            results.push({ id: d.id, ...d.data() });
          }
        });

        const q4 = query(collection(db, "users"), where("promoterId", "==", uid));
        const snap4 = await getDocs(q4);
        snap4.forEach((d) => {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            results.push({ id: d.id, ...d.data() });
          }
        });

        const q5 = query(collection(db, "users"), where("promoter", "==", uid));
        const snap5 = await getDocs(q5);
        snap5.forEach((d) => {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            results.push({ id: d.id, ...d.data() });
          }
        });
      }

      if (results.length === 0) {
        const allSnap = await getDocs(collection(db, "users"));
        allSnap.forEach((d) => {
          const u = { id: d.id, ...d.data() };
          const possible = [
            u.referralId,
            u.referral,
            u.promoterId,
            u.promoterUid,
            u.promoter,
            u.referredBy,
            u.referrer,
            u.referral_id,
          ].filter(Boolean).map((v) => String(v).toLowerCase().trim());
          const normalizedTarget = (uniqueId || uid || "").toString().toLowerCase().trim();
          if (normalizedTarget && possible.includes(normalizedTarget)) {
            if (!seen.has(u.id)) {
              seen.add(u.id);
              results.push(u);
            }
          }
        });
      }

      setStudentsForPromoter(results);
      setShowStudentModal(true);
    } catch (err) {
      console.error("fetchStudentsForPromoter failed:", err);
      alert("Failed to fetch students. Check console for details.");
    }
  };

  const openStudents = (promoter) => {
    fetchStudentsForPromoter(promoter);
  };

  const fmt = (v) => (v || v === 0 ? "₹" + Number(v).toLocaleString("en-IN") : "-");
  const thtdStyle = { border: "1px solid #ddd", padding: "8px 10px", textAlign: "left" };

  return (
    <div style={{ padding: 20, background: "#f9fafb", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ color: "#0284c7" }}>Promoter Database — Manual Payouts</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={refreshPromoters}
            style={{ background: "#0ea5e9", color: "#fff", padding: "8px 12px", borderRadius: 8, border: "none" }}
          >
            Refresh from payments
          </button>
          <button
            onClick={() => navigate("/admin-dashboard")}
            style={{ background: "#0284c7", color: "#fff", padding: "8px 12px", borderRadius: 8, border: "none" }}
          >
            ← Back
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <p style={{ color: "#334155" }}>
          Manual payout flow enabled. This view now computes pending totals from the <code>/payments</code> collection (preferred) — so users.pendingAmount is not required.
        </p>
      </div>

      <div style={{ overflowX: "auto", marginTop: 12 }}>
        {loading ? (
          <div style={{ padding: 20, color: "#6b7280" }}>Loading promoters and payments...</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#e0f2fe" }}>
                <th style={thtdStyle}>Name</th>
                <th style={thtdStyle}>Email</th>
                <th style={thtdStyle}>Phone</th>
                <th style={thtdStyle}>Unique ID</th>
                <th style={thtdStyle}>Pending (computed)</th>
                <th style={thtdStyle}>Total Commission</th>
                <th style={thtdStyle}>Last Payment</th>
                <th style={thtdStyle}>#Records</th>
                <th style={thtdStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {promoters.map((p) => {
                const pending = Number(p.computed_pendingAmount ?? p.pendingAmount ?? 0);
                const totalCommission = Number(p.computed_totalCommission ?? 0);
                const status = pending === 0 ? "No Dues" : "Pending";
                const lastPay = p.computed_lastPaymentAt || p.lastPayment || "-";
                const lastPayStr = lastPay && (lastPay.seconds ? new Date(lastPay.seconds * 1000).toLocaleString() : new Date(lastPay).toLocaleString()) || "-";
                return (
                  <tr key={p.id} style={{ background: "white", cursor: "default" }}>
                    <td style={thtdStyle}>{p.name}</td>
                    <td style={thtdStyle}>{p.email}</td>
                    <td style={thtdStyle}>{p.phone || "-"}</td>
                    <td style={thtdStyle}>{p.uniqueId || p.referralId || "-"}</td>
                    <td style={thtdStyle}>{fmt(pending)}</td>
                    <td style={thtdStyle}>{fmt(totalCommission)}</td>
                    <td style={thtdStyle}>{lastPayStr}</td>
                    <td style={thtdStyle}>{p.computed_commissionRowsCount || 0}</td>
                    <td style={thtdStyle}>
                      <button
                        onClick={() => openAddPaidModal(p)}
                        style={{ background: "#0ea5e9", color: "white", padding: "6px 10px", borderRadius: 6, border: "none" }}
                      >
                        Add Paid Details
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openStudents(p);
                        }}
                        style={{ background: "#0ea5e9", color: "white", padding: "6px 10px", marginLeft: 6, borderRadius: 6, border: "none" }}
                      >
                        View Students
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Paid Details modal */}
      {showPayModal && selectedPromoter && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 2000,
          }}
        >
          <div ref={panelRef} style={{ width: 520, background: "white", borderRadius: 8, padding: 20 }}>
            <h3 style={{ marginTop: 0 }}>Add Paid Details — {selectedPromoter.name}</h3>

            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label>Paid amount (INR)</label>
                <input
                  type="number"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>

              <div>
                <label>Note (optional)</label>
                <input
                  value={paidNote}
                  onChange={(e) => setPaidNote(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>

              <div>
                <label>Upload receipt (image or PDF)</label>
                <input type="file" accept="image/*,application/pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} />
                {receiptFile && <div style={{ marginTop: 8, fontSize: 13 }}>{receiptFile.name}</div>}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button
                  onClick={submitManualPayment}
                  disabled={processing}
                  style={{ padding: "8px 12px", background: "#059669", color: "#fff", borderRadius: 8, border: "none" }}
                >
                  {processing ? "Processing..." : "Submit & Mark Paid"}
                </button>
                <button
                  onClick={() => {
                    if (processing) {
                      alert("Cannot cancel while processing. Please wait or check the console for errors.");
                      return;
                    }
                    closeAddPaidModal();
                  }}
                  style={{ padding: "8px 12px", borderRadius: 8 }}
                >
                  Cancel
                </button>
              </div>

              <div style={{ color: "#6b7280", fontSize: 13 }}>
                Tip: if upload gets stuck, check browser console (F12 → Console) and Network tab for errors. Common issues: Storage rules or auth preventing upload, large file size, or network interruption.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Students modal */}
      {showStudentModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 2000,
          }}
          onClick={() => setShowStudentModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "80%", maxHeight: "80%", overflowY: "auto", background: "white", borderRadius: 8, padding: 20 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Students for Promoter</h3>
              <button onClick={() => setShowStudentModal(false)} style={{ padding: 6, borderRadius: 6 }}>Close</button>
            </div>

            <div style={{ marginTop: 12 }}>
              {studentsForPromoter.length === 0 ? (
                <div style={{ color: "#6b7280" }}>No students found for this promoter.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f3f4f6" }}>
                      <th style={thtdStyle}>Name</th>
                      <th style={thtdStyle}>Email</th>
                      <th style={thtdStyle}>Phone</th>
                      <th style={thtdStyle}>Class</th>
                      <th style={thtdStyle}>Syllabus</th>
                      <th style={thtdStyle}>Referral / Promoter Field</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentsForPromoter.map((s) => (
                      <tr key={s.id} style={{ background: "white" }}>
                        <td style={thtdStyle}>{s.name}</td>
                        <td style={thtdStyle}>{s.email}</td>
                        <td style={thtdStyle}>{s.phone || "-"}</td>
                        <td style={thtdStyle}>{s.classGrade || "-"}</td>
                        <td style={thtdStyle}>{s.syllabus || "-"}</td>
                        <td style={thtdStyle}>
                          {s.referralId || s.referral || s.promoterUid || s.promoterId || s.promoter || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
