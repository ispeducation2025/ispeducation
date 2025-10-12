// restoreAdmin.js
const admin = require("firebase-admin");
const fs = require("fs");

// Initialize Firebase Admin SDK
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function restoreAdmin() {
  try {
    const adminDocRef = db.collection("users").doc("Q3Z7mgam8IOMQWQqAdwWEQmpqNn2");

    await adminDocRef.set({
      fullName: "Praveen S",
      name: "Admin",
      email: "isp.edu2025@gmail.com",
      role: "Admin",
      classGrade: "N/A",
      syllabus: "N/A",
    });

    console.log("✅ Admin document restored successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error restoring admin:", error);
    process.exit(1);
  }
}

restoreAdmin();
