import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase/firebaseConfig";
import { collection, getDocs, getFirestore } from "firebase/firestore";

const FirestoreDebug = () => {
  const [collections, setCollections] = useState([]);
  const [packagesData, setPackagesData] = useState([]);
  const [userPackagesData, setUserPackagesData] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1️⃣ List all top-level collections
        const dbInstance = getFirestore();
        const topCollections = await dbInstance.listCollections();
        setCollections(topCollections.map(col => col.id));

        // 2️⃣ Fetch top-level "packages"
        const packageSnap = await getDocs(collection(db, "packages"));
        setPackagesData(packageSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        // 3️⃣ Fetch packages for current logged-in user (if any)
        const user = auth.currentUser;
        if (user) {
          const userPackageSnap = await getDocs(collection(db, "users", user.uid, "packages"));
          setUserPackagesData(userPackageSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        }
      } catch (err) {
        console.error("Firestore debug error:", err);
      }
    };

    fetchData();
  }, []);

  return (
    <div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>
      <h2>Firestore Debug Info</h2>

      <h3>Top-level Collections:</h3>
      <pre>{JSON.stringify(collections, null, 2)}</pre>

      <h3>Top-level Packages:</h3>
      <pre>{JSON.stringify(packagesData, null, 2)}</pre>

      <h3>Packages in Current User:</h3>
      <pre>{JSON.stringify(userPackagesData, null, 2)}</pre>
    </div>
  );
};

export default FirestoreDebug;
