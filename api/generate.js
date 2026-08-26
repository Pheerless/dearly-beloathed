// Simple in-memory rate limiter (per Vercel function instance)
const rateLimitStore = new Map();
const RATE_LIMIT = 10; // requests per window
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now - record.windowStart > RATE_WINDOW_MS) {
    // New window
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  if (record.count >= RATE_LIMIT) {
    const resetIn = Math.ceil((RATE_WINDOW_MS - (now - record.windowStart)) / 60000);
    return { allowed: false, resetIn };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT - record.count };
}

// Clean up old entries periodically to prevent memory bloat
function cleanupOldEntries() {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now - record.windowStart > RATE_WINDOW_MS) {
      rateLimitStore.delete(ip);
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get client IP (Vercel forwards it in this header)
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim()
          || req.headers['x-real-ip']
          || 'unknown';

  // Rate limit check
  const limitCheck = checkRateLimit(ip);
  if (!limitCheck.allowed) {
    return res.status(429).json({
      error: `The scribe grows weary. You've commissioned enough letters for now — please return in about ${limitCheck.resetIn} minute${limitCheck.resetIn === 1 ? '' : 's'}.`
    });
  }

  // Occasional cleanup (1% of requests)
  if (Math.random() < 0.01) cleanupOldEntries();

  try {
    const { recipient, situation, letterType, toneKey, toneGuide, intensity, sender } = req.body;

    if (!situation || !toneGuide) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Input length guardrails (prevent giant prompts eating credits)
    if (situation.length > 2000 || (recipient || '').length > 200 || (sender || '').length > 200) {
      return res.status(400).json({ error: 'Please keep your inputs under a reasonable length.' });
    }

    const prompt = `You are the head scribe of The Royal Correspondence Bureau, a tongue-in-cheek service that writes gloriously theatrical letters for everyday situations.

Write a ${letterType.toLowerCase()} letter with these specifications:

RECIPIENT: ${recipient}
THE SITUATION (from the client): ${situation}
SIGNED BY: ${sender}
VOICE/STYLE: ${toneGuide}
INTENSITY LEVEL: ${intensity}/5 (1 = gentle and restrained, 5 = maximum theatrical fury/passion — but always comedic, never genuinely cruel, threatening, or harassing)

Rules:
- Fully commit to the voice. The humor comes from total sincerity within an absurd register.
- Reference specific details from the client's situation; invent small supporting flourishes that fit.
- Keep it to roughly 150-300 words. A letter, not a saga.
- Return ONLY the letter text itself (including a salutation and sign-off), no preamble, no markdown, no explanation.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', errorText);
      return res.status(500).json({ error: 'The raven was lost in a storm.' });
    }

    const data = await response.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');

    if (!textBlock) {
      return res.status(500).json({ error: 'No letter returned' });
    }

    return res.status(200).json({ letter: textBlock.text.trim() });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'The raven was lost in a storm.' });
  }
}
