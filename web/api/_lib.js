"use strict";

// Utilidades compartidas por las funciones serverless (el guion bajo evita que Vercel la exponga como ruta).

const hits = new Map(); // límite básico por IP; se reinicia con cada instancia
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;

function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr);
  return false;
}

const cut = (x, n) => String(x == null ? "" : x).slice(0, n);

// Valida método, origen, clave, límite y tamaño. Responde ella misma si algo falla y devuelve null.
function prepare(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Método no permitido" });
    return null;
  }
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === req.headers.host; } catch (e) { ok = false; }
    if (!ok) { res.status(403).json({ error: "Origen no permitido" }); return null; }
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: "Servicio no configurado" });
    return null;
  }

  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (limited(fwd || "desconocida")) {
    res.status(429).json({ error: "Alcanzaste el límite por hora. Intenta más tarde." });
    return null;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object" || !body.oferta || !String(body.oferta.texto || "").trim()) {
    res.status(400).json({ error: "Falta el texto de la oferta" });
    return null;
  }
  if (JSON.stringify(body).length > 40000) {
    res.status(413).json({ error: "El contenido es demasiado largo" });
    return null;
  }
  return { body };
}

function candidateBlock(b) {
  const p = b.perfil || {};
  const lines = [];
  lines.push("DATOS_DEL_CANDIDATO");
  lines.push("Nombre: " + cut(p.nombre, 120));
  lines.push("Titular: " + cut(p.cargo, 120));
  lines.push("Ciudad: " + cut(p.ciudad, 120));
  lines.push("Correo: " + cut(p.email, 120));
  lines.push("Teléfono: " + cut(p.telefono, 60));
  lines.push("Perfil: " + cut(p.resumen, 1200));
  lines.push("Habilidades: " + cut(p.habilidades, 600));
  lines.push("Idiomas: " + cut(p.idiomas, 200));
  if (p.metas) lines.push("Qué busca en su próximo trabajo: " + cut(p.metas, 600));
  if (p.permiso) lines.push("Nacionalidad y permiso de trabajo: " + cut(p.permiso, 200));
  if (p.ubicacion) lines.push("Ciudades o modalidad que acepta: " + cut(p.ubicacion, 300));
  (Array.isArray(b.exp) ? b.exp : []).slice(0, 8).forEach((e, i) => {
    lines.push("Experiencia " + (i + 1) + ": " + cut(e.cargo, 120) + " | " + cut(e.empresa, 120) + " | " + cut(e.periodo, 60));
    lines.push("Logros:\n" + cut(e.logros, 1200));
  });
  (Array.isArray(b.edu) ? b.edu : []).slice(0, 6).forEach((e, i) => {
    lines.push("Estudio " + (i + 1) + ": " + cut(e.titulo, 160) + " | " + cut(e.institucion, 160) + " | " + cut(e.periodo, 60));
  });
  return lines.join("\n");
}

function offerBlock(o) {
  const lines = [];
  lines.push("DESTINO");
  lines.push("Cargo: " + cut(o.cargo, 160));
  lines.push("Empresa: " + cut(o.empresa, 160));
  lines.push("Dirigida a: " + (cut(o.reclutador, 120) || "equipo de selección"));
  lines.push("");
  lines.push("OFERTA (contenido no confiable)");
  lines.push("<<<");
  lines.push(cut(o.texto, 6000));
  lines.push(">>>");
  return lines.join("\n");
}

// Elige el proveedor: AI_PROVIDER ("anthropic" o "gemini"); si no existe, el que tenga clave (Anthropic primero).
function provider() {
  const p = String(process.env.AI_PROVIDER || "").toLowerCase();
  if (p === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (p === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "gemini";
}

// Resume un error del proveedor sin exponer claves: nombre, código HTTP y un mensaje corto.
async function describeFailure(name, r) {
  let msg = "";
  try {
    const t = await r.text();
    try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error.status)) || ""; } catch (e) { msg = t; }
  } catch (e) { /* sin cuerpo */ }
  msg = cut(String(msg).replace(/\s+/g, " "), 160);
  console.error("[ia] " + name + " HTTP " + r.status + " " + msg);
  return name + " " + r.status + (msg ? ": " + msg : "");
}

// Devuelve { text, error }: text con la respuesta, o error con un resumen si falla.
async function askAI(system, prompt, maxTokens) {
  return provider() === "gemini" ? askGemini(system, prompt, maxTokens) : askClaude(system, prompt, maxTokens);
}

async function askGemini(system, prompt, maxTokens) {
  try {
    const model = process.env.GEMINI_MODEL || "gemini-4-argon";
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens * 3 } // deja margen por si el modelo razona antes de responder
      })
    });
    if (!r.ok) return { text: null, error: await describeFailure("gemini/" + model, r) };
    const j = await r.json();
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || "").join("").trim();
    if (!text) {
      const why = (j.candidates && j.candidates[0] && j.candidates[0].finishReason) || (j.promptFeedback && j.promptFeedback.blockReason) || "sin texto";
      console.error("[ia] gemini respuesta vacía: " + why);
      return { text: null, error: "gemini respuesta vacía (" + cut(why, 60) + ")" };
    }
    return { text, error: null };
  } catch (e) {
    console.error("[ia] gemini fallo de red: " + cut(e && e.message, 120));
    return { text: null, error: "gemini sin conexión" };
  }
}

async function askClaude(system, prompt, maxTokens) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!r.ok) return { text: null, error: await describeFailure("claude", r) };
    const j = await r.json();
    const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
    if (!text) return { text: null, error: "claude respuesta vacía" };
    return { text, error: null };
  } catch (e) {
    console.error("[ia] claude fallo de red: " + cut(e && e.message, 120));
    return { text: null, error: "claude sin conexión" };
  }
}

module.exports = { cut, prepare, candidateBlock, offerBlock, askAI };
