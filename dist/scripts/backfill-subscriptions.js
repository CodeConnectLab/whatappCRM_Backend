/**
 * Seeds `company.subscription` on rows that predate the field.
 *
 * From backend/:  npm run backfill:subscriptions
 *
 * Must run before the subscription guard ships: `isExpired` treats a company with no
 * `endDate` as expired, so without this every existing workspace locks out on deploy.
 * Scoped to documents that have no term yet, so a re-run cannot overwrite real values.
 *
 * Env overrides:
 *   BACKFILL_TRIAL_DAYS  — days of runway to grant (default 30)
 *   BACKFILL_USER_LIMIT  — seats to grant (default 3)
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { CompanyModel } from '../modules/company/company.model.js';
const TRIAL_DAYS = Number(process.env.BACKFILL_TRIAL_DAYS ?? 30);
const USER_LIMIT = Number(process.env.BACKFILL_USER_LIMIT ?? 3);
async function main() {
    if (!Number.isFinite(TRIAL_DAYS) || TRIAL_DAYS < 1) {
        throw new Error('BACKFILL_TRIAL_DAYS must be a positive number');
    }
    if (!Number.isFinite(USER_LIMIT) || USER_LIMIT < 1) {
        throw new Error('BACKFILL_USER_LIMIT must be at least 1');
    }
    await mongoose.connect(env.MONGODB_URI);
    const now = new Date();
    const filter = { deletedAt: null, 'subscription.endDate': { $exists: false } };
    const pending = await CompanyModel.countDocuments(filter);
    const result = await CompanyModel.updateMany(filter, {
        $set: {
            subscription: {
                plan: 'free',
                status: 'active',
                startDate: now,
                endDate: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
                userLimit: USER_LIMIT,
                priceAmount: 0,
                currency: 'INR',
                gstPercent: 18,
                billingCycle: 'monthly',
                notes: '',
            },
        },
    });
    console.log('Subscription backfill complete.', {
        companiesNeedingBackfill: pending,
        modified: result.modifiedCount,
        trialDays: TRIAL_DAYS,
        userLimit: USER_LIMIT,
    });
    await mongoose.disconnect();
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
