import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wanted = readFileSync(join(root, '.node-version'), 'utf8').trim();
const embedded = process.env.USERPROFILE && join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe');
const nvmNode = process.env.NVM_HOME && join(process.env.NVM_HOME, `v${wanted}`, 'node.exe');
const node = process.env.RIUYA_NODE || (process.versions.node === wanted ? process.execPath : nvmNode && existsSync(nvmNode) ? nvmNode : embedded);
const bundledNpm = node && join(dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npmCli = bundledNpm && existsSync(bundledNpm) ? bundledNpm : process.env.npm_execpath;

function fail(message) { console.error(`\n${message}`); process.exitCode = 1; }
async function main() {
  if (!node || !existsSync(node)) return fail(`No se encontró Node ${wanted}. Instálalo o indica su ruta en RIUYA_NODE.`);
  const check = spawnSync(node, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (check.status !== 0 || check.stdout.trim() !== `v${wanted}`) return fail(`Riuya requiere Node ${wanted}. Revisa la instalación o RIUYA_NODE.`);
  if (!npmCli || !existsSync(npmCli)) return fail('No se encontró npm. Ejecuta este comando mediante npm run pruebas.');
  const env = { ...process.env, PATH: `${dirname(node)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}` };
  const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { cwd: root, env, encoding: 'utf8', windowsHide: true });
  if (docker.error || docker.status !== 0) return fail('Docker Desktop no está disponible. Inícialo y vuelve a ejecutar npm run pruebas.');
  const localEnv = join(root, '.env.local');
  if (!existsSync(localEnv)) return fail('Falta app/.env.local. Configura Supabase local antes de continuar.');
  const origin = readFileSync(localEnv, 'utf8').match(/^\s*APP_ORIGIN\s*=\s*(.*?)\s*$/m)?.[1];
  if (origin && origin !== 'http://127.0.0.1:3102') return fail('APP_ORIGIN debe ser http://127.0.0.1:3102 para estas pruebas locales.');
  console.log(`Node ${wanted} ${node === nvmNode ? '(NVM para Windows)' : ''} y Docker Desktop: disponibles.`);
  const cli = args => spawnSync(node, [npmCli, 'exec', '--no', '--', 'supabase', ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  let status = cli(['status', '-o', 'json']);
  if (status.error || status.status !== 0) {
    console.log('Iniciando Supabase local; esto puede tardar unos minutos…');
    const started = cli(['start']);
    if (started.error || started.status !== 0) return fail('No se pudo iniciar Supabase local. Comprueba Docker Desktop y el espacio disponible.');
    status = cli(['status', '-o', 'json']);
  }
  let info;
  try { info = JSON.parse(status.stdout); } catch { return fail('No se pudo verificar la configuración de Supabase local.'); }
  if (status.status !== 0 || info.API_URL !== 'http://127.0.0.1:54321') return fail('La dirección de Supabase no coincide con el entorno local esperado.');
  try { const health = await fetch('http://127.0.0.1:54321/auth/v1/health', { signal: AbortSignal.timeout(5000) }); if (!health.ok) throw new Error(); }
  catch { return fail('Supabase está iniciado, pero su servicio de autenticación no responde.'); }
  console.log('Supabase local: disponible.');
  try {
    const response = await fetch('http://127.0.0.1:3102/', { signal: AbortSignal.timeout(4000) });
    if (response.ok && (await response.text()).includes('<title>Riuya</title>')) { console.log('Riuya ya está disponible en http://127.0.0.1:3102/'); return; }
    return fail('El puerto 3102 responde, pero no parece ser Riuya. Libéralo antes de continuar.');
  } catch (error) {
    if (error?.name === 'TimeoutError') return fail('El puerto 3102 no responde a tiempo. Comprueba si otra aplicación lo está utilizando.');
  }
  const next = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!existsSync(next)) return fail('Faltan dependencias del proyecto. Instálalas con Node 24 antes de iniciar las pruebas.');
  console.log('Iniciando Riuya en http://127.0.0.1:3102/ — pulsa Ctrl+C para detener la aplicación.');
  const child = spawn(node, [next, 'dev', '-H', '127.0.0.1', '-p', '3102'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  child.on('error', () => fail('No se pudo iniciar la aplicación.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (!child.killed) child.kill(signal); });
  child.on('exit', (code, signal) => { if (!signal && code) process.exitCode = code; });
}
main().catch(() => fail('No se pudo iniciar el entorno local. Comprueba Docker Desktop y vuelve a intentarlo.'));

