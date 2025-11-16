// src/pages/StudentDatabase.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

/**
 * StudentDatabase.jsx (Aligned Version)
 * - Hooks always in same order
 * - Clean UI
 * - Filters, search, CSV export
 * - Payment status calculation
 */

export default function StudentDatabase() {
  const [studentsRaw, setStudentsRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Filters
  const [filterClass, setFilterClass] = useState("");
  const [filterSyllabus, setFilterSyllabus] = useState("");
  const [filterPackageName, setFilterPackageName] = useState("");
  const [filterPaymentStatus, setFilterPaymentStatus] = useState(""); // Paid / Pending
  const [filterPromoterId, setFilterPromoterId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [hideIrrelevant, setHideIrrelevant] = useState(true);

  // Date
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Quick Presets
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

  // Fetch DB
  useEffect(() => {
    let mounted = true;

    const fetchStudents = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "users"));
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (mounted) setStudentsRaw(arr);
      } catch (err) {
        console.error("Fetch error:", err);
        if (mounted) setStudentsRaw([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchStudents();
    return () => (mounted = false);
  }, []);

  const parseTS = (ts) => {
    if (!ts) return null;
    if (ts.toDate) return ts.toDate();
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  };

  const formatCurrency = (a) =>
    a === undefined || isNaN(a) ? "₹0" : `₹${Number(a).toLocaleString("en-IN")}`;

  // Unique filter options
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
    return [...s].sort();
  }, [studentsRaw]);

  const promoterIdOptions = useMemo(() => {
    const s = new Set();
    studentsRaw.forEach((u) => u.promoterId && s.add(u.promoterId));
    return [...s].sort();
  }, [studentsRaw]);

  // Filtering
  const filteredStudents = useMemo(() => {
    let arr = studentsRaw.filter((u) => u.role === "student" || u.role === "parent");

    if (hideIrrelevant) arr = arr.filter((u) => !u.irrelevant);

    if (filterClass) arr = arr.filter((u) => u.classGrade === filterClass);
    if (filterSyllabus) arr = arr.filter((u) => u.syllabus === filterSyllabus);
    if (filterPackageName) arr = arr.filter((u) => u.packageName === filterPackageName);

    if (filterPaymentStatus) {
      arr = arr.filter((u) => {
        const actual = Number(u.actualCost || 0);
        const disc = Number(u.discount || 0);
        const paid = Number(u.paidAmount || 0);
        const st = paid >= actual - disc ? "Paid in Full" : "Pending";
        return st === filterPaymentStatus;
      });
    }

    if (filterPromoterId) arr = arr.filter((u) => u.promoterId === filterPromoterId);

    if (searchText.trim()) {
      const t = searchText.toLowerCase();
      arr = arr.filter(
        (u) =>
          (u.name || "").toLowerCase().includes(t) ||
          (u.email || "").toLowerCase().includes(t) ||
          (u.phone || "").includes(t)
      );
    }

    // Date filter
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

    // Sort
    arr.sort((a, b) => {
      const da = parseTS(a.createdAt) || 0;
      const db = parseTS(b.createdAt) || 0;
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

  // CSV Download
  const downloadCSV = () => {
    if (!filteredStudents.length) {
      alert("No records found.");
      return;
    }

    const rows = filteredStudents.map((u) => {
      const actual = Number(u.actualCost || 0);
      const disc = Number(u.discount || 0);
      const paid = Number(u.paidAmount || 0);
      const status = paid >= actual - disc ? "Paid in Full" : "Pending";
      const created = parseTS(u.createdAt);

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
        paymentMode: u.paymentMode || "",
        transactionId: u.transactionId || "",
        promoterId: u.promoterId || "",
        referralCode: u.referralCode || "",
        createdAt: created ? created.toISOString() : "",
      };
    });

    const headers = Object.keys(rows[0]);
    const csv =
      headers.join(",") +
      "\n" +
      rows
        .map((r) =>
          headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(",")
        )
        .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = "students_report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyUid = async (uid) => {
    try {
      await navigator.clipboard.writeText(uid);
      alert("UID copied.");
    } catch {
      alert(uid);
    }
  };

  // Styles
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

  const tdStyle = {
    padding: "10px",
    borderBottom: "1px solid #eee",
  };

  return (
    <div style={{ padding: 20, minHeight: "100vh", background: "#E6FFFA" }}>
      {/* Header */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button style={btnGhost} onClick={() => navigate("/admin-dashboard")}>
          ← Back
        </button>

        <h1 style={{ flex: 1, textAlign: "center" }}>
          Student Database & Payments
        </h1>

        <button style={btnPrimary} onClick={downloadCSV}>
          Download CSV
        </button>
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
          {/* Class */}
          <div>
            <label>Class</label>
            <br />
            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              style={{ padding: 8, borderRadius: 8 }}
            >
              <option value="">All</option>
              {classesOptions.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>

          {/* Syllabus */}
          <div>
            <label>Syllabus</label>
            <br />
            <select
              value={filterSyllabus}
              onChange={(e) => setFilterSyllabus(e.target.value)}
              style={{ padding: 8, borderRadius: 8 }}
            >
              <option value="">All</option>
              {syllabusOptions.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>

          {/* Package */}
          <div>
            <label>Package</label>
            <br />
            <select
              value={filterPackageName}
              onChange={(e) => setFilterPackageName(e.target.value)}
              style={{ padding: 8, borderRadius: 8, minWidth: 180 }}
            >
              <option value="">All</option>
              {packageNameOptions.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>

          {/* Payment Status */}
          <div>
            <label>Payment Status</label>
            <br />
            <select
              value={filterPaymentStatus}
              onChange={(e) => setFilterPaymentStatus(e.target.value)}
              style={{ padding: 8, borderRadius: 8 }}
            >
              <option value="">All</option>
              <option value="Paid in Full">Paid in Full</option>
              <option value="Pending">Pending</option>
            </select>
          </div>

          {/* Promoter */}
          <div>
            <label>Promoter ID</label>
            <br />
            <select
              value={filterPromoterId}
              onChange={(e) => setFilterPromoterId(e.target.value)}
              style={{ padding: 8, borderRadius: 8 }}
            >
              <option value="">All</option>
              {promoterIdOptions.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>

          {/* Search */}
          <div style={{ flex: 1, minWidth: 210 }}>
            <label>Search</label>
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="name / email / phone"
              style={{
                width: "100%",
                padding: 8,
                borderRadius: 8,
                border: "1px solid #ddd",
              }}
            />
          </div>

          {/* Irrelevant */}
          <div>
            <label>Hide Irrelevant</label>
            <br />
            <input
              type="checkbox"
              checked={hideIrrelevant}
              onChange={(e) => setHideIrrelevant(e.target.checked)}
            />
          </div>
        </div>

        <hr style={{ margin: "15px 0" }} />

        {/* Date Filters */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div>
            <label>Start</label>
            <br />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ padding: 8, borderRadius: 8 }}
            />
          </div>

          <div>
            <label>End</label>
            <br />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ padding: 8, borderRadius: 8 }}
            />
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

      {/* Loading */}
      {loading ? (
        <div
          style={{
            background: "#fff",
            padding: 40,
            borderRadius: 10,
            textAlign: "center",
            fontWeight: 700,
          }}
        >
          Loading...
        </div>
      ) : (
        <div style={{ overflowX: "auto", background: "#fff", borderRadius: 10 }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              borderRadius: 10,
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Phone</th>
                <th style={thStyle}>Class</th>
                <th style={thStyle}>Syllabus</th>
                <th style={thStyle}>Package</th>
                <th style={thStyle}>Actual</th>
                <th style={thStyle}>Discount</th>
                <th style={thStyle}>Paid</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Purchase</th>
                <th style={thStyle}>Promoter ID</th>
                <th style={thStyle}>Referral</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredStudents.length > 0 ? (
                filteredStudents.map((s, i) => {
                  const actual = Number(s.actualCost || 0);
                  const disc = Number(s.discount || 0);
                  const paid = Number(s.paidAmount || 0);
                  const status = paid >= actual - disc ? "Paid in Full" : "Pending";
                  const created = parseTS(s.createdAt);

                  return (
                    <tr
                      key={s.id}
                      style={{
                        background: i % 2 === 0 ? "#fff" : "#F0FFF4",
                      }}
                    >
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{s.name || "-"}</td>
                      <td style={tdStyle}>{s.email || "-"}</td>
                      <td style={tdStyle}>{s.phone || "-"}</td>
                      <td style={tdStyle}>{s.classGrade || "-"}</td>
                      <td style={tdStyle}>{s.syllabus || "-"}</td>
                      <td style={tdStyle}>{s.packageName || "-"}</td>

                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        {formatCurrency(actual)}
                      </td>

                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          color: "#16A34A",
                          fontWeight: 700,
                        }}
                      >
                        {formatCurrency(disc)}
                      </td>

                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          color: "#DD6B20",
                          fontWeight: 700,
                        }}
                      >
                        {formatCurrency(paid)}
                      </td>

                      <td
                        style={{
                          ...tdStyle,
                          fontWeight: 700,
                          color: status === "Paid in Full" ? "green" : "#EAB308",
                        }}
                      >
                        {status}
                      </td>

                      <td style={tdStyle}>
                        {created ? created.toLocaleString() : "-"}
                      </td>

                      <td style={tdStyle}>{s.promoterId || "-"}</td>
                      <td style={tdStyle}>{s.referralCode || "-"}</td>

                      <td style={{ ...tdStyle }}>
                        <button style={btnGhost} onClick={() => copyUid(s.id)}>
                          Copy UID
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan="14"
                    style={{
                      padding: 20,
                      textAlign: "center",
                      color: "#777",
                      fontWeight: 700,
                    }}
                  >
                    No students found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
