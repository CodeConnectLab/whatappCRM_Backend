import { Types } from 'mongoose';
import { ChatModel, openLeadStatusFilter } from './chat.model.js';
import { MembershipModel } from '../company/membership.model.js';
import { CompanyModel } from '../company/company.model.js';
import { emitToCompany } from '../../socket/io.js';
import { logActivity } from '../activity/activity.service.js';
import { logger } from '../../utils/logger.js';

export type AssignmentCandidate = {
  userId: string;
  role: 'company_admin' | 'agent';
  openLeadCount: number;
  lastAssignedAt: number;
};

/**
 * Open leads per assignee. One aggregation rather than a count per agent, because the
 * round-robin runs inside the webhook path where every extra query costs latency.
 */
export async function countOpenLeadsByAssignee(companyId: string): Promise<Map<string, number>> {
  const rows = await ChatModel.aggregate<{ _id: Types.ObjectId | null; n: number }>([
    {
      $match: {
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
        assignedTo: { $ne: null },
        status: openLeadStatusFilter(),
      },
    },
    { $group: { _id: '$assignedTo', n: { $sum: 1 } } },
  ]);
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r._id) out.set(String(r._id), r.n);
  }
  return out;
}

/** Most recent assignment timestamp per assignee — the round-robin tie-breaker. */
async function lastAssignedAtByAssignee(companyId: string): Promise<Map<string, number>> {
  const rows = await ChatModel.aggregate<{ _id: Types.ObjectId | null; at: Date | null }>([
    {
      $match: {
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
        assignedTo: { $ne: null },
      },
    },
    { $group: { _id: '$assignedTo', at: { $max: '$assignedAt' } } },
  ]);
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r._id) out.set(String(r._id), r.at ? r.at.getTime() : 0);
  }
  return out;
}

/**
 * Everyone eligible to receive a new lead: agents in rotation, and company admins only
 * when no agent is available (a one-person workspace must still get its leads).
 */
export async function listAssignmentCandidates(companyId: string): Promise<AssignmentCandidate[]> {
  const companyOid = new Types.ObjectId(companyId);
  const memberships = await MembershipModel.find({
    companyId: companyOid,
    deletedAt: null,
    availableForLeads: { $ne: false },
  }).lean();

  const [loads, lasts] = await Promise.all([
    countOpenLeadsByAssignee(companyId),
    lastAssignedAtByAssignee(companyId),
  ]);

  const toCandidate = (m: (typeof memberships)[number]): AssignmentCandidate => ({
    userId: String(m.userId),
    role: m.role as 'company_admin' | 'agent',
    openLeadCount: loads.get(String(m.userId)) ?? 0,
    lastAssignedAt: lasts.get(String(m.userId)) ?? 0,
  });

  const agents = memberships.filter((m) => m.role === 'agent').map(toCandidate);
  if (agents.length) return agents;
  return memberships.filter((m) => m.role === 'company_admin').map(toCandidate);
}

/**
 * Least-loaded round-robin: the agent with the fewest open leads wins, and among
 * equals the one who has waited longest for a lead. Sorting by open load rather than
 * a stored pointer means the queue self-corrects — an agent who closes ten leads is
 * back at the front, and a manual reassignment is taken into account immediately.
 */
export function pickNextAssignee(candidates: AssignmentCandidate[]): AssignmentCandidate | null {
  if (!candidates.length) return null;
  return [...candidates].sort(
    (a, b) =>
      a.openLeadCount - b.openLeadCount ||
      a.lastAssignedAt - b.lastAssignedAt ||
      a.userId.localeCompare(b.userId),
  )[0]!;
}

async function autoAssignEnabled(companyId: string): Promise<boolean> {
  const company = await CompanyModel.findById(new Types.ObjectId(companyId))
    .select('settings')
    .lean();
  const settings = (company?.settings ?? {}) as Record<string, unknown>;
  // Opt-out rather than opt-in: a workspace that never touches the setting still gets
  // its leads distributed.
  return settings.autoAssignLeads !== false;
}

/**
 * Assigns a brand-new lead. No-op when the chat already has an owner, so a retried
 * webhook delivery cannot bounce a lead between agents.
 */
