// Prueba manual del canal compromisos_cambios: creacion y cambio de estado,
// visible tanto para quien puede editar el evento como para el responsable
// directo (aunque sea de otra secretaria).
const { io } = require('socket.io-client');

async function login(email, password) {
  const res = await fetch('http://localhost:3001/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).accessToken;
}

async function connect(name, email) {
  const token = await login(email, 'Password123!');
  const socket = io('http://localhost:3001', { auth: { token } });
  socket.on('connect', () => console.log(`[${name}] conectado`));
  socket.on('compromiso:cambio', (payload) => {
    console.log(`[${name}] COMPROMISO:`, payload.accion, payload.compromiso?.descripcion ?? `(id ${payload.id})`);
  });
  return { socket, token };
}

async function main() {
  const salud = await connect('SALUD', 'salud@test.local');
  const obras = await connect('OBRAS', 'obras@test.local');
  await new Promise((r) => setTimeout(r, 1000));

  console.log('\n--- Salud crea un evento y un compromiso (Obras no deberia ver nada) ---\n');
  const evRes = await fetch('http://localhost:3001/eventos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salud.token}` },
    body: JSON.stringify({
      titulo: 'Reunion realtime',
      fechaInicio: '2026-09-12T14:00:00Z',
      fechaFin: '2026-09-12T15:00:00Z',
      nivelConfidencialidad: 'interna',
    }),
  });
  const evento = await evRes.json();

  const cRes = await fetch(`http://localhost:3001/eventos/${evento.id}/compromisos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salud.token}` },
    body: JSON.stringify({ descripcion: 'Prueba realtime compromiso' }),
  });
  const compromiso = await cRes.json();
  await new Promise((r) => setTimeout(r, 1000));

  console.log('\n--- Salud marca el compromiso como cumplido ---\n');
  await fetch(`http://localhost:3001/compromisos/${compromiso.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salud.token}` },
    body: JSON.stringify({ estado: 'cumplido' }),
  });
  await new Promise((r) => setTimeout(r, 1000));

  salud.socket.close();
  obras.socket.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
