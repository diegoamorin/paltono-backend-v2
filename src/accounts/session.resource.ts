import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { defineResource } from '../common/json-api/resource-schema';
import { AuthSession } from './entities/auth-session.entity';

export const sessionSchema = defineResource<AuthSession>({
  type: 'sessions',
  id: (session) => String(session.id),
  attributes: {
    userAgent: (session) => session.userAgent,
    ipAddress: (session) => session.ipAddress,
    createdAt: (session) => session.createdAt.toISOString(),
    expiresAt: (session) => session.expiresAt.toISOString(),
  },
});

class SessionAttributes {
  @ApiProperty()
  userAgent: string;

  @ApiProperty()
  ipAddress: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time', description: 'Límite absoluto de la sesión; renovarla no lo extiende' })
  expiresAt: string;
}

export class SessionResource {
  @ApiProperty({ enum: ['sessions'] })
  type: string;

  @ApiProperty()
  id: string;

  @ApiProperty({ type: SessionAttributes })
  attributes: SessionAttributes;
}

export class NewSessionMeta {
  @ApiProperty({ description: 'Token de acceso para Authorization: Bearer' })
  accessToken: string;

  @ApiProperty({ format: 'date-time' })
  accessTokenExpiresAt: string;

  @ApiPropertyOptional({ description: 'Token de renovación; solo para client=mobile. En web viaja en una cookie HttpOnly' })
  refreshToken?: string;
}
