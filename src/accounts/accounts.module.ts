import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AccessTokens } from './access-tokens';
import { AccountEmails } from './account-emails';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AccessGuard } from './authenticated.decorator';
import { EmailVerificationsController } from './email-verifications.controller';
import { AuthSession } from './entities/auth-session.entity';
import { User } from './entities/user.entity';
import { UserCredential } from './entities/user-credential.entity';
import { UserRoleChange } from './entities/user-role-change.entity';
import { UserStatusChange } from './entities/user-status-change.entity';
import { UserToken } from './entities/user-token.entity';
import { MeController } from './me.controller';
import { OwnSessionsController } from './own-sessions.controller';
import { PasswordsController } from './passwords.controller';
import { PasswordsService } from './passwords.service';
import { RegistrationService } from './registration.service';
import { RoleChangesController } from './role-changes.controller';
import { RoleChangesService } from './role-changes.service';
import { SessionRefreshesController, SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { StatusChangesController } from './status-changes.controller';
import { StatusChangesService } from './status-changes.service';
import { UsersController } from './users.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserCredential, UserToken, AuthSession, UserRoleChange, UserStatusChange]),
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: ({ auth }: AppConfig) => [{ ttl: 60_000, limit: auth.rateLimit }],
    }),
  ],
  controllers: [
    UsersController,
    EmailVerificationsController,
    SessionsController,
    SessionRefreshesController,
    MeController,
    OwnSessionsController,
    PasswordsController,
    AdminUsersController,
    RoleChangesController,
    StatusChangesController,
  ],
  providers: [RegistrationService, SessionsService, PasswordsService, RoleChangesService, StatusChangesService, AdminUsersService, AccessTokens, AccountEmails, AccessGuard],
  // Other modules protect their endpoints with `@Authenticated()`, which needs the guard and its services.
  exports: [AccessGuard, SessionsService],
})
export class AccountsModule {}
