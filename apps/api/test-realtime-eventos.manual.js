// Prueba manual del canal eventos_cambios: creacion, edicion y borrado en
// tiempo real, incluyendo que el borrado (donde ya no se puede re-consultar
// la fila bajo RLS) igual llegue como aviso "pelado" { accion: 'DELETE', id }.
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
  socket.on('evento:cambio', (payload) => {
    console.log(`[${name}] EVENTO:`, payload.accion, payload.evento?.titulo ?? `(id ${payload.id})`);
  });
  return { socket, token };
}

async function main() {
  const salud = await connect('SALUD', 'salud@test.local');
  const obras = await connect('OBRAS', 'obras@test.local');
  await new Promise((r) => setTimeout(r, 1000));

  console.log('\n--- Salud crea un evento (deberia llegarle a Salud, no a Obras) ---\n');
  const res = await fetch('http://localhost:3001/eventos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salud.token}` },
    body: JSON.stringify({
      titulo: 'Prueba realtime evento',
      fechaInicio: '2026-09-15T14:00:00Z',
      fechaFin: '2026-09-15T15:00:00Z',
      nivelConfidencialidad: 'interna',
    }),
  });
  const evento = await res.json();
  await new Promise((r) => setTimeout(r, 1000));

  console.log('\n--- Salud borra el evento (deberia llegar como DELETE, solo el id) ---\n');
  await fetch(`http://localhost:3001/eventos/${evento.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${salud.token}` },
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
