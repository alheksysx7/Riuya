# Riuya Guía de implementación y revisión por funcionalidades

**Versión 1.0 · 8 de noviembre de 2026**

Esta guía convierte la especificación técnica V2.2 en entregas pequeñas y verificables. Una persona o agente implementa la zona acordada; otra revisión contrasta el código, el comportamiento y las pruebas con los requisitos. El usuario decide qué modelo utiliza en cada etapa y conserva la decisión de avanzar.

No inicia la implementación ni asigna modelos de forma permanente. Complementa el documento técnico; no reemplaza las reglas de producto, las fuentes editoriales ni los puntos de revisión del usuario.

## 1 Qué debe recibir quien implementa

Antes de empezar una zona, leer `AGENTS.md`, la especificación técnica Markdown V2.2 y las secciones pertinentes de las fuentes. Entregar un paquete de trabajo con:

- Identificador de zona, objetivo y dependencias que ya están disponibles.
- Alcance incluido y exclusiones explícitas para esa entrega.
- Requisitos y criterios de aceptación numerados.
- Contratos de entrada, salida, errores y permisos afectados.
- Fixtures y resultados esperados, incluyendo el caso negativo relevante.
- Comandos para arrancar, probar y reproducir la demostración local.
- Decisiones ya fijadas, elecciones de ingeniería permitidas y asuntos que requieren revisión del usuario.

El paquete puede escribirse en `docs/entregas/ZXX.md` durante la implementación. No crear una especificación distinta por cada modelo ni basar reglas en recuerdos de otro chat.

## 2 Qué está definido y qué no se debe inventar

| Categoría | Tratamiento |
|---|---|
| Regla funcional aprobada | Implementarla y probarla; no sustituirla por lo que muestra una maqueta antigua |
| Definición técnica V2.2 | Usarla como contrato; proponer una ADR si se necesita cambiar arquitectura o semántica |
| Detalle interno sin impacto externo | Resolver con criterio y documentar lo necesario, sin pedir permiso por cada nombre de variable o componente |
| Contrato incompleto que cambia comportamiento | Registrar la ambigüedad y resolverla antes de cerrar esa función; no inventar silenciosamente el resultado |
| Métrica propuesta o material pendiente de validación editorial | Implementar detrás del control previsto; no publicarlo como validado |
| Credencial o integración no disponible | Mantener el simulador identificado y registrar que la integración real no está verificada |

La revisión distingue si el fallo está en el código o en un contrato contradictorio. Una prueba que copia una implementación equivocada no convierte esa conducta en requisito correcto.

## 3 Secuencia de zonas para construir y revisar

Las fases de la especificación se dividen en las siguientes zonas. No se implementan todas de una vez. El usuario puede ajustar el orden según dependencias; la zona siguiente no se adelanta mientras espera revisión.

| Zona | Resultado revisable | Criterios mínimos de aceptación | Dependencia |
|---|---|---|---|
| Z00 Base local | Web mínima, servicios locales y diagnóstico reproducible | Arranque documentado; versiones fijadas; base accesible; ningún secreto versionado; sin reset automático | Ninguna |
| Z01 Datos y permisos | Migraciones y seed con ocho voces/seis categorías/roles | Reconstrucción de base desechable; restricciones; pruebas de acceso permitidas y denegadas; acceso directo a tablas privadas cerrado | Z00 |
| Z02 Publicación editorial manual | Crear, revisar, publicar y retirar una noticia completa | No publica con 7/9 opiniones; exige revisión humana; control de versión; retirada oculta contenido en rutas de lector | Z01 |
| Z03 Lectura y fichas | Feed 10+10, filtros, noticia, ampliada y panel de personaje | Orden/cursor; ocho opiniones; scroll/foco conservados; sin búsqueda ni fotos noticiosas; estados vacío/error | Z02 |
| Z04 Cuenta y borradores | Login correo, recuperación, sesión y retorno con selección | Identidad verificada; borrador restaurado sin confirmar; logout limpia datos; ninguna fuga entre cuentas | Z03 |
| Z05 Participación | Me gusta, Ninguna, omitir y confirmación atómica | Exclusividad; irreversible; idempotencia; concurrencia; errores recuperables; cuenta requerida | Z04 |
| Z06 Resultados básicos | Acceso explícito, preliminares/completos y bloqueo de omitidas | Casos N=0/1/9/10; ninguna popularidad oculta; carrera acceso/confirmar serializada; sin precarga con efectos | Z05 |
| Z07 Actividad y tendencias | Historial propio y últimas 20 frente al total | Denominadores; Ninguna incluida; omisiones fuera de tendencias; retiradas ocultas; orden de actividad estable | Z06 |
| Z08 Métricas y tarjeta | Coincidencia/aspectos controlados y arte compartible | Fórmulas versionadas; flags y validación; privacidad del arte; formato sin métricas inventadas; fallback de descarga | Z06–Z07 |
| Z09 Worker y editorial asistida | Trabajos persistentes, fuentes, agrupación e IA revisable | Reanudación/idempotencia; protección de fetch; citas válidas; ninguna publicación automática; fixtures separados de integración | Z02 y base de jobs |
| Z10 Preferencias y notificaciones | Agenda por canal y transporte local verificable | Zona IANA; deduplicación; máximo diario; opt-in; reloj simulado; no afirmar push real con un capturador local | Z04 y worker |
| Z11 Baja y recuperación | Desactivar, recuperar y purgar con trabajos reanudables | JWT previo sin acceso; siete días; carrera recuperación/purga; recalcular N; no recuperar datos purgados al restaurar | Z04–Z10 según datos creados |
| Z12 Cierre local y preparación de servidor | Build local productivo y expediente de salida | Recorridos críticos, accesibilidad, privacidad de caché, restauración y configuración de despliegue ensayadas | Z00–Z11 |

