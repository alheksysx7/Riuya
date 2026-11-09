# Forma de trabajo de Riuya

## Documentación para implementar y revisar

- Leer la especificación técnica vigente en `outputs/Riuya_Especificacion_Tecnica_MVP_V2_2026-11-08.md` y la guía de trabajo en `outputs/Riuya_Guia_de_Implementacion_y_Revision_V1_2026-11-08.md` antes de implementar o revisar una zona.
- No asignar modelos de forma permanente: el usuario elige el modelo en cada etapa. Las obligaciones de implementación y revisión se mantienen independientemente del modelo.
- Convertir los contratos de cada zona en schemas, migraciones y pruebas verificables durante su implementación. No presentar las recomendaciones pendientes de validación como aprobaciones históricas.
- La revisión técnica debe inspeccionar el código y verificar evidencia; no aceptar únicamente el resumen de quien implementó. Distinguir hallazgos demostrados, pruebas no realizadas y preferencias de estilo.
- El veredicto técnico no reemplaza la conformidad del usuario para avanzar.

## Revisión del usuario entre funcionalidades

El usuario requiere implementar el MVP por zonas o funcionalidades y tener un espacio de revisión al completar cada una.

- Antes de implementar una zona, indicar su alcance, el resultado que podrá probarse y los criterios de aceptación. Evitar agrupar todo el MVP en una sola entrega.
- Completar la zona actual, ejecutar las comprobaciones pertinentes y preparar una demostración local reproducible.
- Entregar al usuario el acceso o los pasos exactos para probarla, qué se completó, qué se comprobó y los problemas o limitaciones conocidos.
- Detener el avance y esperar la revisión del usuario. No comenzar ni adelantar en segundo plano la siguiente zona sin su conformidad explícita o una instrucción equivalente de continuar.
- Corregir los errores graves de la zona revisada y volver a presentarla antes de pasar a la siguiente. Un error grave incluye pérdida o exposición de datos, permisos incorrectos, incumplimiento de una regla central o un recorrido principal inutilizable.
- Registrar las observaciones menores. Solo diferirlas a otra entrega si el usuario acepta esa decisión; no interpretar el silencio como aceptación.
- Las correcciones, pruebas y documentación necesarias para cerrar la zona actual están autorizadas dentro de ese alcance. No pedir aprobación para cada edición o comprobación individual.
- Una aprobación aplica a la zona revisada y permite comenzar la siguiente acordada; no elimina los puntos de revisión posteriores. Respetar cualquier cambio explícito que el usuario haga a este procedimiento.

Mantener un registro breve de zonas con su estado: en desarrollo, lista para revisión, requiere correcciones o aprobada. Registrar evidencia de la revisión y no atribuir aprobaciones que no existan en la conversación.
