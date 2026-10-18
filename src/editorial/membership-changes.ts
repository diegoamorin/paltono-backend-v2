import { EntityManager } from 'typeorm';
import {
  MembershipValue,
  dateBounds,
  deleteMembership,
  findMembership,
  findMembershipByStart,
  insertMembership,
  membershipClashes,
  updateMembership,
} from '../catalog-identities/artist-relations';
import { ASSOCIATION_STATUSES } from '../catalog-identities/entities/artist.entity';
import { PartialDateValue } from '../catalog-identities/identity-creations';
import { identityIdOf } from '../catalog-identities/identity-relations';
import { ContributionRoleScope } from '../vocabularies/entities/contribution-role.entity';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import { BIO, IMG_PROFILE, PARTIAL_DATE, daysInMonth } from './identity-creation';
import { INT4, ROW_KEY, envelope, onlyFor, readRow, reference } from './identity-relation-changes';
import type { OperationDefinition, PayloadProblem, TargetProblem } from './operation-registry';

/*
 * Memberships of an organization, keyed by their generated id. They belong to
 * the organization's root; the member, a person or another organization, is
 * named by its editorial UUID and locked with it. A membership carries its
 * roles, the musical functions of the member within it, as one coherent value.
 */

const TEXT = { type: ['string', 'null'], maxLength: 10000 };

const MEMBERSHIP = {
  type: 'object',
  additionalProperties: false,
  required: ['member', 'joined', 'left', 'status', 'description', 'sourceText', 'sourceUrl', 'roles'],
  properties: {
    member: reference('entity_id', 'Raíz editorial del miembro: una persona u otra organización, sin perfil artístico obligatorio'),
    joined: PARTIAL_DATE,
    left: PARTIAL_DATE,
    status: { enum: ASSOCIATION_STATUSES, description: 'Una salida conocida exige former; current exige salida desconocida' },
    description: BIO,
    sourceText: TEXT,
    sourceUrl: IMG_PROFILE,
    roles: {
      type: 'array',
      maxItems: 50,
      description: 'Roles del miembro, por posición; cada rol de /v1/contribution-roles con el ámbito membership, una vez',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['contributionRoleId', 'position', 'details'],
        properties: {
          contributionRoleId: { type: 'integer', minimum: 1, maximum: INT4 },
          position: { type: 'integer', minimum: 0, maximum: 32767 },
          details: { type: ['string', 'null'], maxLength: 2000 },
        },
      },
    },
  },
};

const ABSENT: ValueEnvelope = { exists: false };

const proposedMembershipRules = {
  check: (value: unknown) => checkMembership(value as MembershipValue),
  references: (value: unknown) =>
    (value as MembershipValue).roles.map(({ contributionRoleId }, index) => ({
      vocabulary: 'contribution_roles' as const,
      id: contributionRoleId,
      path: `/value/roles/${index}/contributionRoleId`,
    })),
  rootReferences: (value: unknown) => {
    const member = (value as Partial<MembershipValue> | undefined)?.member?.entity_id;
    return typeof member === 'string' ? [{ entityId: member, entityType: 'identity' as const, path: '/value/member' }] : [];
  },
  targetProblems: async (manager: EntityManager, root: EditorialEntity, value: unknown): Promise<TargetProblem[]> => [
    ...(await onlyFor('organization', 'memberships')(manager, root)),
    ...(await rolesOutOfScope(manager, value as MembershipValue)),
  ],
} satisfies Partial<OperationDefinition>;

const membershipBase = {
  entityType: 'identity',
  targetPath: 'organization_memberships',
  payloadSchemaVersion: 1,
} satisfies Partial<OperationDefinition>;

const ADD_MEMBERSHIP: OperationDefinition = {
  ...membershipBase,
  ...proposedMembershipRules,
  operation: 'add_relation',
  description:
    'Añade la membresía de una persona u organización a la organización, con sus roles. Un miembro no repite fecha de entrada, ' +
    'sus periodos no se solapan con certeza y ninguna organización acaba siendo miembro de sí misma.',
  valueSchema: MEMBERSHIP,
  targetKeySchema: null,
  naturalKey: (value) => {
    const { member, joined } = (value ?? {}) as Partial<MembershipValue>;
    return member && joined !== undefined ? { member, joined } : undefined;
  },
  read: async (manager, root, _key, value) => {
    const ids = await identityIds(manager, root, value as MembershipValue);
    return ids ? envelope(await findMembershipByStart(manager, ids.organizationId, ids.memberId, (value as MembershipValue).joined)) : ABSENT;
  },
  constraintProblems: async (manager, root, _key, value) => {
    const { organizationId, memberId } = (await identityIds(manager, root, value as MembershipValue))!;
    return membershipClashes(manager, organizationId, memberId, value as MembershipValue, null);
  },
  apply: async (manager, root, value, now) => {
    const { organizationId, memberId } = (await identityIds(manager, root, value as MembershipValue))!;
    const id = await insertMembership(manager, organizationId, memberId, value as MembershipValue, now);
    return { afterValue: envelope(await findMembership(manager, organizationId, id)), resultKey: { id } };
  },
};

