/**
 * PawBook AI Controller
 * POST /api/v1/ai/chat
 * Calls Claude claude-haiku-4-5 with PawBook system context.
 * Auth is optional — works for guests and logged-in users.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 400;

const SYSTEM_PROMPT = `You are PawBook AI, a friendly and knowledgeable pet care assistant built into the PawBook app — India's leading pet social platform.

PawBook features:
- Find a Vet: book in-clinic (₹300–₹1,000), video (₹200–₹500), or home-visit (₹800–₹2,000) consultations
- Vaccination Diary: track vaccines, get auto-reminders, share PDF records
- Lost & Found: report or find lost/stray pets, 10km radius alerts
- Adoption: 1,200+ dogs and 600+ cats from verified shelters across India and UAE
- Marketplace: buy/sell pet food, accessories, grooming tools, responsibly-bred pets
- Pet Insurance: Basic ₹500/month, Standard ₹900/month, Premium ₹1,500/month
- Grooming & Training: find certified groomers and trainers near you
- Groups & Community: 500+ local and breed-specific groups
- Emergency: 24hr vet clinics, first aid tips, SOS button
- Discover Map: find vets, groomers, pet shops, shelters near you on live Google Maps

Emergency contacts (24×7):
- Delhi: Cessna Lifeline +91 98102 60604
- Mumbai: Bombay Vet College +91 22 2419 4071
- Bangalore: CUPA +91 80 2334 1086
- Chennai: Blue Cross +91 44 2235 1074
- Dubai: Dubai Vet Hospital +971 4 349 4646

Support: support@deemona.com | Deemona Global Solutions, New Delhi 110075

Guidelines:
- Keep responses SHORT (2–5 sentences or a brief list). The widget is small.
- Be warm, friendly, and use 1–2 relevant emojis.
- For medical emergencies, always give the emergency numbers above AND advise to rush to a vet immediately.
- For questions outside pet care or PawBook, politely redirect: "I'm specialized in pet care — let me help with that instead!"
- Never make up prices, phone numbers, or facts not listed above.
- If the user asks about their specific appointments, pets, or records, explain you can see general info but they should check their PawBook profile for personal data.
- Respond in the same language the user writes in (Hindi, English, etc.).`;

async function chat(req, res) {
  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'message is required' });
    }

    if (message.trim().length > 500) {
      return res.status(400).json({ success: false, message: 'message too long (max 500 chars)' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ success: false, message: 'AI service not configured' });
    }

    // Build messages array — keep last 6 turns max to save tokens
    const messages = [];
    const recentHistory = Array.isArray(history) ? history.slice(-6) : [];
    for (const h of recentHistory) {
      if (h.role && h.content && typeof h.content === 'string') {
        messages.push({ role: h.role, content: h.content.substring(0, 300) });
      }
    }
    messages.push({ role: 'user', content: message.trim() });

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[PawBook AI] Anthropic error:', response.status, err);
      return res.status(502).json({ success: false, message: 'AI service error' });
    }

    const data = await response.json();
    const reply = data?.content?.[0]?.text || 'Sorry, I could not generate a response. Please try again.';

    return res.json({ success: true, message: 'Success', data: { reply } });

  } catch (err) {
    console.error('[PawBook AI] chat error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { chat };
