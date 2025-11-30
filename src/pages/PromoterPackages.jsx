/* src/pages/PromoterPackages.jsx */
/* eslint-disable */
import React, { useEffect, useState } from "react";
import { collection, query, onSnapshot, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { FaFilter } from "react-icons/fa";
import { useNavigate } from "react-router-dom";

/**
 * PromoterPackages.jsx (mobile-friendly)
 * - Reads documents from root-level `packages` collection.
 * - Prefers `raw.commission` (percentage) to compute commission amount.
 * - Responsive:
 *    - Desktop: table + playing-card grid
 *    - Mobile/narrow: cards stacked, controls stacked
 * - Safe numeric/string/timestamp helpers
 */

const Styles = {
  root: { padding: 20, boxSizing: "border-box", background: "linear-gradient(180deg, #f0f9ff 0%, #fef6ff 50%, #fff7ed 100%)", minHeight: "100vh" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" },
  title: { fontSize: 20, fontWeight: 800, margin: 0 },
  subtitle: { color: "#475569", fontSize: 13 },
  controls: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  controlsStack: { display: "flex", flexDirection: "column", gap: 8, width: "100%" },
  controlGroup: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  select: { padding: "8px 10px", borderRadius: 8, border: "1px solid #e6e6e6", background: "#fff", minWidth: 160 },
  input: { padding: "8px 10px", borderRadius: 8, border: "1px solid #e6e6e6", minWidth: 220 },
  cardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, marginTop: 18 },
  playingCardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 16, marginTop: 20 },
  playingCardGridMobile: { display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 16 },
  card: { background: "#fff", padding: 14, borderRadius: 12, boxShadow: "0 10px 30px rgba(2,6,23,0.06)", minHeight: 140, display: "flex", flexDirection: "column", justifyContent: "space-between", borderLeft: "6px solid rgba(0,0,0,0.03)" },
  playingCard: { background: "#fff", padding: 18, borderRadius: 16, boxShadow: "0 18px 40px rgba(2,6,23,0.07)", minHeight: 180, display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden" },
  playingStrip: (color) => ({ position: "absolute", left: 0, top: 0, bottom: 0, width: 8, background: color || "#0ea5e9" }),
  badge: { padding: "6px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "#fff" },
  tableWrap: { marginTop: 6, background: "rgba(255,255,255,0.95)", padding: 12, borderRadius: 10, boxShadow: "0 8px 22px rgba(2,6,23,0.04)", overflowX: "auto" },
  th: { padding: "10px 12px", borderBottom: "1px solid #eee", textAlign: "left", fontSize: 13, background: "transparent", whiteSpace: "nowrap" },
  td: { padding: "10px 12px", borderBottom: "1px solid #fafafa", fontSize: 13, verticalAlign: "top", whiteSpace: "nowrap" },
  empty: { padding: 28, textAlign: "center", color: "#475569" },
  errorBox: { padding: 12, borderRadius: 8, background: "#fff2f2", color: "#9f1239", border: "1px solid #fecaca", marginBottom: 12 },
  price: { fontSize: 16, fontWeight: 800 },
  metaMuted: { fontSize: 13, color: "#64748b" },
  btnPrimary: { padding: "8px 12px", borderRadius: 8, background: "#0ea5e9", color: "#fff", border: "none", cursor: "pointer" },
  btnGhost: { padding: "8px 12px", borderRadius: 8, background: "#fff", border: "1px solid #e6e6e6", cursor: "pointer" }
};

function safeNumber(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(String(v).replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function safeString(v) {
  if (v === undefined || v === null) return "";
  return String(v);
}
function safeDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.toMillis === "function") return new Date(v.toMillis());
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export default function PromoterPackages() {
  const navigate = useNavigate();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSyllabus, setSelectedSyllabus] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState(null);

  // responsive
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
    setLoading(true);
    setError(null);
    const colRef = collection(db, "packages");
    let unsub = null;

    try {
      const q = query(colRef);
      unsub = onSnapshot(
        q,
        (snap) => {
          const arr = snap.docs.map((d) => {
            const raw = d.data() || {};
            const priceVal = safeNumber(raw.totalPayable || raw.price);
            // PREFER raw.commission (user confirmed this holds percentage)
            const commissionPercent = safeNumber(
              raw.commission !== undefined && raw.commission !== null
                ? raw.commission
                : (raw.promoterCommission ?? raw.commissionPercent ?? raw.commissionPercentage ?? 0)
            );
            const commissionAmount = Number(((priceVal * commissionPercent) / 100).toFixed(2));
            return {
              id: d.id,
              raw,
              packageName: safeString(raw.packageName),
              packageType: safeString(raw.packageType),
              classGrade: safeString(raw.classGrade),
              syllabus: safeString(raw.syllabus),
              subject: safeString(raw.subject),
              courseDetails: safeString(raw.courseDetails),
              freebies: safeString(raw.freebies),
              duration: safeString(raw.duration),
              price: priceVal,
              totalPayable: priceVal,
              regularDiscount: safeNumber(raw.regularDiscount),
              additionalDiscount: safeNumber(raw.additionalDiscount),
              createdAt: safeDate(raw.createdAt) || safeDate(raw.created_at) || null,
              commissionPercent,
              commissionAmount,
              _raw: raw
            };
          });
          setPackages(arr);
          setLoading(false);
        },
        (err) => {
          console.warn("packages onSnapshot failed; falling back to getDocs. Error:", err);
          setError("Realtime listener blocked or failed — attempting single-shot read. Check Firestore rules.");
          getDocs(colRef)
            .then((snap) => {
              const arr = snap.docs.map((d) => {
                const raw = d.data() || {};
                const priceVal = safeNumber(raw.totalPayable || raw.price);
                const commissionPercent = safeNumber(
                  raw.commission !== undefined && raw.commission !== null
                    ? raw.commission
                    : (raw.promoterCommission ?? raw.commissionPercent ?? raw.commissionPercentage ?? 0)
                );
                const commissionAmount = Number(((priceVal * commissionPercent) / 100).toFixed(2));
                return {
                  id: d.id,
                  raw,
                  packageName: safeString(raw.packageName),
                  packageType: safeString(raw.packageType),
                  classGrade: safeString(raw.classGrade),
                  syllabus: safeString(raw.syllabus),
                  subject: safeString(raw.subject),
                  courseDetails: safeString(raw.courseDetails),
                  freebies: safeString(raw.freebies),
                  duration: safeString(raw.duration),
                  price: priceVal,
                  totalPayable: priceVal,
                  regularDiscount: safeNumber(raw.regularDiscount),
                  additionalDiscount: safeNumber(raw.additionalDiscount),
                  createdAt: safeDate(raw.createdAt) || safeDate(raw.created_at) || null,
                  commissionPercent,
                  commissionAmount,
                  _raw: raw
                };
              });
              setPackages(arr);
            })
            .catch((gErr) => {
              console.error("getDocs(packages) failed:", gErr);
              setError("Failed to read packages. Check Firestore rules or network.");
            })
            .finally(() => setLoading(false));
        }
      );
    } catch (e) {
      console.error("packages fetch error:", e);
      setError("Unexpected error while initializing package listener.");
      getDocs(colRef)
        .then((snap) => {
          const arr = snap.docs.map((d) => {
            const raw = d.data() || {};
            const priceVal = safeNumber(raw.totalPayable || raw.price);
            const commissionPercent = safeNumber(
              raw.commission !== undefined && raw.commission !== null
                ? raw.commission
                : (raw.promoterCommission ?? raw.commissionPercent ?? raw.commissionPercentage ?? 0)
            );
            const commissionAmount = Number(((priceVal * commissionPercent) / 100).toFixed(2));
            return {
              id: d.id,
              raw,
              packageName: safeString(raw.packageName),
              packageType: safeString(raw.packageType),
              classGrade: safeString(raw.classGrade),
              syllabus: safeString(raw.syllabus),
              subject: safeString(raw.subject),
              courseDetails: safeString(raw.courseDetails),
              freebies: safeString(raw.freebies),
              duration: safeString(raw.duration),
              price: priceVal,
              totalPayable: priceVal,
              regularDiscount: safeNumber(raw.regularDiscount),
              additionalDiscount: safeNumber(raw.additionalDiscount),
              createdAt: safeDate(raw.createdAt) || safeDate(raw.created_at) || null,
              commissionPercent,
              commissionAmount,
              _raw: raw
            };
          });
          setPackages(arr);
        })
        .catch((err) => {
          console.error("getDocs fallback failed:", err);
          setError("Failed to read packages.");
        })
        .finally(() => setLoading(false));
    }

    return () => {
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const classOptions = Array.from(new Set(packages.map((p) => p.classGrade).filter(Boolean))).sort();
  const syllabusOptions = Array.from(new Set(packages.map((p) => p.syllabus).filter(Boolean))).sort();
  const typeOptions = Array.from(new Set(packages.map((p) => p.packageType).filter(Boolean))).sort();

  const filtered = packages.filter((p) => {
    if (selectedClass && String(p.classGrade || "").toLowerCase() !== String(selectedClass).toLowerCase()) return false;
    if (selectedSyllabus && String(p.syllabus || "").toLowerCase() !== String(selectedSyllabus).toLowerCase()) return false;
    if (selectedType && String(p.packageType || "").toLowerCase() !== String(selectedType).toLowerCase()) return false;
    if (search) {
      const q = String(search).toLowerCase();
      const candidates = [
        p.packageName,
        p.subject,
        p.packageType,
        p.courseDetails,
        p.freebies,
        (p._raw && p._raw.package_description) || "",
        (p._raw && p._raw.subtopic) || ""
      ].filter(Boolean).map((x) => String(x).toLowerCase());
      if (!candidates.some((c) => c.includes(q))) return false;
    }
    return true;
  });

  return (
    <div style={Styles.root}>
      {error && <div style={Styles.errorBox}>{error}</div>}

      <div style={Styles.headerRow}>
        <div>
          <h2 style={Styles.title}>Packages</h2>
          <div style={Styles.subtitle}>Manage your interactive classes and tests. Filter by Class, Syllabus or Type.</div>
        </div>

        {/* Controls - responsive */}
        {isNarrow ? (
          <div style={{ ...Styles.controlsStack }}>
            <div style={Styles.controlGroup}>
              <FaFilter style={{ color: "#64748b" }} />
              <select style={{ ...Styles.select, minWidth: 120, flex: 1 }} value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
                <option value="">All classes</option>
                {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>

              <select style={{ ...Styles.select, minWidth: 120, flex: 1 }} value={selectedSyllabus} onChange={(e) => setSelectedSyllabus(e.target.value)}>
                <option value="">All syllabi</option>
                {syllabusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div style={Styles.controlGroup}>
              <select style={{ ...Styles.select, minWidth: 120, flex: 1 }} value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                <option value="">All types</option>
                {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>

              <input style={{ ...Styles.input, flex: 2, minWidth: 120 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search package name, subject, freebies..." />
            </div>
          </div>
        ) : (
          <div style={Styles.controls}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <FaFilter style={{ color: "#64748b" }} />
              <select style={Styles.select} value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
                <option value="">All classes</option>
                {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>

              <select style={Styles.select} value={selectedSyllabus} onChange={(e) => setSelectedSyllabus(e.target.value)}>
                <option value="">All syllabi</option>
                {syllabusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>

              <select style={Styles.select} value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                <option value="">All types</option>
                {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <input style={Styles.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search package name, subject, freebies..." />
          </div>
        )}
      </div>

      {loading ? (
        <div style={Styles.empty}>Loading packages...</div>
      ) : (
        <>
          {/* Table: hidden on narrow devices for clarity (mobile uses cards) */}
          {!isNarrow && (
            <div style={Styles.tableWrap}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={Styles.th}>Class</th>
                    <th style={Styles.th}>Syllabus</th>
                    <th style={Styles.th}>Type</th>
                    <th style={Styles.th}>Package name</th>
                    <th style={Styles.th}>Subject</th>
                    <th style={Styles.th}>Price (₹)</th>
                    <th style={Styles.th}>Commission %</th>
                    <th style={Styles.th}>Commission ₹</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={8} style={Styles.empty}>No packages to show</td></tr>
                  ) : filtered.map((p) => (
                    <tr key={p.id}>
                      <td style={Styles.td}>{p.classGrade || "-"}</td>
                      <td style={Styles.td}>{p.syllabus || "-"}</td>
                      <td style={Styles.td}>{p.packageType || "-"}</td>
                      <td style={Styles.td}>{p.packageName || "-"}</td>
                      <td style={Styles.td}>{p.subject || "-"}</td>
                      <td style={Styles.td}>₹{Number(p.totalPayable || p.price || 0).toFixed(2)}</td>
                      <td style={Styles.td}>{(Number(p.commissionPercent || 0)).toFixed(2)}%</td>
                      <td style={Styles.td}>₹{Number(p.commissionAmount || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Playing card grid (primary view on mobile) */}
          <div style={isNarrow ? Styles.playingCardGridMobile : Styles.playingCardGrid}>
            {filtered.length === 0 ? (
              <div style={{ gridColumn: "1/-1" }}>
                <div style={Styles.tableWrap}>
                  <div style={Styles.empty}>No packages match your filters.</div>
                </div>
              </div>
            ) : filtered.map((p, idx) => {
              const colors = ["#0ea5e9", "#7c3aed", "#059669", "#f97316", "#ef4444"];
              const color = colors[idx % colors.length];
              return (
                <div key={p.id} style={Styles.playingCard}>
                  <div style={Styles.playingStrip(color)} />
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, paddingLeft: 12, alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 18, fontWeight: 900, wordBreak: "break-word" }}>{p.packageName || "Untitled package"}</div>
                      <div style={{ marginTop: 8, color: "#475569", fontSize: 13 }}>{p.subject} • {p.packageType} • {p.classGrade ? `Class ${p.classGrade}` : ""} • {p.syllabus}</div>
                      <div style={{ marginTop: 12, color: "#475569", fontSize: 14, wordBreak: "break-word" }}>{p.courseDetails || (p.duration ? `${p.duration} sessions` : "")}</div>
                      {p.freebies && <div style={{ marginTop: 12 }}><span style={{ ...Styles.badge, background: color }}>{p.freebies}</span></div>}
                    </div>

                    <div style={{ textAlign: "right", paddingLeft: 12, minWidth: 120 }}>
                      <div style={Styles.price}>₹{Number(p.totalPayable || p.price || 0).toLocaleString("en-IN")}</div>
                      <div style={{ marginTop: 8, fontSize: 13, color: "#0ea5e9" }}>{((p.regularDiscount || 0) + (p.additionalDiscount || 0)) ? `${(p.regularDiscount || 0) + (p.additionalDiscount || 0)}% off` : ""}</div>
                      <div style={{ marginTop: 10, fontSize: 13, color: "#64748b" }}>Commission: <strong>{Number(p.commissionPercent || 0).toFixed(2)}%</strong></div>
                      <div style={{ marginTop: 6, fontSize: 14, fontWeight: 800 }}>You earn: ₹{Number(p.commissionAmount || 0).toFixed(2)}</div>
                      {p.createdAt && <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>{p.createdAt.toLocaleDateString()}</div>}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 14, paddingLeft: 12, flexWrap: "wrap" }}>
                    <button onClick={() => navigate(`/promoter/packages/${p.id}`)} style={{ ...Styles.btnPrimary, flex: isNarrow ? "1 1 auto" : "initial" }}>View</button>
                    <button onClick={() => navigate(`/promoter/packages/edit/${p.id}`)} style={{ ...Styles.btnGhost, flex: isNarrow ? "1 1 auto" : "initial" }}>Edit</button>
                    <button onClick={() => { navigator.clipboard?.writeText(window.location.origin + `/promoter/packages/${p.id}`); }} style={{ ...Styles.btnGhost, borderStyle: "dashed", flex: isNarrow ? "1 1 auto" : "initial" }}>Copy Link</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
