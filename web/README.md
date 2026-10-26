# Hoja a la Medida

Página para adaptar una hoja de vida y una carta a una oferta de empleo.

- `index.html`: la página (funciona sola, sin servidor, con ajuste por palabras clave y descarga en PDF).
- `api/redactar.js`: redacta la carta con Claude.
- `api/evaluar.js`: evalúa si la oferta encaja, con el marco de `.claude/skills/job-application-assistant/04-job-evaluation.md`.

## Publicar en Vercel

1. Importa este repositorio en Vercel y fija **Root Directory** en `web`.
2. Agrega la variable de entorno `ANTHROPIC_API_KEY` (opcional: `ANTHROPIC_MODEL`).
3. En la consola de Anthropic fija un límite de gasto mensual para esa clave.

Sin la función, el botón "Redactar con IA" muestra un error y el resto de la página sigue funcionando.
