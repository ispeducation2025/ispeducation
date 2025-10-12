// src/pages/Privacy.jsx
import React from "react";
import { useNavigate } from "react-router-dom";

const Privacy = () => {
  const navigate = useNavigate();

  return (
    <div style={{ padding: "30px", maxWidth: "800px", margin: "0 auto", fontFamily: "Arial" }}>
      <button
        onClick={() => navigate("/")}
        style={{
          padding: "8px 16px",
          background: "#1e90ff",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          marginBottom: "20px"
        }}
      >
        ← Home
      </button>

      <h1>Privacy Policy</h1>
      <p>
        <p>
  ISP Education values your privacy. This Privacy Policy explains what personal information 
  we collect, how we use it, and your rights regarding your data.
</p>

<h3>1. Information Collection</h3>
<p>
  We collect information you provide when registering, enrolling in courses, or using our services, 
  including name, email, phone number, class grade, and payment details.
</p>

<h3>2. Use of Information</h3>
<p>
  Your information is used to provide educational services, process payments, 
  improve user experience, and communicate important updates.
</p>

<h3>3. Data Sharing</h3>
<p>
  We do not sell or rent your personal information. We may share information with 
  trusted service providers who assist us in delivering services, under strict confidentiality.
</p>

<h3>4. Data Security</h3>
<p>
  We implement reasonable security measures to protect your data from unauthorized access, 
  loss, or misuse.
</p>

<h3>5. Your Rights</h3>
<p>
  You may request access, correction, or deletion of your personal data at any time by contacting us.
</p>

<h3>6. Cookies</h3>
<p>
  We may use cookies to improve site performance and user experience. 
  You can disable cookies in your browser settings.
</p>

      </p>
    </div>
  );
};

export default Privacy;
