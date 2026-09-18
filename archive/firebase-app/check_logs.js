// Quick diagnostics for Firestore logs ordering and jumps.
// Uses SERVICE_ACCOUNT_PATH (fallback: ./serviceAccountKey.json).
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const loadServiceAccount = () => {
  const candidate = process.env.SERVICE_ACCOUNT_PATH || path.join(__dirname, "serviceAccountKey.json");
  if (!fs.existsSync(candidate)) {
    console.error("Service account key not found. Set SERVICE_ACCOUNT_PATH to the key JSON path.");
    process.exit(1);
  }
  const json = fs.readFileSync(candidate, "utf8");
  return JSON.parse(json);
};

const serviceAccount = loadServiceAccount();

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // km
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const formatDateTime = (date) => {
  return date.toISOString().replace("T", " ").slice(0, 19);
};

async function main() {
  console.log("Fetching logs ordered by timestamp...");
  const snapshot = await db.collection("logs").orderBy("timestamp").get();
  if (snapshot.empty) {
    console.log("No logs found.");
    return;
  }
  const logs = [];
  snapshot.forEach(doc => {
    const data = doc.data() || {};
    const ts = toDate(data.timestamp);
    const lat = toNumber(data.lat);
    const lng = toNumber(data.lng);
    logs.push({
      id: doc.id,
      ts,
      tsRaw: data.timestamp,
      lat,
      lng,
      memo: data.memo || "",
      locationName: data.locationName || "",
      category: data.amount_category || ""
    });
  });

  const valid = logs.filter(l => l.ts && l.lat !== null && l.lng !== null);
  console.log(`Total logs: ${logs.length}, valid coords: ${valid.length}`);

  // Detect duplicate timestamps (same ms) with different coords.
  const tsMap = new Map();
  valid.forEach(log => {
    const key = log.ts.getTime();
    if (!tsMap.has(key)) tsMap.set(key, []);
    tsMap.get(key).push(log);
  });
  const duplicateTs = [...tsMap.values()].filter(arr => arr.length > 1);
  console.log(`Duplicate timestamps (same ms): ${duplicateTs.length}`);
  duplicateTs.slice(0, 20).forEach((group, idx) => {
    console.log(`  [${idx + 1}] ${formatDateTime(group[0].ts)} count=${group.length}`);
    group.forEach(g => {
      console.log(`     id=${g.id} lat=${g.lat}, lng=${g.lng}, cat=${g.category}, memo=${g.memo || "(none)"}`);
    });
  });
  if (duplicateTs.length > 20) {
    console.log(`  ...and ${duplicateTs.length - 20} more groups`);
  }

  // Compute jumps between consecutive points.
  const jumps = [];
  for (let i = 1; i < valid.length; i++) {
    const prev = valid[i - 1];
    const curr = valid[i];
    const distKm = haversineKm(prev.lat, prev.lng, curr.lat, curr.lng);
    jumps.push({
      distKm,
      prev,
      curr
    });
  }

  jumps.sort((a, b) => b.distKm - a.distKm);
  console.log("Top 20 largest jumps (km) in timestamp order sequence:");
  jumps.slice(0, 20).forEach((jump, idx) => {
    console.log(`  [${idx + 1}] ${jump.distKm.toFixed(2)} km`);
    console.log(`       from ${formatDateTime(jump.prev.ts)} id=${jump.prev.id} (${jump.prev.lat},${jump.prev.lng}) cat=${jump.prev.category}`);
    console.log(`       to   ${formatDateTime(jump.curr.ts)} id=${jump.curr.id} (${jump.curr.lat},${jump.curr.lng}) cat=${jump.curr.category}`);
  });
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
