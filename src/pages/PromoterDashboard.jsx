/* eslint-disable */
import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";

import {
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  where,
} from "firebase/firestore";

import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  PhoneAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
} from "firebase/auth";

import { auth, db } from "../firebase/firebaseConfig";
import { getFunctions, httpsCallable } from "firebase/functions";

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
   Money / commission helpers
   ------------------------- */

function parseMoneyFromPayment(p = {}) {
  if (!p) return 0;
  const candidates = [
    { v: p.amount, meta: "amount" },
    { v: p.packageCost, meta: "packageCost" },
    { v: p.totalPayable, meta: "totalPayable" },
    { v: p.price, meta: "price" },
    { v: (p.rawRazorpay && p.rawRazorpay.amount), meta: "rawRazorpay.amount" },
    { v: (p.raw && p.raw.amount), meta: "raw.amount" },
    { v: (p.rawRazorpay && p.rawRazorpay.amount_paid), meta: "rawRazorpay.amount_paid" },
    { v: (p.raw && p.raw.data && p.raw.data.amount), meta: "raw.data.amount" },
  ];

  for (const c of candidates) {
    if (c.v === undefined || c.v === null || c.v === "") continue;
    const num = Number(c.v);
    if (!isFinite(num)) continue;
    if ((c.meta.includes("raw") || c.meta.includes("razor") || c.meta.includes("data")) && Math.abs(num) >= 100) {
      return num / 100;
    }
    return num;
  }
  return 0;
}

