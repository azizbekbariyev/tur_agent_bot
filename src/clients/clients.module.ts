import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Client } from '../bot/models/client';
import { Passenger } from '../bot/models/passenger';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Client, Passenger])],
  controllers: [ClientsController],
  providers: [ClientsService, JwtService],
})
export class ClientsModule {}
