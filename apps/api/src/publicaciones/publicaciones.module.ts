import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { PublicacionesController } from './publicaciones.controller';
import { PublicacionesService } from './publicaciones.service';

@Module({
  imports: [ContextModule],
  controllers: [PublicacionesController],
  providers: [PublicacionesService],
})
export class PublicacionesModule {}
