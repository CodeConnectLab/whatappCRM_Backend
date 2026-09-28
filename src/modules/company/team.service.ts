import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { MembershipModel, type MembershipRole } from './membership.model.js';
import { UserModel } from '../user/user.model.js';
import { logActivity } from '../activity/activity.service.js';

export type TeamMemberView = {
  _id: string;
  role: MembershipRole;
  availableForLeads: boolean;
  createdAt?: string;
  userId: {
    _id: string;
    name?: string;
    email?: string;
    mustChangePassword?: boolean;
  } | null;
  /** Open (not won/lost) leads currently sitting with this member. */
  openLeadCount: number;
};

type MemberRow = {
  _id: Types.ObjectId;
  role: string;
  availableForLeads?: boolean | null;
  createdAt?: Date;
  userId?:
    | {
        _id: Types.ObjectId;
        name?: string | null;
        email?: string | null;
        mustChangePassword?: boolean | null;
      }
    | Types.ObjectId
    | null;
};

function isPopulatedUser(
  value: MemberRow['userId'],
): value is { _id: Types.ObjectId; name?: string | null; email?: string | null; mustChangePassword?: boolean | null } {
  return Boolean(value) && typeof value === 'object' && 'email' in (value as Record<string, unknown>);
}

/**
 * Team roster with each member's live lead load, so the reassignment UI can show
 * who is busy without a second round trip.
 */
export async function listTeamMembers(companyId: string): Promise<TeamMemberView[]> {
  const companyOid = new Types.ObjectId(companyId);
  const rows = (await MembershipModel.find({ companyId: companyOid, deletedAt: null })
    .populate('userId', 'email name mustChangePassword')
    .sort({ createdAt: 1 })
    .lean()) as unknown as MemberRow[];

  // Imported lazily: chat.service imports company models, and a static import here
  // would close the cycle.
  const { countOpenLeadsByAssignee } = await import('../chat/lead-assignment.service.js');
  const loads = await countOpenLeadsByAssignee(companyId);

  return rows.map((m) => {
    const user = isPopulatedUser(m.userId) ? m.userId : null;
    const userId = user ? String(user._id) : m.userId ? String(m.userId) : '';
    return {
      _id: String(m._id),
      role: m.role as MembershipRole,
      availableForLeads: m.availableForLeads !== false,
      createdAt: m.createdAt?.toISOString(),
      userId: user
        ? {
            _id: userId,
            name: user.name ?? undefined,
            email: user.email ?? undefined,
            mustChangePassword: Boolean(user.mustChangePassword),
          }
        : null,
      openLeadCount: loads.get(userId) ?? 0,
    };
  });
}

export class TeamError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Creates the login and the company membership in one step.
 *
 * Self-service registration is no longer a prerequisite: an admin types a name, an
 * email and a starting password, exactly like adding a user in the CRM. When the
 * email already has an account (the person works for another workspace too) the
 * existing login is reused and only the membership is added — its password is never
 * touched, because that account does not belong to this admin.
 */
export async function createTeamUser(input: {
  companyId: string;
  actorUserId: string;
  name: string;
  email: string;
  password: string;
  role: MembershipRole;
  availableForLeads?: boolean;
}): Promise<{ member: TeamMemberView; reusedExistingLogin: boolean }> {
  const companyOid = new Types.ObjectId(input.companyId);
  const email = input.email.trim().toLowerCase();

  let user = await UserModel.findOne({ email, deletedAt: null });
  let reusedExistingLogin = false;

  if (user) {
    reusedExistingLogin = true;
    const existing = await MembershipModel.findOne({
      userId: user._id,
      companyId: companyOid,
      deletedAt: null,
    }).lean();
    if (existing) {
      throw new TeamError('That user is already a member of this workspace', 409);
    }
  } else {
    user = await UserModel.create({
      email,
      name: input.name.trim(),
      passwordHash: await bcrypt.hash(input.password, 12),
      mustChangePassword: true,
      createdByUserId: new Types.ObjectId(input.actorUserId),
      // Set explicitly: the unique email index is partial on `deletedAt: null`, and a
      // missing field would leave duplicates possible.
      deletedAt: null,
    });
  }

  await MembershipModel.findOneAndUpdate(
    { userId: user._id, companyId: companyOid },
    {
      $set: {
        userId: user._id,
        companyId: companyOid,
        role: input.role,
        availableForLeads: input.availableForLeads ?? true,
        deletedAt: null,
      },
    },
    { upsert: true, new: true },
  );

  await logActivity({
    companyId: input.companyId,
    userId: input.actorUserId,
    action: reusedExistingLogin ? 'team.member_added' : 'team.user_created',
    resource: 'user',
    resourceId: String(user._id),
    meta: { email, role: input.role },
  });

  const members = await listTeamMembers(input.companyId);
  const member = members.find((m) => m.userId?._id === String(user!._id));
  if (!member) throw new TeamError('Member created but could not be read back', 500);
  return { member, reusedExistingLogin };
}

