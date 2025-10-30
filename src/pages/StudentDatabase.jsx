// src/pages/StudentDatabase.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

export default function StudentDatabase() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // ✅ Fetch students from Firestore
  useEffect(() => {
    const fetchStudents = async () => {
      try {
        const userSnap = await getDocs(collection(db, "users"));
        const studentData = userSnap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((user) => user.role === "student" || user.role === "parent");
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
      <p
        style={{
          textAlign: "center",
          marginTop: 50,
          fontSize: 18,
          fontWeight: 600,
          color: "#4A5568",
        }}
      >
        Loading student database...
      </p>
    );

  const tableStyle = {
    width: "100%",
    borderCollapse: "collapse",
    boxShadow: "0 6px 16px rgba(0,0,0,0.1)",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#fff",
    fontSize: 14,
  };

  const thStyle = {
    padding: "14px 16px",
    textAlign: "left",
    fontWeight: "700",
    fontSize: 15,
    color: "#fff",
    background: "linear-gradient(90deg, #319795, #38B2AC)",
    position: "sticky",
    top: 0,
    zIndex: 2,
  };

  const tdStyle = {
    padding: "12px 14px",
    borderBottom: "1px solid #E2E8F0",
    wordBreak: "break-word",
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
  };

  const formatCurrency = (amount) => {
    if (!amount || isNaN(amount)) return "₹0";
    return `₹${Number(amount).toLocaleString("en-IN")}`;
  };

  return (
    <div
      style={{
        padding: 20,
        backgroundColor: "#E6FFFA",
        minHeight: "100vh",
      }}
    >
      {/* ✅ Back button */}
      <button
        style={buttonStyle}
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor = "#2B6CB0")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.backgroundColor = "#3182CE")
        }
        onClick={() => navigate("/admin-dashboard")}
      >
        ← Back to Admin Dashboard
      </button>

      <h1
        style={{
          textAlign: "center",
          fontSize: 30,
          fontWeight: 800,
          background: "linear-gradient(90deg, #319795, #38B2AC)",
          WebkitBackgroundClip: "text",
          color: "transparent",
          marginBottom: 25,
        }}
      >
        Student Database & Payment Details
      </h1>

      {/* ✅ Table Section */}
      <div
        style={{
          overflowX: "auto",
          backgroundColor: "#fff",
          borderRadius: 10,
        }}
      >
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Phone</th>
              <th style={thStyle}>Class</th>
              <th style={thStyle}>Syllabus</th>
              <th style={thStyle}>Package Name</th>
              <th style={thStyle}>Actual Cost</th>
              <th style={thStyle}>Discount</th>
              <th style={thStyle}>Paid Amount</th>
              <th style={thStyle}>Payment Mode</th>
              <th style={thStyle}>Transaction ID</th>
              <th style={thStyle}>Payment Status</th>
              <th style={thStyle}>Purchase Date</th>
              <th style={thStyle}>Promoter ID</th>
              <th style={thStyle}>Referral Code</th>
            </tr>
          </thead>

          <tbody>
            {students.length > 0 ? (
              students.map((s, idx) => {
                const actualCost = s.actualCost || 0;
                const discount = s.discount || 0;
                const paidAmount = s.paidAmount || 0;
                const status =
                  paidAmount >= actualCost - discount
                    ? "Paid in Full"
                    : "Pending";

                return (
                  <tr
                    key={s.id}
                    style={{
                      backgroundColor: idx % 2 === 0 ? "#FFFFFF" : "#F0FFF4",
                      transition: "background-color 0.3s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = "#B2F5EA")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor =
                        idx % 2 === 0 ? "#FFFFFF" : "#F0FFF4")
                    }
                  >
                    <td style={{ ...tdStyle, fontWeight: 600, color: "#2C7A7B" }}>
                      {s.name || "-"}
                    </td>
                    <td style={{ ...tdStyle, color: "#285E61" }}>
                      {s.email || "-"}
                    </td>
                    <td style={tdStyle}>{s.phone || "-"}</td>
                    <td style={tdStyle}>{s.classGrade || "-"}</td>
                    <td style={tdStyle}>{s.syllabus || "-"}</td>
                    <td style={tdStyle}>{s.packageName || "-"}</td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        fontWeight: 600,
                      }}
                    >
                      {formatCurrency(actualCost)}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        color: "#16A34A",
                        fontWeight: 600,
                      }}
                    >
                      {formatCurrency(discount)}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        color: "#DD6B20",
                        fontWeight: 700,
                      }}
                    >
                      {formatCurrency(paidAmount)}
                    </td>
                    <td style={tdStyle}>{s.paymentMode || "-"}</td>
                    <td style={{ ...tdStyle, color: "#1E40AF" }}>
                      {s.transactionId || "-"}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        color: status === "Paid in Full" ? "green" : "#EAB308",
                        fontWeight: 700,
                      }}
                    >
                      {status}
                    </td>
                    <td style={tdStyle}>
                      {s.createdAt?.toDate
                        ? s.createdAt.toDate().toLocaleString()
                        : "-"}
                    </td>
                    <td style={tdStyle}>{s.promoterId || "-"}</td>
                    <td style={tdStyle}>{s.referralCode || "-"}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan="15"
                  style={{
                    padding: 24,
                    textAlign: "center",
                    color: "#718096",
                    fontWeight: 600,
                    fontSize: 16,
                  }}
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
