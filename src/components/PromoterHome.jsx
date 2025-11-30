/* src/components/PromoterHome.jsx */
/* eslint-disable */
import React from "react";
import { useNavigate } from "react-router-dom";
import { FaEnvelope, FaGlobe, FaHandsHelping, FaRegCalendarAlt, FaPhone } from "react-icons/fa";

/**
 * PromoterHome.jsx — Informational page for ISP Education (updated)
 * - More colorful background
 * - Mobile-first responsive improvements (buttons full width on small screens, stacked layout)
 * - Updated contact details & website as requested
 *
 * Drop this single file to replace the previous PromoterHome.jsx
 */

const S = {
  root: {
    padding: 16,
    minHeight: "100%",
    boxSizing: "border-box",
    // brighter, friendly multi-stop gradient with subtle pattern
    background: "radial-gradient(1200px 600px at 10% 10%, rgba(14,165,233,0.10), transparent 10%), radial-gradient(1000px 500px at 90% 90%, rgba(124,58,237,0.06), transparent 10%), linear-gradient(180deg,#fff7ed 0%, #f0f9ff 35%, #fef6ff 70%, #ffffff 100%)"
  },
  container: {
    maxWidth: 980,
    margin: "0 auto",
    background: "linear-gradient(180deg, #ffffffcc, #ffffffcc)", // slightly translucent to allow root gradient to show
    borderRadius: 14,
    padding: 20,
    boxShadow: "0 12px 40px rgba(2,6,23,0.08)",
    overflow: "hidden"
  },
  header: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 900, margin: 0, color: "#0f172a", lineHeight: 1.05 },
  lead: { color: "#475569", fontSize: 15, margin: 0 },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 800, margin: "0 0 8px 0", color: "#0f172a" },
  paragraph: { color: "#374151", lineHeight: 1.6, margin: "6px 0 0 0" },
  bullets: { marginTop: 10, paddingLeft: 18, color: "#374151" },
  bullet: { marginBottom: 8 },
  ctas: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 },
  btnPrimary: {
    padding: "10px 14px",
    borderRadius: 10,
    background: "linear-gradient(90deg,#0ea5e9,#7c3aed)",
    color: "#fff",
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: 8
  },
  btnGhost: {
    padding: "10px 14px",
    borderRadius: 10,
    background: "#fff",
    border: "1px solid #e6e6e6",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
    gap: 12,
    marginTop: 12
  },
  card: {
    background: "linear-gradient(180deg,#f8fafc,#f1f5f9)",
    padding: 14,
    borderRadius: 10,
    minHeight: 110,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between"
  },
  cardTitle: { fontSize: 15, fontWeight: 800, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 },
  smallMuted: { fontSize: 13, color: "#6b7280" },
  footer: {
    marginTop: 18,
    borderTop: "1px solid rgba(14,165,233,0.06)",
    paddingTop: 12,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap"
  },
  contact: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" },
  contactCol: { display: "flex", flexDirection: "column" }
};

