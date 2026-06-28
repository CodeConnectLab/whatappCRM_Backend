import bcrypt from "bcrypt";
import mongoose, { Types } from "mongoose";
import { env } from "../config/env.js";
import { slugify } from "../utils/slug.js";
import { encryptSecret } from "../utils/encryption.js";
import { CompanyModel } from "../modules/company/company.model.js";
import { MembershipModel } from "../modules/company/membership.model.js";
import { UserModel } from "../modules/user/user.model.js";
import { WalletModel } from "../modules/wallet/wallet.model.js";
import { TransactionModel } from "../modules/wallet/transaction.model.js";
import { TwilioAccountModel } from "../modules/twilio/twilio-account.model.js";
import { WhatsappNumberModel } from "../modules/twilio/whatsapp-number.model.js";
import { ContactModel } from "../modules/contact/contact.model.js";
import { ContactGroupModel } from "../modules/contact/contact-group.model.js";
import { TemplateModel } from "../modules/template/template.model.js";
import { CampaignModel } from "../modules/campaign/campaign.model.js";
import { ChatModel } from "../modules/chat/chat.model.js";
import { MessageModel } from "../modules/chat/message.model.js";
import { MediaModel } from "../modules/media/media.model.js";
import { ActivityLogModel } from "../modules/activity/activity-log.model.js";
import { ensureWallet, creditCredits } from "../modules/wallet/wallet.service.js";
const DEMO_EMAIL = (process.env.SEED_DEMO_EMAIL ?? "demo@demo.local").toLowerCase().trim();
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "DemoPass123!";
const COMPANY_NAME = process.env.SEED_COMPANY_NAME ?? "Demo Workspace";
const EXTRA_CONTACTS = [
  { phone: "+15550002001", name: "Amit Patel", tags: ["vip"] },
  { phone: "+15550002002", name: "Neha Gupta", tags: ["newsletter"] },
  { phone: "+15550002003", name: "Vikram Singh", tags: [] },
  { phone: "+15550002004", name: "Ananya Iyer", tags: ["vip", "newsletter"] },
  { phone: "+15550001001", name: "Priya Sharma", tags: [] },
  { phone: "+15550001002", name: "Rahul Verma", tags: [] },
  { phone: "+15550002005", name: "Karishma Khan", tags: ["support"] },
  { phone: "+15550002006", name: "Dev Malhotra", tags: ["lead"] }
];
const CHAT_SEED_CONTACTS = [
  ...EXTRA_CONTACTS.map((c) => ({ phone: c.phone, name: c.name })),
  { phone: "+15550003001", name: "Sana Mir" },
  { phone: "+15550003002", name: "Arjun Bose" },
  { phone: "+15550003003", name: "Meera Joshi" },
  { phone: "+15550003004", name: "Kiran Rao" }
];
function demoChatThread() {
  return [
    { direction: "inbound", body: "Hi! I saw your ad. Is this a good time to chat?" },
    { direction: "outbound", body: "Hi there \u2014 yes, we are here. What would you like to know?", status: "sent" },
    { direction: "inbound", body: "Do you have a starter plan for small teams?" },
    {
      direction: "outbound",
      body: "Yes. We have a starter tier\u2014happy to send details.",
      status: "delivered"
    },
    { direction: "inbound", body: "Perfect. Please share pricing and a short demo link." },
    {
      direction: "outbound",
      body: "Sent you a PDF and a 5\u2011minute demo link. Let me know if it opens OK.",
      status: "read"
    },
    { direction: "inbound", body: "Got it \u2014 the PDF opens fine. One question on billing." },
    {
      direction: "outbound",
      body: "Sure \u2014 we bill monthly; you can cancel anytime.",
      status: "delivered"
    },
    { direction: "inbound", body: "Great, I will discuss with my team and get back tomorrow." },
    {
      direction: "outbound",
      body: "Sounds good. Ping us anytime on this thread.",
      status: "read"
    }
  ];
}
async function ensureDemoPrincipal() {
  let user = await UserModel.findOne({ email: DEMO_EMAIL, deletedAt: null });
  if (!user) {
    const slug = slugify(COMPANY_NAME);
    let company = await CompanyModel.findOne({ slug, deletedAt: null });
    if (!company) {
      company = await CompanyModel.create({ name: COMPANY_NAME, slug });
    }
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    user = await UserModel.create({
      email: DEMO_EMAIL,
      passwordHash,
      name: "Demo Admin"
    });
    await MembershipModel.create({
      userId: user._id,
      companyId: company._id,
      role: "company_admin"
    });
    await ensureWallet(String(company._id));
    await creditCredits(String(company._id), 500, "seed_demo_balance", { seed: true });
    console.log("Created demo user & company", { email: DEMO_EMAIL, company: company.name });
  }
  const m = await MembershipModel.findOne({ userId: user._id, deletedAt: null }).lean();
  if (!m?.companyId) throw new Error("Demo user has no company membership");
  return { companyId: new Types.ObjectId(String(m.companyId)), userId: new Types.ObjectId(String(user._id)) };
}
async function ensureTwilioAndNumber(companyId) {
  let account = await TwilioAccountModel.findOne({ companyId, deletedAt: null }).lean();
  if (!account) {
    const doc = await TwilioAccountModel.create({
      companyId,
      accountSid: "AC00000000000000000000000000000000",
      authTokenEncrypted: encryptSecret("dummy-local-twilio-auth-token"),
      friendlyName: "Local dev (seed)"
    });
    account = doc.toObject();
  }
  let wa = await WhatsappNumberModel.findOne({ companyId, deletedAt: null }).lean();
  if (!wa) {
    const doc = await WhatsappNumberModel.create({
      companyId,
      provider: "twilio",
      twilioAccountId: account._id,
      phoneNumber: "+15550001111",
      friendlyName: "Demo WhatsApp line",
      isDefault: true
    });
    wa = doc.toObject();
  }
  return { whatsappNumberId: new Types.ObjectId(String(wa._id)) };
}
async function upsertTemplates(companyId) {
  const defs = [
    { name: "Welcome", body: "Hi {{name}}, welcome to our WhatsApp updates!", language: "en" },
    {
      name: "Promo Friday",
      body: "Hey {{name}} \u2014 Friday special: 20% off. Reply YES for details.",
      language: "en",
      imageUrl: "https://images.unsplash.com/photo-1607082348824-a0b3587a89ee?w=800&q=80&auto=format&fit=crop"
    },
    {
      name: "Order update",
      body: "Hi {{name}}, your order is on the way. Track: https://example.com/track",
      language: "en"
    },
    {
      name: "Appt reminder",
      body: "Reminder {{name}}: you have an appointment booked. Questions? Call {{phone}}.",
      language: "en"
    },
    {
      name: "Payment link",
      body: "Hello {{name}}, your invoice is ready. Reply PAY and we will send a secure link to {{email}}.",
      language: "en"
    },
    {
      name: "Feedback",
      body: "Thanks {{name}}! How would you rate our support? Reply 1\u20135.",
      language: "en"
    },
    {
      name: "Holiday hours",
      body: "Hi {{name}}, we are closed Dec 25\u201326. Urgent? Reply URGENT for on-call.",
      language: "en"
    },
    {
      name: "Product launch",
      body: "Big news {{name}}: new dashboard is live \u2014 https://example.com/new",
      language: "en",
      imageUrl: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80&auto=format&fit=crop"
    },
    {
      name: "Re-engagement",
      body: "We miss you {{name}}! Here is a 15% comeback code: BACK15",
      language: "en"
    }
  ];
  const ids = [];
  for (const t of defs) {
    const doc = await TemplateModel.findOneAndUpdate(
      { companyId, name: t.name, deletedAt: null },
      {
        $set: {
          body: t.body,
          language: t.language,
          ...t.imageUrl ? { imageUrl: t.imageUrl } : {}
        },
        $setOnInsert: { companyId, name: t.name }
      },
      { upsert: true, new: true }
    ).lean();
    if (doc?._id) ids.push(new Types.ObjectId(String(doc._id)));
  }
  return ids;
}
async function seedContacts(companyId) {
  const ids = [];
  for (const c of EXTRA_CONTACTS) {
    const doc = await ContactModel.findOneAndUpdate(
      { companyId, phone: c.phone },
      { $set: { name: c.name, tags: [...c.tags], deletedAt: null }, $setOnInsert: { companyId, phone: c.phone } },
      { upsert: true, new: true }
    ).lean();
    if (doc?._id) ids.push(new Types.ObjectId(String(doc._id)));
  }
  return ids;
}
async function seedGroups(companyId, contactIds) {
  const vip = contactIds.filter((_, i) => EXTRA_CONTACTS[i]?.tags?.includes("vip"));
  const newsletter = contactIds.filter((_, i) => EXTRA_CONTACTS[i]?.tags?.includes("newsletter"));
  await ContactGroupModel.findOneAndUpdate(
    { companyId, name: "VIP customers" },
    { $set: { contactIds: vip.length ? vip : contactIds.slice(0, 2), deletedAt: null }, $setOnInsert: { companyId, name: "VIP customers" } },
    { upsert: true }
  );
  await ContactGroupModel.findOneAndUpdate(
    { companyId, name: "Newsletter" },
    {
      $set: { contactIds: newsletter.length ? newsletter : contactIds.slice(2, 5), deletedAt: null },
      $setOnInsert: { companyId, name: "Newsletter" }
    },
    { upsert: true }
  );
}
async function seedCampaigns(companyId, templateId, whatsappNumberId, contactIds) {
  const draftCount = await CampaignModel.countDocuments({ companyId, name: "Spring nurture (draft)", deletedAt: null });
  if (!draftCount) {
    await CampaignModel.create({
      companyId,
      name: "Spring nurture (draft)",
      status: "draft",
      templateId,
      whatsappNumberId,
      contactIds: contactIds.slice(0, 4),
      stats: { total: 0, sent: 0, failed: 0 }
    });
  }
  const doneCount = await CampaignModel.countDocuments({ companyId, name: "Friday flash (completed)", deletedAt: null });
  if (!doneCount) {
    await CampaignModel.create({
      companyId,
      name: "Friday flash (completed)",
      status: "completed",
      templateId,
      whatsappNumberId,
      contactIds: contactIds.slice(0, 6),
      stats: { total: 100, sent: 96, failed: 4 }
    });
  }
}
async function seedChats(companyId, whatsappNumberId, senderUserId, contactSubset) {
  const append = process.env.SEED_APPEND_MESSAGES === "1" || process.env.SEED_APPEND_MESSAGES === "true";
  const forceReseed = process.env.SEED_FORCE_CHAT_SEED === "1" || process.env.SEED_FORCE_CHAT_SEED === "true";
  for (const contact of contactSubset) {
    let cdoc = await ContactModel.findOne({ companyId, phone: contact.phone, deletedAt: null });
    if (!cdoc) {
      cdoc = await ContactModel.create({ companyId, phone: contact.phone, name: contact.name });
    }
    let chat = await ChatModel.findOne({ companyId, contactId: cdoc._id, whatsappNumberId, deletedAt: null });
    if (!chat) {
      chat = await ChatModel.create({ companyId, contactId: cdoc._id, whatsappNumberId });
    }
    const existingCount = await MessageModel.countDocuments({ companyId, chatId: chat._id, deletedAt: null });
    if (forceReseed && existingCount > 0) {
      await MessageModel.deleteMany({ companyId, chatId: chat._id, deletedAt: null });
    }
    const countAfter = await MessageModel.countDocuments({ companyId, chatId: chat._id, deletedAt: null });
    if (countAfter > 0 && !append && !forceReseed) continue;
    const templates = demoChatThread();
    const baseOffset = append ? countAfter * 12e4 : 0;
    const now = Date.now();
    const docs = templates.map((t, i) => {
      const createdAt = new Date(now - (templates.length - i) * 6e4 - baseOffset);
      const outboundStatus = t.direction === "outbound" ? t.status ?? "delivered" : void 0;
      return {
        companyId,
        chatId: chat._id,
        direction: t.direction,
        body: t.body,
        ...t.direction === "outbound" ? { status: outboundStatus, senderUserId } : { status: "read" },
        createdAt,
        updatedAt: createdAt
      };
    });
    await MessageModel.insertMany(docs);
    const last = templates[templates.length - 1];
    await ChatModel.updateOne(
      { _id: chat._id },
      {
        $set: {
          lastMessageAt: docs[docs.length - 1]?.createdAt ?? /* @__PURE__ */ new Date(),
          lastMessagePreview: last.body.slice(0, 140),
          unreadCount: templates.filter((x) => x.direction === "inbound").length
        }
      }
    );
  }
}
async function seedMediaAndActivity(companyId, userId) {
  const existing = await MediaModel.countDocuments({ companyId, deletedAt: null });
  if (existing < 2) {
    await MediaModel.create({
      companyId,
      key: `companies/${String(companyId)}/media/seed-banner.png`,
      url: "https://placehold.co/600x200/png",
      mimeType: "image/png",
      size: 1024,
      uploadedBy: userId
    });
    await MediaModel.create({
      companyId,
      key: `companies/${String(companyId)}/media/seed-flyer.pdf`,
      url: "https://example.com/demo-flyer.pdf",
      mimeType: "application/pdf",
      size: 2048,
      uploadedBy: userId
    });
  }
  const logCount = await ActivityLogModel.countDocuments({ companyId });
  if (logCount < 3) {
    await ActivityLogModel.create({
      companyId,
      userId,
      action: "seed.demo_run",
      resource: "company",
      resourceId: companyId,
      meta: { at: (/* @__PURE__ */ new Date()).toISOString() }
    });
  }
}
async function ensureSampleTransaction(companyId) {
  const n = await TransactionModel.countDocuments({ companyId });
  if (n > 0) return;
  const w = await WalletModel.findOne({ companyId }).lean();
  if (!w) return;
  await TransactionModel.create({
    companyId,
    type: "credit",
    amount: 100,
    balanceAfter: w.balance,
    reason: "seed_opening",
    ref: { seed: true }
  });
}
async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const { companyId, userId } = await ensureDemoPrincipal();
  await ensureWallet(String(companyId));
  await ensureSampleTransaction(companyId);
  const { whatsappNumberId } = await ensureTwilioAndNumber(companyId);
  const templateIds = await upsertTemplates(companyId);
  const contactIds = await seedContacts(companyId);
  await seedGroups(companyId, contactIds);
  const mainTemplate = templateIds[0];
  if (mainTemplate) await seedCampaigns(companyId, mainTemplate, whatsappNumberId, contactIds);
  await seedChats(companyId, whatsappNumberId, userId, CHAT_SEED_CONTACTS);
  await seedMediaAndActivity(companyId, userId);
  const w = await WalletModel.findOne({ companyId }).lean();
  console.log("Demo seed complete.", {
    loginEmail: DEMO_EMAIL,
    loginPassword: "(see SEED_DEMO_PASSWORD / default DemoPass123!)",
    companyId: String(companyId),
    walletBalance: w?.balance,
    demoChats: CHAT_SEED_CONTACTS.length,
    templatesUpserted: templateIds.length
  });
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
