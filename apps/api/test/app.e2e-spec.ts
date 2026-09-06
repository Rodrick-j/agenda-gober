import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

// Una sola instancia para todo el archivo, y se cierra en afterAll -- si no,
// el gateway de socket.io y la conexión LISTEN de PgListenerService quedan
// abiertas y jest nunca termina (por eso jest-e2e.json trae forceExit como
// red de seguridad, pero el cierre explícito es lo correcto).
describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('/health (GET) -> liveness', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });

  it('/health/ready (GET) -> readiness con la DB arriba', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('up');
  });
});
