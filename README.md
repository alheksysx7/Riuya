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
- Panel editorial: http://127.0.0.1:3102/admin
- Buzón local: http://127.0.0.1:54324/
- Supabase Studio: http://127.0.0.1:54323/

El archivo `.env.local` contiene la configuración del entorno local y no se debe compartir. Las cuentas y datos de simulación solo son para pruebas locales.
