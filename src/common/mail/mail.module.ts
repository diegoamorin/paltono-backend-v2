import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { Mailer } from './mailer';
import { LoggingMailer, ResendMailer } from './resend-mailer';

@Global()
@Module({
  providers: [
    {
      provide: Mailer,
      inject: [APP_CONFIG],
      useFactory: ({ mail }: AppConfig): Mailer =>
        mail.resendApiKey ? new ResendMailer(mail.resendApiKey, mail.from) : new LoggingMailer(),
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
