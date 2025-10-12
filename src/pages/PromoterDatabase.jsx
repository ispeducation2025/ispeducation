import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebaseConfig";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

export default function PromoterDatabase() {
  const [promoters, setPromoters] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchPromoters = async () => {
      try {
        const promoterQ = query(
          collection(db, "users"),
          where("alsoPromoter", "==", true),
          where("promoterApproved", "==", true)
        );
        const promoterSnap = await getDocs(promoterQ);

        const promoterData = [];

        for (let docSnap of promoterSnap.docs) {
          const promoter = { id: docSnap.id, ...docSnap.data() };

          const studentQ = query(
            collection(db, "users"),
            where("referralId", "==", promoter.uniqueId)
          );
          const studentSnap = await getDocs(studentQ);
          const students = studentSnap.docs.map(d => d.data());

          const totalCommission = students.reduce(
            (acc, s) => acc + (parseFloat(s.commissionEarned) || 0),
            0
          );

          promoter.totalCommission = totalCommission.toFixed(2);
          promoterData.push(promoter);
        }

        setPromoters(promoterData);
      } catch (error) {
        console.error("Error fetching promoters:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchPromoters();
  }, []);

  if (loading)
    return (
      <p style={{ textAlign: "center", marginTop: 40, fontSize: 18, fontWeight: 600, color: "#333" }}>
        Loading promoters...
      </p>
    );

  const tableStyle = {
    width: "100%",
    borderCollapse: "collapse",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#fff",
    boxShadow: "0 8px 24px rgba(0,0,0,0.1)"
  };

  const thStyle = {
    padding: "14px 18px",
    color: "#fff",
    fontWeight: 700,
    fontSize: 14,
    textAlign: "left",
    borderBottom: "2px solid #fff",
    background: "linear-gradient(90deg, #4F46E5, #8B5CF6)"
  };

  const thRightStyle = { ...thStyle, textAlign: "right" }; // Right-align for Commission

  const tdStyle = {
    padding: "12px 18px",
    borderBottom: "1px solid #E5E7EB",
    fontSize: 14
  };

  const badgeStyle = {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 12,
    backgroundColor: "#34D399",
    color: "#065F46",
    fontWeight: 600,
    fontSize: 12
  };

  const buttonStyle = {
    marginBottom: 32,
    padding: "10px 20px",
    backgroundColor: "#4F46E5",
    color: "#fff",
    fontWeight: 600,
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    transition: "background-color 0.3s"
  };

  return (
    <div style={{ padding: 32, backgroundColor: "#F9FAFB", minHeight: "100vh" }}>
      <button
        style={buttonStyle}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#4338CA")}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#4F46E5")}
        onClick={() => navigate("/admin-dashboard")}
      >
        ← Back to Admin Dashboard
      </button>

      <h1
        style={{
          textAlign: "center",
          fontSize: 36,
          fontWeight: 800,
          marginBottom: 32,
          color: "#4F46E5"
        }}
      >
        Promoter Database
      </h1>

      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Phone</th>
              <th style={thStyle}>Date Joined</th>
              <th style={thStyle}>Unique ID</th>
              <th style={thStyle}>Business Area</th>
              <th style={thRightStyle}>Commission</th>
            </tr>
          </thead>
          <tbody>
            {promoters.length > 0 ? (
              promoters.map((p, idx) => (
                <tr
                  key={p.id}
                  style={{
                    backgroundColor: idx % 2 === 0 ? "#F3F4F6" : "#FFFFFF",
                    transition: "background-color 0.3s",
                    cursor: "default"
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#E0E7FF")}
                  onMouseLeave={e =>
                    (e.currentTarget.style.backgroundColor = idx % 2 === 0 ? "#F3F4F6" : "#FFFFFF")
                  }
                >
                  <td style={{ ...tdStyle, color: "#1E40AF", fontWeight: 600 }}>{p.name}</td>
                  <td style={{ ...tdStyle, color: "#1E3A8A" }}>{p.email}</td>
                  <td style={tdStyle}>{p.phone}</td>
                  <td style={tdStyle}>
                    {p.createdAt?.toDate ? p.createdAt.toDate().toLocaleDateString() : "N/A"}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", color: "#6B21A8" }}>
                    {p.uniqueId || "-"}
                  </td>
                  <td style={tdStyle}>
                    {p.businessArea ? <span style={badgeStyle}>{p.businessArea}</span> : "-"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#047857", fontWeight: 700 }}>
                    ₹{p.totalCommission || 0}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan="7"
                  style={{
                    padding: 32,
                    textAlign: "center",
                    color: "#6B7280",
                    fontWeight: 600,
                    fontSize: 16
                  }}
                >
                  No promoters found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
