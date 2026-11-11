# Riuya · entorno local

Abre Docker Desktop y espera a que esté listo. En PowerShell, desde esta carpeta:

```powershell
cd C:\Users\LINKX7\Documents\ChatGPT\Riuya\app
npm run pruebas
```

El comando comprueba Docker, selecciona Node según `.node-version` (incluida la versión instalada con NVM para Windows), inicia Supabase si es necesario y arranca la aplicación en http://127.0.0.1:3102/. Si Riuya ya está ejecutándose, informa de ello. La versión 24.22.1 está instalada en NVM para Windows. Si usas otra instalación, selecciona la versión indicada en `.node-version` o define `RIUYA_NODE` con la ruta completa a su ejecutable. El proyecto no modifica la instalación global de Node.

Deja PowerShell abierto durante las pruebas. Pulsa Ctrl+C para detener la aplicación; los datos locales de Supabase se conservan. El comando no reinicia ni borra la base.

- Aplicación: http://127.0.0.1:3102/
- Mi actividad: http://127.0.0.1:3102/actividad
- Preferencias de avisos: http://127.0.0.1:3102/preferencias
- Panel editorial: http://127.0.0.1:3102/admin
- Buzón local: http://127.0.0.1:54324/
- Supabase Studio: http://127.0.0.1:54323/

El archivo `.env.local` contiene la configuración del entorno local y no se debe compartir. Las cuentas y datos de simulación solo son para pruebas locales.


## Worker editorial local

Con Docker y Supabase iniciados, abre otra terminal en esta carpeta:

    npm run worker:local

Si falta la credencial local del worker, ejecuta primero una vez:

    npm run worker:setup

El worker usa un rol limitado y selecciona Node 24.22.1 con NVM o RIUYA_NODE. Mantén abierta esa terminal; Ctrl+C lo detiene. En /admin se pueden crear propuestas ficticias y consultar fuentes verificadas. No hay publicación automática.

Las fuentes admitidas son RSS, Atom y JSON Feed; solo se aceptan direcciones IPv4 públicas y enlaces al mismo dominio del feed. Por defecto se consulta una fuente como máximo cada 30 minutos; no se guardan artículos completos. No incluyas credenciales en URLs.

Ollama es opcional para la demostración ficticia. Para generación real debe estar ejecutándose en 127.0.0.1:11434 y disponer del modelo local configurado; el valor predeterminado es qwen3:8b. RIUYA_OLLAMA_MODEL permite seleccionar otro modelo instalado. La generación recibe solo título y metadatos de la fuente; una persona debe verificar y completar los hechos. El umbral de agrupación puede configurarse con RIUYA_CLUSTER_THRESHOLD (0 a 1; predeterminado 0.5) y RIUYA_CLUSTER_DAYS (hasta 30; predeterminado 3).

## Avisos locales

Los canales de noticias y resultados son opcionales e independientes. La agenda se ejecuta mientras el worker local está activo. El transporte actual únicamente registra entregas de prueba en Preferencias; no envía push al navegador ni al móvil.
