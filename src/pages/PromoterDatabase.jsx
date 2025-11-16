// src/pages/PromoterDatabase.jsx
import React, { useEffect, useState, useRef } from "react";
import { db, auth, storage } from "../firebase/firebaseConfig";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";

/**
 * PromoterDatabase.jsx — manual payout (Add Paid Details + receipt upload)
 *
 * Improvements:
 * - Uses uploadBytesResumable with a timeout to avoid indefinite "Processing..."
 * - Detailed console logs & visible alerts on errors
 * - Ensures setProcessing(false) runs on all code paths
 */

// ========== ADMIN UID (same as Cloud Functions) ==========
const ADMIN_UID = "Q3Z7mgam8IOMQWQqAdwWEQmpqNn2";
// ========================================================

export default function PromoterDatabase() {
  const [promoters, setPromoters] = useState([]);
  const [selectedPromoter, setSelectedPromoter] = useState(null);
  const panelRef = useRef(null);
  const navigate = useNavigate();

  // Manual payment modal state
  const [showPayModal, setShowPayModal] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [paidNote, setPaidNote] = useState("");
  const [receiptFile, setReceiptFile] = useState(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const fetchPromoters = async () => {
      try {
        const snapshot = await getDocs(collection(db, "users"));
        const promoterList = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.role === "promoter" || p.alsoPromoter === true);
        setPromoters(promoterList);
      } catch (err) {
        console.error("Error fetching promoters:", err);
      }
    };
    fetchPromoters();
  }, []);

  // Close panel on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setSelectedPromoter(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // open manual "Add Paid Details" modal (admin will upload receipt & fill amount)
  const openAddPaidModal = (promoter) => {
    setSelectedPromoter(promoter);
    setPaidAmount(promoter?.pendingAmount ? String(promoter.pendingAmount) : "");
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

  // helper: upload with resumable + timeout
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
            // attempt to cancel the task (may throw in some SDK versions)
            if (typeof task.cancel === "function") task.cancel();
          } catch (e) {
            console.warn("Error cancelling upload after timeout:", e);
          }
          reject(new Error(`Upload timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        task.on(
          "state_changed",
          (snapshot) => {
            // optional: progress logging
            const pct = ((snapshot.bytesTransferred / snapshot.totalBytes) * 100).toFixed(1);
            // eslint-disable-next-line no-console
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

  // upload receipt to storage and create payments doc + update promoter doc
  const submitManualPayment = async () => {
    if (!selectedPromoter) return alert("No promoter selected.");
    const amt = Number(paidAmount);
    if (!amt || amt <= 0) return alert("Enter valid paid amount.");

    // Admin auth check
    const current = auth.currentUser;
    if (!current) return alert("Please login as admin to mark payment.");
    if (current.uid !== ADMIN_UID) return alert("Only admin can mark payments.");

    setProcessing(true);
    console.log("submitManualPayment: started", { promoterId: selectedPromoter.id, amt });

    try {
      // 1) Upload receipt if provided
      let receiptUrl = null;
      if (receiptFile) {
        console.log("Uploading receipt:", receiptFile.name);
        try {
          const safeName = `${selectedPromoter.id}_${Date.now()}_${receiptFile.name.replace(/\s+/g, "_")}`;
          const remotePath = `receipts/${safeName}`;
          // timeout 60s (adjust if needed)
          receiptUrl = await uploadFileWithTimeout(receiptFile, remotePath, 120000);
          console.log("Receipt uploaded, URL:", receiptUrl);
        } catch (uploadErr) {
          console.error("Receipt upload failed:", uploadErr);
          // surface error but allow operator to retry or continue without receipt
          const keepProceed = window.confirm(
            "Receipt upload failed: " + (uploadErr?.message || uploadErr) + "\n\nDo you want to continue and mark payment without uploading receipt?"
          );
          if (!keepProceed) {
            throw uploadErr;
          }
        }
      } else {
        console.log("No receipt provided; continuing without upload.");
      }

      // 2) Create payment record in `payments` collection
      const paymentPayload = {
        promoterId: selectedPromoter.id,
        promoterName: selectedPromoter.name || null,
        amount: amt,
        currency: "INR",
        note: paidNote || "",
        status: "paid",
        receiptUrl: receiptUrl || null,
        paidBy: current.uid,
        paidAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      };

      console.log("Adding payment doc:", paymentPayload);
      let paymentRef;
      try {
        paymentRef = await addDoc(collection(db, "payments"), paymentPayload);
        console.log("Payment doc created:", paymentRef.id);
      } catch (addDocErr) {
        console.error("Failed creating payment doc:", addDocErr);
        throw addDocErr;
      }

      // 3) Update promoter user doc: lastPayment, lastPaidAmount, promoterPaid true, reduce pendingAmount
      try {
        const userRef = doc(db, "users", selectedPromoter.id);
        const prevPending = Number(selectedPromoter.pendingAmount || 0);
        const newPending = Math.max(0, prevPending - amt);

        console.log("Updating promoter doc, newPending:", newPending);
        await updateDoc(userRef, {
          lastPayment: new Date().toISOString(),
          lastPaidAmount: amt,
          promoterPaid: true,
          pendingAmount: newPending,
          lastReceiptUrl: receiptUrl || null,
        });
      } catch (udErr) {
        // update failed but we still created payment doc — log and continue
        console.warn("Failed to update promoter doc after payment:", udErr);
        // Surface to admin so they can correct manually
        alert("Payment created but failed to update promoter record. Check console for details.");
      }

      // 4) Refresh promoter list locally
      try {
        const snapshot = await getDocs(collection(db, "users"));
        const promoterList = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.role === "promoter" || p.alsoPromoter === true);
        setPromoters(promoterList);
      } catch (refreshErr) {
        console.warn("Failed to refresh promoter list:", refreshErr);
      }

      alert("Marked as paid and uploaded receipt (if provided).");
      closeAddPaidModal();
    } catch (err) {
      console.error("submitManualPayment error (final):", err);
      alert("Failed to submit payment: " + (err?.message || String(err)));
    } finally {
      // IMPORTANT: always clear processing so UI is usable again
      setProcessing(false);
      console.log("submitManualPayment: finished (processing=false)");
    }
  };

  const fmt = (v) => (v || v === 0 ? "₹" + Number(v).toLocaleString("en-IN") : "-");
  const thtdStyle = { border: "1px solid #ddd", padding: "8px 10px", textAlign: "left" };

  return (
    <div style={{ padding: 20, background: "#f9fafb", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2 style={{ color: "#0284c7" }}>Promoter Database — Manual Payouts</h2>
        <button
          onClick={() => navigate("/admin-dashboard")}
          style={{ background: "#0284c7", color: "#fff", padding: "8px 16px", borderRadius: 8, border: "none" }}
        >
          ← Back
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <p style={{ color: "#334155" }}>
          Manual payout flow enabled. Click <b>Add Paid Details</b> to upload PhonePe receipt and mark a promoter's payment as paid.
        </p>
      </div>

      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#e0f2fe" }}>
              <th style={thtdStyle}>Name</th>
              <th style={thtdStyle}>Email</th>
              <th style={thtdStyle}>Phone</th>
              <th style={thtdStyle}>Unique ID</th>
              <th style={thtdStyle}>Pending</th>
              <th style={thtdStyle}>Last Payment</th>
              <th style={thtdStyle}>Status</th>
              <th style={thtdStyle}>Action</th>
            </tr>
          </thead>
          <tbody>
            {promoters.map((p) => {
              const status = p.pendingAmount === 0 ? "No Dues" : "Pending";
              return (
                <tr key={p.id} style={{ background: "white", cursor: "default" }}>
                  <td style={thtdStyle}>{p.name}</td>
                  <td style={thtdStyle}>{p.email}</td>
                  <td style={thtdStyle}>{p.phone || "-"}</td>
                  <td style={thtdStyle}>{p.uniqueId}</td>
                  <td style={thtdStyle}>{fmt(p.pendingAmount)}</td>
                  <td style={thtdStyle}>{p.lastPayment || "-"}</td>
                  <td style={{ ...thtdStyle, color: status === "No Dues" ? "green" : "#eab308", fontWeight: 600 }}>{status}</td>
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
                        window.open(`/promoter-students/${p.id}`, "_self");
                      }}
                      style={{ background: "#0ea5e9", color: "white", padding: "6px 10px", marginLeft: 6, borderRadius: 6, border: "none" }}
                    >
                      Students
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
          <div style={{ width: 520, background: "white", borderRadius: 8, padding: 20 }}>
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
                <label>Upload PhonePe receipt (image or PDF)</label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                />
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
                      // do not close while processing
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
    </div>
  );
}
