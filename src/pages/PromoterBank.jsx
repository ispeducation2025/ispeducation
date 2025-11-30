/* src/pages/PromoterBank.jsx */
import React, { useEffect, useState } from "react";
import { auth, db } from "../firebase/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";

export default function PromoterBank() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userDocId, setUserDocId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // form
  const [type, setType] = useState("UPI"); // "UPI" or "BANK"
  const [upiId, setUpiId] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [verified, setVerified] = useState(false);
  const [linkedAt, setLinkedAt] = useState(null);

  // responsiveness
  const [isNarrow, setIsNarrow] = useState(typeof window !== "undefined" ? window.innerWidth < 720 : false);
  useEffect(() => {
    function onResize() {
      setIsNarrow(window.innerWidth < 720);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let unsub = null;
    setLoading(true);
    setError("");

    unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserDocId(null);
        setLoading(false);
        return;
      }

      try {
        // Attempt to read users/{uid} doc
        const uDocRef = doc(db, "users", user.uid);
        const snap = await getDoc(uDocRef);
        if (snap.exists()) {
          const data = snap.data() || {};
          setUserDocId(snap.id);

          // pick bank/upi info from common fields (bankDetails or promoterBankDetails)
          const b = data.bankDetails || data.promoterBankDetails || data.bank || null;
          if (b) {
            setType(b.type || (b.upiId ? "UPI" : "BANK"));
            setUpiId(b.upiId || "");
            setBankName(b.bankName || b.bank || "");
            setAccountName(b.accountName || b.name || "");
            setAccountNumber(b.accountNumber || b.ac || b.account || "");
            setIfsc(b.ifsc || b.ifscCode || "");
            setVerified(Boolean(b.verified));
            // normalize linkedAt to Date or null
            if (b.linkedAt) {
              try {
                const la = b.linkedAt;
                if (typeof la.toDate === "function") setLinkedAt(la.toDate());
                else setLinkedAt(new Date(la));
              } catch {
                setLinkedAt(null);
              }
            } else {
              setLinkedAt(null);
            }
          } else {
            setType("UPI");
            setUpiId("");
            setBankName("");
            setAccountName("");
            setAccountNumber("");
            setIfsc("");
            setVerified(false);
            setLinkedAt(null);
          }
        } else {
          // If no doc exists at users/{uid}, still set userDocId to uid so updateDoc writes into that path (may be blocked by rules)
          setUserDocId(user.uid);
        }
      } catch (e) {
        console.error("PromoterBank: failed to load user doc", e);
        setError("Failed to load your profile. Check network or Firestore rules.");
      } finally {
        setLoading(false);
      }
    });

    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  function validate() {
    setError("");
    if (type === "UPI") {
      if (!upiId || !upiId.includes("@")) {
        setError("Please enter a valid UPI ID (e.g. name@bank). If you don't have UPI, choose Bank option.");
        return false;
      }
    } else {
      if (!bankName || !accountNumber || !accountName || !ifsc) {
        setError("Please fill bank name, account holder name, account number and IFSC.");
        return false;
      }
      // optional IFSC basic check (not strict)
      if (ifsc && !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(ifsc)) {
        // warn but allow saving
        // you can setError(...) and return false if you want stricter validation
      }
    }
    return true;
  }

  async function handleSave(e) {
    e?.preventDefault();
    setSuccess("");
    if (!validate()) return;
    if (!userDocId) {
      setError("Unable to determine your user document. Are you logged in?");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const update = {
        bankDetails: {
          type,
          upiId: type === "UPI" ? upiId.trim() : "",
          bankName: type === "BANK" ? bankName.trim() : "",
          accountName: type === "BANK" ? accountName.trim() : "",
          accountNumber: type === "BANK" ? accountNumber.trim() : "",
          ifsc: type === "BANK" ? ifsc.trim() : "",
          verified: false,
          linkedAt: serverTimestamp()
        },
        // optional convenience fields for admin flows
        promoterBankDetails: {
          type,
          upiId: type === "UPI" ? upiId.trim() : "",
          bankName: type === "BANK" ? bankName.trim() : "",
          accountName: type === "BANK" ? accountName.trim() : "",
          accountNumber: type === "BANK" ? accountNumber.trim() : "",
          ifsc: type === "BANK" ? ifsc.trim() : "",
          verified: false,
          linkedAt: serverTimestamp()
        }
      };

      const uDocRef = doc(db, "users", userDocId);
      await updateDoc(uDocRef, update);

      setSuccess("Bank/UPI details saved. Admin will verify and use this for payouts.");
      setVerified(false);
      setLinkedAt(new Date());
    } catch (e) {
      console.error("PromoterBank: save failed", e);
      setError("Failed to save bank details. Check Firestore rules or network.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!userDocId) return;
    const ok = window.confirm("Remove saved bank/UPI details? This cannot be undone from client.");
    if (!ok) return;
    setSaving(true);
    setError("");
    try {
      const uDocRef = doc(db, "users", userDocId);
      await updateDoc(uDocRef, {
        bankDetails: null,
        promoterBankDetails: null,
        lastBankRemovedAt: serverTimestamp()
      });
      setUpiId("");
      setBankName("");
      setAccountName("");
      setAccountNumber("");
      setIfsc("");
      setVerified(false);
      setLinkedAt(null);
      setSuccess("Bank/UPI details removed.");
    } catch (e) {
      console.error("PromoterBank: remove failed", e);
      setError("Failed to remove bank details. Check Firestore rules or network.");
    } finally {
      setSaving(false);
    }
  }

  // small helpers for responsive layout
  const formContainerStyle = {
    background: "#fff",
    padding: isNarrow ? 12 : 16,
    borderRadius: 8,
    boxShadow: "0 6px 18px rgba(2,6,23,0.06)",
  };
  const twoColStyle = {
    display: "grid",
    gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr",
    gap: 12,
    marginBottom: 12
  };
  const rowStyle = { display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" };
  const labelStyle = { display: "block", fontSize: 13, color: "#0f172a", marginBottom: 6 };
  const inputBase = { width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e6eef4", boxSizing: "border-box" };
  const buttonPrimary = { padding: "10px 14px", borderRadius: 8, border: "none", background: "#059669", color: "#fff", cursor: "pointer" };
  const buttonSecondary = { padding: "10px 14px", borderRadius: 8, border: "1px solid #e6eef4", background: "#fff", cursor: "pointer" };

  // format linkedAt nicely in India timezone
  function formatLinkedAt(d) {
    if (!d) return "—";
    try {
      const date = d instanceof Date ? d : new Date(d);
      return date.toLocaleString("en-IN", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
    } catch {
      return String(d);
    }
  }

  return (
    <div style={{ padding: 20, minHeight: "60vh", maxWidth: 920, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0 }}>Link Bank / UPI for payouts</h2>
      <p style={{ color: "#475569" }}>
        Add your UPI or bank account so admin can send commission payouts. Admin will verify details before paying.
      </p>

      {loading ? (
        <div style={{ padding: 18, background: "#fff", borderRadius: 8 }}>Loading…</div>
      ) : (
        <form onSubmit={handleSave} style={formContainerStyle}>
          {error && <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: "#fff2f2", color: "#9f1239" }}>{error}</div>}
          {success && <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: "#ecfdf5", color: "#065f46" }}>{success}</div>}

          <div style={rowStyle}>
            <label style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <input type="radio" checked={type === "UPI"} onChange={() => setType("UPI")} /> <span style={{ fontSize: 14 }}>UPI</span>
            </label>
            <label style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <input type="radio" checked={type === "BANK"} onChange={() => setType("BANK")} /> <span style={{ fontSize: 14 }}>Bank Account</span>
            </label>
          </div>

          {type === "UPI" ? (
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>UPI ID</label>
              <input
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="example@bank"
                style={inputBase}
                inputMode="email"
              />
            </div>
          ) : (
            <>
              <div style={twoColStyle}>
                <div>
                  <label style={labelStyle}>Account holder name</label>
                  <input
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="Name on account"
                    style={inputBase}
                    autoComplete="name"
                  />
                </div>

                <div>
                  <label style={labelStyle}>Account number</label>
                  <input
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="123456789012"
                    style={inputBase}
                    inputMode="numeric"
                  />
                </div>
              </div>

              <div style={twoColStyle}>
                <div>
                  <label style={labelStyle}>Bank name</label>
                  <input
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="State Bank of..."
                    style={inputBase}
                    autoComplete="organization"
                  />
                </div>

                <div>
                  <label style={labelStyle}>IFSC code</label>
                  <input
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value)}
                    placeholder="SBIN0000123"
                    style={inputBase}
                    inputMode="text"
                  />
                </div>
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            <button type="submit" disabled={saving} style={buttonPrimary}>
              {saving ? "Saving…" : "Save details"}
            </button>
            <button type="button" onClick={handleRemove} disabled={saving} style={buttonSecondary}>
              Remove
            </button>
            <button
              type="button"
              onClick={() => {
                // clear local form only (does not remove saved data)
                setUpiId("");
                setBankName("");
                setAccountName("");
                setAccountNumber("");
                setIfsc("");
                setSuccess("");
                setError("");
              }}
              style={{ ...buttonSecondary, background: "#fff", border: "1px solid #e6eef4" }}
            >
              Clear local
            </button>
          </div>

          <div style={{ marginTop: 12, color: "#64748b", fontSize: 13 }}>
            <div>Verified: <strong style={{ color: verified ? "#065f46" : "#92400e" }}>{verified ? "Yes" : "No"}</strong></div>
            <div style={{ marginTop: 6 }}>
              Linked at: <strong>{linkedAt ? formatLinkedAt(linkedAt) : "—"}</strong>
            </div>
            <div style={{ marginTop: 8 }}>
              Note: Admin will verify details before any payout. Do not share sensitive documents here.
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
