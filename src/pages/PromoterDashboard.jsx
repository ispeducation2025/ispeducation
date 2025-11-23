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
  smallBtn: {
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    background: "#fff",
    cursor: "pointer",
  },
  rawBox: {
    whiteSpace: "pre-wrap",
    fontSize: 12,
    maxHeight: 200,
    overflow: "auto",
    background: "#0f172a",
    color: "#fff",
    padding: 8,
    borderRadius: 6,
    marginTop: 8,
  }
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
   Safe date helper
   ------------------------- */
function toDate(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return value;
  if (value && typeof value.toMillis === "function") {
    return new Date(value.toMillis());
  }
  if (value && typeof value.seconds === "number") {
    return new Date(Number(value.seconds) * 1000);
  }
  if (typeof value === "number") {
    return new Date(value);
  }
  if (typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/* -------------------------
   Money / commission helpers
   ------------------------- */

/**
 * Attempts to extract a rupee amount from the payment / package object.
 * Handles common paise-integer scenarios (Razorpay raw amounts).
 */
function parseMoneyFromPayment(p = {}) {
  if (!p) return 0;
  const candidates = [
    { v: p.packageCost, meta: "packageCost" },
    { v: p.price, meta: "price" },
    { v: p.amount, meta: "amount" },
    { v: p.totalPayable, meta: "totalPayable" },
    { v: p.package_cost, meta: "package_cost" },
    { v: (p.rawRazorpay && p.rawRazorpay.amount), meta: "rawRazorpay.amount" },
    { v: (p.raw && p.raw.amount), meta: "raw.amount" },
    { v: (p.rawRazorpay && p.rawRazorpay.amount_paid), meta: "rawRazorpay.amount_paid" },
    { v: (p.raw && p.raw.data && p.raw.data.amount), meta: "raw.data.amount" },
  ];

  for (const c of candidates) {
    if (c.v === undefined || c.v === null || c.v === "") continue;
    const num = Number(c.v);
    if (!isFinite(num)) continue;
    // Raw amounts commonly come in paise/cents (>=100)
    if (c.meta.startsWith("raw") && Math.abs(num) >= 100) return num / 100;
    if ((c.meta === "amount" || c.meta === "price" || c.meta === "packageCost" || c.meta === "totalPayable") && Math.abs(num) >= 100 && Math.abs(num) % 100 === 0) {
      // very likely paise -> convert
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

  // permission banner flag
  const [permissionBlocked, setPermissionBlocked] = useState(false);

  // debug UI state: which raw payment to show
  const [openRawPaymentId, setOpenRawPaymentId] = useState(null);

  // window resize listener
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

  /**
   * Build commission rows from payments.
   * IMPORTANT: supports payment docs that either represent a single package or contain `packages: []`.
   *
   * Each commission row represents ONE package (so multi-package payments expand to multiple rows).
   *
   * Commission amount is calculated as:
   *   commissionAmount = packageCost * commissionPercent / 100
   * where packageCost is determined by:
   *   pkg.packageCost -> pkg.price -> pkg.package_cost -> parseMoneyFromPayment(pkg) -> parseMoneyFromPayment(paymentDoc)
   *
   * commissionPercent is pulled primarily from package master (pkgs param) by id or by packageName. Falls back to fields on package/payment.
   */

  // Improved package master finder with heuristics (id, name, price)
  const findPackageMasterCommission = (pkgIdOrName, pkgMaybe) => {
    if (!packages || !Array.isArray(packages)) return null;
    // try by id first
    const byId = packages.find((x) => x.id === pkgIdOrName);
    if (byId) return byId;
    // try by packageName (case-insensitive)
    const byName = packages.find((x) => (x.packageName || "").toLowerCase() === (pkgIdOrName || "").toLowerCase());
    if (byName) return byName;

    // Additional heuristics: try matching by name similarity (loose), price, or rounded price
    try {
      // loose name match: substring or token overlap
      if (pkgIdOrName && typeof pkgIdOrName === "string") {
        const target = pkgIdOrName.toLowerCase().trim();
        const byLooseName = packages.find((x) => {
          const xn = (x.packageName || "").toLowerCase();
          if (!xn) return false;
          if (xn === target) return true;
          if (xn.includes(target) || target.includes(xn)) return true;
          // token overlap
          const atokens = target.split(/\s+/).filter(Boolean);
          const xtokens = xn.split(/\s+/).filter(Boolean);
          return atokens.some((t) => xtokens.includes(t));
        });
        if (byLooseName) return byLooseName;
      }

      // match by price (packageCost/price/totalPayable)
      const cost = Number(pkgMaybe?.packageCost ?? pkgMaybe?.price ?? pkgMaybe?.package_cost ?? pkgMaybe?.totalPayable ?? 0);
      if (cost && isFinite(cost) && Math.abs(cost) > 0) {
        // exact price match
        const byPriceExact = packages.find((x) => {
          const pCost = Number(x.packageCost ?? x.price ?? x.totalPayable ?? 0);
          return isFinite(pCost) && Math.abs(pCost - cost) < 0.0001;
        });
        if (byPriceExact) return byPriceExact;

        // within small tolerance
        const tolerance = Math.max(0.5, Math.round(Math.abs(cost) * 0.01)); // 1% or min 0.5 rupee
        const byPriceTol = packages.find((x) => {
          const pCost = Number(x.packageCost ?? x.price ?? x.totalPayable ?? 0);
          return isFinite(pCost) && Math.abs(pCost - cost) <= tolerance;
        });
        if (byPriceTol) return byPriceTol;

        // rounded price match
        const byRound = packages.find((x) => {
          const pCost = Number(x.packageCost ?? x.price ?? x.totalPayable ?? 0);
          return isFinite(pCost) && Math.round(pCost) === Math.round(cost);
        });
        if (byRound) return byRound;
      }
    } catch (e) {
      // ignore heuristic failures
    }

    return null;
  };

  // --- NEW helper: fetch users by ids (batch getDoc)
  const fetchUsersByIds = async (ids = []) => {
    const map = {};
    if (!Array.isArray(ids) || ids.length === 0) return map;
    // limit to unique ids
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    // batch get
    await Promise.all(
      uniq.map(async (id) => {
        try {
          const uDoc = await getDoc(doc(db, "users", id));
          if (uDoc.exists()) {
            const d = uDoc.data() || {};
            map[id] = { name: d.name || d.displayName || d.studentName || d.email || null, email: d.email || null, phone: d.phone || null };
          }
        } catch (e) {
          // ignore per-id errors
        }
      })
    );
    return map;
  };

  function buildRowsFromPayments(paymentsList, finalStudents, pkgs) {
    const rows = [];

    const findPackageMasterCommissionLocal = (pkgIdOrName, pkgMaybe) => {
      // prefer runtime packages state (this function has access to outer 'packages' too)
      if (pkgs && Array.isArray(pkgs) && pkgs.length > 0) {
        // try by id
        const byId = pkgs.find((x) => x.id === pkgIdOrName);
        if (byId) return byId;
        const byName = pkgs.find((x) => (x.packageName || "").toLowerCase() === (pkgIdOrName || "").toLowerCase());
        if (byName) return byName;
        // fallback to the global heuristic if provided
      }
      // fallback to component-level heuristic
      return findPackageMasterCommission(pkgIdOrName, pkgMaybe);
    };

    const getCanonicalStudent = (payment) => {
      return finalStudents.find((st) => st.id === payment.studentId) || { name: payment.studentName || "Student", id: payment.studentId };
    };

    // NEW: try to find student name from finalStudents (id/email/phone/paymentId) or payment fields
    const findStudentName = (payment) => {
      // 1) direct id match
      if (payment.studentId) {
        const byId = finalStudents.find((s) => String(s.id) === String(payment.studentId));
        if (byId && (byId.name || byId.studentName)) return byId.name || byId.studentName;
      }
      // 2) if payment has studentName already set by earlier resolver
      if (payment.studentName && String(payment.studentName).trim() !== "") return String(payment.studentName);
      // 3) match by email
      const email = payment.email || payment.studentEmail || (payment.rawRazorpay && payment.rawRazorpay.email) || (payment.raw && payment.raw.email);
      if (email) {
        const byEmail = finalStudents.find((s) => {
          const se = s.email || s.studentEmail || null;
          return se && String(se).toLowerCase() === String(email).toLowerCase();
        });
        if (byEmail && (byEmail.name || byEmail.studentName)) return byEmail.name || byEmail.studentName;
      }
      // 4) match by phone
      const phone = payment.phone || payment.studentPhone || (payment.rawRazorpay && payment.rawRazorpay.contact) || (payment.raw && payment.raw.contact);
      if (phone) {
        const byPhone = finalStudents.find((s) => {
          const sp = s.phone || s.contact || s.mobile || null;
          if (!sp) return false;
          return String(sp).replace(/\D/g, "") === String(phone).replace(/\D/g, "");
        });
        if (byPhone && (byPhone.name || byPhone.studentName)) return byPhone.name || byPhone.studentName;
      }
      // 5) match by paymentId stored in student records (some setups)
      if (payment.paymentId) {
        const byPayRef = finalStudents.find((s) => {
          if (!s.payments && !s.lastPaymentId && !s.paymentId) return false;
          const checks = [];
          if (Array.isArray(s.payments)) checks.push(...s.payments.map(p => p.paymentId || p.id).filter(Boolean));
          if (s.lastPaymentId) checks.push(s.lastPaymentId);
          if (s.paymentId) checks.push(s.paymentId);
          return checks.some(c => c && String(c) === String(payment.paymentId));
        });
        if (byPayRef && (byPayRef.name || byPayRef.studentName)) return byPayRef.name || byPayRef.studentName;
      }
      // 6) fallbacks — rawRazorpay contact/email or payment.raw contact/email
      if (payment.rawRazorpay) {
        const rr = payment.rawRazorpay;
        if (rr.contact) return rr.contact;
        if (rr.email) return rr.email;
      }
      if (payment.raw) {
        const r = payment.raw;
        if (r.contact) return r.contact;
        if (r.email) return r.email;
      }
      // 7) any email/phone we have
      if (email) return email;
      if (phone) return phone;
      // last fallback: studentId or paymentId or generic label
      if (payment.studentId) return `Student (${payment.studentId})`;
      if (payment.paymentId) return `Student (${payment.paymentId})`;
      return "Student";
    };

    paymentsList.forEach((payment) => {
      // normalize a few keys to make downstream easier
      payment.studentId = payment.studentId || payment.student_id || payment.student || null;
      payment.paymentId = payment.paymentId || payment.id || null;

      // Some payments include a packages array (preferred). If present, expand each package into its own row.
      const packagesArray = Array.isArray(payment.packages) && payment.packages.length > 0 ? payment.packages : null;

      if (packagesArray) {
        packagesArray.forEach((pkgEntry, idx) => {
          // Resolve packageCost (prefer package-level fields)
          let packageCost = safeParseFloat(pkgEntry.packageCost ?? pkgEntry.price ?? pkgEntry.package_cost ?? 0);
          if (!packageCost || packageCost === 0) {
            packageCost = parseMoneyFromPayment(pkgEntry) || parseMoneyFromPayment(payment) || 0;
          }

          // Find master package doc to read commission percent if available
          let commissionPercent = 0;
          const pkgMaster = findPackageMasterCommissionLocal(pkgEntry.id ?? pkgEntry.packageId ?? pkgEntry.packageName, pkgEntry);
          if (pkgMaster) {
            commissionPercent = safeParseFloat(pkgMaster.commission ?? pkgMaster.promoterCommission ?? pkgMaster.commissionPercent ?? pkgMaster.commission_pct ?? 0);
          }

          // fallback to fields on packageEntry or payment
          if ((!commissionPercent || commissionPercent === 0)) {
            commissionPercent = safeParseFloat(pkgEntry.commission ?? pkgEntry.promoterCommission ?? pkgEntry.commissionPercent ?? pkgEntry.commission_pct ?? payment.commissionPercent ?? payment.commission ?? payment.promoterCommission ?? 0);
          }

          commissionPercent = isFinite(Number(commissionPercent)) ? Number(commissionPercent) : 0;

          // explicit commission amount if present
          let explicitCommissionAmount = safeParseFloat(pkgEntry.commissionAmount ?? pkgEntry.commission_total ?? pkgEntry.commissionTotal ?? payment.commissionAmount ?? payment.commission_total ?? payment.commissionTotal ?? 0);

          // If explicit looks like paise while packageCost is small, convert
          if (explicitCommissionAmount > 0 && explicitCommissionAmount >= 100 && packageCost < 100) {
            explicitCommissionAmount = explicitCommissionAmount / 100;
          }

          let commissionAmount = 0;
          if (explicitCommissionAmount > 0) {
            commissionAmount = explicitCommissionAmount;
          } else if (isFinite(packageCost) && commissionPercent > 0) {
            commissionAmount = (Number(packageCost) * Number(commissionPercent)) / 100;
          } else {
            // final fallback: try to infer commissionPercent from global package master using only packageCost
            if ((!commissionAmount || commissionAmount === 0) && packageCost > 0) {
              const masterByCost = findPackageMasterCommissionLocal(null, { packageCost });
              if (masterByCost) {
                const mp = safeParseFloat(masterByCost.commission ?? masterByCost.promoterCommission ?? masterByCost.commissionPercent ?? masterByCost.commission_pct ?? 0);
                if (mp > 0) {
                  commissionAmount = (Number(packageCost) * Number(mp)) / 100;
                  commissionPercent = Number(mp);
                }
              }
            }
          }

          commissionAmount = Math.round((Number(commissionAmount) + Number.EPSILON) * 100) / 100;

          // NEW: resolve name robustly
          const displayName = findStudentName(payment);

          rows.push({
            name: displayName || `Student (${payment.studentId || "?"})`,
            studentId: payment.studentId || payment.student_id || null,
            packageName: pkgEntry.packageName || pkgEntry.concept || pkgEntry.package || payment.packageName || `package-${idx + 1}`,
            packageCost: Number(packageCost || 0),
            commissionPercent: Number(commissionPercent || 0),
            commissionAmount: Number(commissionAmount || 0),
            commissionPaid: !!(
              pkgEntry.promoterPaid === true ||
              pkgEntry.commissionPaid === true ||
              payment.promoterPaid === true ||
              payment.commissionPaid === true ||
              payment.adminMarked === true ||
              (String(payment.status || payment.paymentStatus || payment.settlementStatus || "").toLowerCase() === "settled")
            ),
            createdAt: toDate(payment.createdAt || payment.paidAt || payment.paymentDate) || new Date(),
            paymentId: payment.paymentId || payment.id,
            receiptUrl: payment.receiptUrl || (payment.rawRazorpay && payment.rawRazorpay.short_url) || null,
            paymentStatus: payment.status || payment.settlementStatus || payment.paymentStatus || "pending",
            raw: { payment, package: pkgEntry },
          });
        });
      } else {
        // Single-package style payment doc (no packages array)
        const pkgEntry = payment;
        let packageCost = safeParseFloat(pkgEntry.packageCost ?? pkgEntry.price ?? pkgEntry.package_cost ?? 0);
        if (!packageCost || packageCost === 0) {
          packageCost = parseMoneyFromPayment(pkgEntry) || 0;
        }

        // master lookup
        let commissionPercent = 0;
        const pkgMaster = findPackageMasterCommissionLocal(payment.packageId ?? payment.packageIdString ?? payment.packageName ?? payment.package);
        if (pkgMaster) {
          commissionPercent = safeParseFloat(pkgMaster.commission ?? pkgMaster.promoterCommission ?? pkgMaster.commissionPercent ?? pkgMaster.commission_pct ?? 0);
        }

        if ((!commissionPercent || commissionPercent === 0)) {
          commissionPercent = safeParseFloat(payment.commission ?? payment.commissionPercent ?? payment.promoterCommission ?? payment.promoterCommissionPercent ?? 0);
        }

        commissionPercent = isFinite(Number(commissionPercent)) ? Number(commissionPercent) : 0;

        let explicitCommissionAmount = safeParseFloat(payment.commissionAmount ?? payment.commission_total ?? payment.commissionTotal ?? 0);
        if (explicitCommissionAmount > 0 && explicitCommissionAmount >= 100 && packageCost < 100) {
          explicitCommissionAmount = explicitCommissionAmount / 100;
        }

        let commissionAmount = 0;
        if (explicitCommissionAmount > 0) {
          commissionAmount = explicitCommissionAmount;
        } else if (isFinite(packageCost) && commissionPercent > 0) {
          commissionAmount = (Number(packageCost) * Number(commissionPercent)) / 100;
        } else {
          // fallback: try to infer from master by cost
          if ((!commissionAmount || commissionAmount === 0) && packageCost > 0) {
            const masterByCost = findPackageMasterCommissionLocal(null, { packageCost });
            if (masterByCost) {
              const mp = safeParseFloat(masterByCost.commission ?? masterByCost.promoterCommission ?? masterByCost.commissionPercent ?? masterByCost.commission_pct ?? 0);
              if (mp > 0) {
                commissionAmount = (Number(packageCost) * Number(mp)) / 100;
                commissionPercent = Number(mp);
              }
            }
          }
        }

        commissionAmount = Math.round((Number(commissionAmount) + Number.EPSILON) * 100) / 100;

        // NEW: resolve name robustly
        const displayName = findStudentName(payment);

        rows.push({
          name: displayName || `Student (${payment.studentId || "?"})`,
          studentId: payment.studentId || payment.student_id || null,
          packageName: payment.packageName || payment.package || "-",
          packageCost: Number(packageCost || 0),
          commissionPercent: Number(commissionPercent || 0),
          commissionAmount: Number(commissionAmount || 0),
          commissionPaid: !!(
            payment.promoterPaid === true ||
            payment.commissionPaid === true ||
            payment.adminMarked === true ||
            (String(payment.status || payment.paymentStatus || payment.settlementStatus || "").toLowerCase() === "settled")
          ),
          createdAt: toDate(payment.createdAt || payment.paidAt || payment.paymentDate) || new Date(),
          paymentId: payment.paymentId || payment.id,
          receiptUrl: payment.receiptUrl || (payment.rawRazorpay && payment.rawRazorpay.short_url) || null,
          paymentStatus: payment.status || payment.settlementStatus || payment.paymentStatus || "pending",
          raw: payment,
        });
      }
    });

    return rows;
  }

  // Build rows from student docs fallback
  function buildRowsFromStudents(finalStudents) {
    const rows = [];
    finalStudents.forEach((s) => {
      const cost = safeParseFloat(s.paidAmount || s.packageCost || s.amount || 0) || 0;
      const perc = safeParseFloat(s.promoterCommission || s.promoterCommissionPercent || s.commissionPercent || 0) || 0;
      const createdAtDate = toDate(s.createdAt) || new Date();
      const commAmt = Math.round(((Number(cost) * Number(perc)) / 100 + Number.EPSILON) * 100) / 100;
      rows.push({
        name: s.name,
        studentId: s.id,
        packageName: s.packageName || "-",
        packageCost: Number(cost || 0),
        commissionPercent: Number(perc || 0),
        commissionAmount: Number(commAmt || 0),
        commissionPaid: !!s.promoterPaid,
        createdAt: createdAtDate,
        paymentId: s.paymentId || "-",
        receiptUrl: s.lastReceiptUrl || null,
        paymentStatus: s.promoterPaid ? "paid" : "pending",
        raw: s,
      });
    });
    return rows;
  }

  // Enhanced: Fetch names for payments by checking users, studentDatabase, and by email/paymentId
  async function fetchStudentNamesForPayments(paymentsList) {
    const missingPayments = paymentsList.filter((p) => (!p.studentName || p.studentName === null || p.studentName === ""));
    const missingIds = Array.from(new Set(missingPayments.map((p) => p.studentId).filter(Boolean)));
    const idToName = {};

    // 1) try users/{id}
    await Promise.all(missingIds.map(async (id) => {
      try {
        const uDoc = await getDoc(doc(db, "users", id));
        if (uDoc.exists()) {
          const u = uDoc.data() || {};
          idToName[id] = u.name || u.displayName || u.email || u.phone || null;
        } else {
          idToName[id] = null;
        }
      } catch (e) {
        idToName[id] = null;
      }
    }));

    // 2) for remaining ids not resolved, try studentDatabase/{id}
    const unresolvedIds = missingIds.filter((id) => !idToName[id]);
    if (unresolvedIds.length > 0) {
      await Promise.all(unresolvedIds.map(async (id) => {
        try {
          const sdDoc = await getDoc(doc(db, "studentDatabase", id));
          if (sdDoc.exists()) {
            const sd = sdDoc.data() || {};
            idToName[id] = sd.name || sd.studentName || sd.email || null;
          }
        } catch (e) {
          // ignore
        }
      }));
    }

    // 3) For payments where studentId wasn't helpful, try matching by email or phone across users and studentDatabase
    const emailToResolve = {};
    const phoneToResolve = {};
    paymentsList.forEach((p) => {
      const e = p.email || p.studentEmail || (p.rawRazorpay && p.rawRazorpay.email) || (p.raw && p.raw.email) || null;
      const ph = p.phone || p.studentPhone || (p.rawRazorpay && p.rawRazorpay.contact) || (p.raw && p.raw.contact) || null;
      if (e) emailToResolve[e] = emailToResolve[e] || [];
      if (e && p.studentId) emailToResolve[e].push(p.studentId);
      if (ph) phoneToResolve[ph] = phoneToResolve[ph] || [];
      if (ph && p.studentId) phoneToResolve[ph].push(p.studentId);
    });

    const unresolvedEmails = Object.keys(emailToResolve).filter((em) => em && !Object.values(idToName).includes(em));
    for (const em of unresolvedEmails) {
      try {
        const q = await getDocs(query(collection(db, "users"), where("email", "==", em)));
        if (!q.empty) {
          q.forEach((d) => {
            const ud = d.data() || {};
            const name = ud.name || ud.displayName || ud.email || null;
            (emailToResolve[em] || []).forEach((sid) => {
              if (!idToName[sid]) idToName[sid] = name;
            });
          });
        }
      } catch (e) { /* ignore */ }
    }

    for (const em of unresolvedEmails) {
      try {
        const q = await getDocs(query(collection(db, "studentDatabase"), where("email", "==", em)));
        if (!q.empty) {
          q.forEach((d) => {
            const sd = d.data() || {};
            const name = sd.name || sd.studentName || sd.email || null;
            (emailToResolve[em] || []).forEach((sid) => {
              if (!idToName[sid]) idToName[sid] = name;
            });
          });
        }
      } catch (e) { /* ignore */ }
    }

    const unresolvedPhones = Object.keys(phoneToResolve);
    for (const ph of unresolvedPhones) {
      try {
        const q = await getDocs(query(collection(db, "users"), where("phone", "==", ph)));
        if (!q.empty) {
          q.forEach((d) => {
            const ud = d.data() || {};
            const name = ud.name || ud.displayName || ud.email || null;
            (phoneToResolve[ph] || []).forEach((sid) => {
              if (!idToName[sid]) idToName[sid] = name;
            });
          });
        }
      } catch (e) { /* ignore */ }
    }

    for (const ph of unresolvedPhones) {
      try {
        const q = await getDocs(query(collection(db, "studentDatabase"), where("phone", "==", ph)));
        if (!q.empty) {
          q.forEach((d) => {
            const sd = d.data() || {};
            const name = sd.name || sd.studentName || sd.email || null;
            (phoneToResolve[ph] || []).forEach((sid) => {
              if (!idToName[sid]) idToName[sid] = name;
            });
          });
        }
      } catch (e) { /* ignore */ }
    }

    // 4) final fallback: try to match payment by paymentId inside studentDatabase (some setups store a paymentsRef)
    await Promise.all(paymentsList.map(async (p) => {
      if ((!p.studentName || p.studentName === null || p.studentName === "") && p.paymentId) {
        try {
          const q = await getDocs(query(collection(db, "studentDatabase"), where("paymentId", "==", p.paymentId)));
          if (!q.empty) {
            const sd = q.docs[0].data() || {};
            if (p.studentId) idToName[p.studentId] = idToName[p.studentId] || (sd.name || sd.studentName || sd.email || null);
            else {
              idToName[`payment:${p.paymentId}`] = sd.name || sd.studentName || sd.email || null;
            }
          }
        } catch (e) { /* ignore */ }
      }
    }));

    // Where still unresolved, use rawRazorpay contact/email as best-effort
    paymentsList.forEach((p) => {
      if (p.studentId) {
        if (!idToName[p.studentId] || idToName[p.studentId] === null) {
          const rz = p.rawRazorpay || p.raw || {};
          const candidate = rz.contact || rz.email || p.email || p.studentEmail || null;
          if (candidate) idToName[p.studentId] = candidate;
        }
      }
    });

    // More informative unresolved logging
    const unresolved = missingPayments.filter((p) => {
      const n = p.studentId ? idToName[p.studentId] : idToName[`payment:${p.paymentId}`];
      return !n;
    });
    if (unresolved.length > 0) {
      console.info(
        "PromoterDashboard: unresolved payments (no student name found) — sample info:",
        unresolved.slice(0,5).map(p => ({
          paymentId: p.paymentId || p.id,
          studentId: p.studentId,
          rawContact: p.rawRazorpay?.contact || p.raw?.contact || null,
          rawEmail: p.rawRazorpay?.email || p.raw?.email || p.email || null,
        }))
      );
    }

    return idToName;
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

        const canonicalUniqueId =
          (pd.uniqueId && String(pd.uniqueId).trim()) ||
          (pd.uniqueID && String(pd.uniqueID).trim()) ||
          (pd.unique_id && String(pd.unique_id).trim()) ||
          null;
        const promoterDocId = promoterDocSnap.id;

        // ----- USE CALLABLE FUNCTION FIRST (students) -----
        let foundStudents = [];
        try {
          // specify region the function was deployed to
          const functions = getFunctions(undefined, "us-central1");
          const fn = httpsCallable(functions, "getPromoterStudents");
          const resp = await fn({ promoterUniqueId: canonicalUniqueId, promoterDocId });
          if (resp && resp.data && resp.data.success) {
            foundStudents = resp.data.students || [];
            console.info("getPromoterStudents (callable) returned", foundStudents.length, "students");
          }
        } catch (fnErr) {
          // callable may fail; fall back to client-side discovery
          console.info("getPromoterStudents callable failed — falling back to client-side discovery.");
        }

        if (foundStudents.length === 0) {
          const clientRes = await discoverStudentsClientSide({
            canonicalUniqueId,
            promoterDocId,
            uid,
          });
          if (clientRes.found && clientRes.found.length > 0) {
            foundStudents = clientRes.found;
            console.info("discoverStudentsClientSide found", foundStudents.length, "students");
          }
        }

        // dedupe students
        const dedup = {};
        foundStudents.forEach((s) => {
          dedup[s.id] = s;
        });
        const finalStudents = Object.values(dedup);
        setStudents(finalStudents);

        // --- payments (targeted queries only) ---
        const paymentsCol = collection(db, "payments");
        const paymentsDocsMap = {};
        const qList = [];

        // targeted promoter identity queries
        qList.push(query(paymentsCol, where("promoterUid", "==", uid)));
        qList.push(query(paymentsCol, where("promoterId", "==", promoterDocId)));
        qList.push(query(paymentsCol, where("promoter", "==", uid)));
        qList.push(query(paymentsCol, where("promoter_id", "==", promoterDocId)));

        // if canonicalUniqueId is present, attempt query by promoterUniqueId
        if (canonicalUniqueId) {
          qList.push(query(paymentsCol, where("promoterUniqueId", "==", canonicalUniqueId)));
        }

        // studentId batched 'in' queries (safe if allowed by rules)
        const studentIds = finalStudents.map((s) => s.id).filter(Boolean);
        for (let i = 0; i < studentIds.length; i += 10) {
          const batch = studentIds.slice(i, i + 10);
          if (batch.length === 0) continue;
          qList.push(query(paymentsCol, where("studentId", "in", batch)));
        }

        let targetedFailed = false;
        try {
          const qResults = await Promise.all(qList.map((q) => getDocs(q)));
          qResults.forEach((snap) => {
            if (!snap || !snap.docs) return;
            snap.docs.forEach((d) => {
              paymentsDocsMap[d.id] = { id: d.id, ...d.data() };
            });
          });
          setPermissionBlocked(false);
        } catch (err) {
          // single concise message instead of repeated noisy warnings
          console.info("Client payments read blocked by Firestore rules; falling back to server callable.");
          targetedFailed = true;
          setPermissionBlocked(true);
        }

        // If targeted queries returned results, use them.
        let paymentsList = Object.values(paymentsDocsMap);

        // If targetedFailed or no payments returned, try a secure callable to get payments (server side)
        if ((paymentsList.length === 0 || targetedFailed)) {
          try {
            const functions = getFunctions(undefined, "us-central1");
            const fn = httpsCallable(functions, "getPromoterPayments");
            const resp = await fn({ promoterUniqueId: canonicalUniqueId, promoterDocId });
            if (resp && resp.data && resp.data.success) {
              paymentsList = resp.data.payments || [];
              setPermissionBlocked(false);
              console.info("getPromoterPayments (callable) returned", paymentsList.length, "payments");
            } else {
              console.info("getPromoterPayments returned no success flag", resp);
            }
          } catch (fnErr) {
            console.info("getPromoterPayments callable failed or unavailable.");
          }
        }

        // --- NEW: eager user lookup for student names when payments are present ---
        if (paymentsList.length > 0) {
          try {
            // collect studentIds present in payments
            const paymentStudentIds = Array.from(new Set(paymentsList.map((p) => p.studentId).filter(Boolean)));
            if (paymentStudentIds.length > 0) {
              const usersMap = await fetchUsersByIds(paymentStudentIds);
              // apply names where available
              paymentsList = paymentsList.map((p) => {
                if ((!p.studentName || p.studentName === null || p.studentName === "") && p.studentId && usersMap[p.studentId]) {
                  p.studentName = usersMap[p.studentId].name || usersMap[p.studentId].email || usersMap[p.studentId].phone || "";
                }
                // normalize packageCost if missing
                if ((p.packageCost === undefined || p.packageCost === null || p.packageCost === 0)) {
                  p.packageCost = parseMoneyFromPayment(p);
                }
                return p;
              });
            }
          } catch (e) {
            // swallow — not fatal
            console.warn("User batch lookup failed:", e);
          }
        }

        // If payment list has entries missing studentName, try to resolve them via existing fallback resolver
        if (paymentsList.length > 0) {
          const paymentsMissingName = paymentsList.filter((p) => !p.studentName || p.studentName === "");
          if (paymentsMissingName.length > 0) {
            const idToName = await fetchStudentNamesForPayments(paymentsList);
            paymentsList = paymentsList.map((p) => {
              p.studentId = p.studentId || p.student_id || p.student || null;
              p.paymentId = p.paymentId || p.id || null;

              if ((!p.studentName || p.studentName === null || p.studentName === "")) {
                const resolved = (p.studentId && idToName[p.studentId]) || idToName[`payment:${p.paymentId}`];
                const fallbackFromRazor = (p.rawRazorpay && (p.rawRazorpay.contact || p.rawRazorpay.email)) || null;
                const fallbackEmail = p.email || p.studentEmail || (p.raw && p.raw.email) || null;
                const fallbackPhone = p.phone || p.studentPhone || (p.raw && p.raw.contact) || null;
                p.studentName = resolved || fallbackFromRazor || fallbackEmail || fallbackPhone || p.studentName || "";
              }

              // normalize packageCost if missing
              if ((p.packageCost === undefined || p.packageCost === null || p.packageCost === 0) ) {
                p.packageCost = parseMoneyFromPayment(p);
              }

              return p;
            });
          }
        }

        // Quick check: log any payment where studentName not resolved OR commission anomalies
        if (paymentsList.length > 0) {
          const suspicious = paymentsList.filter((p) => {
            const hasExplicitComm = safeParseFloat(p.commissionAmount || p.commissionTotal || p.commission_total || 0);
            const commVal = safeParseFloat(p.commissionAmount || p.commissionTotal || p.commission_total || 0);
            const pkg = parseMoneyFromPayment(p);
            return ((!p.studentName || p.studentName === "") || (Number(commVal || 0) === 0 && Number(hasExplicitComm || 0) > 0) || (Number(commVal || 0) === 0 && pkg > 0 && Number(p.commissionPercent || p.commission_pct || 0) > 0));
          });

          if (suspicious.length > 0) {
            console.info("PromoterDashboard: some payments still need attention; sample info:", suspicious.slice(0,5).map((x) => ({
              paymentId: x.paymentId || x.id,
              studentId: x.studentId,
              studentName: x.studentName,
              pkgCost: x.packageCost || parseMoneyFromPayment(x),
              commissionAmount: x.commissionAmount || x.commissionTotal || x.commission_total || 0,
              rawContact: x.rawRazorpay?.contact || x.raw?.contact || null,
              rawEmail: x.rawRazorpay?.email || x.raw?.email || x.email || null,
            })));
          }
        }

        // If we still have no payments (callable failed or not present), derive from students
        let rows = [];
        if (paymentsList.length > 0) {
          rows = buildRowsFromPayments(paymentsList, finalStudents, packages);
        } else {
          // fallback: build rows from student docs
          rows = buildRowsFromStudents(finalStudents);
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

  // save payout click handler (client-only stub)
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
    alert("Payout saved (client-side). Implement server update to persist.");
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
      acc.total += isFinite(amount) ? amount : 0;
      if (!r.commissionPaid) acc.pending += isFinite(amount) ? amount : 0;
      return acc;
    },
    { total: 0, pending: 0 }
  );

  // safe presentation helpers for JSX
  const renderDate = (value) => {
    const d = toDate(value);
    return d ? d.toLocaleString() : "—";
  };

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
          {/* permission banner */}
          {permissionBlocked && (
            <div style={{ background: "#ffefef", color: "#7b1d1d", padding: 12, borderRadius: 8, marginBottom: 12 }}>
              <strong>Notice:</strong> Direct reads on the `payments` collection are blocked by Firestore rules for your account.
              The dashboard tried targeted queries but lacked permissions. Ask your admin to either:
              <ul style={{ marginTop: 8 }}>
                <li>Allow targeted promoter reads in rules for payment docs, or</li>
                <li>Provide a secure Cloud Function `getPromoterPayments` that returns payments for the promoter (recommended).</li>
              </ul>
              Meanwhile, the dashboard uses safe fallbacks to show commission (derived from student records or server function if available).
            </div>
          )}

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
                  <p style={{ margin: 6 }}><b>Last Payment:</b> {renderDate(promoter?.lastPayment)}</p>
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
                        <td style={styles.td}>₹{(Number(s.commissionEarned || s.promoterCommission || 0)).toFixed(2)}</td>
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
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
                  <thead>
                    <tr style={{ background: "#f3f4f6" }}>
                      <th style={styles.th}>Student</th>
                      <th style={styles.th}>Student ID</th>
                      <th style={styles.th}>Payment ID</th>
                      <th style={styles.th}>Package</th>
                      <th style={styles.th}>Cost (₹)</th>
                      <th style={styles.th}>Commission %</th>
                      <th style={styles.th}>Commission (₹)</th>
                      <th style={styles.th}>Status</th>
                      <th style={styles.th}>Receipt</th>
                      <th style={styles.th}>Pay Cycle (Date)</th>
                      <th style={styles.th}>Raw</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commissionRows.length === 0 ? (
                      <tr><td colSpan={11} style={{ textAlign: "center", padding: 14 }}>No commission records</td></tr>
                    ) : commissionRows.map((r, i) => {
                      const cost = Number(r.packageCost || 0);
                      const perc = Number(r.commissionPercent || 0);
                      const commissionAmount = Number(r.commissionAmount || (isFinite(cost) ? (cost * perc) / 100 : 0));
                      const cycle = getNextPaymentCycleForDate(r.createdAt || new Date().toISOString());
                      return (
                        <React.Fragment key={i}>
                          <tr>
                            <td style={styles.td}>{r.name || "—"}</td>
                            <td style={styles.td}>{r.studentId || "—"}</td>
                            <td style={styles.td}>{r.paymentId || "—"}</td>
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
                            <td style={styles.td}>{cycle ? (cycle instanceof Date ? cycle.toLocaleDateString() : new Date(cycle).toLocaleDateString()) : "—"}</td>
                            <td style={styles.td}>
                              <button
                                style={styles.smallBtn}
                                onClick={() => setOpenRawPaymentId(openRawPaymentId === r.paymentId ? null : r.paymentId)}
                              >
                                {openRawPaymentId === r.paymentId ? "Hide" : "Show"}
                              </button>
                            </td>
                          </tr>
                          {openRawPaymentId === r.paymentId && (
                            <tr>
                              <td colSpan={11}>
                                <div style={styles.rawBox}>
                                  {JSON.stringify(r.raw || { paymentId: r.paymentId }, null, 2)}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
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
                      <div style={{ marginTop: 8 }}><small style={{ color: "#6b7280" }}>Linked at: {renderDate(promoter.bankDetails.linkedAt)}</small></div>
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
