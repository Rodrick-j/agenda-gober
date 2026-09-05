// Prueba manual del gateway de tiempo real: valida que un evento de
// publicaciones solo le llegue a los sockets cuya secretaria y rango de rol
// se lo permiten (misma regla que la API HTTP, via RLS). Requiere la API
// corriendo (npm run start) y los usuarios de prueba de db/seeds ya cargados.
const { io } = require('socket.io-client');

async function login(email, password) {
  const res = await fetch('http://localhost:3001/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  return data.accessToken;
}

async function connect(name, email) {
  const token = await login(email, 'Password123!');
  const socket = io('http://localhost:3001', { auth: { token } });
  socket.on('connect', () => console.log(`[${name}] conectado`));
  socket.on('publicacion:cambio', (payload) => {
    console.log(
      `[${name}] EVENTO:`, payload.accion, '-', payload.publicacion.titulo,
      `(${payload.publicacion.nivel_confidencialidad})`,
    );
  });
  return socket;
}

async function main() {
  const salud = await connect('SALUD (secretario)', 'salud@test.local');
  const operador = await connect('SALUD (operador)', 'salud.operador@test.local');
  const obras = await connect('OBRAS (secretario)', 'obras@test.local');
  const gobernador = await connect('GOBERNADOR', 'gobernador@test.local');

  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n--- Salud crea "interna": deben verla Salud, operador y gobernador; Obras no ---\n');
  const tokenSalud = await login('salud@test.local', 'Password123!');
  await fetch('http://localhost:3001/publicaciones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSalud}` },
    body: JSON.stringify({ titulo: 'Aviso interno', contenido: 'x', nivelConfidencialidad: 'interna' }),
  });
  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n--- Salud crea "confidencial": debe verla Salud y gobernador; NO el operador ni Obras ---\n');
  await fetch('http://localhost:3001/publicaciones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSalud}` },
    body: JSON.stringify({ titulo: 'Informe confidencial', contenido: 'x', nivelConfidencialidad: 'confidencial' }),
  });
  await new Promise((r) => setTimeout(r, 1500));

  [salud, operador, obras, gobernador].forEach((s) => s.close());
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
