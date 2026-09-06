// Prueba manual del canal tareas_cambios: creacion y cambio de estado en
// tiempo real, aislado por secretaria (Obras no debe ver una tarea de Salud).
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
  socket.on('tarea:cambio', (payload) => {
    console.log(`[${name}] TAREA:`, payload.accion, payload.tarea?.titulo ?? `(id ${payload.id})`);
  });
  return { socket, token };
}

async function main() {
  const salud = await connect('SALUD', 'salud@test.local');
  const obras = await connect('OBRAS', 'obras@test.local');
  await new Promise((r) => setTimeout(r, 1000));

  console.log('\n--- Salud crea una tarea (deberia llegarle a Salud, no a Obras) ---\n');
  const res = await fetch('http://localhost:3001/tareas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salud.token}` },
    body: JSON.stringify({ titulo: 'Prueba realtime tarea', nivelConfidencialidad: 'interna' }),
  });
  const tarea = await res.json();
  await new Promise((r) => setTimeout(r, 1000));

  console.log('\n--- Salud elimina la tarea (deberia llegar como DELETE, solo el id) ---\n');
  await fetch(`http://localhost:3001/tareas/${tarea.id}`, {
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