const readMembership = readRow(findMembership);

const UPDATE_MEMBERSHIP: OperationDefinition = {
  ...membershipBase,
  ...proposedMembershipRules,
  operation: 'update_relation',
  description: 'Sustituye los datos y los roles de una membresía existente de la organización.',
  valueSchema: MEMBERSHIP,
  targetKeySchema: ROW_KEY,
  read: (manager, root, key) => readMembership(manager, root, key!),
  constraintProblems: async (manager, root, key, value) => {
    const { organizationId, memberId } = (await identityIds(manager, root, value as MembershipValue))!;
    if (!(await findMembership(manager, organizationId, key!.id))) return ['La membresía ya no existe'];
    return membershipClashes(manager, organizationId, memberId, value as MembershipValue, key!.id);
  },
  apply: async (manager, root, value, now, key) => {
    const { organizationId, memberId } = (await identityIds(manager, root, value as MembershipValue))!;
    await updateMembership(manager, organizationId, key!.id, memberId, value as MembershipValue, now);
    return { afterValue: envelope(await findMembership(manager, organizationId, key!.id)), resultKey: key };
  },
};

const REMOVE_MEMBERSHIP: OperationDefinition = {
  ...membershipBase,
  operation: 'remove_relation',
  description: 'Quita una membresía de la organización con sus roles; la revisión guarda sus valores anteriores.',
  valueSchema: null,
  targetKeySchema: ROW_KEY,
  check: () => [],
  references: () => [],
  read: (manager, root, key) => readMembership(manager, root, key!),
  apply: async (manager, root, _value, now, key) => {
    await deleteMembership(manager, (await identityIdOf(manager, root.id))!, key!.id, now);
    return { afterValue: ABSENT, resultKey: key };
  },
};

export const MEMBERSHIP_CHANGES: OperationDefinition[] = [ADD_MEMBERSHIP, UPDATE_MEMBERSHIP, REMOVE_MEMBERSHIP];

/** The domain ids of the organization and of the member, or null while either is only reserved. */
async function identityIds(
  manager: EntityManager,
  root: EditorialEntity,
  value: MembershipValue,
): Promise<{ organizationId: number; memberId: number } | null> {
  const organizationId = await identityIdOf(manager, root.id);
  const memberId = await identityIdOf(manager, value.member.entity_id.toLowerCase());
  return organizationId === null || memberId === null ? null : { organizationId, memberId };
}

/** What the JSON Schema cannot say: calendar dates, a status coherent with the departure, a period that can exist and roles in order. */
export function checkMembership({ joined, left, status, roles }: MembershipValue): PayloadProblem[] {
  const problems: PayloadProblem[] = [];
  for (const [field, date] of [['joined', joined], ['left', left]] as const) {
    if (date && !isCalendarDay(date)) problems.push({ path: `/value/${field}/day`, detail: `${field} is not a calendar date` });
  }
  if (left && status !== 'former') {
    problems.push({ path: '/value/status', detail: 'A known departure requires status former' });
  } else if (joined && left && dateBounds(left).last < dateBounds(joined).first) {
    problems.push({ path: '/value/left', detail: 'left is before joined' });
  }
  roles.forEach((role, index) => {
    if (index > 0 && role.position <= roles[index - 1].position) {
      problems.push({ path: `/value/roles/${index}/position`, detail: 'Roles are listed by increasing position' });
    }
    if (roles.findIndex(({ contributionRoleId }) => contributionRoleId === role.contributionRoleId) < index) {
      problems.push({ path: `/value/roles/${index}/contributionRoleId`, detail: 'A role appears once in a membership' });
    }
  });
  return problems;
}

function isCalendarDay({ year, month, day }: PartialDateValue): boolean {
  return day === undefined || month === undefined || day <= daysInMonth(year, month);
}

/** Roles of a membership must allow the `membership` scope; the vocabulary may change, so it is read each time. */
async function rolesOutOfScope(manager: EntityManager, value: MembershipValue): Promise<TargetProblem[]> {
  const problems: TargetProblem[] = [];
  for (const [index, { contributionRoleId }] of value.roles.entries()) {
    if (!(await manager.existsBy(ContributionRoleScope, { contributionRoleId, scope: 'membership' }))) {
      problems.push({
        code: 'role_out_of_scope',
        detail: `The role ${contributionRoleId} does not allow the membership scope`,
        member: `proposedValue/value/roles/${index}/contributionRoleId`,
      });
    }
  }
  return problems;
}

