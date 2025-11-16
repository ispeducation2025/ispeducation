// src/pages/PromoterDashboard.jsx
/**
 * PromoterDashboard.jsx
 *
 * - Works with Firestore collections: users, packages, payments.
 * - Uses Firebase Auth phone verification + linkWithCredential to LINK phone to existing promoter account.
 * - Calls Cloud Function (REACT_APP_FUNCTIONS_URL) to send email notifications.
 * - Responsive, collapsible sidebar (desktop & mobile).
 *
 * Notes:
 * - Ensure you set REACT_APP_FUNCTIONS_URL in your .env (no trailing slash).
 * - Ensure firebase authentication phone number and reCAPTCHA are configured for your domain.
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
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
   Small utility & styles
   ------------------------- */

const styles = {
  root: { display: "flex", minHeight: "100vh", fontFamily: "Inter, Arial, sans-serif" },
  aside: (collapsed) => ({
    width: collapsed ? 0 : 260,
    minWidth: collapsed ? 0 : 260,
    transition: "width 220ms ease",
    background: "#0b3a4b",
    color: "#fff",
    padding: collapsed ? 0 : 18,
    boxSizing: "border-box",
    overflow: "hidden",
  }),
  asideHeader: { textAlign: "center", color: "#ffd700", marginBottom: 14, paddingTop: 6 },
  list: { listStyle: "none", padding: 0, margin: 0 },
  item: (active, color) => ({
    padding: "10px 12px",
    cursor: "pointer",
    borderRadius: 6,
    marginBottom: 8,
    background: active ? color : "transparent",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontWeight: active ? 700 : 500,
  }),
  main: { flex: 1, padding: 20, background: "#f8fafc", boxSizing: "border-box", overflowY: "auto" },
  topbar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  card: { background: "#fff", padding: 14, borderRadius: 8, boxShadow: "0 6px 18px rgba(2,6,23,0.04)" },
  tableWrap: { overflowX: "auto", background: "#fff", padding: 12, borderRadius: 8 },
  th: { padding: "8px 12px", border: "1px solid #e6e6e6", background: "#fafafa" },
  td: { padding: "8px 12px", border: "1px solid #e6e6e6" },
  input: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #e6e6e6",
    width: "100%",
    boxSizing: "border-box",
    marginBottom: 10,
  },
  btnPrimary: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "none",
    background: "#0ea5e9",
    color: "#fff",
    cursor: "pointer",
    marginRight: 8,
  },
  mutedSmall: { color: "#6b7280", fontSize: 13 },
  burgerBtn: {
    background: "transparent",
    border: "none",
    color: "#0f172a",
    fontSize: 20,
    cursor: "pointer",
    padding: 8,
  },
};

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
   Email helper (Cloud Function)
   ------------------------- */
