import admin from "firebase-admin";
import { readFileSync } from "fs";

let app: admin.app.App;
let db: admin.database.Database;

export function initFirebase(): void {
  if (app) return;

  const projectId = process.env.FIREBASE_PROJECT_ID || "shir-glassworks";
  const databaseURL =
    process.env.FIREBASE_DATABASE_URL ||
    `https://${projectId}-default-rtdb.firebaseio.com`;

  // Local dev: use service account key file
  const keyPath = process.env.SERVICE_ACCOUNT_KEY_PATH;
  if (keyPath) {
    const serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL,
    });
  } else {
    // Cloud Run: use Application Default Credentials
    app = admin.initializeApp({
      projectId,
      databaseURL,
    });
  }

  db = admin.database();
}

export function getDb(): admin.database.Database {
  return db;
}

// ─── MAST data references ───

export function getWorkflowsRef() {
  return db.ref("shirglassworks/workflows");
}

export function getWorkflowSectionsRef() {
  return db.ref("shirglassworks/workflows/sections");
}

export function getWorkflowSectionRef(section: string) {
  return db.ref(`shirglassworks/workflows/sections/${section}`);
}

export function getMissionsRef() {
  return db.ref("shirglassworks/admin/testingMissions");
}

export function getMissionRef(missionId: string) {
  return db.ref(`shirglassworks/admin/testingMissions/${missionId}`);
}

export function getProductsRef() {
  return db.ref("shirglassworks/public/products");
}

export function getProductRef(pid: string) {
  return db.ref(`shirglassworks/public/products/${pid}`);
}

export function getInventoryRef() {
  return db.ref("shirglassworks/admin/inventory");
}

export function getProductInventoryRef(pid: string) {
  return db.ref(`shirglassworks/admin/inventory/${pid}`);
}

export function getOrdersRef() {
  return db.ref("shirglassworks/orders");
}

export function getOrderRef(orderId: string) {
  return db.ref(`shirglassworks/orders/${orderId}`);
}

export function getApiKeysRef() {
  return db.ref("shirglassworks/admin/mcp/apiKeys");
}