Estas zonas precisan el orden de revisión, no autorizan recortar funciones del MVP. Google/Apple, transporte push y otros servicios externos tienen una comprobación de integración específica antes de lanzamiento. Un formulario de login local no acredita que los tres proveedores ya funcionen.

## 4 Contratos ejecutables antes de cerrar cada zona

La especificación explica el comportamiento. Al implementar, se convierte en artefactos versionados que permiten revisión independiente:

| Artefacto | Contenido exigido | Cuándo |
|---|---|---|
| `docs/versions.md` | Resoluciones exactas, compatibilidad, fecha y commit; sin afirmar versiones instaladas si no se comprobaron | Z00 |
| Migraciones SQL | Tipos, nulabilidad, defaults, FK y acciones de borrado, checks, índices, grants/RLS y funciones | Z01 y cada cambio de esquema |
| `docs/data-dictionary.md` | Campo, tipo, sentido, fuente de autoridad, sensibilidad, retención y restricciones; coincide con SQL | Desde Z01 |
| Schemas de validación | Entradas y DTO de salida de cada caso de uso; rechazan combinaciones inválidas | Cada endpoint nuevo |
| `docs/api/openapi.yaml` | Rutas, autenticación, schemas, errores y ejemplos compatibles con los validadores | Cada zona con API |
| Fixtures de dominio | Datos válidos/negativos y resultados esperados, sin PII real | Cada zona de reglas |
| Pruebas SQL/integración | Comportamiento real de transacciones y permisos, no solo mocks | Datos, roles y participación |
| `docs/entregas/ZXX.md` | Alcance, implementación, pruebas, reproducción y limitaciones | Cada entrega |
| `docs/revisiones/ZXX.md` | Hallazgos, evidencia, correcciones y estado técnico | Cada revisión |
| `docs/avance.md` | Estado de zonas y decisión del usuario, sin aprobaciones ficticias | Desde Z00 |

Estos archivos son salidas de implementación; no se presentan como existentes hoy. No escribir un OpenAPI que prometa campos distintos de los que devuelve el código. El revisor compara ambos y ejecuta al menos el recorrido crítico y sus rechazos.

## 5 Fixtures numéricos de referencia

### 5.1 Umbral y multiselección

Usar una noticia con diez participantes confirmados distintos:

| Participante ficticio | Selección |
|---|---|
| U01 | Rami y Beatriz |
| U02 | Rami y Beatriz |
| U03 | Rami y Beatriz |
| U04 | Rami y Beatriz |
| U05 | Rami y Beatriz |
| U06 | Rami |
| U07 | Rami |
| U08 | Leo |
| U09 | Ninguna |
| U10 | Ninguna |

N=10. Rami 70 %, Beatriz 50 %, Leo 10 %, Ninguna 20 % y el resto 0 %. La suma es 150 % y no debe normalizarse a 100. Agregar una omisión no cambia N. Con solo U01–U09, N=9 y no se entregan porcentajes ni ranking al lector, tampoco ocultos en payload o HTML.

