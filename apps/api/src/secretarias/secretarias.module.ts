import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { SecretariasController } from './secretarias.controller';
import { SecretariasService } from './secretarias.service';

@Module({
  imports: [ContextModule],
  controllers: [SecretariasController],
  providers: [SecretariasService],
})
export class SecretariasModule {}
