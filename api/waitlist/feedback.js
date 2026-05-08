const { createClient } = require('@supabase/supabase-js');

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

function normalizeLeadId(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

function normalizeTopNeeds(value) {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .map((item) => normalizeText(item, 60))
    .filter(Boolean);

  return [...new Set(cleaned)].slice(0, 10);
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
    const leadId = normalizeLeadId(body.lead_id);

    if (!leadId) {
      return bad(res, 'lead_id is required.', 400);
    }

    const { data: lead, error: leadError } = await client
      .from('waitlist_leads')
      .select('id')
      .eq('id', leadId)
      .maybeSingle();

    if (leadError) throw leadError;
    if (!lead) {
      return bad(res, 'Invalid lead_id.', 400);
    }

    const allowedDelivery = new Set(['email', 'whatsapp', 'both']);
    const allowedPrice = new Set(['0-199', '200-499', '500-999', '1000+']);

    const topNeeds = normalizeTopNeeds(body.top_needs);
    const delivery = normalizeText(body.delivery_preference, 40) || 'email';
    const price = normalizeText(body.price_expectation, 40) || '0-199';
    const freeText = normalizeText(body.free_text, 500) || null;

    const feedbackPayload = {
      lead_id: leadId,
      top_needs: topNeeds,
      delivery_preference: allowedDelivery.has(delivery) ? delivery : 'email',
      price_expectation: allowedPrice.has(price) ? price : '0-199',
      free_text: freeText,
    };

    const { error: feedbackError } = await client
      .from('waitlist_feedback')
      .insert([feedbackPayload]);

    if (feedbackError) {
      logSupabaseError('waitlist feedback insert error:', feedbackError, {
        table: 'waitlist_feedback',
      });
      throw feedbackError;
    }

    return res.json({ success: true });
  } catch (error) {
    logSupabaseError('waitlist feedback error:', error, { route: '/api/waitlist/feedback' });
    return bad(res, 'Failed to save feedback.', 500);
  }
};
