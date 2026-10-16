// Handles estimate-form submissions; everything else is served from /public.
// Email delivery uses Cloudflare Email Routing (send_email binding "LEADS").
const TO = "jasonwstover84@gmail.com";
const FROM = "website@stoversremodeling.com";

const clean = (v, max = 2000) =>
  String(v ?? "").replace(/[\r\n]+/g, " ").replace(/[<>]/g, "").trim().slice(0, max);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function handleEstimate(request, env) {
  let d;
  try { d = await request.json(); } catch { return json(400, { ok: false, error: "bad_request" }); }

  // Spam checks: honeypot field filled, or submitted faster than a person could type.
  if (d.company || Number(d.elapsed) < 2500) return json(200, { ok: true });

  const lead = {
    name: clean(d.name, 120),
    phone: clean(d.phone, 40),
    email: clean(d.email, 160),
    zip: clean(d.zip, 10),
    type: clean(d.type, 80),
    insurance: clean(d.insurance, 20),
    message: String(d.message ?? "").replace(/[<>]/g, "").trim().slice(0, 3000),
  };
  if (!lead.name || lead.phone.replace(/\D/g, "").length < 10 || !/^\d{5}/.test(lead.zip) || !lead.type) {
    return json(422, { ok: false, error: "missing_fields" });
  }
  if (!env.LEADS) return json(503, { ok: false, error: "email_not_configured" });

  const { EmailMessage } = await import("cloudflare:email");
  const subject = `New estimate request: ${lead.type} (${lead.zip})`;
  const text = [
    `New estimate request from stoversremodeling.com`,
    ``,
    `Name: ${lead.name}`,
    `Phone: ${lead.phone}`,
    `Email: ${lead.email || "-"}`,
    `ZIP: ${lead.zip}`,
    `Needs: ${lead.type}`,
    `Insurance claim: ${lead.insurance || "-"}`,
    ``,
    `Details:`,
    lead.message || "-",
  ].join("\r\n");
  const raw = [
    `From: Stover's Website <${FROM}>`,
    `To: ${TO}`,
    lead.email ? `Reply-To: ${lead.email}` : null,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@stoversremodeling.com>`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    text,
  ].filter((l) => l !== null).join("\r\n");

  try {
    await env.LEADS.send(new EmailMessage(FROM, TO, raw));
    return json(200, { ok: true });
  } catch (e) {
    return json(502, { ok: false, error: "send_failed" });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/estimate") {
      if (request.method !== "POST") return json(405, { ok: false });
      return handleEstimate(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