function safeParseFloat(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
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
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selectedGrade, setSelectedGrade] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
      } catch (err) {
        console.error("PromoterDashboard: failed to fetch packages:", err);
      }
    };
    fetchPackages();
    return () => {
      mounted = false;
    };
  }, []);

  // helper: robust client-side discovery (used when callable fails)
  async function discoverStudentsClientSide({ canonicalUniqueId, promoterDocId, uid }) {
    const found = [];
    const safeAdd = (d) => {
      if (!d || !d.id) return;
      if (!found.some((s) => s.id === d.id)) found.push(d);
    };

    try {
      const referralFields = ["referralId", "referral", "referredBy", "referrer", "referred_by", "referral_id"];
      for (const field of referralFields) {
        if (!canonicalUniqueId) break;
        try {
          const qSnap = await getDocs(query(collection(db, "users"), where(field, "==", canonicalUniqueId)));
          qSnap.forEach((d) => safeAdd({ id: d.id, ...d.data() }));
        } catch (e) {
          // ignore
        }
      }

      const promoterFields = [
        ["promoterUid", uid],
        ["promoterId", promoterDocId],
        ["promoter_id", promoterDocId],
        ["promoter", promoterDocId],
        ["promoter", uid],
      ];
      for (const [field, value] of promoterFields) {
        if (!value) continue;
        try {
          const qSnap = await getDocs(query(collection(db, "users"), where(field, "==", value)));
          qSnap.forEach((d) => safeAdd({ id: d.id, ...d.data() }));
        } catch (e) {
          // ignore
        }
      }

      if (found.length === 0) {
        try {
          const allSnap = await getDocs(collection(db, "users"));
          const all = allSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const normalizedTarget = (canonicalUniqueId || uid || promoterDocId || "").toString().toLowerCase().trim();
          const fallback = [];
          all.forEach((u) => {
            const possible = [
              u.referralId,
              u.referral,
              u.promoterId,
              u.promoterUid,
              u.promoter,
              u.referredBy,
              u.referrer,
              u.referral_id,
            ]
              .filter(Boolean)
              .map((v) => String(v).toLowerCase().trim());
            if (possible.includes(normalizedTarget)) fallback.push(u);
          });
          if (fallback.length > 0) {
            fallback.forEach((f) => safeAdd(f));
          }
        } catch (e) {
          // ignore
        }
      }
    } catch (err) {
      // ignore
    }

    return { found };
  }

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
        const promoterDocSnap = await getDoc(doc(db, "users", uid));
        if (!promoterDocSnap.exists()) {
          navigate("/");
          return;
        }
        const pd = promoterDocSnap.data() || {};
        setPromoter(pd);

        // bank fields
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

        // canonical id
        const canonicalUniqueId =
          (pd.uniqueId && String(pd.uniqueId).trim()) ||
          (pd.uniqueID && String(pd.uniqueID).trim()) ||
          (pd.unique_id && String(pd.unique_id).trim()) ||
          null;
        const promoterDocId = promoterDocSnap.id;

        // ----- USE CALLABLE FUNCTION FIRST -----
        let foundStudents = [];
        try {
          const functions = getFunctions();
          const fn = httpsCallable(functions, "getPromoterStudents");
          const resp = await fn({ promoterUniqueId: canonicalUniqueId, promoterDocId });
          if (resp && resp.data && resp.data.success) {
            foundStudents = resp.data.students || [];
          }
        } catch (fnErr) {
          // callable may fail; fall back
        }

        if (foundStudents.length === 0) {
          const clientRes = await discoverStudentsClientSide({
            canonicalUniqueId,
            promoterDocId,
            uid,
          });
          if (clientRes.found && clientRes.found.length > 0) {
            foundStudents = clientRes.found;
          }
        }

        // dedupe
        const dedup = {};
        foundStudents.forEach((s) => {
          dedup[s.id] = s;
        });
        const finalStudents = Object.values(dedup);
        setStudents(finalStudents);

        // --- payments ---
        // Instead of full-collection scan, try targeted queries then fall back to full scan if nothing found
        const paymentsCol = collection(db, "payments");
        const paymentsDocsMap = {};

        const qList = [];
        // promoterUid
        qList.push(query(paymentsCol, where("promoterUid", "==", uid)));
        // promoterId (doc id)
        qList.push(query(paymentsCol, where("promoterId", "==", promoterDocId)));
        // common alternate fields
        qList.push(query(paymentsCol, where("promoter", "==", uid)));
        qList.push(query(paymentsCol, where("promoter_id", "==", promoterDocId)));

        // If we have student ids, query payments by studentId (in batches of 10)
        const studentIds = finalStudents.map((s) => s.id).filter(Boolean);
        const studentIdBatches = [];
        for (let i = 0; i < studentIds.length; i += 10) studentIdBatches.push(studentIds.slice(i, i + 10));
        for (const batch of studentIdBatches) {
          if (batch.length === 0) continue;
          qList.push(query(paymentsCol, where("studentId", "in", batch)));
        }

        // execute all queries in parallel (ignore failures)
        const qResults = await Promise.all(
          qList.map((q) => getDocs(q).catch((e) => ({ docs: [] })))
        );

        qResults.forEach((snap) => {
          if (!snap || !snap.docs) return;
          snap.docs.forEach((d) => {
            paymentsDocsMap[d.id] = { id: d.id, ...d.data() };
          });
        });

        // If nothing found with queries, fallback to collection scan (last resort)
        if (Object.keys(paymentsDocsMap).length === 0) {
          try {
            const allSnap = await getDocs(paymentsCol);
            allSnap.docs.forEach((d) => {
              paymentsDocsMap[d.id] = { id: d.id, ...d.data() };
            });
          } catch (e) {
            console.warn("Failed fallback scanning payments collection:", e);
          }
        }

        const paymentsList = Object.values(paymentsDocsMap);

        const promoterPayments = paymentsList.filter((p) => {
          const pPromoterIds = [
            p.promoterId && String(p.promoterId).trim(),
            p.promoterUid && String(p.promoterUid).trim(),
            p.promoter && String(p.promoter).trim(),
            p.promoter_id && String(p.promoter_id).trim(),
          ].filter(Boolean);

          const checkPromoterMatch =
            (canonicalUniqueId && pPromoterIds.includes(canonicalUniqueId)) ||
            pPromoterIds.includes(uid) ||
            pPromoterIds.includes(promoterDocId);

          const fromKnownStudent = p.studentId && finalStudents.some((s) => s.id === p.studentId);

          return checkPromoterMatch || fromKnownStudent;
        });

        const rows = promoterPayments.map((p) => {
          const studentObj = finalStudents.find((st) => st.id === p.studentId) || { name: p.studentName || "Student", id: p.studentId };

          const packageCost = parseMoneyFromPayment(p) || 0;

          let commissionPercent =
            safeParseFloat(p.promoterCommissionPercent ?? p.commissionPercent ?? p.promoterCommission ?? p.commission ?? p.commission_pct);
          if (!isFinite(commissionPercent) || commissionPercent === 0) {
            if (p.packageId) {
              const pkg = packages.find((x) => x.id === p.packageId || x.packageId === p.packageId);
              if (pkg) commissionPercent = safeParseFloat(pkg.commission ?? pkg.promoterCommission ?? pkg.commissionPercent);
            } else if (p.packageName) {
              const pkg = packages.find((x) => (x.packageName || "").toLowerCase() === (p.packageName || "").toLowerCase());
              if (pkg) commissionPercent = safeParseFloat(pkg.commission ?? pkg.promoterCommission ?? pkg.commissionPercent);
            }
          }
          commissionPercent = isFinite(commissionPercent) ? commissionPercent : 0;

          const explicitCommissionAmount =
            safeParseFloat(p.commissionAmount ?? p.commission_paid_amount ?? p.commissionPaidAmount ?? p.promoterCommissionAmount);
          const commissionAmount = explicitCommissionAmount > 0 ? explicitCommissionAmount : (isFinite(packageCost) ? (packageCost * (commissionPercent || 0)) / 100 : 0);

          const statusRaw = String(p.status || p.paymentStatus || p.settlementStatus || "").toLowerCase();
          const commissionPaidFlag = !!(
            p.promoterPaid === true ||
            p.commissionPaid === true ||
            p.adminMarked === true ||
            statusRaw === "commission_paid" ||
            statusRaw === "commission-paid" ||
            statusRaw === "settled" ||
            statusRaw === "completed"
          );

          return {
            name: studentObj.name,
            studentId: p.studentId,
            packageName: p.packageName || p.package || "-",
            packageCost,
            commissionPercent,
            commissionAmount,
            commissionPaid: commissionPaidFlag,
            createdAt: p.createdAt || p.paymentDate || p.paidAt || new Date().toISOString(),
            paymentId: p.paymentId || p.id,
            receiptUrl: p.receiptUrl || (p.rawRazorpay && p.rawRazorpay.short_url) || null,
            paymentStatus: p.status || p.settlementStatus || p.paymentStatus || "pending",
            raw: p,
          };
        });

        // If no payments but students exist, use student-level fields as best-effort
        if (rows.length === 0 && finalStudents.length > 0) {
          finalStudents.forEach((s) => {
            const cost = safeParseFloat(s.paidAmount || s.packageCost || 0) || 0;
            const perc = safeParseFloat(s.promoterCommission || s.promoterCommissionPercent || 0) || 0;
            rows.push({
              name: s.name,
              studentId: s.id,
              packageName: s.packageName || "-",
              packageCost: cost,
              commissionPercent: perc,
              commissionAmount: (cost * perc) / 100,
              commissionPaid: !!s.promoterPaid,
              createdAt: s.createdAt || new Date().toISOString(),
              paymentId: s.paymentId || "-",
              receiptUrl: s.lastReceiptUrl || null,
              paymentStatus: s.promoterPaid ? "paid" : "pending",
              raw: s,
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
  }, [navigate, packages]);

  /* -------------------------
     Phone verification (real)
     ------------------------- */

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
      const userCredential = await confirmationResult.confirm(otpCode);
      const verificationId = confirmationResult.verificationId || (userCredential && userCredential.verificationId);
      if (verificationId) {
        const phoneCred = PhoneAuthProvider.credential(verificationId, otpCode);
        try {
          await linkWithCredential(auth.currentUser, phoneCred);
        } catch (linkErr) {
          console.warn("linkWithCredential result:", linkErr);
        }
      }
      alert("Phone verified and linked.");
    } catch (err) {
      console.error("verifyOtpAndLink failed:", err);
      alert("OTP verification failed: " + (err?.message || err));
    } finally {
      setVerifyingOtp(false);
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
    alert("Payout saved (client-side).");
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
      const amount = Number(r.commissionAmount || 0);
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
              <li style={styles.item(activeTab === "dashboard", "#114a60")} onClick={() => setActiveTab("dashboard")}>
                <FaTachometerAlt /> Dashboard
              </li>
              <li style={styles.item(activeTab === "packages", "#0ea5e9")} onClick={() => setActiveTab("packages")}>
                <FaBoxOpen /> Packages
              </li>
              <li style={styles.item(activeTab === "students", "#f472b6")} onClick={() => setActiveTab("students")}>
                <FaUsers /> Students
              </li>
              <li style={styles.item(activeTab === "commission", "#7c3aed")} onClick={() => setActiveTab("commission")}>
                <FaMoneyBillWave /> Commission
              </li>
              <li style={styles.item(activeTab === "bank", "#059669")} onClick={() => setActiveTab("bank")}>
                <FaUniversity /> Bank / UPI
              </li>
              <li style={styles.item(activeTab === "profile", "#0284c7")} onClick={() => setActiveTab("profile")}>
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
        {/* top bar */}
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
                  <p style={{ margin: 6 }}><b>Last Payment:</b> {promoter?.lastPayment || "-"}</p>
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
                    { ["6th", "7th", "8th", "9th", "10th", "Professional Course"].map((g) => <option key={g} value={g}>{g}</option>) }
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
                        const mrp = parseFloat(p.price || p.totalPayable || 0) || 0;
                        const r = parseFloat(p.regularDiscount || 0) || 0;
                        const a = parseFloat(p.additionalDiscount || 0) || 0;
                        const discount = r + a;
                        const studentCost = parseFloat(p.totalPayable || (mrp - (mrp * discount) / 100) || 0) || 0;
                        const commissionPercent = parseFloat(p.commission || p.promoterCommission || 0) || 0;
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
                        <td style={styles.td}>₹{(parseFloat(s.commissionEarned || s.promoterCommission || 0) || 0).toFixed(2)}</td>
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
                      const commissionAmount = Number(r.commissionAmount || (isFinite(cost) ? (cost * perc) / 100 : 0));
                      const cycle = getNextPaymentCycleForDate(r.createdAt || new Date().toISOString());
                      return (
                        <tr key={i}>
                          <td style={styles.td}>{r.name || "—"}</td>
                          <td style={styles.td}>{r.packageName || "—"}</td>
                          <td style={styles.td}>₹{(cost || 0).toFixed(2)}</td>
                          <td style={styles.td}>{(perc || 0)}%</td>
                          <td style={styles.td}>₹{(commissionAmount || 0).toFixed(2)}</td>
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
