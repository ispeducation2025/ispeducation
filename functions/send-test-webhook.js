// functions/send-test-webhook.js
// Simulate a Razorpay webhook POST with correct HMAC-SHA256 signature.
// Usage examples:
//   node send-test-webhook.js
//   WEBHOOK_URL="https://..." WEBHOOK_SECRET="..." EVENT_TYPE="payment.captured" node send-test-webhook.js
//   DRY_RUN=true node send-test-webhook.js   (prints body + signature, does not send)

const crypto = require("crypto");
const https = require("https");
const { URL } = require("url");

const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://us-central1-isp-education-864ff.cloudfunctions.net/razorpayWebhook";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "etCOrzBfp6n2yOvLokecrL1r"; // prefer env var
const EVENT_TYPE = process.env.EVENT_TYPE || "refund.created"; // e.g. refund.created, payment.captured
const DRY_RUN = !!(process.env.DRY_RUN && process.env.DRY_RUN !== "false");

// Helper to generate random id
function randId(prefix = "test") {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

// Build payload shapes for common events (extend as needed)
function buildPayload(eventType) {
  const now = Math.floor(Date.now() / 1000);
  if (eventType.startsWith("refund")) {
    return {
      entity: "event",
      account_id: "acc_test_XXXXXXXX",
      event: eventType,
      contains: ["refund"],
      payload: {
        refund: {
          entity: {
            id: randId("rfnd"),
            amount: 9 * 100, // amount in paise; your webhook code expects this possibility
            status: "processed", // or "failed"
            payment_id: randId("pay"),
            created_at: now
          }
        }
      },
      created_at: now
    };
  } else if (eventType.startsWith("payment")) {
    return {
      entity: "event",
      account_id: "acc_test_XXXXXXXX",
      event: eventType,
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: randId("pay"),
            amount: 9 * 100, // paise
            status: eventType === "payment.captured" ? "captured" : (eventType === "payment.authorized" ? "authorized" : "failed"),
            short_url: null,
            created_at: now
          }
        }
      },
      created_at: now
    };
  } else {
    // Generic event fallback
    return {
      entity: "event",
      account_id: "acc_test_XXXXXXXX",
      event: eventType,
      contains: [],
      payload: {},
      created_at: now
    };
  }
}

(async function main() {
  const payload = buildPayload(EVENT_TYPE);
  const body = JSON.stringify(payload);

  // Compute signature exactly over the raw body string
  const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");

  console.log("=== Test webhook (preview) ===");
  console.log("WEBHOOK_URL:", WEBHOOK_URL);
  console.log("EVENT_TYPE:", EVENT_TYPE);
  console.log("DRY_RUN:", DRY_RUN);
  console.log("WEBHOOK_SECRET: (hidden)");
  console.log("Payload:", body);
  console.log("Signature:", signature);
  console.log("=============================");

  if (DRY_RUN) {
    console.log("DRY_RUN enabled — not sending to server.");
    return;
  }

  // Parse URL
  const parsed = new URL(WEBHOOK_URL);

  const opts = {
    method: "POST",
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    port: parsed.port || 443,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "X-Razorpay-Signature": signature,
      "User-Agent": "isp-test-webhook/1.0"
    }
  };

  // If your function has a custom host header requirement (rare), set opts.headers.Host = parsed.host;

  const req = https.request(opts, (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => {
      console.log("Status:", res.statusCode);
      console.log("Response headers:", res.headers);
      console.log("Response body:", data || "(empty)");
      console.log("Done. Check your function logs and Firestore.");
    });
  });

  req.on("error", (err) => {
    console.error("Request error:", err);
  });

  req.write(body);
  req.end();
})();
