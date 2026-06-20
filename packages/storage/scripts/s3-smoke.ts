/**
 * S3/MinIO smoke test (acceptance #3): put -> head -> get round-trip via the storage
 * adapter using path-style addressing. Run after `npm run dev:up`:  `npm run smoke:s3`.
 *
 * Imports the adapter SOURCE directly (run via tsx) so no build step is needed. Uses the
 * SAME adapter the app uses — a green run proves the config seam works against local
 * MinIO and will work unchanged against AWS S3.
 */
import "dotenv/config";
import { Storage } from "../src/index.js"; // tsx resolves the .ts source

const KEY = `smoke/${Date.now()}-hello.txt`;
const PAYLOAD = "MarineX360 storage seam OK";

const storage = Storage.fromEnv();

await storage.put(KEY, PAYLOAD, "text/plain");
const exists = await storage.exists(KEY);
const bytes = await storage.get(KEY);
const roundTrip = new TextDecoder().decode(bytes);

if (!exists || roundTrip !== PAYLOAD) {
  console.error(`FAIL — exists=${exists} roundTrip=${JSON.stringify(roundTrip)}`);
  process.exit(1);
}

const url = await storage.presignGet(KEY, 300);
console.log("S3 smoke OK:", {
  key: KEY,
  roundTrip,
  presignedUrlSample: url.slice(0, 60) + "...",
});
