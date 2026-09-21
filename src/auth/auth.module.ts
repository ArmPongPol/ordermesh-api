import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { UsersModule } from '../users/users.module';
import { AuthCoreModule } from './auth-core.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [AuthCoreModule, UsersModule, RbacModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  // JwtAuthGuard is exported so AppModule can register it as a global APP_GUARD
  // with `useExisting`. `useClass` there would build a second instance inside
  // AppModule's injector and require every transitive dependency be re-exported.
  exports: [JwtAuthGuard],
})
export class AuthModule {}
