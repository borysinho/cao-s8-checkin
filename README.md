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

Cada repositorio puede ejecutar estos comandos en su futuro pipeline sin clonar los demás. El pipeline de verificación y artefactos está en `.github/workflows/ci.yml`; no realiza despliegue. No se utilizan Docker, colas, caché, nube, pagos reales ni correo real.

## Bitácora

| Fecha | Incidencia | Resolución |
| --- | --- | --- |
| 2026-11-23 | Dependencias de la raíz del monorepositorio. | Código auxiliar, contrato, scripts y dependencias incorporados en este proyecto. |

## Ramas de trabajo

- `development`: rama activa para implementar y verificar cambios.
- `main`: rama reservada para versiones aprobadas para producción.

Antes de trabajar, ejecuta `git switch development`. Cuando una versión esté validada, intégrala desde `development` hacia `main` mediante un pull request. Después vuelve a `development`. No trabajes directamente sobre `main`.

El pipeline verifica y empaqueta cambios en `development` y `main`. El despliegue a producción desde `main` queda para una etapa posterior; no se despliega al actualizar una rama. Al publicar en GitHub, configura `development` como rama predeterminada y protege `main` para exigir revisión y verificaciones antes de integrar cambios.

## GitHub Actions y artefacto publicable

El workflow tiene dos jobs: **Verificar** instala las dependencias de desarrollo y ejecuta TypeScript y las pruebas; **Empaquetar** declara `needs: verificar`, por lo que solo comienza cuando el primero termina correctamente. Empaquetar obtiene el mismo código, prepara Node y sus dependencias en un runner nuevo, genera el paquete y lo guarda como artefacto. Si Verificar falla o se cancela, Empaquetar no continúa. Los jobs no comparten node_modules ni archivos locales; cada uno prepara su entorno.

El workflow `.github/workflows/ci.yml` se ejecuta con push y pull requests hacia `development` o `main`, y permite ejecución manual cuando el workflow esté disponible en la rama predeterminada. Instala con `npm ci`, verifica TypeScript, ejecuta pruebas independientes y genera el artefacto con `npm run package`. No necesita otros repositorios, secretos, PostgreSQL ni Mailpit para esta verificación; no realiza despliegues.

En **GitHub → Actions → ejecución exitosa → Artifacts** descarga el paquete identificado con el commit. Se conserva 14 días y contiene un `.tar.gz` y su checksum `.sha256`. Extrae el ZIP de descarga, verifica `sha256sum -c ARCHIVO.tar.gz.sha256` y descomprime el tar. Dentro encontrarás `PUBLICAR.md` y `release.json` con el commit, rama, versión de Node y plataforma. También puedes generar el paquete localmente mediante `npm run package`; en Linux requiere `tar`.

Los backends incluyen código TypeScript para Node.js 24, contratos, migraciones cuando corresponden y node_modules de producción instalados desde el lockfile. Web incluye `dist/` compilado y su launcher de Nginx. No incluye `.env` real, bases, PDF de usuarios, imágenes subidas, pruebas ni dependencias de desarrollo. Las fotografías públicas de demostración sí forman parte de web.

El artefacto de Actions se prepara en **Ubuntu 24.04 x64** para la versión exacta de `.nvmrc`. El destino requiere ese Node.js y un entorno compatible; web además requiere Nginx y los backends sus dependencias de infraestructura configuradas por entorno. No hace falta instalar paquetes npm ni compilar en destino. Conserva la persistencia fuera de la entrega y aplica las migraciones del servicio antes de arrancarlo.

## Dependencias de desarrollo y editor

Dentro de este repositorio ejecuta `npm ci --include=dev`: instala también TypeScript y los tipos `@types/node` ya declarados en package.json. No ejecutes npm install desde la carpeta que agrupa los ocho clones, porque no es un proyecto npm. La instalación con `--omit=dev` corresponde al artefacto de producción, no a editar el código fuente.

En VS Code abre la carpeta de este servicio, ejecuta **TypeScript: Select TypeScript Version → Use Workspace Version** y, si conservaba diagnósticos antiguos, **TypeScript: Restart TS Server**. `.vscode/settings.json` señala el TypeScript instalado en este proyecto. Comprueba los errores reales con `npm run typecheck`; `npm test` comprueba sus pruebas.
