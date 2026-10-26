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
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "Servicio no configurado" }); return null; }

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
  return { body, key };
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

// Devuelve el texto de la respuesta o null si falla.
async function askClaude(key, system, prompt, maxTokens) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!r.ok) return null;
    const j = await r.json();
    const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
    return text || null;
  } catch (e) {
    return null;
  }
}

module.exports = { cut, prepare, candidateBlock, offerBlock, askClaude };
