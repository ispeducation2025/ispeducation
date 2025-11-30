/* eslint-disable */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { auth } from "../firebase/firebaseConfig";

// Polished Promoter Dashboard (inline styles, heavier UI inspired by your original file)
// - Left sidebar (collapsible) with colored active highlights
// - Topbar with stats and promoter name
// - Compact cards and tables placeholders
// - Uses only inline styles so it fits your existing codebase

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
  cardRow: { display: "flex", gap: 12, flexWrap: "wrap" },
  card: { background: "#fff", padding: 14, borderRadius: 10, boxShadow: "0 6px 18px rgba(2,6,23,0.06)", minWidth: 180, flex: "1 1 220px" },
  tableWrap: { marginTop: 12, background: "#fff", padding: 12, borderRadius: 10, boxShadow: "0 8px 22px rgba(2,6,23,0.04)" },
  th: { padding: "10px 12px", borderBottom: "1px solid #eee", textAlign: "left", fontSize: 13 },
  td: { padding: "10px 12px", borderBottom: "1px solid #f6f6f6", verticalAlign: "top", fontSize: 13 },
  smallMuted: { fontSize: 13, color: "#64748b" },
  btn: { padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer" }
};

export default function PromoterSimpleDashboard({ name = "Promoter" }) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [active, setActive] = useState("dashboard");

  useEffect(() => {
    function onResize() {
      if (window.innerWidth < 920) setCollapsed(true);
      else setCollapsed(false);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const nav = [
    { id: "dashboard", icon: <FaTachometerAlt />, label: "Dashboard", color: "#114a60" },
    { id: "packages", icon: <FaBoxOpen />, label: "Packages", color: "#0ea5e9" },
    { id: "students", icon: <FaUsers />, label: "Students", color: "#f472b6" },
    { id: "commission", icon: <FaMoneyBillWave />, label: "Commission", color: "#7c3aed" },
    { id: "bank", icon: <FaUniversity />, label: "Bank / UPI", color: "#059669" },
    { id: "profile", icon: <FaUserCircle />, label: "Profile", color: "#0284c7" }
  ];

  // NOTE: we do INTERNAL tab switching (setActive) so the UI shows immediately.
  // If you want to navigate the router to dedicated routes, replace setActive(...) with navigate('/promoter/packages') etc.
  const handleNavClick = (id) => {
    setActive(id);
  };

  const handleLogout = async () => {
    try { await auth.signOut(); } catch (e) { console.warn(e); } finally { navigate("/"); }
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
                <div style={{ fontSize: 13, color: "#cfeaf6" }}>Welcome back</div>
              </div>
            )}
          </div>

          <button onClick={() => setCollapsed((s) => !s)} style={{ ...S.btn, background: "transparent", color: "#fff" }} aria-label="toggle menu">
            {collapsed ? <FaBars /> : <FaTimes />}
          </button>
        </div>

        <nav aria-label="Promoter navigation">
          <ul style={S.navList}>
            {nav.map((n) => (
              <li
                key={n.id}
                style={S.navItem(active === n.id, collapsed)}
                onClick={() => handleNavClick(n.id)}
              >
                <div style={{
                  width: 40, height: 36, borderRadius: 8, display: "flex",
                  alignItems: "center", justifyContent: "center",
                  background: active === n.id ? n.color : "rgba(255,255,255,0.03)",
                  color: active === n.id ? "#fff" : "#cfeaf6"
                }}>{n.icon}</div>
                {!collapsed && (
                  <div>
                    <div style={{ fontSize: 14 }}>{n.label}</div>
                    <div style={{ fontSize: 12, color: "#9fbfcd" }}>Quick access</div>
                  </div>
                )}
              </li>
            ))}
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
                <div>Unique ID: <strong style={{ color: "#fff" }}>—</strong></div>
                <div style={{ marginTop: 6 }}>Payout email: <span style={{ color: "#fff" }}>—</span></div>
              </>
            ) : <div style={{ textAlign: "center", color: "#cfeaf6" }}>v1.0</div>}
          </div>
        </div>
      </aside>

      <main style={S.main}>
        <div style={S.topbar}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20 }}>Welcome, {name}</h1>
            <div style={S.smallMuted}>Unique ID: <strong>—</strong></div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ ...S.card, padding: 10, minWidth: 140, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Students Referred</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>0</div>
            </div>
            <div style={{ ...S.card, padding: 10, minWidth: 140, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Packages</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>0</div>
            </div>
            <div style={{ ...S.card, padding: 10, minWidth: 140, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Pending Payout</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>₹0.00</div>
            </div>
          </div>
        </div>

        {/* content area - switch by active */}
        <div>
          {active === "dashboard" && (
            <section>
              <h2 style={{ marginTop: 0 }}>Overview</h2>
              <div style={S.cardRow}>
                <div style={S.card}>
                  <h3 style={{ margin: 0 }}>Payout Status</h3>
                  <div style={{ marginTop: 8 }}>
                    <div style={S.smallMuted}>Linked account</div>
                    <div style={{ fontWeight: 700 }}>Not linked</div>
                    <div style={{ marginTop: 8 }}><span style={S.smallMuted}>Last paid</span></div>
                    <div>-</div>
                  </div>
                </div>

                <div style={S.card}>
                  <h3 style={{ margin: 0 }}>Quick Actions</h3>
                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button style={{ ...S.btn, background: "#059669", color: "#fff" }} onClick={() => setActive("bank")}>Link Bank/UPI</button>
                    <button style={{ ...S.btn, background: "#0ea5e9", color: "#fff" }} onClick={() => setActive("packages")}>Manage Packages</button>
                    <button style={{ ...S.btn, background: "#7c3aed", color: "#fff" }} onClick={() => setActive("commission")}>View Commission</button>
                  </div>
                </div>
              </div>

              <div style={S.tableWrap}>
                <h3 style={{ marginTop: 0 }}>Recent commission activity</h3>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={S.th}>Student</th>
                      <th style={S.th}>Package</th>
                      <th style={S.th}>Cost</th>
                      <th style={S.th}>Commission</th>
                      <th style={S.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={5} style={{ padding: 18, textAlign: "center", color: "#64748b" }}>No records yet</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {active === "packages" && (
            <section>
              <h2 style={{ marginTop: 0 }}>Packages</h2>
              <div style={S.tableWrap}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={S.th}>Class</th>
                      <th style={S.th}>Package</th>
                      <th style={S.th}>Price</th>
                      <th style={S.th}>Commission %</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} style={{ padding: 18, textAlign: "center", color: "#64748b" }}>No packages found</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {active === "students" && (
            <section>
              <h2 style={{ marginTop: 0 }}>Students Referred</h2>
              <div style={S.tableWrap}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={S.th}>Name</th>
                      <th style={S.th}>Unique ID</th>
                      <th style={S.th}>Class</th>
                      <th style={S.th}>Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} style={{ padding: 18, textAlign: "center", color: "#64748b" }}>No students found</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {active === "commission" && (
            <section>
              <h2 style={{ marginTop: 0 }}>Commission</h2>
              <div style={S.tableWrap}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={S.th}>Payment ID</th>
                      <th style={S.th}>Student</th>
                      <th style={S.th}>Commission (₹)</th>
                      <th style={S.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} style={{ padding: 18, textAlign: "center", color: "#64748b" }}>No commission records</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {active === "bank" && (
            <section>
              <h2 style={{ marginTop: 0 }}>Link Bank / UPI</h2>
              <div style={S.card}>
                <div style={{ marginBottom: 8 }}>Add UPI or bank account to receive payouts securely.</div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button style={{ ...S.btn, background: "#059669", color: "#fff" }} onClick={() => { /* open UPI flow */ }}>Link UPI</button>
                  <button style={{ ...S.btn, background: "#0ea5e9", color: "#fff" }} onClick={() => { /* open bank flow */ }}>Link Bank</button>
                </div>
              </div>
            </section>
          )}

          {active === "profile" && (
            <section>
              <h2 style={{ marginTop: 0 }}>Profile</h2>
              <div style={S.card}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{name}</div>
                <div style={{ color: "#64748b", marginTop: 6 }}>Promoter Approved: No</div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
