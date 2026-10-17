import { Inject, Injectable, Logger } from '@nestjs/common';
import { Email, Mailer } from '../common/mail/mailer';
import { APP_CONFIG, AppConfig, Frontend } from '../config/app-config';
import { User } from './entities/user.entity';

/**
 * Renders the account emails, in Spanish, and sends them. Callers send after
 * their transaction commits; a failed send is logged and never undoes the
 * operation, so the client can ask for the email again.
 */
@Injectable()
export class AccountEmails {
  private readonly logger = new Logger(AccountEmails.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly mailer: Mailer,
  ) {}

  /** `tokenId` identifies the send request, so retries of it are delivered once. */
  async sendEmailVerification(user: User, frontend: Frontend, token: string, tokenId: number): Promise<void> {
    const link = this.link(frontend, 'verificar-correo', token);
    await this.send({
      template: 'email-verification',
      to: user.email!,
      subject: 'Confirma tu correo en Paltono',
      text: [
        `Hola, ${user.displayName}:`,
        'Confirma tu correo para terminar de crear tu cuenta en Paltono:',
        link,
        'El enlace caduca en 24 horas. Si no creaste esta cuenta, ignora este mensaje.',
      ].join('\n\n'),
      html: [
        `<p>Hola, ${escapeHtml(user.displayName)}:</p>`,
        '<p>Confirma tu correo para terminar de crear tu cuenta en Paltono:</p>',
        `<p><a href="${escapeHtml(link)}">Confirmar mi correo</a></p>`,
        '<p>El enlace caduca en 24 horas. Si no creaste esta cuenta, ignora este mensaje.</p>',
      ].join('\n'),
      idempotencyKey: `email-verification/${tokenId}`,
    });
  }

  private link(frontend: Frontend, path: string, token: string): string {
    const url = new URL(path, `${this.config.frontends[frontend].replace(/\/+$/, '')}/`);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private async send(email: Email): Promise<void> {
    try {
      await this.mailer.send(email);
    } catch (error) {
      this.logger.error(`Could not send ${email.template} email: ${error instanceof Error ? error.message : error}`);
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
