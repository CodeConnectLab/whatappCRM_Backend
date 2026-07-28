import { Types } from 'mongoose';
import { ContactModel } from './contact.model.js';
import { ContactGroupModel } from './contact-group.model.js';
import { parsePagination, paginate } from '../../utils/pagination.js';
const UTF8_BOM = '\uFEFF';
/** Minimal CSV line parser (handles quoted fields and doubled quotes). */
function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                }
                else {
                    inQuotes = false;
                }
            }
            else {
                cur += ch;
            }
        }
        else if (ch === '"') {
            inQuotes = true;
        }
        else if (ch === ',') {
            out.push(cur.trim());
            cur = '';
        }
        else {
            cur += ch;
        }
    }
    out.push(cur.trim());
    return out;
}
function normalizeHeader(h) {
    return h
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
}
function normalizePhone(raw) {
    return raw.replace(/[\s\-\u00A0()]/g, '').trim();
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function downloadContactImportTemplate(_req, res) {
    const header = 'phone,name,email';
    const example = '+15551234560,Sample Contact,sample@example.com';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts-import-template.csv"');
    res.send(`${UTF8_BOM}${header}\n${example}\n`);
}
export async function listContacts(req, res) {
    const companyId = req.companyId;
    const opts = parsePagination(req.query);
    const q = typeof req.query.search === 'string' ? req.query.search : '';
    const filter = {
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    };
    if (q.trim()) {
        filter.$text = { $search: q };
    }
    const result = await paginate(ContactModel, filter, opts);
    res.json(result);
}
export async function createContact(req, res) {
    const companyId = req.companyId;
    const { phone, name, email, tags } = req.body;
    const c = await ContactModel.create({
        companyId: new Types.ObjectId(companyId),
        phone,
        name,
        email,
        tags,
    });
    res.status(201).json(c);
}
export async function updateContact(req, res) {
    const companyId = req.companyId;
    const { id } = req.params;
    const body = req.body;
    const c = await ContactModel.findOneAndUpdate({ _id: id, companyId: new Types.ObjectId(companyId), deletedAt: null }, { $set: body }, { new: true });
    if (!c) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(c);
}
export async function deleteContact(req, res) {
    const companyId = req.companyId;
    const { id } = req.params;
    await ContactModel.updateOne({ _id: id, companyId: new Types.ObjectId(companyId) }, { $set: { deletedAt: new Date() } });
    res.json({ ok: true });
}
export async function importContactsCsv(req, res) {
    const companyId = req.companyId;
    const file = req.file;
    const bodyGroup = typeof req.body?.groupName === 'string'
        ? req.body.groupName.trim()
        : typeof req.body?.group === 'string'
            ? req.body.group.trim()
            : '';
    if (!file?.buffer) {
        res.status(400).json({ error: 'CSV file required (field name: file)' });
        return;
    }
    let text = file.buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) {
        text = text.slice(1);
    }
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
        res.json({
            imported: 0,
            rowsProcessed: 0,
            groupsUpdated: [],
            groupAssigned: null,
            skipped: 0,
            errors: [],
        });
        return;
    }
    const rawHeader = parseCsvLine(lines[0]);
    const header = rawHeader.map(normalizeHeader);
    const phoneIdx = header.indexOf('phone');
    const mobileIdx = header.indexOf('mobile');
    const phoneNumberIdx = header.indexOf('phone_number');
    const phoneColumn = phoneIdx >= 0 ? phoneIdx : mobileIdx >= 0 ? mobileIdx : phoneNumberIdx >= 0 ? phoneNumberIdx : -1;
    if (phoneColumn < 0) {
        res.status(400).json({
            error: 'CSV must include a "phone" column (or "mobile" / "phone number"). Use the downloadable template.',
        });
        return;
    }
    const nameIdx = header.indexOf('name');
    const emailIdx = header.indexOf('email');
    const importedIds = [];
    const seenIdHex = new Set();
    const errors = [];
    let imported = 0;
    let skipped = 0;
    const oid = new Types.ObjectId(companyId);
    for (let i = 1; i < lines.length; i++) {
        const lineNum = i + 1;
        const cols = parseCsvLine(lines[i]);
        const phoneRaw = cols[phoneColumn] ?? '';
        const phone = normalizePhone(phoneRaw);
        if (!phone) {
            skipped++;
            continue;
        }
        const nameVal = nameIdx >= 0 ? cols[nameIdx]?.trim() : '';
        const emailRaw = emailIdx >= 0 ? cols[emailIdx]?.trim() : '';
        let email;
        if (emailRaw) {
            const lower = emailRaw.toLowerCase();
            if (!EMAIL_RE.test(lower)) {
                errors.push({ line: lineNum, message: `Invalid email for phone ${phone}` });
                skipped++;
                continue;
            }
            email = lower;
        }
        try {
            const doc = await ContactModel.findOneAndUpdate({ companyId: oid, phone }, {
                $set: {
                    ...(nameVal ? { name: nameVal } : {}),
                    ...(email ? { email } : {}),
                    deletedAt: null,
                },
                $setOnInsert: { companyId: oid, phone },
            }, { new: true, upsert: true, runValidators: true });
            if (!doc) {
                errors.push({ line: lineNum, message: 'Could not save contact' });
                skipped++;
                continue;
            }
            imported++;
            const cid = doc._id;
            const hex = cid.toHexString();
            if (!seenIdHex.has(hex)) {
                seenIdHex.add(hex);
                importedIds.push(cid);
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Save failed';
            errors.push({ line: lineNum, message: msg });
            skipped++;
        }
    }
    const groupsUpdated = [];
    if (bodyGroup && importedIds.length > 0) {
        await ContactGroupModel.updateOne({ companyId: oid, name: bodyGroup, deletedAt: null }, {
            $addToSet: { contactIds: { $each: importedIds } },
            $setOnInsert: { companyId: oid, name: bodyGroup, deletedAt: null },
        }, { upsert: true });
        groupsUpdated.push(bodyGroup);
    }
    res.json({
        imported,
        rowsProcessed: lines.length - 1,
        groupsUpdated,
        groupAssigned: bodyGroup || null,
        skipped,
        errors: errors.slice(0, 50),
    });
}
export async function listGroups(req, res) {
    const companyId = req.companyId;
    const rows = await ContactGroupModel.find({
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    }).lean();
    res.json(rows);
}
export async function createGroup(req, res) {
    const companyId = req.companyId;
    const { name, contactIds } = req.body;
    const g = await ContactGroupModel.create({
        companyId: new Types.ObjectId(companyId),
        name,
        contactIds: contactIds.map((id) => new Types.ObjectId(id)),
    });
    res.status(201).json(g);
}
export async function updateGroup(req, res) {
    const companyId = req.companyId;
    const { id } = req.params;
    const { name, contactIds } = req.body;
    const g = await ContactGroupModel.findOneAndUpdate({ _id: id, companyId: new Types.ObjectId(companyId), deletedAt: null }, {
        $set: {
            ...(name ? { name } : {}),
            ...(contactIds ? { contactIds: contactIds.map((c) => new Types.ObjectId(c)) } : {}),
        },
    }, { new: true });
    if (!g) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(g);
}
