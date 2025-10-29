import admin from "firebase-admin";

const serviceAccount = "C:/Users/Admin/Downloads/isp-education-864ff-firebase-adminsdk-fbsvc-caea42eb5d.json";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function createAdmin() {
  try {
    const user = await admin.auth().createUser({
      uid: "Q3Z7mgam8IOMQWQqAdwWEQmpqNn2", // Must match your rules
      email: "isp.edu2025@gmail.com",
      password: "Inchara@2014", // Temporary password
      displayName: "Admin"
    });

    console.log("Admin user created:", user.uid);
  } catch (err) {
    console.error("Error creating admin user:", err);
  }
}

createAdmin();
