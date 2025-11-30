/* src/pages/PromoterPackageDetail.jsx */
import React from "react";
import { useParams } from "react-router-dom";

export default function PromoterPackageDetail() {
  const { id } = useParams();
  return (
    <div>
      <h2>Package Detail</h2>
      <p>Showing package id: <strong>{id}</strong></p>
    </div>
  );
}
