// src/pages/StudentDashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db, auth } from "../firebase/firebaseConfig";
import { doc, getDoc, collection, getDocs, query, where, addDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import "./StudentDashboard.css";

// Subject images
const subjectImages = {
  Science: "https://cdn-icons-png.flaticon.com/512/2721/2721297.png",
  Mathematics: "https://cdn-icons-png.flaticon.com/512/3135/3135706.png",
  History: "https://cdn-icons-png.flaticon.com/512/3103/3103991.png",
  Geography: "https://cdn-icons-png.flaticon.com/512/3876/3876315.png",
  Economics: "https://cdn-icons-png.flaticon.com/512/3135/3135671.png",
  "Commercial Applications": "https://cdn-icons-png.flaticon.com/512/2972/2972109.png",
  Physics: "https://cdn-icons-png.flaticon.com/512/3132/3132693.png",
  Chemistry: "https://cdn-icons-png.flaticon.com/512/2921/2921822.png",
  Biology: "https://cdn-icons-png.flaticon.com/512/616/616408.png",
  Default: "https://cdn-icons-png.flaticon.com/512/747/747376.png",
};

const packageTypes = ["Interactive Class", "Test"];

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

// Normalizers
function normalizeSubject(s) {
  if (!s) return "";
  const key = s.toLowerCase().replace(/\s+/g, "");
  const map = {
    science: "Science",
    mathematics: "Mathematics",
    history: "History",
    geography: "Geography",
    economics: "Economics",
    commercialapplications: "Commercial Applications",
    physics: "Physics",
    chemistry: "Chemistry",
    biology: "Biology",
  };
  return map[key] || s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
function normalizeText(s) {
  if (!s) return "";
  return s.trim().toLowerCase();
}
const isConceptPackageName = (name) => normalizeText(name) === "concept based package";

const StudentDashboard = () => {
  const navigate = useNavigate();
  const [studentInfo, setStudentInfo] = useState({ name: "", classGrade: "", syllabus: "" });
  const [packages, setPackages] = useState([]);
  const [selectedType, setSelectedType] = useState("");
  const [selectedPackageName, setSelectedPackageName] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedSubtopic, setSelectedSubtopic] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");
  const [cart, setCart] = useState([]);

  // Load Razorpay dynamically (Option B)
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // Auth check
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) navigate("/");
      else {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setStudentInfo({
            name: data.name || "Student",
            classGrade: data.classGrade || "",
            syllabus: data.syllabus || "",
          });
        }
      }
    });
    return () => unsub();
  }, [navigate]);

  // Fetch packages from Firestore
  useEffect(() => {
    if (!studentInfo.classGrade || !studentInfo.syllabus) return;

    const fetchPackages = async () => {
      const q = query(
        collection(db, "packages"),
        where("classGrade", "==", studentInfo.classGrade),
        where("syllabus", "==", studentInfo.syllabus)
      );
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setPackages(list);
    };

    fetchPackages();
  }, [studentInfo.classGrade, studentInfo.syllabus]);

  // Filters
  const filteredByType = useMemo(
    () => (selectedType ? packages.filter((p) => p.packageType === selectedType) : []),
    [packages, selectedType]
  );
  const packageNameOptions = useMemo(() => unique(filteredByType.map((p) => p.packageName)), [filteredByType]);
  const filteredByPackageName = useMemo(
    () => (selectedPackageName ? filteredByType.filter((p) => p.packageName === selectedPackageName) : filteredByType),
    [filteredByType, selectedPackageName]
  );

  const subjectOptions = useMemo(
    () => (isConceptPackageName(selectedPackageName) ? unique(filteredByPackageName.map((p) => normalizeSubject(p.subject))) : []),
    [filteredByPackageName, selectedPackageName]
  );
  const subtopicOptions = useMemo(
    () =>
      isConceptPackageName(selectedPackageName)
        ? unique(filteredByPackageName.filter((p) => normalizeSubject(p.subject) === selectedSubject).map((p) => p.subtopic))
        : [],
    [filteredByPackageName, selectedSubject, selectedPackageName]
  );
  const chapterOptions = useMemo(
    () =>
      isConceptPackageName(selectedPackageName)
        ? unique(
            filteredByPackageName
              .filter(
                (p) =>
                  normalizeSubject(p.subject) === selectedSubject &&
                  (!selectedSubtopic || normalizeText(p.subtopic) === normalizeText(selectedSubtopic))
              )
              .map((p) => p.chapter)
          )
        : [],
    [filteredByPackageName, selectedSubject, selectedSubtopic, selectedPackageName]
  );

  // Cards list
  const conceptCards = useMemo(() => {
    if (!selectedPackageName) return [];
    if (isConceptPackageName(selectedPackageName)) {
      if (!selectedChapter) return [];
      return filteredByPackageName.filter(
        (p) =>
          normalizeSubject(p.subject) === selectedSubject &&
          (!selectedSubtopic || normalizeText(p.subtopic) === normalizeText(selectedSubtopic)) &&
          normalizeText(p.chapter) === normalizeText(selectedChapter)
      );
    }
    return filteredByPackageName;
  }, [filteredByPackageName, selectedPackageName, selectedSubject, selectedSubtopic, selectedChapter]);

  // Cart operations
  const addToCart = (pkg) => {
    if (!cart.find((p) => p.id === pkg.id)) setCart((c) => [...c, pkg]);
  };
  const removeFromCart = (id) => setCart((c) => c.filter((p) => p.id !== id));
  const cartTotal = useMemo(() => cart.reduce((sum, p) => sum + parseFloat(p.totalPayable || p.price || 0), 0), [cart]);

  // Razorpay Checkout
  const handleCheckout = async () => {
    if (cart.length === 0) {
      alert("Cart is empty!");
      return;
    }
    const amountInPaise = cartTotal * 100;

    const options = {
      key: "rzp_live_RXgt3NNJiZJDob", // <-- Replace with your live Razorpay key
      amount: amountInPaise,
      currency: "INR",
      name: "ISP Education",
      description: "Course Payment",
      image: "https://ispeducation.in/logo192.png",
      handler: async function (response) {
        alert("Payment successful! Payment ID: " + response.razorpay_payment_id);
        // Save payment details in Firestore
        const paymentsRef = collection(db, "payments");
        for (const pkg of cart) {
          await addDoc(paymentsRef, {
            studentId: auth.currentUser.uid,
            packageId: pkg.id,
            packageName: pkg.packageName || pkg.concept,
            subject: pkg.subject || "",
            amount: pkg.totalPayable || pkg.price,
            paymentId: response.razorpay_payment_id,
            createdAt: new Date(),
          });
        }
        setCart([]);
      },
      prefill: {
        name: studentInfo.name,
        email: auth.currentUser?.email || "",
        contact: "",
      },
      notes: {
        cart: JSON.stringify(cart.map((c) => ({ id: c.id, name: c.packageName || c.concept }))),
      },
      theme: { color: "#1e90ff" },
    };

    if (window.Razorpay) {
      const rzp = new window.Razorpay(options);
      rzp.open();
    } else {
      alert("Razorpay SDK not loaded. Please refresh the page.");
    }
  };

  const handleLogout = async () => {
    await auth.signOut();
    navigate("/");
  };

  return (
    <div
      className="student-dashboard"
      style={{ display: "flex", gap: "20px", minHeight: "100vh", background: "linear-gradient(135deg, #1d2671, #c33764)" }}
    >
      {/* Main Content */}
      <div style={{ flex: 3, padding: "20px" }}>
        <div className="dashboard-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#fff" }}>
          <h1>Welcome, {studentInfo.name}!</h1>
          <button
            className="logout-btn"
            onClick={handleLogout}
            style={{ background: "#ff4757", color: "#fff", border: "none", padding: "8px 16px", borderRadius: "6px", cursor: "pointer" }}
          >
            Logout
          </button>
        </div>

        {/* Filters */}
        <div style={{ marginTop: "20px", background: "#ffffff22", padding: "15px", borderRadius: "10px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "15px" }}>
          {/* Package Type */}
          <div>
            <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>Package Type</label>
            <select
              className="sel"
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value);
                setSelectedPackageName("");
                setSelectedSubject("");
                setSelectedSubtopic("");
                setSelectedChapter("");
              }}
              style={{ width: "100%", padding: "8px", borderRadius: "6px" }}
            >
              <option value="">— Select Type —</option>
              {packageTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Package Name */}
          {selectedType && packageNameOptions.length > 0 && (
            <div>
              <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>Package Name</label>
              <select
                className="sel"
                value={selectedPackageName}
                onChange={(e) => {
                  setSelectedPackageName(e.target.value);
                  setSelectedSubject("");
                  setSelectedSubtopic("");
                  setSelectedChapter("");
                }}
                style={{ width: "100%", padding: "8px", borderRadius: "6px" }}
              >
                <option value="">— Select Package —</option>
                {packageNameOptions.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          )}

          {/* Concept-based filters */}
          {isConceptPackageName(selectedPackageName) && subjectOptions.length > 0 && (
            <div>
              <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>Subject</label>
              <select
                className="sel"
                value={selectedSubject}
                onChange={(e) => { setSelectedSubject(e.target.value); setSelectedSubtopic(""); setSelectedChapter(""); }}
                style={{ width: "100%", padding: "8px", borderRadius: "6px" }}
              >
                <option value="">— Select Subject —</option>
                {subjectOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          {isConceptPackageName(selectedPackageName) && selectedSubject && subtopicOptions.length > 0 && (
            <div>
              <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>Subtopic</label>
              <select
                className="sel"
                value={selectedSubtopic}
                onChange={(e) => { setSelectedSubtopic(e.target.value); setSelectedChapter(""); }}
                style={{ width: "100%", padding: "8px", borderRadius: "6px" }}
              >
                <option value="">— Select Subtopic —</option>
                {subtopicOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          {isConceptPackageName(selectedPackageName) && selectedSubtopic && chapterOptions.length > 0 && (
            <div>
              <label className="lbl" style={{ display: "block", marginBottom: "6px", color: "#fff" }}>Chapter</label>
              <select
                className="sel"
                value={selectedChapter}
                onChange={(e) => setSelectedChapter(e.target.value)}
                style={{ width: "100%", padding: "8px", borderRadius: "6px" }}
              >
                <option value="">— Select Chapter —</option>
                {chapterOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Cards */}
        {selectedPackageName && (
          <>
            <h2 style={{ marginTop: 20, color: "white" }}>
              {selectedType === "Interactive Class" ? "Available Classes" : "Available Tests"}
            </h2>
            {conceptCards.length === 0 ? (
              <p style={{ color: "#fff" }}>
                {isConceptPackageName(selectedPackageName)
                  ? "Select Subject → Subtopic → Chapter to view items."
                  : "No items found."}
              </p>
            ) : (
              <div
                className="packages-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: "16px",
                  marginTop: "20px",
                }}
              >
                {conceptCards.map((pkg) => {
                  const subj = normalizeSubject(pkg.subject) || "Default";
                  const basePrice = parseFloat(pkg.price || pkg.totalPayable || 0) || 0;
                  const d1 = parseFloat(pkg.regularDiscount || 0) || 0;
                  const d2 = parseFloat(pkg.additionalDiscount || 0) || 0;
                  const computedFinal = basePrice - (basePrice * d1) / 100 - (basePrice * d2) / 100;
                  const finalPrice = Number.isFinite(parseFloat(pkg.totalPayable))
                    ? parseFloat(pkg.totalPayable)
                    : computedFinal;

                  return (
                    <div
                      key={pkg.id}
                      className={`zoom-card card-${subj.toLowerCase().replace(/\s+/g,'') || "default"}`}
                      style={{
                        borderRadius: "12px",
                        padding: "15px",
                        color: "#333",
                        fontSize: "14px",
                        boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
                        background: "#fff",
                        transition: "transform 0.2s, box-shadow 0.2s",
                      }}
                    >
                      <div className="zoom-card-inner" style={{ textAlign: "center" }}>
                        <img
                          src={subjectImages[subj] || subjectImages.Default}
                          alt={subj}
                          style={{
                            width: "80px",
                            height: "80px",
                            objectFit: "contain",
                            marginBottom: "8px",
                            borderRadius: "10px",
                            backgroundColor: "rgba(255,255,255,0.05)",
                          }}
                        />
                        <h3 style={{ fontSize: "16px", fontWeight: "600", color: "#222", marginBottom: "4px" }}>
                          {pkg.concept || pkg.packageName}
                        </h3>
                        <span style={{ display: "block", fontSize: "13px", marginBottom: "10px", color: "#555" }}>
                          {subj} {pkg.subtopic ? "→ " + pkg.subtopic + " → " : ""}{pkg.chapter}
                        </span>

                        {/* Price Section */}
                        <div style={{ textAlign: "left", marginTop: "8px" }}>
                          <p>
                            <b>Price:</b>{" "}
                            <span style={{ textDecoration: d1 || d2 ? "line-through" : "none" }}>
                              ₹{basePrice.toFixed(2)}
                            </span>
                          </p>
                          {(d1 || d2) && (
                            <p>
                              <b>Discounted:</b> ₹{finalPrice.toFixed(2)}
                            </p>
                          )}
                          {pkg.perHour && pkg.duration && (
                            <p>
                              <b>Duration:</b> {pkg.duration} hrs × ₹{pkg.perHour}/hr
                            </p>
                          )}
                        </div>

                        {/* Add to Cart */}
                        <button
                          onClick={() => addToCart(pkg)}
                          style={{
                            marginTop: "10px",
                            padding: "6px 12px",
                            background: "#1e90ff",
                            color: "#fff",
                            border: "none",
                            borderRadius: "6px",
                            cursor: "pointer",
                          }}
                        >
                          Add to Cart
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Cart Sidebar */}
      <div
        style={{
          flex: 1,
          background: "#ffffff11",
          padding: "20px",
          borderRadius: "12px",
          height: "fit-content",
          position: "sticky",
          top: "20px",
          alignSelf: "start",
        }}
      >
        <h2 style={{ color: "#fff", marginBottom: "15px" }}>Cart</h2>
        {cart.length === 0 ? (
          <p style={{ color: "#fff" }}>Cart is empty</p>
        ) : (
          <>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {cart.map((pkg) => (
                <li
                  key={pkg.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "10px",
                    color: "#fff",
                  }}
                >
                  <span>{pkg.packageName || pkg.concept}</span>
                  <span>₹{parseFloat(pkg.totalPayable || pkg.price || 0).toFixed(2)}</span>
                  <button
                    onClick={() => removeFromCart(pkg.id)}
                    style={{
                      marginLeft: "10px",
                      background: "transparent",
                      border: "none",
                      color: "#ff4757",
                      cursor: "pointer",
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <p style={{ color: "#fff", fontWeight: "600" }}>Total: ₹{cartTotal.toFixed(2)}</p>
            <button
              onClick={handleCheckout}
              style={{
                marginTop: "10px",
                padding: "10px",
                width: "100%",
                background: "#2ed573",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: "600",
              }}
            >
              Checkout
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default StudentDashboard;
