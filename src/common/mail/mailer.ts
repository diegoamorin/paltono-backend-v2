export type EmailTemplate = 'email-verification';

/** A rendered email, ready to hand to the provider. */
export interface Email {
  template: EmailTemplate;
  to: string;
  subject: string;
  text: string;
  html: string;
  /**
   * Identifies this send request, so the provider delivers it once however many
   * times it is retried.
   */
  idempotencyKey: string;
}

/**
 * Port for sending email. Production uses Resend; tests replace it with a double
 * that captures what would have been sent. A failed send rejects.
 */
export abstract class Mailer {
  abstract send(email: Email): Promise<void>;
}
