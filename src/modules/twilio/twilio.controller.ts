import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { MongoServerError } from 'mongodb';
import { TwilioAccountModel } from './twilio-account.model.js';
import { WhatsappNumberModel } from './whatsapp-number.model.js';
import { encryptSecret } from '../../utils/encryption.js';

/** Soft-deleted rows keep unique indexes unless phone is renamed on tombstone. */
async function releasePhoneFromTombstones(
  companyOid: Types.ObjectId,
  phoneNumber: string,
): Promise<void> {
  const tombstones = await WhatsappNumberModel.find({
    companyId: companyOid,
    phoneNumber,
    deletedAt: { $ne: null },
  })
    .select('_id')
    .lean();

  for (const row of tombstones) {
    await WhatsappNumberModel.updateOne(
      { _id: row._id },
      { $set: { phoneNumber: `${phoneNumber}#archived-${String(row._id)}` } },
    );
  }
}

export async function upsertTwilioAccount(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { accountSid, authToken, friendlyName } = req.body as {
    accountSid: string;
    authToken: string;
    friendlyName?: string;
  };

  const authTokenEncrypted = encryptSecret(authToken);
  const doc = await TwilioAccountModel.findOneAndUpdate(
    { companyId: new Types.ObjectId(companyId), accountSid },
    {
      $set: { authTokenEncrypted, friendlyName, deletedAt: null },
      $setOnInsert: { companyId: new Types.ObjectId(companyId), accountSid },
    },
    { upsert: true, new: true },
  );
  res.json({ id: doc._id, accountSid: doc.accountSid, friendlyName: doc.friendlyName });
}

export async function listTwilioAccounts(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const rows = await TwilioAccountModel.find({
    companyId: new Types.ObjectId(companyId),
    deletedAt: null,
  }).lean();
  res.json(rows.map((r) => ({ id: r._id, accountSid: r.accountSid, friendlyName: r.friendlyName })));
}

export async function upsertWhatsappNumber(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const body = req.body as {
    provider?: 'twilio' | 'meta';
    twilioAccountId?: string;
    metaPhoneNumberId?: string;
    phoneNumber: string;
    friendlyName?: string;
    isDefault?: boolean;
  };
  const provider = body.provider ?? 'twilio';
  const companyOid = new Types.ObjectId(companyId);

  await releasePhoneFromTombstones(companyOid, body.phoneNumber);

  const existingMeta =
    provider === 'meta'
      ? await WhatsappNumberModel.findOne({
          companyId: companyOid,
          provider: 'meta',
          deletedAt: null,
        })
          .sort({ isDefault: -1, updatedAt: -1 })
          .lean()
      : null;

  const isDefault =
    body.isDefault ?? (provider === 'meta' ? (existingMeta?.isDefault ?? true) : false);

  if (isDefault) {
    await WhatsappNumberModel.updateMany(
      { companyId: companyOid, provider },
      { $set: { isDefault: false } },
    );
  }

  const setDoc: Record<string, unknown> = {
    provider,
    phoneNumber: body.phoneNumber,
    friendlyName: body.friendlyName,
    isDefault,
    deletedAt: null,
  };

  const unsetDoc: Record<string, ''> = {};
  if (provider === 'twilio') {
    setDoc.twilioAccountId = new Types.ObjectId(body.twilioAccountId!);
    unsetDoc.metaPhoneNumberId = '';
  } else {
    setDoc.metaPhoneNumberId = body.metaPhoneNumberId!.trim();
    unsetDoc.twilioAccountId = '';
  }

  try {
    if (provider === 'meta') {
      const doc = await WhatsappNumberModel.findOneAndUpdate(
        { companyId: companyOid, provider: 'meta', deletedAt: null },
        {
          $set: setDoc,
          $unset: unsetDoc,
          $setOnInsert: { companyId: companyOid },
        },
        { upsert: true, new: true, sort: { isDefault: -1, updatedAt: -1 } },
      );

      const duplicates = await WhatsappNumberModel.find({
        companyId: companyOid,
        provider: 'meta',
        deletedAt: null,
        _id: { $ne: doc!._id },
      })
        .select('_id phoneNumber')
        .lean();

      const now = new Date();
      for (const dup of duplicates) {
        await WhatsappNumberModel.updateOne(
          { _id: dup._id },
          {
            $set: {
              deletedAt: now,
              isDefault: false,
              phoneNumber: `${dup.phoneNumber}#archived-${String(dup._id)}`,
            },
          },
        );
      }

      res.json(doc);
      return;
    }

    const { phoneNumber: _phone, ...twilioFields } = setDoc;
    const doc = await WhatsappNumberModel.findOneAndUpdate(
      { companyId: companyOid, phoneNumber: body.phoneNumber },
      {
        $set: twilioFields,
        $unset: unsetDoc,
        $setOnInsert: { companyId: companyOid, phoneNumber: body.phoneNumber },
      },
      { upsert: true, new: true },
    );
    res.json(doc);
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) {
      const key = String(e.message);
      if (key.includes('metaPhoneNumberId')) {
        res.status(409).json({
          error: 'This Meta phone number ID is already linked to another workspace',
        });
        return;
      }
      if (key.includes('phoneNumber')) {
        res.status(409).json({
          error: 'This phone number is already registered for this workspace',
        });
        return;
      }
    }
    throw e;
  }
}

export async function listWhatsappNumbers(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const rows = await WhatsappNumberModel.find({
    companyId: new Types.ObjectId(companyId),
    deletedAt: null,
  }).lean();
  res.json(rows);
}
