// Persistent rate limiter using Upstash Redis (via Vercel KV)
const RATE_LIMIT = 10; // requests per window
const RATE_WINDOW_SECONDS = 60 * 60; // 1 hour

async function checkRateLimit(ip) {
  const key = `ratelimit:${ip}`;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    // Fail open if KV isn't configured — better to serve than to block everyone
    console.warn('KV not configured, skipping rate limit');
    return { allowed: true };
  }

  // Atomically increment counter
  const incrRes = await fetch(`${url}/incr/${key}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const { result: count } = await incrRes.json();

  // If this is the first hit in the window, set expiry
  if (count === 1) {
    await fetch(`${url}/expire/${key}/${RATE_WINDOW_SECONDS}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  if (count > RATE_LIMIT) {
    // Get remaining TTL for a helpful error message
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

  // Rate limit check
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
        if(!response.ok || !data.letter){
      const errorMsg = data.error || "The raven was lost in a storm.";
      $("desk").innerHTML = `<div class="error-box"><p><strong>${errorMsg}</strong></p><p style="margin-top:8px;font-size:14px">Press the seal once more when ready.</p></div>`;
      btn.disabled = false;
      return;
    }

    return res.status(200).json({ letter: textBlock.text.trim() });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'The raven was lost in a storm.' });
  }
}
