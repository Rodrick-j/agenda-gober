import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { GabineteController } from './gabinete.controller';
import { GabineteService } from './gabinete.service';

@Module({
  imports: [ContextModule],
  controllers: [GabineteController],
  providers: [GabineteService],
})
export class GabineteModule {}
