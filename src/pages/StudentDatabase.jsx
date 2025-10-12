import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

export default function StudentDatabase() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchStudents = async () => {
      try {
        const userSnap = await getDocs(collection(db, "users"));
        const studentData = userSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(user => user.role !== "admin"); // exclude admin
        setStudents(studentData);
      } catch (error) {
        console.error("Error fetching students:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStudents();
  }, []);

  if (loading)
    return (
      <p style={{ textAlign: "center", marginTop: 40, fontSize: 18, fontWeight: "600", color: "#555" }}>
        Loading students...
      </p>
    );

  const tableStyle = {
    width: "100%",
    borderCollapse: "collapse",
    boxShadow: "0 6px 16px rgba(0,0,0,0.1)",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#fff"
  };

  const thStyle = {
    padding: "14px 16px",
    textAlign: "left",
    fontWeight: "700",
    fontSize: 15,
    color: "#fff",
    background: "linear-gradient(90deg, #319795, #38B2AC)",
    borderBottom: "2px solid #ddd"
  };

  const tdStyle = {
    padding: "12px 16px",
    borderBottom: "1px solid #E2E8F0",
    fontSize: 14
  };

  const badgeStyle = {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 12,
    backgroundColor: "#FBD38D",
    color: "#744210",
    fontWeight: "600",
    fontSize: 12
  };

  const buttonStyle = {
    marginBottom: 24,
    padding: "10px 20px",
    backgroundColor: "#3182CE",
    color: "#fff",
    fontWeight: "600",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    transition: "background-color 0.3s"
  };

  return (
    <div style={{ padding: 24, backgroundColor: "#E6FFFA", minHeight: "100vh" }}>
      <button
        style={buttonStyle}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#2B6CB0")}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#3182CE")}
        onClick={() => navigate("/admin-dashboard")}
      >
        ← Back to Admin Dashboard
      </button>

      <h1
        style={{
          textAlign: "center",
          fontSize: 32,
          fontWeight: "800",
          background: "linear-gradient(90deg, #319795, #38B2AC)",
          WebkitBackgroundClip: "text",
          color: "transparent",
          marginBottom: 24
        }}
      >
        Student Database
      </h1>

      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Phone</th>
              <th style={thStyle}>Class</th>
              <th style={thStyle}>Syllabus</th>
              <th style={thStyle}>Packages Purchased</th>
              <th style={thStyle}>Amount Paid</th>
            </tr>
          </thead>
          <tbody>
            {students.length > 0 ? (
              students.map((s, idx) => (
                <tr
                  key={s.id}
                  style={{
                    backgroundColor: idx % 2 === 0 ? "#fff" : "#F1FAFC",
                    transition: "background-color 0.3s",
                    cursor: "default"
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#B2F5EA")}
                  onMouseLeave={e =>
                    (e.currentTarget.style.backgroundColor = idx % 2 === 0 ? "#fff" : "#F1FAFC")
                  }
                >
                  <td style={{ ...tdStyle, color: "#2C7A7B", fontWeight: "600" }}>{s.name}</td>
                  <td style={{ ...tdStyle, color: "#285E61" }}>{s.email}</td>
                  <td style={tdStyle}>{s.phone}</td>
                  <td style={tdStyle}>{s.class || "-"}</td>
                  <td style={tdStyle}>{s.syllabus || "-"}</td>
                  <td style={tdStyle}>
                    {s.packagesPurchased ? <span style={badgeStyle}>{s.packagesPurchased}</span> : "-"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#DD6B20", fontWeight: "700" }}>
                    ₹{s.amountPaid || 0}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan="7"
                  style={{ padding: 24, textAlign: "center", color: "#718096", fontWeight: "600", fontSize: 16 }}
                >
                  No students found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
