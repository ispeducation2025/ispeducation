import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

export default function StudentDatabase() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // ✅ Fetch students
  useEffect(() => {
    const fetchStudents = async () => {
      try {
        const userSnap = await getDocs(collection(db, "users"));
        const studentData = userSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(user => user.role === "student" || user.role === "parent");
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
          marginTop: 40,
          fontSize: 18,
          fontWeight: "600",
          color: "#555",
        }}
      >
        Loading students...
      </p>
    );

  const tableStyle = {
    width: "100%",
    borderCollapse: "collapse",
    boxShadow: "0 6px 16px rgba(0,0,0,0.1)",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#fff",
  };

  const thStyle = {
    padding: "14px 16px",
    textAlign: "left",
    fontWeight: "700",
    fontSize: 15,
    color: "#fff",
    background: "linear-gradient(90deg, #319795, #38B2AC)",
    borderBottom: "2px solid #ddd",
  };

  const tdStyle = {
    padding: "12px 16px",
    borderBottom: "1px solid #E2E8F0",
    fontSize: 14,
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
    transition: "background-color 0.3s",
  };

  const formatCurrency = (amount) => {
    if (!amount || isNaN(amount)) return "₹0";
    return `₹${Number(amount).toLocaleString("en-IN")}`;
  };

  return (
    <div
      style={{
        padding: 24,
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
          fontSize: 32,
          fontWeight: "800",
          background: "linear-gradient(90deg, #319795, #38B2AC)",
          WebkitBackgroundClip: "text",
          color: "transparent",
          marginBottom: 24,
        }}
      >
        Student Database
      </h1>

      {/* ✅ Table Section */}
      <div style={{ overflowX: "auto" }}>
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
              <th style={thStyle}>Payment Status</th>
              <th style={thStyle}>Purchase Date</th>
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
                      backgroundColor: idx % 2 === 0 ? "#fff" : "#F1FAFC",
                      transition: "background-color 0.3s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = "#B2F5EA")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor =
                        idx % 2 === 0 ? "#fff" : "#F1FAFC")
                    }
                  >
                    <td
                      style={{
                        ...tdStyle,
                        color: "#2C7A7B",
                        fontWeight: "600",
                      }}
                    >
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
                        color: "#1E293B",
                        fontWeight: "600",
                      }}
                    >
                      {formatCurrency(actualCost)}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        color: "#16A34A",
                        fontWeight: "600",
                      }}
                    >
                      {formatCurrency(discount)}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        color: "#DD6B20",
                        fontWeight: "700",
                      }}
                    >
                      {formatCurrency(paidAmount)}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        fontWeight: "700",
                        color: status === "Paid in Full" ? "green" : "#EAB308",
                      }}
                    >
                      {status}
                    </td>
                    <td style={tdStyle}>
                      {s.createdAt?.toDate
                        ? s.createdAt.toDate().toLocaleString()
                        : "-"}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan="11"
                  style={{
                    padding: 24,
                    textAlign: "center",
                    color: "#718096",
                    fontWeight: "600",
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