### 5.2 Coincidencia propuesta

Según T07, para U01 hay cuatro coincidencias 1, dos coincidencias 0,5 y tres coincidencias 0: `100 × 5/9 = 55,6 %` tras redondear una cifra. Para U09, solo U10 coincide: `100 × 1/9 = 11,1 %`. Nunca comparar al usuario consigo mismo. La prueba acredita el cálculo del contrato; no sustituye la validación de su interpretación y de la UX antes de habilitar la métrica.

### 5.3 Aspectos y cobertura

Un usuario elige dos opiniones. Una contiene Indignación 70 % y Esperanza 30 %; la otra no tiene emoción clasificada. Contribuciones 0,35 y 0,15; masa clasificada M=0,5; distribución personal 70/30 y cobertura 50 %. No adjudicar emoción a la segunda opinión ni tratar el 50 % ausente como neutralidad medida.

N=10 no basta para exponer distribución comunitaria de aspectos si solo ocho usuarios aportan evidencia en la dimensión; se mantiene sin datos suficientes para ese agregado. Ninguna sí cuenta en el denominador de apoyo por voz, aunque no aporte evidencia emocional.

## 6 Pruebas de carreras y recuperación

Las pruebas concurrentes usan la base local real, dos conexiones/sesiones y coordinación para provocar el solapamiento. Dos llamadas secuenciales no prueban una carrera.

| Escenario | Resultados admitidos | Resultado prohibido |
|---|---|---|
| Dos confirmaciones simultáneas | Una confirmación persistida; la otra recupera/conflicta sin alterar elecciones | Dos respuestas o combinación de ambos payloads |
| Confirmar frente a acceso a completos en omitida | Si gana confirmar, queda confirmada; si gana acceso, queda omitida bloqueada | Ambos flujos permiten después cambiar la respuesta |
| Mismo operationId con payload idéntico | Mismo recibo lógico y cero escrituras duplicadas | Otro voto o timestamp de confirmación nuevo |
| Mismo operationId con payload distinto | Conflicto sin mutación | Sobrescritura del voto anterior |
| Timeout después del commit | Consulta de estado devuelve la confirmación guardada | Declarar fallo definitivo y aceptar otra elección incompatible |
| Retirada frente a confirmar | La operación que obtiene primero el bloqueo ordena el resultado; después de retirar no se admiten nuevos accesos | Contenido visible o confirmación nueva que ignora la retirada ya confirmada |
| Dos workers y un trabajo | Lease coherente e idempotencia del efecto | Doble publicación o doble efecto de negocio |
| Recuperación frente a purga | Una transición coherente según estado y plazo, sin purga de cuenta recuperada | Cuenta activa con datos borrados por una tarea desactualizada |

Después de cada prueba comprobar filas persistidas, estado y respuesta HTTP, no solo el mensaje visual. Forzar también reconexión, reinicio del worker y reloj simulado cuando aplique. No simular el paso de siete días cambiando manualmente datos de una cuenta real.

## 7 Método de revisión independiente

1. Leer el paquete de zona y los requisitos antes del resumen de quien implementó.
2. Identificar el diff y los archivos que realmente cambian el comportamiento, incluidas migraciones, permisos y configuración.
3. Seguir al menos un recorrido completo: interfaz → API → autorización → RPC/SQL → persistencia → respuesta.
4. Ejecutar la demostración local y los casos negativos pertinentes; registrar comandos y resultados. Una dependencia ausente es una comprobación no realizada, no un aprobado.
5. Intentar el acceso alternativo relevante: API directa, rol incorrecto, usuario ajeno, artículo retirado, payload manipulado o carrera entre sesiones.
6. Revisar que las pruebas comprueben requisitos observables y fallen ante el defecto que pretenden evitar.
7. Comparar código con schemas/OpenAPI, diccionario de datos y reglas funcionales.
8. Informar hallazgos accionables, con archivo/línea cuando esté disponible, reproducción e impacto. Diferenciar bug demostrado, riesgo pendiente de comprobar y preferencia de estilo.
9. Si hubo correcciones, revisar el nuevo diff y repetir las pruebas afectadas. Referirse al estado exacto del código revisado.

