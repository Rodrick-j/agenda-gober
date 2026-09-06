// Prueba manual del canal proyectos_cambios: creacion y avance en tiempo
// real, aislado por secretaria.
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
  socket.on('proyecto:cambio', (payload) => {
    console.log(`[${name}] PROYECTO:`, payload.accion, payload.proyecto?.nombre ?? `(id ${payload.id})`);
  });
  return { socket, token };
}

async function main() {
  const salud = await connect('SALUD', 'salud@test.local');
  const obras = await connect('OBRAS', 'obras@test.local');
  await new Promise((r) => setTimeout(r, 1000));

  console.log('\n--- Salud crea un proyecto (deberia llegarle solo a Salud) ---\n');
  const res = await fetch('http://localhost:3001/proyectos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salud.token}` },
    body: JSON.stringify({ nombre: 'Prueba realtime proyecto', nivelConfidencialidad: 'interna' }),
  });
  const proyecto = await res.json();
  await new Promise((r) => setTimeout(r, 1000));

  console.log('\n--- Salud actualiza el avance ---\n');
  await fetch(`http://localhost:3001/proyectos/${proyecto.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salud.token}` },
    body: JSON.stringify({ avancePorcentaje: 40 }),
  });
  await new Promise((r) => setTimeout(r, 1000));

  console.log('\n--- Salud elimina el proyecto ---\n');
  await fetch(`http://localhost:3001/proyectos/${proyecto.id}`, {
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
