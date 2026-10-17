import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DirectionsController } from './directions.controller';
import { DirectionsService } from './directions.service';

@Module({
  imports: [HttpModule],
  controllers: [DirectionsController],
  providers: [DirectionsService],
})
export class DirectionsModule {}
