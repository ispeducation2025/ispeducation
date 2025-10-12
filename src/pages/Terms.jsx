// src/pages/Terms.jsx
import React from "react";
import { useNavigate } from "react-router-dom";

const Terms = () => {
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

      <h1>Terms & Conditions</h1>
      <p>
        <p>
  Welcome to ISP Education! By accessing or using our website and services, 
  you agree to comply with and be bound by the following Terms & Conditions. 
  Please read them carefully before using our platform.
</p>

<h3>1. Use of Website</h3>
<p>
  You agree to use the website only for lawful purposes and in a manner 
  that does not infringe the rights of, restrict, or inhibit anyone else's use. 
  Unauthorized use may give rise to a claim for damages or be a criminal offense.
</p>

<h3>2. User Accounts</h3>
<p>
  You are responsible for maintaining the confidentiality of your account credentials. 
  You must notify us immediately of any unauthorized use of your account.
</p>

<h3>3. Intellectual Property</h3>
<p>
  All content on ISP Education, including text, graphics, logos, videos, and study materials, 
  is owned by ISP Education or its licensors and protected by copyright laws. 
  You may not reproduce, distribute, or create derivative works without permission.
</p>

<h3>4. Payments and Packages</h3>
<p>
  All purchases of courses, packages, or study materials are subject to our pricing and 
  payment policies. Once payment is confirmed, access is granted to the respective content.
</p>

<h3>5. Liability</h3>
<p>
  ISP Education is not liable for any indirect, incidental, or consequential loss 
  arising from the use of our platform. We strive to ensure accuracy of content 
  but do not guarantee completeness or error-free materials.
</p>

<h3>6. Modifications</h3>
<p>
  We reserve the right to modify these Terms & Conditions at any time. 
  Continued use of the website constitutes acceptance of any changes.
</p>

<h3>7. Governing Law</h3>
<p>
  These Terms & Conditions are governed by the laws of India. 
  Any disputes will be subject to the jurisdiction of Indian courts.
</p>

      </p>
    </div>
  );
};

export default Terms;