export async function autoAssignChat(
  companyId: string,
  chatId: string,
): Promise<string | null> {
  if (!(await autoAssignEnabled(companyId))) return null;

  const candidates = await listAssignmentCandidates(companyId);
  const pick = pickNextAssignee(candidates);
  if (!pick) {
    logger.warn('Lead auto-assign skipped: no available member', { companyId, chatId });
    return null;
  }

  const now = new Date();
  // The `assignedTo: null` guard makes the whole thing idempotent under concurrent
  // inbound messages — only the first write lands.
  const res = await ChatModel.updateOne(
    {
      _id: new Types.ObjectId(chatId),
      companyId: new Types.ObjectId(companyId),
      $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }],
    },
    {
      $set: {
        assignedTo: new Types.ObjectId(pick.userId),
        assignedAt: now,
        assignmentMethod: 'auto',
      },
    },
  );
  if (!res.modifiedCount) return null;

  emitToCompany(companyId, 'lead:assigned', {
    chatId,
    assignedTo: pick.userId,
    method: 'auto',
  });
  await logActivity({
    companyId,
    action: 'lead.auto_assigned',
    resource: 'chat',
    resourceId: chatId,
    meta: { assignedTo: pick.userId, openLeadCount: pick.openLeadCount },
  });
  logger.info('Lead auto-assigned', { companyId, chatId, assignedTo: pick.userId });
  return pick.userId;
}

/** Manual reassignment by an admin. Passing null puts the lead back in the pool. */
export async function reassignChat(input: {
  companyId: string;
  chatId: string;
  actorUserId: string;
  assignedTo: string | null;
}): Promise<void> {
  const companyOid = new Types.ObjectId(input.companyId);

  if (input.assignedTo) {
    const member = await MembershipModel.findOne({
      companyId: companyOid,
      userId: new Types.ObjectId(input.assignedTo),
      deletedAt: null,
    }).lean();
    if (!member) throw new Error('That user is not a member of this workspace');
  }

  const update = input.assignedTo
    ? {
        $set: {
          assignedTo: new Types.ObjectId(input.assignedTo),
          assignedAt: new Date(),
          assignedBy: new Types.ObjectId(input.actorUserId),
          assignmentMethod: 'manual' as const,
        },
      }
    : {
        $unset: { assignedTo: '', assignedAt: '', assignedBy: '', assignmentMethod: '' },
      };

  const res = await ChatModel.updateOne(
    { _id: new Types.ObjectId(input.chatId), companyId: companyOid, deletedAt: null },
    update,
  );
  if (!res.matchedCount) throw new Error('Chat not found');

  emitToCompany(input.companyId, 'lead:assigned', {
    chatId: input.chatId,
    assignedTo: input.assignedTo,
    method: 'manual',
  });
  await logActivity({
    companyId: input.companyId,
    userId: input.actorUserId,
    action: input.assignedTo ? 'lead.reassigned' : 'lead.unassigned',
    resource: 'chat',
    resourceId: input.chatId,
    meta: { assignedTo: input.assignedTo },
  });
}

/** Releases every open lead held by a member who is leaving the workspace. */
export async function unassignLeadsOf(companyId: string, userId: string): Promise<number> {
  const res = await ChatModel.updateMany(
    {
      companyId: new Types.ObjectId(companyId),
      assignedTo: new Types.ObjectId(userId),
      status: openLeadStatusFilter(),
      deletedAt: null,
    },
    { $unset: { assignedTo: '', assignedAt: '', assignedBy: '', assignmentMethod: '' } },
  );
  if (res.modifiedCount) {
    emitToCompany(companyId, 'lead:bulk-unassigned', { userId, count: res.modifiedCount });
  }
  return res.modifiedCount;
}

/**
 * Spreads every currently unassigned open lead across the rotation. Exposed as a
 * button so an admin can fill a newly hired agent's queue without touching leads
 * one by one.
 */
export async function distributeUnassignedLeads(input: {
  companyId: string;
  actorUserId: string;
}): Promise<{ assigned: number }> {
  const candidates = await listAssignmentCandidates(input.companyId);
  if (!candidates.length) return { assigned: 0 };

  const pending = await ChatModel.find({
    companyId: new Types.ObjectId(input.companyId),
    deletedAt: null,
    status: openLeadStatusFilter(),
    $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }],
  })
    .sort({ lastMessageAt: 1 })
    .select('_id')
    .lean();

  // The in-memory copy is re-sorted after each pick, so a fresh agent absorbs the
  // backlog until they are level with everyone else.
  const pool = [...candidates];
  let assigned = 0;
  for (const chat of pending) {
    const pick = pickNextAssignee(pool);
    if (!pick) break;
    const now = new Date();
    const res = await ChatModel.updateOne(
      {
        _id: chat._id,
        $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }],
      },
      {
        $set: {
          assignedTo: new Types.ObjectId(pick.userId),
          assignedAt: now,
          assignedBy: new Types.ObjectId(input.actorUserId),
          assignmentMethod: 'manual',
        },
      },
    );
    if (!res.modifiedCount) continue;
    pick.openLeadCount += 1;
    pick.lastAssignedAt = now.getTime();
    assigned += 1;
  }

  if (assigned) {
    emitToCompany(input.companyId, 'lead:distributed', { assigned });
    await logActivity({
      companyId: input.companyId,
      userId: input.actorUserId,
      action: 'lead.bulk_distributed',
      resource: 'chat',
      meta: { assigned },
    });
  }
  return { assigned };
}