export default function PromoterHome() {
  const navigate = useNavigate();

  return (
    <div style={S.root}>
      {/* Inline responsive styles for small screens */}
      <style>
        {`
          @media (max-width: 720px) {
            .ph-container { padding: 16px; border-radius: 12px; }
            .ph-title { font-size: 20px !important; }
            .ph-ctas { flex-direction: column; }
            .ph-ctas button { width: 100% !important; justify-content: center; }
            .ph-grid { grid-template-columns: 1fr !important; }
          }
          @media (min-width: 721px) {
            .ph-ctas button { min-width: 160px; }
          }
        `}
      </style>

      <div className="ph-container" style={S.container}>
        <header style={S.header}>
          <h1 className="ph-title" style={S.title}>About ISP Education</h1>
          <p style={S.lead}>
            ISP Education empowers local educators and community promoters to earn by referring students to our interactive courses.
            We focus on high-quality, curriculum-aligned content delivered via live & self-paced formats — simple to share, transparent to earn.
          </p>
        </header>

        <section style={S.section}>
          <h2 style={S.sectionTitle}>Our mission</h2>
          <p style={S.paragraph}>
            To make excellent school-level learning accessible across India by partnering with local communities and promoters.
            We build short, outcome-focused courses and provide promoters with easy tools and reliable payouts.
          </p>
        </section>

        <section style={S.section}>
          <h2 style={S.sectionTitle}>How promoters earn</h2>
          <ul style={S.bullets}>
            <li style={S.bullet}><strong>Refer students:</strong> Share your unique promoter ID or referral link.</li>
            <li style={S.bullet}><strong>Students purchase courses:</strong> Each purchase generates a commission entry tied to the promoter.</li>
            <li style={S.bullet}><strong>Admin payouts:</strong> Admins verify sales and send payouts (UPI/Bank) — payout history appears in Commission page.</li>
          </ul>
        </section>

        <section style={S.section}>
          <h2 style={S.sectionTitle}>Why partner with ISP</h2>
          <div className="ph-grid" style={S.grid}>
            <div style={S.card}>
              <div style={S.cardTitle}><FaHandsHelping /> Supportive onboarding</div>
              <div style={S.smallMuted}>We assist promoters through setup, sharing, and payout verification.</div>
            </div>

            <div style={S.card}>
              <div style={S.cardTitle}><FaRegCalendarAlt /> Flexible earnings</div>
              <div style={S.smallMuted}>Promote at your convenience — part-time or full-time.</div>
            </div>

            <div style={S.card}>
              <div style={S.cardTitle}><FaGlobe /> Curriculum reach</div>
              <div style={S.smallMuted}>Courses aligned to ICSE/CBSE topics that parents and students trust.</div>
            </div>

            <div style={S.card}>
              <div style={S.cardTitle}><FaEnvelope /> Transparent payouts</div>
              <div style={S.smallMuted}>See commission lines, payout status and history right in your dashboard.</div>
            </div>
          </div>
        </section>

        <section style={S.section}>
          <h2 style={S.sectionTitle}>Quick start — 3 steps</h2>
          <ol style={S.bullets}>
            <li style={S.bullet}><strong>Complete profile:</strong> Add payout details (UPI or Bank) and upload required ID/address proof under Profile → Bank.</li>
            <li style={S.bullet}><strong>Share:</strong> Use Packages to copy referral links or share your unique ID.</li>
            <li style={S.bullet}><strong>Receive payouts:</strong> Admin verifies sales and processes payouts. Check Commission for status and dates.</li>
          </ol>

          <div className="ph-ctas" style={S.ctas}>
            <button
              style={S.btnPrimary}
              onClick={() => navigate("/promoter-dashboard/packages")}
              aria-label="Browse Packages"
            >
              Browse Packages
            </button>

            <button
              style={S.btnGhost}
              onClick={() => navigate("/promoter-dashboard/profile")}
              aria-label="Complete Profile"
            >
              Complete Profile
            </button>
          </div>
        </section>

        <section style={S.section}>
          <h2 style={S.sectionTitle}>FAQs</h2>
          <div style={{ marginTop: 8 }}>
            <div style={{ marginBottom: 10 }}>
              <strong>When do I get paid?</strong>
              <div style={S.smallMuted}>Payouts are processed by admin after verification. Commission and payout dates appear in the Commission page.</div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <strong>How is commission calculated?</strong>
              <div style={S.smallMuted}>Each package lists a commission percentage. Commission = package price × commission % per purchase.</div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <strong>Need help?</strong>
              <div style={S.smallMuted}>Contact admin via the details below or reach out through support channels.</div>
            </div>
          </div>
        </section>

        <footer style={S.footer}>
          <div style={S.contact}>
            <div style={S.contactCol}>
              <strong>ISP Education</strong>
              <span style={S.smallMuted}>Helping students succeed across India</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <a href="mailto:isp.edu2025@gmail.com" style={{ display: "inline-flex", gap: 8, alignItems: "center", textDecoration: "none", color: "inherit" }}>
              <FaEnvelope /> <span style={S.smallMuted}>isp.edu2025@gmail.com</span>
            </a>

            <a href="tel:+919113550018" style={{ display: "inline-flex", gap: 8, alignItems: "center", textDecoration: "none", color: "inherit" }}>
              <FaPhone /> <span style={S.smallMuted}>+91 91135 50018</span>
            </a>

            <a href="https://www.ispeducation.in" target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 8, alignItems: "center", textDecoration: "none", color: "inherit" }}>
              <FaGlobe /> <span style={S.smallMuted}>www.ispeducation.in</span>
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
