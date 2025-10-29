/**
 * migratePackages.js
 * 
 * Migrate all existing packages (root or nested) to root-level "packages" collection.
 */

const admin = require("firebase-admin");

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.applicationDefault(), // ensure GOOGLE_APPLICATION_CREDENTIALS is set
});

const db = admin.firestore();

async function migratePackages() {
  let migratedCount = 0;

  try {
    // Fetch all packages using collectionGroup (includes nested packages under users)
    const packageSnap = await db.collectionGroup("packages").get();

    for (const docSnap of packageSnap.docs) {
      const data = docSnap.data();

      // Check if already migrated to avoid duplicates
      const targetDocRef = db.collection("packages").doc(docSnap.id);
      const targetDoc = await targetDocRef.get();

      if (!targetDoc.exists) {
        await targetDocRef.set(data);
        migratedCount++;
        console.log(`Migrated package: ${docSnap.id}`);
      } else {
        console.log(`Skipped (already exists): ${docSnap.id}`);
      }
    }

    console.log(`\nMigration complete. Total packages migrated: ${migratedCount}`);
  } catch (err) {
    console.error("Error migrating packages:", err);
  }
}

// Run migration
migratePackages();
