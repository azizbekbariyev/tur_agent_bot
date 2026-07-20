import { Update } from 'nestjs-telegraf';
import { AdminService } from './admin.service';

@Update()
export class AdminUpdate {
  constructor(private readonly adminService: AdminService) {}
}
