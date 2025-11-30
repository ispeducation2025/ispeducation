/* src/pages/PromoterStudents.jsx */
import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebaseConfig";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { useLocation, useNavigate, useParams } from "react-router-dom";

/**
 * PromoterStudents — simplified + mobile-friendly:
 * - derives promoterUniqueId from route state, users/{promoterId} doc, then promoterId directly
 * - tries indexed client query (where referralId == promoterUniqueId)
 * - falls back to full users collection read + local filter if needed
 * - shows only: name, uniqueId, email, phone, class, syllabus
 * - responsive: table on wide screens, stacked cards on narrow screens
 */

function safeString(v) {
  return v === undefined || v === null ? "" : String(v);
}

export default function PromoterStudents() {
  const { promoterId } = useParams();
  const { state } = useLocation();
  const promoterFromState = state?.promoter;
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  // responsive breakpoint
  const [isNarrow, setIsNarrow] = useState(typeof window !== "undefined" ? window.innerWidth < 720 : false);
  useEffect(() => {
    function onResize() {
      setIsNarrow(window.innerWidth < 720);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError("");
      setStudents([]);

      // 1) try to derive promoterUniqueId from location.state
      let promoterUniqueId = promoterFromState?.uniqueId || promoterFromState?.uniqueID || promoterFromState?.unique_id || null;

      // 2) if not from state, try to treat promoterId as a doc id -> fetch that doc to get uniqueId
      if (!promoterUniqueId && promoterId) {
        try {
          const promoterDocRef = doc(db, "users", promoterId);
          const snap = await getDoc(promoterDocRef);
          if (snap.exists()) {
            const pdata = snap.data() || {};
            promoterUniqueId = pdata.uniqueId || pdata.uniqueID || pdata.unique_id || promoterUniqueId;
          }
        } catch (e) {
          // ignore — maybe promoterId isn't a doc id
          console.warn("promoter doc fetch failed (maybe promoterId isn't a doc id):", e?.message || e);
        }
      }

      // 3) if still not found, maybe promoterId already is the uniqueId (route param)
      if (!promoterUniqueId && promoterId) {
        promoterUniqueId = promoterId;
      }

      if (!promoterUniqueId) {
        if (mounted) {
          setError("Could not determine promoter unique id. Provide promoter object in route state or use promoter's uniqueId as the route param.");
          setLoading(false);
        }
        return;
      }

      try {
        // Try indexed query first (most efficient / secure when rules allow)
        const usersCol = collection(db, "users");
        const q = query(usersCol, where("referralId", "==", promoterUniqueId));
        const snap = await getDocs(q);

        const found = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          // only students
          if (!data.role || String(data.role).toLowerCase() === "student") {
            found.push({
              id: d.id,
              uniqueId: data.uniqueId || data.uniqueID || data.unique_id || "",
              name: safeString(data.name || data.displayName || ""),
              email: safeString(data.email || ""),
              phone: safeString(data.phone || data.mobile || data.contact || ""),
              classGrade: safeString(data.classGrade || data.class || data.class_grade || ""),
              syllabus: safeString(data.syllabus || ""),
            });
          }
        });

        if (found.length > 0) {
          if (mounted) {
            setStudents(found);
            setLoading(false);
          }
          return;
        }

        // If indexed query returned no results (or was blocked), fallback to full read + filter
        const allSnap = await getDocs(usersCol);
        const fallback = [];
        allSnap.forEach((d) => {
          const data = d.data() || {};
          const refId = (data.referralId || data.referral || data.referrer || "").toString();
          if (refId === promoterUniqueId && (!data.role || String(data.role).toLowerCase() === "student")) {
            fallback.push({
              id: d.id,
              uniqueId: data.uniqueId || data.uniqueID || data.unique_id || "",
              name: safeString(data.name || data.displayName || ""),
              email: safeString(data.email || ""),
              phone: safeString(data.phone || data.mobile || data.contact || ""),
              classGrade: safeString(data.classGrade || data.class || data.class_grade || ""),
              syllabus: safeString(data.syllabus || ""),
            });
          }
        });

        if (mounted) {
          setStudents(fallback);
          if (fallback.length === 0) setError("No students found for this promoter.");
          setLoading(false);
        }
      } catch (e) {
        console.error("Failed fetching students:", e);
        if (mounted) {
          setError("Failed to load students. Check Firestore rules or network.");
          setLoading(false);
        }
      }
    }

    load();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoterId, promoterFromState]);

  const containerStyle = {
    padding: 16,
    minHeight: "100vh",
    background: "linear-gradient(180deg,#E6FFFA 0%, #EFF6FF 100%)"
  };
  const innerStyle = {
    maxWidth: 1100,
    margin: "0 auto"
  };
  const backBtnStyle = {
    background: "#0284c7",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "8px 16px",
    cursor: "pointer",
    marginBottom: 16,
    boxShadow: "0 6px 18px rgba(2,6,23,0.08)"
  };

  const tableWrapStyle = {
    overflowX: "auto",
    borderRadius: 10,
    background: "#fff",
    boxShadow: "0 6px 20px rgba(2,6,23,0.04)"
  };

  const cardListStyle = {
    display: "grid",
    gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr",
    gap: 12
  };

  const cardStyle = {
    background: "#fff",
    padding: 12,
    borderRadius: 8,
    boxShadow: "0 6px 18px rgba(2,6,23,0.04)"
  };

  return (
    <div style={containerStyle}>
      <div style={innerStyle}>
        <button onClick={() => navigate("/promoter-dashboard")} style={backBtnStyle}>← Back to Promoter Dashboard</button>

        <h2 style={{ textAlign: "center", fontSize: 26, fontWeight: 700, color: "#0369a1", marginBottom: 8 }}>
          Students Tagged to {promoterFromState?.name || promoterId || "Promoter"}
        </h2>

        <p style={{ textAlign: "center", color: "#065f46", marginTop: 0 }}>
          Showing students who registered using the promoter's referral (unique) ID.
        </p>

        {error && <div style={{ marginTop: 12, padding: 12, background: "#fff7ed", borderRadius: 8, color: "#92400e" }}>{error}</div>}

        <div style={{ marginTop: 18 }}>
          {loading ? (
            <div style={{ padding: 28, background: "#fff", borderRadius: 10, textAlign: "center" }}>Loading students…</div>
          ) : students.length === 0 ? (
            <div style={{ padding: 28, background: "#fff", borderRadius: 10, textAlign: "center", color: "#64748b" }}>
              No students found for this promoter.
            </div>
          ) : (
            <>
              {/* Desktop table (visible when not narrow) */}
              {!isNarrow && (
                <div style={tableWrapStyle}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "linear-gradient(90deg,#e0f2fe,#ecfeff)" }}>
                        <th style={th}>Name</th>
                        <th style={th}>Student Unique ID</th>
                        <th style={th}>Email</th>
                        <th style={th}>Phone</th>
                        <th style={th}>Class</th>
                        <th style={th}>Syllabus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s) => (
                        <tr key={s.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <td style={td}>{s.name || "—"}</td>
                          <td style={td}>{s.uniqueId || "—"}</td>
                          <td style={td}>{s.email || "—"}</td>
                          <td style={td}>{s.phone || "—"}</td>
                          <td style={td}>{s.classGrade || "—"}</td>
                          <td style={td}>{s.syllabus || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Mobile stacked cards (visible when narrow) */}
              {isNarrow && (
                <div style={cardListStyle}>
                  {students.map((s) => (
                    <div key={s.id} style={cardStyle}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{s.name || "—"}</div>
                          <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>{s.email || "—"}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 13, color: "#64748b" }}>ID</div>
                          <div style={{ fontWeight: 700 }}>{s.uniqueId || "—"}</div>
                        </div>
                      </div>

                      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ background: "#f1f5f9", padding: 8, borderRadius: 6, fontSize: 13, color: "#0f172a", flex: "1 1 45%" }}>
                          <div style={{ fontSize: 12, color: "#64748b" }}>Phone</div>
                          <div style={{ fontWeight: 700 }}>{s.phone || "—"}</div>
                        </div>

                        <div style={{ background: "#f1f5f9", padding: 8, borderRadius: 6, fontSize: 13, color: "#0f172a", flex: "1 1 45%" }}>
                          <div style={{ fontSize: 12, color: "#64748b" }}>Class</div>
                          <div style={{ fontWeight: 700 }}>{s.classGrade || "—"}</div>
                        </div>

                        <div style={{ background: "#f8fafc", padding: 8, borderRadius: 6, fontSize: 13, color: "#0f172a", width: "100%" }}>
                          <div style={{ fontSize: 12, color: "#64748b" }}>Syllabus</div>
                          <div style={{ fontWeight: 700 }}>{s.syllabus || "—"}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end" }}>
                <div style={{ background: "#eef2ff", padding: 12, borderRadius: 8, color: "#3730a3", fontWeight: 700 }}>
                  Total students: {students.length}
                </div>
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
  fontWeight: 800,
  color: "#0f172a"
};
const td = {
  padding: 12,
  fontSize: 13,
  color: "#0f172a"
};
