// src/components/PromoterLayout.jsx
import React, { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  FaTachometerAlt,
  FaBoxOpen,
  FaUsers,
  FaMoneyBillWave,
  FaUserCircle,
  FaSignOutAlt,
  FaUniversity,
  FaBars,
  FaTimes,
} from "react-icons/fa";
import { auth, db } from "../firebase/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
} from "firebase/firestore";

const S = {
  root: { display: "flex", minHeight: "100vh", fontFamily: "Inter, Arial, sans-serif", background: "#f1f5f9" },
  aside: (col) => ({ width: col ? 72 : 260, minWidth: col ? 72 : 260, transition: "width 220ms ease", background: "#04293a", color: "#fff", padding: col ? 10 : 18, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }),
  asideHeader: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  brand: { display: "flex", alignItems: "center", gap: 12 },
  brandLogo: { width: 44, height: 44, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff" },
  navList: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 },
  navItem: (active, col) => ({ display: "flex", gap: 12, alignItems: "center", padding: col ? 8 : 10, borderRadius: 8, cursor: "pointer", background: active ? "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))" : "transparent", color: active ? "#fff" : "#cfeaf6", fontWeight: active ? 700 : 600 }),
  main: { flex: 1, padding: 20, boxSizing: "border-box", overflowY: "auto" },
  topbar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 },
  card: { background: "#fff", padding: 14, borderRadius: 10, boxShadow: "0 6px 18px rgba(2,6,23,0.06)", minWidth: 180, flex: "1 1 220px" },
  smallMuted: { fontSize: 13, color: "#64748b" },
  btn: { padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer" },
  errorBox: { padding: 10, borderRadius: 8, background: "#fff2f2", color: "#9f1239", border: "1px solid #fecaca", marginTop: 10 }
};

