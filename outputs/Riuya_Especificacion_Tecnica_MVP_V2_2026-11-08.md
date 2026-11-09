# Riuya Especificación técnica del MVP

**Versión 2.2 · 8 de noviembre de 2026**
**Desarrollo local primero y despliegue posterior en servidor**

Este documento define cómo construir y verificar el MVP de Riuya con datos y servicios locales. Consolida la base funcional 001–068, las decisiones técnicas 070–075 recogidas en el PDF técnico V1.0 y la recuperación documental R1. Añade decisiones de ingeniería para resolver contratos incompletos y reducir el trabajo de migración a un servidor.

La arquitectura será una PWA con Next.js y TypeScript, Supabase local sobre Docker y un proceso de trabajos de fondo del mismo proyecto. El navegador muestra borradores; el servidor y PostgreSQL deciden permisos, publicación, confirmaciones y resultados. El paso posterior a servidor conserva el código de dominio y las migraciones; cambia configuración, infraestructura e integraciones.

**Naturaleza de esta entrega.** Es una especificación para implementar, no evidencia de software ya construido o probado. Las mejoras identificadas como T01–T15 son definiciones técnicas nuevas de esta versión. No se presentan como decisiones históricas del usuario. Las validaciones editoriales y jurídicas indicadas siguen siendo condiciones de salida a producción.

## 1 Alcance y autoridad de las fuentes

### 1.1 Fuentes internas

| Fuente | Qué gobierna |
|---|---|
| Registro de decisiones 001–068 y especificación funcional VFinal | Comportamiento de lectores, navegación, participación, umbrales y privacidad |
| Operación editorial VFinal y Biblia de Personajes Canon V3.1 | Verificación, revisión humana y continuidad de las ocho voces |
| Documento Técnico Implementación MVP V1.0 | Decisiones 070–075: Next.js, TypeScript, Supabase, local primero, aplicación única, roles y auditoría básica |
| Sistema Visual R1, Tarjetas Compartibles R1 y referencias recuperadas | Dirección de diseño, composición y notas sobre maquetas antiguas |
| Catálogo de Aspectos V2.1 y material recuperado | Vocabulario propuesto y ejemplos; requiere validación editorial |

La documentación organizada se recibió en el portal local R1. Los nombres anteriores permiten localizar las fuentes aunque se reorganice el portal. No se reproducen ni revalidan noticias de ejemplo del histórico como hechos actuales.

La decisión 069 no se da por aprobada. Las decisiones 070–075 constan como incorporadas en el PDF técnico, aunque el registro funcional termina en 068. Esta versión incorpora ambas líneas sin renumerar el registro histórico.

### 1.2 Reglas de producto que no cambian

- Exactamente ocho opiniones por noticia y en este orden: Rami, Beatriz, Leo, Dmitri, Naoki, Salma, Tove y Kavya.
- Noticias con fuentes verificables, resumen factual de 40–65 palabras, ampliada de 150–250 y opiniones de 40–80. Revisión humana antes de publicar.
- Navegación Noticias, Mi actividad y Perfil. Feed por fecha de publicación descendente, seis categorías iniciales, carga 10+10 y sin buscador.
- Varias voces o «Ninguna me representa», mutuamente excluyentes. «Omitir» no es una respuesta ni cuenta en estadísticas.
- Autenticación para confirmar, omitir de forma persistente, consultar resultados y usar actividad/perfil. Visitantes leen y preparan selecciones locales.
- Una confirmación por usuario y noticia, irreversible. Sin cierre universal a 24 horas ni fotografía de jornada a 12 horas.
- Resultados preliminares sin porcentajes con N menor que 10. Desde N=10 se permiten porcentajes. Una omitida queda bloqueada al acceder por primera vez a resultados completos.
- Sin fotografías de hechos noticiosos, confirmaciones offline, perfiles públicos ni publicación automática de IA.

### 1.3 Qué significa local

La aplicación y su backend corren en el equipo de desarrollo; no se requiere un proyecto cloud de Supabase ni contratar alojamiento. La instalación de paquetes, descarga de contenedores/modelos y adquisición de noticias requieren internet. Google/Apple y el transporte push tienen dependencias externas. «Local» no significa un archivo HTML sin backend ni convierte la app en una aplicación offline.

La biblioteca documental HTML es una herramienta de consulta separada del producto Riuya. Su búsqueda de documentación no autoriza añadir un buscador al feed del MVP.

## 2 Decisiones técnicas aplicadas en esta versión

| ID | Definición | Mejora respecto a la V1 |
|---|---|---|
| T01 | Monolito modular Next.js, API de casos de uso y worker del mismo repositorio | Mantiene una aplicación sin ejecutar tareas largas dentro de peticiones web |
| T02 | PostgreSQL/Supabase con migraciones SQL como fuente de verdad; sin ORM adicional inicial | Evita duplicar esquema y lógica transaccional/RLS |
| T03 | Una fila de estado por usuario/noticia compartida por confirmar, omitir y acceder a resultados | Resuelve carreras entre ver porcentajes y confirmar desde otra sesión |
| T04 | Acceso a resultados mediante POST explícito, sin precarga y con contrato de respuesta único | Evita que un GET, un enlace prefetched o un proceso separado cierre participación accidentalmente |
| T05 | Lecturas personales sin caché compartida y contenido retirado comprobado en origen | Reduce filtraciones entre usuarios y reaparición de noticias retiradas |
| T06 | Cola de trabajos en PostgreSQL y worker Node.js, con arrendamiento y reintentos | No necesita Redis para el volumen inicial; conserva tareas al reiniciar |
| T07 | Contrato matemático versionado para voces, coincidencia, aspectos y tendencias | Sustituye fórmulas ambiguas y define explícitamente «Ninguna» |
| T08 | Generación editorial mediante adaptador; fixtures para pruebas y Ollama como opción local | Permite desarrollar sin depender de un proveedor cloud de IA |
| T09 | Contenido publicado validado y versionado; ocho opiniones y referencias congeladas | Impide cambiar el significado de una respuesta ya confirmada |
| T10 | Baja en dos pasos; purga reanudable; agregados no se declaran anónimos automáticamente | Separa comportamiento implementable de obligaciones de conservación por resolver |
| T11 | Notificaciones con reloj IANA, deduplicación y bandeja de salida | Evita envíos dobles y errores de zona horaria al pasar a servidor |
| T12 | Arte compartible generado en cliente a partir de un snapshot autorizado | Evita almacenar públicamente resultados personales y simplifica el entorno local |
| T13 | Misma aplicación en modo desarrollo y en build de producción local | Detecta antes los problemas que aparecerían al alojarla |
| T14 | Configuración externa, adaptadores y artefacto Node.js portable | Prepara despliegue propio o servicios administrados sin elegir proveedor ahora |
| T15 | Matriz verificable de requisitos, migraciones y puertas de salida | Distingue «app local funcional» de «MVP listo para usuarios reales» |

Estas decisiones son la línea técnica recomendada para construir. Un cambio posterior se registra como ADR con motivo, impacto, migración y pruebas; no se modifica una regla funcional de forma implícita.

## 3 Tecnologías y política de versiones

### 3.1 Selección

| Componente | Selección | Uso |
|---|---|---|
| Runtime | Node.js 24 LTS, parche de seguridad verificado y fijado | Web, scripts y worker |
| Aplicación | Next.js 16 App Router y React compatible con sus peer dependencies | Páginas, SSR, endpoints y panel editorial |
| Lenguaje | TypeScript con `strict: true` | Contratos compartidos y dominio |
| Estilos | Tailwind CSS 4 y variables CSS de diseño | Claro/oscuro, componentes y accesibilidad |
| Validación | Zod 4 | Entradas HTTP, configuración, importaciones y salida de IA |
| Backend local | Supabase CLI estable con Docker | PostgreSQL, Auth, Storage y correo de desarrollo |
| Acceso a datos | `@supabase/supabase-js` y `@supabase/ssr` | Clientes por contexto y llamadas RPC |
| SQL | Migraciones SQL y funciones PostgreSQL | Invariantes, autorización, bloqueos y agregación |
| Tareas | Worker TypeScript del mismo proyecto y tabla `jobs` | Ingesta, IA, notificaciones y purgas |
| Pruebas | Vitest, Playwright y pgTAP | Dominio, recorridos, funciones SQL y permisos |
| Editor de contenido | Formularios y bloques de texto estructurado | Evita HTML arbitrario y dependencias de edición complejas |
| IA local opcional | Ollama con modelo configurado y salida JSON validada | Borradores editoriales supervisados |
| Paquetes | npm y un único `package-lock.json` de la aplicación | Instalaciones reproducibles con `npm ci` |

