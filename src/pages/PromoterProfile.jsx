/* src/pages/PromoterProfile.jsx */
/* eslint-disable */
import React, { useEffect, useRef, useState } from "react";
import { auth, db, storage } from "../firebase/firebaseConfig";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { useNavigate } from "react-router-dom";

/**
 * PromoterProfile
 * - Loads users/{uid} doc for signed-in user
 * - Allows editing name, phone, email (read-only if from auth), address, city, state, pincode
 * - Business area, payout email
 * - ID proof upload (file), Address proof upload (file)
 * - Profile photo capture (camera) or file upload
 * - Uploads files to storage under: users/{uid}/{pathKey}-{timestamp}
 * - Writes URLs and meta into user doc (setDoc merge):
 *    profilePhotoUrl, idProof (object { url, name, uploadedAt, size }), addressProof (object ...), address (object), phone, businessArea, payoutEmail, updatedAt
 *
 * Responsive:
 * - switches to single column layout on small screens (window width < 820px)
 *
 * NOTE: This component assumes user is authenticated. If not, it redirects to "/".
 */

function friendlyBytes(n) {
  if (!n) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

export default function PromoterProfile() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaStreamRef = useRef(null);

  const [userDocId, setUserDocId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 820 : false);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    payoutEmail: "",
    businessArea: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    pincode: "",
    idType: "Aadhaar",
    idNumber: "",
  });

  const [profilePhotoPreview, setProfilePhotoPreview] = useState(null);
  const [idProofPreview, setIdProofPreview] = useState(null);
  const [addressProofPreview, setAddressProofPreview] = useState(null);

  const [profilePhotoFile, setProfilePhotoFile] = useState(null);
  const [idProofFile, setIdProofFile] = useState(null);
  const [addressProofFile, setAddressProofFile] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({}); // key -> percent

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth < 820);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const user = auth.currentUser;
        if (!user) {
          // not signed in — redirect to homepage (or login)
          navigate("/");
          return;
        }
        const uDocRef = doc(db, "users", user.uid);
        const snap = await getDoc(uDocRef);
        if (snap.exists()) {
          const data = snap.data() || {};
          setUserDocId(snap.id);
          setForm((f) => ({
            ...f,
            name: data.name || user.displayName || f.name,
            phone: data.phone || user.phoneNumber || f.phone,
            payoutEmail: data.payoutEmail || data.email || user.email || f.payoutEmail,
            businessArea: data.businessArea || f.businessArea,
            addressLine1: data.address?.line1 || "",
            addressLine2: data.address?.line2 || "",
            city: data.address?.city || "",
            state: data.address?.state || "",
            pincode: data.address?.pincode || "",
            idType: data.idProof?.type || f.idType,
            idNumber: data.idProof?.number || f.idNumber,
          }));

          if (data.profilePhotoUrl) setProfilePhotoPreview(data.profilePhotoUrl);
          if (data.idProof?.url) setIdProofPreview(data.idProof.url);
          if (data.addressProof?.url) setAddressProofPreview(data.addressProof.url);
        } else {
          // create a blank doc later when saving; set local uid so uploads path works
          setUserDocId(user.uid);
          setForm((f) => ({ ...f, name: user.displayName || f.name, payoutEmail: user.email || f.payoutEmail }));
        }
      } catch (e) {
        console.error("Failed to load promoter profile:", e);
        setError("Failed to load profile. Check network or Firestore rules.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CAMERA helpers
  async function startCamera() {
    setCameraError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Camera not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      mediaStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
    } catch (e) {
      console.error("startCamera error:", e);
      setCameraError("Unable to access camera. Check permissions.");
    }
  }

  function stopCamera() {
    try {
      const s = mediaStreamRef.current;
      if (s && s.getTracks) s.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    } catch (e) {
      // ignore
    } finally {
      setCameraActive(false);
    }
  }

  function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth || 640;
    c.height = v.videoHeight || 480;
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `profile-${Date.now()}.jpg`, { type: "image/jpeg" });
      setProfilePhotoFile(file);
      setProfilePhotoPreview(URL.createObjectURL(blob));
      stopCamera();
    }, "image/jpeg", 0.9);
  }

  // file inputs change
  function onProfileFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setProfilePhotoFile(f);
    setProfilePhotoPreview(URL.createObjectURL(f));
  }
  function onIdProofChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setIdProofFile(f);
    setIdProofPreview(URL.createObjectURL(f));
  }
  function onAddressProofChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setAddressProofFile(f);
    setAddressProofPreview(URL.createObjectURL(f));
  }

  // helper: upload file to storage and return url+meta
  async function uploadFile(file, pathKey) {
    if (!file || !userDocId) return null;
    setUploading(true);
    setUploadProgress((p) => ({ ...p, [pathKey]: 0 }));
    try {
      const sRef = storageRef(storage, `users/${userDocId}/${pathKey}-${Date.now()}`);
      // simple upload; no resumable progress events here
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      setUploadProgress((p) => ({ ...p, [pathKey]: 100 }));
      return { url, name: file.name, size: file.size, path: sRef.fullPath };
    } catch (e) {
      console.error("uploadFile error:", e);
      setError("Upload failed: " + (e?.message || e));
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function handleSave(e) {
    e?.preventDefault?.();
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      if (!auth.currentUser) {
        setError("Not signed in.");
        setSaving(false);
        return;
      }

      // validations
      if (!form.name || !form.phone) {
        setError("Please provide name and phone.");
        setSaving(false);
        return;
      }

      const updates = {};
      // Upload files if any
      const uploaded = {};
      if (profilePhotoFile) {
        setMessage("Uploading profile photo…");
        const r = await uploadFile(profilePhotoFile, "profilePhoto");
        if (r) uploaded.profilePhoto = r;
      }
      if (idProofFile) {
        setMessage("Uploading ID proof…");
        const r = await uploadFile(idProofFile, "idProof");
        if (r) uploaded.idProof = r;
      }
      if (addressProofFile) {
        setMessage("Uploading address proof…");
        const r = await uploadFile(addressProofFile, "addressProof");
        if (r) uploaded.addressProof = r;
      }

      // prepare doc updates
      updates.name = form.name;
      updates.phone = form.phone;
      if (form.payoutEmail) updates.payoutEmail = form.payoutEmail;
      if (form.businessArea) updates.businessArea = form.businessArea;
      updates.address = {
        line1: form.addressLine1 || "",
        line2: form.addressLine2 || "",
        city: form.city || "",
        state: form.state || "",
        pincode: form.pincode || ""
      };
      updates.updatedAt = serverTimestamp();

      // id proof meta
      if (uploaded.idProof) {
        updates.idProof = {
          url: uploaded.idProof.url,
          name: uploaded.idProof.name,
          size: uploaded.idProof.size,
          uploadedAt: serverTimestamp(),
          type: form.idType || "Aadhaar",
          number: form.idNumber || ""
        };
      } else {
        if (form.idNumber) {
          updates["idProof.number"] = form.idNumber;
          updates["idProof.type"] = form.idType;
        }
      }

      if (uploaded.addressProof) {
        updates.addressProof = {
          url: uploaded.addressProof.url,
          name: uploaded.addressProof.name,
          size: uploaded.addressProof.size,
          uploadedAt: serverTimestamp()
        };
      }

      if (uploaded.profilePhoto) {
        updates.profilePhotoUrl = uploaded.profilePhoto.url;
        updates.profilePhotoMeta = {
          name: uploaded.profilePhoto.name,
          size: uploaded.profilePhoto.size,
          uploadedAt: serverTimestamp()
        };
      }

      // write (create or update) using setDoc merge to ensure doc is created if missing
      const uRef = doc(db, "users", userDocId);
      await setDoc(uRef, updates, { merge: true });

      setMessage("Profile saved.");
      setError(null);
      // clear local file state
      setProfilePhotoFile(null);
      setIdProofFile(null);
      setAddressProofFile(null);
      // reload previews from server doc to show stored URLs
      try {
        const snap = await getDoc(uRef);
        if (snap.exists()) {
          const data = snap.data();
          if (data.profilePhotoUrl) setProfilePhotoPreview(data.profilePhotoUrl);
          if (data.idProof?.url) setIdProofPreview(data.idProof.url);
          if (data.addressProof?.url) setAddressProofPreview(data.addressProof.url);
        }
      } catch (_) {}
    } catch (e) {
      console.error("Failed to save profile:", e);
      setError("Save failed: " + (e?.message || e));
    } finally {
      setSaving(false);
      setUploadProgress({});
    }
  }

  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // simple inline styles — responsive using isMobile
  const containerStyle = { padding: 20, minHeight: "100vh", background: "linear-gradient(180deg,#fff 0%, #f6f9ff 100%)" };
  const cardStyle = { maxWidth: 980, margin: "0 auto", background: "#fff", padding: 18, borderRadius: 10, boxShadow: "0 8px 30px rgba(2,6,23,0.06)" };
  const formGrid = isMobile ? { display: "block" } : { display: "grid", gridTemplateColumns: "1fr 340px", gap: 18 };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Promoter Profile</h2>
          <div style={{ color: "#64748b" }}>{loading ? "Loading…" : userDocId ? `User: ${userDocId}` : ""}</div>
        </div>

        {error && <div style={{ marginTop: 12, padding: 10, background: "#fff2f2", color: "#9f1239", borderRadius: 8 }}>{error}</div>}
        {message && <div style={{ marginTop: 12, padding: 10, background: "#f0fdf4", color: "#164e2a", borderRadius: 8 }}>{message}</div>}

        <form onSubmit={handleSave} style={{ marginTop: 16, ...formGrid }}>
          <div>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Full name</label>
            <input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Promoter full name" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e6e6e6" }} />

            <div style={{ display: "flex", gap: 12, marginTop: 12, flexDirection: isMobile ? "column" : "row" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Phone</label>
                <input value={form.phone} onChange={(e) => setField("phone", e.target.value)} placeholder="+91xxxxxxxxxx" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e6e6e6" }} />
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Payout email</label>
                <input value={form.payoutEmail} onChange={(e) => setField("payoutEmail", e.target.value)} placeholder="Email to receive payouts notifications" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e6e6e6" }} />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Business area</label>
              <input value={form.businessArea} onChange={(e) => setField("businessArea", e.target.value)} placeholder="City / District / State" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e6e6e6" }} />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Address</label>
              <input value={form.addressLine1} onChange={(e) => setField("addressLine1", e.target.value)} placeholder="Address line 1" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e6e6e6", marginBottom: 8 }} />
              <input value={form.addressLine2} onChange={(e) => setField("addressLine2", e.target.value)} placeholder="Address line 2 (optional)" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e6e6e6", marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 8, flexDirection: isMobile ? "column" : "row" }}>
                <input value={form.city} onChange={(e) => setField("city", e.target.value)} placeholder="City" style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #e6e6e6" }} />
                <input value={form.state} onChange={(e) => setField("state", e.target.value)} placeholder="State" style={{ width: 160, padding: 10, borderRadius: 8, border: "1px solid #e6e6e6" }} />
                <input value={form.pincode} onChange={(e) => setField("pincode", e.target.value)} placeholder="Pincode" style={{ width: 120, padding: 10, borderRadius: 8, border: "1px solid #e6e6e6" }} />
              </div>
            </div>

            <hr style={{ margin: "18px 0" }} />

            <div>
              <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>ID Proof</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexDirection: isMobile ? "column" : "row" }}>
                <select value={form.idType} onChange={(e) => setField("idType", e.target.value)} style={{ padding: 10, borderRadius: 8 }}>
                  <option value="Aadhaar">Aadhaar</option>
                  <option value="PAN">PAN</option>
                  <option value="Passport">Passport</option>
                  <option value="Driving License">Driving License</option>
                </select>
                <input value={form.idNumber} onChange={(e) => setField("idNumber", e.target.value)} placeholder="ID number" style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #e6e6e6" }} />
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input id="idProofInput" type="file" accept="image/*,application/pdf" onChange={onIdProofChange} />
                <div style={{ fontSize: 13, color: "#64748b" }}>{idProofPreview ? `Preview ready` : "Upload scanned copy / photo of ID"}</div>
              </div>
              {idProofPreview && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 13, marginBottom: 6 }}>Preview:</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <img alt="id preview" src={idProofPreview} style={{ width: 140, height: 90, objectFit: "cover", borderRadius: 6, border: "1px solid #e6e6e6" }} />
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Address Proof</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input id="addressProofInput" type="file" accept="image/*,application/pdf" onChange={onAddressProofChange} />
                <div style={{ fontSize: 13, color: "#64748b" }}>{addressProofPreview ? `Preview ready` : "Upload address proof (Utility bill / Aadhar / Passport)"}</div>
              </div>
              {addressProofPreview && (
                <div style={{ marginTop: 10 }}>
                  <img alt="addr preview" src={addressProofPreview} style={{ width: 140, height: 90, objectFit: "cover", borderRadius: 6, border: "1px solid #e6e6e6" }} />
                </div>
              )}
            </div>

            <div style={{ marginTop: 18, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit" disabled={saving || uploading} style={{ padding: "10px 14px", background: "#0ea5e9", color: "#fff", borderRadius: 8, border: "none", cursor: "pointer" }}>
                {saving ? "Saving…" : "Save Profile"}
              </button>
              <button type="button" disabled={saving || uploading} onClick={() => {
                setForm({ ...form, name: "", phone: "", payoutEmail: "", businessArea: "", addressLine1: "", addressLine2: "", city: "", state: "", pincode: "", idType: "Aadhaar", idNumber: "" });
                setProfilePhotoFile(null); setIdProofFile(null); setAddressProofFile(null);
                setProfilePhotoPreview(null); setIdProofPreview(null); setAddressProofPreview(null);
              }} style={{ padding: "10px 14px", background: "#fff", color: "#111827", borderRadius: 8, border: "1px solid #e6e6e6" }}>
                Reset
              </button>
            </div>

            <div style={{ marginTop: 12, color: "#64748b", fontSize: 13 }}>
              <div>Accepted: images or PDFs. Recommended photo sizes &lt; 5MB.</div>
            </div>
          </div>

          {/* Right column: Profile photo + camera */}
          <div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexDirection: isMobile ? "row" : "row" }}>
              <div style={{ width: 120, height: 120, borderRadius: 10, overflow: "hidden", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #e6e6e6" }}>
                {profilePhotoPreview ? (
                  <img alt="profile" src={profilePhotoPreview} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div style={{ color: "#94a3b8", textAlign: "center", padding: 10 }}>No photo</div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <label style={{ fontWeight: 700 }}>Profile photo</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input type="file" accept="image/*" onChange={onProfileFileChange} />
                  <button type="button" onClick={() => (cameraActive ? stopCamera() : startCamera())} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e6e6e6", background: "#fff" }}>
                    {cameraActive ? "Stop camera" : "Open camera"}
                  </button>
                </div>

                {cameraError && <div style={{ color: "#9f1239" }}>{cameraError}</div>}
              </div>
            </div>

            {/* live camera preview */}
            {cameraActive && (
              <div style={{ marginTop: 12 }}>
                <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", borderRadius: 8, border: "1px solid #e6e6e6" }} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button type="button" onClick={capturePhoto} style={{ padding: "8px 10px", borderRadius: 8, background: "#059669", color: "#fff", border: "none" }}>Capture</button>
                  <button type="button" onClick={stopCamera} style={{ padding: "8px 10px", borderRadius: 8, background: "#ef4444", color: "#fff", border: "none" }}>Close</button>
                </div>
                <canvas ref={canvasRef} style={{ display: "none" }} />
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <label style={{ fontWeight: 700 }}>Manual uploads / previews</label>
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 13, color: "#64748b" }}>ID proof: {idProofPreview ? "Uploaded/Ready" : "No file"}</div>
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Address proof: {addressProofPreview ? "Uploaded/Ready" : "No file"}</div>
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13, color: "#64748b" }}>Upload progress:</div>
              <div style={{ marginTop: 8 }}>
                {Object.keys(uploadProgress).length === 0 ? (
                  <div style={{ color: "#94a3b8" }}>No uploads in progress</div>
                ) : (
                  Object.entries(uploadProgress).map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 13 }}>{k}</div>
                      <div style={{ height: 8, background: "#f1f5f9", borderRadius: 6, overflow: "hidden", marginTop: 6 }}>
                        <div style={{ width: `${v}%`, height: "100%", background: "#0ea5e9" }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13, color: "#64748b" }}>Preview file sizes:</div>
              <div style={{ marginTop: 6 }}>
                {profilePhotoFile && <div>Profile: {profilePhotoFile.name} — {friendlyBytes(profilePhotoFile.size)}</div>}
                {idProofFile && <div>ID: {idProofFile.name} — {friendlyBytes(idProofFile.size)}</div>}
                {addressProofFile && <div>Address: {addressProofFile.name} — {friendlyBytes(addressProofFile.size)}</div>}
                {!profilePhotoFile && !idProofFile && !addressProofFile && <div style={{ color: "#94a3b8" }}>No local files selected</div>}
              </div>
            </div>
          </div>
        </form>

        <div style={{ marginTop: 18, fontSize: 13, color: "#64748b" }}>
          <div>Note: Uploaded files are stored in Firebase Storage and the user document is updated with URLs for admin verification.</div>
          <div style={{ marginTop: 6 }}>Admin can verify ID & address proof and update `idProof.verified` / `addressProof.verified` field later.</div>
        </div>
      </div>
    </div>
  );
}
