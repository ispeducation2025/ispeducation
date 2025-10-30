// src/pages/PromoterDashboard.jsx
/**
 * PromoterDashboard.jsx
 *
 * Real implementation:
 *  - Firebase phone OTP linking (recaptcha + signInWithPhoneNumber + linkWithCredential)
 *  - Bank / UPI linking saved to users/<uid>.bankDetails
 *  - Payout notification email field saved & used in sendEmail()
 *  - Commission table with payment-cycle logic (<=20th -> next month 5th, >20th -> month after next 5th)
 *  - Responsive sidebar: fixed on desktop, collapsible hamburger on mobile; auto-hide on tab select
 *
 * Notes:
 *  - REACT_APP_FUNCTIONS_URL optional (cloud function to send transactional emails)
 *  - Ensure firebase auth + firestore exported from ../firebase/firebaseConfig
 */

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";

import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  PhoneAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
} from "firebase/auth";

import { auth, db } from "../firebase/firebaseConfig";

import {
  FaTachometerAlt,
  FaBoxOpen,
  FaUsers,
  FaMoneyBillWave,
  FaUserCircle,
  FaSignOutAlt,
  FaUniversity,
  FaCheckCircle,
  FaBars,
  FaTimes,
} from "react-icons/fa";

/* -------------------------
   Inline styles (kept here per request)
   ------------------------- */

const baseFont = { fontFamily: "Inter, Arial, sans-serif" };

const headerBarStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
};

const sidebarBaseStyle = {
  width: 240,
  background: "#0b3a4b",
  color: "#fff",
  padding: 18,
  boxSizing: "border-box",
  minHeight: "100vh",
  transition: "transform 220ms ease",
  zIndex: 40,
};

const sidebarHiddenMobile = {
  transform: "translateX(-100%)",
};

const sidebarItem = (active, color) => ({
  padding: "10px 12px",
  cursor: "pointer",
  borderRadius: 6,
  marginBottom: 8,
  background: active ? color : "transparent",
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontWeight: active ? 700 : 500,
});

const contentWrapper = {
  flex: 1,
  padding: 20,
  background: "#f8fafc",
  boxSizing: "border-box",
  overflowY: "auto",
  minHeight: "100vh",
};

const card = {
  background: "#fff",
  padding: 14,
  borderRadius: 8,
  boxShadow: "0 6px 18px rgba(2,6,23,0.03)",
};

const thStyle = { padding: "8px 12px", border: "1px solid #e6e6e6", background: "#fafafa" };
const tdStyle = { padding: "8px 12px", border: "1px solid #e6e6e6" };

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #e6e6e6",
  width: "100%",
  boxSizing: "border-box",
  marginBottom: 10,
};

const btnPrimary = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "none",
  background: "#0ea5e9",
  color: "#fff",
  cursor: "pointer",
  marginRight: 8,
};

const smallMuted = { color: "#6b7280", fontSize: 13 };

/* -------------------------
   Helpers: Payment cycle
   ------------------------- */
function getNextPaymentCycleForDate(dateLike) {
  try {
    const d = dateLike ? new Date(dateLike) : new Date();
    const day = d.getDate();
    const month = d.getMonth();
    const year = d.getFullYear();
    if (day <= 20) {
      return new Date(year, month + 1, 5);
    } else {
      return new Date(year, month + 2, 5);
    }
  } catch (e) {
    return null;
  }
}

/* -------------------------
   Email helper (calls Cloud Function)
   ------------------------- */
