// src/pages/SignInPage.jsx
import React, { useState } from "react";
import { auth, db, googleProvider } from "../firebase/firebaseConfig";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  runTransaction,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";

// Image imports
import logo from "../assets/logo.png";
import coachingImg from "../assets/coaching.png";
import founderImg from "../assets/founder.png";

const ADMIN_UID = "Q3Z7mgam8IOMQWQqAdwWEQmpqNn2";

const SignInPage = () => {
  const navigate = useNavigate();

  // Shared form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(""); // used only on Sign Up
  const [phone, setPhone] = useState("+91");
  const [classGrade, setClassGrade] = useState("");
  const [syllabus, setSyllabus] = useState("");
  const [referralId, setReferralId] = useState("");
  const [error, setError] = useState("");
  const [businessArea, setBusinessArea] = useState(""); // NEW

  // Sign up / Sign in toggle
  const [isSignUp, setIsSignUp] = useState(false);

  // Student who is also a promoter
  const [alsoPromoter, setAlsoPromoter] = useState(false);

  // Role selection modal on login
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [loginUserData, setLoginUserData] = useState(null);

  // --------- Helpers ---------
  const generateUniqueId = async (fullNameParam) => {
    const fullName =
      typeof fullNameParam === "string" && fullNameParam.trim()
        ? fullNameParam
        : name;

    const prefix = "ISP";
    const namePart = fullName
      ? fullName.substring(0, 3).toUpperCase().padEnd(3, "X")
      : "USR";

    const counterRef = doc(db, "counters", namePart);

    try {
      const newCount = await runTransaction(db, async (transaction) => {
        const counterSnap = await transaction.get(counterRef);
        if (!counterSnap.exists()) {
          transaction.set(counterRef, { count: 1 });
          return 1;
        } else {
          const current = counterSnap.data().count || 0;
          const updated = current + 1;
          transaction.update(counterRef, { count: updated });
          return updated;
        }
      });

      const serial = String(newCount).padStart(3, "0");
      return `${prefix}${namePart}${serial}`;
    } catch (err) {
      console.error("generateUniqueId transaction error:", err);
      const rand = Math.floor(100 + Math.random() * 900);
      return `${prefix}${namePart}${String(rand).padStart(3, "0")}`;
    }
  };

  // --------- Email Sign Up ---------
  const handleEmailSignUp = async () => {
    setError("");

    // Basic validation
    if (!email || !password || !role) {
      setError("Email, Password and Role are required.");
      return;
    }
    if (!name) {
      setError("Name is required.");
      return;
    }
    if (role === "student") {
      if (!classGrade) {
        setError("Class is required for students.");
        return;
      }
      if (!syllabus) {
        setError("Syllabus is required for students.");
        return;
      }
    }
    if (role === "promoter" || alsoPromoter) {
      if (!phone || phone.trim().length < 8) {
        setError("Valid phone number is required for promoters.");
        return;
      }
      if (!businessArea || businessArea.trim() === "") {
        setError("Business Area is required for promoters.");
        return;
      }
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;

      const uniqueId = await generateUniqueId(name);

      const userData = {
        uid: user.uid,
        uniqueId,
        name,
        email,
        phone: phone || "",
        role, // 'student' or 'promoter'
        referralId: role === "student" ? referralId || null : null,
        classGrade: role === "student" ? classGrade : null,
        syllabus: role === "student" ? syllabus : null,
        alsoPromoter,
        promoterApproved: false,
        businessArea: role === "promoter" || alsoPromoter ? businessArea : null, // added businessArea
        createdAt: serverTimestamp(),
      };

      await setDoc(doc(db, "users", user.uid), userData);

      alert(`Signup successful! Your Unique ID is ${uniqueId}`);

      if (role === "student") {
        navigate("/student-dashboard");
      } else {
        alert("Promoter access is pending admin approval.");
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Error during signup.");
    }
  };

  // --------- Email Sign In ---------
  const handleEmailSignIn = async () => {
    setError("");
    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;
      console.log("Signed in Firebase user:", user);

      // Admin short-circuit
      if (user.uid === ADMIN_UID) {
        navigate("/admin-dashboard");
        return;
      }

      // Load user profile
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (!userDoc.exists()) {
        setError("User not found.");
        return;
      }

      const userData = userDoc.data();
      console.log("Fetched userData:", userData);

      // Case 1: User is student but also promoter
      if (userData.alsoPromoter === true) {
        if (userData.promoterApproved) {
          setLoginUserData(userData);
          setShowRoleModal(true);
          return;
        } else {
          alert("Promoter access pending admin approval. Logging in as Student.");
          navigate("/student-dashboard");
          return;
        }
      }

      // Case 2: Pure promoter
      if (userData.role === "promoter") {
        if (!userData.promoterApproved) {
          alert("Promoter access pending admin approval.");
          navigate("/student-dashboard");
          return;
        } else {
          navigate("/promoter-dashboard");
          return;
        }
      }

      // Case 3: Regular student
      navigate("/student-dashboard");
    } catch (err) {
      console.error(err);
      setError(err.message || "Sign-in failed.");
    }
  };

  // --------- Role choice after login ---------
  const handleRoleSelect = async (selectedRole) => {
    setShowRoleModal(false);

    if (selectedRole === "promoter") {
      let userData = loginUserData;

      if (!userData) {
        try {
          const user = auth.currentUser;
          if (!user) {
            alert("Session expired. Please sign in again.");
            return;
          }
          const snap = await getDoc(doc(db, "users", user.uid));
          if (snap.exists()) userData = snap.data();
        } catch (err) {
          console.error("Error fetching user data:", err);
        }
      }

      if (userData && userData.promoterApproved) {
        navigate("/promoter-dashboard");
      } else {
        alert("Promoter access pending admin approval. Logging in as Student.");
        navigate("/student-dashboard");
      }
    } else {
      navigate("/student-dashboard");
    }
  };

  // --------- Google Sign In ---------
  const handleGoogleSignIn = async () => {
    setError("");

    if (isSignUp && !role) {
      setError("Please select role before Google Sign-In");
      return;
    }

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      if (!name) setName(user.displayName || "");
      if (!email) setEmail(user.email || "");

      const userRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userRef);

      // First-time Google Sign Up
      if (!userDoc.exists() && isSignUp) {
        const uniqueId = await generateUniqueId(name || user.displayName || "");

        if (role === "student" && (!classGrade || !syllabus)) {
          setError("Please select Class & Syllabus before Google Sign-In");
          return;
        }

        const userData = {
          uid: user.uid,
          uniqueId,
          name: name || user.displayName || "",
          email: user.email || "",
          phone: phone || "",
          role,
          referralId: role === "student" ? referralId || null : null,
          classGrade: role === "student" ? classGrade : null,
          syllabus: role === "student" ? syllabus : null,
          alsoPromoter,
          promoterApproved: false,
          createdAt: serverTimestamp(),
        };

        if (role === "promoter" || alsoPromoter) {
          userData.promoterSince = serverTimestamp();
        }

        await setDoc(userRef, userData);
        alert(`Signup successful! Your Unique ID is ${uniqueId}`);
      }

      // Ensure user profile exists
      const finalSnap = await getDoc(userRef);
      if (!finalSnap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          name: user.displayName || "",
          email: user.email || "",
          role: "student",
          alsoPromoter: false,
          promoterApproved: false,
          createdAt: serverTimestamp(),
        });
      }

      const finalData = (await getDoc(userRef)).data();
      console.log("Fetched finalData:", finalData);

      // Admin check
      if (user.uid === ADMIN_UID) {
        navigate("/admin-dashboard");
        return;
      }

      // Case 1: User is student but also promoter
      if (finalData.alsoPromoter === true) {
        if (finalData.promoterApproved) {
          setLoginUserData(finalData);
          setShowRoleModal(true);
          return;
        } else {
          alert("Promoter access pending admin approval. Logging in as Student.");
          navigate("/student-dashboard");
          return;
        }
      }

      // Case 2: Pure promoter
      if (finalData.role === "promoter") {
        if (!finalData.promoterApproved) {
          alert("Promoter access pending admin approval.");
          navigate("/student-dashboard");
          return;
        } else {
          navigate("/promoter-dashboard");
          return;
        }
      }

      // Case 3: Regular student
      navigate("/student-dashboard");
    } catch (err) {
      console.error(err);
      setError(err.message || "Google sign-in failed.");
    }
  };

  // --------- UI ---------
  return (
    <div className="signin-page" aria-live="polite">
      {/* NOTE: For mobile we want the form first. This is handled in CSS media queries below. */}
      <div className="left-panel" aria-hidden={false}>
        <h1>Welcome to ISP Education</h1>
        <p>"Empower Yourself with Online & Offline Learning Excellence"</p>

        <div className="images-row" role="presentation">
          <div className="image-box">
            <img src={coachingImg} alt="Coaching" />
          </div>
          <div className="image-box">
            <img src={founderImg} alt="Founder" />
          </div>
        </div>

        <div className="about-founder">
          <div className="about-section">
            <h2>About ISP Education</h2>
            <p>
              At ISP Education, we use modern techniques to analyze and
              understand each student's learning and developmental needs. We
              emphasize knowing one's personality, working on strengths, and
              loving what you do. This ensures personalized, effective, and
              engaging learning for every student.
            </p>
            <h2>Why ISP</h2>
            <p>
              ISP Education is a visionary education system that believes every
              individual is gifted with unique qualities. We provide support and
              enablers to help students identify their strengths and achieve
              their true potential.
            </p>
          </div>
          <div className="founder-section">
            <div className="founder-note">
              <h3>Thought</h3>
              <p>
                "Every life form has its own learning style… Look within; you
                already know what you are learning. Embrace your uniqueness and
                keep learning."
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="right-panel" role="region" aria-label="Sign in form">
        <div className="form-card">
          <div style={{ textAlign: "center", marginBottom: "15px" }}>
            <img
              src={logo}
              alt="ISP Logo"
              style={{ width: "80px", height: "80px", objectFit: "contain" }}
            />
          </div>

          <h2>{isSignUp ? "Create Account" : "Sign In"}</h2>

          <div className="signup-form">
            {/* Sign Up-only fields */}
            {isSignUp && (
              <>
                <input
                  type="text"
                  placeholder="Full Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  aria-label="Full Name"
                />
                <input
                  type="tel"
                  placeholder="+91 9876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required={role === "promoter" || alsoPromoter}
                  aria-label="Phone number"
                />
                {/* Business Area for Promoter */}
                {(role === "promoter" || alsoPromoter) && (
                  <input
                    type="text"
                    placeholder="Business Area / Region"
                    value={businessArea}
                    onChange={(e) => setBusinessArea(e.target.value)}
                    required
                    aria-label="Business Area"
                  />
                )}
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  required
                  aria-label="Select Role"
                >
                  <option value="">Select Role</option>
                  <option value="student">Student</option>
                  <option value="promoter">Promoter</option>
                </select>
              </>
            )}

            {/* Student + Also promoter checkbox (Sign Up) */}
            {isSignUp && role === "student" && (
              <label
                style={{
                  fontSize: "12px",
                  marginTop: "5px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  position: "relative",
                  color: "#fff",
                }}
              >
                <input
                  type="checkbox"
                  checked={alsoPromoter}
                  onChange={(e) => setAlsoPromoter(e.target.checked)}
                  aria-label="Also register as promoter"
                />
                Also register as Promoter
              </label>
            )}

            {/* Common fields */}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              aria-label="Email"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-label="Password"
            />

            {/* Student-only more fields on Sign Up */}
            {isSignUp && role === "student" && (
              <>
                <select
                  value={classGrade}
                  onChange={(e) => setClassGrade(e.target.value)}
                  required
                  aria-label="Class Grade"
                >
                  <option value="">Select Class</option>
                  <option value="6th">6th</option>
                  <option value="7th">7th</option>
                  <option value="8th">8th</option>
                  <option value="9th">9th</option>
                  <option value="10th">10th</option>
                  <option value="Professional Course">Professional Course</option>
                </select>

                <select
                  value={syllabus}
                  onChange={(e) => setSyllabus(e.target.value)}
                  required
                  aria-label="Syllabus"
                >
                  <option value="">Select Syllabus</option>
                  <option value="ICSE">ICSE</option>
                  <option value="CBSE">CBSE</option>
                  <option value="State Karnataka">State Karnataka</option>
                </select>

                <input
                  type="text"
                  placeholder="Referral ID (Optional)"
                  value={referralId}
                  onChange={(e) => setReferralId(e.target.value)}
                  aria-label="Referral ID"
                />
              </>
            )}

            {/* Primary action */}
            <button
              onClick={isSignUp ? handleEmailSignUp : handleEmailSignIn}
              className="signup-btn"
            >
              {isSignUp ? "Sign Up" : "Sign In"}
            </button>

            {/* Google button only for Sign Up mode (as per your flow) */}
            {isSignUp && (
              <button
                onClick={handleGoogleSignIn}
                className="signup-btn google-btn"
              >
                Sign Up with Google
              </button>
            )}

            {/* Toggle */}
            <p
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError("");
              }}
              style={{ cursor: "pointer" }}
            >
              {isSignUp
                ? "Already have an account? Sign In"
                : "Don't have an account? Sign Up"}
            </p>

            {error && <p className="signup-error" role="alert">{error}</p>}
          </div>
        </div>
      </div>

      {/* Role Modal for student who is also promoter */}
      {showRoleModal && (
        <div className="role-modal" role="dialog" aria-modal="true">
          <div className="role-modal-card">
            <h3>Select Role to Login</h3>
            <button onClick={() => handleRoleSelect("student")}>Student</button>
            <button onClick={() => handleRoleSelect("promoter")}>
              Promoter
            </button>
          </div>
        </div>
      )}

      {/* Inline styles to keep this self-contained */}
      <style>{`
        .signin-page {
          display: flex;
          font-family: Arial, sans-serif;
          height: 100vh;
          overflow: hidden;
          gap: 18px;
          padding: 18px;
          box-sizing: border-box;
        }

        /* Left panel (visual / info) */
        .left-panel {
          flex: 1;
          background: linear-gradient(135deg, #ff416c, #ff4b2b, #ff6a00, #f9d423, #24c6dc, #514a9d, #6a11cb, #2575fc);
          background-size: 400% 400%;
          animation: gradientBG 15s ease infinite;
          color: #fff;
          padding: 25px 30px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          justify-content: flex-start;
          align-items: center;
          overflow-y: auto;
          border-radius: 12px;
        }
        @keyframes gradientBG {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .images-row {
          display: flex;
          gap: 20px;
          margin-top: 10px;
          width: 100%;
          justify-content: center;
        }
        .image-box {
          flex: 0 0 48%;
          height: 320px;
          border-radius: 15px;
          overflow: hidden;
          background: rgba(255,255,255,0.18);
          box-shadow: 0 6px 18px rgba(0,0,0,0.12);
        }
        .image-box img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .about-founder {
          display: flex;
          gap: 15px;
          align-items: flex-start;
          margin-top: 18px;
          width: 100%;
        }
        .about-section { flex: 2; }
        .founder-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .founder-note {
          background: rgba(255,255,255,0.15);
          padding: 8px;
          border-radius: 8px;
          font-size: 13px;
          text-align: center;
        }

        /* Right panel (form) */
        .right-panel {
          width: 38%;
          max-width: 420px;
          min-width: 300px;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
          border-radius: 12px;
          background: linear-gradient(135deg, rgba(15,32,39,0.95), rgba(32,58,67,0.95));
        }
        .form-card {
          width: 100%;
          background: linear-gradient(135deg, #ffdde1, #9cdfeeff);
          padding: 25px 20px;
          border-radius: 12px;
          box-shadow: 0 8px 25px rgba(105, 250, 255, 0.12);
          display: flex;
          flex-direction: column;
          align-items: stretch;
        }
        .signup-form {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .signup-form input, .signup-form select {
          padding: 10px;
          font-size: 14px;
          border: 1px solid #ccc;
          border-radius: 8px;
          box-sizing: border-box;
        }
        .signup-btn {
          padding: 10px;
          background: #ff1493;
          color: #fff;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: bold;
          transition: all 0.2s;
        }
        .signup-btn:hover { transform: translateY(-1px); }
        .google-btn { background: #4285f4; margin-top: 5px; }
        .signup-error { color: red; font-size: 12px; margin-top: 5px; text-align: center; }

        /* Role Modal CSS */
        .role-modal {
          position: fixed;
          top:0; left:0; right:0; bottom:0;
          background: rgba(0,0,0,0.5);
          display:flex;
          justify-content:center;
          align-items:center;
          z-index: 9999;
        }
        .role-modal-card {
          background: #fff;
          padding: 25px 30px;
          border-radius: 15px;
          display: flex;
          flex-direction: column;
          gap: 15px;
          text-align: center;
          max-width: 300px;
          width: 90%;
        }
        .role-modal-card h3 { margin: 0; font-size: 18px; color: #333; }
        .role-modal-card button {
          padding: 10px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: bold;
          font-size: 14px;
          transition: 0.2s;
        }
        .role-modal-card button:first-of-type { background: #0d6efd; color: #fff; }
        .role-modal-card button:last-of-type { background: #28a745; color: #fff; }
        .role-modal-card button:hover { opacity: 0.95; }

        /* Responsive: stack vertically on smaller screens
           and show the FORM first (so easier to access on phones) */
        @media (max-width: 1100px) {
          .signin-page {
            flex-direction: column-reverse; /* form (right-panel) will appear first */
            align-items: stretch;
            height: auto;
            overflow: visible;
            padding: 12px;
          }
          .left-panel, .right-panel {
            width: 100%;
            max-width: 100%;
            min-width: 0;
            border-radius: 12px;
            margin: 8px 0;
          }
          .right-panel {
            order: -1; /* ensure right-panel is placed first visually (just in case) */
            padding: 14px;
            background: transparent;
          }
          .form-card {
            padding: 18px;
          }
          .images-row .image-box {
            height: 220px;
          }
          .about-founder {
            flex-direction: column;
          }
        }

        /* Replace your existing .image-box and .image-box img rules with the following */

/* container for each image */
.image-box {
  flex: 0 0 48%;
  height: 320px;            /* desktop default */
  border-radius: 15px;
  overflow: hidden;
  background: rgba(255,255,255,0.12);
  box-shadow: 0 6px 18px rgba(0,0,0,0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;             /* give a little breathing room */
  box-sizing: border-box;
}

/* make image fully visible without cropping */
.image-box img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;      /* <-- important: prevents cropping */
  display: block;
  margin: 0 auto;
  border-radius: 10px;
}


      `}</style>
    </div>
  );
};

export default SignInPage;