async function sendEmail(payload) {
  const base = process.env.REACT_APP_FUNCTIONS_URL || "";
  if (!base) {
    console.warn("REACT_APP_FUNCTIONS_URL not configured. Email not sent.", payload);
    return { ok: false, error: "FUNCTIONS_URL_NOT_CONFIGURED" };
  }
  try {
    const res = await fetch(base + "/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  const [activeTab, setActiveTab] = useState("dashboard"); // dashboard / packages / students / commission / bank / profile
  const [selectedGrade, setSelectedGrade] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false); // supports desktop collapse + mobile
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);

  // bank/upI + otp state
  const [linkMode, setLinkMode] = useState("upi");
  const [upiId, setUpiId] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [payoutEmail, setPayoutEmail] = useState("");
  const [savingBank, setSavingBank] = useState(false);

  const [phoneToVerify, setPhoneToVerify] = useState("");
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [otpCode, setOtpCode] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  const recaptchaRenderedRef = useRef(false);

  // window resize listener for responsiveness
  useEffect(() => {
    function onResize() {
      setWindowWidth(window.innerWidth);
      // if small screen, auto-collapse
      if (window.innerWidth < 920) setSidebarCollapsed(true);
      else setSidebarCollapsed(false);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ---- Fetch packages on mount (standalone) ----
  useEffect(() => {
    let mounted = true;
    const fetchPackages = async () => {
      try {
        const pkgsSnap = await getDocs(collection(db, "packages"));
        const pkgs = pkgsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (mounted) {
          setPackages(pkgs);
        }
        console.debug("PromoterDashboard: fetched packages:", pkgs.length);
      } catch (err) {
        console.error("PromoterDashboard: failed to fetch packages:", err);
      }
    };
    fetchPackages();
    return () => {
      mounted = false;
    };
  }, []);

  // auth + data bootstrap
  useEffect(() => {
    setLoading(true);
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/");
        return;
      }
      try {
        const uid = user.uid;
        setPromoterId(uid);

        // promoter doc in 'users' collection
        const promoterDoc = await getDoc(doc(db, "users", uid));
        if (!promoterDoc.exists()) {
          console.error("Promoter doc not found for uid:", uid);
          navigate("/");
          return;
        }
        const pd = promoterDoc.data();
        setPromoter(pd);

        // populate bank fields
        if (pd.bankDetails) {
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

        // fetch students that have referralId === pd.uniqueId (collection: users)
        const studentsSnap = await getDocs(query(collection(db, "users"), where("referralId", "==", pd.uniqueId)));
        const studentsList = studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setStudents(studentsList);

        // fetch payments (collection: payments)
        const paymentsSnap = await getDocs(collection(db, "payments")).catch(() => ({ docs: [] }));
        const paymentsList = paymentsSnap.docs ? paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];

        // filter promoter related payments (promoterId could be uniqueId or uid)
        const promoterPayments = paymentsList.filter((p) => {
          return (
            (p.promoterId && (p.promoterId === pd.uniqueId || p.promoterId === uid)) ||
            (p.studentId && studentsList.some((s) => s.id === p.studentId))
          );
        });

        // map payments into rows — include receiptUrl and paymentStatus
        const rows = promoterPayments.map((p) => {
          const s = studentsList.find((st) => st.id === p.studentId) || { name: p.studentName || "Student" };
          return {
            name: s.name,
            studentId: p.studentId,
            packageName: p.packageName || p.package || "-",
            packageCost: Number(p.amount || 0),
            commissionPercent: Number(p.promoterCommissionPercent || p.commissionPercent || 0),
            commissionPaid: (p.status === "paid") || (p.settlementStatus === "settled"),
            createdAt: p.createdAt || p.paymentDate || p.paidAt || new Date().toISOString(),
            paymentId: p.paymentId || p.id,
            receiptUrl: p.receiptUrl || null,
            paymentStatus: p.status || p.settlementStatus || "pending",
          };
        });

        // fallback: if no payments, derive from students' fields
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
              receiptUrl: s.lastReceiptUrl || null,
              paymentStatus: s.promoterPaid ? "paid" : "pending",
            });
          });
        }

        setCommissionRows(rows);
      } catch (err) {
        console.error("Error bootstrapping promoter dashboard:", err);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubAuth();
  }, [navigate]);

  /* -------------------------
     Phone verification (real)
     ------------------------- */

  // Ensure reCAPTCHA is rendered (invisible)
  function ensureRecaptcha() {
    if (typeof window === "undefined") return;
    if (recaptchaRenderedRef.current) return;

    if (!window.recaptchaVerifier) {
      try {
        window.recaptchaVerifier = new RecaptchaVerifier(
          "recap-container",
          { size: "invisible" },
          auth
        );
      } catch (err) {
        console.warn("Recaptcha init warning:", err);
      }
    }
    recaptchaRenderedRef.current = true;
  }

  async function sendOtp() {
    if (!phoneToVerify) {
      alert("Enter phone with country code, e.g. +919876543210");
      return;
    }
    try {
      setSendingOtp(true);
      ensureRecaptcha();

      const confirmation = await signInWithPhoneNumber(auth, phoneToVerify, window.recaptchaVerifier);
      setConfirmationResult(confirmation);
      alert("OTP sent — check your phone.");
    } catch (err) {
      console.error("sendOtp failed:", err);
      // common error: appVerificationDisabledForTesting undefined -> ensure recaptcha properly configured in production
      alert("Failed to send OTP: " + (err?.message || err));
    } finally {
      setSendingOtp(false);
    }
  }

  async function verifyOtpAndLink() {
    if (!confirmationResult) {
      alert("You must request OTP first.");
      return;
    }
    if (!otpCode) {
      alert("Enter OTP code.");
      return;
    }
    try {
      setVerifyingOtp(true);
      // confirm returns a userCredential for the phone sign-in
      const userCredential = await confirmationResult.confirm(otpCode);
      // If phone credential was signed in as separate user, try to create PhoneAuthProvider credential and link to current user
      // Many times confirmationResult.confirm signs-in the phone user; linking may be unnecessary; we'll attempt to link safely.
      const verificationId = confirmationResult.verificationId || (userCredential && userCredential.verificationId);
      if (verificationId) {
        const phoneCred = PhoneAuthProvider.credential(verificationId, otpCode);
        try {
          await linkWithCredential(auth.currentUser, phoneCred);
        } catch (linkErr) {
          // linking may fail if phone already linked; handle gracefully
          console.warn("linkWithCredential result:", linkErr);
        }
      }
      alert("Phone verified and linked.");
      // update promoter doc with phone and phone verified metadata
      await updatePromoterBankDoc({ phone: phoneToVerify, phoneVerified: true });
    } catch (err) {
      console.error("verifyOtpAndLink failed:", err);
      alert("OTP verification failed: " + (err?.message || err));
    } finally {
      setVerifyingOtp(false);
    }
  }

  /* -------------------------
     Save bank/upi
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
      // update local promoter object so UI shows new bank details
      setPromoter((p) => ({ ...(p || {}), bankDetails: payload.bankDetails }));
      alert("Payout details saved.");
      // notify promoter via email
      sendEmail({
        toEmail: payload.bankDetails.email,
        subject: "Payout account linked",
        plainText: `Hello ${promoter?.name || ""}, your payout account has been linked.`,
        html: `<p>Hello ${promoter?.name || ""},</p><p>Your payout account has been linked.</p>`,
      });
    } catch (err) {
      console.error("updatePromoterBankDoc error:", err);
      alert("Failed to save payout details: " + (err?.message || err));
    } finally {
      setSavingBank(false);
    }
  }

  /* -------------------------
     Email notifications for events (stable callbacks)
     ------------------------- */

  const notifyPromoterOnTag = useCallback(
    async (promoterEmail, student) => {
      if (!promoterEmail) return;
      const subject = `You were tagged by ${student.name || "a student"}`;
      const html = `<p>Hello ${promoter?.name || ""},</p>
        <p>The student <strong>${student.name}</strong> (${student.email || "—"}) has entered your promoter ID.</p>
        <p>Student id: ${student.id}</p>`;
      await sendEmail({ toEmail: promoterEmail, subject, html, plainText: html.replace(/<[^>]+>/g, "") });
    },
    [promoter]
  );

  const notifyPromoterOnPurchase = useCallback(
    async (promoterEmail, purchase) => {
      if (!promoterEmail) return;
      const subject = `Purchase by ${purchase.studentName}: ₹${Number(purchase.amount || 0).toFixed(2)}`;
      const html = `<p>Hello ${promoter?.name || ""},</p>
        <p>Student <strong>${purchase.studentName}</strong> purchased <strong>${purchase.packageName}</strong>.</p>
        <ul>
          <li>Amount: ₹${Number(purchase.amount || 0).toFixed(2)}</li>
          <li>Commission: ₹${Number(purchase.commissionAmount || 0).toFixed(2)}</li>
          <li>Commission status: ${purchase.commissionPaid ? "Paid" : "Pending"}</li>
          <li>Payment ID: ${purchase.paymentId || "—"}</li>
          <li>Expected commission date: ${purchase.expectedPaymentDate ? new Date(purchase.expectedPaymentDate).toLocaleDateString() : "—"}</li>
        </ul>`;
      await sendEmail({ toEmail: promoterEmail, subject, html, plainText: html.replace(/<[^>]+>/g, "") });
    },
    [promoter]
  );

  // expose helpers for server/dev usage (attach stable callbacks to window)
  useEffect(() => {
    window.notifyPromoterOnTag = notifyPromoterOnTag;
    window.notifyPromoterOnPurchase = notifyPromoterOnPurchase;
    return () => {
      try {
        delete window.notifyPromoterOnTag;
      } catch {}
      try {
        delete window.notifyPromoterOnPurchase;
      } catch {}
    };
  }, [notifyPromoterOnTag, notifyPromoterOnPurchase]);

  /* -------------------------
     UI behavior helpers
     ------------------------- */

  function setTab(tab) {
    setActiveTab(tab);
    // auto-hide when on mobile or when sidebar is collapsed
    if (windowWidth < 920 || sidebarCollapsed) {
      setSidebarCollapsed(true);
    }
  }

  // save payout click handler
  async function handleSavePayout() {
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

    const current = auth.currentUser;
    const phoneVerified = !!current?.phoneNumber;
    if (!phoneVerified) {
      const ok = window.confirm("We recommend verifying phone via OTP before saving. Proceed without verifying?");
      if (!ok) return;
    }
    await updatePromoterBankDoc({ email: payoutEmail });
  }

  // logout
  async function handleLogout() {
    await auth.signOut();
    navigate("/");
  }

  /* -------------------------
     Render
     ------------------------- */

  if (loading) {
    return <div style={{ padding: 24 }}>Loading...</div>;
  }

  const totals = commissionRows.reduce(
    (acc, r) => {
      const cost = Number(r.packageCost || 0);
      const perc = Number(r.commissionPercent || 0);
      const amount = Number.isFinite(cost) ? (cost * perc) / 100 : 0;
      acc.total += amount;
      if (!r.commissionPaid) acc.pending += amount;
      return acc;
    },
    { total: 0, pending: 0 }
  );

  return (
    <div style={styles.root}>
      {/* Sidebar */}
      <aside style={styles.aside(sidebarCollapsed)}>
        {!sidebarCollapsed && (
          <>
            <div style={styles.asideHeader}>
              <h2 style={{ margin: 0 }}>ISP Promoter</h2>
            </div>
            <ul style={styles.list}>
              <li style={styles.item(activeTab === "dashboard", "#114a60")} onClick={() => setTab("dashboard")}>
                <FaTachometerAlt /> Dashboard
              </li>
              <li style={styles.item(activeTab === "packages", "#0ea5e9")} onClick={() => setTab("packages")}>
                <FaBoxOpen /> Packages
              </li>
              <li style={styles.item(activeTab === "students", "#f472b6")} onClick={() => setTab("students")}>
                <FaUsers /> Students
              </li>
              <li style={styles.item(activeTab === "commission", "#7c3aed")} onClick={() => setTab("commission")}>
                <FaMoneyBillWave /> Commission
              </li>
              <li style={styles.item(activeTab === "bank", "#059669")} onClick={() => setTab("bank")}>
                <FaUniversity /> Bank / UPI
              </li>
              <li style={styles.item(activeTab === "profile", "#0284c7")} onClick={() => setTab("profile")}>
                <FaUserCircle /> Profile
              </li>
              <li style={styles.item(false, "#ef4444")} onClick={handleLogout}>
                <FaSignOutAlt /> Logout
              </li>
            </ul>
          </>
        )}
      </aside>

      {/* Main */}
      <main style={styles.main}>
        {/* top bar: burger + heading + stats */}
        <div style={styles.topbar}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              aria-label="Toggle menu"
              onClick={() => setSidebarCollapsed((s) => !s)}
              style={styles.burgerBtn}
            >
              {sidebarCollapsed ? <FaBars /> : <FaTimes />}
            </button>

            <div>
              <h1 style={{ margin: 0 }}>Welcome, {promoter?.name}</h1>
              <div style={{ color: "#475569", marginTop: 4 }}>
                Unique ID: <strong style={{ color: "#0f172a" }}>{promoter?.uniqueId || "—"}</strong>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <div style={styles.card}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Students Referred</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{students.length}</div>
            </div>
            <div style={styles.card}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Packages</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{packages.length}</div>
            </div>
          </div>
        </div>

        {/* Content area */}
        <div style={{ marginTop: 18 }}>
          {/* Dashboard */}
          {activeTab === "dashboard" && (
            <section>
              <h2>Overview</h2>
              <p style={{ color: "#334155" }}>
                Use the left menu to manage packages, view referred students, check commissions and link payout accounts.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 12 }}>
                <div style={styles.card}>
                  <h3 style={{ marginTop: 0 }}>Quick Stats</h3>
                  <p style={{ margin: 6 }}><b>Unique ID:</b> {promoter?.uniqueId}</p>
                  <p style={{ margin: 6 }}><b>Promoter Approved:</b> {promoter?.promoterApproved ? "Yes" : "No"}</p>
                </div>

                <div style={styles.card}>
                  <h3 style={{ marginTop: 0 }}>Payout Status</h3>
                  <p style={{ margin: 6 }}><b>Linked Account:</b> {promoter?.bankDetails ? (promoter.bankDetails.type === "UPI" ? promoter.bankDetails.upiId : promoter.bankDetails.bankName) : "Not linked"}</p>
                  <p style={{ margin: 6 }}><b>Verified:</b> {promoter?.bankDetails?.verified ? <span style={{ color: "#16a34a" }}>Yes <FaCheckCircle /></span> : "No"}</p>
                  <p style={{ margin: 6 }}><b>Notification Email:</b> {promoter?.bankDetails?.email || promoter?.email}</p>

                  <p style={{ margin: 6 }}>
                    <b>Last Payment:</b>{" "}
                    {promoter?.lastPayment ? (
                      <>
                        {promoter.lastPayment}{" "}
                        {promoter.lastReceiptUrl ? (
                          <a href={promoter.lastReceiptUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 8, color: "#0ea5e9" }}>
                            View Receipt
                          </a>
                        ) : null}
                      </>
                    ) : (
                      "-"
                    )}
                  </p>

                  <p style={{ margin: 6 }}><b>Last Paid Amount:</b> {promoter?.lastPaidAmount ? `₹${Number(promoter.lastPaidAmount).toLocaleString("en-IN")}` : "-"}</p>
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
                    {["6th", "7th", "8th", "9th", "10th", "Professional Course"].map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>

              <div style={styles.tableWrap}>
                {packages.length === 0 ? (
                  <div style={{ padding: 20, textAlign: "center", color: "#6b7280" }}>
                    No packages found. (Check Firestore 'packages' collection or your rules)
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9" }}>
                        <th style={styles.th}>Class</th>
                        <th style={styles.th}>Syllabus</th>
                        <th style={styles.th}>Type</th>
                        <th style={styles.th}>Package name</th>
                        <th style={styles.th}>Subject</th>
                        <th style={styles.th}>Price (₹)</th>
                        <th style={styles.th}>Discount %</th>
                        <th style={styles.th}>Student Cost (₹)</th>
                        <th style={styles.th}>Commission %</th>
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
                            <td style={styles.td}>{p.classGrade}</td>
                            <td style={styles.td}>{p.syllabus}</td>
                            <td style={styles.td}>{p.packageType}</td>
                            <td style={styles.td}>{p.packageName}</td>
                            <td style={styles.td}>{p.subject}</td>
                            <td style={styles.td}>₹{mrp.toFixed(2)}</td>
                            <td style={styles.td}>{discount}%</td>
                            <td style={styles.td}>₹{studentCost.toFixed(2)}</td>
                            <td style={styles.td}>{commissionPercent}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}

          {/* Students */}
          {activeTab === "students" && (
            <section style={{ marginTop: 18 }}>
              <h2>Students Referred</h2>
              <div style={styles.tableWrap}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9" }}>
                      <th style={styles.th}>Name</th>
                      <th style={styles.th}>Email</th>
                      <th style={styles.th}>Class</th>
                      <th style={styles.th}>Syllabus</th>
                      <th style={styles.th}>Commission Earned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign: "center", padding: 14 }}>No students found</td></tr>
                    ) : students.map((s) => (
                      <tr key={s.id}>
                        <td style={styles.td}>{s.name}</td>
                        <td style={styles.td}>{s.email}</td>
                        <td style={styles.td}>{s.classGrade || "-"}</td>
                        <td style={styles.td}>{s.syllabus || "-"}</td>
                        <td style={styles.td}>₹{Number(s.commissionEarned || s.promoterCommission || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Commission */}
          {activeTab === "commission" && (
            <section style={{ marginTop: 18 }}>
              <h2>Commission</h2>
              <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ color: "#475569" }}>
                  <div><b>Rows:</b> {commissionRows.length}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={styles.card}>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>Total Commission</div>
                    <div style={{ fontWeight: 800 }}>₹{totals.total.toFixed(2)}</div>
                  </div>
                  <div style={styles.card}>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>Pending</div>
                    <div style={{ fontWeight: 800 }}>₹{totals.pending.toFixed(2)}</div>
                  </div>
                </div>
              </div>

              <div style={styles.tableWrap}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: "#f3f4f6" }}>
                      <th style={styles.th}>Student</th>
                      <th style={styles.th}>Package</th>
                      <th style={styles.th}>Cost (₹)</th>
                      <th style={styles.th}>Commission %</th>
                      <th style={styles.th}>Commission (₹)</th>
                      <th style={styles.th}>Status</th>
                      <th style={styles.th}>Receipt</th>
                      <th style={styles.th}>Pay Cycle (Date)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commissionRows.length === 0 ? (
                      <tr><td colSpan={8} style={{ textAlign: "center", padding: 14 }}>No commission records</td></tr>
                    ) : commissionRows.map((r, i) => {
                      const cost = Number(r.packageCost || 0);
                      const perc = Number(r.commissionPercent || 0);
                      const commissionAmount = Number.isFinite(cost) ? (cost * perc) / 100 : 0;
                      const cycle = getNextPaymentCycleForDate(r.createdAt || new Date().toISOString());
                      return (
                        <tr key={i}>
                          <td style={styles.td}>{r.name || "—"}</td>
                          <td style={styles.td}>{r.packageName || "—"}</td>
                          <td style={styles.td}>₹{cost.toFixed(2)}</td>
                          <td style={styles.td}>{perc}%</td>
                          <td style={styles.td}>₹{commissionAmount.toFixed(2)}</td>
                          <td style={{ ...styles.td, color: r.commissionPaid ? "#16a34a" : "#eab308" }}>{r.commissionPaid ? "Paid" : "Pending"}</td>
                          <td style={styles.td}>
                            {r.receiptUrl ? (
                              <a href={r.receiptUrl} target="_blank" rel="noreferrer" style={{ color: "#0ea5e9" }}>
                                View Receipt
                              </a>
                            ) : (
                              <span style={{ color: "#6b7280" }}>—</span>
                            )}
                          </td>
                          <td style={styles.td}>{cycle ? cycle.toLocaleDateString() : "—"}</td>
                        </tr>
                      );
                    })}
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
                <div style={{ background: "#fff", padding: 14, borderRadius: 8, flex: "1 1 420px" }}>
                  <label style={{ display: "block", marginBottom: 6 }}>Mode</label>
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button onClick={() => setLinkMode("upi")} style={{ ...styles.btnPrimary, background: linkMode === "upi" ? "#059669" : "#0ea5e9" }}>UPI</button>
                    <button onClick={() => setLinkMode("bank")} style={{ ...styles.btnPrimary, background: linkMode === "bank" ? "#059669" : "#0ea5e9" }}>Bank</button>
                  </div>

                  {linkMode === "upi" ? (
                    <>
                      <label style={{ display: "block", marginBottom: 6 }}>UPI ID</label>
                      <input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="example@okaxis or 9999999999@upi" style={styles.input} />
                    </>
                  ) : (
                    <>
                      <label style={{ display: "block", marginBottom: 6 }}>Account holder name</label>
                      <input value={promoter?.name || ""} disabled style={{ ...styles.input, background: "#f8fafc" }} />
                      <label style={{ display: "block", marginBottom: 6 }}>Bank name</label>
                      <input value={bankName} onChange={(e) => setBankName(e.target.value)} style={styles.input} />
                      <label style={{ display: "block", marginBottom: 6 }}>Account number</label>
                      <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} style={styles.input} />
                      <label style={{ display: "block", marginBottom: 6 }}>IFSC</label>
                      <input value={ifsc} onChange={(e) => setIfsc(e.target.value)} style={styles.input} />
                    </>
                  )}

                  <label style={{ display: "block", marginBottom: 6 }}>Notification email for payouts</label>
                  <input value={payoutEmail} onChange={(e) => setPayoutEmail(e.target.value)} placeholder="promoter@example.com" style={styles.input} />

                  <div style={{ marginTop: 10 }}>
                    <button style={styles.btnPrimary} onClick={handleSavePayout} disabled={savingBank}>
                      {savingBank ? "Saving..." : "Save & Link"}
                    </button>
                    <button style={{ padding: "10px 14px", borderRadius: 8 }} onClick={() => {
                      setUpiId("");
                      setBankName("");
                      setAccountNumber("");
                      setIfsc("");
                      setPayoutEmail(promoter?.email || "");
                    }}>
                      Reset
                    </button>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div id="recap-container" />
                    <div style={styles.mutedSmall}>Verify phone via OTP before linking (recommended).</div>
                  </div>

                  <hr style={{ marginTop: 12, marginBottom: 12 }} />

                  <div>
                    <label style={{ display: "block", marginBottom: 6 }}>Phone for OTP (with country code)</label>
                    <input value={phoneToVerify} onChange={(e) => setPhoneToVerify(e.target.value)} placeholder="+919876543210" style={styles.input} />
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button style={styles.btnPrimary} onClick={sendOtp} disabled={sendingOtp}>{sendingOtp ? "Sending..." : "Send OTP"}</button>
                      <input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="Enter OTP" style={{ ...styles.input, width: 220 }} />
                      <button style={styles.btnPrimary} onClick={verifyOtpAndLink} disabled={verifyingOtp}>{verifyingOtp ? "Verifying..." : "Verify & Link"}</button>
                    </div>
                  </div>
                </div>

                <div style={{ width: 320, background: "#fff", padding: 14, borderRadius: 8 }}>
                  <h4 style={{ marginTop: 0 }}>Linked payout</h4>
                  {promoter?.bankDetails ? (
                    <div style={{ fontSize: 14 }}>
                      <div style={{ marginBottom: 8 }}><b>Type:</b> {promoter.bankDetails.type}</div>
                      {promoter.bankDetails.type === "UPI" ? (
                        <div style={{ marginBottom: 8 }}><b>UPI:</b> {promoter.bankDetails.upiId}</div>
                      ) : (
                        <>
                          <div style={{ marginBottom: 6 }}><b>Holder:</b> {promoter.name}</div>
                          <div style={{ marginBottom: 6 }}><b>Bank:</b> {promoter.bankDetails.bankName}</div>
                          <div style={{ marginBottom: 6 }}><b>Account:</b> {promoter.bankDetails.accountNumber}</div>
                          <div style={{ marginBottom: 6 }}><b>IFSC:</b> {promoter.bankDetails.ifsc}</div>
                        </>
                      )}
                      <div style={{ marginTop: 10 }}><b>Verified:</b> {promoter.bankDetails.verified ? <span style={{ color: "#16a34a" }}>Yes <FaCheckCircle /></span> : "No"}</div>
                      <div style={{ marginTop: 8 }}><small style={{ color: "#6b7280" }}>Linked at: {promoter.bankDetails.linkedAt ? new Date(promoter.bankDetails.linkedAt).toLocaleString() : "—"}</small></div>
                      <div style={{ marginTop: 8 }}><small style={{ color: "#6b7280" }}>Notification email: {promoter.bankDetails.email || promoter.email}</small></div>
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
                  <p style={{ margin: 4 }}><b>Unique ID</b></p>
                  <p style={{ margin: 4, color: "#0f172a", fontWeight: 700 }}>{promoter?.uniqueId || "—"}</p>
                  <p style={{ margin: 4 }}><b>Name</b></p>
                  <p style={{ margin: 4 }}>{promoter?.name || "—"}</p>
                </div>

                <div style={{ background: "#fff", padding: 12, borderRadius: 8 }}>
                  <p style={{ margin: 4 }}><b>Email</b></p>
                  <p style={{ margin: 4 }}>{promoter?.email || "—"}</p>
                  <p style={{ margin: 4 }}><b>Promoter Approved</b></p>
                  <p style={{ margin: 4 }}>{promoter?.promoterApproved ? "Yes" : "No"}</p>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
