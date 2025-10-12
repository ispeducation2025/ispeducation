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
} from "firebase/firestore";
import "./AdminDashboard.css";

const ADMIN_UID = "Q3Z7mgam8IOMQWQqAdwWEQmpqNn2";

const classOptions = ["6th", "7th", "8th", "9th", "10th", "Professional Course"];
const syllabusOptions = ["ICSE", "CBSE", "State Karnataka"];
const packageTypeOptions = ["Interactive Class"];
const packageNameOptions = [
  "Concept Based Package",
  "Subject Based Package",
  "Subject Combo Package",
  "Full Academic Package",
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

  // State
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

  // Fetch packages
  useEffect(() => {
    fetchPackages();
  }, []);

  const fetchPackages = async () => {
    const snap = await getDocs(collection(db, "packages"));
    const allPackages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setPackages(allPackages);
  };

  // Apply filters whenever packages or filter states change
  useEffect(() => {
    let filtered = [...packages];
    if (filterClass) filtered = filtered.filter((p) => p.classGrade === filterClass);
    if (filterSyllabus) filtered = filtered.filter((p) => p.syllabus === filterSyllabus);
    if (filterPackageType) filtered = filtered.filter((p) => p.packageType === filterPackageType);
    if (filterPackageName) filtered = filtered.filter((p) => p.packageName === filterPackageName);
    setFilteredPackages(filtered);
  }, [packages, filterClass, filterSyllabus, filterPackageType, filterPackageName]);

  // Calculate total payable dynamically
  useEffect(() => {
    const p = parseFloat(price) || 0;
    const rd = parseFloat(regularDiscount) || 0;
    const ad = parseFloat(additionalDiscount) || 0;
    const total = p - (p * rd) / 100 - (p * ad) / 100;
    setTotalPayable(total.toFixed(2));
  }, [price, regularDiscount, additionalDiscount]);

  // Reset form
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

  // Add or update package
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
    fetchPackages();
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
      fetchPackages();
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

  // CSV Download
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

  return (
    <div className="admin-dashboard">
      <div className="top-nav">
        <button onClick={() => navigate("/admin-dashboard")}>Home</button>
        <button onClick={() => navigate("/approve-promoter")}>Approve Promoter</button>
        <button onClick={() => navigate("/promoter-database")}>Promoter Database</button>
        <button onClick={() => navigate("/student-database")}>Student Database</button>
        <button className="logout-btn" onClick={handleLogout}>Logout</button>
      </div>

      <div className="admin-header">
        <h1>Admin Dashboard</h1>
      </div>

      <div className="admin-grid">
        {/* LEFT: Form */}
        <div className="card">
          <h2 className="card-title">{editingId ? "Edit Package" : "Create Package"}</h2>

          {/* Class */}
          <div className="form-row">
            <label>Class <span className="req">*</span></label>
            <select className="input" value={classGrade} onChange={(e) => {
              setClassGrade(e.target.value);
              if (e.target.value === "Professional Course") {
                setPackageName("Full Academic Package");
                setPackageType("Interactive Class");
              } else {
                setPackageType("");
              }
            }}>
              <option value="">Select</option>
              {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Syllabus */}
          {classGrade !== "Professional Course" && (
            <div className="form-row">
              <label>Syllabus <span className="req">*</span></label>
              <select className="input" value={syllabus} onChange={(e) => setSyllabus(e.target.value)}>
                <option value="">Select</option>
                {syllabusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          {/* Package Type */}
          <div className="form-row">
            <label>Package Type <span className="req">*</span></label>
            <select className="input" value={packageType} onChange={(e) => setPackageType(e.target.value)} disabled={classGrade === "Professional Course"}>
              <option value="">Select</option>
              {packageTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Package Name */}
          <div className="form-row">
            <label>Package Name <span className="req">*</span></label>
            <select className="input" value={packageName} onChange={(e) => setPackageName(e.target.value)} disabled={classGrade === "Professional Course"}>
              <option value="">Select</option>
              {packageNameOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Dynamic Sections */}
          {packageName === "Concept Based Package" && (
            <>
              <h3 className="section-subtitle">Curriculum Hierarchy</h3>
              <div className="inline">
                <div className="form-row">
                  <label>Subject</label>
                  <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Subtopic</label>
                  <input className="input" value={subtopic} onChange={(e) => setSubtopic(e.target.value)} />
                </div>
              </div>
              <div className="inline">
                <div className="form-row">
                  <label>Chapter</label>
                  <input className="input" value={chapter} onChange={(e) => setChapter(e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Concept</label>
                  <input className="input" value={concept} onChange={(e) => setConcept(e.target.value)} />
                </div>
              </div>
            </>
          )}

          {packageName === "Subject Based Package" && (
            <div className="form-row">
              <label>Subject</label>
              <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          )}

          {packageName === "Subject Combo Package" && (
            <div className="form-row">
              <label>Subjects</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input className="input" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Enter subject" />
                <button type="button" onClick={addSubjectToCombo}>Add</button>
              </div>
              <div>
                {subjects.map((s, i) => <span key={i} style={{ marginRight: "6px" }}>{s}</span>)}
              </div>
            </div>
          )}

          {/* Fee & Course Details */}
          {(packageName === "Concept Based Package" || packageName === "Subject Based Package" || packageName === "Subject Combo Package" || packageName === "Full Academic Package") && (
            <>
              <h3 className="section-subtitle">Fee & Duration</h3>
              <div className="inline">
                <div className="form-row">
                  <label>Duration (hrs)</label>
                  <input className="input" value={duration} onChange={(e) => setDuration(e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Price <span className="req">*</span></label>
                  <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} />
                </div>
              </div>
              <div className="inline">
                <div className="form-row">
                  <label>Regular Discount %</label>
                  <input className="input" value={regularDiscount} onChange={(e) => setRegularDiscount(e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Additional Discount %</label>
                  <input className="input" value={additionalDiscount} onChange={(e) => setAdditionalDiscount(e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Commission % <span className="req">*</span></label>
                  <input className="input" value={commission} onChange={(e) => setCommission(e.target.value)} />
                </div>
              </div>

              <div className="form-row">
                <label>Course Details</label>
                <textarea className="input" value={courseDetails} onChange={(e) => setCourseDetails(e.target.value)} rows={3} />
              </div>

              <div className="form-row">
                <label>Freebies / Gift (optional)</label>
                <textarea className="input" value={freebies} onChange={(e) => setFreebies(e.target.value)} rows={2} />
              </div>

              <div className="total-box">
                Total Payable: <strong>₹{totalPayable}</strong>
              </div>
            </>
          )}

          {/* Actions */}
          <div className="actions">
            <button className="primary-btn" onClick={handleAddOrUpdate}>{editingId ? "Update Package" : "Add Package"}</button>
            {editingId && <button className="ghost-btn" onClick={resetForm}>Cancel</button>}
          </div>

          {/* Reports */}
          <div className="report-section">
            <h3 className="section-subtitle">Download Reports</h3>
            <div className="inline">
              <div className="form-row">
                <label>Start Date</label>
                <input type="date" className="input" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)} />
              </div>
              <div className="form-row">
                <label>End Date</label>
                <input type="date" className="input" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)} />
              </div>
            </div>
            <div className="actions">
              <button className="primary-btn" onClick={() => downloadCSV("packages")}>Download Packages Report</button>
              <button className="primary-btn" onClick={() => downloadCSV("promoters")}>Download Promoters Report</button>
              <button className="primary-btn" onClick={() => downloadCSV("students")}>Download Students Report</button>
            </div>
          </div>
        </div>

        {/* RIGHT: Existing Packages */}
        <div className="card">
          <h2 className="card-title">Existing Packages</h2>

          {/* Filters */}
          <div className="filter-section">
            <h4>Filters</h4>
            <div className="inline">
              <select className="input" value={filterClass} onChange={(e) => setFilterClass(e.target.value)}>
                <option value="">Class</option>
                {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="input" value={filterSyllabus} onChange={(e) => setFilterSyllabus(e.target.value)}>
                <option value="">Syllabus</option>
                {syllabusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="input" value={filterPackageType} onChange={(e) => setFilterPackageType(e.target.value)}>
                <option value="">Package Type</option>
                {packageTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="input" value={filterPackageName} onChange={(e) => setFilterPackageName(e.target.value)}>
                <option value="">Package Name</option>
                {packageNameOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <div className="list">
            {filteredPackages.length === 0 ? <div className="empty">No packages found.</div> : (
              filteredPackages.map((pkg) => (
                <div className="pkg" key={pkg.id}>
                  <div className="pkg-head">
                    <div className="pkg-name">{pkg.packageName}</div>
                    <div className="pkg-type">{pkg.packageType}</div>
                  </div>
                  <div className="pkg-meta">
                    Class {pkg.classGrade} {pkg.classGrade !== "Professional Course" ? `• ${pkg.syllabus}` : ""}
                  </div>
                  <div className="pkg-actions">
                    <button onClick={() => startEdit(pkg)}>Edit</button>
                    <button onClick={() => handleDelete(pkg.id)}>Delete</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