El modelo que revise no debe dar por buena una afirmación porque la escribió otro modelo ni reescribir toda la zona por preferencia personal. La revisión técnica puede recomendar cambios; el usuario decide si acepta la entrega y avanza.

## 8 Gravedad y cierre de hallazgos

| Nivel | Ejemplo | Tratamiento |
|---|---|---|
| P0 Crítico | Exposición de secretos, pérdida amplia de datos o bypass grave de acceso | Detener entrega afectada, corregir y volver a revisar |
| P1 Grave | Doble voto, resultados antes del umbral, datos ajenos accesibles o recorrido principal roto | No dar por cerrada la zona; corregir y reproducir prueba de regresión |
| P2 Relevante | Caso secundario incorrecto, accesibilidad o recuperación defectuosa sin fallo crítico | Corregir o registrar diferimiento aceptado por el usuario; no ignorarlo |
| P3 Menor | Ajuste visual/textual o mantenibilidad sin impacto funcional material | Registrar y priorizar con el usuario |

Un hallazgo incluye severidad, condición de activación, comportamiento observado/esperado y evidencia. No marcar «corregido» solo porque se añadió una línea: demostrar el resultado. No etiquetar una opinión de estilo como error grave.

La revisión técnica usa veredictos «requiere correcciones», «sin bloqueos técnicos detectados» o «revisión incompleta por bloqueo». «Sin bloqueos detectados» no garantiza ausencia de errores y no equivale a aprobación del usuario.

## 9 Entrega para revisión del usuario

Plantilla breve que debe acompañar cada zona:

```text
Zona y estado:
Objetivo completado:
Versión del código revisable (commit o diff identificado):
Cómo arrancar y acceder localmente:
Datos de prueba ficticios:
Recorrido de prueba en 3 a 6 pasos:
Pruebas ejecutadas y resultado:
Pruebas no ejecutadas y motivo:
Hallazgos P0/P1 pendientes:
Observaciones menores y diferimientos propuestos:
Siguiente zona propuesta:
Estado: esperando revisión del usuario; no se inicia la siguiente zona.
```

No pedir al usuario contraseñas de producción para comprobar una zona local. Si hay cuentas de prueba, crearlas solo en el entorno de desarrollo y documentar su uso de forma segura. No registrar secretos en el expediente de revisión.

## 10 Instrucciones reutilizables para cada etapa

### 10.1 Para implementar una zona

> Lee AGENTS.md, la especificación técnica V2.2 y el paquete de la zona indicada. Implementa únicamente esa zona y las dependencias necesarias dentro de su alcance. Conserva las reglas de producto y los contratos. Si detectas una contradicción que cambie comportamiento, identifícala antes de inventar una solución. Ejecuta las pruebas pertinentes, prepara una demostración local y entrega evidencia, limitaciones y diff. No avances a la siguiente zona: espera la revisión del usuario.

### 10.2 Para revisar una zona

> Revisa de forma independiente la zona indicada contra AGENTS.md, la especificación técnica V2.2 y sus criterios de aceptación. Inspecciona el código y las migraciones reales; ejecuta los recorridos y pruebas pertinentes. Prioriza permisos, integridad de datos, concurrencia y reglas de producto. Entrega hallazgos reproducibles con gravedad y ubicación, distingue lo verificado de lo no comprobado y no atribuyas aprobación al usuario. Si no hay bloqueos demostrados, informa «sin bloqueos técnicos detectados» e indica los límites de la revisión.

### 10.3 Para corregir hallazgos

> Corrige los hallazgos acordados de la zona actual, sin ampliar el alcance. Añade o ajusta pruebas de regresión que demuestren el fallo y su corrección. Presenta el diff y vuelve a entregar la zona para revisión. No inicies la siguiente funcionalidad mientras no exista conformidad del usuario.

Estas instrucciones sirven para el modelo que el usuario elija en cada momento. La documentación compartida y la evidencia son el mecanismo de continuidad entre etapas.

## 11 Estado inicial y siguientes acciones

Esta entrega solo prepara documentación. No hay zonas implementadas o aprobadas por este documento. Cuando el usuario decida comenzar, crear el paquete Z00, comprobar el entorno y trabajar únicamente en la base local. Al terminar se revisa Z00 antes de abrir Z01.

La calidad se controla con contratos, pruebas y revisión independiente; el nombre del modelo no sustituye ninguna de esas condiciones.
