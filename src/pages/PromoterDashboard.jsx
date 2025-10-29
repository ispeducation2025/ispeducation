// src/pages/PromoterDashboard.jsx
import React, { useEffect, useState } from "react";
import { auth, db } from "../firebase/firebaseConfig";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import {
  FaTachometerAlt,
  FaBoxOpen,
  FaUsers,
  FaMoneyBillWave,
  FaUserCircle,
  FaSignOutAlt,
} from "react-icons/fa";

// ================= Sidebar Item =================
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
      gap: "8px",
    }}
  >
    {icon} {label}
  </li>
);

// ================= Packages Table =================
const PackagesTable = ({ packages }) => (
  <div style={{ marginTop: "20px" }}>
    <h2>All Packages</h2>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ background: "#e0e0e0" }}>
          <th style={thStyle}>Class</th>
          <th style={thStyle}>Syllabus</th>
          <th style={thStyle}>Package Type</th>
          <th style={thStyle}>Package Name</th>
          <th style={thStyle}>Subject</th>
          <th style={thStyle}>Course Cost (MRP)</th>
          <th style={thStyle}>Student Discount (%)</th>
          <th style={thStyle}>Student Cost</th>
          <th style={thStyle}>Commission %</th>
          <th style={thStyle}>Commission Amount</th>
        </tr>
      </thead>
      <tbody>
        {packages.length > 0 ? (
          packages.map((p) => {
            const mrp = parseFloat(p.price ?? p.totalPayable ?? 0) || 0;
            const regularDiscount = parseFloat(p.regularDiscount ?? 0) || 0;
            const specialDiscount = parseFloat(p.additionalDiscount ?? 0) || 0;
            const totalDiscountPercent = regularDiscount + specialDiscount;
            const discountAmount = (mrp * totalDiscountPercent) / 100;
            const studentCost = mrp - discountAmount;
            const commissionPercent = parseFloat(p.commission ?? 0) || 0;
            const commissionAmount = (studentCost * commissionPercent) / 100;

            return (
              <tr key={p.id}>
                <td style={tdStyle}>{p.classGrade || "-"}</td>
                <td style={tdStyle}>{p.syllabus || "-"}</td>
                <td style={tdStyle}>{p.packageType || "-"}</td>
                <td style={tdStyle}>{p.packageName || "-"}</td>
                <td style={tdStyle}>{p.subject || "-"}</td>
                <td style={tdStyle}>₹{mrp.toFixed(2)}</td>
                <td style={tdStyle}>{totalDiscountPercent}%</td>
                <td style={tdStyle}>₹{studentCost.toFixed(2)}</td>
                <td style={tdStyle}>{commissionPercent}%</td>
                <td style={tdStyle}>₹{commissionAmount.toFixed(2)}</td>
              </tr>
            );
          })
        ) : (
          <tr>
            <td colSpan={10} style={{ textAlign: "center" }}>
              No packages available
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

const thStyle = { padding: "8px 12px", border: "1px solid #ccc", textAlign: "left" };
const tdStyle = { padding: "6px 10px", border: "1px solid #ccc" };

// ================= Main Dashboard =================
const PromoterDashboard = () => {
  const navigate = useNavigate();
  const [promoterData, setPromoterData] = useState(null);
  const [packages, setPackages] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedGrade, setSelectedGrade] = useState("");
  const grades = ["6th", "7th", "8th", "9th", "10th", "Professional Course"];
  const [activeView, setActiveView] = useState("dashboard");

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        navigate("/");
        return;
      }

      try {
        const promoterDoc = await getDoc(doc(db, "users", user.uid));
        if (!promoterDoc.exists()) {
          console.error("Promoter doc not found!");
          navigate("/");
          return;
        }

        const promoter = promoterDoc.data();
        setPromoterData(promoter);

        if (!promoter.promoterApproved) {
          alert("Your promoter account is not approved yet.");
          navigate("/");
          return;
        }

        const studentSnap = await getDocs(
          query(collection(db, "users"), where("referralId", "==", promoter.uniqueId))
        );
        const studentList = studentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setStudents(studentList);

        const packageSnap = await getDocs(collection(db, "packages"));
        const packageList = packageSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPackages(packageList);
      } catch (err) {
        console.error("Error fetching dashboard data:", err);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  if (loading)
    return <div style={{ textAlign: "center", paddingTop: "50px" }}>Loading...</div>;

  const filteredPackages = selectedGrade
    ? packages.filter((p) => p.classGrade === selectedGrade)
    : packages;

  const handleLogout = async () => {
    await auth.signOut();
    navigate("/");
  };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "Arial, sans-serif" }}>
      {/* Sidebar */}
      <div
        style={{
          width: "220px",
          background: "#203a43",
          color: "#fff",
          padding: "20px",
          flexShrink: 0,
        }}
      >
        <h2 style={{ textAlign: "center", marginBottom: "20px", color: "#ffd700" }}>
          ISP Promoter
        </h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          <SidebarItem
            label="Dashboard"
            active={activeView === "dashboard"}
            color="#ff7f50"
            icon={<FaTachometerAlt />}
            onClick={() => setActiveView("dashboard")}
          />
          <SidebarItem
            label="Packages"
            active={activeView === "packages"}
            color="#20b2aa"
            icon={<FaBoxOpen />}
            onClick={() => setActiveView("packages")}
          />
          <SidebarItem
            label="Students"
            active={activeView === "students"}
            color="#ff69b4"
            icon={<FaUsers />}
            onClick={() => setActiveView("students")}
          />
          <SidebarItem
            label="Commission"
            active={activeView === "commission"}
            color="#8a2be2"
            icon={<FaMoneyBillWave />}
            onClick={() => setActiveView("commission")}
          />
          <SidebarItem
            label="Profile"
            active={activeView === "profile"}
            color="#1e90ff"
            icon={<FaUserCircle />}
            onClick={() => setActiveView("profile")}
          />
          <SidebarItem
            label="Logout"
            active={false}
            color="#ff4500"
            icon={<FaSignOutAlt />}
            onClick={handleLogout}
          />
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
          </div>
        )}

        {activeView === "packages" && (
          <div>
            <label>Select Class: </label>
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
            >
              <option value="">All</option>
              {grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <PackagesTable packages={filteredPackages} />
          </div>
        )}

        {activeView === "students" && (
          <div>
            <h2>Students Referred</h2>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#e0e0e0" }}>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Class</th>
                  <th style={thStyle}>Syllabus</th>
                  <th style={thStyle}>Commission Earned</th>
                </tr>
              </thead>
              <tbody>
                {students.length > 0 ? (
                  students.map((s) => (
                    <tr key={s.id}>
                      <td style={tdStyle}>{s.name}</td>
                      <td style={tdStyle}>{s.email}</td>
                      <td style={tdStyle}>{s.classGrade || "-"}</td>
                      <td style={tdStyle}>{s.syllabus || "-"}</td>
                      <td style={tdStyle}>₹{s.commissionEarned || 0}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center" }}>
                      No students found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeView === "commission" && (
          <div>
            <h2>Commission</h2>
            <p>
              Total Commission Earned: ₹
              {students.reduce((sum, s) => sum + (s.commissionEarned || 0), 0)}
            </p>
          </div>
        )}

        {activeView === "profile" && (
          <div>
            <h2>Profile</h2>
            <p>Name: {promoterData?.name}</p>
            <p>Email: {promoterData?.email}</p>
            <p>Approved: {promoterData?.promoterApproved ? "Yes" : "No"}</p>
            <p>Also Promoter: {promoterData?.alsoPromoter ? "Yes" : "No"}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PromoterDashboard;
