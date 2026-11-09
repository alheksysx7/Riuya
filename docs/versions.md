# Versiones Z00

Verificado el 8 de noviembre de 2026. El repositorio todavía no tiene commit; no se atribuye un identificador inexistente.

- Node de referencia: 24.22.1 (runtime instalado junto a Codex; sistema: 20.20.2).
- npm del sistema: 10.8.2; ejecutado con Node 24 para compilación y ajustes posteriores.
- Next.js 16.4.5; React y React DOM 19.3.0.
- Supabase CLI 3.0.0; SDK 2.119.0; SSR 0.12.7; Zod 4.6.7.
- Docker Engine 29.9.2; PostgreSQL local 17.11.
- TypeScript y dependencias indirectas: versiones exactas en app/package-lock.json.
- Windows x64; imagen PostgreSQL: supabase/postgres:17.11.0.011. Consultar digests con docker image inspect; no se presume equivalencia con producción hasta fijar su entorno.

Las ocho alertas moderadas del audit afectan la cadena de herramientas ESLint/minimatch en desarrollo; audit --omit=dev no informó vulnerabilidades de producción. No se aplicó una actualización principal incompatible automáticamente.

Digest PostgreSQL verificado: public.ecr.aws/supabase/postgres@sha256:7bd84e6a1d5322c7b864b9751873a0ac50f48df3f20a776e88114eadb2948fc0.
