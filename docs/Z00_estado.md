# Zona Z00 Base local — lista para revisión

Estado: lista para revisión del usuario. No aprobada. Sin commit; el repositorio aún no tiene HEAD.

## Alcance

Aplicación Next.js mínima, configuración local de Supabase/Docker, dos esquemas vacíos, diagnóstico y documentación de arranque. Las funciones de producto, datos de personajes y cuentas de usuario corresponden a zonas posteriores.

## Evidencia

- Node de referencia 24.22.1; Next.js 16.4.5; Supabase CLI 3.0.0; Docker 29.9.2; PostgreSQL 17.11.
- Docker y Supabase: diagnóstico correcto; API/Auth y servicios principales activos. Analítica local desactivada porque el recolector vector se reiniciaba en este entorno.
- Compilación predeterminada Turbopack, lint y typecheck: correctos. La pantalla / respondió HTTP 200 y lang=es.
- Migración base aplicada. En una base desechable separada se creó el esquema desde cero; api y private existen y anon no tiene USAGE en private. La base desechable se eliminó después. No se reseteó la base de trabajo.
- Git ignora .env.local, node_modules y .next; .env.example puede versionarse. No se guardaron claves en el repositorio.
- npm audit --omit=dev: cero vulnerabilidades informadas. Audit completo: ocho moderadas en la cadena de ESLint/typescript-eslint/minimatch; sin actualización compatible resuelta por npm a esta fecha. No se aplicó --force ni cambio principal incompatible. La observación requiere revisión del usuario y seguimiento.

## Para probar

1. Con Docker Desktop abierto, visitar http://127.0.0.1:3000: debe aparecer Riuya y Base local de desarrollo. Si el proceso ya no está activo, seguir docs/entregas/Z00.md.
2. Opcional: abrir Supabase Studio en http://127.0.0.1:54323. Es una herramienta administrativa del entorno local, no una pantalla del MVP.
3. Comprobar que no se presenta el feed ni otras funciones como si ya estuvieran implementadas.

Pendiente de revisión y conformidad del usuario antes de Z01. No se atribuye aprobación a esta entrega.
