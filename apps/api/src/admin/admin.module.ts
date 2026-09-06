import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [ContextModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
