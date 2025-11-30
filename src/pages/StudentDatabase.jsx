// src/pages/StudentDatabase.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { db } from "../firebase/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

/**
 * StudentDatabase.jsx
 * - Students view shows basic student rows; click View Purchases to expand purchases (package, cost, discount, paid)
 * - Transactions view shows one row per package (or one row for payment if no packages) and includes Paid column
 * - Improved discount parsing:
 *   - handles percent strings ("10%"), numeric percent strings ("5"), numeric percent numbers (5)
 *   - combines package.master regularDiscount + additionalDiscount (percent or rupee)
 *   - shows discount breakdown in UI (e.g. "regular 5% + additional 2%")
 * - Safer paise <-> rupee heuristics to avoid misinterpreting package price strings like "15000"
 */

export default function StudentDatabase() {
  const [studentsRaw, setStudentsRaw] = useState([]);
  const [paymentsRaw, setPaymentsRaw] = useState([]);
  const [packagesRaw, setPackagesRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState("students");

  // Filters
  const [filterClass, setFilterClass] = useState("");
  const [filterSyllabus, setFilterSyllabus] = useState("");
  const [filterPackageName, setFilterPackageName] = useState("");
  const [filterPaymentStatus, setFilterPaymentStatus] = useState("");
  const [filterPromoterId, setFilterPromoterId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [hideIrrelevant, setHideIrrelevant] = useState(true);

  // Date
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // which student is expanded in Students view
  const [expandedStudentId, setExpandedStudentId] = useState(null);

  const setPresetToday = () => {
    const t = new Date();
    const s = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const e = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 59);
    setStartDate(s.toISOString().slice(0, 10));
    setEndDate(e.toISOString().slice(0, 10));
  };

  const setPresetThisMonth = () => {
    const t = new Date();
    const s = new Date(t.getFullYear(), t.getMonth(), 1);
    const e = new Date(t.getFullYear(), t.getMonth() + 1, 0);
    setStartDate(s.toISOString().slice(0, 10));
    setEndDate(e.toISOString().slice(0, 10));
  };

  const setPresetThisYear = () => {
    const t = new Date();
    const s = new Date(t.getFullYear(), 0, 1);
    const e = new Date(t.getFullYear(), 11, 31);
    setStartDate(s.toISOString().slice(0, 10));
    setEndDate(e.toISOString().slice(0, 10));
  };

  const clearDateFilters = () => {
    setStartDate("");
    setEndDate("");
  };

  // -------------------------
  // Helpers (stable)
  // -------------------------
  // Conservative paise -> rupee converter:
  // - short integer strings (<=5 digits) treated as rupees (e.g. "15000" -> ₹15,000)
  // - long integers divisible by 100 or very large treated as paise and divided by 100
  // - strings with "%" are recognized as percents by other helpers
  const guessIfPaiseAndConvert = useCallback((value) => {
    if (value === null || typeof value === "undefined" || value === "") return 0;

    if (typeof value === "string") {
      const s = value.trim();
      if (!s) return 0;

      if (s.endsWith("%")) {
        const num = Number(s.replace(/%/g, ""));
        return isNaN(num) ? 0 : num; // percent; callers decide how to use it
      }

      const cleaned = s.replace(/,/g, "");
      if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
        if (cleaned.includes(".")) {
          const parsed = Number(cleaned);
          return isNaN(parsed) ? 0 : Number(parsed.toFixed(2));
        }
        // integer-like string
        if (cleaned.length <= 5) {
          const parsed = Number(cleaned);
          return isNaN(parsed) ? 0 : Number(parsed.toFixed(2));
        }
        const parsed = Number(cleaned);
        if (!isNaN(parsed)) {
          if (Number.isInteger(parsed) && parsed % 100 === 0) {
            return Number((parsed / 100).toFixed(2));
          }
          if (parsed > 100000) {
            return Number((parsed / 100).toFixed(2));
          }
          return Number(parsed.toFixed(2));
        }
        return 0;
      }
      return 0;
    }

    const num = typeof value === "number" ? value : Number(value);
    if (isNaN(num)) return 0;
    if (Number.isInteger(num) && (num % 100 === 0 || num > 100000)) {
      return Number((num / 100).toFixed(2));
    }
    return Number(Number(num).toFixed(2));
  }, []);

  const resolveAmountRupees = useCallback(
    (p) => {
      if (!p) return 0;
      const fields = [
        p.amount,
        p.amount_captured,
        p.amount_refunded,
        p.rawRazorpay?.amount,
        p.rawRazorpay?.entity?.amount,
        p.totalAmount,
        p.total_amount,
        p.paidAmount,
        p.paymentAmount,
      ];
      for (const v of fields) {
        if (v === null || typeof v === "undefined") continue;
        const rupees = guessIfPaiseAndConvert(v);
        if (rupees && rupees > 0) return rupees;
      }
      // as final fallback, try summing package-level paid values
      if (Array.isArray(p.packages) && p.packages.length) {
        const sum = p.packages.reduce((s, pp) => {
          const cand = pp.paidPrice ?? pp.paidAmount ?? pp.totalPayable ?? pp.price ?? pp.amount ?? 0;
          const val = guessIfPaiseAndConvert(cand);
          return s + (val || 0);
        }, 0);
        if (sum > 0) return Number(sum.toFixed(2));
      }
      return 0;
    },
    [guessIfPaiseAndConvert]
  );

  const resolvePackageCostFromPaymentPackageItem = useCallback(
    (p, pp, pkgFromCollection) => {
      // priority:
      // 1) explicit pp.packageCost / pp.price / pp.packagePrice / pp.amount / pp.cost / pp.mrp
      // 2) pkgFromCollection.packageCost / price / mrp
      // 3) split payment total by count
      // 4) fallback to payment-level amount
      if (pp) {
        const cand = pp.packageCost ?? pp.price ?? pp.packagePrice ?? pp.amount ?? pp.cost ?? pp.mrp ?? pp.totalPayable;
        if (typeof cand !== "undefined" && cand !== null && cand !== "") {
          const v = guessIfPaiseAndConvert(cand);
          if (v > 0) return v;
        }
      }
      if (pkgFromCollection) {
        const cand2 = pkgFromCollection.packageCost ?? pkgFromCollection.price ?? pkgFromCollection.packagePrice ?? pkgFromCollection.mrp;
        if (typeof cand2 !== "undefined" && cand2 !== null && cand2 !== "") {
          const v2 = guessIfPaiseAndConvert(cand2);
          if (v2 > 0) return v2;
        }
      }
      // if payment exists, split by number of packages
      const basePaymentAmount = resolveAmountRupees(p);
      if (Array.isArray(p.packages) && p.packages.length) {
        const num = p.packages.length;
        if (num > 0) {
          return Number((basePaymentAmount / num).toFixed(2));
        }
      }
      // last resort
      return basePaymentAmount;
    },
    [guessIfPaiseAndConvert, resolveAmountRupees]
  );

  // Returns per-package paid amount (prefer explicit paid fields)
  const resolvePaidForPackageItem = useCallback(
    (p, pp) => {
      // prefer explicit per-package paid values
      if (pp) {
        const explicitCandidates = [pp.paidPrice, pp.paidAmount, pp.totalPayable, pp.amount, pp.price];
        for (const c of explicitCandidates) {
          if (typeof c !== "undefined" && c !== null && c !== "") {
            const v = guessIfPaiseAndConvert(c);
            if (v > 0) return v;
          }
        }
      }
      // fallback: try top-level payment declared paid amount divided across packages (if multiple)
      const topPaid = resolveAmountRupees(p);
      if (Array.isArray(p.packages) && p.packages.length) {
        const per = Number((topPaid / p.packages.length).toFixed(2));
        if (per > 0) return per;
      }
      return topPaid;
    },
    [guessIfPaiseAndConvert, resolveAmountRupees]
  );

  // returns a rupee amount (number) - previous behavior
  const resolveDiscountFromPackageOrPayment = useCallback(
    (p, pp, pkgFromCollection) => {
      const candList = [
        pp?.discount,
        pp?.discountAmount,
        pp?.discount_amount,
        p?.discount,
        p?.discountAmount,
        p?.discount_amount,
        pkgFromCollection?.discount,
        pkgFromCollection?.discountAmount,
        pkgFromCollection?.discount_percent,
        pp?.discountPercent,
        pp?.discount_percent,
      ];

      for (const c of candList) {
        if (typeof c === "undefined" || c === null || c === "") continue;

        if (typeof c === "string" && c.trim().endsWith("%")) {
          const pct = Number(c.replace(/%/g, ""));
          if (!isNaN(pct) && pct > 0 && pct <= 100) {
            const base = pp?.packageCost ? guessIfPaiseAndConvert(pp.packageCost) : resolveAmountRupees(p);
            return Number(((base * pct) / 100).toFixed(2));
          }
          continue;
        }

        if (typeof c === "number" && c > 0 && c <= 100) {
          const base = pp?.packageCost ? guessIfPaiseAndConvert(pp.packageCost) : resolveAmountRupees(p);
          return Number(((base * c) / 100).toFixed(2));
        }

        if (typeof c === "string" && /^-?\d+(\.\d+)?$/.test(c.trim())) {
          const num = Number(c.trim());
          if (!isNaN(num) && num > 0 && num <= 100) {
            const base = pp?.packageCost ? guessIfPaiseAndConvert(pp.packageCost) : resolveAmountRupees(p);
            return Number(((base * num) / 100).toFixed(2));
          }
        }

        const v = guessIfPaiseAndConvert(c);
        if (v > 0) return v;
      }

      if (pkgFromCollection) {
        const mrp = guessIfPaiseAndConvert(pkgFromCollection.mrp || 0);
        const price = guessIfPaiseAndConvert(pkgFromCollection.price || pkgFromCollection.packageCost || pkgFromCollection.packagePrice || 0);
        const diff = mrp - price;
        if (diff > 0) return Number(diff.toFixed(2));
      }

      return 0;
    },
    [guessIfPaiseAndConvert, resolveAmountRupees]
  );

  // New: compute discount amount + breakdown string combining regular + additional discounts from package master
  const computeDiscountWithBreakdown = useCallback(
    (p, pp, pkgFromCollection) => {
      // base price for percent calculations
      const base = pp?.packageCost ? guessIfPaiseAndConvert(pp.packageCost) : resolveAmountRupees(p);

      // explicit discounts first (from payment or package item)
      const explicitAmount = resolveDiscountFromPackageOrPayment(p, pp, pkgFromCollection);

      const breakdownParts = [];

      // parse package master regular/additional if present
      if (pkgFromCollection) {
        const reg = pkgFromCollection.regularDiscount ?? pkgFromCollection.regular_discount ?? pkgFromCollection.regular;
        const add = pkgFromCollection.additionalDiscount ?? pkgFromCollection.additional_discount ?? pkgFromCollection.additional;

        const parseDiscountField = (val, label) => {
          if (val === undefined || val === null || val === "") return null;

          if (typeof val === "string" && val.trim().endsWith("%")) {
            const pct = Number(val.replace(/%/g, "").trim());
            if (!isNaN(pct)) {
              const amt = Number(((base * pct) / 100).toFixed(2));
              return { amt, desc: `${label} ${pct}%` };
            }
            return null;
          }

          if (typeof val === "string" && /^-?\d+(\.\d+)?$/.test(val.trim())) {
            const num = Number(val.trim());
            if (!isNaN(num)) {
              if (num > 0 && num <= 100) {
                const amt = Number(((base * num) / 100).toFixed(2));
                return { amt, desc: `${label} ${num}%` };
              }
              const amt = guessIfPaiseAndConvert(num);
              return { amt, desc: `${label} ₹${amt}` };
            }
            return null;
          }

          if (typeof val === "number") {
            if (val > 0 && val <= 100) {
              const amt = Number(((base * val) / 100).toFixed(2));
              return { amt, desc: `${label} ${val}%` };
            }
            const amt = guessIfPaiseAndConvert(val);
            return { amt, desc: `${label} ₹${amt}` };
          }

          const amt = guessIfPaiseAndConvert(val);
          return { amt, desc: `${label} ₹${amt}` };
        };

        const r = parseDiscountField(reg, "regular");
        const a = parseDiscountField(add, "additional");
        if (r && r.amt > 0) breakdownParts.push(r.desc);
        if (a && a.amt > 0) breakdownParts.push(a.desc);
      }

      // include payment-level/package-item discount fields if present
      const specialCandidates = [
        { val: pp?.discount ?? pp?.discountAmount ?? pp?.discount_amount, label: "pkg.item" },
        { val: p?.discount ?? p?.discountAmount ?? p?.discount_amount, label: "payment" },
      ];
      specialCandidates.forEach(({ val, label }) => {
        if (typeof val === "undefined" || val === null || val === "") return;
        if (typeof val === "string" && val.trim().endsWith("%")) {
          const pct = Number(val.replace(/%/g, ""));
          if (!isNaN(pct) && pct > 0 && pct <= 100) {
            const desc = `${label} ${pct}%`;
            if (!breakdownParts.includes(desc)) breakdownParts.push(desc);
          }
        } else if (typeof val === "string" && /^-?\d+(\.\d+)?$/.test(val.trim())) {
          const num = Number(val.trim());
          if (!isNaN(num) && num > 0 && num <= 100) {
            const desc = `${label} ${num}%`;
            if (!breakdownParts.includes(desc)) breakdownParts.push(desc);
          } else {
            const rupee = guessIfPaiseAndConvert(num);
            const desc = `${label} ₹${rupee}`;
            if (!breakdownParts.includes(desc)) breakdownParts.push(desc);
          }
        } else if (typeof val === "number") {
          if (val > 0 && val <= 100) {
            const desc = `${label} ${val}%`;
            if (!breakdownParts.includes(desc)) breakdownParts.push(desc);
          } else {
            const rupee = guessIfPaiseAndConvert(val);
            const desc = `${label} ₹${rupee}`;
            if (!breakdownParts.includes(desc)) breakdownParts.push(desc);
          }
        } else {
          const rupee = guessIfPaiseAndConvert(val);
          if (rupee > 0) {
            const desc = `${label} ₹${rupee}`;
            if (!breakdownParts.includes(desc)) breakdownParts.push(desc);
          }
        }
      });

      // If explicit amount exists, use it; otherwise infer from breakdown parts if possible
      let amount = Number((explicitAmount || 0).toFixed(2));
      if ((!amount || amount === 0) && breakdownParts.length === 0 && pkgFromCollection) {
        // maybe package master has MRP/price diff
        const mrp = guessIfPaiseAndConvert(pkgFromCollection.mrp || 0);
        const price = guessIfPaiseAndConvert(pkgFromCollection.price || pkgFromCollection.packageCost || pkgFromCollection.packagePrice || 0);
        const diff = mrp - price;
        if (diff > 0) {
          amount = Number(diff.toFixed(2));
          breakdownParts.push("mrp-price diff");
        }
      }

      const breakdown = breakdownParts.length ? breakdownParts.join(" + ") : "";
      return { amount, breakdown };
    },
    [guessIfPaiseAndConvert, resolveAmountRupees, resolveDiscountFromPackageOrPayment]
  );

  // -------------------------
  // Fetch data
  // -------------------------
  useEffect(() => {
    let mounted = true;
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [usersSnap, paymentsSnap, packagesSnap] = await Promise.all([
          getDocs(collection(db, "users")),
          getDocs(collection(db, "payments")),
          getDocs(collection(db, "packages")),
        ]);

        const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const payments = paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const packages = packagesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        if (!mounted) return;

        setPaymentsRaw(payments);
        setPackagesRaw(packages);

        const packageMap = {};
        packages.forEach((pkg) => {
          if (pkg.id) packageMap[pkg.id] = pkg;
          if (pkg.packageId) packageMap[pkg.packageId] = pkg;
          if (pkg.name && pkg.name !== pkg.id) packageMap[pkg.name] = pkg;
        });

        const paymentsByUser = {};
        payments.forEach((p) => {
          const uid =
            p.userId ||
            p.uid ||
            p.studentId ||
            p.customerId ||
            p.payerId ||
            p.student ||
            p.student_uid;
          if (!uid) return;
          if (!paymentsByUser[uid]) paymentsByUser[uid] = [];
          paymentsByUser[uid].push(p);
        });

        const mergedUsers = users.map((u) => {
          const promoterId = u.promoterId || u.referralId || u.referralCode || u.referral || null;

          let userPayments = paymentsByUser[u.uid || u.id || u.uniqueId || u.userId] || [];

          if (!userPayments.length) {
            const fallback = payments.filter(
              (p) =>
                (p.email && u.email && p.email.toLowerCase() === (u.email || "").toLowerCase()) ||
                (p.phone && u.phone && String(p.phone) === String(u.phone))
            );
            if (fallback.length) userPayments = fallback;
          }

          const paymentsSorted = [...userPayments].sort((a, b) => {
            const ta =
              (a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || a.paymentDate || a.paidAt || 0).getTime()) || 0;
            const tb =
              (b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || b.paymentDate || b.paidAt || 0).getTime()) || 0;
            return tb - ta;
          });

          const paidSum = paymentsSorted.reduce((acc, p) => acc + resolveAmountRupees(p), 0);
          const lastPayment = paymentsSorted[0] || null;

          // determine displayed actual/discount using lastPayment or user fields
          let actualForRow = 0;
          let discountForRow = 0;

          if (u.actualCost || u.packageCost || u.packagePrice) {
            actualForRow = guessIfPaiseAndConvert(u.actualCost ?? u.packageCost ?? u.packagePrice);
          }
          if (u.discount || u.discountAmount) {
            discountForRow = guessIfPaiseAndConvert(u.discount ?? u.discountAmount);
          }

          if ((!actualForRow || actualForRow === 0) && lastPayment) {
            if (Array.isArray(lastPayment.packages) && lastPayment.packages.length === 1) {
              const pp = lastPayment.packages[0];
              const pkgDoc = pp.packageId ? packageMap[pp.packageId] : null;
              actualForRow = resolvePackageCostFromPaymentPackageItem(lastPayment, pp, pkgDoc) || resolveAmountRupees(lastPayment);
              discountForRow = computeDiscountWithBreakdown(lastPayment, pp, pkgDoc).amount;
            } else if (Array.isArray(lastPayment.packages) && lastPayment.packages.length > 1) {
              const sum = lastPayment.packages.reduce((acc, pp) => {
                const pkgDoc = pp.packageId ? packageMap[pp.packageId] : null;
                const v = resolvePackageCostFromPaymentPackageItem(lastPayment, pp, pkgDoc);
                return acc + (v || 0);
              }, 0);
              actualForRow = sum > 0 ? sum : resolveAmountRupees(lastPayment);
              discountForRow = lastPayment.packages.reduce((acc, pp) => {
                const pkgDoc = pp.packageId ? packageMap[pp.packageId] : null;
                return acc + computeDiscountWithBreakdown(lastPayment, pp, pkgDoc).amount;
              }, 0);
            } else {
              actualForRow = resolvePackageCostFromPaymentPackageItem(lastPayment, null, null) || resolveAmountRupees(lastPayment);
              discountForRow = computeDiscountWithBreakdown(lastPayment, null, null).amount;
            }
          }

          if ((!actualForRow || actualForRow === 0) && (u.packageId || u.package)) {
            const pkgId = u.packageId || u.package;
            if (packageMap[pkgId]) {
              actualForRow = guessIfPaiseAndConvert(packageMap[pkgId].packageCost || packageMap[pkgId].price || packageMap[pkgId].packagePrice || 0);
              discountForRow = computeDiscountWithBreakdown(null, null, packageMap[pkgId]).amount;
            }
          }

          actualForRow = Number((actualForRow || 0).toFixed(2));
          discountForRow = Number((discountForRow || 0).toFixed(2));

          return {
            ...u,
            promoterId,
            _payments: paymentsSorted,
            _paidSum: Number(paidSum.toFixed(2)),
            _lastPayment: lastPayment,
            packageName: u.packageName || "",
            _actualRow: actualForRow,
            _discountRow: discountForRow,
            _paidDisplay: Number((u.paidAmount || paidSum || 0).toFixed(2)),
          };
        });

        setStudentsRaw(mergedUsers);
      } catch (err) {
        console.error("Fetch error:", err);
        if (mounted) {
          setStudentsRaw([]);
          setPaymentsRaw([]);
          setPackagesRaw([]);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchAll();
    return () => (mounted = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parseTS = (ts) => {
    if (!ts) return null;
    if (ts.toDate) return ts.toDate();
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  };

  const formatCurrency = (a) => (a === undefined || a === null || isNaN(a) ? "₹0" : `₹${Number(a).toLocaleString("en-IN")}`);

  const classesOptions = useMemo(() => {
    const s = new Set();
    studentsRaw.forEach((u) => u.classGrade && s.add(u.classGrade));
    return [...s].sort();
  }, [studentsRaw]);

  const syllabusOptions = useMemo(() => {
    const s = new Set();
    studentsRaw.forEach((u) => u.syllabus && s.add(u.syllabus));
    return [...s].sort();
  }, [studentsRaw]);

  const packageNameOptions = useMemo(() => {
    const s = new Set();
    studentsRaw.forEach((u) => u.packageName && s.add(u.packageName));
    packagesRaw.forEach((p) => {
      if (p.name) s.add(p.name);
      if (p.packageName) s.add(p.packageName);
    });
    return [...s].sort();
  }, [studentsRaw, packagesRaw]);

  const promoterIdOptions = useMemo(() => {
    const s = new Set();
    studentsRaw.forEach((u) => {
      const pid = u.promoterId || u.referralId || u.referralCode || u.referral;
      if (pid) s.add(pid);
    });
    paymentsRaw.forEach((p) => {
      const pid = p.promoterId || p.promoterDocId || p.promoterUid || p.promoter || p.promoter_id;
      if (pid) s.add(pid);
    });
    return [...s].sort();
  }, [studentsRaw, paymentsRaw]);

  // Students filtering
  const filteredStudents = useMemo(() => {
    let arr = studentsRaw.filter((u) => u.role === "student" || u.role === "parent");
    if (hideIrrelevant) arr = arr.filter((u) => !u.irrelevant);
    if (filterClass) arr = arr.filter((u) => u.classGrade === filterClass);
    if (filterSyllabus) arr = arr.filter((u) => u.syllabus === filterSyllabus);
    if (filterPackageName) arr = arr.filter((u) => u.packageName === filterPackageName);

    if (filterPaymentStatus) {
      arr = arr.filter((u) => {
        const actual = Number(u.actualCost || u._actualRow || 0);
        const disc = Number(u.discount || u._discountRow || 0);
        const paid = Number(u.paidAmount || u._paidSum || u._paidDisplay || 0);
        const st = paid >= actual - disc && actual > 0 ? "Paid in Full" : "Pending";
        return st === filterPaymentStatus;
      });
    }

    if (filterPromoterId) {
      arr = arr.filter((u) => {
        const pid = u.promoterId || u.referralId || u.referralCode || u.referral || "";
        return pid === filterPromoterId;
      });
    }

    if (searchText.trim()) {
      const t = searchText.toLowerCase();
      arr = arr.filter(
        (u) =>
          (u.name || "").toLowerCase().includes(t) ||
          (u.email || "").toLowerCase().includes(t) ||
          (u.phone || "").includes(t)
      );
    }

    if (startDate || endDate) {
      const s = startDate ? new Date(startDate + "T00:00:00") : null;
      const e = endDate ? new Date(endDate + "T23:59:59") : null;
      arr = arr.filter((u) => {
        const d = parseTS(u.createdAt);
        if (!d) return false;
        if (s && d < s) return false;
        if (e && d > e) return false;
        return true;
      });
    }

    arr.sort((a, b) => {
      const da = parseTS(a.createdAt) ? parseTS(a.createdAt).getTime() : 0;
      const db = parseTS(b.createdAt) ? parseTS(b.createdAt).getTime() : 0;
      return db - da;
    });

    return arr;
  }, [
    studentsRaw,
    filterClass,
    filterSyllabus,
    filterPackageName,
    filterPaymentStatus,
    filterPromoterId,
    searchText,
    startDate,
    endDate,
    hideIrrelevant,
  ]);

  // Transactions: expand payments to one row per package (or one row for payment if no packages)
  const filteredTransactions = useMemo(() => {
    const pkgMap = {};
    packagesRaw.forEach((p) => {
      if (p.id) pkgMap[p.id] = p;
      if (p.packageId) pkgMap[p.packageId] = p;
      if (p.name) pkgMap[p.name] = p;
    });

    let arr = paymentsRaw ? [...paymentsRaw] : [];

    if (startDate || endDate) {
      const s = startDate ? new Date(startDate + "T00:00:00") : null;
      const e = endDate ? new Date(endDate + "T23:59:59") : null;
      arr = arr.filter((p) => {
        const d = parseTS(p.createdAt) || parseTS(p.paymentDate) || parseTS(p.paidAt) || null;
        if (!d) return false;
        if (s && d < s) return false;
        if (e && d > e) return false;
        return true;
      });
    }

    if (filterPromoterId) {
      arr = arr.filter((p) => {
        const pid = p.promoterId || p.promoterDocId || p.promoterUid || p.promoter || p.promoter_id || p.promoterId;
        return pid === filterPromoterId;
      });
    }

    if (filterPackageName) {
      arr = arr.filter((p) => {
        const pnameCandidates = [];
        if (Array.isArray(p.packages)) {
          p.packages.forEach((pp) => {
            if (pp.packageName) pnameCandidates.push(String(pp.packageName).toLowerCase());
            if (pp.name) pnameCandidates.push(String(pp.name).toLowerCase());
            if (pp.packageId) pnameCandidates.push(String(pp.packageId).toLowerCase());
          });
        }
        if (p.packageName) pnameCandidates.push(String(p.packageName).toLowerCase());
        if (p.packageId) pnameCandidates.push(String(p.packageId).toLowerCase());
        return pnameCandidates.some((pn) => pn.includes(filterPackageName.toLowerCase()));
      });
    }

    const expanded = [];
    arr.forEach((p) => {
      const basePaymentAmount = resolveAmountRupees(p);
      if (Array.isArray(p.packages) && p.packages.length) {
        const pkgCount = p.packages.length;
        p.packages.forEach((pp) => {
          const pkgId = pp.packageId || pp.id || pp.package || null;
          const pkgDoc = pkgId ? pkgMap[pkgId] : null;
          // compute package amount robustly
          let packageAmount = resolvePackageCostFromPaymentPackageItem(p, pp, pkgDoc);
          if (!packageAmount || packageAmount === 0) {
            if (pkgDoc) {
              packageAmount = guessIfPaiseAndConvert(pkgDoc.packageCost || pkgDoc.price || pkgDoc.packagePrice || 0);
            } else {
              packageAmount = pkgCount > 0 ? Number((basePaymentAmount / pkgCount).toFixed(2)) : basePaymentAmount;
            }
          }

          // discount and breakdown
          const discountObj = computeDiscountWithBreakdown(p, pp, pkgDoc);
          const discount = discountObj.amount || 0;

          // paid: prefer explicit per-package paid fields; otherwise packageAmount - discount
          let paidAmount = resolvePaidForPackageItem(p, pp);
          if (!paidAmount || paidAmount === 0) {
            paidAmount = Number((packageAmount - discount).toFixed(2));
          }

          // ensure not negative
          if (paidAmount < 0) paidAmount = 0;

          const row = {
            __expanded: true,
            parentPaymentId: p.id || p.paymentId || null,
            paymentId: p.paymentId || p.id || null,
            studentId: p.studentId || p.student || p.uid || null,
            studentName: p.studentName || p.studentName || p.student || "",
            email: p.email || "",
            phone: p.phone || p.contact || "",
            amount: Number(packageAmount || 0),
            currency: p.currency || "INR",
            status: p.status || p.settlementStatus || "",
            method: p.method || p.paymentMethod || p.flow || "",
            packageName: pp.packageName || pp.name || (pkgDoc ? pkgDoc.name || pkgDoc.packageName : ""),
            packageId: pkgId,
            discount,
            discountBreakdown: discountObj.breakdown || "",
            paid: Number(paidAmount || 0),
            promoterId: p.promoterId || p.promoterDocId || p.promoterUid || p.promoter || p.promoter_id || "",
            createdAt: parseTS(p.createdAt) || parseTS(p.paymentDate) || parseTS(p.paidAt) || null,
            originalPaymentDoc: p,
          };
          expanded.push(row);
        });
      } else {
        const packageNameFallback = p.packageName || (p.packages && typeof p.packages === "string" ? p.packages : "");
        const discountObj = computeDiscountWithBreakdown(p, null, null);
        const discount = discountObj.amount || 0;
        const amount = resolveAmountRupees(p);
        // paid: prefer explicit paid amount fields on payment doc
        let paidAmountExplicit = 0;
        const paidCandidates = [p.paidAmount, p.paymentAmount, p.amount, p.totalPayable];
        for (const c of paidCandidates) {
          if (typeof c !== "undefined" && c !== null && c !== "") {
            const v = guessIfPaiseAndConvert(c);
            if (v > 0) {
              paidAmountExplicit = v;
              break;
            }
          }
        }
        const paidAmount = paidAmountExplicit > 0 ? paidAmountExplicit : Number((amount - discount).toFixed(2));

        const row = {
          __expanded: false,
          parentPaymentId: p.id || null,
          paymentId: p.paymentId || p.id || null,
          studentId: p.studentId || p.student || p.uid || null,
          studentName: p.studentName || p.student || "",
          email: p.email || "",
          phone: p.phone || p.contact || "",
          amount: Number(amount || 0),
          currency: p.currency || "INR",
          status: p.status || p.settlementStatus || "",
          method: p.method || p.paymentMethod || p.flow || "",
          packageName: packageNameFallback,
          packageId: p.packageId || null,
          discount: Number(discount || 0),
          discountBreakdown: discountObj.breakdown || "",
          paid: Number(paidAmount || 0),
          promoterId: p.promoterId || p.promoterDocId || p.promoterUid || p.promoter || p.promoter_id || "",
          createdAt: parseTS(p.createdAt) || parseTS(p.paymentDate) || parseTS(p.paidAt) || null,
          originalPaymentDoc: p,
        };
        expanded.push(row);
      }
    });

    // search filter
    let final = expanded;
    if (searchText.trim()) {
      const t = searchText.toLowerCase();
      final = final.filter((r) =>
        (r.paymentId || "").toLowerCase().includes(t) ||
        (r.email || "").toLowerCase().includes(t) ||
        (r.phone || "").toLowerCase().includes(t) ||
        (r.studentName || "").toLowerCase().includes(t) ||
        (r.packageName || "").toLowerCase().includes(t)
      );
    }

    if (filterPackageName) {
      final = final.filter((r) => (r.packageName || "").toLowerCase().includes(filterPackageName.toLowerCase()));
    }

    if (filterPaymentStatus) {
      final = final.filter((r) => {
        const st = (r.status || "").toLowerCase();
        if (filterPaymentStatus === "Paid in Full") return st === "paid" || st === "captured" || st === "authorized";
        if (filterPaymentStatus === "Pending") return st === "pending" || st === "authorized" || st === "failed";
        return true;
      });
    }

    final.sort((a, b) => {
      const ta = a.createdAt ? a.createdAt.getTime() : 0;
      const tb = b.createdAt ? b.createdAt.getTime() : 0;
      return tb - ta;
    });

    return final;
  }, [
    paymentsRaw,
    packagesRaw,
    filterPromoterId,
    filterPackageName,
    filterPaymentStatus,
    searchText,
    startDate,
    endDate,
    guessIfPaiseAndConvert,
    resolveAmountRupees,
    resolvePackageCostFromPaymentPackageItem,
    computeDiscountWithBreakdown,
    resolvePaidForPackageItem,
  ]);

  const downloadCSV = () => {
    if (viewMode === "students") {
      if (!filteredStudents.length) {
        alert("No records found.");
        return;
      }

      const rows = filteredStudents.map((u) => {
        const actual = Number(u.actualCost || u._actualRow || 0);
        const disc = Number(u.discount || u._discountRow || 0);
        const paid = Number(u.paidAmount || u._paidSum || u._paidDisplay || 0);
        const status = paid >= actual - disc && actual > 0 ? "Paid in Full" : "Pending";

        return {
          id: u.id,
          name: u.name || "",
          email: u.email || "",
          phone: u.phone || "",
          classGrade: u.classGrade || "",
          syllabus: u.syllabus || "",
          packageName: u.packageName || "",
          actualCost: actual,
          discount: disc,
          paidAmount: paid,
          paymentStatus: status,
          paymentMode: u._lastPayment ? u._lastPayment.mode || u.paymentMode || "" : u.paymentMode || "",
          transactionId: u._lastPayment ? u._lastPayment.transactionId || u._lastPayment.txnId || u._lastPayment.paymentId || "" : u.transactionId || "",
          promoterId: u.promoterId || u.referralId || u.referralCode || "",
          referralCode: u.referralCode || u.referralId || "",
          createdAt: parseTS(u.createdAt) ? parseTS(u.createdAt).toISOString() : "",
        };
      });

      const headers = Object.keys(rows[0] || {});
      const csv = headers.join(",") + "\n" + rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "students_report.csv";
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (viewMode === "transactions") {
      if (!filteredTransactions.length) {
        alert("No transactions found.");
        return;
      }

      const rows = filteredTransactions.map((p) => ({
        paymentId: p.paymentId || "",
        studentId: p.studentId || "",
        studentName: p.studentName || "",
        email: p.email || "",
        phone: p.phone || "",
        amount: Number(p.amount || 0),
        currency: p.currency || "INR",
        status: p.status || "",
        method: p.method || p.paymentMethod || "",
        packageName: p.packageName || "",
        discount: p.discount || 0,
        paid: p.paid || 0,
        promoterId: p.promoterId || "",
        createdAt: p.createdAt ? p.createdAt.toISOString() : "",
        parentPaymentId: p.parentPaymentId || "",
      }));

      const headers = Object.keys(rows[0] || {});
      const csv = headers.join(",") + "\n" + rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "transactions_report.csv";
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
  };

  const copyUid = async (uid) => {
    try {
      await navigator.clipboard.writeText(uid);
      alert("UID copied.");
    } catch {
      alert(uid);
    }
  };

  const btnPrimary = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    background: "#0ea5e9",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  };

  const btnGhost = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #e6e6e6",
    background: "#fff",
    color: "#111",
    cursor: "pointer",
    fontWeight: 700,
  };

  const thStyle = {
    padding: "12px",
    background: "#319795",
    color: "#fff",
    fontWeight: 700,
    textAlign: "left",
  };
  const thStyleRight = { ...thStyle, textAlign: "right" }; // for currency headers

  const tdStyle = {
    padding: "10px",
    borderBottom: "1px solid #eee",
  };

  const toggleExpandStudent = (id) => {
    setExpandedStudentId((prev) => (prev === id ? null : id));
  };

  // helper to build purchase rows for an individual student (used in expanded panel)
  const buildStudentPurchases = (student) => {
    const pkgMap = {};
    packagesRaw.forEach((p) => {
      if (p.id) pkgMap[p.id] = p;
      if (p.packageId) pkgMap[p.packageId] = p;
      if (p.name) pkgMap[p.name] = p;
    });

    const payments = Array.isArray(student._payments) ? student._payments : [];
    const purchases = [];

    payments.forEach((p) => {
      const basePaymentAmount = resolveAmountRupees(p);
      if (Array.isArray(p.packages) && p.packages.length) {
        const pkgCount = p.packages.length;
        p.packages.forEach((pp) => {
          const pkgId = pp.packageId || pp.id || pp.package || null;
          const pkgDoc = pkgId ? pkgMap[pkgId] : null;
          let packageAmount = resolvePackageCostFromPaymentPackageItem(p, pp, pkgDoc);
          if (!packageAmount || packageAmount === 0) {
            if (pkgDoc) {
              packageAmount = guessIfPaiseAndConvert(pkgDoc.packageCost || pkgDoc.price || pkgDoc.packagePrice || 0);
            } else {
              packageAmount = pkgCount > 0 ? Number((basePaymentAmount / pkgCount).toFixed(2)) : basePaymentAmount;
            }
          }
          const discountObj = computeDiscountWithBreakdown(p, pp, pkgDoc);
          const discount = discountObj.amount || 0;

          // paid: prefer explicit per-package paid fields, else compute
          let paidAmount = resolvePaidForPackageItem(p, pp);
          if (!paidAmount || paidAmount === 0) {
            paidAmount = Number((packageAmount - discount).toFixed(2));
          }
          if (paidAmount < 0) paidAmount = 0;

          purchases.push({
            paymentId: p.paymentId || p.id || null,
            txnId: p.transactionId || p.txnId || p.paymentId || p.id || "",
            date: parseTS(p.createdAt) || parseTS(p.paymentDate) || parseTS(p.paidAt) || null,
            packageName: pp.packageName || pp.name || (pkgDoc ? pkgDoc.name || pkgDoc.packageName : ""),
            packageAmount,
            discount,
            discountBreakdown: discountObj.breakdown || "",
            paidAmount,
          });
        });
      } else {
        const amount = resolveAmountRupees(p);
        const discountObj = computeDiscountWithBreakdown(p, null, null);
        const discount = discountObj.amount || 0;

        // paid: prefer explicit top-level paid values
        let paidAmountExplicit = 0;
        const paidCandidates = [p.paidAmount, p.paymentAmount, p.amount, p.totalPayable];
        for (const c of paidCandidates) {
          if (typeof c !== "undefined" && c !== null && c !== "") {
            const v = guessIfPaiseAndConvert(c);
            if (v > 0) {
              paidAmountExplicit = v;
              break;
            }
          }
        }
        const paidAmount = paidAmountExplicit > 0 ? paidAmountExplicit : Number((amount - discount).toFixed(2));
        purchases.push({
          paymentId: p.paymentId || p.id || null,
          txnId: p.transactionId || p.txnId || p.paymentId || p.id || "",
          date: parseTS(p.createdAt) || parseTS(p.paymentDate) || parseTS(p.paidAt) || null,
          packageName: p.packageName || "",
          packageAmount: amount,
          discount,
          discountBreakdown: discountObj.breakdown || "",
          paidAmount,
        });
      }
    });

    return purchases;
  };

  return (
    <div style={{ padding: 20, minHeight: "100vh", background: "#E6FFFA" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button style={btnGhost} onClick={() => navigate("/admin-dashboard")}>
          ← Back
        </button>

        <h1 style={{ flex: 1, textAlign: "center" }}>Student Database & Payments</h1>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{
              ...btnGhost,
              minWidth: 140,
              fontWeight: viewMode === "students" ? 900 : 700,
            }}
            onClick={() => setViewMode("students")}
          >
            Show Students
          </button>
          <button
            style={{
              ...btnGhost,
              minWidth: 140,
              fontWeight: viewMode === "transactions" ? 900 : 700,
            }}
            onClick={() => setViewMode("transactions")}
          >
            Show Transactions
          </button>
          <button style={btnPrimary} onClick={downloadCSV}>
            Download CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          background: "#fff",
          padding: 16,
          borderRadius: 10,
          marginBottom: 16,
          boxShadow: "0 6px 14px rgba(0,0,0,0.05)",
        }}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div>
            <label>Class</label>
            <br />
            <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
              <option value="">All</option>
              {classesOptions.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>

          <div>
            <label>Syllabus</label>
            <br />
            <select value={filterSyllabus} onChange={(e) => setFilterSyllabus(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
              <option value="">All</option>
              {syllabusOptions.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>

          <div>
            <label>Package</label>
            <br />
            <select value={filterPackageName} onChange={(e) => setFilterPackageName(e.target.value)} style={{ padding: 8, borderRadius: 8, minWidth: 180 }}>
              <option value="">All</option>
              {packageNameOptions.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>

          <div>
            <label>Payment Status</label>
            <br />
            <select value={filterPaymentStatus} onChange={(e) => setFilterPaymentStatus(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
              <option value="">All</option>
              <option value="Paid in Full">Paid in Full</option>
              <option value="Pending">Pending</option>
            </select>
          </div>

          <div>
            <label>Promoter ID</label>
            <br />
            <select value={filterPromoterId} onChange={(e) => setFilterPromoterId(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
              <option value="">All</option>
              {promoterIdOptions.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 210 }}>
            <label>Search</label>
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="name / email / phone / paymentId / package" style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
          </div>

          <div>
            <label>Hide Irrelevant</label>
            <br />
            <input type="checkbox" checked={hideIrrelevant} onChange={(e) => setHideIrrelevant(e.target.checked)} />
          </div>
        </div>

        <hr style={{ margin: "15px 0" }} />

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div>
            <label>Start</label>
            <br />
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ padding: 8, borderRadius: 8 }} />
          </div>

          <div>
            <label>End</label>
            <br />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ padding: 8, borderRadius: 8 }} />
          </div>

          <button style={btnGhost} onClick={setPresetToday}>
            Today
          </button>
          <button style={btnGhost} onClick={setPresetThisMonth}>
            This Month
          </button>
          <button style={btnGhost} onClick={setPresetThisYear}>
            This Year
          </button>
          <button style={btnGhost} onClick={clearDateFilters}>
            Clear
          </button>
        </div>
      </div>

      {/* Render */}
      {loading ? (
        <div style={{ background: "#fff", padding: 40, borderRadius: 10, textAlign: "center", fontWeight: 700 }}>Loading...</div>
      ) : viewMode === "students" ? (
        /* STUDENTS: basic list, expand to view purchases */
        <div style={{ overflowX: "auto", background: "#fff", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", borderRadius: 10 }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Class</th>
                <th style={thStyle}>Syllabus</th>
                <th style={thStyle}>Package</th>
                <th style={thStyle}>Promoter</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredStudents.length > 0 ? (
                filteredStudents.map((s, i) => {
                  const promoterDisplay = s.promoterId || s.referralId || s.referralCode || "-";

                  return (
                    <React.Fragment key={s.id}>
                      <tr style={{ background: i % 2 === 0 ? "#fff" : "#F0FFF4" }}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{s.name || "-"}</td>
                        <td style={tdStyle}>{s.classGrade || "-"}</td>
                        <td style={tdStyle}>{s.syllabus || "-"}</td>
                        <td style={tdStyle}>{s.packageName || "-"}</td>
                        <td style={tdStyle}>{promoterDisplay}</td>
                        <td style={tdStyle}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button style={btnGhost} onClick={() => toggleExpandStudent(s.id)}>{expandedStudentId === s.id ? "Hide Purchases" : "View Purchases"}</button>
                            <button style={btnGhost} onClick={() => copyUid(s.id)}>Copy UID</button>
                          </div>
                        </td>
                      </tr>

                      {expandedStudentId === s.id && (
                        <tr>
                          <td colSpan={6} style={{ padding: 12, background: "#FAFFFD" }}>
                            {/* Purchases panel */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                              {(() => {
                                const purchases = buildStudentPurchases(s);
                                if (!purchases.length) return <div style={{ padding: 12, color: "#777" }}>No purchases found for this student.</div>;

                                const totalCost = purchases.reduce((acc, r) => acc + (Number(r.packageAmount || 0) || 0), 0);
                                const totalDiscount = purchases.reduce((acc, r) => acc + (Number(r.discount || 0) || 0), 0);
                                const totalPaid = purchases.reduce((acc, r) => acc + (Number(r.paidAmount || 0) || 0), 0);

                                return (
                                  <div>
                                    <div style={{ display: "flex", gap: 12, marginBottom: 8, alignItems: "center" }}>
                                      <div style={{ fontWeight: 800 }}>Purchases</div>
                                      <div style={{ color: "#555" }}>({purchases.length} lines)</div>
                                      <div style={{ marginLeft: "auto", fontWeight: 800 }}>
                                        Totals: {formatCurrency(totalCost)} • Discount {formatCurrency(totalDiscount)} • Paid {formatCurrency(totalPaid)}
                                      </div>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8 }}>
                                      <div style={{ fontWeight: 700 }}>Package</div>
                                      <div style={{ fontWeight: 700, textAlign: "right" }}>Cost</div>
                                      <div style={{ fontWeight: 700, textAlign: "right" }}>Discount</div>
                                      <div style={{ fontWeight: 700, textAlign: "right" }}>Paid</div>
                                    </div>

                                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                                      {purchases.map((r, idx) => (
                                        <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8, padding: 8, background: idx % 2 === 0 ? "#fff" : "#F7FFF9", borderRadius: 6 }}>
                                          <div>
                                            <div style={{ fontWeight: 700 }}>{r.packageName || "-"}</div>
                                            <div style={{ fontSize: 12, color: "#666" }}>{r.txnId} {r.date ? `• ${r.date.toLocaleString()}` : ""}</div>
                                            {r.discountBreakdown ? <div style={{ fontSize: 12, color: "#444", marginTop: 6 }}>{r.discountBreakdown}</div> : null}
                                          </div>
                                          <div style={{ textAlign: "right", fontWeight: 700 }}>{formatCurrency(r.packageAmount)}</div>
                                          <div style={{ textAlign: "right", color: "#16A34A", fontWeight: 800 }}>{formatCurrency(r.discount)}</div>
                                          <div style={{ textAlign: "right", color: "#DD6B20", fontWeight: 800 }}>{formatCurrency(r.paidAmount)}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="6" style={{ padding: 20, textAlign: "center", color: "#777", fontWeight: 700 }}>No students found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* TRANSACTIONS view (one row per package purchase) - added Paid column */
        <div style={{ overflowX: "auto", background: "#fff", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", borderRadius: 10 }}>
            <thead>
              <tr>
                <th style={thStyle}>Payment ID</th>
                <th style={thStyle}>Student</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Phone</th>
                <th style={thStyleRight}>Amount</th>
                <th style={thStyleRight}>Discount</th>
                <th style={thStyleRight}>Paid</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Method</th>
                <th style={thStyle}>Package</th>
                <th style={thStyle}>Promoter</th>
                <th style={thStyle}>Created On</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredTransactions.length > 0 ? (
                filteredTransactions.map((p, i) => {
                  const created = p.createdAt ? p.createdAt : null;
                  const amountNum = Number(p.amount || 0);
                  const promoc = p.promoterId || "-";
                  const discount = Number(p.discount || 0);
                  const paid = Number(p.paid || 0);
                  return (
                    <tr key={`${p.paymentId || p.parentPaymentId || i}-${p.packageId || ""}`} style={{ background: i % 2 === 0 ? "#fff" : "#F7FFFB" }}>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{p.paymentId || p.parentPaymentId || "-"}</td>
                      <td style={tdStyle}>{p.studentName || p.studentId || "-"}</td>
                      <td style={tdStyle}>{p.email || "-"}</td>
                      <td style={tdStyle}>{p.phone || "-"}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{formatCurrency(amountNum)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{formatCurrency(discount)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: "#DD6B20", fontWeight: 700 }}>{formatCurrency(paid)}</td>
                      <td style={tdStyle}>{p.status || "-"}</td>
                      <td style={tdStyle}>{p.method || "-"}</td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 700 }}>{p.packageName || "-"}</div>
                        {p.discountBreakdown ? <div style={{ fontSize: 12, color: "#555" }}>{p.discountBreakdown}</div> : null}
                      </td>
                      <td style={tdStyle}>{promoc}</td>
                      <td style={tdStyle}>{created ? created.toLocaleString() : "-"}</td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button style={btnGhost} onClick={() => { const idToCopy = p.paymentId || p.parentPaymentId || ""; navigator.clipboard?.writeText(idToCopy).then(() => alert("Copied payment id.")); }}>Copy Payment ID</button>
                          <button style={btnGhost} onClick={() => { if (p.parentPaymentId) copyUid(p.parentPaymentId); }}>Copy Doc ID</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="13" style={{ padding: 20, textAlign: "center", color: "#777", fontWeight: 700 }}>No transactions found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
