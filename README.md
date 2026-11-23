# EntradasYa · checkin

Validación mediante tickets y registro de un único ingreso por entrada.

Proyecto independiente con TypeScript, Node.js **24.20.0** y Express. No necesita archivos, paquetes privados ni clones de otros repositorios para instalarse o verificarse.

## Requisitos

Node.js de `.nvmrc` con npm. En Windows usa **Ubuntu en WSL2**: `wsl --install -d Ubuntu` desde PowerShell como administrador, reinicia si lo solicita y clona dentro de `~/proyectos/`. Los comandos siguientes se ejecutan desde la raíz de este repositorio en Ubuntu o Linux. Instala Node.js 24 con tu gestor de versiones habitual.

Instala PostgreSQL en Ubuntu con `sudo apt-get update && sudo apt-get install -y postgresql postgresql-client`. En WSL, si está detenido: `sudo service postgresql start`. Puede utilizarse un único servidor PostgreSQL para los seis servicios, con bases y roles separados.

## Preparación

```bash
npm ci
cp .env.example .env
```

Edita `.env` y reemplaza cada `REEMPLAZAR`. Las variables del proceso tienen prioridad sobre `.env`. Nunca publiques credenciales. Variables de este servicio:

- `HOST`: consulta el valor de referencia en `.env.example`.
- `PORT`: consulta el valor de referencia en `.env.example`.
- `LOG_LEVEL`: consulta el valor de referencia en `.env.example`.
- `DATABASE_URL`: consulta el valor de referencia en `.env.example`.
- `JWT_SECRET`: consulta el valor de referencia en `.env.example`.
- `TICKETS_URL`: consulta el valor de referencia en `.env.example`.
- `TICKETS_CHECKIN_TOKEN`: consulta el valor de referencia en `.env.example`.
- `HTTP_TIMEOUT_MS`: consulta el valor de referencia en `.env.example`.

`JWT_SECRET` debe coincidir con el configurado en auth para los servicios que validan JWT. Cada token interno debe coincidir exclusivamente entre quien llama y quien recibe: `EVENTS_ORDERS_TOKEN`, `PAYMENTS_ORDERS_TOKEN`, `TICKETS_ORDERS_TOKEN`, `NOTIFICATIONS_ORDERS_TOKEN` y `TICKETS_CHECKIN_TOKEN`. Genera secretos con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` y coordina su configuración; no se generan secretos distintos automáticamente en cada repositorio.

## Base propia y migraciones

Configura `DATABASE_URL` para `checkin_db`, usuario `checkin_app`, con una contraseña propia. No uses la cuenta administrativa para ejecutar el servicio.

Para crear la base y el rol una vez, prepara una conexión administrativa al mismo servidor. En Ubuntu puedes asignar la contraseña administrativa con `sudo -u postgres psql` y luego `\password postgres` dentro de psql; sal con `\q`.

```bash
PGADMIN_URL='postgresql://postgres:CONTRASENA_ADMIN@127.0.0.1:5432/postgres' npm run db:setup
npm run migrate
```

Codifica los caracteres especiales de las contraseñas en las URL. `db:setup` solo prepara la base y el rol de este servicio, revoca el acceso de PUBLIC a su base y conserva las credenciales existentes. Si el rol ya existe, usa su contraseña vigente. Un administrador también puede preparar esos recursos manualmente. No requiere permisos administrativos para las migraciones posteriores.

Las migraciones son repetibles y viven en `migrations/`. Cada servicio accede únicamente a su base; nunca lee tablas de otros servicios.

## Arranque y apagado manual

```bash
npm start
```

Permanece en primer plano. Para detenerlo pulsa **Ctrl+C** en esa terminal. Desde otra terminal:

```bash
curl -f http://127.0.0.1:3007/health
```

Devuelve `{"status":"ok"}` con HTTP 200 cuando sus recursos están disponibles; devuelve 503 si no puede atender. Los logs JSON se escriben en consola con fecha, nivel, servicio y mensaje.

Configura TICKETS_URL. Requiere tickets para validar códigos; conserva los ingresos en su propia base. Las dependencias HTTP se configuran por URL y los secretos por entorno. Independencia del repositorio no significa que el flujo completo funcione con los demás servicios apagados.

## Contratos y verificación

`contracts/openapi.yaml` incluye las operaciones que ofrece este servicio y, cuando corresponde, las respuestas HTTP que consume. Es un archivo versionado local: no se carga `docs/` ni se descarga otro repositorio al arrancar. Coordina cambios compatibles con los consumidores; actualiza y verifica sus contratos locales cuando cambie una API.

```bash
npm run typecheck
npm test
```

Las pruebas locales de contrato HTTP no necesitan PostgreSQL, Mailpit ni otros servicios. Las pruebas de compra e ingreso completos requieren levantar los componentes manualmente. Antes de desplegar, aplica las migraciones del propio servicio con su configuración de destino y comprueba `/health`.

Cada repositorio puede ejecutar estos comandos en su futuro pipeline sin clonar los demás. Los pipelines de despliegue aún no están implementados. No se utilizan Docker, colas, caché, nube, pagos reales ni correo real.

## Bitácora

| Fecha | Incidencia | Resolución |
| --- | --- | --- |
| 2026-11-23 | Dependencias de la raíz del monorepositorio. | Código auxiliar, contrato, scripts y dependencias incorporados en este proyecto. |

## Ramas de trabajo

- `development`: rama activa para implementar y verificar cambios.
- `main`: rama reservada para versiones aprobadas para producción.

Antes de trabajar, ejecuta `git switch development`. Cuando una versión esté validada, intégrala desde `development` hacia `main` mediante un pull request. Después vuelve a `development`. No trabajes directamente sobre `main`.

Los futuros pipelines verificarán los cambios en `development` y desplegarán a producción desde `main`. Crear o actualizar una rama local no despliega la aplicación; los pipelines todavía no están implementados. Al publicar en GitHub, configura `development` como rama predeterminada y protege `main` para exigir revisión y verificaciones antes de integrar cambios.
