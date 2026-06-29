export default async function handler(req, res) {
  // CORS設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'APIキーが設定されていません' });
  }

  try {
    const { tickers } = req.body;
    const tickerList = Array.isArray(tickers) ? tickers.join('、') : 'NVDA、AAPL、7203';

    const prompt = `あなたは株式アナリストです。以下の銘柄について、最新のニュースや市場動向をふまえて、それぞれの「上昇要因」と「下落要因」を分析してください。

対象銘柄：${tickerList}

以下のJSON形式のみで回答してください（前置きや説明は不要）：
{
  "analysis": [
    {
      "ticker": "銘柄コード",
      "sentiment": "up または down または neutral",
      "summary": "一言での総括（30文字以内）",
      "bullish": ["上昇要因1", "上昇要因2"],
      "bearish": ["下落要因1", "下落要因2"]
    }
  ]
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    // テキスト部分を抽出
    const textContent = data.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    // JSON部分を抽出
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(200).json({ raw: textContent });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
