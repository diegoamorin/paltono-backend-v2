import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AccessTokens } from './access-tokens';
import { AccountEmails } from './account-emails';
import { AccessGuard } from './authenticated.decorator';
import { EmailVerificationsController } from './email-verifications.controller';
import { AuthSession } from './entities/auth-session.entity';
import { User } from './entities/user.entity';
import { UserCredential } from './entities/user-credential.entity';
import { UserToken } from './entities/user-token.entity';
import { MeController } from './me.controller';
import { RegistrationService } from './registration.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { UsersController } from './users.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserCredential, UserToken, AuthSession]),
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: ({ auth }: AppConfig) => [{ ttl: 60_000, limit: auth.rateLimit }],
    }),
  ],
  controllers: [UsersController, EmailVerificationsController, SessionsController, MeController],
  providers: [RegistrationService, SessionsService, AccessTokens, AccountEmails, AccessGuard],
  // Other modules protect their endpoints with `@Authenticated()`, which needs the guard and its services.
  exports: [AccessGuard, SessionsService],
})
export class AccountsModule {}