function fmtINR(v) {
  try {
    return "₹" + Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch (e) {
    return "₹0.00";
  }
}

export default function PromoterLayout({ name = "Promoter" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [promoter, setPromoter] = useState(null);
  const [promoterError, setPromoterError] = useState(null);

  // Metrics
  const [studentsReferred, setStudentsReferred] = useState(0);
  const [packagesCount, setPackagesCount] = useState(0);
  const [pendingAmount, setPendingAmount] = useState(0);
  const [totalPaid, setTotalPaid] = useState(0);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState(null);

  useEffect(() => {
    if (window && window.innerWidth < 920) setCollapsed(true);
    function onResize() {
      if (window.innerWidth < 920) setCollapsed(true);
      else setCollapsed(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let unsub = null;
    setPromoterError(null);

    unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setPromoter(null);
        return;
      }

      try {
        // 1) try direct doc read users/{uid}
        const docRef = doc(db, "users", user.uid);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          setPromoter({ id: snap.id, ...snap.data() });
          return;
        }

        // 2) fallback: query where uid == auth.uid
        try {
          const usersCol = collection(db, "users");
          const q = query(usersCol, where("uid", "==", user.uid), limit(1));
          const qSnap = await getDocs(q);
          if (!qSnap.empty) {
            const d = qSnap.docs[0];
            setPromoter({ id: d.id, ...d.data() });
            return;
          }
        } catch (e) {
          console.warn("layout: uid query failed:", e?.message || e);
        }

        // 3) fallback by email (last resort)
        if (user.email) {
          try {
            const usersCol = collection(db, "users");
            const q2 = query(usersCol, where("email", "==", user.email), limit(1));
            const s2 = await getDocs(q2);
            if (!s2.empty) {
              const d = s2.docs[0];
              setPromoter({ id: d.id, ...d.data() });
              return;
            }
          } catch (e) {
            console.warn("layout: email query failed:", e?.message || e);
          }
        }

        // nothing found
        setPromoter(null);
        setPromoterError("Could not locate promoter document for the signed-in user.");
      } catch (e) {
        console.error("PromoterLayout fetch error:", e);
        setPromoter(null);
        setPromoterError("Failed to load promoter info. Check Firestore rules or network.");
      }
    });

    return () => { if (typeof unsub === "function") unsub(); };
  }, []);

  // fetch metrics when promoter becomes available
  useEffect(() => {
    let mounted = true;
    async function fetchMetrics(p) {
      setMetricsLoading(true);
      setMetricsError(null);
      setStudentsReferred(0);
      setPackagesCount(0);
      setPendingAmount(0);
      setTotalPaid(0);

      try {
        const promoDocId = p?.id || null;
        const promoUnique = p?.uniqueId || p?.uniqueID || p?.unique_id || p?.referralId || null;

        // 1) studentsReferred: prefer promoter.teamCount, else query users where referralId == uniqueId
        try {
          if (typeof p?.teamCount === "number") {
            setStudentsReferred(p.teamCount);
          } else if (promoUnique) {
            const usersCol = collection(db, "users");
            const q = query(usersCol, where("referralId", "==", promoUnique));
            const snap = await getDocs(q);
            setStudentsReferred(snap.size);
          } else {
            setStudentsReferred(0);
          }
        } catch (e) {
          console.warn("studentsReferred query failed, trying fallback full scan:", e?.message || e);
          try {
            const usersCol = collection(db, "users");
            const all = await getDocs(usersCol);
            let cnt = 0;
            all.forEach((d) => {
              const data = d.data() || {};
              const ref = (data.referralId || data.referral || data.referrer || "").toString();
              if (promoUnique && ref === promoUnique) cnt++;
            });
            setStudentsReferred(cnt);
          } catch (err) {
            console.warn("studentsReferred fallback failed:", err);
            setStudentsReferred(0);
          }
        }

        // 2) packagesCount / pendingAmount: from payments collection
        let accumPackages = 0;
        let accumPending = 0;

        try {
          const paymentsCol = collection(db, "payments");
          const foundDocs = new Map();

          // Try promoterDocId query first
          if (promoDocId) {
            try {
              const q = query(paymentsCol, where("promoterDocId", "==", promoDocId));
              const snap = await getDocs(q);
              snap.forEach((d) => foundDocs.set(d.id, d.data()));
            } catch (e) {
              console.warn("payments query by promoterDocId failed:", e?.message || e);
            }
          }

          // Try promoterUniqueId query
          if (promoUnique) {
            try {
              const q2 = query(paymentsCol, where("promoterUniqueId", "==", promoUnique));
              const snap2 = await getDocs(q2);
              snap2.forEach((d) => foundDocs.set(d.id, d.data()));
            } catch (e) {
              console.warn("payments query by promoterUniqueId failed:", e?.message || e);
            }
          }

          // If nothing found, try a few alternate fields (promoterId/promoterUid)
          if (foundDocs.size === 0 && promoDocId) {
            const altFields = ["promoterId", "promoterUid", "promoter"];
            for (const field of altFields) {
              try {
                const qx = query(paymentsCol, where(field, "==", promoDocId));
                const sx = await getDocs(qx);
                sx.forEach((d) => foundDocs.set(d.id, d.data()));
              } catch (e) {
                // ignore
              }
            }
          }

          // Final fallback: full payments scan (may be slow)
          if (foundDocs.size === 0 && (promoDocId || promoUnique)) {
            try {
              console.warn("PromoterLayout: falling back to full payments scan to compute metrics.");
              const all = await getDocs(paymentsCol);
              all.forEach((d) => {
                const data = d.data() || {};
                const possible = [
                  (data.promoterDocId || ""),
                  (data.promoterId || ""),
                  (data.promoterUid || ""),
                  (data.promoterUniqueId || ""),
                  (data.promoter || ""),
                  (data.promoterResolved && (data.promoterResolved.uniqueId || data.promoterResolved.uniqueID)) || ""
                ].filter(Boolean).map((x) => String(x).toLowerCase().trim());
                const checkId = (promoDocId ? String(promoDocId).toLowerCase().trim() : null);
                const checkUnique = (promoUnique ? String(promoUnique).toLowerCase().trim() : null);
                if ((checkId && possible.includes(checkId)) || (checkUnique && possible.includes(checkUnique))) {
                  foundDocs.set(d.id, data);
                }
              });
            } catch (e) {
              console.warn("Full payments scan failed:", e);
            }
          }

          // Now compute packages count and pending commission
          foundDocs.forEach((pdoc) => {
            const pkgs = Array.isArray(pdoc.packages) ? pdoc.packages : [];
            if (pkgs.length > 0) {
              accumPackages += pkgs.length;
              pkgs.forEach((pkg) => {
                const packageCost = Number(pkg.packageCost ?? pkg.price ?? pkg.totalPayable ?? 0) || 0;
                const commissionAmount = Number(pkg.commissionAmount ?? pkg.promoterCommission ?? pkg.commission ?? 0) || 0;
                const commissionPercent = Number(pkg.commissionPercent ?? pkg.commission ?? 0) || 0;
                const computedCommission = commissionAmount || Number(((packageCost * commissionPercent) / 100).toFixed(2));
                const commissionPaidFlag = Boolean(pkg.commissionPaid ?? pdoc.commissionPaid ?? pdoc.promoterPaid ?? false);
                if (!commissionPaidFlag) accumPending += computedCommission;
              });
            } else {
              const packageCost = Number(pdoc.packageCost ?? pdoc.amount ?? pdoc.totalPackageCost ?? 0) || 0;
              const commissionAmount = Number(pdoc.commissionAmount ?? pdoc.promoterCommission ?? pdoc.commissionTotal ?? 0) || 0;
              const commissionPercent = Number(pdoc.commissionPercent ?? pdoc.commission ?? 0) || 0;
              const computedCommission = commissionAmount || Number(((packageCost * commissionPercent) / 100).toFixed(2));
              if (!Boolean(pdoc.commissionPaid ?? pdoc.promoterPaid ?? false)) accumPending += computedCommission;
              accumPackages += 1;
            }
          });
        } catch (e) {
          console.warn("Error computing payments metrics:", e);
        }

        // 3) totalPaid: sum payouts collection for promoter (status: sent/confirmed)
        let accumPaid = 0;
        try {
          const payoutsCol = collection(db, "payouts");
          const foundPayouts = [];
          if (promoDocId) {
            try {
              const q = query(payoutsCol, where("promoterId", "==", promoDocId));
              const snap = await getDocs(q);
              snap.forEach((d) => foundPayouts.push(d.data()));
            } catch (e) {
              console.warn("payouts query by promoterId failed:", e?.message || e);
            }
          }

          if (foundPayouts.length === 0 && promoDocId) {
            try {
              const all = await getDocs(payoutsCol);
              all.forEach((d) => {
                const data = d.data() || {};
                if ((String(data.promoterId || "") === String(promoDocId)) || (String(data.promoterUniqueId || "") === String(promoUnique))) {
                  foundPayouts.push(data);
                }
              });
            } catch (e) {
              console.warn("payouts full scan failed:", e);
            }
          }

          foundPayouts.forEach((po) => {
            const st = (po.status || "").toString().toLowerCase();
            if (["sent", "confirmed", "paid"].includes(st)) {
              accumPaid += Number(po.amount || 0) || 0;
            }
          });

          if (accumPaid === 0 && typeof p?.lastPaidAmount === "number") {
            accumPaid = Number(p.lastPaidAmount || 0);
          }
        } catch (e) {
          console.warn("Error computing payouts metrics:", e);
        }

        if (!mounted) return;
        setPackagesCount(accumPackages);
        setPendingAmount(Number((accumPending || 0).toFixed(2)));
        setTotalPaid(Number((accumPaid || 0).toFixed(2)));
        setMetricsLoading(false);
      } catch (err) {
        console.error("PromoterLayout: metrics load failed:", err);
        if (!mounted) return;
        setMetricsError("Failed to load promoter metrics. See console for details.");
        setMetricsLoading(false);
      }
    }

    if (promoter) {
      fetchMetrics(promoter);
    } else {
      setStudentsReferred(0);
      setPackagesCount(0);
      setPendingAmount(0);
      setTotalPaid(0);
      setMetricsLoading(false);
    }

    return () => { mounted = false; };
  }, [promoter]);

  const pathname = location.pathname || "/";
  const nav = [
    { id: "dashboard", path: "/promoter-dashboard", icon: <FaTachometerAlt />, label: "Dashboard", color: "#114a60" },
    { id: "packages", path: "/promoter-dashboard/packages", icon: <FaBoxOpen />, label: "Packages", color: "#0ea5e9" },
    { id: "students", path: "/promoter-dashboard/students", icon: <FaUsers />, label: "Students", color: "#f472b6" },
    { id: "commission", path: "/promoter-dashboard/commission", icon: <FaMoneyBillWave />, label: "Commission", color: "#7c3aed" },
    { id: "bank", path: "/promoter-dashboard/bank", icon: <FaUniversity />, label: "Bank / UPI", color: "#059669" },
    { id: "profile", path: "/promoter-dashboard/profile", icon: <FaUserCircle />, label: "Profile", color: "#0284c7" }
  ];

  const handleLogout = async () => {
    try { await auth.signOut(); } catch (e) { console.warn(e); } finally { navigate("/"); }
  };

  // navigation that passes promoter via location.state when available
  const navTo = (path) => {
    if (promoter) navigate(path, { state: { promoter } });
    else navigate(path);
  };

  return (
    <div style={S.root}>
      <aside style={S.aside(collapsed)}>
        <div style={S.asideHeader}>
          <div style={S.brand}>
            <div style={{ ...S.brandLogo, background: "linear-gradient(135deg,#0ea5e9,#7c3aed)" }}>{collapsed ? "I" : "ISP"}</div>
            {!collapsed && (
              <div style={{ color: "#fff" }}>
                <div style={{ fontWeight: 800 }}>Promoter</div>
                <div style={{ fontSize: 13, color: "#cfeaf6" }}>Welcome{promoter?.name ? `, ${promoter.name.split(" ")[0]}` : ""}</div>
              </div>
            )}
          </div>

          <button onClick={() => setCollapsed((s) => !s)} style={{ ...S.btn, background: "transparent", color: "#fff" }} aria-label="toggle menu">
            {collapsed ? <FaBars /> : <FaTimes />}
          </button>
        </div>

        <nav aria-label="Promoter navigation">
          <ul style={S.navList}>
            {nav.map((n) => {
              const isActive = pathname === n.path || pathname.startsWith(n.path + "/");
              return (
                <li key={n.id} style={S.navItem(isActive, collapsed)} onClick={() => navTo(n.path)}>
                  <div style={{
                    width: 40, height: 36, borderRadius: 8, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    background: isActive ? n.color : "rgba(255,255,255,0.03)",
                    color: isActive ? "#fff" : "#cfeaf6"
                  }}>{n.icon}</div>
                  {!collapsed && (
                    <div>
                      <div style={{ fontSize: 14 }}>{n.label}</div>
                      <div style={{ fontSize: 12, color: "#9fbfcd" }}>Quick access</div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div style={{ marginTop: "auto" }}>
          <button onClick={handleLogout} style={{ width: "100%", display: "flex", gap: 10, alignItems: "center", padding: 10, borderRadius: 8, background: "#fff", color: "#ef4444", fontWeight: 700, border: "none" }}>
            <FaSignOutAlt />
            {!collapsed && <span>Logout</span>}
          </button>

          <div style={{ marginTop: 12, fontSize: 12, color: "#9fbfcd" }}>
            {!collapsed ? (
              <>
                <div>Unique ID: <strong style={{ color: "#fff" }}>{promoter?.uniqueId || "—"}</strong></div>
                <div style={{ marginTop: 6 }}>Payout email: <span style={{ color: "#fff" }}>{promoter?.email || "—"}</span></div>
              </>
            ) : <div style={{ textAlign: "center", color: "#cfeaf6" }}>v1.0</div>}
            {promoterError && <div style={S.errorBox}>{promoterError}</div>}
          </div>
        </div>
      </aside>

      <main style={S.main}>
        <div style={S.topbar}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20 }}>Welcome, {promoter?.name || name}</h1>
            <div style={S.smallMuted}>Unique ID: <strong>{promoter?.uniqueId || "—"}</strong></div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ ...S.card, padding: 10, minWidth: 140, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Students Referred</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{metricsLoading ? "…" : (studentsReferred ?? 0)}</div>
            </div>
            <div style={{ ...S.card, padding: 10, minWidth: 140, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Packages Purchased</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{metricsLoading ? "…" : (packagesCount ?? 0)}</div>
            </div>
            <div style={{ ...S.card, padding: 10, minWidth: 180, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Pending Payout</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{metricsLoading ? "…" : fmtINR(pendingAmount)}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>Total paid: {metricsLoading ? "…" : fmtINR(totalPaid)}</div>
            </div>
          </div>
        </div>

        <div>
          {metricsError && <div style={S.errorBox}>{metricsError}</div>}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
