/**
 * Server-Side Vercel Proxy for Axiom 4.0 Ops Telemetry
 * Endpoint: /api/ops/telemetry
 *
 * Securely proxies telemetry requests from the dashboard to the Render Axiom26 backend
 * using the server-side AXIOM_ADMIN_SECRET environment variable.
 * Never exposes the admin secret to the client browser.
 */

export default async function handler(req, res) {
  // CORS & Cache-Control
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const backendUrl = (process.env.AXIOM_BACKEND_URL || "https://axiom26-aezg.onrender.com").replace(/\/+$/, "");
  const adminSecret = process.env.AXIOM_ADMIN_SECRET ? process.env.AXIOM_ADMIN_SECRET.trim() : "";

  // If secret is not configured, fall back to simulation mode gracefully
  if (!adminSecret) {
    return res.status(200).json({
      mode: "simulation",
      reason: "AXIOM_ADMIN_SECRET is not configured in Vercel environment variables"
    });
  }

  // Handle control updates if forwarded via POST
  if (req.method === "POST") {
    try {
      const upstreamRes = await fetch(`${backendUrl}/api/ops/controls`, {
        method: "POST",
        headers: {
          "x-admin-secret": adminSecret,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(req.body || {}),
        signal: AbortSignal.timeout(8000)
      });
      const data = await upstreamRes.json();
      return res.status(upstreamRes.status).json(data);
    } catch (err) {
      return res.status(502).json({ error: err.message || "Failed to sync controls upstream" });
    }
  }

  // GET: Fetch telemetry from upstream backend
  try {
    const endpoints = [
      `${backendUrl}/api/ops/telemetry`,
      `${backendUrl}/api/admin/ops/telemetry`
    ];

    let lastError = null;
    let upstreamData = null;

    for (const url of endpoints) {
      try {
        const upstreamRes = await fetch(url, {
          method: "GET",
          headers: {
            "x-admin-secret": adminSecret,
            "Accept": "application/json"
          },
          signal: AbortSignal.timeout(8000)
        });

        if (upstreamRes.ok) {
          upstreamData = await upstreamRes.json();
          break;
        } else if (upstreamRes.status !== 404) {
          lastError = `Upstream returned HTTP ${upstreamRes.status}: ${upstreamRes.statusText}`;
          break;
        }
      } catch (err) {
        lastError = err.message || "Network error contacting backend";
      }
    }

    if (upstreamData) {
      return res.status(200).json({
        mode: "live",
        data: upstreamData
      });
    }

    return res.status(200).json({
      mode: "simulation",
      reason: lastError || "Upstream backend unreachable"
    });
  } catch (err) {
    return res.status(200).json({
      mode: "simulation",
      reason: err.message || "Proxy exception occurred"
    });
  }
}
