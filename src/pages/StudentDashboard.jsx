/* src/pages/StudentDashboard.jsx */
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

const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function getFunctionsInstance() {
  try {
    return getFunctions();
  } catch (e) {
    console.warn("getFunctions() failed, trying asia-south1 fallback...", e?.message || e);
  }
  try {
    return getFunctions(undefined, "asia-south1");
  } catch (e) {
    console.warn("getFunctions(region) also failed:", e?.message || e);
    return getFunctions();
  }
}

const StudentDashboard = () => {
  const navigate = useNavigate();
  const [studentInfo, setStudentInfo] = useState({ name: "", classGrade: "", syllabus: "", mappedPromoter: "", phone: "" });
  const [packages, setPackages] = useState([]);
  const [selectedType, setSelectedType] = useState("");
  const [selectedPackageName, setSelectedPackageName] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedSubtopic, setSelectedSubtopic] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");
  const [cart, setCart] = useState([]);

  const [activeTab, setActiveTab] = useState("shop");
  const [studentReports, setStudentReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);

  // Mobile cart visibility
  const [showMobileCart, setShowMobileCart] = useState(false);

  const functions = useMemo(() => getFunctionsInstance(), []);

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

  // Ensure gradient stays visible on mobile (prevents white gap while scrolling)
  useEffect(() => {
    const prev = document.body.style.backgroundAttachment;
    const prevBg = document.body.style.background;
    document.body.style.backgroundAttachment = "fixed";
    document.body.style.background = "linear-gradient(135deg, #1d2671, #c33764)";
    return () => {
      document.body.style.backgroundAttachment = prev || "";
      document.body.style.background = prevBg || "";
    };
  }, []);

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
              mappedPromoter: data.mappedPromoter || data.promoterId || data.referralId || "",
              phone: data.phone || user.phoneNumber || "",
            });
          } else {
            setStudentInfo((s) => ({ ...s, name: user.displayName || "Student", phone: user.phoneNumber || "" }));
          }
        } catch (err) {
          console.error("Error fetching user doc:", err);
        }
      }
    });
    return () => unsub();
  }, [navigate]);

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

  const addToCart = (pkg) => {
    if (!cart.find((p) => p.id === pkg.id)) setCart((c) => [...c, pkg]);
    if (window.innerWidth <= 900) setShowMobileCart(true);
  };
  const removeFromCart = (id) => setCart((c) => c.filter((p) => p.id !== id));
  const cartTotal = useMemo(() => {
    const total = cart.reduce((sum, p) => {
      const v = Number(p.totalPayable ?? p.paidAmount ?? p.price ?? p.packageCost ?? 0);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
    return Number(Math.round((total + Number.EPSILON) * 100) / 100);
  }, [cart]);

  const computeFinalPrice = (pkg) => {
    const basePrice = safeNum(pkg.price || pkg.totalPayable || pkg.packageCost || 0);
    const d1 = safeNum(pkg.regularDiscount || pkg.regular_discount || pkg.regular || 0);
    const d2 = safeNum(pkg.additionalDiscount || pkg.additional_discount || pkg.additional || 0);
    const computedFinal = basePrice - (basePrice * d1) / 100 - (basePrice * d2) / 100;
    const finalPrice = Number.isFinite(parseFloat(pkg.totalPayable)) ? parseFloat(pkg.totalPayable) : computedFinal;
    return { basePrice, finalPrice, d1, d2 };
  };

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

      const tsToMs = (ts) => {
        if (!ts) return null;
        if (typeof ts.toMillis === "function") return ts.toMillis();
        if (typeof ts.seconds === "number") return ts.seconds * 1000;
        if (typeof ts === "number") return ts;
        const d = new Date(ts);
        if (!isNaN(d.getTime())) return d.getTime();
        return null;
      };

      const amountToRupees = (val) => {
        if (val == null) return null;
        const n = Number(val);
        if (!Number.isFinite(n)) return null;
        if (Math.abs(n) >= 1000) return n / 100;
        if (Math.abs(n) >= 100 && n % 100 === 0) return n / 100;
        return n;
      };

      const normalizeDoc = (d) => {
        const raw = d.data ? d.data() : d;
        const normalized = { id: d.id || raw.id, ...raw };

        const createdMs = tsToMs(raw.createdAt);
        const paidMs = tsToMs(raw.paidAt);

        if (createdMs) {
          normalized.createdAtClient = createdMs;
          normalized.createdAtISO = new Date(createdMs).toISOString();
        } else if (raw.createdAtClient) {
          normalized.createdAtClient = Number(raw.createdAtClient) || null;
        }

        if (paidMs) {
          normalized.paidAtClient = paidMs;
          normalized.paidAtISO = new Date(paidMs).toISOString();
        } else if (raw.paidAtClient) {
          normalized.paidAtClient = Number(raw.paidAtClient) || null;
        }

        if (Array.isArray(raw.packages)) {
          normalized.packages = raw.packages.map((pkg) => {
            const safePkg = { ...pkg };
            if (pkg.createdAt) {
              const m = tsToMs(pkg.createdAt);
              if (m) {
                safePkg.createdAtClient = m;
                safePkg.createdAtISO = new Date(m).toISOString();
              }
            }
            safePkg.packageName = typeof pkg.packageName === "string" ? pkg.packageName : (pkg.packageName ? String(pkg.packageName) : "");
            safePkg.subject = typeof pkg.subject === "string" ? pkg.subject : (pkg.subject ? String(pkg.subject) : "");
            safePkg.subtopic = typeof pkg.subtopic === "string" ? pkg.subtopic : (pkg.subtopic ? String(pkg.subtopic) : "");
            safePkg.chapter = typeof pkg.chapter === "string" ? pkg.chapter : (pkg.chapter ? String(pkg.chapter) : "");
            if (pkg.packageCost != null) safePkg.packageCost = Number(pkg.packageCost);
            if (pkg.price != null) safePkg.price = Number(pkg.price);
            if (pkg.totalPayable != null) safePkg.totalPayable = Number(pkg.totalPayable);
            if (pkg.discountAmount != null) safePkg.discountAmount = Number(pkg.discountAmount);
            safePkg.paidPrice =
              (pkg.paidPrice != null ? Number(pkg.paidPrice) : null) ??
              (pkg.paidAmount != null ? Number(pkg.paidAmount) : null) ??
              (pkg.totalPayable != null ? Number(pkg.totalPayable) : null) ??
              (pkg.price != null ? Number(pkg.price) : null) ??
              (pkg.amount != null ? Number(pkg.amount) : null) ??
              0;
            return safePkg;
          });
        } else {
          if (raw.packageName && !Array.isArray(raw.packageName)) {
            normalized.packageName = typeof raw.packageName === "string" ? raw.packageName : String(raw.packageName);
          }
        }

        if (normalized.settlementStatus && typeof normalized.settlementStatus !== "string") {
          normalized.settlementStatus = String(normalized.settlementStatus);
        }
        if (normalized.paymentStatus && typeof normalized.paymentStatus !== "string") {
          normalized.paymentStatus = String(normalized.paymentStatus);
        }

        let amountR = null;

        if (raw.rawRazorpay && raw.rawRazorpay.amount != null) {
          const v = amountToRupees(raw.rawRazorpay.amount);
          if (v != null) amountR = v;
        }

        if (amountR == null && raw.paidAmount != null) {
          const v = amountToRupees(raw.paidAmount);
          if (v != null) amountR = v;
        }

        if (amountR == null && raw.paymentAmount != null) {
          const v = amountToRupees(raw.paymentAmount);
          if (v != null) amountR = v;
        }

        if (amountR == null && raw.amount != null) {
          const v = amountToRupees(raw.amount);
          if (v != null) amountR = v;
        }

        if (amountR == null && Array.isArray(raw.packages) && raw.packages.length > 0) {
          const sumPaid = raw.packages.reduce((s, pk) => {
            const candidate = pk.paidPrice ?? pk.paidAmount ?? pk.totalPayable ?? pk.price ?? pk.amount ?? 0;
            const n = amountToRupees(candidate) ?? 0;
            return s + n;
          }, 0);
          if (sumPaid > 0) {
            amountR = Number(Math.round((sumPaid + Number.EPSILON) * 100) / 100);
          }
        }

        if (amountR == null && Array.isArray(raw.packages) && raw.packages.length > 0) {
          const sumPc = raw.packages.reduce((s, pk) => s + (pk.packageCost != null ? Number(pk.packageCost) : 0), 0);
          if (sumPc > 0) amountR = amountToRupees(sumPc);
        }

        normalized.amountRupees = amountR != null ? Number(amountR) : null;

        if (normalized.amountRupees != null) {
          normalized.amount = Number(normalized.amountRupees);
        } else if (raw.amount != null) {
          normalized.amount = Number(raw.amount);
        }

        let reportCost = null;
        let reportPaid = null;
        let reportDiscount = null;

        if (Array.isArray(normalized.packages) && normalized.packages.length > 0) {
          const sumCost = normalized.packages.reduce((s, pkg) => {
            const candidate = pkg.packageCost != null ? Number(pkg.packageCost) : (pkg.price != null ? Number(pkg.price) : 0);
            const conv = (n) => {
              if (!Number.isFinite(n)) return 0;
              if (Math.abs(n) >= 1000) return n / 100;
              if (Math.abs(n) >= 100 && n % 100 === 0) return n / 100;
              return n;
            };
            return s + conv(candidate);
          }, 0);
          if (sumCost > 0) reportCost = Number(Math.round((sumCost + Number.EPSILON) * 100) / 100);
        } else {
          const candidateCost = raw.packageTotalCost ?? raw.totalPackageCost ?? raw.packageCost ?? raw.totalAmount ?? null;
          const c = amountToRupees(candidateCost);
          if (c != null) reportCost = Number(Math.round((c + Number.EPSILON) * 100) / 100);
        }

        if (normalized.amountRupees != null) {
          reportPaid = Number(Math.round((normalized.amountRupees + Number.EPSILON) * 100) / 100);
        } else {
          const fallbackPaidCandidates = [raw.paidAmount, raw.paymentAmount, raw.amount];
          let found = null;
          for (const cand of fallbackPaidCandidates) {
            const c = amountToRupees(cand);
            if (c != null) {
              found = c;
              break;
            }
          }
          if (found != null) reportPaid = Number(Math.round((found + Number.EPSILON) * 100) / 100);
        }

        if (reportPaid == null && Array.isArray(normalized.packages) && normalized.packages.length > 0) {
          const sumPaid = normalized.packages.reduce((s, pkg) => {
            const candidate = pkg.paidPrice ?? pkg.totalPayable ?? pkg.price ?? pkg.amount ?? 0;
            const n = amountToRupees(candidate) ?? 0;
            return s + n;
          }, 0);
          if (sumPaid > 0) reportPaid = Number(Math.round((sumPaid + Number.EPSILON) * 100) / 100);
        }

        if (reportCost != null && reportPaid != null) {
          reportDiscount = Number(Math.round(((reportCost - reportPaid) + Number.EPSILON) * 100) / 100);
        } else {
          reportDiscount = null;
        }

        normalized.reportCost = reportCost;
        normalized.reportPaid = reportPaid != null ? reportPaid : normalized.amountRupees != null ? Number(normalized.amountRupees) : null;
        normalized.reportDiscount = reportDiscount != null ? reportDiscount : (normalized.reportCost != null && normalized.reportPaid != null ? Number(Math.round(((normalized.reportCost - normalized.reportPaid) + Number.EPSILON) * 100) / 100) : null);

        const refundAmountRaw =
          raw.refundAmount ??
          raw.refundedAmount ??
          (raw.rawRazorpay && (raw.rawRazorpay.amount_refunded ?? raw.rawRazorpay.amount_refunded)) ??
          raw.rawRazorpay?.amount_refunded ??
          null;

        const refundAmount = refundAmountRaw != null ? amountToRupees(refundAmountRaw) : null;

        const refundReason =
          raw.refundReason ??
          raw.refund_reason ??
          (raw.rawRazorpay && (
            (raw.rawRazorpay.notes && (raw.rawRazorpay.notes.reason || raw.rawRazorpay.notes.remarks)) ||
            raw.rawRazorpay.description ||
            raw.rawRazorpay.error_reason
          )) ??
          raw.rawRazorpay?.error_reason ??
          null;

        const statusCandidates = [
          raw.paymentStatus,
          raw.status,
          raw.settlementStatus,
          raw.razorpayStatus,
          raw.refundStatus,
          raw.rawRazorpay && raw.rawRazorpay.status,
        ].filter(Boolean).map((s) => String(s).toLowerCase());

        let resolvedStatus = statusCandidates.length ? statusCandidates[0] : "";

        if (!resolvedStatus) {
          if (refundAmount && normalized.amountRupees != null) {
            if (refundAmount >= normalized.amountRupees - 0.5) {
              resolvedStatus = "refunded";
            } else if (refundAmount > 0) {
              resolvedStatus = "partially_refunded";
            }
          } else if (normalized.amountRupees != null && normalized.amountRupees > 0) {
            resolvedStatus = "paid";
          } else {
            resolvedStatus = "unknown";
          }
        }

        normalized.paymentStatusResolved = resolvedStatus;
        normalized.refundAmount = refundAmount != null ? Number(refundAmount) : null;
        normalized.refundReason = refundReason || null;

        return normalized;
      };

      const list = snapshot.docs.map((d) => normalizeDoc(d));
      list.sort((a, b) => {
        const ta =
          a.paidAtClient || a.paidAtClient === 0
            ? a.paidAtClient
            : a.createdAtClient || a.createdAtClient === 0
            ? a.createdAtClient
            : 0;
        const tb =
          b.paidAtClient || b.paidAtClient === 0
            ? b.paidAtClient
            : b.createdAtClient || b.createdAtClient === 0
            ? b.createdAtClient
            : 0;
        return tb - ta;
      });
      setStudentReports(list);
    } catch (err) {
      console.error("Error fetching student reports:", err);
    } finally {
      setLoadingReports(false);
    }
  };

  useEffect(() => {
    if (activeTab === "reports") {
      fetchStudentReports();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const resolvePromoterInfo = async (mappedPromoter) => {
    if (!mappedPromoter) return { promoterUid: null, promoterUniqueId: null, promoterName: null };
    try {
      const promoterDoc = await getDoc(doc(db, "users", mappedPromoter));
      if (promoterDoc.exists()) {
        const d = promoterDoc.data();
        return { promoterUid: promoterDoc.id, promoterUniqueId: d.uniqueId || null, promoterName: d.name || d.email || null };
      }
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

  const sendReceiptToServer = async ({ paymentDocId, paymentPayload }) => {
    try {
      try {
        const sendReceiptFn = httpsCallable(functions, "sendPaymentReceipt");
        const res = await sendReceiptFn({ paymentId: paymentDocId, payment: paymentPayload });
        if (res && res.data && res.data.success) {
          return { ok: true, via: "callable" };
        }
      } catch (err) {
        console.warn("sendPaymentReceipt callable failed:", err);
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

  const refreshUserDoc = async (uid) => {
    if (!uid) return null;
    try {
      const ud = await getDoc(doc(db, "users", uid));
      if (ud.exists()) return ud.data();
    } catch (e) {
      console.warn("refreshUserDoc failed", e);
    }
    return null;
  };

  const handleCheckout = async () => {
    if (cart.length === 0) {
      alert("Cart is empty!");
      return;
    }
    const amountInPaise = Math.round(cartTotal * 100);

    const options = {
      key: "rzp_live_RXgt3NNJiZJDob",
      amount: amountInPaise,
      currency: "INR",
      name: "ISP Education",
      description: "Course Payment",
      image: "https://ispeducation.in/logo192.png",
      handler: async function (response) {
        try {
          alert("Payment successful! Payment ID: " + response.razorpay_payment_id);

          const uid = auth.currentUser?.uid || null;
          let refreshedUser = null;
          if (uid) refreshedUser = await refreshUserDoc(uid);

          const mappedPromoter = studentInfo.mappedPromoter || null;
          const promoterResolved = await resolvePromoterInfo(mappedPromoter);

          const amountToRupees = (val) => {
            if (val == null) return 0;
            const n = Number(val);
            if (!Number.isFinite(n)) return 0;
            if (Math.abs(n) >= 1000) return n / 100;
            if (Math.abs(n) >= 100 && n % 100 === 0) return n / 100;
            return n;
          };

          const parseDiscountField = (raw, basePrice) => {
            if (raw == null || raw === "") return { amount: 0, breakdown: "" };
            if (typeof raw === "string" && raw.trim().endsWith("%")) {
              const pct = Number(raw.replace(/%/g, "").trim()) || 0;
              const amt = (basePrice * pct) / 100;
              return { amount: Number(amt.toFixed(2)), breakdown: `${pct}%` };
            }
            if (typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
              const num = Number(raw.trim());
              if (num > 0 && num <= 100) {
                const amt = (basePrice * num) / 100;
                return { amount: Number(amt.toFixed(2)), breakdown: `${num}%` };
              }
              const amt = amountToRupees(num);
              return { amount: Number(amt.toFixed(2)), breakdown: `₹${Number(amt.toFixed(2))}` };
            }
            if (typeof raw === "number") {
              if (raw > 0 && raw <= 100) {
                const amt = (basePrice * raw) / 100;
                return { amount: Number(amt.toFixed(2)), breakdown: `${raw}%` };
              }
              const amt = amountToRupees(raw);
              return { amount: Number(amt.toFixed(2)), breakdown: `₹${Number(amt.toFixed(2))}` };
            }
            const amt = amountToRupees(raw);
            return { amount: Number(amt.toFixed(2)), breakdown: `₹${Number(amt.toFixed(2))}` };
          };

          // Build packagesPayload with detailed discount fields
          const packagesPayload = cart.map((pkg) => {
            const rawBaseCandidates = pkg.packageCost ?? pkg.price ?? pkg.mrp ?? pkg.totalPayable ?? 0;
            const basePrice = Number(amountToRupees(rawBaseCandidates || 0));

            const regRaw = pkg.regularDiscount ?? pkg.regular_discount ?? pkg.regular ?? pkg.regularDiscountPercent ?? pkg.regular_percent ?? 0;
            const addRaw = pkg.additionalDiscount ?? pkg.additional_discount ?? pkg.additional ?? pkg.additionalDiscountPercent ?? pkg.additional_percent ?? 0;

            const reg = parseDiscountField(regRaw, basePrice);
            const add = parseDiscountField(addRaw, basePrice);

            const discountAmountCombined = Number(((reg.amount || 0) + (add.amount || 0)).toFixed(2));

            let paidPriceComputed = null;
            if (typeof pkg.totalPayable !== "undefined" && pkg.totalPayable !== null && pkg.totalPayable !== "") {
              paidPriceComputed = Number(amountToRupees(pkg.totalPayable));
            } else {
              paidPriceComputed = Number((basePrice - discountAmountCombined).toFixed(2));
            }

            let explicitPaidCandidate = null;
            if (pkg.paidPrice != null) explicitPaidCandidate = Number(amountToRupees(pkg.paidPrice));
            if (pkg.paidAmount != null && explicitPaidCandidate === null) explicitPaidCandidate = Number(amountToRupees(pkg.paidAmount));
            if (explicitPaidCandidate != null && Number.isFinite(explicitPaidCandidate) && explicitPaidCandidate > 0) {
              paidPriceComputed = explicitPaidCandidate;
            }

            const breakdownParts = [];
            if (reg.amount && reg.amount > 0) breakdownParts.push(`regular ${reg.breakdown}`);
            if (add.amount && add.amount > 0) breakdownParts.push(`additional ${add.breakdown}`);
            const explicitPkgDiscountRaw = pkg.discount ?? pkg.discountAmount ?? pkg.discount_amount;
            if (explicitPkgDiscountRaw != null && explicitPkgDiscountRaw !== "") {
              const ed = parseDiscountField(explicitPkgDiscountRaw, basePrice);
              if (ed.amount > 0) {
                breakdownParts.push(`pkg ${ed.breakdown}`);
              }
            }
            const discountBreakdownString = breakdownParts.join(" + ") || "";

            const packageCost = Number(basePrice || 0);
            const discountAmount = Number(discountAmountCombined || 0);
            const paidPrice = Number(paidPriceComputed || 0);

            const commissionPercent = safeNum(
              pkg.commission ?? pkg.promoterCommission ?? pkg.commissionPercent ?? pkg.commission_pct ?? pkg.promoter_commission_percent ?? 0
            );

            let explicitCommissionAmount =
              pkg.commissionAmount ?? pkg.commission_total ?? pkg.commissionTotal ?? pkg.promoterCommissionAmount ?? 0;
            explicitCommissionAmount = Number(explicitCommissionAmount || 0);
            if (explicitCommissionAmount >= 100 && packageCost < 100) {
              explicitCommissionAmount = explicitCommissionAmount / 100;
            }

            let commissionAmount = 0;
            if (explicitCommissionAmount > 0) {
              commissionAmount = Number(Math.round((explicitCommissionAmount + Number.EPSILON) * 100) / 100);
            } else if (packageCost > 0 && commissionPercent > 0) {
              commissionAmount = Number(
                Math.round(((packageCost * commissionPercent) / 100 + Number.EPSILON) * 100) / 100
              );
            } else {
              commissionAmount = 0;
            }

            return {
              id: pkg.id || null,
              packageId: pkg.id || null,
              packageName: pkg.packageName || pkg.concept || pkg.name || "",
              subject: pkg.subject || "",
              subtopic: pkg.subtopic || "",
              chapter: pkg.chapter || "",
              packageCost: Number(packageCost || 0),
              // per-package discount fields
              regularDiscountPercent: regRaw ?? 0,
              additionalDiscountPercent: addRaw ?? 0,
              regularDiscountAmount: Number(reg.amount || 0),
              additionalDiscountAmount: Number(add.amount || 0),
              discountAmount: Number(discountAmount || 0),
              discountBreakdown: discountBreakdownString || "",
              paidPrice: Number(paidPrice || 0),
              commissionPercent: Number(commissionPercent || 0),
              commissionAmount: Number(commissionAmount || 0),
              price: Number(amountToRupees(pkg.price ?? pkg.packageCost ?? pkg.totalPayable ?? 0)),
              totalPayable: Number(amountToRupees(pkg.totalPayable ?? pkg.paidAmount ?? pkg.price ?? 0)),
            };
          });

          const packageTotalCost = packagesPayload.reduce((s, p) => s + Number(p.packageCost || 0), 0);
          const totalDiscount = packagesPayload.reduce((s, p) => s + Number(p.discountAmount || 0), 0);
          const paidFromPackages = packagesPayload.reduce((s, p) => s + Number(p.paidPrice || 0), 0);
          const paidAmountCombined = Number(Math.round((paidFromPackages + Number.EPSILON) * 100) / 100);
          const finalPaidAmount = Number(Math.round((cartTotal + Number.EPSILON) * 100) / 100) || paidAmountCombined;

          const commissionTotal = packagesPayload.reduce((s, p) => s + safeNum(p.commissionAmount), 0);

          const finalStudentName = (studentInfo.name && studentInfo.name !== "Student") ? studentInfo.name : (refreshedUser?.name || auth.currentUser?.displayName || "");
          const finalStudentPhone = studentInfo.phone || refreshedUser?.phone || auth.currentUser?.phoneNumber || "";

          const callablePayload = {
            paymentId: response.razorpay_payment_id,
            packages: packagesPayload,
            paidAmount: Number(finalPaidAmount),
            amount: Number(finalPaidAmount),
            totalAmount: Number(finalPaidAmount),
            packageTotalCost: Number(Math.round((packageTotalCost + Number.EPSILON) * 100) / 100),
            totalDiscount: Number(Math.round((totalDiscount + Number.EPSILON) * 100) / 100),
            commissionTotal: Number(Math.round((commissionTotal + Number.EPSILON) * 100) / 100),
            mappedPromoter: studentInfo.mappedPromoter || null,
            promoterUid: promoterResolved?.promoterUid || null,
            promoterDocId: promoterResolved?.promoterUid || null,
            promoterUniqueId: promoterResolved?.promoterUniqueId || null,
            promoterName: promoterResolved?.promoterName || null,
            createPerPackage: true, // ask server to create one doc per package
            source: "razorpay_checkout_client",
            studentId: uid || null,
            studentName: finalStudentName || "",
            studentEmail: auth.currentUser?.email || "",
            studentPhone: finalStudentPhone || "",
          };

          delete callablePayload.pendingAmount;
          delete callablePayload.teamCount;

          let saved = false;
          let savedPaymentDocId = null;
          let lastErr = null;

          const interpretCallableResult = (res) => {
            if (!res) return null;
            const d = res.data || {};
            if (d.success && Array.isArray(d.details) && d.details.length) {
              return d.details[0]?.paymentDocId || d.paymentDocIds?.[0] || null;
            }
            if (d.success && Array.isArray(d.paymentDocIds) && d.paymentDocIds.length) {
              return d.paymentDocIds[0];
            }
            if (d.success && (d.paymentDocId || d.paymentId)) return d.paymentDocId || d.paymentId;
            return null;
          };

          try {
            const createPaymentRecord = httpsCallable(functions, "createPaymentRecord");
            const res = await createPaymentRecord(callablePayload);
            console.log("createPaymentRecord result:", res?.data);
            const id = interpretCallableResult(res);
            if (id) {
              saved = true;
              savedPaymentDocId = id;
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
              const id2 = interpretCallableResult(res2);
              if (id2) {
                saved = true;
                savedPaymentDocId = id2;
              }
            } catch (err2) {
              console.warn("adminCreatePayment callable failed:", err2);
              lastErr = err2;
            }
          }

          // CLIENT-SIDE FALLBACK: Create one document per package if callables fail
          if (!saved) {
            try {
              const createdRefs = [];
              for (const p of packagesPayload) {
                const pkgDoc = {
                  studentId: uid,
                  studentName: finalStudentName || "",
                  email: auth.currentUser?.email || "",
                  phone: finalStudentPhone || "",
                  packageId: p.packageId || null,
                  packageName: p.packageName || null,
                  packageCost: Number(p.packageCost || 0),
                  discountAmount: Number(p.discountAmount || 0),
                  regularDiscountAmount: Number(p.regularDiscountAmount || 0),
                  additionalDiscountAmount: Number(p.additionalDiscountAmount || 0),
                  regularDiscountPercent: p.regularDiscountPercent ?? 0,
                  additionalDiscountPercent: p.additionalDiscountPercent ?? 0,
                  paidAmount: Number(p.paidPrice || p.totalPayable || 0),
                  paymentId: response.razorpay_payment_id,
                  paymentMethod: "razorpay",
                  paymentStatus: "paid",
                  settlementStatus: "pending",
                  promoterDocId: promoterResolved?.promoterUid || null,
                  promoterUid: promoterResolved?.promoterUid || null,
                  promoterUniqueId: promoterResolved?.promoterUniqueId || null,
                  promoterName: promoterResolved?.promoterName || null,
                  commissionPercent: Number(p.commissionPercent || 0),
                  commissionAmount: Number(p.commissionAmount || 0),
                  createdAt: serverTimestamp(),
                  paidAt: serverTimestamp(),
                  source: "razorpay_checkout_client_fallback_per_package",
                  gatewayRaw: { raw: response },
                };

                const docRef = await addDoc(collection(db, "payments"), pkgDoc);
                createdRefs.push(docRef.id);
              }

              console.log("Fallback: saved payments docs client-side (per-package):", createdRefs);
              saved = true;
              savedPaymentDocId = createdRefs[0] || null;
            } catch (addErr) {
              console.error("Fallback addDoc per-package to /payments failed:", addErr);
              lastErr = addErr;
            }
          }

          if (!saved) {
            console.error("Failed to save payment record via callable AND fallback. Last error:", lastErr);
            alert(
              "Payment succeeded but saving the record failed. Ensure your callable function (createPaymentRecord or adminCreatePayment) is deployed and that Firestore rules allow the write. Check console for details."
            );
            setCart([]);
            setActiveTab("reports");
            if (activeTab === "reports") fetchStudentReports();
            return;
          }

          try {
            const payloadForReceipt = {
              ...callablePayload,
              savedPaymentDocId,
              studentId: uid || null,
              studentName: finalStudentName || "",
              studentEmail: auth.currentUser?.email || "",
              studentPhone: finalStudentPhone || "",
              paymentDocId: savedPaymentDocId,
            };
            delete payloadForReceipt.pendingAmount;
            delete payloadForReceipt.teamCount;

            const receiptRes = await sendReceiptToServer({ paymentDocId: savedPaymentDocId, paymentPayload: payloadForReceipt });
            console.log("sendReceiptToServer result:", receiptRes);
          } catch (e) {
            console.warn("Receipt sending attempt failed:", e);
          }

          setCart([]);
          setActiveTab("reports");
          setTimeout(() => fetchStudentReports(), 900);
        } catch (err) {
          console.error("Error in payment handler:", err);
          alert("Payment succeeded but something went wrong while saving. Check console.");
        }
      },
      prefill: {
        name: studentInfo.name,
        email: auth.currentUser?.email || "",
        contact: studentInfo.phone || "",
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
        background: "transparent",
        paddingBottom: "140px",
      }}
    >
      <div style={{ flex: 3, padding: "20px" }}>
        <div className="dashboard-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#fff" }}>
          <h1>Welcome, {studentInfo.name}!</h1>

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

        <div style={{ marginTop: "12px", display: "flex", gap: "12px", alignItems: "center", color: "#fff", flexWrap: "wrap" }}>
          <div style={{ background: "#ffffff12", padding: "10px 14px", borderRadius: "8px", minWidth: "160px", display: "flex", flexDirection: "column" }}>
            <small style={{ color: "#cbd5e1", fontSize: "12px" }}>Name</small>
            <strong style={{ fontSize: "15px" }}>{studentInfo.name || "Student"}</strong>
          </div>

          <div style={{ background: "#ffffff12", padding: "10px 14px", borderRadius: "8px", minWidth: "120px", display: "flex", flexDirection: "column" }}>
            <small style={{ color: "#cbd5e1", fontSize: "12px" }}>Class</small>
            <strong style={{ fontSize: "15px" }}>{studentInfo.classGrade || "—"}</strong>
          </div>

          <div style={{ background: "#ffffff12", padding: "10px 14px", borderRadius: "8px", minWidth: "140px", display: "flex", flexDirection: "column" }}>
            <small style={{ color: "#cbd5e1", fontSize: "12px" }}>Syllabus</small>
            <strong style={{ fontSize: "15px" }}>{studentInfo.syllabus || "—"}</strong>
          </div>
        </div>

        {activeTab === "reports" && (
          <div style={{ marginTop: 20, background: "#ffffff14", padding: 16, borderRadius: 10 }}>
            <h2 style={{ color: "#fff", marginBottom: 12 }}>📑 My Payment Reports</h2>

            {loadingReports ? (
              <p style={{ color: "#fff" }}>Loading reports...</p>
            ) : studentReports.length === 0 ? (
              <p style={{ color: "#fff" }}>No payment records found.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", color: "#fff", minWidth: 900 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <th style={{ padding: "8px 6px" }}>Package</th>
                      <th style={{ padding: "8px 6px" }}>Subject</th>
                      <th style={{ padding: "8px 6px" }}>Cost (₹)</th>
                      <th style={{ padding: "8px 6px" }}>Discount (₹)</th>
                      <th style={{ padding: "8px 6px" }}>Paid (₹)</th>
                      <th style={{ padding: "8px 6px" }}>Status</th>
                      <th style={{ padding: "8px 6px" }}>Refund Info</th>
                      <th style={{ padding: "8px 6px" }}>Date</th>
                      <th style={{ padding: "8px 6px" }}>Payment ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentReports.map((r) => {
                      const packageNames = r.packages && r.packages.length ? r.packages.map(p => (typeof p.packageName === "string" ? p.packageName : String(p.packageName))).join(", ") : r.packageName || "—";
                      const subjectText = r.subject || (r.packages && r.packages[0]?.subject) || "—";
                      const cost = typeof r.reportCost === "number" ? r.reportCost : (r.packageTotalCost ?? r.totalPackageCost ?? null);
                      const paid = typeof r.reportPaid === "number" ? r.reportPaid : (r.amountRupees ?? r.amount ?? r.paidAmount ?? null);
                      const discount = typeof r.reportDiscount === "number" ? r.reportDiscount : (cost != null && paid != null ? Number((cost - paid).toFixed(2)) : null);

                      const displayCost = cost != null && Number.isFinite(Number(cost)) ? Number(cost).toFixed(2) : (r.amountRupees != null ? Number(r.amountRupees).toFixed(2) : "0.00");
                      const displayPaid = paid != null && Number.isFinite(Number(paid)) ? Number(paid).toFixed(2) : "0.00";
                      const displayDiscount = discount != null && Number.isFinite(Number(discount)) ? Number(discount).toFixed(2) : "0.00";

                      const displayDate = r.paidAtClient
                        ? new Date(r.paidAtClient).toLocaleString("en-IN")
                        : r.paidAt
                        ? (r.paidAt.seconds ? new Date(r.paidAt.seconds * 1000).toLocaleString("en-IN") : new Date(r.paidAt).toLocaleString("en-IN"))
                        : r.createdAtClient
                        ? new Date(r.createdAtClient).toLocaleString("en-IN")
                        : "—";

                      const st = (r.paymentStatusResolved || r.paymentStatus || r.settlementStatus || "").toString().toLowerCase();
                      let displayStatus = "Paid";
                      if (st.includes("refund") || st.includes("refunded")) displayStatus = "Refunded";
                      else if (st.includes("part") || st.includes("partial")) displayStatus = "Partially Refunded";
                      else if (st.includes("fail") || st.includes("failed")) displayStatus = "Failed";
                      else if (!paid || Number(paid) === 0) displayStatus = "Unpaid";

                      let refundInfo = "—";
                      if (r.refundAmount != null && Number(r.refundAmount) > 0) {
                        refundInfo = `₹${Number(r.refundAmount).toFixed(2)}`;
                        if (r.refundReason) refundInfo += ` — ${r.refundReason}`;
                      } else if (r.refundReason) {
                        refundInfo = r.refundReason;
                      }

                      return (
                        <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                          <td style={{ padding: "10px 6px", color: "#e6eef8" }}>{packageNames}</td>
                          <td style={{ padding: "10px 6px", color: "#e6eef8" }}>{subjectText}</td>
                          <td style={{ padding: "10px 6px", color: "#e6eef8", fontWeight: 700 }}>{displayCost}</td>
                          <td style={{ padding: "10px 6px", color: "#e6eef8" }}>{displayDiscount}</td>
                          <td style={{ padding: "10px 6px", color: "#e6eef8", fontWeight: 700 }}>{displayPaid}</td>
                          <td style={{ padding: "10px 6px", color: "#e6eef8" }}>{displayStatus}</td>
                          <td style={{ padding: "10px 6px", color: "#e6eef8", fontSize: 12 }}>{refundInfo}</td>
                          <td style={{ padding: "10px 6px", color: "#e6eef8" }}>{displayDate}</td>
                          <td style={{ padding: "10px 6px", color: "#e6eef8", fontSize: 12 }}>{r.paymentId || r.paymentID || r.id || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "shop" && (
          <>
            <div style={{ marginTop: "20px", background: "#ffffff22", padding: "15px", borderRadius: "10px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "15px" }}>
              <div>
                <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>Package Type</label>
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
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {selectedType && packageNameOptions.length > 0 && (
                <div>
                  <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>Package Name</label>
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
                    {packageNameOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              )}

              {isConceptPackageName(selectedPackageName) && subjectOptions.length > 0 && (
                <div>
                  <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>Subject</label>
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
                    {subjectOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}

              {isConceptPackageName(selectedPackageName) && selectedSubject && subtopicOptions.length > 0 && (
                <div>
                  <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>Subtopic</label>
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
                    {subtopicOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}

              {isConceptPackageName(selectedPackageName) && selectedSubtopic && chapterOptions.length > 0 && (
                <div>
                  <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>Chapter</label>
                  <select
                    className="sel"
                    value={selectedChapter}
                    onChange={(e) => setSelectedChapter(e.target.value)}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px" }}
                  >
                    <option value="">— Select Chapter —</option>
                    {chapterOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
            </div>

            {selectedPackageName && (
              <>
                <h2 style={{ marginTop: 20, color: "white" }}>{selectedType === "Interactive Class" ? "Available Classes" : "Available Tests"}</h2>
                {conceptCards.length === 0 ? (
                  <p style={{ color: "#fff" }}>{isConceptPackageName(selectedPackageName) ? "Select Subject → Subtopic → Chapter to view items." : "No items found."}</p>
                ) : (
                  <div className="packages-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px", marginTop: "20px" }}>
                    {conceptCards.map((pkg) => {
                      const subj = normalizeSubject(pkg.subject) || "Default";
                      const { basePrice, finalPrice, d1, d2 } = computeFinalPrice(pkg);
                      const durationNum = parseFloat(pkg.duration) || 0;
                      const rateBefore = durationNum > 0 ? basePrice / durationNum : null;
                      const rateAfter = durationNum > 0 ? finalPrice / durationNum : null;
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
                          <div className="price-sticker" style={{ position: "absolute", bottom: 16, left: 16, transform: "none", background: "#05060A", color: "#b7ffd6", padding: "8px 10px", borderRadius: "10px", fontSize: "12px", fontWeight: 700, zIndex: 6, boxShadow: "0 8px 24px rgba(0,255,150,0.06), 0 4px 10px rgba(0,0,0,0.2)", border: "1px solid rgba(0,255,150,0.12)", display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.05, minWidth: 120 }} aria-hidden>
                            <span style={{ fontSize: "11px", color: "#9ca3af", textDecoration: rateBefore ? "line-through" : "none", marginBottom: 4 }}>
                              {rateBefore !== null ? `Was ₹${Number(rateBefore).toFixed(2)}/hr` : "Was —"}
                            </span>
                            <span style={{ fontSize: "13px", color: "#7CFF8E", fontWeight: 900 }}>
                              {rateAfter !== null ? `Now ₹${Number(rateAfter).toFixed(2)}/hr` : "Now —"}
                            </span>
                          </div>

                          {totalDiscount > 0 && (
                            <div style={{ position: "absolute", top: "10px", right: "10px", background: totalDiscount >= 40 ? "#e11d48" : totalDiscount >= 20 ? "#f97316" : "#16a34a", color: "#fff", padding: "4px 8px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", boxShadow: "0 2px 6px rgba(0,0,0,0.12)", zIndex: 7 }}>
                              {totalDiscount}% OFF
                            </div>
                          )}

                          <div className="zoom-card-inner" style={{ textAlign: "center", zIndex: 2, paddingBottom: 72 }}>
                            <img src={subjectImages[subj] || subjectImages.Default} alt={subj} style={{ width: "80px", height: "80px", objectFit: "contain", marginBottom: "8px", borderRadius: "10px", backgroundColor: "rgba(255,255,255,0.05)" }} />
                            <h3 style={{ fontSize: "16px", fontWeight: "600", color: "#222", marginBottom: "4px" }}>{pkg.concept || pkg.packageName}</h3>
                            <span style={{ display: "block", fontSize: "13px", marginBottom: "10px", color: "#555" }}>{subj} {pkg.subtopic ? "→ " + pkg.subtopic + " → " : ""}{pkg.chapter}</span>

                            <div style={{ textAlign: "left", fontSize: "13px", color: "#444", marginBottom: "10px", lineHeight: "1.4em" }}>
                              {pkg.courseDetails && (<p style={{ margin: "4px 0" }}><b>Course:</b> {pkg.courseDetails}</p>)}
                              {!pkg.courseDetails && pkg.description && (<p style={{ margin: "4px 0" }}><b>About:</b> {pkg.description.length > 80 ? pkg.description.slice(0, 80) + "..." : pkg.description}</p>)}
                              {pkg.duration && (<p style={{ margin: "4px 0" }}><b>Duration:</b> {pkg.duration} hrs</p>)}
                              {pkg.perHour && (<p style={{ margin: "4px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}><span><b>Rate (stored):</b></span><span style={{ background: "#f3f4f6", padding: "4px 8px", borderRadius: 6 }}>₹{pkg.perHour}/hr</span></p>)}

                              {freebiesText && freebiesText.trim() !== "" && (
                                <p style={{ margin: "6px 0 0 0", color: "#0f172a", background: "#f1f5f9", padding: "6px", borderRadius: "6px" }}>
                                  <strong style={{ marginRight: 6 }}>🎁 Freebies:</strong>
                                  <span style={{ fontWeight: 500 }}>{freebiesText.length > 80 ? freebiesText.slice(0, 80) + "..." : freebiesText}</span>
                                </p>
                              )}
                            </div>

                            <div style={{ textAlign: "left", marginTop: "8px" }}>
                              <p style={{ margin: "2px 0" }}>
                                <b>Price:</b>{" "}
                                <span style={{ textDecoration: d1 || d2 ? "line-through" : "none" }}>
                                  ₹{basePrice.toFixed(2)}
                                </span>
                              </p>
                              {(d1 || d2) && (<p style={{ margin: "2px 0", color: "#16a34a", fontWeight: "700" }}><b>Now:</b> ₹{finalPrice.toFixed(2)}</p>)}

                              {(d1 > 0 || d2 > 0) && (
                                <div style={{ marginTop: "6px", fontSize: "13px", color: "#e11d48" }}>
                                  <div><b>Discounts:</b>{" "}{d1 > 0 && <span>{d1}% regular</span>}{d1 > 0 && d2 > 0 && <span> + </span>}{d2 > 0 && <span>{d2}% additional</span>}</div>
                                </div>
                              )}
                            </div>
                          </div>

                          <div style={{ position: "absolute", bottom: 16, right: 16, zIndex: 20 }}>
                            <button onClick={() => addToCart(pkg)} style={{ padding: "8px 14px", background: "#1e90ff", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600", boxShadow: "0 6px 14px rgba(30,144,255,0.18)", zIndex: 20 }}>
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

      <div style={{ flex: 1, background: "#ffffff11", padding: "20px", borderRadius: "12px", height: "fit-content", position: "sticky", top: "20px", alignSelf: "start", minWidth: "260px" }} className="desktop-cart">
        <h2 style={{ color: "#fff", marginBottom: "15px" }}>Cart</h2>
        {cart.length === 0 ? (
          <p style={{ color: "#fff" }}>Cart is empty</p>
        ) : (
          <>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {cart.map((pkg) => (
                <li key={pkg.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", color: "#fff", alignItems: "center", gap: "8px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600 }}>{pkg.packageName || pkg.concept}</div>
                    <div style={{ fontSize: "12px", color: "#ddd" }}>{pkg.subject ? normalizeSubject(pkg.subject) : ""}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div>₹{parseFloat(pkg.totalPayable || pkg.price || pkg.packageCost || 0).toFixed(2)}</div>
                    <button onClick={() => removeFromCart(pkg.id)} style={{ marginLeft: "10px", background: "transparent", border: "none", color: "#ff4757", cursor: "pointer" }}>✕</button>
                  </div>
                </li>
              ))}
            </ul>
            <p style={{ color: "#fff", fontWeight: "600" }}>Total: ₹{cartTotal.toFixed(2)}</p>
            <button onClick={handleCheckout} style={{ marginTop: "10px", padding: "10px", width: "100%", background: "#2ed573", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}>
              Checkout
            </button>
          </>
        )}
      </div>

      {/* Mobile cart floating button */}
      <button
        className="mobile-cart-button"
        onClick={() => setShowMobileCart((s) => !s)}
        aria-label="Open cart"
      >
        🛒 {cart.length}
      </button>

      {/* Mobile cart overlay */}
      {showMobileCart && (
        <div className="mobile-cart-overlay">
          <div className="mobile-cart-inner">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong>Cart</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setShowMobileCart(false); setActiveTab("shop"); }} style={{ background: "transparent", border: "none", cursor: "pointer" }}>Close</button>
              </div>
            </div>

            {cart.length === 0 ? (
              <p style={{ margin: 0 }}>Cart is empty</p>
            ) : (
              <>
                <ul style={{ listStyle: "none", padding: 0, maxHeight: 240, overflowY: "auto" }}>
                  {cart.map((pkg) => (
                    <li key={pkg.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", alignItems: "center" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "14px", fontWeight: 600 }}>{pkg.packageName || pkg.concept}</div>
                        <div style={{ fontSize: "12px", color: "#ddd" }}>{pkg.subject ? normalizeSubject(pkg.subject) : ""}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div>₹{parseFloat(pkg.totalPayable || pkg.price || pkg.packageCost || 0).toFixed(2)}</div>
                        <button onClick={() => removeFromCart(pkg.id)} style={{ marginLeft: "10px", background: "transparent", border: "none", color: "#ff4757", cursor: "pointer" }}>✕</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <p style={{ fontWeight: 700 }}>Total: ₹{cartTotal.toFixed(2)}</p>
                <button onClick={() => { setShowMobileCart(false); handleCheckout(); }} style={{ padding: "10px", width: "100%", background: "#2ed573", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}>
                  Checkout
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="bottom-fixed-actions" style={{ position: "fixed", bottom: 0, left: 0, width: "100%", zIndex: 1200, display: "flex", gap: "8px", justifyContent: "center", padding: "10px", pointerEvents: "auto" }}>
        <button style={{ padding: "10px 16px", borderRadius: "8px", border: "none", background: "#111827", color: "#fff", cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }} onClick={() => { window.open("/policies", "_blank"); }}>
          Policies
        </button>
        <button style={{ padding: "10px 16px", borderRadius: "8px", border: "none", background: "#111827", color: "#fff", cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }} onClick={() => { window.open("/contact", "_blank"); }}>
          Contact
        </button>
      </div>

      <style>
        {`
          /* Mobile cart floating button */
          .mobile-cart-button {
            display: none;
            position: fixed;
            top: 84px;
            right: 12px;
            z-index: 1400;
            background: #111827;
            color: #fff;
            border: none;
            padding: 10px 12px;
            border-radius: 999px;
            box-shadow: 0 6px 18px rgba(0,0,0,0.28);
            cursor: pointer;
            font-weight: 700;
          }

          .mobile-cart-overlay {
            position: fixed;
            right: 12px;
            top: 100px;
            width: calc(100% - 24px);
            max-width: 420px;
            z-index: 1500;
            background: rgba(17,24,39,0.95);
            color: #fff;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.6);
            padding: 12px;
          }

          .mobile-cart-inner { font-size: 14px; }

          @media (max-width: 900px) {
            .mobile-cart-button { display: block; }
            .desktop-cart { display: none; }

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
            .mobile-cart-overlay { top: 90px; right: 8px; left: 8px; width: calc(100% - 16px); max-width: none; }
          }
        `}
      </style>
    </div>
  );
};

export default StudentDashboard;
