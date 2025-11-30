/* src/pages/PromoterCommission.jsx */
import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase/firebaseConfig";
import { collection, query, where, getDocs } from "firebase/firestore";
import { useLocation, useNavigate, useParams } from "react-router-dom";

/**
 * PromoterCommission
 * - Attempts indexed queries by promoterDocId/promoterId/promoterUniqueId
 * - Fallback: full payments collection read + local filter
 * - One table row per purchased package inside a payment document
 * - Adds purchase datetime and admin payout datetime per row
 * - Responsive: shows table on desktop, stacked cards on small screens
 * - Added: filter (All / Paid / Pending), search (student name / payment id / course), Export CSV
 * - Added: Receipt column (View / Download) — reads receiptUrl from payment or package
 */

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

export default function PromoterCommission() {
  const { promoterId: paramPromoterId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isNarrow, setIsNarrow] = useState(typeof window !== "undefined" ? window.innerWidth < 820 : false);

  // UI controls
  const [statusFilter, setStatusFilter] = useState("all"); // all | paid | pending
  const [search, setSearch] = useState("");

  useEffect(() => {
    function onResize() {
      setIsNarrow(window.innerWidth < 820);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function derivePromoter() {
      const p = state?.promoter || {};
      const promoterDocId =
        p?.uid || p?.id || p?.docId || p?.promoterDocId || p?.promoterId || null;
      const promoterUniqueId =
        p?.uniqueId || p?.uniqueID || p?.unique_id || p?.referralId || null;
      const currentUid = auth && auth.currentUser ? auth.currentUser.uid : null;
      return {
        promoterDocId: promoterDocId || currentUid || paramPromoterId || null,
        promoterUniqueId: promoterUniqueId || null,
      };
    }

    async function fetchPayments() {
      setLoading(true);
      setError("");
      setRows([]);

      const { promoterDocId, promoterUniqueId } = await derivePromoter();

      if (!promoterDocId && !promoterUniqueId) {
        setError("Could not determine promoter. Provide promoter in route state or ensure you're logged in as the promoter.");
        setLoading(false);
        return;
      }

      const paymentsCol = collection(db, "payments");
      const accum = [];

      const pushPaymentPackages = (paymentDoc) => {
        const p = paymentDoc;
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

            // receipt url: prefer package-level, then payment-level fields
            const receiptUrl = safeString(pkg.receiptUrl || pkg.receipt || p.receiptUrl || p.receipt || "");

            accum.push({
              id: `${p.id || p.paymentId || "pay"}_${packageName}_${Math.random().toString(36).slice(2, 7)}`,
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
              receiptUrl,
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

          const receiptUrl = safeString(p.receiptUrl || p.receipt || "");

          accum.push({
            id: `${p.id || p.paymentId || "pay"}_${Math.random().toString(36).slice(2, 7)}`,
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
            receiptUrl,
          });
        }
      };

      try {
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

        if (accum.length === 0 && promoterDocId) {
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
              // ignore per-field errors
            }
          }
        }
      } catch (err) {
        console.warn("Indexed payments queries failed:", err);
      }

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
          if (mounted) {
            setError("Failed to load payments. Check Firestore rules or network.");
            setLoading(false);
            return;
          }
        }
      }

      // Reconcile with payouts (mark Paid & adminPaidAt)
      if (accum.length > 0 && (promoterDocId || promoterUniqueId)) {
        try {
          const payoutsCol = collection(db, "payouts");
          let pQuerySnap = null;
          if (promoterDocId) {
            try {
              const qP = query(payoutsCol, where("promoterId", "==", promoterDocId));
              pQuerySnap = await getDocs(qP);
            } catch (e) {
              console.warn("Query payouts by promoterId failed:", e?.message || e);
            }
          }
          if ((!pQuerySnap || pQuerySnap.empty) && promoterUniqueId) {
            try {
              const qP2 = query(payoutsCol, where("promoterUniqueId", "==", promoterUniqueId));
              pQuerySnap = await getDocs(qP2);
            } catch (e) {
              console.warn("Query payouts by promoterUniqueId failed:", e?.message || e);
            }
          }

          const paidPayouts = [];
          if (pQuerySnap && !pQuerySnap.empty) {
            pQuerySnap.forEach((d) => {
              const pd = d.data() || {};
              pd.id = d.id;
              const status = String(pd.status || "");
              if (status === "sent" || status === "confirmed" || status === "paid") {
                paidPayouts.push(pd);
              }
            });
          }

          if (paidPayouts.length > 0) {
            for (const pd of paidPayouts) {
              const payoutTimestamp =
                safeDate(pd.sentAt) || safeDate(pd.confirmedAt) || safeDate(pd.updatedAt) || safeDate(pd.createdAt) || null;

              if (pd.lastPaymentDoc) {
                accum.forEach((row) => {
                  if (String(row.paymentId) === String(pd.lastPaymentDoc)) {
                    row.commissionStatus = "Paid";
                    if (!row.adminPaidAt) row.adminPaidAt = payoutTimestamp;
                  }
                });
              }

              if (Array.isArray(pd.paymentsRefIds) && pd.paymentsRefIds.length) {
                pd.paymentsRefIds.forEach((pid) => {
                  accum.forEach((row) => {
                    if (String(row.paymentId) === String(pid)) {
                      row.commissionStatus = "Paid";
                      if (!row.adminPaidAt) row.adminPaidAt = payoutTimestamp;
                    }
                  });
                });
              }

              if (pd.meta && typeof pd.meta === "object") {
                const candidates = Object.values(pd.meta).map((x) => String(x || ""));
                accum.forEach((row) => {
                  if (candidates.some((c) => c.includes(String(row.paymentId)))) {
                    row.commissionStatus = "Paid";
                    if (!row.adminPaidAt) row.adminPaidAt = payoutTimestamp;
                  }
                });
              }

              if (pd.paymentId) {
                accum.forEach((row) => {
                  if (String(row.paymentId) === String(pd.paymentId)) {
                    row.commissionStatus = "Paid";
                    if (!row.adminPaidAt) row.adminPaidAt = payoutTimestamp;
                  }
                });
              }
            }
          }
        } catch (pErr) {
          console.warn("Payout reconciliation failed (non-fatal):", pErr?.message || pErr);
        }
      }

      if (mounted) {
        setRows(accum);
        setLoading(false);
        if (accum.length === 0) setError("No payments found for this promoter.");
      }
    }

    fetchPayments();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, paramPromoterId]);

  const totalCommissionPaid = rows.reduce((a, r) => a + (r.commissionStatus === "Paid" ? safeNumber(r.commissionAmount) : 0), 0);
  const totalCommissionPending = rows.reduce((a, r) => a + (r.commissionStatus !== "Paid" ? safeNumber(r.commissionAmount) : 0), 0);

  // filtered & searched rows
  const visibleRows = rows.filter((r) => {
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
  });

  function handleExportCsv() {
    if (!visibleRows.length) {
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
    const csvRows = visibleRows.map((r) => ({
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

  // Modified downloadReceipt: fetch as blob to force download (works with cross-origin storage URLs)
  async function downloadReceipt(url) {
    if (!url) return;
    try {
      // Attempt to fetch the resource as a blob
      const resp = await fetch(url, { mode: "cors" });
      if (!resp.ok) {
        // fallback: open in new window if fetch failed
        console.warn("Fetch failed with status", resp.status, "; falling back to open in new tab.");
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

      // Infer filename from URL if possible, else fallback to 'receipt'
      try {
        const parts = url.split("/");
        const rawName = parts[parts.length - 1].split("?")[0] || "receipt";
        a.download = rawName;
      } catch {
        a.download = "receipt";
      }

      // Append and click to trigger download
      document.body.appendChild(a);
      a.click();
      a.remove();

      // Revoke object URL after a short timeout to ensure download started
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      console.warn("Download via fetch failed:", err);
      // Final fallback: open the URL (browser will handle it)
      try {
        window.open(url, "_blank");
      } catch (e) {
        window.location.href = url;
      }
    }
  }

  // styles
  const containerStyle = { padding: 20, minHeight: "100vh", background: "linear-gradient(180deg,#fffaf0 0%, #f0f9ff 100%)" };
  const cardWrap = { maxWidth: 1200, margin: "0 auto" };
  const backBtn = { background: "#0284c7", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", marginBottom: 16 };
  const controlsRow = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12, justifyContent: "space-between" };
  const leftControls = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
  const rightControls = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
  const statsBox = (bg, color) => ({ background: bg, padding: 12, borderRadius: 8, color, fontWeight: 700 });

  return (
    <div style={containerStyle}>
      <div style={cardWrap}>
        <button onClick={() => navigate("/promoter-dashboard")} style={backBtn}>← Back to Promoter Dashboard</button>

        <h2 style={{ textAlign: "center", fontSize: 24, marginBottom: 6 }}>Commission — Payments</h2>
        <p style={{ textAlign: "center", marginTop: 0, color: "#475569" }}>
          Each row represents a purchased package (one payment may yield multiple rows).
        </p>

        {error && <div style={{ marginTop: 12, padding: 12, background: "#fff7ed", borderRadius: 8, color: "#92400e" }}>{error}</div>}

        <div style={{ marginTop: 18 }}>
          {/* Controls */}
          <div style={controlsRow}>
            <div style={leftControls}>
              <label style={{ fontSize: 13, color: "#475569", marginRight: 6 }}>Show:</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
                <option value="all">All</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
              </select>

              <input
                placeholder="Search name / payment id / course / student id"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ padding: 8, borderRadius: 8, minWidth: 220, border: "1px solid #e6e6e6" }}
              />

              <button onClick={() => { setSearch(""); setStatusFilter("all"); }} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e6e6e6", background: "#fff" }}>
                Reset
              </button>
            </div>

            <div style={rightControls}>
              <button onClick={handleExportCsv} style={{ padding: "8px 12px", borderRadius: 8, background: "#0ea5e9", color: "#fff", border: "none" }}>
                Export CSV
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: 28, background: "#fff", borderRadius: 10, textAlign: "center" }}>Loading payments…</div>
          ) : visibleRows.length === 0 ? (
            <div style={{ padding: 28, background: "#fff", borderRadius: 10, textAlign: "center", color: "#64748b" }}>
              No payment records for this promoter.
            </div>
          ) : (
            <>
              {!isNarrow && (
                <div style={{ overflowX: "auto", borderRadius: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", boxShadow: "0 6px 20px rgba(2,6,23,0.04)" }}>
                    <thead>
                      <tr style={{ background: "linear-gradient(90deg,#f1f5f9,#eef2ff)" }}>
                        <th style={th}>Student</th>
                        <th style={th}>Course</th>
                        <th style={th}>Course Cost (₹)</th>
                        <th style={th}>Discount (₹)</th>
                        <th style={th}>Total Paid (₹)</th>
                        <th style={th}>Commission %</th>
                        <th style={th}>Commission (₹)</th>
                        <th style={th}>Commission Status</th>
                        <th style={th}>Purchase (date/time)</th>
                        <th style={th}>Admin payout (date/time)</th>
                        <th style={th}>Receipt</th>
                        <th style={th}>Student Unique ID</th>
                        <th style={th}>Payment ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((r) => (
                        <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <td style={td}>{r.studentName || "—"}</td>
                          <td style={td}>{r.packageName || "—"}</td>
                          <td style={td}>₹{safeNumber(r.packageCost).toFixed(2)}</td>
                          <td style={td}>₹{safeNumber(r.discount).toFixed(2)}</td>
                          <td style={{ ...td, fontWeight: 700 }}>₹{safeNumber(r.totalPaid).toFixed(2)}</td>
                          <td style={td}>{safeNumber(r.commissionPercent).toFixed(2)}%</td>
                          <td style={{ ...td, color: "#16a34a", fontWeight: 700 }}>₹{safeNumber(r.commissionAmount).toFixed(2)}</td>
                          <td style={td}>{r.commissionStatus}</td>
                          <td style={td}>{formatDateTime(r.purchaseAt)}</td>
                          <td style={td}>{formatDateTime(r.adminPaidAt)}</td>
                          <td style={td}>
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
                          <td style={td}>{r.studentUniqueId || "—"}</td>
                          <td style={td}>{r.paymentId || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {isNarrow && (
                <div style={{ display: "grid", gap: 12 }}>
                  {visibleRows.map((r) => (
                    <div key={r.id} style={{ background: "#fff", padding: 12, borderRadius: 10, boxShadow: "0 6px 18px rgba(2,6,23,0.04)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 800 }}>{r.studentName || "—"}</div>
                        {/* UID removed from top so buttons remain within viewport */}
                        <div style={{ fontSize: 13, color: "#64748b" }}>{/* UID intentionally left out here */}</div>
                      </div>

                      <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>Course</div>
                          <div style={{ fontWeight: 700 }}>{r.packageName || "—"}</div>
                        </div>

                        <div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>Cost</div>
                          <div>₹{safeNumber(r.packageCost).toFixed(2)}</div>
                        </div>

                        <div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>Discount</div>
                          <div>₹{safeNumber(r.discount).toFixed(2)}</div>
                        </div>

                        <div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>Paid</div>
                          <div style={{ fontWeight: 700 }}>₹{safeNumber(r.totalPaid).toFixed(2)}</div>
                        </div>

                        <div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>Commission %</div>
                          <div>{safeNumber(r.commissionPercent).toFixed(2)}%</div>
                        </div>

                        <div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>Commission</div>
                          <div style={{ color: "#16a34a", fontWeight: 700 }}>₹{safeNumber(r.commissionAmount).toFixed(2)}</div>
                        </div>
                      </div>

                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ fontSize: 13, color: "#64748b" }}>Status</div>
                        <div style={{ fontWeight: 700 }}>{r.commissionStatus}</div>
                      </div>

                      <div style={{ marginTop: 8, fontSize: 12, color: "#475569" }}>
                        <div>Purchase: {formatDateTime(r.purchaseAt)}</div>
                        <div style={{ marginTop: 6 }}>Admin payout: {formatDateTime(r.adminPaidAt)}</div>
                        <div style={{ marginTop: 6 }}>Payment ID: {r.paymentId || "—"}</div>

                        <div style={{ marginTop: 6 }}>
                          {r.receiptUrl ? (
                            <>
                              <button onClick={() => openReceipt(r.receiptUrl)} style={{ padding: "6px 8px", borderRadius: 6 }}>View</button>
                              <button onClick={() => downloadReceipt(r.receiptUrl)} style={{ padding: "6px 8px", borderRadius: 6, marginLeft: 6 }}>Download</button>
                            </>
                          ) : (
                            ""
                          )}
                        </div>

                        {/* Student UID relocated after buttons, so buttons are earlier in the flow */}
                        <div style={{ marginTop: 8, color: "#64748b", fontSize: 13 }}>
                          UID: {r.studentUniqueId || "—"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 18, display: "flex", gap: 12, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
                <div style={statsBox("#ecfccb", "#365314")}>Commission paid: ₹{totalCommissionPaid.toFixed(2)}</div>
                <div style={statsBox("#fff7ed", "#92400e")}>Commission pending: ₹{totalCommissionPending.toFixed(2)}</div>
                <div style={statsBox("#eef2ff", "#3730a3")}>Entries: {visibleRows.length}</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const th = {
  padding: 12,
  textAlign: "left",
  fontSize: 13,
  fontWeight: 700,
  color: "#0f172a"
};
const td = {
  padding: 12,
  fontSize: 13,
  color: "#0f172a"
};