Next.js 16, SSR de Supabase y desarrollo local mediante CLI/Docker están documentados oficialmente. La combinación elegida es una decisión de ingeniería de Riuya, no una recomendación atribuida a esos proveedores. [S01](https://nextjs.org/docs/app/getting-started/installation) · [S02](https://supabase.com/docs/guides/local-development/cli/getting-started) · [S03](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)

No se añaden inicialmente NestJS, GraphQL, microservicios, Kubernetes, Elasticsearch, Redis, una segunda capa de autenticación ni un ORM que compita con las migraciones. Los agregados iniciales se calculan desde PostgreSQL. Añadir infraestructura solo después de medir un límite concreto.

### 3.2 Versiones reproducibles

La documentación de Next.js consultada identifica 16.4.5 y Node publica la línea 24 LTS. Son referencias de verificación del 8 de noviembre, no una obligación de conservar un parche vulnerable. Al crear la aplicación, verificar compatibilidad y avisos, elegir el parche corregido de la línea y registrar la resolución exacta. [S01](https://nextjs.org/docs/app/getting-started/installation) · [S04](https://nodejs.org/en/about/previous-releases)

Registrar en `docs/versions.md`: versión exacta de Node/npm, Next/React, paquetes Supabase, CLI, PostgreSQL efectivo, imágenes Docker y sus digest, SO, commit y fecha. `.node-version`, `engines` y lockfile deben coincidir. Fijar la CLI como dependencia de desarrollo; no ejecutar un `npx` sin versión que descargue otra CLI de forma silenciosa. Al instalar imágenes/modelos por primera vez se necesita conexión; las siguientes ejecuciones reutilizan lo descargado.

La versión mayor de PostgreSQL será la soportada por la combinación fijada de CLI e imágenes Supabase; debe coincidir con staging y producción. No imponer una versión nueva de PostgreSQL por fuera de esa compatibilidad.

## 4 Arquitectura y límites de confianza

```text
Navegador PWA
  ├─ interfaz, borrador de sesión, lectura y arte compartible
  ├─ SDK Auth para los flujos que lo requieren
  └─ HTTPS/HTTP local → Next.js
                         ├─ sesión verificada y autorización
                         ├─ validación Zod y casos de uso
                         └─ JWT del usuario → RPC Supabase → PostgreSQL

Worker del mismo proyecto
  ├─ reclamar trabajo → ejecutar → registrar resultado
  ├─ fuentes RSS/Atom/API aprobadas
  ├─ adaptador de IA local
  └─ transportes de correo/push y tareas de baja
```

El cliente nunca es autoridad para elegibilidad, rol, contadores, fecha de confirmación o permisos de resultados. La autorización se aplica en los endpoints y otra vez en la base de datos. Las funciones de dominio TypeScript no importan React, Next.js ni SDK de proveedor; las transiciones críticas se comprueban además en SQL.

Las lecturas SSR llaman servicios de aplicación directamente; no realizan un HTTP interno a su propio endpoint. Los Route Handlers y cualquier Server Action permitida llaman esos mismos servicios. No mantener dos implementaciones de confirmar, omitir o publicar.

Los trabajos de ingesta/IA no se ejecutan dentro de un Server Component ni se dejan como promesa sin esperar después de responder HTTP. El endpoint crea un trabajo persistente y devuelve `202 Accepted`.

## 5 Organización del repositorio

```text
Riuya/
  app/                         # aplicación desplegable única
    src/app/                   # App Router
      noticias/[id]/
      actividad/
      perfil/
      auth/callback/
      admin/
      api/v1/
    src/components/ui/
    src/features/              # news, participation, results, editorial, account
    src/domain/                # reglas puras, contratos y tipos de dominio
    src/application/           # casos de uso
    src/infrastructure/        # Supabase, feeds, IA, storage y transportes
    src/lib/auth/
    src/lib/supabase/
    src/proxy.ts               # sesión SSR; no reemplaza autorización
    worker/
    scripts/                   # bootstrap, seeds, backup y doctor local
    supabase/config.toml
    supabase/migrations/
    supabase/tests/
    supabase/seed.sql
    tests/unit/
    tests/integration/
    tests/e2e/
    public/brand/
    public/characters/
    package.json
    package-lock.json
    .env.example
    Dockerfile
  docs/                        # especificación, ADR, contratos y operaciones
  outputs/                     # entregables documentales; no artefactos de la app
```

Usar `app/` evita inicializar un generador sobre el directorio actual, que ya contiene Git y documentación. No crear un segundo repositorio Git anidado. Los recursos canónicos se importan mediante un manifiesto con ruta, hash, licencia/estado, versión y personaje; no se copian PNG de forma dispersa por componentes.

## 6 Entorno local y configuración

### 6.1 Servicios

| Servicio | Dirección de referencia | Exposición |
|---|---|---|
| Web Next.js | `http://localhost:3000` | Solo loopback por defecto |
| Gateway Supabase | `http://127.0.0.1:54321` | Desarrollo local |
| PostgreSQL | Puerto local impreso por la CLI, normalmente 54322 | Sin acceso desde navegador |
| Studio | `http://127.0.0.1:54323` | Solo desarrollador |
| Correo de desarrollo | Dirección Mailpit impresa por la CLI, normalmente 54324 | No envía correo real |
| Ollama opcional | `http://127.0.0.1:11434` | Solo worker; sin acceso público |

Los valores reales se obtienen con la CLI y se guardan en el entorno. Los puertos de la tabla no sustituyen su salida. La CLI inicia servicios locales mediante Docker y proporciona herramientas de desarrollo. [S02](https://supabase.com/docs/guides/local-development/cli/getting-started)

Como presupuesto de ingeniería, partir de 16 GB de RAM para web, contenedores y pruebas; 32 GB resulta preferible si se ejecuta además un modelo local. Son objetivos orientativos de Riuya, no requisitos oficiales garantizados. Ejecutar una prueba de consumo antes de seleccionar el modelo. En Windows usar Docker Desktop con backend WSL2; elegir un solo contexto de archivos/herramientas para evitar problemas de rutas y rendimiento.

### 6.2 Variables

```dotenv
APP_ENV=local
APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clave-publicable-local>
SUPABASE_SERVER_URL=http://127.0.0.1:54321
SUPABASE_SECRET_KEY=<solo-operaciones-administrativas-del-servidor>
DATABASE_URL=<solo-migraciones-o-worker-segun-rol>
RESULTS_FORMULA_VERSION=2
ASPECTS_ENABLED=false
LLM_BACKEND=fixture
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
NOTIFICATION_TRANSPORT=local
WORKER_CONCURRENCY=2
INGESTION_ENABLED=false
```

Son nombres del proyecto. Si la combinación de Auth/CLI seleccionada aún entrega claves `anon`/`service_role`, el adaptador mapea esos valores sin mezclarlos con otra configuración. La clave publicable no permite saltar RLS; una clave secreta nunca lleva el prefijo `NEXT_PUBLIC_`.

`SUPABASE_SERVER_URL` permite que el servidor use la red interna al contenerizar sin cambiar la URL que usa el navegador. Variables `NEXT_PUBLIC_` se incorporan al bundle: reconstruir la imagen por entorno si cambian. No confiar en cambiar únicamente una variable de ejecución del contenedor para reemplazarlas.

Versionar `.env.example` sin secretos. Ignorar `.env*` salvo ejemplos, dumps, volúmenes, capturas de pruebas con sesiones y archivos de credenciales. Validar todas las variables al arrancar y fallar con un mensaje que no imprima su valor. [S05](https://supabase.com/docs/guides/local-development/managing-config)

En `supabase/config.toml` exponer el esquema de funciones `api` y no `private`; fijar el origen Auth del proyecto y la allowlist de retorno a `http://localhost:3000/auth/callback`. El callback del proveedor OAuth hacia Auth es distinto del retorno de Auth a la aplicación: usar la URL que indique la configuración efectiva de Supabase para Google/Apple y no intercambiar ambas. Las restricciones de dominio/HTTPS de cada proveedor se validan con credenciales de prueba; el simulador local no demuestra que un proveedor real permita ese callback.

### 6.3 Arranque reproducible

El siguiente es el procedimiento que se implementará; esta entrega no ejecuta estos comandos ni instala herramientas:

```powershell
# En un directorio app aún inexistente; conservar el repositorio Git actual.
# Sustituir 16.4.5 si existe un parche de seguridad más reciente verificado.
npx create-next-app@16.4.5 app --typescript --eslint --tailwind --app --src-dir --use-npm
Set-Location app

# Instalar SDK, SSR, Zod y herramientas de pruebas con versiones verificadas.
# Registrar los números exactos en package.json y package-lock.json.
# Añadir la CLI Supabase como dependencia de desarrollo fijada.

npx --no-install supabase init
npx --no-install supabase start
npx --no-install supabase status

# Crear .env.local con valores de la instalación local.
# Tras implementar migraciones y scripts de esta especificación:
npm run db:migrate:local
npm run seed:local
npm run dev

# En una segunda terminal, desde app/:
npm run worker:dev
```

El primer commit de implementación incorpora scripts `doctor`, `dev`, `build`, `start`, `worker:dev`, `worker:start`, `typecheck`, `lint`, `test:unit`, `test:db`, `test:integration`, `test:e2e`, `db:migrate:local`, `db:types`, `seed:local` y `db:reset:local`. Los nombres son contratos del proyecto, no comandos ya existentes.

`db:reset:local` es destructivo: el script exige `APP_ENV=local`, host loopback y confirmación explícita, y rechaza una URL remota. El arranque normal nunca resetea la base. Reconstruir una base desechable desde migraciones/seed forma parte de QA. [S06](https://supabase.com/docs/reference/cli/supabase-db-reset)

## 7 Modelo de datos y restricciones

### 7.1 Convenciones

UUID como identificador; `timestamptz` y UTC en persistencia; zonas IANA en preferencias. Texto normalizado Unicode NFC. `snake_case` en SQL y `camelCase` en JSON. El slug sirve para presentación, no como clave de autorización.

Separar `api` para funciones expuestas por PostgREST y `private` para tablas del dominio. No exponer `private` como esquema API. Activar RLS en tablas que puedan ser alcanzadas por roles de aplicación y denegar permisos por defecto. Los clientes consumen DTO explícitos, no `select *` de relaciones privadas.

### 7.2 Identidad y catálogo

| Tabla | Campos y restricciones principales |
|---|---|
| `profiles` | `id` FK a Auth, alias opcional, avatar opcional, `account_status` active/deletion_pending, apariencia system/light/dark, idioma es, zona IANA, preferencia de confirmación, timestamps |
| `user_roles` | usuario, rol user/editor/admin; UNIQUE usuario+rol; solo operaciones administrativas conceden roles |
| `characters` | UUID, `stable_key` único, nombre público, orden único 1–8, biografía 80–130 palabras, rasgos, versión de canon, recurso visual y estado de validación |
| `categories` | UUID, nombre, slug único, activa, timestamps; no borrar físicamente categorías referenciadas |
| `assets` | UUID, ruta/objeto, tipo MIME validado, hash, propietario opcional, versión, estado provisional/aprobado, atribución/licencia |
| `sources` | UUID, nombre, dominio permitido, tipo RSS/Atom/API/manual, URL base, verificación editorial, activa, política de uso, intervalo y último fetch |

La ausencia de alias no impide participar. Roles de aplicación no se deducen de `user_metadata` editable por el usuario. El catálogo de ocho claves se inicializa como `rami`, `beatriz`, `leo`, `dmitri`, `naoki`, `salma`, `tove`, `kavya` y no admite una novena voz en el MVP.

### 7.3 Contenido editorial

| Tabla | Campos y restricciones principales |
|---|---|
| `source_items` | fuente, URL canónica única o clave de proveedor, título, fecha externa, fecha de ingesta, extracto permitido, hash, evento candidato y estado |
| `events` | UUID, clave editorial canónica opcional, título de trabajo, fecha/entidades para agrupación, estado de deduplicación |
| `articles` | UUID, evento, categoría, estado draft/review/published/withdrawn, revisión actual, fecha de publicación inmutable, autor/aprobador, fecha y motivo de retirada |
| `article_revisions` | artículo, número único, título, microresumen, párrafos de ampliada, nota de corrección, autor, versión del contrato, aprobación humana |
| `article_sources` | revisión, fuente/item, nombre, fecha y URL, identificador de cita estable; UNIQUE revisión+cita |
| `opinions` | UUID, revisión, personaje, texto, orden; UNIQUE revisión+personaje y revisión+orden |
| `editorial_events` | artículo, tipo publish/correct/withdraw, actor, instante y motivo breve; sin guardar perfiles de lectores |

Un artículo apunta a una revisión publicada completa. Una revisión incluye sus ocho opiniones y sus referencias. No reescribir una opinión publicada: un cambio sustancial obliga a retirar; las correcciones menores se limitan a cambios que no alteran el objeto de participación, se versionan y conservan el vínculo de respuestas a la revisión de origen.

Una categoría principal por artículo. Si se desactiva, permanece identificable en contenido existente; antes de desactivarla se reasigna a una categoría activa o se define explícitamente su tratamiento editorial. Nunca eliminar respuestas por reclasificar.

### 7.4 Participación y resultados

| Tabla | Campos y restricciones principales |
|---|---|
| `article_user_state` | PK usuario+artículo; `omitted_at`, `full_results_seen_at`, timestamps; fila común para serializar operaciones |
| `participations` | UUID, usuario, artículo, revisión respondida, `choice_kind` voices/none, `operation_id`, hash canónico del payload, `confirmed_at`; UNIQUE usuario+artículo y usuario+operación |
| `participation_choices` | participación, `opinion_id`; PK compuesta; validación de pertenencia a revisión de la participación |
| `aspect_catalogs` | versión, estado proposed/validated/retired, fecha y editor validador |
| `aspect_labels` | catálogo, dimensión emotion/approach/stance, clave, definición y ejemplos positivos/negativos |
| `opinion_aspects` | opinión, etiqueta, peso en puntos básicos, evidencia textual, revisión humana; máximo 3 por dimensión |

`none` exige cero filas de choices. `voices` exige 1–8 opinion IDs distintos y válidos. Estas restricciones cruzan tablas: se implementan dentro de RPC controlada y con trigger de restricción diferible para impedir bypass SQL accidental. Solo un `CHECK` sobre la tabla padre no basta.

Las respuestas no se borran para permitir volver a votar. No hacer `UPSERT` que cambie el payload de una participación confirmada.

### 7.5 Operación y preferencias

| Tabla | Campos y restricciones principales |
|---|---|
| `notification_preferences` | usuario, news_opt_in, results_opt_in, hora 8/12/19, zona IANA, timestamps |
| `push_subscriptions` | usuario, endpoint cifrado/protegido, claves, creación y revocación; una fila por dispositivo |
| `notification_deliveries` | usuario, canal, fecha local, estado, payload mínimo, idempotency key; UNIQUE usuario+canal+fecha local |
| `jobs` | UUID, tipo, payload validado, clave de deduplicación, estado, intentos, fecha disponible, lease, error normalizado |
| `account_deletion_requests` | usuario, verificación, solicitud, recuperación hasta, estado y pasos de purga completados |
| `generation_runs` | trabajo, proveedor/modelo, versión de prompt/canon, referencias de entrada, validación, estado y métricas técnicas |
| `rate_limit_buckets` | identidad técnica minimizada, acción, ventana y contador con caducidad |

No crear inicialmente una tabla de porcentajes materializados. Consultar las participaciones autorizadas y calcular a partir de un snapshot consistente. Si el rendimiento lo exige, añadir después una proyección regenerable y versionada sin convertirla en otra fuente de verdad.

### 7.6 Índices mínimos

```sql
-- Esquema conceptual: los nombres de columnas se mantienen en las migraciones.
create unique index participation_once
  on private.participations(user_id, article_id);
create unique index participation_operation_once
  on private.participations(user_id, operation_id);
create unique index one_opinion_per_character
  on private.opinions(revision_id, character_id);
create index published_feed
  on private.articles(published_at desc, id desc)
  where status = 'published';
create index published_category_feed
  on private.articles(category_id, published_at desc, id desc)
  where status = 'published';
create index user_confirmed_history
  on private.participations(user_id, confirmed_at desc, id desc);
create index runnable_jobs
  on private.jobs(available_at, id)
  where status = 'queued';
```

Añadir índices en FK consultadas y en predicates de políticas. Confirmar planes con `EXPLAIN (ANALYZE, BUFFERS)` sobre datos sintéticos. El SQL anterior no es una migración completa y no se ejecuta directamente sobre datos reales.

## 8 Máquina de estados y transacciones

### 8.1 Estados efectivos

| Estado | Seleccionar | Confirmar | Consultar resultados |
|---|---|---|---|
| Pendiente | Sí, provisional | Sí, autenticado | No |
| Omitida sin completos vistos | Sí | Sí | Sí mediante acción explícita |
| Omitida con preliminares vistos | Sí | Sí | Sí; no bloquea por sí sola |
| Omitida con completos vistos | No | No | Sí |
| Confirmada voices/none | No | Solo recuperar respuesta existente | Sí |
| Artículo retirado | No | No | No; también se oculta en actividad |
| Cuenta en baja pendiente | No | No | No hasta recuperación |

La retirada y la baja de cuenta prevalecen sobre el estado de la noticia para ese usuario. No existen estados «cerrada por 24 horas» ni votos vencidos por tiempo. El avance después de confirmar es manual desde resultados; omitir avanza directamente sin abrirlos.

### 8.2 Confirmar

RPC `api.confirm_participation(article_id, revision_id, operation_id, choice_kind, opinion_ids)`:

1. Derivar identidad de `auth.uid()`, verificar cuenta activa y límites. No recibir `user_id` como autoridad desde JSON.
2. Tomar bloqueo compartido sobre la fila de perfil; tomar bloqueo compartido sobre artículo y comprobar `published` y revisión vigente. No hacer llamadas externas dentro de la transacción.
3. Insertar si falta `article_user_state` y bloquearla `FOR UPDATE`.
4. Buscar operación existente del mismo usuario. Si artículo/revisión/payload coinciden, devolver su confirmación; si la misma clave representa otra operación, devolver conflicto.
5. Si existe otra confirmación, devolver `ALREADY_CONFIRMED` con estado previo, nunca cambiarla.
6. Si `full_results_seen_at` existe y no hay confirmación, rechazar `PARTICIPATION_LOCKED`.
7. Validar exclusividad, IDs, revisión, catálogo de ocho voces y versión que leyó el cliente. Una revisión incompatible produce `CONTENT_CHANGED`, no una selección corregida silenciosamente.
8. Insertar participación y choices; comprobar invariantes; usar timestamp del servidor. Commit y devolver recibo. El payload se canoniza ordenando IDs y eliminando ambigüedad; los duplicados se rechazan en entrada.

Los bloqueos de perfil/artículo son compatibles entre lectores; el bloqueo por usuario/noticia serializa confirmaciones y acceso a resultados del mismo lector. No bloquear toda la tabla ni toda la noticia con `FOR UPDATE` por cada voto.

### 8.3 Omitir

RPC `api.omit_article(article_id)` usa el mismo orden de bloqueo, crea la fila de estado y fija `omitted_at` si aún no existe. Repetir no crea otra omisión ni altera fechas de actividad sin una razón. No cambia una confirmación ni quita `full_results_seen_at`. Un visitante inicia sesión antes de persistir la omisión. No crea filas en `participations`.

### 8.4 Acceder a resultados

RPC `api.access_results(article_id, formula_version)` se invoca mediante POST solo cuando el usuario pulsa Ver resultados o cuando la pantalla de resultados se abre después de una confirmación explícita. No se ejecuta al renderizar el feed, precargar enlaces o mostrar una miniatura.

Toma los mismos bloqueos, comprueba confirmación u omisión, y obtiene una sola instantánea de agregados. Si N<10, devuelve preliminar y no escribe `full_results_seen_at`. Si N≥10, devuelve completos y fija esa marca para la omitida en la misma transacción. El cálculo y la marca no se separan en dos peticiones.

La carrera confirmar/ver resultados se resuelve por el orden de adquisición de la fila de estado. Si confirmar gana, queda confirmada. Si el acceso a completos gana, confirmar queda bloqueado. Dos sesiones producen un resultado coherente.

**Límite explícito:** el servidor registra autorización y entrega de completos, no puede demostrar que una persona los miró. Si la respuesta se pierde después del commit, la marca permanece y el cliente puede recuperar los resultados. Esta semántica conservadora evita devolver elegibilidad después de una exposición posible; debe explicarse en QA y en el mensaje de recuperación.

PostgreSQL ofrece bloqueos de fila para coordinar estas operaciones. La elección y orden anteriores son el diseño de Riuya. [S07](https://www.postgresql.org/docs/current/explicit-locking.html)

### 8.5 Orden global y reintentos

Orden obligatorio: perfil → artículo → estado usuario/artículo → participación. Publicar/retirar toma el bloqueo exclusivo necesario sobre artículo; la baja toma el exclusivo sobre perfil. Todos los flujos respetan el orden para reducir deadlocks.

Lectura de resultados: construir N, contadores y fórmula desde un único statement/snapshot; para cálculos múltiples usar una instantánea de transacción coherente. No contar N en una consulta y calcular porcentajes desde otra instantánea.

Deadlock o conflicto transitorio: reintento limitado en servidor, máximo 3, con espera aleatoria corta. La operación sigue usando el mismo ID. Después, devolver un error recuperable. Si el resultado HTTP es ambiguo, el cliente consulta su participación antes de generar otra operación.

## 9 Identidad, roles y protección de datos

### 9.1 Sesión y autenticación

Usar Supabase Auth con los helpers SSR actuales. Verificar claims del token en servidor y comprobar estado/rol actual en base de datos para acciones protegidas. No confiar en el objeto de sesión leído de una cookie sin validación. `getUser` se usa cuando se necesita un registro Auth actualizado; `getClaims` valida identidad, pero no sustituye la comprobación de baja y permisos del dominio. [S03](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)

El módulo `proxy.ts` actualiza sesión/redirecciona según corresponda. Cada endpoint, servicio y RPC vuelve a autorizar. `/admin` oculto en UI no es un control de seguridad. Cambiar un rol o desactivar una cuenta surte efecto en operaciones de dominio aunque un JWT aún no haya vencido.

Implementar correo/contraseña, verificación de correo, recuperación de contraseña y cierre de sesión. En local los enlaces se inspeccionan en Mailpit; no hace falta SMTP real. Google y Apple se integran mediante proveedores de Auth, callback permitido y vinculación segura; no se fusionan cuentas porque el cliente envíe un correo igual. Probar identidades verificadas, proveedor duplicado, cancelación y conflicto. [S08](https://supabase.com/docs/guides/auth/auth-identity-linking)

Guardar el borrador antes de iniciar OAuth y restaurarlo al regresar. Validar `next` contra rutas internas permitidas para impedir redirecciones abiertas. Nunca confirmar automáticamente al volver de autenticación.

### 9.2 Matriz de permisos

| Acción | Visitante | Usuario | Editor | Administrador |
|---|---|---|---|---|
| Leer noticias publicadas y fichas | Sí | Sí | Sí | Sí |
| Selección provisional | Local | Sí | Sí como lector | Sí como lector |
| Confirmar/omitir/resultados propios | No | Sí | Sí como lector | Sí como lector |
| Leer perfil/actividad ajena | No | No | No | No mediante la aplicación |
| Preparar/revisar/publicar/retirar | No | No | Sí | Sí |
| Configurar fuentes/categorías | No | No | Sí | Sí |
| Otorgar o revocar roles | No | No | No | Sí |
| Ejecutar purga o configurar secretos | No | No | No | Proceso operativo restringido |

El propietario de infraestructura tiene acceso operativo potencial a la base: no prometer inaccesibilidad absoluta frente a operadores. No construir una pantalla administrativa para explorar preferencias individuales.

### 9.3 Base de datos

Revocar `EXECUTE` a `PUBLIC` en funciones expuestas y conceder por rol. Separar lecturas públicas y operaciones autenticadas. Funciones con `SECURITY DEFINER` usan un propietario de mínimo privilegio, `search_path` vacío y objetos totalmente calificados; derivan el usuario del contexto y comprueban estado/rol. El propietario debe poder hacer únicamente las operaciones necesarias; no reutilizar un superusuario general. Revisar explícitamente si el dueño evita RLS y probar cada vía de acceso.

Las tablas privadas no se conceden directamente al navegador. RLS y permisos reducen accesos alternativos; RPC autoriza cada caso. La clave secreta de Supabase queda reservada a procesos como creación administrativa de usuarios, revocación de sesiones y purga Auth. No usarla para todas las consultas del BFF porque eliminaría la protección del contexto del usuario. [S09](https://supabase.com/docs/guides/database/postgres/row-level-security) · [S10](https://supabase.com/docs/guides/database/functions)

### 9.4 Controles HTTP

Peticiones de escritura con JSON, origen permitido, validación de sesión y protección CSRF por token de sesión además de cookies SameSite. No habilitar CORS comodín con credenciales. Configurar cookies Secure en HTTPS; en desarrollo HTTP local conservar la excepción necesaria del SDK. No prometer cookies HttpOnly para tokens que el flujo SSR/browser del SDK deba gestionar; validar su comportamiento real y reforzar CSP.

Validar tamaño y esquema antes de procesar. Rechazar campos desconocidos relevantes. Límites iniciales: cuerpo de participación 16 KB, borrador editorial 128 KB y subida de avatar 5 MB. Revalidar imágenes por decodificación, dimensiones y MIME; no aceptar SVG de usuario ni conservar metadatos innecesarios.

Rate limit inicial por identidad autenticada y acción: confirmar/omitir 30 por minuto, resultados 30 por minuto, generación 5 por hora/editor; ajustes tras medición. Los fallos de Auth y tráfico anónimo tienen controles del proveedor/gateway y límites específicos; un límite por IP no prueba unicidad humana. En local usar tabla atómica con caducidad, no un `Map` por proceso como control productivo.

## 10 Contrato HTTP y errores

### 10.1 Convenciones

Prefijo `/api/v1`. JSON UTF-8. Fechas ISO 8601 UTC. IDs UUID. No devolver campos secretos ni objetos SDK. Respuestas de operaciones personales: `Cache-Control: private, no-store`. No reflejar trazas SQL ni proveedor en errores de usuario.

```json
{
  "error": {
    "code": "PARTICIPATION_LOCKED",
    "message": "Ya consultaste los resultados completos de esta noticia.",
    "retryable": false,
    "requestId": "uuid"
  }
}
```

| HTTP | Casos |
|---|---|
| 400 | JSON inválido, cursor o combinación de IDs inválidos |
| 401 | Falta sesión válida |
| 403 | Cuenta desactivada, rol insuficiente o resultados no autorizados |
| 404 | Recurso inexistente, retirado o no visible para ese contexto |
| 409 | Ya confirmado, operación reutilizada con otro payload, resultados completos vistos, revisión incompatible |
| 422 | Contenido editorial no cumple validación o esquema |
| 429 | Límite excedido; incluir Retry-After |
| 503 | Dependencia no disponible o transacción temporalmente no resuelta |

Para rutas públicas, una noticia retirada responde 404 y no entrega título, fuentes, imagen de compartir ni contadores. Editorial autorizado sí puede consultarla por su ruta administrativa.

### 10.2 Endpoints del lector

| Método y ruta | Entrada principal | Salida y regla |
|---|---|---|
| GET `/news` | category opcional, cursor, limit máximo 10 | Hasta 10 tarjetas publicadas; cursor siguiente y `hasMore` |
| GET `/news/{id}` | ID | Contenido, ocho opiniones, referencias y revisión; sin popularidad |
| GET `/characters/{key}` | Clave estable | Ficha y recursos, versión y aviso de ficción/IA/revisión |
| GET `/news/{id}/participation` | Sesión | Estado propio y elecciones históricas; no resultados comunitarios |
| POST `/news/{id}/participation` | revisionId, operationId, choiceKind, opinionIds | Recibo idempotente de confirmación |
| POST `/news/{id}/omit` | Sesión | Estado omitido y avance sugerido; sin resultados |
| POST `/news/{id}/results/access` | formulaVersion | Resultado autorizado y actualización atómica de completos vistos |
| GET `/me/activity` | status all/responded/omitted, cursor | Cronología privada, sin retiradas |
| GET `/me/trends` | Sesión | Últimas 20 respondidas, historial y diferencia en puntos porcentuales |
| PATCH `/me/preferences` | Campos permitidos | Preferencias validadas; no roles ni estado de cuenta |
| POST `/me/deletion-request` | Prueba de reautenticación | Desactivación y fecha de recuperación |
| POST `/me/deletion-request/cancel` | Identidad revalidada | Recuperación si no venció el plazo |
| POST/DELETE `/me/push-subscriptions` | Suscripción del dispositivo | Alta o revocación propia |

El login, callback, verificación y recuperación usan los flujos de Supabase Auth. No crear un almacén de contraseñas propio.

### 10.3 Participación

```json
{
  "revisionId": "181a79dc-64e9-4b92-88fb-dd924b709b60",
  "operationId": "c91c3099-dfc9-49a2-b4de-4b14fd297db0",
  "choiceKind": "voices",
  "opinionIds": ["9b50a621-c2b3-4da3-b9f1-8f36cf946afe", "267d62c0-965f-4bd0-876b-b486850d5231"]
}
```

El ejemplo usa UUID ficticios; la validación exige que correspondan a opiniones de la revisión indicada. Para Ninguna: `choiceKind: "none"` y `opinionIds: []`. Un array vacío con `voices` es error. Una omisión nunca se representa con este payload.

Respuesta: `participationId`, `articleId`, `revisionId`, `choiceKind`, `opinionIds`, `confirmedAt`, `operationId`, `replayed`. En timeout se consulta GET de participación. No cambiar la operación mientras se desconoce si se guardó.

### 10.4 Resultados

```json
{
  "articleId": "c4d468c7-7c70-4874-8da3-b74ed849c0e2",
  "formulaVersion": 2,
  "mode": "preliminary",
  "generatedAt": "2026-11-08T15:00:00Z",
  "participationLocked": false,
  "community": null,
  "coincidence": null,
  "aspects": {"state": "insufficient_data", "items": []}
}
```

En preliminar no enviar porcentajes, ranking, conteos por voz ni datos ocultos en HTML/JSON. El modo completo incluye N, nueve categorías estadísticas y métricas autorizadas. No exponer elecciones de otras personas. No devolver un recuento público exacto por voz en una API alternativa que eluda la pantalla.

### 10.5 Panel editorial

Rutas bajo `/api/v1/admin`: CRUD de borradores/categorías/fuentes, lanzar ingesta/generación, revisar agrupaciones, publicar, corregir y retirar. Las mutaciones editoriales incluyen `expectedVersion`; una versión desactualizada devuelve 409 para impedir sobrescribir el trabajo de otra sesión. Publicar requiere hash de la revisión revisada y confirmación humana explícita.

## 11 Resultados y matemáticas versionadas

### 11.1 Participantes y apoyo por voz

Sea P el conjunto de usuarios con participación confirmada en una noticia y N=|P|. Incluye `voices` y `none`; excluye borradores y omisiones. Para cada voz c, `support(c)=100 × count(usuarios que eligieron c)/N`. Para Ninguna, `support(none)=100 × count(choice_kind=none)/N`.

Con N=0 no se divide. Con N<10 no se publican porcentajes. Con N≥10 se muestran porcentajes con una cifra decimal, redondeo decimal explícito y valores brutos internos sin redondeo prematuro. No forzar que las nueve categorías sumen 100: la multiselección puede superar ese total.

Fixture obligatorio: N=10, siete apoyan Rami, cinco Beatriz y dos confirman Ninguna; Rami=70 %, Beatriz=50 %, Ninguna=20 %. El conjunto de elecciones debe permitir solapamiento y dejar ocho personas en voices.

### 11.2 Coincidencia comunitaria

**Definición técnica nueva T07 para validación de producto.** Cada respuesta se representa como conjunto de claves. Una respuesta Ninguna se representa con el único elemento reservado `none`, nunca como conjunto vacío ni personaje. No se mezcla con voces.

Para usuario u y otro participante v: `J(u,v)=|Su ∩ Sv| / |Su ∪ Sv|`. La coincidencia es `100 × promedio J(u,v)` para todos los otros participantes válidos de la misma noticia. Se excluye siempre al propio usuario. Ninguna/Ninguna produce 1; Ninguna/voces produce 0. Dos voces frente a una coincidente producen 1/2.

Solo mostrar con N≥10 y al menos nueve comparables; sin confirmación propia, una omitida puede consultar resultados comunitarios pero su coincidencia personal es `not_applicable`. El texto dirá «Coincidencia media con las elecciones de otras personas», no porcentaje de personas idénticas ni diagnóstico de afinidad permanente.

Esta definición resuelve una decisión que el histórico dejaba abierta. Implementar fórmula versionada y ejemplos, pero no presentar su interpretación como aprobación histórica. La revisión de UX debe aceptar su significado, especialmente Ninguna/Ninguna, antes de habilitarla para público. Si no supera esa validación, el componente informa que la comparación no está disponible; no muestra cifras inventadas.

### 11.3 Aspectos de los comentarios apoyados

Tres dimensiones separadas: emoción, enfoque y postura. Hasta tres etiquetas por dimensión y opinión, pesos 10000; 7000/3000; o 6000/2500/1500 puntos básicos. La suma por dimensión presente es 10000. Una dimensión puede estar ausente. Etiquetas y evidencia se congelan con la revisión editorial.

Para un usuario que apoyó k opiniones, una etiqueta a en dimensión d recibe:

```text
A(u,a,d) = Σ [ w(opinion,a,d) / k ]
M(u,d)   = Σ_a A(u,a,d)
personal(u,a,d) = 100 × A(u,a,d) / M(u,d), si M(u,d)>0

comunidad(a,d) = 100 × Σ_u A(u,a,d) / Σ_u M(u,d)
```

`w` se usa como fracción 0–1. Ninguna aporta cero evidencia de aspectos; no se le inventa emoción y no altera el denominador de apoyo por voz. Si k=0 o M=0, estado sin datos y ambiente neutro. La comunidad de aspectos solo se expone con N≥10 y al menos 10 usuarios que aportan evidencia en esa dimensión. No inferir porcentajes emocionales desde una sola opinión de una muestra pequeña.

La tarjeta personal presenta hasta tres emociones de mayor peso, sin renormalizar para fingir que las tres cubren todo el catálogo; si quedan otras, indicarlo. Mostrar cobertura M o una explicación de comentarios clasificados. Curiosidad, humor y reflexión pertenecen a enfoque y no generan un fondo emocional.

`ASPECTS_ENABLED` permanece desactivado hasta validar el catálogo, doble anotación y ejemplos de cálculo. El contrato y las tablas se implementan; la validación semántica humana no se sustituye por un test. Las etiquetas propuestas del histórico no se convierten por esta especificación en un catálogo editorial definitivamente aprobado.

### 11.4 Tendencias privadas

Universo: respuestas confirmadas del usuario a artículos aún visibles. Recientes: últimas 20 por `confirmed_at DESC, id DESC`; si hay menos, todas. Historial: todo ese universo. Cada noticia aporta una oportunidad, incluyendo Ninguna. Omitidas y retiradas quedan fuera.

Para una voz: frecuencia de selección dividida por respuestas en la ventana. Para Ninguna: frecuencia none dividida por respuestas. Comparar reciente menos histórico en puntos porcentuales. La ventana reciente está incluida en el historial; no presentar la diferencia como comparación de muestras independientes ni como significación estadística.

### 11.5 Refresco, retirada y purga

Refrescar al abrir o volver a resultados; sin Realtime/polling mientras se permanece. Un snapshot ya entregado no se reescribe en pantalla por nuevos votos. Una retirada invalida el acceso desde el siguiente request. Tras purga de una cuenta pueden bajar N y los porcentajes: con N<10 se vuelve a preliminar, pero nunca se borra la marca de completos vistos de otros usuarios.

El umbral 10 no garantiza anonimato frente a colusión, Sybil o consultas por diferencias. No añadir segmentos geográficos en MVP ni exportar microdatos. Autenticación, límites y ausencia de desgloses ayudan, pero no se promete unicidad humana ni privacidad diferencial.

## 12 Lectura, navegación y estado de interfaz

### 12.1 Feed y páginas

Feed ordenado por `(published_at DESC, id DESC)` con cursor opaco validado que contenga último par y límite superior de la primera página. Filtrar por categoría en SQL. Devolver 10 y `hasMore` consultando como máximo una fila extra. El desempate por ID evita duplicados con fechas iguales; el límite superior evita insertar novedades en medio de una sesión paginada. Refrescar desde inicio para ver noticias nuevas.

Para una sesión autenticada, el DTO de cada tarjeta incorpora únicamente su estado propio responded/omitted/pending, obtenido por consulta acotada a esos diez artículos y al usuario verificado. Para un visitante no hay marcas persistentes. No añadir las elecciones ni la identidad de otros usuarios. Si una petición incluye estado personal, se mantiene `private, no-store` y no se comparte con un visitante.

Página de noticia: titular, categoría/fecha discretas, microresumen, lectura ampliada y ocho tarjetas verticales completas. Avatar y nombre abren ficha modal, no votan; el botón de apoyo es independiente. La ampliada utiliza párrafos estructurados y referencias inline por ID validado, con lista final de fuentes.

`Omitir` va a la siguiente noticia disponible. Después de confirmar, mostrar resultados y botón explícito Siguiente noticia. Si no hay siguiente, informar y permitir volver al feed; no reutilizar otra noticia como si fuera nueva.

Mi actividad contiene una fila por artículo. Si está respondida, ordenar por `confirmed_at`; en caso contrario, por `omitted_at`, con desempate por artículo. Confirmar después de omitir cambia su estado a respondida y su instante de actividad a confirmación. Leer resultados o repetir una omisión no desplaza la fila ni crea entradas duplicadas. La paginación usa ese instante efectivo y el ID, con la misma disciplina de cursor.

### 12.2 Borradores

Guardar en `sessionStorage` con clave de usuario o visitante, artículo y revisión: IDs, Ninguna, scroll, timestamp y ruta de regreso. No guardar tokens ni preferencias de otras cuentas. Conservar durante la sesión de pestaña, incluyendo retorno OAuth; al cerrar sesión borrar borradores asociados y reconciliar al cambiar de usuario.

No sincronizar borradores entre dispositivos en MVP. Al volver, consultar estado servidor: confirmado o bloqueado prevalece. Una revisión incompatible invalida el borrador con explicación. La restauración nunca envía ni confirma. En fichas y ampliada preservar scroll y foco.

### 12.3 Estados mínimos

Loading, vacío, error recuperable, sin conexión, selección provisional, confirmando, confirmado, omitido, omitido bloqueado, preliminar y completo. Un timeout no produce un toast de éxito ni habilita inmediatamente otra elección. Mostrar «Comprobando si se registró tu respuesta» y recuperar desde servidor.

Confirmación compacta con resumen, irreversibilidad y volver. Se puede ocultar el aviso por preferencia reversible, pero permanece la acción consciente Confirmar elecciones. Nunca interpretar un estado vacío como Ninguna implícita.

## 13 Diseño, recursos y accesibilidad

La dirección visual es Editorial Liquid Glass/Aurora, claro y oscuro. Implementar tokens semánticos de fondo, superficie, borde, texto, foco, selección y estados. El efecto vidrio tiene alternativa opaca; ningún significado depende solo del color. Las temporizaciones históricas se tratan como rangos de prototipo, no valores ya validados.

Las maquetas recuperadas conservan su utilidad de composición, pero no se copian buscadores, navegación antigua, marca Wakari, halos o cifras ilustrativas incompatibles. El estado seleccionado usa corazón lleno, Te gusta y borde/acento distinguible de la clasificación editorial de la opinión.

El kit V1.5 declara retratos aprobados de estilo ilustrado; la base anterior describe fotográficos pendientes. Implementar un manifiesto de assets con estado y versión para sustituir imágenes sin cambiar claves ni datos. En pruebas locales se usan referencias identificadas; antes de producción se reconcilia el estado visual y los derechos. Esta decisión no inventa aprobación 069.

Objetivo de aceptación: WCAG AA, foco visible, teclado, lector de pantalla, texto ampliado al 200 %, reducción de movimiento y transparencias, contraste probado sobre superficies reales, y objetivos táctiles de al menos 44 CSS px salvo restricciones verificadas de plataforma. El modal atrapa el foco, se anuncia y lo devuelve al cerrar. Reservar espacio para la barra inferior y safe areas; las ocho opiniones deben poder leerse completas.

Ancho de prueba mínimo 360 px y máximo de lectura controlado en escritorio. Fuentes alojadas localmente con licencia documentada. Logo R8 se reutiliza, no se redibuja. Optimizar derivados sin modificar los maestros; avatares cuadrados/circulares con alternativa de inicial y nombre si falla la imagen.

Base técnica de tokens para empezar a construir, sujeta a revisión de contraste sobre superficies reales: tipografía de sistema `system-ui, Segoe UI, sans-serif`, cuerpo 16 px y línea 1,6; ancho de lectura 720 px; espaciado en múltiplos de 4 px; tarjeta con radio 16 px, diálogo 20 px y desenfoque máximo inicial 12 px. Claro: fondo `#F4F7FB`, superficie opaca de respaldo `#FFFFFF`, texto `#142638`; oscuro: fondo `#0D1726`, superficie `#18263A`, texto `#F0F5FA`. El foco usa un anillo visible de 3 px con contraste medido en cada tema. No reutilizar estos colores como etiquetas emocionales. Esta base evita bloquear componentes por falta de tokens y no afirma que una paleta de prototipo esté aprobada para producción.

## 14 PWA y conectividad

Manifest, iconos, nombre, start URL, theme colors y service worker mínimo. `localhost` permite pruebas de muchas capacidades, pero instalación/push dependen del navegador y dispositivo; se prueban en plataformas reales antes de comprometer la experiencia. [S11](https://nextjs.org/docs/app/guides/progressive-web-apps)

El worker de servicio solo cachea assets públicos versionados y una pantalla de desconexión. Estrategia network-only para Auth, APIs, resultados, perfiles y HTML con datos de sesión. No cachear en background una respuesta retirada ni habilitar Background Sync para participaciones. Limpiar cachés antiguas al actualizar.

Con servidor local apagado o sin conexión al backend: mensaje y reintento. El navegador puede conservar el borrador en memoria/sesión, pero no una cola de votos pendiente. El usuario debe volver a confirmar explícitamente después de reconciliar estado.

En Next.js, las respuestas con cookies, resultados, actividad y administración son dinámicas y `no-store`; no poner caché CDN delante de ellas. Inicialmente también se sirven noticias desde origen sin caché persistente para garantizar retirada. Assets con hash sí pueden cachearse largo tiempo. [S12](https://nextjs.org/docs/app/guides/self-hosting)

## 15 Panel editorial y publicación

Estados: draft → review → published → withdrawn. Un error de validación conserva el borrador. La aprobación corresponde a una revisión específica y se invalida si se altera texto, opiniones, fuentes o etiquetas después de revisar.

RPC de publicación, en una transacción: editor/admin activo, revisión esperada, categoría activa, exactamente ocho personajes únicos en orden, longitudes, referencias válidas, trazabilidad factual, assets permitidos y aprobación humana. Asigna `published_at` del servidor y no acepta un valor del cliente para reordenar manualmente el feed.

Conteo de palabras: usar una función compartida y pruebas para español, normalizando espacios y Unicode; contar palabras de texto visible, no URLs ni marcadores de referencia. Los márgenes funcionales se validan en editor y servidor. No publicar mediante un bypass porque la IA generó una palabra adicional; el editor corrige el texto.

Checklist: hechos/fechas/lugar, fuentes y grado de certeza, resumen neutral, ocho argumentos útiles, canon, ficción identificada, ninguna fotografía noticiosa, categoría y revisión. No forzar divergencia artificial entre personajes ni generar testimonios de observación directa.

Corrección menor: nota y revisión sin alterar el objeto de las respuestas. Si cambia el significado de noticia/opinión, retirar y crear otra publicación independiente, sin trasladar votos ni exigir enlace público de relación. El botón retirar confirma motivo y bloquea contenido, resultados, actividad y nueva generación de tarjetas en origen.

## 16 Ingesta, deduplicación e IA

### 16.1 Recuperación de fuentes

El catálogo editorial permite RSS/Atom y APIs verificadas. El worker ejecuta fetch con `ETag`/`Last-Modified`, límites de tamaño, timeout 15 s, máximo 3 redirecciones y frecuencia inicial 30 minutos por fuente. Respetar condiciones de uso y permisos; no guardar artículos completos sin una base autorizada. Conservar URL, medio, fecha, extracto permitido y evidencia mínima.

Protección de fetch: solo HTTP/HTTPS autorizado; lista de dominios y puertos; rechazar IP literal o resolución a loopback, link-local, redes privadas y endpoints de metadatos. Validar cada redirección y dirección resuelta. No permitir que un editor convierta una URL arbitraria en acceso a servicios internos. El fetcher de noticias y el adaptador local de Ollama tienen políticas de red distintas.

Deduplicación inicial sin servicio vectorial: canonicalizar URL, clave de proveedor y hash; proponer grupos por coincidencia de entidades, proximidad temporal y similitud de título mediante una función determinista con umbral configurable. Los umbrales se ajustan con un conjunto etiquetado; coincidencia no publica ni fusiona automáticamente hechos distintos. El editor confirma el grupo/evento y una publicación principal por acontecimiento.

La carga manual sirve para las primeras fases y para contingencia. Ingesta y agrupación automatizadas deben completarse antes de declarar listo el MVP editorial; no quedan eliminadas por empezar manualmente.

### 16.2 Adaptador de generación

Contrato `generateEditorialDraft(input): Promise<DraftCandidate>` con referencias verificadas, versión de canon, idioma es y schema JSON. Salida: título, microresumen, párrafos con citation IDs, ocho opiniones con characterKey y propuestas de etiquetas/evidencia. Cada afirmación referenciable debe usar citas existentes; no aceptar URLs inventadas por el modelo.

Modos: `fixture` para pruebas reproducibles; `ollama` para ensayo de generación local; un adaptador remoto solo se añade por decisión posterior. Modelo inicial de evaluación `qwen3:8b`, una opción disponible en Ollama; registrar digest y configuración. No asumir que su tamaño garantiza calidad editorial en español. Si el equipo o la calidad no bastan, cambiar de modelo tras benchmark manteniendo el contrato. [S13](https://ollama.com/library/qwen3:8b)

Pedir salida estructurada con JSON Schema y validar en Zod antes de persistir. Un schema válido no prueba veracidad; ninguna salida se publica sola. [S14](https://docs.ollama.com/capabilities/structured-outputs)

Límites iniciales de Riuya: una generación de IA simultánea, timeout configurable de 180 s, máximo dos intentos de reparación de formato y cancelación del trabajo por editor. El texto de fuentes se delimita como dato no confiable; instrucciones dentro de artículos no pueden conceder herramientas, escribir archivos, cambiar prompts ni publicar. El modelo no recibe credenciales, votos, perfiles o historial de lectores.

La revisión editorial corrige resultados, valida fuentes y aprueba. El benchmark utiliza noticias verificadas de prueba y casos sensibles, mide ocho voces, fidelidad factual, citas, longitudes, ausencia de estereotipos y coste/latencia local. Registro de ejecución con versión de prompt y canon; retención del texto bruto limitada y sin PII innecesaria.

## 17 Worker y trabajos persistentes

Un worker Node.js del mismo repositorio corre en una segunda terminal local y en un proceso/contenedor independiente al desplegar. Comparte contratos y servicios; no constituye otro producto ni API pública.

Tipos iniciales: `source.fetch`, `event.cluster`, `draft.generate`, `notification.schedule`, `notification.send`, `account.purge`. `jobs` tiene estados queued/running/succeeded/failed/cancelled, `dedupe_key`, `attempts`, `max_attempts`, `available_at`, `locked_by`, `lease_until`, `last_error`.

Reclamar con transacción corta, `FOR UPDATE SKIP LOCKED`, fijar lease y commit. Ejecutar red/IA fuera de la transacción. Renovar lease de tareas largas; completar únicamente si el token de lease coincide. Un proceso caído deja una tarea recuperable. La exclusión en base no garantiza una sola ejecución de efectos externos: cada handler debe ser idempotente.

Reintentos iniciales 3 con backoff 30 s, 2 min y 10 min, más jitter; errores permanentes no reintentan. No almacenar payloads con secretos. Un trabajo editorial nunca incluye una instrucción de publicar sin la aprobación humana. El acceso del worker se limita a funciones/tables de su tarea; secretos Auth administrativos solo en el módulo de purga, no en el fetcher de fuentes.

Al programar un efecto como notificación o purga, insertar la tarea en la misma transacción que registra su intención. Así no se confirma una operación sin dejar su trabajo pendiente. No introducir un segundo sistema de colas hasta que las métricas lo justifiquen.

## 18 Notificaciones y horarios

Noticias y resultados son canales opt-in independientes, máximo uno por canal y día local. Horas permitidas 08:00 por defecto, 12:00 o 19:00. Las comunicaciones de seguridad de cuenta siguen el flujo Auth y no se confunden con canales editoriales.

Guardar zona IANA, no solo offset. Scheduler cada minuto determina eventos pendientes y crea `notification_deliveries` con UNIQUE usuario+canal+fecha local. Horas inexistentes por cambio de horario: siguiente instante local válido; horas repetidas: primera ocurrencia. La clave por fecha/canal impide un segundo envío. Cambiar de zona/hora no crea envíos retrospectivos ni una segunda entrega del día ya enviada; usar además un intervalo mínimo de 20 horas entre entregas del mismo canal como protección de viaje.

Una entrega de resultados necesita novedades desde su último aviso y permiso del usuario. Payload genérico sin voces elegidas, datos privados o porcentajes; el destino vuelve a autenticar y recalcular elegibilidad. Push mediante Web Push y claves VAPID propias cuando se habilite; no usar un token compartido para todos los usuarios.

Para programar resultados, considerar novedad una noticia confirmada u omitida cuyo estado completo pasó a estar disponible desde el último aviso, o cuyo número de participaciones confirmadas cambió desde el snapshot que se notificó. Excluir retiradas. Comparar revisión/contadores de negocio, no `generatedAt` de una lectura, para que consultar la API no genere una novedad artificial. Agrupar todas las novedades del canal en una sola entrega diaria.

En local `NOTIFICATION_TRANSPORT=local` captura los envíos y sus horarios sin contactar dispositivos externos. Esta prueba no valida transporte push real. Antes de producción probar consentimiento iniciado por acción del usuario, instalación si la plataforma la exige, revocación, endpoint expirado y duplicados de transporte. La entrega externa es al menos una vez en términos prácticos; usar `tag` estable y manejar repeticiones, sin prometer exactamente una recepción.

## 19 Resultados compartibles

Generar PNG 1080×1920 en el cliente con un renderizador determinista de SVG/Canvas que use solo fuentes y assets locales autorizados. No usar captura arbitraria del DOM ni un servidor público que almacene resultados de usuario. El snapshot procede de `/results/access`, no de campos editables por el cliente para construir estadísticas reales.

Formato privado predeterminado de esta versión técnica: titular/microresumen, contexto de métrica autorizada y CTA; omite nombres elegidos. Formato detallado requiere acción explícita y vista previa. Confirmar esta decisión de UX en la revisión del prototipo; no se atribuye al histórico. Nunca compartir automáticamente perfil, historial o ID de usuario.

Con N<10, solo tarjeta preliminar sin porcentajes comunitarios. Métricas personales/coincidencia se incluyen solo cuando la versión de fórmula está validada y disponible. Arte de demostración lleva SIMULACIÓN y datos ilustrativos; no se mezcla con producción. «Cómo conectaste con esta noticia» describe comentarios apoyados y no emociones medidas.

Web Share API si está disponible y permite archivos; fallback Descargar PNG. En local no generar QR a localhost ni suponer que riuya.com apunta al MVP. El enlace/QR se activa después de fijar un origen público probado. Añadir dominio de marca como enlace de destino solo si su función fue comprobada.

No incluir iconos de navegación ni controles sin función en el arte. Ante retirada, impedir generar nuevas tarjetas desde origen. Una imagen ya descargada/compartida no puede retirarse de terceros: no prometer revocación de esos archivos.

## 20 Baja de cuenta, retención y recuperación

Solicitud tras reautenticación reciente: transacción fija `account_status=deletion_pending`, fecha y recuperación a siete días exactos desde el instante UTC del servidor. Bloquear lecturas/escrituras privadas y programación editorial para esa cuenta; limpiar borradores locales. Revocar sesiones en Auth y mantener el chequeo de dominio porque los JWT emitidos pueden seguir siendo válidos hasta expirar. [S15](https://supabase.com/docs/guides/auth/managing-user-data)

La recuperación es una ruta restringida separada: revalidar identidad con correo/proveedor, comprobar que no venció el plazo y cancelar atómicamente la solicitud. No depender de una sesión revocada para que el usuario pueda recuperar. Una carrera recuperación/purga se serializa por perfil y solicitud.

El worker de purga verifica de nuevo el plazo y estado. Pasos reanudables: cancelar entregas/trabajos; borrar suscripciones/preferencias/avatares; eliminar elecciones, participación, estados e identificadores asociados; resolver referencias editoriales sin filtrar datos; eliminar usuario Auth y finalizar solicitud. Los campos de actor editorial pueden quedar nulos con un texto mínimo de rol, sin conservar correo/alias. Proteger referencias con FK y pruebas.

**Política conservadora de esta versión:** no conservar datos de contribución identificables para mantener estadísticas. Si no existe una política de anonimización y base jurídica aprobada, eliminar esas contribuciones y recalcular resultados; puede bajar N. No llamar anónimo a sustituir un UUID por otro. Conservar agregados de forma distinta requerirá una ADR y revisión específica antes de cambiar esta política.

Definir antes de usuarios reales: jurisdicción, términos/privacidad, periodos de logs/backups y retención exigida. Propuesta operativa inicial: logs técnicos minimizados 14 días; backups de desarrollo con datos ficticios, 7 copias diarias. Producción requiere política separada. Una restauración debe reaplicar las bajas completadas antes de servir tráfico para no resucitar datos eliminados; definir un registro mínimo de supresiones compatible con la política jurídica.

## 21 Pruebas, datos de prueba y calidad

### 21.1 Capas

Vitest para reglas puras, contratos y fórmulas; pgTAP para permisos, restricciones y RPC; integración con Supabase local real para transacciones; Playwright para recorridos de navegador. Fixtures con usuarios/roles ficticios y cuentas bajo dominios de prueba, sin importar datos personales reales. [S16](https://vitest.dev/guide/) · [S17](https://supabase.com/docs/guides/database/testing) · [S18](https://playwright.dev/docs/intro)

### 21.2 Matriz mínima de aceptación

| Prueba | Resultado exigido |
|---|---|
| Visitante elige dos voces y autentica | Borrador restaurado; cero confirmación automática |
| Voices vacío; none con IDs; IDs repetidos/ajenos | Rechazo sin escrituras parciales |
| Dos confirmaciones concurrentes | Una participación; selección inmutable |
| Misma operación y payload tras timeout | Mismo recibo; sin doble conteo |
| Misma operación con otro artículo/payload | 409; no altera respuesta anterior |
| Confirmar y ver completos desde dos sesiones | Una transición coherente según el bloqueo |
| Omitida abre preliminares N=9 | Puede confirmar después |
| Omitida accede a completos N=10 | No puede confirmar después, incluso tras fallo de entrega |
| N=0, 1, 9 | Sin porcentajes ni ranking escondidos en red/HTML |
| N=10 y multiselección/Ninguna | Denominador por persona correcto; suma no forzada a 100 |
| Jaccard voces/voces, none/none, none/voces | Casos de referencia exactos; excluye autocomparación |
| Aspectos sin etiquetas o parcialmente clasificados | Sin inventar emoción; cobertura y denominador correctos |
| Editor intenta leer actividad ajena | Denegado por endpoint y acceso alternativo a datos |
| Usuario altera metadata para ser editor | Sin privilegios adicionales |
| Publicación con 7, 9 o voces duplicadas | No publica ni parcialmente |
| Dos editores modifican la misma revisión | Conflicto de versión detectable |
| Retirada mientras se confirma o consulta | Sin nuevas respuestas/accesos después del commit de retirada |
| 24 noticias con fechas iguales y nuevas inserciones | Cursor estable, 10+10, sin duplicados |
| Logout/cambio de cuenta | Borrador y datos privados no cruzan identidades |
| Worker cae con lease activo | Recuperación y handler idempotente |
| Fetch redirige a red privada | Bloqueado, sin petición interna |
| Fuente contiene instrucciones para IA | Tratadas como datos; ninguna acción o publicación automática |
| Scheduler DST, cambio de zona y dos workers | Máximo de entrega lógica por canal/día y sin catch-up masivo |
| Cuenta en baja con JWT aún vigente | Dominio deniega acceso hasta recuperación |
| Recuperar y purgar concurrentemente | Solo una transición; ninguna purga de cuenta recuperada |
| Restaurar backup con cuentas ya purgadas | Supresiones reaplicadas antes de abrir tráfico |
| Texto 200 %, teclado, lector y movimiento reducido | Ocho tarjetas y acciones accesibles, sin pérdida de foco |
| Service worker y HTTP cache | No exponen privados ni envían votos offline |
| Build de producción local | Mismos recorridos críticos pasan sin depender de `next dev` |

### 21.3 Datos y puertas de calidad

Seed reproducible: ocho personajes, seis categorías, tres roles, al menos 24 noticias sintéticas con ocho opiniones, borradores incompletos y escenarios N=0/1/9/10. Etiquetar datos ilustrativos en el entorno; impedir sembrar usuarios editoriales de prueba en producción por una variable accidental.

Exigir en cada cambio: tipos, lint explícito, unitarias afectadas, tests SQL/integración si cambia dominio o permisos, build y recorridos críticos si cambia UI. Un build no sustituye lint ni pruebas de autorización. No perseguir un porcentaje global de cobertura como prueba de seguridad: la matriz anterior y las invariantes deben tener casos positivos y negativos.

## 22 Rendimiento, observabilidad y operación

Objetivos iniciales para una máquina de referencia registrada, con 10 000 noticias y 100 000 participaciones sintéticas: p95 de API de lectura/confirmación menor a 1 s en LAN/local sin IA en la petición; 50 sesiones sintéticas concurrentes para verificar ausencia de duplicados y timeouts por locks. Son metas de aceptación a medir, no resultados ya obtenidos. Si no se cumplen, analizar planes y contención antes de añadir caché o infraestructura.

Logs JSON: request/job ID, ruta/tipo, duración, código, estado y métricas técnicas. No registrar contraseñas, cookies, JWT, claves, textos personales ni arrays de elecciones. Redactar identificadores y payloads de proveedor. Métricas: fallos de confirmación, tiempo de locks, jobs pendientes/fallidos, latencia de ingesta, validación de borradores y retiradas.

`GET /api/health/live` comprueba proceso; `GET /api/health/ready` comprueba conexión mínima y versión de esquema, sin imprimir credenciales. La salud del worker y del proveedor IA se reporta separada; que IA no esté disponible no debe impedir leer noticias publicadas.

Backup local antes de migración destructiva y periódicamente si hay trabajo editorial que conservar. Registrar procedimiento y prueba de restauración de base, Auth y Storage; una carpeta Docker copiada sin consistencia no es un backup verificado. Las migraciones no contienen secretos y toda transformación destructiva requiere copia y plan de reversión.

## 23 Migraciones y evolución del esquema

Secuencia propuesta:

1. Identidad del dominio, roles, ocho personajes, categorías y assets.
2. Fuentes, candidatos, eventos, artículos, revisiones, opiniones y referencias.
3. Estados por usuario/noticia, participaciones, choices y funciones transaccionales.
4. Permisos/RLS, API expuesta y pruebas de autorización. Las tablas no se exponen antes de esta protección.
5. Resultados y tendencias con fórmula versionada y fixtures numéricos.
6. Trabajos, notificaciones, preferencias, bajas y funciones del worker.
7. Catálogos/etiquetas propuestas con flag y controles de validación.

La numeración exacta y timestamps se fijan al crear migraciones. No editar migraciones ya aplicadas en entornos compartidos; añadir otra. No aplicar DDL manual en Studio como fuente definitiva. Revisar SQL generado por herramientas, no aceptarlo a ciegas.

Cada versión de app declara versión mínima/máxima de esquema compatible. Estrategia expandir → desplegar código compatible → migrar datos → retirar campos. Rollback de app no implica rollback automático del esquema. Los tipos TypeScript se generan desde el esquema local y se revisan/versionan. La documentación oficial describe el flujo de CLI/migraciones; la disciplina de compatibilidad anterior es una decisión del proyecto. [S19](https://supabase.com/docs/guides/local-development/cli-workflows)

## 24 Preparación del paso a servidor

### 24.1 Lo que permanece

Módulos de dominio, contratos API, migraciones, fixtures, funciones transaccionales, revisión editorial, pruebas y worker. Cambian orígenes, claves, callbacks, almacenamiento, transportes y operación. No reemplazar Supabase por una base distinta solo para alojar: Auth, RPC y Storage son dependencias explícitas que hay que desplegar o contratar.

### 24.2 Caminos admitidos

| Opción posterior | Composición | Qué evaluar al elegir |
|---|---|---|
| Servidor propio | Next.js + worker + Supabase self-hosted de producción + proxy TLS | Operación, actualizaciones, backups, correo, secretos y seguridad de todos los servicios |
| Infraestructura administrada | Next.js/worker alojados + Supabase administrado | Coste, región, portabilidad, límites y conexión de servicios |

No se elige proveedor en esta entrega. **Nunca publicar la instalación `supabase start` del equipo como servidor de producción.** La configuración de desarrollo y la instalación self-hosted de producción tienen finalidades distintas. Para self-hosting existen instrucciones oficiales con Docker, HTTPS y correo real. [S20](https://supabase.com/docs/guides/self-hosting/docker)

### 24.3 Artefacto de aplicación

Probar `npm run build` y `npm run start` localmente. Preparar imagen multi-stage Node.js con usuario sin privilegios, lockfile, comprobación de salud y `output: "standalone"`; copiar además assets públicos y estáticos requeridos. Compilar el worker como otro comando de la misma imagen/código o artefacto equivalente. No ejecutar migraciones destructivas al arrancar cada réplica. [S21](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)

Proxy inverso termina HTTPS y enruta al servidor de aplicación; Supabase mantiene sus URLs públicas/internas correctas. Conservar IP cliente solo desde proxies confiables. Cookies, CORS, CSP, orígenes y callbacks se configuran por entorno. Si hay varias réplicas, los jobs se coordinan mediante la base y los límites no dependen de memoria por proceso.

### 24.4 Migración de datos

Crear un staging vacío, aplicar migraciones y cargar fixtures sanitizados. No llevar usuarios/contraseñas seeded a producción. Importar personajes, categorías, assets y contenido editorial validado por un proceso versionado y con hashes; los votos de prueba nunca se convierten en resultados reales.

Si se decide conservar cuentas locales reales, tratarlo como proyecto de migración de Auth/Storage además de PostgreSQL: exportación segura, claves, identidades, archivos, compatibilidad y restauración de prueba. No prometer que `db push` migra usuarios, secretos, configuración OAuth y archivos. Para el MVP local inicial se usarán cuentas ficticias, por lo que el primer entorno público parte con usuarios nuevos.

### 24.5 Checklist antes de usuarios externos

- Staging y producción separados; secretos diferentes; sin Studio ni puertos de base públicos.
- TLS, dominio y callbacks probados; correo de producción, recuperación y vinculación Google/Apple verificadas.
- Backup y restauración de todos los componentes; runbook de retirada, incidente y supresión.
- Migraciones ensayadas; build/seguridad/pruebas críticas en verde.
- Fórmulas y copy validados; catálogo de aspectos validado o desactivado explícitamente sin cifras ficticias.
- Retratos/recursos conciliados y derechos de uso revisados.
- Política de privacidad, consentimiento, borrado y retención revisados para las jurisdicciones de lanzamiento.
- Push probado en dispositivos objetivo; monitoreo de jobs y alertas de errores reales.
- Protección de abuso, revisión de dependencias y límites calibrados con carga.

## 25 Plan de implementación y entregas

| Fase | Entrega verificable | Criterio de salida |
|---|---|---|
| 0 Base | Repositorio, app, dependencias fijadas, Docker/CLI local y scripts | Web y backend arrancan; esquema reconstruible; sin secretos en Git |
| 1 Dominio | Modelo SQL, seeds, roles y RPC de participación | Restricciones, autorización y concurrencia probadas |
| 2 Editorial mínimo | Carga manual, revisión, publicación y retirada | No publica sin ocho opiniones, referencias y aprobación humana |
| 3 Recorrido lector | Feed, noticia, ficha, ampliada, Auth, elegir/Ninguna/omitir | Borradores y transiciones completas con errores recuperables |
| 4 Resultados | Umbral, apoyo por voz, actividad, tendencias y tarjeta | Casos 9/10, Ninguna y privacidad pasan; métricas avanzadas versionadas |
| 5 Operación asistida | Worker, fuentes, agrupación y generación revisable | Ingesta automatizada no publica sola; fallos/reintentos trazables |
| 6 Cierre local | Baja/recuperación/purga, agenda de notificaciones y QA | Build local de producción, accesibilidad y matriz crítica en verde |
| 7 Preparación remota | Staging, integraciones externas y operación | Puertas de producción cumplidas antes de usuarios reales |

Primera demostración funcional: un editor publica una noticia; un visitante elige y autentica; confirma una sola vez o elige Ninguna; otra cuenta omite; las pruebas cambian N de 9 a 10 y verifican el bloqueo al acceder a completos. La fase se demuestra con base real local, no solo con mocks de UI.

Las métricas avanzadas no validadas y las integraciones externas no bloquean construir esa demostración, pero sí impiden declarar terminadas las funcionalidades correspondientes del MVP. No presentar el uso de fixtures como integración real completada.

### 25.1 Revisión del usuario entre zonas

La implementación se realiza por zonas o funcionalidades demostrables. Cada fase puede dividirse en varias zonas pequeñas; una fase no autoriza construir todas sus funciones antes de ofrecer revisión. Antes de iniciar una zona se comunica su alcance, qué podrá probarse y los criterios de aceptación.

Al cerrar cada zona, completar sus pruebas y preparar una versión local reproducible. La entrega de revisión incluye:

1. Qué comportamiento se terminó y qué queda fuera de esa entrega.
2. Dirección local o pasos exactos de arranque y acceso, con datos de prueba ficticios cuando sean necesarios.
3. Un recorrido breve para comprobar el caso principal y los errores relevantes.
4. Comprobaciones realizadas y problemas conocidos, distinguiendo fallos graves de observaciones menores.
5. La siguiente zona propuesta, sin comenzar a implementarla todavía.

**Punto de parada obligatorio por instrucción del usuario:** esperar su revisión y conformidad antes de avanzar a la siguiente zona. El silencio no equivale a aprobación. No adelantar la siguiente funcionalidad en segundo plano mientras se espera.

Si la revisión encuentra un error grave —pérdida o exposición de datos, permisos incorrectos, incumplimiento de una regla central o recorrido principal inutilizable— se corrige en la zona actual, se repiten las pruebas afectadas y se vuelve a presentar. Las observaciones menores se registran y solo se difieren si el usuario acepta hacerlo.

Durante el cierre de la zona se pueden completar correcciones, pruebas y documentación sin pedir autorización por cada cambio individual. La conformidad permite iniciar la siguiente zona acordada; las revisiones posteriores siguen siendo obligatorias.

Mantener un registro de avance con zona, alcance, estado, pruebas, observaciones, decisión de revisión y siguiente paso. Estados: en desarrollo, lista para revisión, requiere correcciones y aprobada. No marcar una zona como aprobada sin evidencia de la conformidad del usuario.

## 26 Trazabilidad funcional y técnica

| Decisiones internas | Módulos y pruebas de esta versión |
|---|---|
| 001–013 participación y resultados | Secciones 8, 10, 11 y matriz de concurrencia/umbral |
| 014–019 actividad y privacidad | Secciones 9, 11.4, 12 y 19 |
| 020–026 cuenta y preferencias | Secciones 6, 9, 12.2 y 20 |
| 027–031 notificaciones | Secciones 17 y 18 |
| 032–045 editorial, canon y lectura | Secciones 7, 12, 15 y 16 |
| 046–047 sin fotos noticiosas | Secciones 1, 13 y validación editorial |
| 048–053 interacción y recuperación | Secciones 8 y 12 |
| 054–057 retirada y agrupación | Secciones 8, 15 y 16 |
| 058–067 feed, categorías y fichas | Secciones 7, 12 y 13 |
| 068 y 069 diferida | Sección 13; manifiesto visual y validación pendiente |
| 070–075 recogidas en PDF técnico V1 | Secciones 3–6, 9, 15 y 24 |

T01–T15 precisan ingeniería y no renumeran estas decisiones funcionales. Cualquier discrepancia futura se registra antes de alterar código y se acompaña de fixture de aceptación.

## 27 Definición de listo y condiciones pendientes

La guía complementaria `Riuya_Guia_de_Implementacion_y_Revision_V1_2026-11-08.md` divide las fases en zonas revisables, precisa los artefactos ejecutables que se producirán al implementar y proporciona fixtures y criterios de revisión independiente. No establece una asignación permanente de modelos; el usuario decide qué modelo utiliza en cada etapa.

**Listo para empezar:** este contrato técnico, versiones resueltas, herramientas locales operativas, seed ficticio y primer esquema/roles revisados. No hace falta elegir hosting ni aprobar todas las animaciones para iniciar migraciones y recorrido vertical.

**Listo como MVP local:** todas las funciones de alcance implementadas con la base local; controles de cuenta/roles/retirada; matriz crítica y build aprobados; ingesta/agrupación/IA supervisada funcional; métricas no validadas identificadas y sin datos inventados. Los transportes externos simulados se declaran como tales.

**Listo para servidor y público:** además del MVP local, condiciones de la sección 24.5. Las validaciones editoriales/jurídicas y las credenciales reales no pueden fabricarse en un documento técnico.

Pendientes legítimos que no se dan por resueltos: conciliación visual de retratos; validación editorial del catálogo y significado de coincidencia; jurisdicción y retención; credenciales Google/Apple/SMTP/push; benchmark del modelo en el hardware disponible; elección posterior de infraestructura. La solución técnica para cada uno está definida y tiene un punto de validación; no se deja su comportamiento a improvisación durante programación.

## 28 Referencias oficiales y mantenimiento

Consulta realizada el 8 de noviembre de 2026. Los enlaces documentan capacidades y procedimientos de las herramientas. Las fórmulas, límites, arquitectura, contratos y objetivos de rendimiento de Riuya son decisiones de diseño de esta especificación, no promesas de esos proveedores.

| Ref | Fuente oficial |
|---|---|
| S01 | [Next.js Installation](https://nextjs.org/docs/app/getting-started/installation) |
| S02 | [Supabase CLI y ejecución local](https://supabase.com/docs/guides/local-development/cli/getting-started) |
| S03 | [Supabase SSR para Next.js](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs) |
| S04 | [Ciclo de versiones de Node.js](https://nodejs.org/en/about/previous-releases) |
| S05 | [Configuración y secretos locales](https://supabase.com/docs/guides/local-development/managing-config) |
| S06 | [Referencia de CLI y reset de base](https://supabase.com/docs/reference/cli/supabase-db-reset) |
| S07 | [Bloqueos explícitos de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html) |
| S08 | [Vinculación de identidades Supabase](https://supabase.com/docs/guides/auth/auth-identity-linking) |
| S09 | [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) |
| S10 | [Funciones de base de datos](https://supabase.com/docs/guides/database/functions) |
| S11 | [PWA con Next.js](https://nextjs.org/docs/app/guides/progressive-web-apps) |
| S12 | [Self-hosting de Next.js](https://nextjs.org/docs/app/guides/self-hosting) |
| S13 | [Modelo Qwen3 8B en Ollama](https://ollama.com/library/qwen3:8b) |
| S14 | [Salidas estructuradas de Ollama](https://docs.ollama.com/capabilities/structured-outputs) |
| S15 | [Gestión de usuarios Supabase](https://supabase.com/docs/guides/auth/managing-user-data) |
| S16 | [Vitest](https://vitest.dev/guide/) |
| S17 | [Pruebas de base de datos](https://supabase.com/docs/guides/database/testing) |
| S18 | [Playwright](https://playwright.dev/docs/intro) |
| S19 | [Flujo local de CLI y migraciones](https://supabase.com/docs/guides/local-development/cli-workflows) |
| S20 | [Supabase self-hosted con Docker](https://supabase.com/docs/guides/self-hosting/docker) |
| S21 | [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) |
| S22 | [Zod](https://zod.dev/) |
| S23 | [Tailwind CSS con Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs) |

Actualizar versiones después de revisar cambios y repetir pruebas. Mantener este Markdown como fuente del documento HTML; no editar ambas representaciones de forma independiente. Cuando se implemente, mover una copia versionada a `docs/` y enlazar desde la biblioteca de Riuya.

**Control de cambios V2.0:** consolida decisiones 070–075; define acceso atómico a resultados y concurrencia; completa modelo/API/fórmulas; añade worker, generación local, baja, notificaciones y pruebas; establece la separación entre desarrollo local y alojamiento productivo. No instala, despliega ni ejecuta la aplicación.

**Control de cambios V2.1:** incorpora la revisión obligatoria del usuario al completar cada zona, la corrección de errores graves y la espera de conformidad antes de comenzar la siguiente funcionalidad.

**Control de cambios V2.2:** añade la guía de implementación y revisión, las zonas Z00–Z12, los contratos verificables a producir, fixtures numéricos y pruebas de concurrencia, gravedad de hallazgos e instrucciones reutilizables para intercambiar el trabajo entre etapas sin depender de un modelo concreto.
