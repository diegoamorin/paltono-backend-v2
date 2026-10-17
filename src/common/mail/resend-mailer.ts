import { Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { Email, Mailer } from './mailer';

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

/**
 * Sends through Resend with a limited number of retries. Every attempt carries the
 * same idempotency key and content, so Resend delivers the email at most once.
 */
export class ResendMailer extends Mailer {
  private readonly resend: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    super();
    this.resend = new Resend(apiKey);
  }

  async send(email: Email): Promise<void> {
    const payload = { from: this.from, to: email.to, subject: email.subject, text: email.text, html: email.html };
    let lastError: unknown;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const { error } = await this.resend.emails.send(payload, { idempotencyKey: email.idempotencyKey });
        if (!error) return;
        lastError = new Error(`Resend rejected the email: ${error.name}: ${error.message}`);
      } catch (error) {
        lastError = error;
      }
      if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
    throw lastError;
  }
}

/** Writes emails to the log, for development without a Resend key. */
export class LoggingMailer extends Mailer {
  private readonly logger = new Logger(LoggingMailer.name);

  async send(email: Email): Promise<void> {
    this.logger.log(`Email ${email.template} to ${email.to}: ${email.subject}\n${email.text}`);
  }
}