export async function updateTeamMember(input: {
  companyId: string;
  actorUserId: string;
  membershipId: string;
  role?: MembershipRole;
  availableForLeads?: boolean;
}): Promise<TeamMemberView> {
  const companyOid = new Types.ObjectId(input.companyId);
  const membership = await MembershipModel.findOne({
    _id: new Types.ObjectId(input.membershipId),
    companyId: companyOid,
    deletedAt: null,
  });
  if (!membership) throw new TeamError('Member not found', 404);

  // Demoting the last admin would lock the workspace out of its own settings.
  if (input.role && input.role !== 'company_admin' && membership.role === 'company_admin') {
    const otherAdmins = await MembershipModel.countDocuments({
      companyId: companyOid,
      role: 'company_admin',
      deletedAt: null,
      _id: { $ne: membership._id },
    });
    if (!otherAdmins) throw new TeamError('This is the last company admin — promote someone else first', 400);
  }

  if (input.role) membership.role = input.role;
  if (input.availableForLeads !== undefined) membership.availableForLeads = input.availableForLeads;
  await membership.save();

  await logActivity({
    companyId: input.companyId,
    userId: input.actorUserId,
    action: 'team.member_updated',
    resource: 'membership',
    resourceId: String(membership._id),
    meta: { role: membership.role, availableForLeads: membership.availableForLeads },
  });

  const members = await listTeamMembers(input.companyId);
  const view = members.find((m) => m._id === String(membership._id));
  if (!view) throw new TeamError('Member not found after update', 500);
  return view;
}

/**
 * Removes the member from this workspace. The login itself survives — the person may
 * belong to other companies, and their message history must keep resolving.
 */
export async function removeTeamMember(input: {
  companyId: string;
  actorUserId: string;
  membershipId: string;
}): Promise<void> {
  const companyOid = new Types.ObjectId(input.companyId);
  const membership = await MembershipModel.findOne({
    _id: new Types.ObjectId(input.membershipId),
    companyId: companyOid,
    deletedAt: null,
  });
  if (!membership) throw new TeamError('Member not found', 404);

  if (String(membership.userId) === input.actorUserId) {
    throw new TeamError('You cannot remove yourself from the workspace', 400);
  }
  if (membership.role === 'company_admin') {
    const otherAdmins = await MembershipModel.countDocuments({
      companyId: companyOid,
      role: 'company_admin',
      deletedAt: null,
      _id: { $ne: membership._id },
    });
    if (!otherAdmins) throw new TeamError('This is the last company admin — promote someone else first', 400);
  }

  membership.deletedAt = new Date();
  await membership.save();

  // Their open leads go back into the pool rather than staying with someone who can
  // no longer reach the inbox.
  const { unassignLeadsOf } = await import('../chat/lead-assignment.service.js');
  const released = await unassignLeadsOf(input.companyId, String(membership.userId));

  await logActivity({
    companyId: input.companyId,
    userId: input.actorUserId,
    action: 'team.member_removed',
    resource: 'membership',
    resourceId: String(membership._id),
    meta: { leadsReleased: released },
  });
}

/** Sets a fresh password for a member — the admin's "reset" when someone is locked out. */
export async function resetTeamMemberPassword(input: {
  companyId: string;
  actorUserId: string;
  membershipId: string;
  password: string;
}): Promise<void> {
  const membership = await MembershipModel.findOne({
    _id: new Types.ObjectId(input.membershipId),
    companyId: new Types.ObjectId(input.companyId),
    deletedAt: null,
  }).lean();
  if (!membership) throw new TeamError('Member not found', 404);

  const user = await UserModel.findOne({ _id: membership.userId, deletedAt: null });
  if (!user) throw new TeamError('User not found', 404);

  user.passwordHash = await bcrypt.hash(input.password, 12);
  user.mustChangePassword = true;
  // Force a fresh login everywhere: an old refresh token must not outlive the reset.
  user.refreshTokenHashes = [];
  await user.save();

  await logActivity({
    companyId: input.companyId,
    userId: input.actorUserId,
    action: 'team.password_reset',
    resource: 'user',
    resourceId: String(user._id),
  });
}
