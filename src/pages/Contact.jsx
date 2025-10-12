// src/pages/Contact.jsx
import React from "react";
import { useNavigate } from "react-router-dom";

const Contact = () => {
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
          marginBottom: "20px",
        }}
      >
        ← Home
      </button>

      <h1>Contact Us</h1>
      <p>
        We are here to assist you with any questions or issues regarding our services.
        Reach out using any of the following methods:
      </p>

      <h3>Email:</h3>
      <p>info@ispeducation.in</p>

      <h3>Phone/WhatsApp:</h3>
      <p>+91 9113550018</p>

      <h3>Office Address:</h3>
      <p>
        ISP Education, 360, Krishna Kaveri Tower, 4th Floor, 80 feet Road, Hesarghatta Rd, AGB Layout, Bengaluru, Karnataka 560090
        <br />
        Bengaluru, Karnataka, India
      </p>

      <h3>Support Hours:</h3>
      <p>Monday – Friday: 10:00 AM – 6:00 PM IST</p>
    </div>
  );
};

export default Contact;
