import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { PgListenerService } from './pg-listener.service';

@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, PgListenerService],
})
export class RealtimeModule {}
