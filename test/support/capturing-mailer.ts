import { Email, EmailTemplate, Mailer } from '../../src/common/mail/mailer';

/** A mailer that keeps every email instead of sending it, and can be told to fail. */
export class CapturingMailer extends Mailer {
  readonly sent: Email[] = [];
  private failures = 0;

  async send(email: Email): Promise<void> {
    if (this.failures > 0) {
      this.failures--;
      throw new Error('Simulated mail provider outage');
    }
    this.sent.push(email);
  }

  /** Makes the next `count` sends fail. */
  failNext(count = 1): void {
    this.failures = count;
  }

  clear(): void {
    this.sent.length = 0;
    this.failures = 0;
  }

  /** The emails sent to an address with a template, oldest first. */
  to(address: string, template?: EmailTemplate): Email[] {
    return this.sent.filter((email) => email.to === address && (!template || email.template === template));
  }

  /** The link of the latest email sent to an address with a template. */
  lastLink(address: string, template: EmailTemplate): URL {
    const email = this.to(address, template).at(-1);
    if (!email) throw new Error(`No ${template} email was sent to ${address}`);
    const match = /https?:\/\/\S+/.exec(email.text);
    if (!match) throw new Error(`The ${template} email to ${address} has no link`);
    return new URL(match[0]);
  }

  /** The token in the link of the latest email sent to an address with a template. */
  lastToken(address: string, template: EmailTemplate): string {
    const token = this.lastLink(address, template).searchParams.get('token');
    if (!token) throw new Error(`The ${template} link to ${address} has no token`);
    return token;
  }
}
