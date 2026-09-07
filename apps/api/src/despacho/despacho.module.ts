import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { DespachoController, DespachoItemsController } from './despacho.controller';
import { DespachoService } from './despacho.service';
import { DespachoSweepService } from './despacho-sweep.service';

@Module({
  imports: [ContextModule],
  controllers: [DespachoController, DespachoItemsController],
  providers: [DespachoService, DespachoSweepService],
})
export class DespachoModule {}
