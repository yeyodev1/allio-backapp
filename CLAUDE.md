# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

La documentación completa del proyecto (front + back, arquitectura, dominio y
convenciones) vive en el `CLAUDE.md` del directorio padre, junto a
`allio-frontapp/`. Léelo primero.

Resumen de este repo:

- Express 5 + Mongoose + TypeScript. Se despliega en Vercel como función
  serverless: `api/index.ts` reexporta `src/index.ts`, que omite `listen()`
  cuando existe `process.env.VERCEL`.
- Gestor de paquetes: **npm**.
  `npm run dev` (:8100) · `npm run build` · `npm run migrate -- --dry`
- No hay linter ni tests. `npm run build` (tsc) es la única verificación.
- Todo cuelga de `/api` en `src/routes/index.ts`.
- El alcance por usuario (empresa y sucursales visibles) se resuelve SIEMPRE en
  `src/services/access.service.ts`. No lo reimplementes en un controlador.
