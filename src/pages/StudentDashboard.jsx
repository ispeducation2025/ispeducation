// src/pages/StudentDashboard.jsx
/* eslint-disable */
import React, { useEffect, useMemo, useState } from "react";
import { db, auth } from "../firebase/firebaseConfig";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useNavigate } from "react-router-dom";
import "./StudentDashboard.css";

// Subject images
const subjectImages = {
  Science: "https://cdn-icons-png.flaticon.com/512/2721/2721297.png",
  Mathematics: "https://cdn-icons-png.flaticon.com/512/3135/3135706.png",
  History: "https://cdn-icons-png.flaticon.com/512/3103/3103991.png",
  Geography: "https://cdn-icons-png.flaticon.com/512/3876/3876315.png",
  Economics: "https://cdn-icons-png.flaticon.com/512/3135/3135671.png",
  "Commercial Applications": "https://cdn-icons-png.flaticon.com/512/2972/2972109.png",
  Physics: "https://cdn-icons-png.flaticon.com/512/3132/3132693.png",
  Chemistry: "https://cdn-icons-png.flaticon.com/512/2921/2921822.png",
  Biology: "https://cdn-icons-png.flaticon.com/512/616/616408.png",
  Default: "https://cdn-icons-png.flaticon.com/512/747/747376.png",
};

const packageTypes = ["Interactive Class", "Test"];

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

