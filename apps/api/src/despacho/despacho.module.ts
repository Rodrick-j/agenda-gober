import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { DespachoController } from './despacho.controller';
import { DespachoService } from './despacho.service';

@Module({
  imports: [ContextModule],
  controllers: [DespachoController],
  providers: [DespachoService],
})
export class DespachoModule {}
