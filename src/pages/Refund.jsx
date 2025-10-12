// src/pages/Refund.jsx
import React from "react";
import { useNavigate } from "react-router-dom";

const Refund = () => {
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

      <h1>Refund Policy</h1>
      <p>
        <p>
  ISP Education is committed to providing quality educational content. 
  This Refund Policy explains how refunds are handled.
</p>

<h3>1. Refund Eligibility</h3>
<p>
  Refunds are only available for paid courses or packages that have not been accessed, 
  unless otherwise specified. Once course materials are accessed, refunds are not applicable.
</p>

<h3>2. Request Process</h3>
<p>
  To request a refund, contact our support team within 7 days of purchase, 
  providing payment details and reason for refund.
</p>

<h3>3. Refund Method</h3>
<p>
  Approved refunds will be processed using the original payment method. 
  Processing time may take 5–7 business days.
</p>

<h3>4. Exceptions</h3>
<p>
  Promotional offers, discounts, or partially used courses may not be eligible 
  for a full refund.
</p>

      </p>
    </div>
  );
};

export default Refund;
