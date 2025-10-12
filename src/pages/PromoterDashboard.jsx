// src/pages/PromoterDashboard.jsx
import React, { useEffect, useState } from "react";
import { auth, db } from "../firebase/firebaseConfig";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { FaTachometerAlt, FaBoxOpen, FaUsers, FaMoneyBillWave, FaUserCircle, FaSignOutAlt } from "react-icons/fa";

const PromoterDashboard = () => {
  const navigate = useNavigate();

  // Main states
  const [promoterData, setPromoterData] = useState(null);
  const [packages, setPackages] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedGrade, setSelectedGrade] = useState("");
  const [selectedSyllabus, setSelectedSyllabus] = useState("");
  const [selectedPackageType, setSelectedPackageType] = useState("");
  const [selectedPackageName, setSelectedPackageName] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedSubtopic, setSelectedSubtopic] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");

  // Calculator
  const [selectedPackages, setSelectedPackages] = useState([]);
  const [totalCommission, setTotalCommission] = useState(0);

  // Sidebar view
  const [activeView, setActiveView] = useState("dashboard"); // dashboard | packages | students | commission | profile

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) return navigate("/");

      try {
        const promoterDoc = await getDoc(doc(db, "users", user.uid));
        if (
  !promoterDoc.exists() ||
  !(promoterDoc.data().role === "promoter" || promoterDoc.data().alsoPromoter === true)
) {
  return navigate("/");
}

        const promoter = promoterDoc.data();
        setPromoterData(promoter);

        // Fetch students referred by this promoter
        const studentQ = query(
          collection(db, "users"),
          where("referralId", "==", promoter.uniqueId)
        );
        const studentSnapshot = await getDocs(studentQ);
        setStudents(studentSnapshot.docs.map((d) => ({ id: d.id, ...d.data() })));

        // Fetch all packages
        const packageSnap = await getDocs(collection(db, "packages"));
        setPackages(packageSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  // Calculate total commission
  useEffect(() => {
    const total = selectedPackages.reduce((acc, pkg) => {
      const price = parseFloat(pkg.totalPayable) || 0;
      const commission = parseFloat(pkg.commission) || 0;
      return acc + (price * commission) / 100;
    }, 0);
    setTotalCommission(total.toFixed(2));
  }, [selectedPackages]);

  const handleLogout = async () => {
    await auth.signOut();
    navigate("/");
  };

  const togglePackageSelection = (pkg) => {
    if (selectedPackages.find((p) => p.id === pkg.id)) return;
    setSelectedPackages([...selectedPackages, pkg]);
  };

  const grades = ["6th", "7th", "8th", "9th", "10th"];
  const syllabuses = ["ICSE", "CBSE", "State Karnataka"];
  const packageTypes = ["Interactive Class", "Test"];

  const filteredPackages = packages
    .filter((p) => (selectedGrade ? p.classGrade === selectedGrade : true))
    .filter((p) => (selectedSyllabus ? p.syllabus === selectedSyllabus : true))
    .filter((p) => (selectedPackageType ? p.packageType === selectedPackageType : true))
    .filter((p) => (selectedPackageName ? p.packageName === selectedPackageName : true))
    .filter((p) => (selectedSubject ? p.subject === selectedSubject : true))
    .filter((p) => (selectedSubtopic ? p.subtopic === selectedSubtopic : true))
    .filter((p) => (selectedChapter ? p.chapter === selectedChapter : true));

  if (loading) return <div style={{ textAlign: "center", paddingTop: "50px" }}>Loading...</div>;

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "Arial, sans-serif" }}>
      {/* Sidebar */}
      <div style={{
        width: "220px",
        background: "linear-gradient(180deg, #0f2027, #203a43, #2c5364)",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        padding: "20px"
      }}>
        <h2 style={{ textAlign: "center", marginBottom: "20px", color: "#ffd700" }}>ISP Promoter</h2>
        <ul style={{ listStyle: "none", padding: 0 }}>
          <SidebarItem label="Dashboard" active={activeView === "dashboard"} color="#ff7f50" icon={<FaTachometerAlt />} onClick={() => setActiveView("dashboard")} />
          <SidebarItem label="Packages" active={activeView === "packages"} color="#20b2aa" icon={<FaBoxOpen />} onClick={() => setActiveView("packages")} />
          <SidebarItem label="Students" active={activeView === "students"} color="#ff69b4" icon={<FaUsers />} onClick={() => setActiveView("students")} />
          <SidebarItem label="Commission Earned" active={activeView === "commission"} color="#8a2be2" icon={<FaMoneyBillWave />} onClick={() => setActiveView("commission")} />
          <SidebarItem label="Profile" active={activeView === "profile"} color="#1e90ff" icon={<FaUserCircle />} onClick={() => setActiveView("profile")} />
          <SidebarItem label="Logout" active={false} color="#ff4500" icon={<FaSignOutAlt />} onClick={handleLogout} />
        </ul>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, background: "#f4f7f9", padding: "20px 30px", overflowY: "auto" }}>
        <h1>Welcome, {promoterData?.name}</h1>

        {activeView === "dashboard" && (
          <div>
            <h2>Dashboard Overview</h2>
            <p>Total Students Referred: {students.length}</p>
            <p>Total Packages Available: {packages.length}</p>
            <p>Total Selected Commission: ₹{totalCommission}</p>
          </div>
        )}

        {activeView === "packages" && (
          <div>
            <FiltersSection
              grades={grades} syllabuses={syllabuses} packageTypes={packageTypes} packages={packages}
              selectedGrade={selectedGrade} setSelectedGrade={setSelectedGrade}
              selectedSyllabus={selectedSyllabus} setSelectedSyllabus={setSelectedSyllabus}
              selectedPackageType={selectedPackageType} setSelectedPackageType={setSelectedPackageType}
              selectedPackageName={selectedPackageName} setSelectedPackageName={setSelectedPackageName}
              selectedSubject={selectedSubject} setSelectedSubject={setSelectedSubject}
              selectedSubtopic={selectedSubtopic} setSelectedSubtopic={setSelectedSubtopic}
              selectedChapter={selectedChapter} setSelectedChapter={setSelectedChapter}
            />
            <PackagesList packages={filteredPackages} togglePackageSelection={togglePackageSelection} />
            {selectedPackages.length > 0 && <CalculatorPanel selectedPackages={selectedPackages} totalCommission={totalCommission} />}
          </div>
        )}

        {activeView === "students" && <StudentsTable students={students} showCommissionOnly={false} />}
        {activeView === "commission" && <StudentsTable students={students} showCommissionOnly={true} />}
        {activeView === "profile" && (
          <div>
            <h2>Profile</h2>
            <p><strong>Name:</strong> {promoterData?.name}</p>
            <p><strong>Email:</strong> {promoterData?.email}</p>
            <p><strong>Phone:</strong> {promoterData?.phone}</p>
            <p><strong>Unique ID:</strong> {promoterData?.uniqueId}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Sidebar Item Component
const SidebarItem = ({ label, active, color, onClick, icon }) => (
  <li
    onClick={onClick}
    style={{
      padding: "10px 0",
      cursor: "pointer",
      borderBottom: "1px solid rgba(255,255,255,0.2)",
      backgroundColor: active ? color : "transparent",
      borderRadius: "5px",
      textAlign: "center",
      marginBottom: "5px",
      transition: "0.3s",
      fontWeight: active ? "bold" : "normal",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px"
    }}
  >
    {icon} {label}
  </li>
);

// Students Table Component
const StudentsTable = ({ students, showCommissionOnly }) => (
  <div>
    <h2>{showCommissionOnly ? "Commission Earned" : "Students Referred"}</h2>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {!showCommissionOnly && <th style={thTdStyle}>Name</th>}
          {!showCommissionOnly && <th style={thTdStyle}>Email</th>}
          {!showCommissionOnly && <th style={thTdStyle}>Class</th>}
          {!showCommissionOnly && <th style={thTdStyle}>Syllabus</th>}
          <th style={thTdStyle}>Commission Earned</th>
        </tr>
      </thead>
      <tbody>
        {students.map((s) => (
          <tr key={s.id}>
            {!showCommissionOnly && <td style={thTdStyle}>{s.name}</td>}
            {!showCommissionOnly && <td style={thTdStyle}>{s.email}</td>}
            {!showCommissionOnly && <td style={thTdStyle}>{s.classGrade || "-"}</td>}
            {!showCommissionOnly && <td style={thTdStyle}>{s.syllabus || "-"}</td>}
            <td style={thTdStyle}>₹{s.commissionEarned || 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// Filters Section Component
const FiltersSection = ({ grades, syllabuses, packageTypes, packages, selectedGrade, setSelectedGrade, selectedSyllabus, setSelectedSyllabus, selectedPackageType, setSelectedPackageType, selectedPackageName, setSelectedPackageName, selectedSubject, setSelectedSubject, selectedSubtopic, setSelectedSubtopic, selectedChapter, setSelectedChapter }) => (
  <div style={{ marginBottom: "20px" }}>
    <label>Class:</label>
    <select value={selectedGrade} onChange={(e) => { setSelectedGrade(e.target.value); resetFilters(setSelectedSyllabus, setSelectedPackageType, setSelectedPackageName, setSelectedSubject, setSelectedSubtopic, setSelectedChapter); }} style={filterStyle}>
      <option value="">All</option>
      {grades.map(g => <option key={g} value={g}>{g}</option>)}
    </select>

    <label style={{ marginLeft: "10px" }}>Syllabus:</label>
    <select value={selectedSyllabus} onChange={(e) => { setSelectedSyllabus(e.target.value); resetFilters(setSelectedPackageType, setSelectedPackageName, setSelectedSubject, setSelectedSubtopic, setSelectedChapter); }} style={filterStyle}>
      <option value="">All</option>
      {syllabuses.map(s => <option key={s} value={s}>{s}</option>)}
    </select>

    <label style={{ marginLeft: "10px" }}>Package Type:</label>
    <select value={selectedPackageType} onChange={(e) => { setSelectedPackageType(e.target.value); resetFilters(setSelectedPackageName, setSelectedSubject, setSelectedSubtopic, setSelectedChapter); }} style={filterStyle}>
      <option value="">All</option>
      {packageTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
    </select>

    <label style={{ marginLeft: "10px" }}>Package Name:</label>
    <select value={selectedPackageName} onChange={(e) => { setSelectedPackageName(e.target.value); resetFilters(setSelectedSubject, setSelectedSubtopic, setSelectedChapter); }} style={filterStyle}>
      <option value="">All</option>
      {[...new Set(packages.map(p => p.packageName))].map(pn => <option key={pn} value={pn}>{pn}</option>)}
    </select>

    {selectedPackageName === "Concept Based Package" && (
      <>
        <label style={{ marginLeft: "10px" }}>Subject:</label>
        <select value={selectedSubject} onChange={(e) => { setSelectedSubject(e.target.value); setSelectedSubtopic(""); setSelectedChapter(""); }} style={filterStyle}>
          <option value="">All</option>
          {[...new Set(packages.filter(p => p.packageName === "Concept Based Package").map(p => p.subject))].map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <label style={{ marginLeft: "10px" }}>Subtopic:</label>
        <select value={selectedSubtopic} onChange={(e) => { setSelectedSubtopic(e.target.value); setSelectedChapter(""); }} style={filterStyle}>
          <option value="">All</option>
          {[...new Set(packages.filter(p => p.subtopic && p.subject === selectedSubject).map(p => p.subtopic))].map(st => <option key={st} value={st}>{st}</option>)}
        </select>

        <label style={{ marginLeft: "10px" }}>Chapter:</label>
        <select value={selectedChapter} onChange={(e) => setSelectedChapter(e.target.value)} style={filterStyle}>
          <option value="">All</option>
          {[...new Set(packages.filter(p => p.chapter && p.subtopic === selectedSubtopic).map(p => p.chapter))].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </>
    )}
  </div>
);

// Packages List Component
const PackagesList = ({ packages, togglePackageSelection }) => (
  <div>
    <h2>Available Packages</h2>
    {packages.map(pkg => (
      <div key={pkg.id} style={{ border: "1px solid #ccc", borderRadius: "8px", padding: "10px", marginBottom: "10px", background: "#fff" }}>
        <p><strong>{pkg.packageName}</strong> ({pkg.packageType})</p>
        <p>Class: {pkg.classGrade} • Syllabus: {pkg.syllabus}</p>
        <p>Total Payable: ₹{pkg.totalPayable} • Commission: {pkg.commission}%</p>
        <button onClick={() => togglePackageSelection(pkg)}>Add to Calculator</button>
      </div>
    ))}
  </div>
);

// Calculator Panel Component
const CalculatorPanel = ({ selectedPackages, totalCommission }) => (
  <div style={{ marginTop: "20px", padding: "15px", background: "#fff", borderRadius: "10px" }}>
    <h3>Selected Packages</h3>
    <ul>
      {selectedPackages.map(p => (
        <li key={p.id}>{p.classGrade} • {p.packageType} • {p.packageName} • Commission {p.commission}%</li>
      ))}
    </ul>
    <h3>Total Potential Commission: ₹{totalCommission}</h3>
  </div>
);

const resetFilters = (...setters) => setters.forEach(fn => fn(""));

const thTdStyle = { border: "1px solid #ccc", padding: "8px 12px", textAlign: "left", background: "#e0e0e0" };
const filterStyle = { marginLeft: "5px", padding: "5px" };

export default PromoterDashboard;
