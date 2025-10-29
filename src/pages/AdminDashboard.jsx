// src/pages/AdminDashboard.jsx
import React, { useState, useEffect } from "react";
import { auth, db } from "../firebase/firebaseConfig";
import { useNavigate } from "react-router-dom";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
// NOTE: CSS moved into this file (no external CSS import) as requested

const ADMIN_UID = "Q3Z7mgam8IOMQWQqAdwWEQmpqNn2";
const classOptions = ["6th", "7th", "8th", "9th", "10th", "Professional Course"];
const syllabusOptions = ["ICSE", "CBSE", "State Karnataka"];
const packageTypeOptions = ["Interactive Class", "Test"];
const packageNameOptions = [
  "Concept Based Package",
  "Subject Based Package",
  "Subject Combo Package",
  "Full Academic Package",
  "Concept + Test Package",
  "Subject + Test Package",
  "Subject combo + Test Package",
  "Full Academic + Test Package",
];

export default function AdminDashboard() {
  const navigate = useNavigate();

  // Auth check
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (!user) navigate("/");
      else if (user.uid !== ADMIN_UID) navigate("/student-dashboard");
    });
    return () => unsubscribe();
  }, [navigate]);

  // State - packages (existing)
  const [packages, setPackages] = useState([]);
  const [filteredPackages, setFilteredPackages] = useState([]);
  const [classGrade, setClassGrade] = useState("");
  const [syllabus, setSyllabus] = useState("");
  const [packageType, setPackageType] = useState("");
  const [packageName, setPackageName] = useState("");
  const [subject, setSubject] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [newSubject, setNewSubject] = useState("");
  const [subtopic, setSubtopic] = useState("");
  const [chapter, setChapter] = useState("");
  const [concept, setConcept] = useState("");
  const [duration, setDuration] = useState("");
  const [price, setPrice] = useState("");
  const [regularDiscount, setRegularDiscount] = useState("");
  const [additionalDiscount, setAdditionalDiscount] = useState("");
  const [totalPayable, setTotalPayable] = useState("0.00");
  const [commission, setCommission] = useState("");
  const [courseDetails, setCourseDetails] = useState("");
  const [freebies, setFreebies] = useState("");
  const [editingId, setEditingId] = useState(null);

  // Report date filter
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");

  // Right panel filters
  const [filterClass, setFilterClass] = useState("");
  const [filterSyllabus, setFilterSyllabus] = useState("");
  const [filterPackageType, setFilterPackageType] = useState("");
  const [filterPackageName, setFilterPackageName] = useState("");

  // NEW: Users state (for promoters & students)
  const [usersList, setUsersList] = useState([]);
  const [viewType, setViewType] = useState("packages"); // "packages" | "promoters" | "students"
  const [userFilterText, setUserFilterText] = useState("");

  // --- Realtime fetch for packages and users ---
  useEffect(() => {
    // packages realtime (to preserve original fetchPackages behavior + live updates)
    const packagesCol = collection(db, "packages");
    const unsubPackages = onSnapshot(packagesCol, (snap) => {
      const allPackages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPackages(allPackages);
    });

    // users realtime (single collection "users" as in your sample)
    const usersCol = collection(db, "users");
    const unsubUsers = onSnapshot(usersCol, (snap) => {
      const allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setUsersList(allUsers);
    });

    return () => {
      unsubPackages();
      unsubUsers();
    };
  }, []);

  // Keep filteredPackages updated (existing logic)
  useEffect(() => {
    let filtered = [...packages];
    if (filterClass) filtered = filtered.filter((p) => p.classGrade === filterClass);
    if (filterSyllabus) filtered = filtered.filter((p) => p.syllabus === filterSyllabus);
    if (filterPackageType) filtered = filtered.filter((p) => p.packageType === filterPackageType);
    if (filterPackageName) filtered = filtered.filter((p) => p.packageName === filterPackageName);
    setFilteredPackages(filtered);
  }, [packages, filterClass, filterSyllabus, filterPackageType, filterPackageName]);

  // Calculate total payable dynamically (existing)
  useEffect(() => {
    const p = parseFloat(price) || 0;
    const rd = parseFloat(regularDiscount) || 0;
    const ad = parseFloat(additionalDiscount) || 0;
    const total = p - (p * rd) / 100 - (p * ad) / 100;
    setTotalPayable(total.toFixed(2));
  }, [price, regularDiscount, additionalDiscount]);

  // Reset form (existing)
  const resetForm = () => {
    setClassGrade("");
    setSyllabus("");
    setPackageType("");
    setPackageName("");
    setSubject("");
    setSubjects([]);
    setNewSubject("");
    setSubtopic("");
    setChapter("");
    setConcept("");
    setDuration("");
    setPrice("");
    setRegularDiscount("");
    setAdditionalDiscount("");
    setTotalPayable("0.00");
    setCommission("");
    setCourseDetails("");
    setFreebies("");
    setEditingId(null);
  };

  // Add or update package (existing)
  const handleAddOrUpdate = async () => {
    if (!classGrade || (!syllabus && classGrade !== "Professional Course") || !packageName || !price || !commission) {
      alert("Please fill: Class, Syllabus (if applicable), Package Name, Price, Commission %.");
      return;
    }

    let subjectValue = subject;
    if (packageName === "Subject Combo Package") {
      subjectValue = subjects.join("/");
    }

    const payload = {
      classGrade,
      syllabus: classGrade === "Professional Course" ? "" : syllabus,
      packageType,
      packageName,
      subject: subjectValue,
      subtopic: packageName === "Concept Based Package" ? subtopic : "",
      chapter: packageName === "Concept Based Package" ? chapter : "",
      concept: packageName === "Concept Based Package" ? concept : "",
      duration,
      price,
      regularDiscount,
      additionalDiscount,
      totalPayable,
      commission,
      courseDetails,
      freebies,
      createdAt: new Date(),
    };

    if (editingId) {
      await updateDoc(doc(db, "packages", editingId), payload);
    } else {
      await addDoc(collection(db, "packages"), payload);
    }

    resetForm();
  };

  const startEdit = (pkg) => {
    setEditingId(pkg.id);
    setClassGrade(pkg.classGrade || "");
    setSyllabus(pkg.syllabus || "");
    setPackageType(pkg.packageType || "");
    setPackageName(pkg.packageName || "");
    if (pkg.packageName === "Subject Combo Package") {
      setSubjects(pkg.subject ? pkg.subject.split("/") : []);
    } else {
      setSubject(pkg.subject || "");
    }
    setSubtopic(pkg.subtopic || "");
    setChapter(pkg.chapter || "");
    setConcept(pkg.concept || "");
    setDuration(pkg.duration || "");
    setPrice(pkg.price || "");
    setRegularDiscount(pkg.regularDiscount || "");
    setAdditionalDiscount(pkg.additionalDiscount || "");
    setTotalPayable(pkg.totalPayable || "0.00");
    setCommission(pkg.commission || "");
    setCourseDetails(pkg.courseDetails || "");
    setFreebies(pkg.freebies || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id) => {
    if (window.confirm("Delete this package?")) {
      await deleteDoc(doc(db, "packages", id));
      // packages list updates automatically via onSnapshot
    }
  };

  const handleLogout = async () => {
    await auth.signOut();
    navigate("/");
  };

  const addSubjectToCombo = () => {
    if (newSubject.trim() && !subjects.includes(newSubject.trim())) {
      setSubjects([...subjects, newSubject.trim()]);
      setNewSubject("");
    }
  };

  // CSV Download (existing, untouched)
  const downloadCSV = async (type) => {
    let data = [];
    try {
      if (type === "packages") {
        const snap = await getDocs(collection(db, "packages"));
        data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } else if (type === "promoters") {
        const snap = await getDocs(collection(db, "users"));
        data = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter(
            (d) =>
              (d.role === "promoter" || d.alsoPromoter === true) &&
              d.promoterApproved === true
          );
      } else if (type === "students") {
        const snap = await getDocs(query(collection(db, "users"), where("role", "==", "student")));
        data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }

      // Optional date filter
      if (reportStartDate && reportEndDate) {
        const start = new Date(reportStartDate);
        const end = new Date(reportEndDate);
        end.setHours(23, 59, 59, 999);

        data = data.filter((item) => {
          if (!item.createdAt) return true;
          const created = item.createdAt.toDate ? item.createdAt.toDate() : new Date(item.createdAt);
          return created >= start && created <= end;
        });
      }

      if (!data.length) {
        alert("No records found for the selected date range.");
        return;
      }

      const headers = Object.keys(data[0]);
      const csvRows = [headers.join(",")];
      data.forEach((row) => {
        const values = headers.map((h) => `"${row[h] ?? ""}"`);
        csvRows.push(values.join(","));
      });

      const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}_report.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Error generating CSV: " + err.message);
    }
  };

  // ---------- NEW helpers for Users / Promoters ----------
  const formatDate = (ts) => {
    if (!ts) return "—";
    // ts might be Firestore Timestamp or JS Date or ISO string
    try {
      if (ts.toDate) {
        return new Date(ts.toDate()).toLocaleString();
      }
      const d = new Date(ts);
      if (!isNaN(d.getTime())) return d.toLocaleString();
      return "—";
    } catch {
      return "—";
    }
  };

  // Filtered arrays derived from usersList
  const promoters = usersList.filter((u) => u.role === "promoter" || u.alsoPromoter === true);
  const students = usersList.filter((u) => u.role === "student");

  // Promo: compute payment status string
  const paymentStatusForUser = (u) => {
    if (u.promoterPaymentStatus) return u.promoterPaymentStatus;
    return u.promoterLastPaidAt ? "paid" : "pending";
  };

  // Pay commission: create a payment record and update user doc fields
  const payCommission = async (user) => {
    try {
      const amountRaw = window.prompt(`Enter amount to pay (INR) for ${user.name || user.email}:`);
      if (amountRaw === null) return; // cancelled
      const amount = parseFloat(amountRaw);
      if (isNaN(amount) || amount <= 0) {
        alert("Invalid amount.");
        return;
      }

      // create payment record
      await addDoc(collection(db, "promoterPayments"), {
        userId: user.id || user.uid,
        userName: user.name || user.email || "",
        amount,
        paidAt: serverTimestamp(),
        adminBy: auth.currentUser ? auth.currentUser.uid : null,
      });

      // update user doc fields
      const userDocRef = doc(db, "users", user.id);
      await updateDoc(userDocRef, {
        promoterPaymentStatus: "paid",
        promoterLastPaidAt: serverTimestamp(),
        promoterLastPaidAmount: amount,
      });

      alert("Payment recorded and user updated.");
    } catch (err) {
      alert("Error while making payment: " + err.message);
    }
  };

  // Optionally set payment to pending / clear -- small helpers
  const setPaymentPending = async (user) => {
    if (!window.confirm("Mark payment status as PENDING for this user?")) return;
    try {
      await updateDoc(doc(db, "users", user.id), { promoterPaymentStatus: "pending" });
      alert("Payment status set to pending.");
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  // If you want to record account deletion date manually (if your system doesn't auto-record it),
  // provide a helper to set deletedAt on user doc. (I left it as an optional button below.)
  const markAccountDeleted = async (user) => {
    if (!window.confirm("Mark this account as deleted (set deletedAt = now)?")) return;
    try {
      await updateDoc(doc(db, "users", user.id), { deletedAt: serverTimestamp() });
      alert("deletedAt set.");
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  // ---------- RENDER ----------
return (
  <div
    className="admin-dashboard"
    style={{
      padding: 16,
      fontFamily:
        "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial",
    }}
  >
    <div
      className="top-nav"
      style={{ display: "flex", gap: 8, marginBottom: 12 }}
    >
      <button
        onClick={() => {
          setViewType("packages");
          navigate("/admin-dashboard");
        }}
        style={navBtnStyle}
      >
        Home
      </button>

      <button
        onClick={() => {
          setViewType("promoters");
          navigate("/approve-promoter");
        }}
        style={navBtnStyle}
      >
        Approve Promoter
      </button>

      <button
        onClick={() => navigate("/promoter-database")}
        style={navBtnStyle}
      >
        Promoter Database
      </button>

      <button
        onClick={() => navigate("/student-database")}
        style={navBtnStyle}
      >
        Student Database
      </button>

      <button
        className="logout-btn"
        onClick={handleLogout}
        style={{
          ...navBtnStyle,
          marginLeft: "auto",
          background: "#ef4444",
          color: "#fff",
        }}
      >
        Logout
      </button>
    </div>


      <div className="admin-header" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Admin Dashboard</h1>
      </div>

      <div className="admin-grid" style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 16 }}>
        {/* LEFT: Form (unchanged) */}
        <div className="card" style={cardStyle}>
          <h2 className="card-title">{editingId ? "Edit Package" : "Create Package"}</h2>

          {/* Class */}
          <div className="form-row" style={formRowStyle}>
            <label>Class <span className="req">*</span></label>
            <select className="input" value={classGrade} onChange={(e) => {
              setClassGrade(e.target.value);
              if (e.target.value === "Professional Course") {
                setPackageName("Full Academic Package");
                setPackageType("Interactive Class");
              } else {
                setPackageType("");
              }
            }} style={inputStyle}>
              <option value="">Select</option>
              {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Syllabus */}
          {classGrade !== "Professional Course" && (
            <div className="form-row" style={formRowStyle}>
              <label>Syllabus <span className="req">*</span></label>
              <select className="input" value={syllabus} onChange={(e) => setSyllabus(e.target.value)} style={inputStyle}>
                <option value="">Select</option>
                {syllabusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          {/* Package Type */}
          <div className="form-row" style={formRowStyle}>
            <label>Package Type <span className="req">*</span></label>
            <select className="input" value={packageType} onChange={(e) => setPackageType(e.target.value)} disabled={classGrade === "Professional Course"} style={inputStyle}>
              <option value="">Select</option>
              {packageTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Package Name */}
          <div className="form-row" style={formRowStyle}>
            <label>Package Name <span className="req">*</span></label>
            <select className="input" value={packageName} onChange={(e) => setPackageName(e.target.value)} disabled={classGrade === "Professional Course"} style={inputStyle}>
              <option value="">Select</option>
              {packageNameOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Dynamic Sections */}
          {packageName === "Concept Based Package" && (
            <>
              <h3 className="section-subtitle" style={{ marginTop: 12 }}>Curriculum Hierarchy</h3>
              <div className="inline" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div className="form-row" style={{ flex: 1 }}>
                  <label>Subject</label>
                  <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} />
                </div>
                <div className="form-row" style={{ flex: 1 }}>
                  <label>Subtopic</label>
                  <input className="input" value={subtopic} onChange={(e) => setSubtopic(e.target.value)} style={inputStyle} />
                </div>
              </div>
              <div className="inline" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div className="form-row" style={{ flex: 1 }}>
                  <label>Chapter</label>
                  <input className="input" value={chapter} onChange={(e) => setChapter(e.target.value)} style={inputStyle} />
                </div>
                <div className="form-row" style={{ flex: 1 }}>
                  <label>Concept</label>
                  <input className="input" value={concept} onChange={(e) => setConcept(e.target.value)} style={inputStyle} />
                </div>
              </div>
            </>
          )}

          {packageName === "Subject Based Package" && (
            <div className="form-row" style={formRowStyle}>
              <label>Subject</label>
              <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} />
            </div>
          )}

          {packageName === "Subject Combo Package" && (
            <div className="form-row" style={formRowStyle}>
              <label>Subjects</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input className="input" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Enter subject" style={inputStyle} />
                <button type="button" onClick={addSubjectToCombo} style={smallBtnStyle}>Add</button>
              </div>
              <div style={{ marginTop: 8 }}>
                {subjects.map((s, i) => <span key={i} style={{ marginRight: "6px", background: "#eef2ff", padding: "4px 8px", borderRadius: 6 }}>{s}</span>)}
              </div>
            </div>
          )}

          {/* Fee & Course Details */}
          {(packageName === "Concept Based Package" || packageName === "Subject Based Package" || packageName === "Subject Combo Package" || packageName === "Full Academic Package") && (
            <>
              <h3 className="section-subtitle" style={{ marginTop: 12 }}>Fee & Duration</h3>
              <div className="inline" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div className="form-row" style={{ flex: 1 }}>
                  <label>Duration (hrs)</label>
                  <input className="input" value={duration} onChange={(e) => setDuration(e.target.value)} style={inputStyle} />
                </div>
                <div className="form-row" style={{ flex: 1 }}>
                  <label>Price <span className="req">*</span></label>
                  <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} style={inputStyle} />
                </div>
              </div>
              <div className="inline" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div className="form-row" style={{ flex: 1 }}>
                  <label>Regular Discount %</label>
                  <input className="input" value={regularDiscount} onChange={(e) => setRegularDiscount(e.target.value)} style={inputStyle} />
                </div>
                <div className="form-row" style={{ flex: 1 }}>
                  <label>Additional Discount %</label>
                  <input className="input" value={additionalDiscount} onChange={(e) => setAdditionalDiscount(e.target.value)} style={inputStyle} />
                </div>
                <div className="form-row" style={{ flex: 1 }}>
                  <label>Commission % <span className="req">*</span></label>
                  <input className="input" value={commission} onChange={(e) => setCommission(e.target.value)} style={inputStyle} />
                </div>
              </div>

              <div className="form-row" style={formRowStyle}>
                <label>Course Details</label>
                <textarea className="input" value={courseDetails} onChange={(e) => setCourseDetails(e.target.value)} rows={3} style={textareaStyle} />
              </div>

              <div className="form-row" style={formRowStyle}>
                <label>Freebies / Gift (optional)</label>
                <textarea className="input" value={freebies} onChange={(e) => setFreebies(e.target.value)} rows={2} style={textareaStyle} />
              </div>

              <div className="total-box" style={{ marginTop: 8 }}>
                Total Payable: <strong>₹{totalPayable}</strong>
              </div>
            </>
          )}

          {/* Actions */}
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="primary-btn" onClick={handleAddOrUpdate} style={primaryBtnStyle}>{editingId ? "Update Package" : "Add Package"}</button>
            {editingId && <button className="ghost-btn" onClick={resetForm} style={ghostBtnStyle}>Cancel</button>}
          </div>

          {/* Reports */}
          <div className="report-section" style={{ marginTop: 18 }}>
            <h3 className="section-subtitle">Download Reports</h3>
            <div className="inline" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div className="form-row" style={{ minWidth: 160 }}>
                <label>Start Date</label>
                <input type="date" className="input" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)} style={inputStyle} />
              </div>
              <div className="form-row" style={{ minWidth: 160 }}>
                <label>End Date</label>
                <input type="date" className="input" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="primary-btn" onClick={() => downloadCSV("packages")} style={primaryBtnStyle}>Download Packages Report</button>
              <button className="primary-btn" onClick={() => downloadCSV("promoters")} style={primaryBtnStyle}>Download Promoters Report</button>
              <button className="primary-btn" onClick={() => downloadCSV("students")} style={primaryBtnStyle}>Download Students Report</button>
            </div>
          </div>
        </div>

        {/* RIGHT: list area - now supports Packages / Promoters / Students */}
        <div className="card" style={{ ...cardStyle, padding: 14 }}>
          <h2 className="card-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>
              {viewType === "packages" ? "Existing Packages" : viewType === "promoters" ? "Promoter Database" : "Student Database"}
            </span>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => setViewType("packages")} style={{ ...smallFilterBtn, background: viewType === "packages" ? "#0ea5e9" : "#f3f4f6", color: viewType === "packages" ? "#fff" : "#111827" }}>Packages</button>
              <button onClick={() => setViewType("promoters")} style={{ ...smallFilterBtn, background: viewType === "promoters" ? "#0ea5e9" : "#f3f4f6", color: viewType === "promoters" ? "#fff" : "#111827" }}>Promoters</button>
              <button onClick={() => setViewType("students")} style={{ ...smallFilterBtn, background: viewType === "students" ? "#0ea5e9" : "#f3f4f6", color: viewType === "students" ? "#fff" : "#111827" }}>Students</button>
            </div>
          </h2>

          {/* Show filters only for packages view (preserve original UI) */}
          {viewType === "packages" && (
            <div className="filter-section" style={{ marginBottom: 12 }}>
              <h4 style={{ margin: "8px 0" }}>Filters</h4>
              <div className="inline" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select className="input" value={filterClass} onChange={(e) => setFilterClass(e.target.value)} style={inputStyle}>
                  <option value="">Class</option>
                  {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="input" value={filterSyllabus} onChange={(e) => setFilterSyllabus(e.target.value)} style={inputStyle}>
                  <option value="">Syllabus</option>
                  {syllabusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="input" value={filterPackageType} onChange={(e) => setFilterPackageType(e.target.value)} style={inputStyle}>
                  <option value="">Package Type</option>
                  {packageTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className="input" value={filterPackageName} onChange={(e) => setFilterPackageName(e.target.value)} style={inputStyle}>
                  <option value="">Package Name</option>
                  {packageNameOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* User text filter when viewing promoters/students */}
          {(viewType === "promoters" || viewType === "students") && (
            <div style={{ marginBottom: 12 }}>
              <input placeholder="Search by name / email / phone" className="input" value={userFilterText} onChange={(e) => setUserFilterText(e.target.value)} style={{ ...inputStyle }} />
            </div>
          )}

          {/* LIST */}
          <div className="list" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {viewType === "packages" && (filteredPackages.length === 0 ? <div className="empty" style={{ color: "#666" }}>No packages found.</div> : (
              filteredPackages.map((pkg) => {
                // compute safe numbers
                const priceNum = parseFloat(pkg.price || 0);
                const rd = parseFloat(pkg.regularDiscount || 0);
                const ad = parseFloat(pkg.additionalDiscount || 0);
                const payableNum = parseFloat(pkg.totalPayable || pkg.totalPayable === 0 ? pkg.totalPayable : pkg.price) || 0;
                const durationNum = parseFloat(pkg.duration || 0);
                const ratePerHr = durationNum > 0 ? (payableNum / durationNum) : null;

                // freebies normalization
                const freebiesText = Array.isArray(pkg.freebies) ? pkg.freebies.join(", ") : (pkg.freebies || "");

                return (
                  <div key={pkg.id} className="pkg" style={{
                    borderRadius: 10,
                    border: "1px solid #e6e6e6",
                    padding: 12,
                    background: "#fff",
                    boxShadow: "0 4px 10px rgba(16,24,40,0.04)"
                  }}>
                    <div className="pkg-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{pkg.packageName}</div>
                      <div style={{ fontSize: 13, color: "#374151", background: "#f3f4f6", padding: "4px 8px", borderRadius: 8 }}>{pkg.packageType}</div>
                    </div>

                    <div className="pkg-meta" style={{ marginTop: 6, fontSize: 13, color: "#6b7280" }}>
                      Class {pkg.classGrade} {pkg.classGrade !== "Professional Course" ? `• ${pkg.syllabus}` : ""}
                    </div>

                    {/* Subject */}
                    {pkg.subject && (
                      <div className="pkg-detail" style={{ marginTop: 8, fontSize: 14 }}>
                        <strong>Subject:</strong> <span style={{ marginLeft: 6 }}>{pkg.subject}</span>
                      </div>
                    )}

                    {/* Course details */}
                    {pkg.courseDetails && (
                      <div className="pkg-detail" style={{ marginTop: 6, fontSize: 14, color: "#374151" }}>
                        <strong>Course:</strong> <span style={{ marginLeft: 6 }}>{pkg.courseDetails}</span>
                      </div>
                    )}

                    {/* Duration & Rate */}
                    {pkg.duration && (
                      <div style={{ marginTop: 8, fontSize: 14 }}>
                        <strong>Duration:</strong> <span style={{ marginLeft: 6 }}>{pkg.duration} hrs</span>
                        <span style={{ marginLeft: 12 }}>
                          <strong>Rate/hr:</strong>{" "}
                          <span style={{ marginLeft: 6 }}>{ratePerHr !== null ? `₹${Number(ratePerHr).toFixed(2)}` : "—"}</span>
                        </span>
                      </div>
                    )}

                    {/* Freebies */}
                    {freebiesText && freebiesText.trim() !== "" && (
                      <div style={{ marginTop: 8, fontSize: 13, color: "#065f46", background: "#ecfdf5", padding: "6px 8px", borderRadius: 8 }}>
                        <strong>Freebies:</strong> <span style={{ marginLeft: 6 }}>{freebiesText}</span>
                      </div>
                    )}

                    {/* Pricing & Discounts */}
                    <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontSize: 14 }}>
                        <div>
                          <strong>Base Price:</strong>{" "}
                          <span style={{ textDecoration: (rd > 0 || ad > 0) ? "line-through" : "none", marginLeft: 6 }}>
                            ₹{priceNum.toFixed(2)}
                          </span>
                        </div>
                        {(rd > 0 || ad > 0) && (
                          <div style={{ marginTop: 4 }}>
                            <strong style={{ color: "#16a34a" }}>Now:</strong>{" "}
                            <span style={{ marginLeft: 6, fontWeight: 700 }}>₹{payableNum.toFixed(2)}</span>
                          </div>
                        )}
                      </div>

                      {(rd > 0 || ad > 0) && (
                        <div style={{ fontSize: 13, color: "#b91c1c" }}>
                          <div><strong>Discounts:</strong></div>
                          <div style={{ marginTop: 4 }}>
                            {rd > 0 && <span>{rd}% regular</span>}
                            {(rd > 0 && ad > 0) && <span> + </span>}
                            {ad > 0 && <span>{ad}% additional</span>}
                          </div>
                        </div>
                      )}

                      <div style={{ marginLeft: "auto", textAlign: "right", minWidth: 140 }}>
                        <div style={{ fontSize: 13, color: "#6b7280" }}>Total Payable</div>
                        <div style={{ fontWeight: 800, fontSize: 16 }}>₹{(payableNum || 0).toFixed(2)}</div>
                      </div>
                    </div>

                    {/* Edit / Delete */}
                    <div className="pkg-actions" style={{ marginTop: 12, display: "flex", gap: 8 }}>
                      <button onClick={() => startEdit(pkg)} style={{ flex: 1, background: "#0ea5e9", color: "#fff", border: "none", padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>Edit</button>
                      <button onClick={() => handleDelete(pkg.id)} style={{ flex: 1, background: "#ef4444", color: "#fff", border: "none", padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>Delete</button>
                    </div>
                  </div>
                );
              })
            ))}

            {/* PROMOTERS view */}
            {viewType === "promoters" && (
              <>
                {promoters.filter(u => {
                  if (!userFilterText) return true;
                  const t = userFilterText.toLowerCase();
                  return (u.name || "").toLowerCase().includes(t) || (u.email || "").toLowerCase().includes(t) || (u.phone || "").toLowerCase().includes(t);
                }).length === 0 ? <div className="empty" style={{ color: "#666" }}>No promoters found.</div> : (
                  promoters.filter(u => {
                    if (!userFilterText) return true;
                    const t = userFilterText.toLowerCase();
                    return (u.name || "").toLowerCase().includes(t) || (u.email || "").toLowerCase().includes(t) || (u.phone || "").toLowerCase().includes(t);
                  }).map((u) => (
                    <div key={u.id} className="pkg" style={{
                      borderRadius: 10,
                      border: "1px solid #e6e6e6",
                      padding: 12,
                      background: "#fff",
                      boxShadow: "0 4px 10px rgba(16,24,40,0.04)"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>{u.name || u.email}</div>
                          <div style={{ fontSize: 13, color: "#6b7280" }}>{u.email} • {u.phone}</div>
                        </div>

                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>Enrollment</div>
                          <div style={{ fontWeight: 700 }}>{formatDate(u.createdAt)}</div>
                        </div>
                      </div>

                      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <div style={{ fontSize: 13 }}>
                          <div><strong>Approved:</strong> {u.promoterApproved ? "Yes" : "No"}</div>
                          <div style={{ marginTop: 6 }}><strong>Business Area:</strong> {u.businessArea || "—"}</div>
                        </div>

                        <div style={{ marginLeft: "auto", textAlign: "right", minWidth: 160 }}>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>Payment Status</div>
                          <div style={{ fontWeight: 800, fontSize: 14 }}>{(paymentStatusForUser(u) || "Not set").toUpperCase()}</div>
                          {u.promoterLastPaidAmount && <div style={{ fontSize: 13 }}>₹{u.promoterLastPaidAmount} • {formatDate(u.promoterLastPaidAt)}</div>}
                        </div>
                      </div>

                      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                        <button onClick={() => payCommission(u)} style={{ flex: 1, background: "#10b981", color: "#fff", border: "none", padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>Pay Commission</button>
                        <button onClick={() => setPaymentPending(u)} style={{ flex: 1, background: "#f59e0b", color: "#fff", border: "none", padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>Mark Pending</button>
                        <button onClick={() => markAccountDeleted(u)} style={{ flex: 1, background: "#ef4444", color: "#fff", border: "none", padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>Mark Deleted</button>
                      </div>

                      <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                        <div><strong>Enrollment:</strong> {formatDate(u.createdAt)}</div>
                        <div><strong>Deleted At:</strong> {formatDate(u.deletedAt)}</div>
                        <div><strong>UID:</strong> {u.uid || u.id}</div>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}

            {/* STUDENTS view */}
            {viewType === "students" && (
              <>
                {students.filter(u => {
                  if (!userFilterText) return true;
                  const t = userFilterText.toLowerCase();
                  return (u.name || "").toLowerCase().includes(t) || (u.email || "").toLowerCase().includes(t) || (u.phone || "").toLowerCase().includes(t);
                }).length === 0 ? <div className="empty" style={{ color: "#666" }}>No students found.</div> : (
                  students.filter(u => {
                    if (!userFilterText) return true;
                    const t = userFilterText.toLowerCase();
                    return (u.name || "").toLowerCase().includes(t) || (u.email || "").toLowerCase().includes(t) || (u.phone || "").toLowerCase().includes(t);
                  }).map((u) => (
                    <div key={u.id} className="pkg" style={{
                      borderRadius: 10,
                      border: "1px solid #e6e6e6",
                      padding: 12,
                      background: "#fff",
                      boxShadow: "0 4px 10px rgba(16,24,40,0.04)"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>{u.name || u.email}</div>
                          <div style={{ fontSize: 13, color: "#6b7280" }}>{u.email} • {u.phone}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>Enrollment</div>
                          <div style={{ fontWeight: 700 }}>{formatDate(u.createdAt)}</div>
                        </div>
                      </div>

                      <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                        <div><strong>Syllabus / Class:</strong> {u.syllabus || "—"} {u.classGrade ? `• ${u.classGrade}` : ""}</div>
                        <div><strong>Deleted At:</strong> {formatDate(u.deletedAt)}</div>
                        <div><strong>UID:</strong> {u.uid || u.id}</div>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Inline CSS styles (kept in same file) */}
      <style>{`
        /* Basic resets for inputs/buttons used above */
        .input {
          box-sizing: border-box;
        }
        @media (max-width: 980px) {
          .admin-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

/* Inline helper JS styles (to keep the file tidy) */
const navBtnStyle = {
  background: "#111827",
  color: "#fff",
  border: "none",
  padding: "8px 12px",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 600,
};

const cardStyle = {
  background: "#ffffff",
  padding: 16,
  borderRadius: 12,
  boxShadow: "0 8px 24px rgba(16,24,40,0.06)",
};

const formRowStyle = {
  marginTop: 10,
  display: "flex",
  flexDirection: "column",
};

const inputStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #e6e6e6",
  outline: "none",
  boxSizing: "border-box",
  width: "100%",
};

const textareaStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #e6e6e6",
  outline: "none",
  boxSizing: "border-box",
  width: "100%",
};

const primaryBtnStyle = {
  background: "#0ea5e9",
  color: "#fff",
  border: "none",
  padding: "10px 14px",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 700,
};

const ghostBtnStyle = {
  background: "#f3f4f6",
  color: "#111827",
  border: "none",
  padding: "10px 14px",
  borderRadius: 8,
  cursor: "pointer",
  marginLeft: 8,
};

const smallBtnStyle = {
  background: "#111827",
  color: "#fff",
  border: "none",
  padding: "8px 10px",
  borderRadius: 6,
  cursor: "pointer",
};

const smallFilterBtn = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
};
