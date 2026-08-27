// Persistent rate limiter using Upstash Redis (via Vercel KV)
const RATE_LIMIT = 10; // requests per window
const RATE_WINDOW_SECONDS = 60 * 60; // 1 hour

async function checkRateLimit(ip) {
  const key = `ratelimit:${ip}`;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    console.warn('KV not configured, skipping rate limit');
    return { allowed: true };
  }

  const incrRes = await fetch(`${url}/incr/${key}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const { result: count } = await incrRes.json();

  if (count === 1) {
    await fetch(`${url}/expire/${key}/${RATE_WINDOW_SECONDS}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  if (count > RATE_LIMIT) {
    const ttlRes = await fetch(`${url}/ttl/${key}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { result: ttl } = await ttlRes.json();
    const resetIn = Math.max(1, Math.ceil(ttl / 60));
    return { allowed: false, resetIn };
  }

  return { allowed: true, remaining: RATE_LIMIT - count };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim()
          || req.headers['x-real-ip']
          || 'unknown';

  const limitCheck = await checkRateLimit(ip);
  if (!limitCheck.allowed) {
    return res.status(429).json({
      error: `The scribe grows weary. You've commissioned enough letters for now — please return in about ${limitCheck.resetIn} minute${limitCheck.resetIn === 1 ? '' : 's'}.`
    });
  }

  try {
    const { recipient, situation, letterType, toneKey, toneGuide, intensity, sender } = req.body;

    if (!situation || !toneGuide) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

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

STRICT RULES ON LANGUAGE:
- Do NOT use em dashes (—). Use periods, commas, semicolons, or parentheses instead.
- Do NOT open with "I write to you", "It grieves me", "It has come to my attention", or "I write not in anger". Invent a fresh, voice-appropriate opening every time.
- Do NOT use the phrases "the very fabric of", "in these trying times", "words cannot express", or "I felt compelled to". These are banned.
- Vary your sentence structures. Do not start consecutive sentences the same way.
- Avoid the word "furthermore" and "moreover". Find fresher transitions.

GENERAL RULES:
- Fully commit to the voice. The humor comes from total sincerity within an absurd register.
- Reference specific details from the client's situation. Invent small supporting flourishes that fit.
- Keep it to roughly 150-300 words. A letter, not a saga.
- Return ONLY the letter text itself (including a salutation and sign-off). No preamble, no markdown, no explanation.`;

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
        temperature: 1.0,
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
