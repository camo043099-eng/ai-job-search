# Hoja a la Medida

Página para adaptar una hoja de vida y una carta a una oferta de empleo.

- `index.html`: la página (funciona sola, sin servidor, con ajuste por palabras clave y descarga en PDF).
- `api/redactar.js`: redacta la carta con Claude.
- `api/evaluar.js`: evalúa si la oferta encaja, con el marco de `.claude/skills/job-application-assistant/04-job-evaluation.md`.

## Publicar en Vercel

1. Importa este repositorio en Vercel y fija **Root Directory** en `web`.
2. Agrega una clave de IA como variable de entorno:
   - Claude: `ANTHROPIC_API_KEY` (opcional: `ANTHROPIC_MODEL`).
   - Gemini: `GEMINI_API_KEY` y `GEMINI_MODEL` con el nombre del modelo que elijas en Google AI Studio.
   - Si agregas las dos, se usa Claude; para forzar otra, define `AI_PROVIDER` como `anthropic` o `gemini`.
3. Fija un límite de gasto mensual en el proveedor que uses.

Sin la función, el botón "Redactar con IA" muestra un error y el resto de la página sigue funcionando.
