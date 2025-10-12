// src/pages/ApprovePromoter.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebaseConfig";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import "./ApprovePromoter.css";

export default function ApprovePromoter() {
  const navigate = useNavigate();
  const [promoters, setPromoters] = useState([]);

  useEffect(() => {
    fetchPromoters();
  }, []);

  async function fetchPromoters() {
    const usersRef = collection(db, "users");
    const snap = await getDocs(usersRef);
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(
        (u) => !u.promoterApproved && (u.role === "promoter" || u.alsoPromoter === true)
      );
    setPromoters(data);
  }

  async function approvePromoter(id) {
    await updateDoc(doc(db, "users", id), { promoterApproved: true });
    fetchPromoters();
    alert("Promoter approved successfully!");
  }

  const getBadge = (user) => {
    if (user.role === "promoter") return "Promoter";
    if (user.role === "student" && user.alsoPromoter) return "Student Promoter";
    return "";
  };

  return (
    <div className="approve-promoter-page">
      <h1>🎯 Approve Promoters</h1>
      <button className="back-btn" onClick={() => navigate("/admin-dashboard")}>
        ← Back to Dashboard
      </button>

      <div className="promoter-list">
        {promoters.length === 0 && (
          <div className="no-promoters">🎉 No pending promoters.</div>
        )}

        {promoters.map((p) => (
          <div key={p.id} className="promoter-card">
            <div className="promoter-info">
              <div className="badge">{getBadge(p)}</div>
              <div><strong>Name:</strong> {p.name}</div>
              <div><strong>Email:</strong> {p.email}</div>
              <div><strong>Phone:</strong> {p.phone}</div>
              <div><strong>Class:</strong> {p.classGrade || "N/A"}</div>
              <div><strong>Syllabus:</strong> {p.syllabus || "N/A"}</div>
            </div>
            <button className="approve-btn" onClick={() => approvePromoter(p.id)}>
              ✅ Approve
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