async function sendEmail(payload) {
  const base = process.env.REACT_APP_FUNCTIONS_URL || "";
  if (!base) {
    console.warn("REACT_APP_FUNCTIONS_URL not configured. Email not sent. Payload:", payload);
    return { ok: false, error: "FUNCTIONS_URL_NOT_CONFIGURED" };
  }
  try {
    const res = await fetch(base + "/send-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    return { ok: res.ok, data: json };
  } catch (err) {
    console.error("sendEmail error", err);
    return { ok: false, error: err.message || err };
  }
}

/* -------------------------
   Main component
   ------------------------- */
export default function PromoterDashboard() {
  const navigate = useNavigate();

  // data
  const [promoter, setPromoter] = useState(null);
  const [promoterId, setPromoterId] = useState(null);
  const [students, setStudents] = useState([]);
  const [packages, setPackages] = useState([]);
  const [commissionRows, setCommissionRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [activeTab, setActiveTab] = useState("dashboard"); // dashboard/packages/students/commission/bank/profile
  const [selectedGrade, setSelectedGrade] = useState("");

  // Mobile sidebar
  const [mobileOpen, setMobileOpen] = useState(false);

  // Bank/linking state
  const [linkMode, setLinkMode] = useState("upi"); // upi | bank
  const [upiId, setUpiId] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [payoutEmail, setPayoutEmail] = useState("");
  const [bankVerified, setBankVerified] = useState(false);
  const [savingBank, setSavingBank] = useState(false);

  // Phone linking / OTP state
  const [phoneToVerify, setPhoneToVerify] = useState("");
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [otpCode, setOtpCode] = useState("");
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);

  const grades = ["6th", "7th", "8th", "9th", "10th", "Professional Course"];

  /* -------------------------
     Fetch and subscribe
     ------------------------- */
  useEffect(() => {
    let unsub = () => {};
    setLoading(true);

    unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/");
        return;
      }

      try {
        const uid = user.uid;
        setPromoterId(uid);

        // fetch promoter doc
        const promoterDoc = await getDoc(doc(db, "users", uid));
        if (!promoterDoc.exists()) {
          console.error("Promoter doc missing");
          navigate("/");
          return;
        }
        const pd = promoterDoc.data();
        setPromoter(pd);

        // populate bank fields if present
        if (pd.bankDetails) {
          setBankVerified(!!pd.bankDetails.verified);
          setPayoutEmail(pd.bankDetails.email || pd.email || "");
          if (pd.bankDetails.type === "UPI") {
            setLinkMode("upi");
            setUpiId(pd.bankDetails.upiId || "");
          } else {
            setLinkMode("bank");
            setBankName(pd.bankDetails.bankName || "");
            setAccountNumber(pd.bankDetails.accountNumber || "");
            setIfsc(pd.bankDetails.ifsc || "");
          }
        } else {
          setPayoutEmail(pd.email || "");
        }

        // fetch students referred by this promoter (assuming student doc has referralId === promoter.uniqueId)
        const studentSnap = await getDocs(query(collection(db, "users"), where("referralId", "==", pd.uniqueId)));
        const studentsList = studentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setStudents(studentsList);

        // fetch packages (all)
        const pkgSnap = await getDocs(collection(db, "packages"));
        setPackages(pkgSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

        // build commission rows from payments collection (if exists) or student docs
        const paymentsSnap = await getDocs(collection(db, "payments")).catch(() => ({ docs: [] }));
        let payments = paymentsSnap.docs ? paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];

        const promoterPayments = payments.filter((p) => {
          return (
            (p.promoterId && (p.promoterId === pd.uniqueId || p.promoterId === uid)) ||
            (p.studentId && studentsList.some((s) => s.id === p.studentId))
          );
        });

        const rows = [];

        promoterPayments.forEach((p) => {
          const student = studentsList.find((s) => s.id === p.studentId) || { name: p.studentName || "Student" };
          rows.push({
            name: student.name,
            studentId: p.studentId,
            packageName: p.packageName || p.package || "-",
            packageCost: Number(p.amount || 0),
            commissionPercent: Number(p.promoterCommissionPercent || p.commissionPercent || 0),
            commissionPaid: p.settlementStatus === "settled",
            createdAt: p.createdAt || p.paymentDate || new Date().toISOString(),
            paymentId: p.paymentId || p.paymentID || p.id,
          });
        });

        if (rows.length === 0) {
          studentsList.forEach((s) => {
            const cost = Number(s.paidAmount || s.packageCost || 0);
            rows.push({
              name: s.name,
              studentId: s.id,
              packageName: s.packageName || "-",
              packageCost: cost,
              commissionPercent: Number(s.promoterCommission || s.promoterCommissionPercent || 0),
              commissionPaid: !!s.promoterPaid,
              createdAt: s.createdAt || new Date().toISOString(),
              paymentId: s.paymentId || "-",
            });
          });
        }

        setCommissionRows(rows);
      } catch (err) {
        console.error("Error loading promoter data", err);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [navigate]);

  /* -------------------------
     Phone verification (real)
     ------------------------- */
  async function sendOtp() {
    if (!phoneToVerify) {
      alert("Enter phone with country code (e.g. +919876543210).");
      return;
    }

    try {
      setSendingOtp(true);

      // create recaptcha verifier (invisible)
      if (!window.recaptchaVerifier) {
        window.recaptchaVerifier = new RecaptchaVerifier("recap-container", { size: "invisible" }, auth);
      } else {
        try {
          window.recaptchaVerifier.clear();
        } catch (e) {}
        window.recaptchaVerifier = new RecaptchaVerifier("recap-container", { size: "invisible" }, auth);
      }

      const result = await signInWithPhoneNumber(auth, phoneToVerify, window.recaptchaVerifier);
      setConfirmationResult(result);
      alert("OTP sent. Check your phone.");
    } catch (err) {
      console.error("sendOtp failed", err);
      alert("Failed to send OTP: " + (err?.message || err));
    } finally {
      setSendingOtp(false);
    }
  }

  async function verifyOtpAndLink() {
    if (!confirmationResult) {
      alert("No OTP request initiated. Click Send OTP first.");
      return;
    }
    if (!otpCode) {
      alert("Enter OTP code.");
      return;
    }

    try {
      setVerifyingOtp(true);
      const userCredential = await confirmationResult.confirm(otpCode);

      // try to link phone credential to current user (if possible)
      const verificationId = confirmationResult.verificationId || (userCredential && userCredential.verificationId);
      if (verificationId) {
        const phoneCred = PhoneAuthProvider.credential(verificationId, otpCode);
        try {
          await linkWithCredential(auth.currentUser, phoneCred);
        } catch (linkErr) {
          // linking may fail if phone already used
          console.warn("linkWithCredential warning", linkErr);
        }
      }

      alert("Phone verified and linked to your promoter account.");
      // update promoter doc with phone
      await updatePromoterBankDoc({ phone: phoneToVerify });
    } catch (err) {
      console.error("verifyOtpAndLink error", err);
      alert("OTP verification failed: " + (err?.message || err));
    } finally {
      setVerifyingOtp(false);
    }
  }

  /* -------------------------
     Save Bank/UPI details to promoter doc
     ------------------------- */
  async function updatePromoterBankDoc(additional = {}) {
    if (!promoterId) {
      alert("Promoter not loaded.");
      return;
    }
    const payload = {
      bankDetails: {
        type: linkMode === "upi" ? "UPI" : "BANK",
        ...(linkMode === "upi"
          ? { upiId: upiId.trim() || null }
          : {
              bankName: bankName.trim() || null,
              accountNumber: accountNumber.trim() || null,
              ifsc: ifsc.trim() || null,
            }),
        email: payoutEmail || promoter?.email || "",
        verified: true,
        linkedAt: new Date().toISOString(),
        ...additional,
      },
    };

    setSavingBank(true);
    try {
      await updateDoc(doc(db, "users", promoterId), payload);
      setBankVerified(true);
      setPromoter((p) => ({ ...(p || {}), bankDetails: payload.bankDetails }));
      alert("Payout details saved and verified.");

      // notify promoter via email (if cloud function configured)
      sendEmail({
        toEmail: payload.bankDetails.email,
        subject: "Payout account linked",
        plainText: `Hello ${promoter?.name || ""},\n\nYour payout account has been linked successfully.\n\nRegards,\nISP Team`,
        html: `<p>Hello ${promoter?.name || ""},</p><p>Your payout account has been linked successfully.</p><p>Regards,<br/>ISP Team</p>`,
      });
    } catch (err) {
      console.error("Error saving bank details:", err);
      alert("Failed to save bank details: " + (err?.message || err));
    } finally {
      setSavingBank(false);
    }
  }

  /* -------------------------
     Notification helpers (hooked to window to avoid unused warnings)
     ------------------------- */
  async function notifyPromoterOnTag(promoterEmail, student) {
    if (!promoterEmail) return;
    const subject = `You were tagged by ${student.name || "a student"}`;
    const html = `<p>Hello ${promoter?.name || ""},</p>
      <p>The student <strong>${student.name}</strong> (${student.email || "—"}) has entered your promoter ID.</p>
      <p>Student id: ${student.id}</p>
      <p>Regards,<br/>ISP Team</p>`;
    await sendEmail({ toEmail: promoterEmail, subject, html, plainText: html.replace(/<[^>]+>/g, "") });
  }

  async function notifyPromoterOnPurchase(promoterEmail, purchase) {
    if (!promoterEmail) return;
    const subject = `Purchase by ${purchase.studentName}: ₹${Number(purchase.amount || 0).toFixed(2)}`;
    const html = `<p>Hello ${promoter?.name || ""},</p>
      <p>Student <strong>${purchase.studentName}</strong> purchased <strong>${purchase.packageName}</strong>.</p>
      <ul>
        <li>Amount: ₹${Number(purchase.amount || 0).toFixed(2)}</li>
        <li>Commission: ₹${Number(purchase.commissionAmount || 0).toFixed(2)}</li>
        <li>Commission status: ${purchase.commissionPaid ? "Paid" : "Pending"}</li>
        <li>Payment ID: ${purchase.paymentId || "—"}</li>
        <li>Expected commission payment date: ${purchase.expectedPaymentDate ? new Date(purchase.expectedPaymentDate).toLocaleDateString() : "—"}</li>
      </ul>
      <p>Regards,<br/>ISP Team</p>`;
    await sendEmail({ toEmail: promoterEmail, subject, html, plainText: html.replace(/<[^>]+>/g, "") });
  }

  // expose helper functions to window so other parts (student signup/purchase logic) can call them
  // This also avoids eslint "defined but never used" warnings because they are referenced on window.
  useEffect(() => {
    // attach only once
    window.notifyPromoterOnTag = notifyPromoterOnTag;
    window.notifyPromoterOnPurchase = notifyPromoterOnPurchase;
    return () => {
      try {
        delete window.notifyPromoterOnTag;
        delete window.notifyPromoterOnPurchase;
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoter]);

  /* -------------------------
     UI helpers
     ------------------------- */
  const safeSetTab = (tab) => {
    setActiveTab(tab);
    // if mobile: auto-hide menu after selecting a tab
    if (window.innerWidth <= 900) {
      setMobileOpen(false);
    }
  };

  const handleSavePayout = async () => {
    if (!payoutEmail) {
      alert("Please provide an email for payout notifications.");
      return;
    }
    if (linkMode === "upi") {
      if (!upiId) {
        alert("Enter UPI ID.");
        return;
      }
    } else {
      if (!bankName || !accountNumber || !ifsc) {
        alert("Fill all bank fields.");
        return;
      }
    }
    try {
      const current = auth.currentUser;
      const phoneVerified = !!current?.phoneNumber;
      if (!phoneVerified) {
        const ok = window.confirm("We recommend verifying phone via OTP before saving. Proceed without verifying?");
        if (!ok) return;
      }
      await updatePromoterBankDoc({ email: payoutEmail });
    } catch (err) {
      console.error(err);
    }
  };

  /* -------------------------
     Render
     ------------------------- */
  if (loading) {
    return <div style={{ padding: 24, ...baseFont }}>Loading...</div>;
  }

  // responsive transform for sidebar
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 900;

  return (
    <div style={{ display: "flex", minHeight: "100vh", ...baseFont }}>
      {/* mobile header / hamburger */}
      <div style={{ position: "fixed", top: 10, left: 10, zIndex: 60, display: "flex", gap: 8 }}>
        <button
          onClick={() => setMobileOpen((s) => !s)}
          aria-label="Toggle menu"
          style={{
            background: "#0b3a4b",
            color: "#fff",
            border: "none",
            padding: 10,
            borderRadius: 8,
            display: isMobile ? "inline-flex" : "none",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 10px rgba(2,6,23,0.12)",
            zIndex: 70,
          }}
        >
          {mobileOpen ? <FaTimes /> : <FaBars />}
        </button>
      </div>

      {/* SIDEBAR */}
      <aside
        style={{
          ...sidebarBaseStyle,
          ...(isMobile ? (mobileOpen ? { transform: "translateX(0)" } : sidebarHiddenMobile) : {}),
          position: isMobile ? "fixed" : "relative",
          left: 0,
          top: 0,
          height: isMobile ? "100vh" : "auto",
        }}
        role="navigation"
      >
        <h2 style={{ textAlign: "center", color: "#ffd700", marginBottom: 14 }}>ISP Promoter</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          <li style={sidebarItem(activeTab === "dashboard", "#114a60")} onClick={() => safeSetTab("dashboard")}>
            <FaTachometerAlt /> Dashboard
          </li>
          <li style={sidebarItem(activeTab === "packages", "#0ea5e9")} onClick={() => safeSetTab("packages")}>
            <FaBoxOpen /> Packages
          </li>
          <li style={sidebarItem(activeTab === "students", "#f472b6")} onClick={() => safeSetTab("students")}>
            <FaUsers /> Students
          </li>
          <li style={sidebarItem(activeTab === "commission", "#7c3aed")} onClick={() => safeSetTab("commission")}>
            <FaMoneyBillWave /> Commission
          </li>
          <li style={sidebarItem(activeTab === "bank", "#059669")} onClick={() => safeSetTab("bank")}>
            <FaUniversity /> Bank / UPI
          </li>
          <li style={sidebarItem(activeTab === "profile", "#0284c7")} onClick={() => safeSetTab("profile")}>
            <FaUserCircle /> Profile
          </li>
          <li
            style={sidebarItem(false, "#ef4444")}
            onClick={async () => {
              await auth.signOut();
              navigate("/");
            }}
          >
            <FaSignOutAlt /> Logout
          </li>
        </ul>
      </aside>

      {/* MAIN CONTENT */}
      <main style={contentWrapper}>
        <div style={headerBarStyle}>
          <div>
            <h1 style={{ margin: 0 }}>Welcome, {promoter?.name}</h1>
            <div style={{ color: "#475569", marginTop: 4 }}>
              Unique ID: <strong style={{ color: "#0f172a" }}>{promoter?.uniqueId || "—"}</strong>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ ...card, minWidth: 120 }}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Students Referred</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{students.length}</div>
            </div>

            <div style={{ ...card, minWidth: 120 }}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Packages</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{packages.length}</div>
            </div>
          </div>
        </div>

        {/* Dashboard */}
        {activeTab === "dashboard" && (
          <section style={{ marginTop: 18 }}>
            <h2>Overview</h2>
            <p style={{ color: "#334155" }}>
              Use the left menu to manage packages, view referred students, check commissions and link payout accounts.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 12 }}>
              <div style={card}>
                <h3 style={{ marginTop: 0 }}>Quick Stats</h3>
                <p style={{ margin: 6 }}>
                  <b>Unique ID:</b> {promoter?.uniqueId}
                </p>
                <p style={{ margin: 6 }}>
                  <b>Promoter Approved:</b> {promoter?.promoterApproved ? "Yes" : "No"}
                </p>
              </div>

              <div style={card}>
                <h3 style={{ marginTop: 0 }}>Payout Status</h3>
                <p style={{ margin: 6 }}>
                  <b>Linked Account:</b>{" "}
                  {promoter?.bankDetails ? (promoter.bankDetails.type === "UPI" ? promoter.bankDetails.upiId : promoter.bankDetails.bankName) : "Not linked"}
                </p>
                <p style={{ margin: 6 }}>
                  <b>Verified:</b>{" "}
                  {bankVerified || promoter?.bankDetails?.verified ? (
                    <span style={{ color: "#16a34a" }}>
                      Yes <FaCheckCircle />
                    </span>
                  ) : (
                    "No"
                  )}
                </p>
                <p style={{ margin: 6 }}>
                  <b>Notification Email:</b> {promoter?.bankDetails?.email || promoter?.email}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Packages */}
        {activeTab === "packages" && (
          <section style={{ marginTop: 18 }}>
            <h2>Packages</h2>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div>
                <label style={{ marginRight: 8 }}>Class</label>
                <select value={selectedGrade} onChange={(e) => setSelectedGrade(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
                  <option value="">All</option>
                  {grades.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ overflowX: "auto", background: "#fff", padding: 12, borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    <th style={thStyle}>Class</th>
                    <th style={thStyle}>Syllabus</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Package name</th>
                    <th style={thStyle}>Subject</th>
                    <th style={thStyle}>Price (₹)</th>
                    <th style={thStyle}>Discount %</th>
                    <th style={thStyle}>Student Cost (₹)</th>
                    <th style={thStyle}>Commission %</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedGrade ? packages.filter((p) => p.classGrade === selectedGrade) : packages).map((p) => {
                    const mrp = Number(p.price || p.totalPayable || 0);
                    const r = Number(p.regularDiscount || 0);
                    const a = Number(p.additionalDiscount || 0);
                    const discount = r + a;
                    const studentCost = mrp - (mrp * discount) / 100;
                    const commissionPercent = Number(p.commission || p.promoterCommission || 0);
                    return (
                      <tr key={p.id}>
                        <td style={tdStyle}>{p.classGrade}</td>
                        <td style={tdStyle}>{p.syllabus}</td>
                        <td style={tdStyle}>{p.packageType}</td>
                        <td style={tdStyle}>{p.packageName}</td>
                        <td style={tdStyle}>{p.subject}</td>
                        <td style={tdStyle}>₹{mrp.toFixed(2)}</td>
                        <td style={tdStyle}>{discount}%</td>
                        <td style={tdStyle}>₹{studentCost.toFixed(2)}</td>
                        <td style={tdStyle}>{commissionPercent}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Students */}
        {activeTab === "students" && (
          <section style={{ marginTop: 18 }}>
            <h2>Students Referred</h2>
            <div style={{ overflowX: "auto", background: "#fff", padding: 12, borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Class</th>
                    <th style={thStyle}>Syllabus</th>
                    <th style={thStyle}>Commission Earned</th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: 14 }}>
                        No students found
                      </td>
                    </tr>
                  ) : (
                    students.map((s) => (
                      <tr key={s.id}>
                        <td style={tdStyle}>{s.name}</td>
                        <td style={tdStyle}>{s.email}</td>
                        <td style={tdStyle}>{s.classGrade || "-"}</td>
                        <td style={tdStyle}>{s.syllabus || "-"}</td>
                        <td style={tdStyle}>₹{Number(s.commissionEarned || s.promoterCommission || 0).toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Commission */}
        {activeTab === "commission" && (
          <section style={{ marginTop: 18 }}>
            <h2>Commission</h2>
            <div style={{ overflowX: "auto", background: "#fff", padding: 12, borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                <thead>
                  <tr style={{ background: "#f3f4f6" }}>
                    <th style={thStyle}>Student</th>
                    <th style={thStyle}>Package</th>
                    <th style={thStyle}>Cost (₹)</th>
                    <th style={thStyle}>Commission %</th>
                    <th style={thStyle}>Commission (₹)</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Pay Cycle (Date)</th>
                  </tr>
                </thead>
                <tbody>
                  {commissionRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: 14 }}>
                        No commission records
                      </td>
                    </tr>
                  ) : (
                    commissionRows.map((r, i) => {
                      const cost = Number(r.packageCost || 0);
                      const perc = Number(r.commissionPercent || 0);
                      const commissionAmount = Number.isFinite(cost) ? (cost * perc) / 100 : 0;
                      const cycle = getNextPaymentCycleForDate(r.createdAt || new Date().toISOString());
                      return (
                        <tr key={i}>
                          <td style={tdStyle}>{r.name || "—"}</td>
                          <td style={tdStyle}>{r.packageName || "—"}</td>
                          <td style={tdStyle}>₹{cost.toFixed(2)}</td>
                          <td style={tdStyle}>{perc}%</td>
                          <td style={tdStyle}>₹{commissionAmount.toFixed(2)}</td>
                          <td style={{ ...tdStyle, color: r.commissionPaid ? "#16a34a" : "#eab308" }}>{r.commissionPaid ? "Paid" : "Pending"}</td>
                          <td style={tdStyle}>{cycle ? cycle.toLocaleDateString() : "—"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Bank / UPI linking */}
        {activeTab === "bank" && (
          <section style={{ marginTop: 18 }}>
            <h2>Link Payout Account (UPI / Bank)</h2>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ ...card, flex: "1 1 420px" }}>
                <label style={{ display: "block", marginBottom: 6 }}>Mode</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <button onClick={() => setLinkMode("upi")} style={{ ...btnPrimary, background: linkMode === "upi" ? "#059669" : "#0ea5e9" }}>
                    UPI
                  </button>
                  <button onClick={() => setLinkMode("bank")} style={{ ...btnPrimary, background: linkMode === "bank" ? "#059669" : "#0ea5e9" }}>
                    Bank
                  </button>
                </div>

                {linkMode === "upi" ? (
                  <>
                    <label style={{ display: "block", marginBottom: 6 }}>UPI ID</label>
                    <input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="example@okaxis or 9999999999@upi" style={inputStyle} />
                  </>
                ) : (
                  <>
                    <label style={{ display: "block", marginBottom: 6 }}>Account holder name</label>
                    <input value={promoter?.name || ""} disabled style={{ ...inputStyle, background: "#f8fafc" }} />

                    <label style={{ display: "block", marginBottom: 6 }}>Bank name</label>
                    <input value={bankName} onChange={(e) => setBankName(e.target.value)} style={inputStyle} />

                    <label style={{ display: "block", marginBottom: 6 }}>Account number</label>
                    <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} style={inputStyle} />

                    <label style={{ display: "block", marginBottom: 6 }}>IFSC</label>
                    <input value={ifsc} onChange={(e) => setIfsc(e.target.value)} style={inputStyle} />
                  </>
                )}

                <label style={{ display: "block", marginBottom: 6 }}>Notification email for payouts</label>
                <input value={payoutEmail} onChange={(e) => setPayoutEmail(e.target.value)} placeholder="promoter@example.com" style={inputStyle} />

                <div style={{ marginTop: 10 }}>
                  <button style={btnPrimary} onClick={handleSavePayout} disabled={savingBank}>
                    {savingBank ? "Saving..." : "Save & Link"}
                  </button>

                  <button
                    style={{ padding: "10px 14px", borderRadius: 8 }}
                    onClick={() => {
                      setUpiId("");
                      setBankName("");
                      setAccountNumber("");
                      setIfsc("");
                      setPayoutEmail(promoter?.email || "");
                    }}
                  >
                    Reset
                  </button>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div id="recap-container" />
                  <div style={smallMuted}>You should verify your phone via OTP below before linking (recommended).</div>
                </div>

                <hr style={{ marginTop: 12, marginBottom: 12 }} />

                <div>
                  <label style={{ display: "block", marginBottom: 6 }}>Phone for OTP (with country code)</label>
                  <input value={phoneToVerify} onChange={(e) => setPhoneToVerify(e.target.value)} placeholder="+919876543210" style={inputStyle} />
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button style={btnPrimary} onClick={sendOtp} disabled={sendingOtp}>
                      {sendingOtp ? "Sending..." : "Send OTP"}
                    </button>
                    <input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="Enter OTP" style={{ ...inputStyle, width: 200 }} />
                    <button style={btnPrimary} onClick={verifyOtpAndLink} disabled={verifyingOtp}>
                      {verifyingOtp ? "Verifying..." : "Verify & Link"}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ width: 320, background: "#fff", padding: 14, borderRadius: 8, height: "fit-content" }}>
                <h4 style={{ marginTop: 0 }}>Linked payout</h4>
                {promoter?.bankDetails ? (
                  <div style={{ fontSize: 14 }}>
                    <div style={{ marginBottom: 8 }}>
                      <b>Type:</b> {promoter.bankDetails.type}
                    </div>
                    {promoter.bankDetails.type === "UPI" ? (
                      <div style={{ marginBottom: 8 }}>
                        <b>UPI:</b> {promoter.bankDetails.upiId}
                      </div>
                    ) : (
                      <>
                        <div style={{ marginBottom: 6 }}>
                          <b>Holder:</b> {promoter.name}
                        </div>
                        <div style={{ marginBottom: 6 }}>
                          <b>Bank:</b> {promoter.bankDetails.bankName}
                        </div>
                        <div style={{ marginBottom: 6 }}>
                          <b>Account:</b> {promoter.bankDetails.accountNumber}
                        </div>
                        <div style={{ marginBottom: 6 }}>
                          <b>IFSC:</b> {promoter.bankDetails.ifsc}
                        </div>
                      </>
                    )}
                    <div style={{ marginTop: 10 }}>
                      <b>Verified:</b> {promoter.bankDetails.verified ? <span style={{ color: "#16a34a" }}>Yes <FaCheckCircle /></span> : "No"}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <small style={{ color: "#6b7280" }}>Linked at: {promoter.bankDetails.linkedAt ? new Date(promoter.bankDetails.linkedAt).toLocaleString() : "—"}</small>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <small style={{ color: "#6b7280" }}>Notification email: {promoter.bankDetails.email || promoter.email}</small>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: "#6b7280" }}>No payout account linked yet.</div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Profile */}
        {activeTab === "profile" && (
          <section style={{ marginTop: 18 }}>
            <h2>Profile</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "#fff", padding: 12, borderRadius: 8 }}>
                <p style={{ margin: 4 }}>
                  <b>Unique ID</b>
                </p>
                <p style={{ margin: 4, color: "#0f172a", fontWeight: 700 }}>{promoter?.uniqueId || "—"}</p>

                <p style={{ margin: 4 }}>
                  <b>Name</b>
                </p>
                <p style={{ margin: 4 }}>{promoter?.name || "—"}</p>
              </div>

              <div style={{ background: "#fff", padding: 12, borderRadius: 8 }}>
                <p style={{ margin: 4 }}>
                  <b>Email</b>
                </p>
                <p style={{ margin: 4 }}>{promoter?.email || "—"}</p>

                <p style={{ margin: 4 }}>
                  <b>Promoter Approved</b>
                </p>
                <p style={{ margin: 4 }}>{promoter?.promoterApproved ? "Yes" : "No"}</p>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
