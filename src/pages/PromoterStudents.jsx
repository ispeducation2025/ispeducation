import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { useLocation, useNavigate, useParams } from "react-router-dom";

export default function PromoterStudents() {
  const { promoterId } = useParams();
  const { state } = useLocation();
  const promoter = state?.promoter;
  const [students, setStudents] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchStudents = async () => {
      const userSnap = await getDocs(collection(db, "users"));
      const allStudents = userSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((u) => u.promoterId === promoterId);
      setStudents(allStudents);
    };
    fetchStudents();
  }, [promoterId]);

  const totalActual = students.reduce((a, s) => a + (s.actualCost || 0), 0);
  const totalDiscount = students.reduce((a, s) => a + (s.discount || 0), 0);
  const totalPaid = students.reduce((a, s) => a + (s.paidAmount || 0), 0);
  const totalCommission = students.reduce((a, s) => a + (s.promoterCommission || 0), 0);

  return (
    <div style={{ padding: 20, background: "#E6FFFA", minHeight: "100vh" }}>
      <button
        onClick={() => navigate("/promoter-database")}
        style={{
          background: "#0284c7",
          color: "#fff",
          border: "none",
          borderRadius: "8px",
          padding: "8px 16px",
          cursor: "pointer",
          marginBottom: 16,
        }}
      >
        ← Back to Promoter Database
      </button>

      <h2
        style={{
          textAlign: "center",
          fontSize: 26,
          fontWeight: 700,
          color: "#0284c7",
          marginBottom: 20,
        }}
      >
        Students Tagged to {promoter?.name || "Promoter"}
      </h2>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            background: "#fff",
            borderRadius: 10,
            boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
          }}
        >
          <thead>
            <tr style={{ background: "#e0f2fe" }}>
              <th style={{ padding: 10 }}>Name</th>
              <th style={{ padding: 10 }}>Email</th>
              <th style={{ padding: 10 }}>Phone</th>
              <th style={{ padding: 10 }}>Package</th>
              <th style={{ padding: 10 }}>Actual Cost</th>
              <th style={{ padding: 10 }}>Discount</th>
              <th style={{ padding: 10 }}>Paid</th>
              <th style={{ padding: 10 }}>Commission</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <td style={{ padding: 10 }}>{s.name}</td>
                <td style={{ padding: 10 }}>{s.email}</td>
                <td style={{ padding: 10 }}>{s.phone}</td>
                <td style={{ padding: 10 }}>{s.packageName || "-"}</td>
                <td style={{ padding: 10 }}>₹{s.actualCost || 0}</td>
                <td style={{ padding: 10 }}>₹{s.discount || 0}</td>
                <td style={{ padding: 10, fontWeight: "bold" }}>₹{s.paidAmount || 0}</td>
                <td style={{ padding: 10, color: "#16a34a" }}>₹{s.promoterCommission || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ✅ Totals */}
      <div
        style={{
          marginTop: 20,
          background: "#f0fdfa",
          padding: 15,
          borderRadius: 8,
          textAlign: "center",
          fontWeight: 600,
          color: "#065f46",
        }}
      >
        <p>Total Actual Cost: ₹{totalActual}</p>
        <p>Total Discount: ₹{totalDiscount}</p>
        <p>Total Paid: ₹{totalPaid}</p>
        <p>Total Commission Earned: ₹{totalCommission}</p>
      </div>
    </div>
  );
}
