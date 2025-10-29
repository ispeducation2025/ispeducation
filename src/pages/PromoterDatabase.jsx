import React, { useEffect, useState, useRef } from "react";
import { db } from "../firebase/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

const PromoterDatabase = () => {
  const [promoters, setPromoters] = useState([]);
  const [selectedPromoter, setSelectedPromoter] = useState(null);
  const panelRef = useRef(null);
  const navigate = useNavigate();

  // ✅ Fetch promoter data
  useEffect(() => {
    const fetchPromoters = async () => {
      try {
        const promoterCollection = collection(db, "users");
        const snapshot = await getDocs(promoterCollection);

        const promoterList = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter(
            (p) => p.role === "promoter" || p.alsoPromoter === true
          );

        setPromoters(promoterList);
      } catch (error) {
        console.error("Error fetching promoters:", error);
      }
    };
    fetchPromoters();
  }, []);

  // ✅ Close panel on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setSelectedPromoter(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const tableStyle = {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: "15px",
    fontSize: "14px",
  };

  const thtdStyle = {
    border: "1px solid #ddd",
    padding: "8px 10px",
    textAlign: "left",
  };

  const headerStyle = {
    backgroundColor: "#0284c7",
    color: "white",
    textAlign: "center",
    padding: "12px 0",
    fontSize: "18px",
    fontWeight: "600",
  };

  return (
    <div
      style={{
        padding: "20px",
        fontFamily:
          "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial",
        background: "#f9fafb",
        minHeight: "100vh",
        position: "relative",
      }}
    >
      {/* ✅ Header + Back Button */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: "15px",
          justifyContent: "space-between",
        }}
      >
        <h2 style={{ color: "#0284c7", fontSize: "22px" }}>
          Promoter Database
        </h2>
        <button
          onClick={() => navigate("/admin-dashboard")}
          style={{
            background: "#0284c7",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "8px 16px",
            cursor: "pointer",
          }}
        >
          ← Back
        </button>
      </div>

      {/* ✅ Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr style={{ backgroundColor: "#e0f2fe" }}>
              <th style={thtdStyle}>Name</th>
              <th style={thtdStyle}>Email</th>
              <th style={thtdStyle}>Phone</th>
              <th style={thtdStyle}>Unique ID</th>
              <th style={thtdStyle}>Business Area</th>
              <th style={thtdStyle}>Enrollment Date</th>
              <th style={thtdStyle}>Total Commission</th>
              <th style={thtdStyle}>Pending Amount</th>
              <th style={thtdStyle}>Status</th>
              <th style={thtdStyle}>Last Payment</th>
              <th style={thtdStyle}>Action</th>
            </tr>
          </thead>
          <tbody>
            {promoters.map((p) => {
              const totalCommission = p.totalCommission || 0;
              const pendingAmount = p.pendingAmount || 0;
              const status = pendingAmount === 0 ? "No Dues" : "Pending";
              return (
                <tr
                  key={p.id}
                  style={{
                    cursor: "pointer",
                    backgroundColor:
                      selectedPromoter?.id === p.id ? "#f0f9ff" : "white",
                  }}
                  onClick={() => setSelectedPromoter(p)}
                >
                  <td style={thtdStyle}>{p.name || "-"}</td>
                  <td style={thtdStyle}>{p.email || "-"}</td>
                  <td style={thtdStyle}>{p.phone || "-"}</td>
                  <td style={thtdStyle}>{p.uniqueId || "-"}</td>
                  <td style={thtdStyle}>{p.businessArea || "-"}</td>
                  <td style={thtdStyle}>
                    {p.createdAt?.toDate
                      ? p.createdAt.toDate().toLocaleString()
                      : "-"}
                  </td>
                  <td style={thtdStyle}>₹{totalCommission}</td>
                  <td style={thtdStyle}>₹{pendingAmount}</td>
                  <td
                    style={{
                      ...thtdStyle,
                      color: status === "No Dues" ? "green" : "#eab308",
                      fontWeight: "600",
                    }}
                  >
                    {status}
                  </td>
                  <td style={thtdStyle}>{p.lastPayment || "-"}</td>
                  <td style={thtdStyle}>
                    {status === "No Dues" ? (
                      <span style={{ color: "green", fontWeight: "bold" }}>
                        No Dues
                      </span>
                    ) : (
                      <button
                        style={{
                          background: "#0ea5e9",
                          color: "#fff",
                          border: "none",
                          borderRadius: "6px",
                          padding: "5px 10px",
                          cursor: "pointer",
                        }}
                      >
                        Pay
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ✅ Right panel for selected promoter */}
      {selectedPromoter && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: "320px",
            height: "100vh",
            backgroundColor: "#fff",
            boxShadow: "-2px 0 8px rgba(0,0,0,0.15)",
            padding: "20px",
            overflowY: "auto",
            zIndex: 1000,
          }}
        >
          <h3 style={headerStyle}>Promoter Details</h3>
          <p>
            <b>Name:</b> {selectedPromoter.name}
          </p>
          <p>
            <b>Email:</b> {selectedPromoter.email}
          </p>
          <p>
            <b>Phone:</b> {selectedPromoter.phone}
          </p>
          <p>
            <b>Unique ID:</b> {selectedPromoter.uniqueId}
          </p>
          <p>
            <b>Business Area:</b> {selectedPromoter.businessArea}
          </p>
          <p>
            <b>Total Commission:</b> ₹
            {selectedPromoter.totalCommission || 0}
          </p>
          <p>
            <b>Pending Amount:</b> ₹
            {selectedPromoter.pendingAmount || 0}
          </p>
          <p>
            <b>Status:</b>{" "}
            {selectedPromoter.pendingAmount === 0 ? "No Dues" : "Pending"}
          </p>
          <p>
            <b>Last Paid:</b> {selectedPromoter.lastPayment || "-"}
          </p>
        </div>
      )}
    </div>
  );
};

export default PromoterDatabase;
