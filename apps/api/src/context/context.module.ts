import { Module } from '@nestjs/common';
import { TxService } from './tx.service';

@Module({
  providers: [TxService],
  exports: [TxService],
})
export class ContextModule {}
