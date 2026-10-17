import { Controller, HttpCode, HttpStatus, Module, Post } from '@nestjs/common';
import { AccountsModule } from '../../src/accounts/accounts.module';
import { Authenticated } from '../../src/accounts/authenticated.decorator';

/*
 * A stand-in for the contribution endpoints, which require a verified account
 * (`Ver`), until the editorial module exists.
 */

@Controller('contribution-probes')
class ContributionProbesController {
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated('verified')
  contribute(): void {}
}

@Module({ imports: [AccountsModule], controllers: [ContributionProbesController] })
export class ContributionsFixtureModule {}
