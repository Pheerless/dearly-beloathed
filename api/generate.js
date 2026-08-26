export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { recipient, situation, letterType, toneKey, toneGuide, intensity, sender } = req.body;

    // Basic validation
    if (!situation || !toneGuide) {
      return res.status(400).json({ error: 'Missing required fields' });
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
