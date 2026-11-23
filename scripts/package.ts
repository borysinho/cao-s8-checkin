import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { platform, arch } from 'node:os';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const web = pkg.name === 'entradasya-web';
const version = (await readFile(join(root, '.nvmrc'), 'utf8')).trim();
if (process.versions.node !== version) throw new Error(`Usa Node.js ${version} para generar el artefacto.`);
const output = join(root, 'release');
const stage = join(output, pkg.name);
await rm(output, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
const files = web
  ? ['dist', 'nginx', '.env.example', '.nvmrc', 'README.md']
  : ['src', 'scripts', 'contracts', 'package.json', 'package-lock.json', '.env.example', '.nvmrc', 'README.md'];
if (!web && pkg.scripts.migrate) files.push('migrations');
for (const file of files) await cp(join(root, file), join(stage, file), { recursive: true });
if (web) {
  // React y sus bibliotecas ya están incluidos en dist; el launcher usa solo Node.
  await writeFile(join(stage, 'package.json'), JSON.stringify({
    name: pkg.name, version: pkg.version, private: true, type: 'module', engines: pkg.engines,
    scripts: { start: 'node nginx/start.ts', 'check:nginx': 'node nginx/start.ts --check' },
  }, null, 2) + '\n');
  execFileSync(process.execPath, ['--check', 'nginx/start.ts'], { cwd: stage, stdio: 'inherit' });
} else {
  // Instala desde el lockfile en staging; nunca copia node_modules del equipo.
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Ejecuta npm run package.');
  execFileSync(process.execPath, [npm, 'ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: stage, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' },
  });
  const require = createRequire(join(stage, 'package.json'));
  for (const dependency of Object.keys(pkg.dependencies)) require.resolve(dependency);
  execFileSync(process.execPath, ['--input-type=module', '-e', "await import('./src/lib/api.ts'); await import('./src/index.ts');"], {
    cwd: stage, stdio: 'inherit',
  });
  // sharp es nativo: comprueba que puede procesar imágenes en el sistema destino.
  if (pkg.dependencies.sharp) {
    const sharp = require('sharp');
    await sharp({ create: { width: 1, height: 1, channels: 3, background: 'black' } }).webp().toBuffer();
  }
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const manifest = {
  service: pkg.name, version: pkg.version, commit,
  ref: process.env.GITHUB_REF_NAME ?? execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.versions.node, platform: platform(), architecture: arch(),
  runner: process.env.RUNNER_OS ? 'ubuntu-24.04' : 'local', createdAt: new Date().toISOString(),
};
await writeFile(join(stage, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(stage, 'PUBLICAR.md'), `# Publicar ${pkg.name}

Paquete generado para ${manifest.platform}/${manifest.architecture} con Node.js ${version}.
En GitHub Actions se construye para Ubuntu 24.04 x64. Conserva el mismo sistema y arquitectura para las dependencias nativas.
Requiere Node.js ${version}${web ? ' y Nginx' : ''} instalado en el destino.

1. Verifica el archivo con sha256sum -c ARCHIVO.tar.gz.sha256 y extrae el tar.gz.
2. Entra en ${pkg.name} y prepara .env a partir de .env.example. Configura los secretos del destino.
${pkg.scripts.migrate ? '3. Prepara la base propia siguiendo README.md y ejecuta npm run migrate.\n4.' : '3.'} Ejecuta npm start y comprueba /health. No necesitas npm ci ni npm run build.

${web ? 'dist/ está listo para servir por Nginx; npm start inicia la configuración incluida. No se incluyen dependencias del compilador.' : 'Incluye node_modules de producción y TypeScript nativo de Node.js 24, sin necesidad de compilar en destino. No ejecutes los comandos de desarrollo desde este paquete.'}
Los datos persistentes, PDF e imágenes subidas se mantienen fuera de cada entrega. El paquete no contiene credenciales, bases ni datos de usuarios.
Este proceso genera un artefacto: no realiza despliegue ni modifica infraestructura.
`);
const filename = `${pkg.name}-${commit.slice(0, 12)}-${platform()}-${arch()}.tar.gz`;
execFileSync('tar', ['-czf', join(output, filename), '-C', output, pkg.name], { stdio: 'inherit' });
const digest = createHash('sha256').update(await readFile(join(output, filename))).digest('hex');
await writeFile(join(output, filename + '.sha256'), `${digest}  ${filename}\n`);
await rm(stage, { recursive: true, force: true });
console.log('Artefacto verificado: ' + join(output, filename));
