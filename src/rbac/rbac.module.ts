import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';
import { PermissionsGuard } from './guards/permissions.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Role, Permission, UserRole, RolePermission]),
  ],
  providers: [PermissionsGuard],
  // Exported so AppModule can register it as a global APP_GUARD with
  // `useExisting` rather than constructing a second instance.
  exports: [PermissionsGuard, TypeOrmModule],
})
export class RbacModule {}
