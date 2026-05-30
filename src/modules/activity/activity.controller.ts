import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { ActivityLogModel } from './activity-log.model.js';
import { parsePagination } from '../../utils/pagination.js';

export async function listActivityLogs(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const opts = parsePagination(req.query as Record<string, unknown>);
  const filter = { companyId: new Types.ObjectId(companyId) };
  const skip = (opts.page - 1) * opts.limit;
  const sortField: Record<string, 1 | -1> = { [opts.sort]: opts.order === 'asc' ? 1 : -1 };

  const [data, total] = await Promise.all([
    ActivityLogModel.find(filter)
      .sort(sortField)
      .skip(skip)
      .limit(opts.limit)
      .populate('userId', 'name email')
      .lean(),
    ActivityLogModel.countDocuments(filter),
  ]);

  res.json({ data, total, page: opts.page, limit: opts.limit });
}
