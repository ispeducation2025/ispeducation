// src/pages/Shipping.jsx
import React from "react";
import { useNavigate } from "react-router-dom";

const Shipping = () => {
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

      <h1>Shipping Policy</h1>
      <p>
        <p>
  ISP Education primarily provides digital content (courses, PDFs, videos). 
  If physical materials are offered, this Shipping Policy applies.
</p>

<h3>1. Delivery Method</h3>
<p>
  Physical materials will be shipped via registered courier services. Tracking information 
  will be shared with the customer.
</p>

<h3>2. Delivery Time</h3>
<p>
  Delivery typically takes 5–10 business days within India. 
  Delays due to unforeseen circumstances or courier issues are possible.
</p>

<h3>3. Shipping Charges</h3>
<p>
  Shipping fees, if applicable, are included at checkout. Free shipping promotions may apply.
</p>

<h3>4. Address Accuracy</h3>
<p>
  Customers must provide accurate shipping addresses. ISP Education is not responsible 
  for lost packages due to incorrect details.
</p>

      </p>
    </div>
  );
};

export default Shipping;
