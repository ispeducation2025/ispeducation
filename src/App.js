// src/App.js
import React from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";
import SignInPage from "./pages/SignInPage";
import StudentDashboard from "./pages/StudentDashboard";
import PromoterDashboard from "./pages/PromoterDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import ApprovePromoter from "./pages/ApprovePromoter";
import PromoterDatabase from "./pages/PromoterDatabase";
import StudentDatabase from "./pages/StudentDatabase";

// Policy Pages
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Refund from "./pages/Refund";
import Shipping from "./pages/Shipping";
import Contact from "./pages/Contact";

function Layout() {
  const location = useLocation();

  // ✅ Hide footer policies on dashboards only
  const hideFooterRoutes = [
    "/student-dashboard",
    "/promoter-dashboard",
    "/admin-dashboard",
    "/approve-promoter",
    "/promoter-database",
    "/student-database",
  ];

  const shouldShowFooter = !hideFooterRoutes.some((path) =>
    location.pathname.includes(path)
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<SignInPage />} />
          <Route path="/student-dashboard" element={<StudentDashboard />} />
          <Route path="/promoter-dashboard" element={<PromoterDashboard />} />
          <Route path="/admin-dashboard" element={<AdminDashboard />} />
          <Route path="/approve-promoter" element={<ApprovePromoter />} />
          <Route path="/promoter-database" element={<PromoterDatabase />} />
          <Route path="/student-database" element={<StudentDatabase />} />

          {/* Policy Routes */}
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/refund" element={<Refund />} />
          <Route path="/shipping" element={<Shipping />} />
          <Route path="/contact" element={<Contact />} />
        </Routes>
      </div>

      {/* ✅ Footer Policies — hidden on dashboards */}
      {shouldShowFooter && (
        <footer
          style={{
            background: "#1e1e1e",
            color: "#fff",
            padding: "15px 20px",
            display: "flex",
            justifyContent: "center",
            gap: "25px",
            flexWrap: "wrap",
            marginTop: "auto",
          }}
        >
          <Link to="/terms" style={{ color: "#fff", textDecoration: "none" }}>
            Terms & Conditions
          </Link>
          <Link to="/privacy" style={{ color: "#fff", textDecoration: "none" }}>
            Privacy Policy
          </Link>
          <Link to="/refund" style={{ color: "#fff", textDecoration: "none" }}>
            Refund Policy
          </Link>
          <Link to="/shipping" style={{ color: "#fff", textDecoration: "none" }}>
            Shipping Policy
          </Link>
          <Link to="/contact" style={{ color: "#fff", textDecoration: "none" }}>
            Contact Us
          </Link>
        </footer>
      )}
    </div>
  );
}

function App() {
  return (
    <Router>
      <Layout />
    </Router>
  );
}

export default App;