// Normalizers
function normalizeSubject(s) {
  if (!s) return "";
  const key = s.toLowerCase().replace(/\s+/g, "");
  const map = {
    science: "Science",
    mathematics: "Mathematics",
    history: "History",
    geography: "Geography",
    economics: "Economics",
    commercialapplications: "Commercial Applications",
    physics: "Physics",
    chemistry: "Chemistry",
    biology: "Biology",
  };
  return map[key] || s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
function normalizeText(s) {
  if (!s) return "";
  return s.trim().toLowerCase();
}
const isConceptPackageName = (name) => normalizeText(name) === "concept based package";

/* -------------------------
   Small helpers
   ------------------------- */
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* -------------------------
   Component
   ------------------------- */
const StudentDashboard = () => {
  const navigate = useNavigate();
  const [studentInfo, setStudentInfo] = useState({ name: "", classGrade: "", syllabus: "", mappedPromoter: "" });
  const [packages, setPackages] = useState([]);
  const [selectedType, setSelectedType] = useState("");
  const [selectedPackageName, setSelectedPackageName] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedSubtopic, setSelectedSubtopic] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");
  const [cart, setCart] = useState([]);

  // New: reports state & active tab
  const [activeTab, setActiveTab] = useState("shop"); // "shop" (default) or "reports"
  const [studentReports, setStudentReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);

  // Functions instance for callable
  const functions = getFunctions();

  // Load Razorpay dynamically
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      try {
        document.body.removeChild(script);
      } catch (e) {}
    };
  }, []);

  // Auth check
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) navigate("/");
      else {
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            setStudentInfo({
              name: data.name || "Student",
              classGrade: data.classGrade || data.class || data.grade || "",
              syllabus: data.syllabus || data.board || "",
              // support multiple common fields used for promoter-ref mapping
              mappedPromoter: data.mappedPromoter || data.promoterId || data.referralId || "",
            });
          } else {
            // Fallback if no user doc
            setStudentInfo((s) => ({ ...s, name: user.displayName || "Student" }));
          }
        } catch (err) {
          console.error("Error fetching user doc:", err);
        }
      }
    });
    return () => unsub();
  }, [navigate]);

  // Fetch packages from Firestore
  useEffect(() => {
    if (!studentInfo.classGrade || !studentInfo.syllabus) return;

    const fetchPackages = async () => {
      try {
        const q = query(
          collection(db, "packages"),
          where("classGrade", "==", studentInfo.classGrade),
          where("syllabus", "==", studentInfo.syllabus)
        );
        const snapshot = await getDocs(q);
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPackages(list);
      } catch (err) {
        console.error("Error fetching packages:", err);
      }
    };

    fetchPackages();
  }, [studentInfo.classGrade, studentInfo.syllabus]);

  // Filters
  const filteredByType = useMemo(
    () => (selectedType ? packages.filter((p) => p.packageType === selectedType) : []),
    [packages, selectedType]
  );
  const packageNameOptions = useMemo(() => unique(filteredByType.map((p) => p.packageName)), [filteredByType]);
  const filteredByPackageName = useMemo(
    () => (selectedPackageName ? filteredByType.filter((p) => p.packageName === selectedPackageName) : filteredByType),
    [filteredByType, selectedPackageName]
  );

  const subjectOptions = useMemo(
    () => (isConceptPackageName(selectedPackageName) ? unique(filteredByPackageName.map((p) => normalizeSubject(p.subject))) : []),
    [filteredByPackageName, selectedPackageName]
  );
  const subtopicOptions = useMemo(
    () =>
      isConceptPackageName(selectedPackageName)
        ? unique(filteredByPackageName.filter((p) => normalizeSubject(p.subject) === selectedSubject).map((p) => p.subtopic))
        : [],
    [filteredByPackageName, selectedSubject, selectedPackageName]
  );
  const chapterOptions = useMemo(
    () =>
      isConceptPackageName(selectedPackageName)
        ? unique(
            filteredByPackageName
              .filter(
                (p) =>
                  normalizeSubject(p.subject) === selectedSubject &&
                  (!selectedSubtopic || normalizeText(p.subtopic) === normalizeText(selectedSubtopic))
              )
              .map((p) => p.chapter)
          )
        : [],
    [filteredByPackageName, selectedSubject, selectedSubtopic, selectedPackageName]
  );

  // Cards list
  const conceptCards = useMemo(() => {
    if (!selectedPackageName) return [];
    if (isConceptPackageName(selectedPackageName)) {
      if (!selectedChapter) return [];
      return filteredByPackageName.filter(
        (p) =>
          normalizeSubject(p.subject) === selectedSubject &&
          (!selectedSubtopic || normalizeText(p.subtopic) === normalizeText(selectedSubtopic)) &&
          normalizeText(p.chapter) === normalizeText(selectedChapter)
      );
    }
    return filteredByPackageName;
  }, [filteredByPackageName, selectedPackageName, selectedSubject, selectedSubtopic, selectedChapter]);

  // Cart operations
  const addToCart = (pkg) => {
    if (!cart.find((p) => p.id === pkg.id)) setCart((c) => [...c, pkg]);
  };
  const removeFromCart = (id) => setCart((c) => c.filter((p) => p.id !== id));
  const cartTotal = useMemo(() => cart.reduce((sum, p) => sum + safeNum(p.totalPayable || p.price || 0), 0), [cart]);

  // Helper - compute displayed price safely
  const computeFinalPrice = (pkg) => {
    const basePrice = safeNum(pkg.price || pkg.totalPayable || 0);
    const d1 = safeNum(pkg.regularDiscount || 0);
    const d2 = safeNum(pkg.additionalDiscount || 0);
    const computedFinal = basePrice - (basePrice * d1) / 100 - (basePrice * d2) / 100;
    const finalPrice = Number.isFinite(parseFloat(pkg.totalPayable)) ? parseFloat(pkg.totalPayable) : computedFinal;
    return { basePrice, finalPrice, d1, d2 };
  };

  // Fetch student's own payments from `payments` collection (updated)
  const fetchStudentReports = async () => {
    setLoadingReports(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setStudentReports([]);
        setLoadingReports(false);
        return;
      }
      const q = query(collection(db, "payments"), where("studentId", "==", uid));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Sort by createdAt or paidAt descending if available
      list.sort((a, b) => {
        const ta = a.paidAt ? new Date(a.paidAt).getTime() : a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.paidAt ? new Date(b.paidAt).getTime() : b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
      setStudentReports(list);
    } catch (err) {
      console.error("Error fetching student reports:", err);
    } finally {
      setLoadingReports(false);
    }
  };

  // When user navigates to reports tab, fetch their payments
  useEffect(() => {
    if (activeTab === "reports") {
      fetchStudentReports();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // --- New helper: resolve promoter info robustly (uid or uniqueId) ---
  const resolvePromoterInfo = async (mappedPromoter) => {
    if (!mappedPromoter) return { promoterUid: null, promoterUniqueId: null, promoterName: null };
    try {
      // First try assuming mappedPromoter is a user doc id (uid)
      const promoterDoc = await getDoc(doc(db, "users", mappedPromoter));
      if (promoterDoc.exists()) {
        const d = promoterDoc.data();
        return { promoterUid: promoterDoc.id, promoterUniqueId: d.uniqueId || null, promoterName: d.name || d.email || null };
      }
      // Otherwise try querying where uniqueId == mappedPromoter
      const q = query(collection(db, "users"), where("uniqueId", "==", mappedPromoter));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const doc0 = snap.docs[0];
        const d = doc0.data();
        return { promoterUid: doc0.id, promoterUniqueId: d.uniqueId || null, promoterName: d.name || d.email || null };
      }
    } catch (err) {
      console.error("resolvePromoterInfo error", err);
    }
    return { promoterUid: null, promoterUniqueId: null, promoterName: null };
  };

  // Helper: ask server to generate & send receipt (callable preferred, fallback to HTTP)
  const sendReceiptToServer = async ({ paymentDocId, paymentPayload }) => {
    try {
      // Try callable first
      try {
        const sendReceiptFn = httpsCallable(functions, "sendPaymentReceipt");
        const res = await sendReceiptFn({ paymentId: paymentDocId, payment: paymentPayload });
        if (res && res.data && res.data.success) {
          return { ok: true, via: "callable" };
        }
      } catch (err) {
        // ignore, try HTTP fallback
      }

      const base = process.env.REACT_APP_FUNCTIONS_URL || "";
      if (!base) {
        return { ok: false, error: "FUNCTIONS_URL_NOT_CONFIGURED" };
      }
      const resp = await fetch(base + "/send-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: paymentDocId, payment: paymentPayload }),
      });
      const json = await resp.json();
      return { ok: resp.ok, data: json };
    } catch (err) {
      console.error("sendReceiptToServer error:", err);
      return { ok: false, error: err?.message || String(err) };
    }
  };

  // Razorpay Checkout (creates richer payment docs via callable)
  const handleCheckout = async () => {
    if (cart.length === 0) {
      alert("Cart is empty!");
      return;
    }
    const amountInPaise = Math.round(cartTotal * 100);

    const options = {
      key: "rzp_live_RXgt3NNJiZJDob", // <-- Replace with your live Razorpay key if needed
      amount: amountInPaise,
      currency: "INR",
      name: "ISP Education",
      description: "Course Payment",
      image: "https://ispeducation.in/logo192.png",
      handler: async function (response) {
        try {
          // Payment success from Razorpay
          alert("Payment successful! Payment ID: " + response.razorpay_payment_id);

          // resolve promoter info up-front (if any)
          const mappedPromoter = studentInfo.mappedPromoter || null;
          const promoterResolved = await resolvePromoterInfo(mappedPromoter);

          // Build packagesPayload (shape expected by Cloud Function)
          // Use packageCost (rupees) and commission percent from pkg.commission (as you requested)
          const packagesPayload = cart.map((pkg) => {
            const pkgPrice = safeNum(pkg.totalPayable || pkg.price || pkg.packageCost || 0);
            const commissionPercent = safeNum(pkg.commission ?? pkg.promoterCommission ?? pkg.commissionPercent ?? pkg.commissionPercent ?? 0);
            return {
              id: pkg.id,
              packageName: pkg.packageName || pkg.concept || "",
              subject: pkg.subject || "",
              subtopic: pkg.subtopic || "",
              chapter: pkg.chapter || "",
              price: Number(pkgPrice), // the server expects price (in rupees)
              commission: Number(commissionPercent), // percent number
              studentName: studentInfo.name || "",
              phone: studentInfo.phone || auth.currentUser?.phoneNumber || "",
            };
          });

          const commissionTotal = packagesPayload.reduce((s, p) => s + safeNum((p.price * p.commission) / 100), 0);

          // Build final payload (shape accepted by createPaymentRecord Cloud Function)
          const callablePayload = {
            paymentId: response.razorpay_payment_id,
            packages: packagesPayload,
            totalAmount: Number(cartTotal),
            mappedPromoter: studentInfo.mappedPromoter || null, // pass uniqueId or uid if set on user doc
          };

          // Try callables (prefer server-side logic)
          let saved = false;
          let savedPaymentDocId = null;
          let lastErr = null;

          try {
            const createPaymentRecord = httpsCallable(functions, "createPaymentRecord");
            const res = await createPaymentRecord(callablePayload);
            console.log("createPaymentRecord result:", res?.data);
            if (res && res.data && res.data.success && Array.isArray(res.data.details)) {
              saved = true;
              // take first paymentDocId (if multiple packages were written, there will be one per package)
              savedPaymentDocId = res.data.details[0]?.paymentDocId || null;
            }
          } catch (err) {
            console.warn("createPaymentRecord callable failed:", err);
            lastErr = err;
          }

          if (!saved) {
            try {
              const adminCreatePayment = httpsCallable(functions, "adminCreatePayment");
              const res2 = await adminCreatePayment({ payment: callablePayload });
              console.log("adminCreatePayment result:", res2?.data);
              if (res2 && res2.data && res2.data.success && Array.isArray(res2.data.details)) {
                saved = true;
                savedPaymentDocId = res2.data.details[0]?.paymentDocId || null;
              }
            } catch (err2) {
              console.warn("adminCreatePayment callable failed:", err2);
              lastErr = err2;
            }
          }

          // Fallback: client-side write to /payments (only if callables failed)
          if (!saved) {
            try {
              // We will store one document that contains the full payload (packages array inside)
              const pRef = await addDoc(collection(db, "payments"), {
                studentId: auth.currentUser?.uid,
                studentName: studentInfo.name || "",
                email: auth.currentUser?.email || "",
                phone: studentInfo.phone || "",
                packages: packagesPayload,
                amount: Number(cartTotal),
                paymentId: response.razorpay_payment_id,
                paymentMethod: "razorpay",
                status: "paid",
                settlementStatus: "pending",
                promoterUid: promoterResolved?.promoterUid || null,
                promoterUniqueId: promoterResolved?.promoterUniqueId || null,
                promoterName: promoterResolved?.promoterName || null,
                commissionTotal,
                commissionPaid: false,
                promoterPaid: false,
                createdAt: serverTimestamp(),
                paidAt: serverTimestamp(),
                source: "razorpay_checkout_client_fallback",
                gatewayRaw: { raw: response },
              });
              console.log("Fallback: saved payments doc client-side:", pRef.id);
              saved = true;
              savedPaymentDocId = pRef.id;
            } catch (addErr) {
              console.error("Fallback addDoc to /payments failed:", addErr);
              lastErr = addErr;
            }
          }

          if (!saved) {
            console.error("Failed to save payment record via callable AND fallback. Last error:", lastErr);
            alert(
              "Payment succeeded but saving the record failed. Ensure your callable function (createPaymentRecord or adminCreatePayment) is deployed and that Firestore rules allow the write. Check console for details."
            );
            // clear cart locally (so user doesn't try paying twice)
            setCart([]);
            setActiveTab("reports");
            if (activeTab === "reports") fetchStudentReports();
            return;
          }

          // If saved, attempt to trigger receipt generation (server should email + whatsapp)
          try {
            const receiptRes = await sendReceiptToServer({ paymentDocId: savedPaymentDocId, paymentPayload: { ...callablePayload, savedPaymentDocId } });
            console.log("sendReceiptToServer result:", receiptRes);
          } catch (e) {
            console.warn("Receipt sending attempt failed:", e);
          }

          // On success: clear cart and refresh reports (short delay for DB consistency)
          setCart([]);
          setActiveTab("reports");
          setTimeout(() => fetchStudentReports(), 800);
        } catch (err) {
          console.error("Error in payment handler:", err);
          alert("Payment succeeded but something went wrong while saving. Check console.");
        }
      },
      prefill: {
        name: studentInfo.name,
        email: auth.currentUser?.email || "",
        contact: "",
      },
      notes: {
        cart: JSON.stringify(cart.map((c) => ({ id: c.id, name: c.packageName || c.concept })) || []),
      },
      theme: { color: "#1e90ff" },
    };

    if (window.Razorpay) {
      const rzp = new window.Razorpay(options);
      rzp.open();
    } else {
      alert("Razorpay SDK not loaded. Please refresh the page.");
    }
  };

  const handleLogout = async () => {
    await auth.signOut();
    navigate("/");
  };

  return (
    <div
      className="student-dashboard"
      style={{
        display: "flex",
        gap: "20px",
        minHeight: "100vh",
        background: "linear-gradient(135deg, #1d2671, #c33764)",
        paddingBottom: "120px", // Ensure content not hidden by fixed bottom buttons on mobile
      }}
    >
      {/* Main Content */}
      <div style={{ flex: 3, padding: "20px" }}>
        <div className="dashboard-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#fff" }}>
          <h1>Welcome, {studentInfo.name}!</h1>

          {/* Tab controls (Shop / Reports) */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              onClick={() => setActiveTab("shop")}
              style={{
                background: activeTab === "shop" ? "#0ea5e9" : "transparent",
                color: "#fff",
                border: "none",
                padding: "8px 12px",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Shop
            </button>
            <button
              onClick={() => setActiveTab("reports")}
              style={{
                background: activeTab === "reports" ? "#10b981" : "transparent",
                color: "#fff",
                border: "none",
                padding: "8px 12px",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              My Reports
            </button>

            <button
              className="logout-btn"
              onClick={handleLogout}
              style={{ background: "#ff4757", color: "#fff", border: "none", padding: "8px 12px", borderRadius: "6px", cursor: "pointer", marginLeft: 8 }}
            >
              Logout
            </button>
          </div>
        </div>

        {/* Student profile (class & syllabus) */}
        <div
          style={{
            marginTop: "12px",
            display: "flex",
            gap: "12px",
            alignItems: "center",
            color: "#fff",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              background: "#ffffff12",
              padding: "10px 14px",
              borderRadius: "8px",
              minWidth: "160px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <small style={{ color: "#cbd5e1", fontSize: "12px" }}>Name</small>
            <strong style={{ fontSize: "15px" }}>{studentInfo.name || "Student"}</strong>
          </div>

          <div
            style={{
              background: "#ffffff12",
              padding: "10px 14px",
              borderRadius: "8px",
              minWidth: "120px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <small style={{ color: "#cbd5e1", fontSize: "12px" }}>Class</small>
            <strong style={{ fontSize: "15px" }}>{studentInfo.classGrade || "—"}</strong>
          </div>

          <div
            style={{
              background: "#ffffff12",
              padding: "10px 14px",
              borderRadius: "8px",
              minWidth: "140px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <small style={{ color: "#cbd5e1", fontSize: "12px" }}>Syllabus</small>
            <strong style={{ fontSize: "15px" }}>{studentInfo.syllabus || "—"}</strong>
          </div>
        </div>

        {/* If Reports tab active -> show reports UI */}
        {activeTab === "reports" && (
          <div style={{ marginTop: 20, background: "#ffffff14", padding: 16, borderRadius: 10 }}>
            <h2 style={{ color: "#fff", marginBottom: 12 }}>📑 My Payment Reports</h2>

            {loadingReports ? (
              <p style={{ color: "#fff" }}>Loading reports...</p>
            ) : studentReports.length === 0 ? (
              <p style={{ color: "#fff" }}>No payment records found.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", color: "#fff", minWidth: 680 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <th style={{ padding: "8px 6px" }}>Package</th>
                      <th style={{ padding: "8px 6px" }}>Subject</th>
                      <th style={{ padding: "8px 6px" }}>Amount (₹)</th>
                      <th style={{ padding: "8px 6px" }}>Date</th>
                      <th style={{ padding: "8px 6px" }}>Status</th>
                      <th style={{ padding: "8px 6px" }}>Promoter Approved</th>
                      <th style={{ padding: "8px 6px" }}>Payment ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentReports.map((r) => (
                      <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "10px 6px", color: "#e6eef8" }}>{r.packages && r.packages.length ? r.packages.map(p => p.packageName).join(", ") : r.packageName || "—"}</td>
                        <td style={{ padding: "10px 6px", color: "#e6eef8" }}>{r.subject || (r.packages && r.packages[0]?.subject) || "—"}</td>
                        <td style={{ padding: "10px 6px", color: "#e6eef8", fontWeight: 700 }}>{Number(r.amount || r.totalPackageCost || 0).toFixed(2)}</td>
                        <td style={{ padding: "10px 6px", color: "#e6eef8" }}>{r.paidAt ? (r.paidAt.seconds ? new Date(r.paidAt.seconds * 1000).toLocaleString("en-IN") : new Date(r.paidAt).toLocaleString("en-IN")) : r.createdAtClient ? new Date(r.createdAtClient).toLocaleString("en-IN") : "—"}</td>
                        <td style={{ padding: "10px 6px", color: r.settlementStatus === "settled" ? "#bbf7d0" : "#fda4af", fontWeight: 700 }}>{r.settlementStatus || r.paymentStatus || "—"}</td>
                        <td style={{ padding: "10px 6px", color: "#e6eef8" }}>{r.promoterApproved ? "✅" : (r.promoterUid || r.promoterUniqueId ? "❌" : "—")}</td>
                        <td style={{ padding: "10px 6px", color: "#e6eef8", fontSize: 12 }}>{r.paymentId || r.paymentID || r.id || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Filters (shown only when shop view is active) */}
        {activeTab === "shop" && (
          <>
            {/* Filters */}
            <div
              style={{
                marginTop: "20px",
                background: "#ffffff22",
                padding: "15px",
                borderRadius: "10px",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "15px",
              }}
            >
              {/* Package Type */}
              <div>
                <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>
                  Package Type
                </label>
                <select
                  className="sel"
                  value={selectedType}
                  onChange={(e) => {
                    setSelectedType(e.target.value);
                    setSelectedPackageName("");
                    setSelectedSubject("");
                    setSelectedSubtopic("");
                    setSelectedChapter("");
                  }}
                  style={{ width: "100%", padding: "8px", borderRadius: "6px" }}
                >
                  <option value="">— Select Type —</option>
                  {packageTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* Package Name */}
              {selectedType && packageNameOptions.length > 0 && (
                <div>
                  <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>
                    Package Name
                  </label>
                  <select
                    className="sel"
                    value={selectedPackageName}
                    onChange={(e) => {
                      setSelectedPackageName(e.target.value);
                      setSelectedSubject("");
                      setSelectedSubtopic("");
                      setSelectedChapter("");
                    }}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px" }}
                  >
                    <option value="">— Select Package —</option>
                    {packageNameOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Concept-based filters */}
              {isConceptPackageName(selectedPackageName) && subjectOptions.length > 0 && (
                <div>
                  <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>
                    Subject
                  </label>
                  <select
                    className="sel"
                    value={selectedSubject}
                    onChange={(e) => {
                      setSelectedSubject(e.target.value);
                      setSelectedSubtopic("");
                      setSelectedChapter("");
                    }}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px" }}
                  >
                    <option value="">— Select Subject —</option>
                    {subjectOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {isConceptPackageName(selectedPackageName) && selectedSubject && subtopicOptions.length > 0 && (
                <div>
                  <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>
                    Subtopic
                  </label>
                  <select
                    className="sel"
                    value={selectedSubtopic}
                    onChange={(e) => {
                      setSelectedSubtopic(e.target.value);
                      setSelectedChapter("");
                    }}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px" }}
                  >
                    <option value="">— Select Subtopic —</option>
                    {subtopicOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {isConceptPackageName(selectedPackageName) && selectedSubtopic && chapterOptions.length > 0 && (
                <div>
                  <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>
                    Chapter
                  </label>
                  <select
                    className="sel"
                    value={selectedChapter}
                    onChange={(e) => setSelectedChapter(e.target.value)}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px" }}
                  >
                    <option value="">— Select Chapter —</option>
                    {chapterOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Cards */}
            {selectedPackageName && (
              <>
                <h2 style={{ marginTop: 20, color: "white" }}>{selectedType === "Interactive Class" ? "Available Classes" : "Available Tests"}</h2>
                {conceptCards.length === 0 ? (
                  <p style={{ color: "#fff" }}>
                    {isConceptPackageName(selectedPackageName) ? "Select Subject → Subtopic → Chapter to view items." : "No items found."}
                  </p>
                ) : (
                  <div
                    className="packages-grid"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                      gap: "16px",
                      marginTop: "20px",
                    }}
                  >
                    {conceptCards.map((pkg) => {
                      const subj = normalizeSubject(pkg.subject) || "Default";
                      const { basePrice, finalPrice, d1, d2 } = computeFinalPrice(pkg);

                      // compute duration & rates
                      const durationNum = parseFloat(pkg.duration) || 0;
                      const rateBefore = durationNum > 0 ? basePrice / durationNum : null;
                      const rateAfter = durationNum > 0 ? finalPrice / durationNum : null;

                      // freebies may be a string or array in your DB; normalize to string
                      const freebiesText = Array.isArray(pkg.freebies) ? pkg.freebies.join(", ") : (pkg.freebies || "").toString();

                      const totalDiscount = Math.round((d1 || 0) + (d2 || 0));

                      return (
                        <div
                          key={pkg.id}
                          className={`zoom-card card-${subj.toLowerCase().replace(/\s+/g, "") || "default"}`}
                          style={{
                            borderRadius: "12px",
                            padding: "15px",
                            color: "#333",
                            fontSize: "14px",
                            boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
                            background: "#fff",
                            transition: "transform 0.2s, box-shadow 0.2s",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            position: "relative",
                            overflow: "hidden",
                          }}
                        >
                          {/* PRICE STICKER — bottom-left (fixed) */}
                          <div
                            className="price-sticker"
                            style={{
                              position: "absolute",
                              bottom: 16,
                              left: 16,
                              transform: "none",
                              background: "#05060A",
                              color: "#b7ffd6",
                              padding: "8px 10px",
                              borderRadius: "10px",
                              fontSize: "12px",
                              fontWeight: 700,
                              zIndex: 6,
                              boxShadow: "0 8px 24px rgba(0,255,150,0.06), 0 4px 10px rgba(0,0,0,0.2)",
                              border: "1px solid rgba(0,255,150,0.12)",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              lineHeight: 1.05,
                              minWidth: 120,
                            }}
                            aria-hidden
                          >
                            <span style={{ fontSize: "11px", color: "#9ca3af", textDecoration: rateBefore ? "line-through" : "none", marginBottom: 4 }}>
                              {rateBefore !== null ? `Was ₹${Number(rateBefore).toFixed(2)}/hr` : "Was —"}
                            </span>
                            <span style={{ fontSize: "13px", color: "#7CFF8E", fontWeight: 900 }}>
                              {rateAfter !== null ? `Now ₹${Number(rateAfter).toFixed(2)}/hr` : "Now —"}
                            </span>
                          </div>

                          {/* Discount badge */}
                          {totalDiscount > 0 && (
                            <div
                              style={{
                                position: "absolute",
                                top: "10px",
                                right: "10px",
                                background: totalDiscount >= 40 ? "#e11d48" : totalDiscount >= 20 ? "#f97316" : "#16a34a",
                                color: "#fff",
                                padding: "4px 8px",
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: "700",
                                boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                                zIndex: 7,
                              }}
                            >
                              {totalDiscount}% OFF
                            </div>
                          )}

                          <div
                            className="zoom-card-inner"
                            style={{
                              textAlign: "center",
                              zIndex: 2,
                              paddingBottom: 72 /* make room for sticker + add button so they don't overlap content */,
                            }}
                          >
                            <img
                              src={subjectImages[subj] || subjectImages.Default}
                              alt={subj}
                              style={{
                                width: "80px",
                                height: "80px",
                                objectFit: "contain",
                                marginBottom: "8px",
                                borderRadius: "10px",
                                backgroundColor: "rgba(255,255,255,0.05)",
                              }}
                            />
                            <h3 style={{ fontSize: "16px", fontWeight: "600", color: "#222", marginBottom: "4px" }}>
                              {pkg.concept || pkg.packageName}
                            </h3>
                            <span style={{ display: "block", fontSize: "13px", marginBottom: "10px", color: "#555" }}>
                              {subj} {pkg.subtopic ? "→ " + pkg.subtopic + " → " : ""}{pkg.chapter}
                            </span>

                            {/* Course Details */}
                            <div
                              style={{
                                textAlign: "left",
                                fontSize: "13px",
                                color: "#444",
                                marginBottom: "10px",
                                lineHeight: "1.4em",
                              }}
                            >
                              {/* Use available fields: courseDetails, description, duration, perHour; fallbacks if not present */}
                              {pkg.courseDetails && (
                                <p style={{ margin: "4px 0" }}>
                                  <b>Course:</b> {pkg.courseDetails}
                                </p>
                              )}
                              {!pkg.courseDetails && pkg.description && (
                                <p style={{ margin: "4px 0" }}>
                                  <b>About:</b> {pkg.description.length > 80 ? pkg.description.slice(0, 80) + "..." : pkg.description}
                                </p>
                              )}
                              {pkg.duration && (
                                <p style={{ margin: "4px 0" }}>
                                  <b>Duration:</b> {pkg.duration} hrs
                                </p>
                              )}
                              {pkg.perHour && (
                                <p style={{ margin: "4px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span><b>Rate (stored):</b></span>
                                  <span style={{ background: "#f3f4f6", padding: "4px 8px", borderRadius: 6 }}>₹{pkg.perHour}/hr</span>
                                </p>
                              )}

                              {/* Freebies */}
                              {freebiesText && freebiesText.trim() !== "" && (
                                <p style={{ margin: "6px 0 0 0", color: "#0f172a", background: "#f1f5f9", padding: "6px", borderRadius: "6px" }}>
                                  <strong style={{ marginRight: 6 }}>🎁 Freebies:</strong>
                                  <span style={{ fontWeight: 500 }}>{freebiesText.length > 80 ? freebiesText.slice(0, 80) + "..." : freebiesText}</span>
                                </p>
                              )}
                            </div>

                            {/* Price Section (inside card body, not the sticker) */}
                            <div style={{ textAlign: "left", marginTop: "8px" }}>
                              <p style={{ margin: "2px 0" }}>
                                <b>Price:</b>{" "}
                                <span style={{ textDecoration: d1 || d2 ? "line-through" : "none" }}>
                                  ₹{basePrice.toFixed(2)}
                                </span>
                              </p>
                              {(d1 || d2) && (
                                <p style={{ margin: "2px 0", color: "#16a34a", fontWeight: "700" }}>
                                  <b>Now:</b> ₹{finalPrice.toFixed(2)}
                                </p>
                              )}

                              {/* Discount breakdown */}
                              {(d1 > 0 || d2 > 0) && (
                                <div style={{ marginTop: "6px", fontSize: "13px", color: "#e11d48" }}>
                                  <div>
                                    <b>Discounts:</b>{" "}
                                    {d1 > 0 && <span>{d1}% regular</span>}
                                    {d1 > 0 && d2 > 0 && <span> + </span>}
                                    {d2 > 0 && <span>{d2}% additional</span>}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* ADD TO CART — bottom-right (fixed) */}
                          <div style={{ position: "absolute", bottom: 16, right: 16, zIndex: 20 }}>
                            <button
                              onClick={() => addToCart(pkg)}
                              style={{
                                padding: "8px 14px",
                                background: "#1e90ff",
                                color: "#fff",
                                border: "none",
                                borderRadius: "6px",
                                cursor: "pointer",
                                fontWeight: "600",
                                boxShadow: "0 6px 14px rgba(30,144,255,0.18)",
                                zIndex: 20,
                              }}
                            >
                              Add to Cart
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Cart Sidebar */}
      <div
        style={{
          flex: 1,
          background: "#ffffff11",
          padding: "20px",
          borderRadius: "12px",
          height: "fit-content",
          position: "sticky",
          top: "20px",
          alignSelf: "start",
          minWidth: "260px",
        }}
      >
        <h2 style={{ color: "#fff", marginBottom: "15px" }}>Cart</h2>
        {cart.length === 0 ? (
          <p style={{ color: "#fff" }}>Cart is empty</p>
        ) : (
          <>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {cart.map((pkg) => (
                <li
                  key={pkg.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "10px",
                    color: "#fff",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600 }}>{pkg.packageName || pkg.concept}</div>
                    <div style={{ fontSize: "12px", color: "#ddd" }}>{pkg.subject ? normalizeSubject(pkg.subject) : ""}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div>₹{parseFloat(pkg.totalPayable || pkg.price || 0).toFixed(2)}</div>
                    <button
                      onClick={() => removeFromCart(pkg.id)}
                      style={{
                        marginLeft: "10px",
                        background: "transparent",
                        border: "none",
                        color: "#ff4757",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p style={{ color: "#fff", fontWeight: "600" }}>Total: ₹{cartTotal.toFixed(2)}</p>
            <button
              onClick={handleCheckout}
              style={{
                marginTop: "10px",
                padding: "10px",
                width: "100%",
                background: "#2ed573",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: "600",
              }}
            >
              Checkout
            </button>
          </>
        )}
      </div>

      {/* Fixed bottom policy/footer buttons (example) */}
      <div
        className="bottom-fixed-actions"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          width: "100%",
          zIndex: 1200,
          display: "flex",
          gap: "8px",
          justifyContent: "center",
          padding: "10px",
          pointerEvents: "auto",
        }}
      >
        <button
          style={{
            padding: "10px 16px",
            borderRadius: "8px",
            border: "none",
            background: "#111827",
            color: "#fff",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          }}
          onClick={() => {
            window.open("/policies", "_blank");
          }}
        >
          Policies
        </button>
        <button
          style={{
            padding: "10px 16px",
            borderRadius: "8px",
            border: "none",
            background: "#111827",
            color: "#fff",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          }}
          onClick={() => {
            window.open("/contact", "_blank");
          }}
        >
          Contact
        </button>
      </div>

      {/* Mobile Styles in JS to ensure immediate effect without touching CSS file */}
      <style>
        {`
          /* responsive rules (unchanged) */
          @media (max-width: 900px) {
            .student-dashboard {
              flex-direction: column;
              padding-bottom: 260px;
            }
            .student-dashboard > div:nth-child(2) { width: 100%; position: relative; top: auto; margin-top: 18px; }
            .student-dashboard > div:nth-child(3) { width: 100%; position: relative !important; top: auto !important; margin-top: 18px; align-self: stretch; }
            .packages-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
            .zoom-card > .zoom-card-inner { padding-top: 18px; }
            .zoom-card img { width: 70px !important; height: 70px !important; }
            .zoom-card { padding-bottom: 100px; }
            .price-sticker { position: absolute !important; top: 10px !important; left: 10px !important; bottom: auto !important; transform: none !important; padding: 6px 8px !important; font-size: 11px !important; min-width: 96px !important; z-index: 6 !important; opacity: 0.98; }
            .zoom-card button { z-index: 999 !important; }
          }
          @media (max-width: 420px) {
            .packages-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
            .zoom-card img { width: 60px !important; height: 60px !important; }
            .price-sticker { left: 8px !important; top: 8px !important; padding: 5px 6px !important; font-size: 10px !important; min-width: 84px !important; }
            .zoom-card { padding-bottom: 120px; }
            .zoom-card div[aria-hidden] { transform: scale(0.92); }
          }
        `}
      </style>
    </div>
  );
};

export default StudentDashboard;
