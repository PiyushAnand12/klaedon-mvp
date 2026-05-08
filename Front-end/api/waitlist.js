const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const PRODUCT = 'klaedon';

let supabase = null;

function getSupabase() {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY/SUPABASE_SERVICE_KEY');
  }

  supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabase;
}

function bad(res, message, code = 400, extra = {}) {
  return res.status(code).json({ success: false, message, ...extra });
}

function normalizeText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function emailOk(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email || '');
}

function getIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isDuplicateError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === '23505' || msg.includes('duplicate');
}

function isColumnError(error, column) {
  const msg = String(error?.message || '').toLowerCase();
  const col = String(column || '').toLowerCase();
  return msg.includes(col) && (msg.includes('column') || msg.includes('schema cache'));
}

function stripUnsupportedLeadColumns(payload, error) {
  const next = { ...payload };
  if (isColumnError(error, 'product')) delete next.product;
  if (isColumnError(error, 'role')) delete next.role;
  return next;
}

function logSupabaseError(label, error, extra = {}) {
  console.error(label, {
    message: error?.message || null,
    details: error?.details || null,
    hint: error?.hint || null,
    code: error?.code || null,
    status: error?.status || null,
    name: error?.name || null,
    extra,
    raw: error,
  });
}

async function getRecentSignupCountByIpHash(client, ipHash) {
  const windowMinutes = Number(process.env.WAITLIST_RATE_LIMIT_WINDOW_MINUTES || 10);
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const { count, error } = await client
    .from('waitlist_leads')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', since);

  if (error) {
    const msg = String(error.message || '').toLowerCase();
    const schemaIssue =
      msg.includes('schema cache') ||
      msg.includes('column') ||
      msg.includes('ip_hash');

    if (schemaIssue) return 0;
    throw error;
  }

  return count || 0;
}

async function getExistingLeadByEmail(client, email) {
  try {
    const byProduct = await client
      .from('waitlist_leads')
      .select('id, email, role, product')
      .eq('email', email)
      .eq('product', PRODUCT)
      .limit(1)
      .maybeSingle();

    if (!byProduct.error && byProduct.data?.id) {
      return byProduct.data;
    }

    if (byProduct.error && !isColumnError(byProduct.error, 'product')) {
      throw byProduct.error;
    }
  } catch (error) {
    if (!isColumnError(error, 'product')) throw error;
  }

  const fallback = await client
    .from('waitlist_leads')
    .select('id, email, role')
    .eq('email', email)
    .limit(1)
    .maybeSingle();

  if (fallback.error) throw fallback.error;
  return fallback.data || null;
}

async function backfillExistingLead(client, lead, updates) {
  if (!lead?.id) return;

  const patch = {};
  if (!lead.role && updates.role) patch.role = updates.role;
  if (!lead.product && updates.product) patch.product = updates.product;

  if (!Object.keys(patch).length) return;

  try {
    const { error } = await client
      .from('waitlist_leads')
      .update(patch)
      .eq('id', lead.id);

    if (error) throw error;
  } catch (error) {
    const reducedPatch = { ...patch };
    if (isColumnError(error, 'role')) delete reducedPatch.role;
    if (isColumnError(error, 'product')) delete reducedPatch.product;

    if (!Object.keys(reducedPatch).length) return;

    const retry = await client
      .from('waitlist_leads')
      .update(reducedPatch)
      .eq('id', lead.id);

    if (retry.error) {
      logSupabaseError('waitlist backfill warning:', retry.error, { leadId: lead.id });
    }
  }
}

async function insertLead(client, payload) {
  let { data, error } = await client
    .from('waitlist_leads')
    .insert([payload])
    .select('id')
    .single();

  if (!error) {
    return { data, error: null };
  }

  const stripped = stripUnsupportedLeadColumns(payload, error);
  const changed = Object.keys(stripped).length !== Object.keys(payload).length;

  if (!changed) {
    return { data: null, error };
  }

  const retry = await client
    .from('waitlist_leads')
    .insert([stripped])
    .select('id')
    .single();

  return { data: retry.data, error: retry.error || null };
}

module.exports = async (req, res) => {
  // CORS Headers for Vercel
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;
  try {
    client = getSupabase();
  } catch (error) {
    return bad(res, error.message || 'Supabase init failed', 500);
  }

  try {
    const body = req.body || {};

    const email = normalizeText(body.email, 200).toLowerCase();
    const role = normalizeText(body.role, 80);
    const consent = body.consent === true;
    const honeypot = normalizeText(body.honeypot, 200);

    if (honeypot) {
      return bad(res, 'Bot detected.', 400);
    }

    if (!emailOk(email)) {
      return bad(res, 'Valid email is required.', 400, {
        errors: { email: 'Enter a valid email address.' },
      });
    }

    if (!consent) {
      return bad(res, 'Consent is required.', 400, {
        errors: { consent: 'Consent is required.' },
      });
    }

    const ip = getIp(req);
    const salt = process.env.IP_HASH_SALT || '';
    const ipHash = ip ? sha256(ip + salt) : null;

    const rateLimitMax = Number(process.env.WAITLIST_RATE_LIMIT_MAX || 5);

    const [signupCount, existingLead] = await Promise.all([
      ipHash ? getRecentSignupCountByIpHash(client, ipHash) : Promise.resolve(0),
      getExistingLeadByEmail(client, email),
    ]);

    if (ipHash && signupCount >= rateLimitMax) {
      return bad(res, 'Too many attempts. Try again later.', 429);
    }

    if (existingLead?.id) {
      await backfillExistingLead(client, existingLead, {
        role,
        product: PRODUCT,
      });

      return res.json({
        success: true,
        lead_id: existingLead.id,
        existing: true,
      });
    }

    const leadPayload = {
      product: PRODUCT,
      email,
      role: role || null,
      consent: true,
      referrer: body.referrer || req.headers['referer'] || null,
      ip_hash: ipHash,
      status: 'new',
      utm_source: body.utm_source || null,
      utm_medium: body.utm_medium || null,
      utm_campaign: body.utm_campaign || null,
      utm_term: body.utm_term || null,
      utm_content: body.utm_content || null,
    };

    const inserted = await insertLead(client, leadPayload);

    if (inserted.error) {
      if (isDuplicateError(inserted.error)) {
        const duplicateLead = await getExistingLeadByEmail(client, email);

        return res.json({
          success: true,
          lead_id: duplicateLead?.id || null,
          existing: true,
        });
      }

      logSupabaseError('waitlist insert error:', inserted.error, {
        table: 'waitlist_leads',
        payloadKeys: Object.keys(leadPayload),
      });
      throw inserted.error;
    }

    return res.json({
      success: true,
      lead_id: inserted.data.id,
      existing: false,
    });
  } catch (error) {
    logSupabaseError('waitlist lead error:', error, { route: '/api/waitlist' });
    return bad(res, 'Failed to save waitlist lead.', 500);
  }
};
