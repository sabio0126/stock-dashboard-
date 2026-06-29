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

各要因には必ず「影響度」を付けてください。影響度は次の3段階で評価します：
- "強"：株価を大きく動かす可能性が高い要因
- "中"：ある程度の影響が見込まれる要因
- "弱"：限定的な影響にとどまる要因

各要因について、その根拠となったニュースの日付も "date" として付けてください（例："2026-06-28"）。日付が不明な場合は空文字 "" にしてください。

さらに、各銘柄について「今後2か月以内に予定されている、株価に影響を及ぼしそうなイベント」も調べてください。例：決算発表、新製品発表、株主総会、製品ローンチ、規制当局の判断期日、重要な業界カンファレンスなど。予定が見つからない場合は空配列にしてください。

対象銘柄：${tickerList}

以下のJSON形式のみで回答してください（前置きや説明は不要）：
{
  "analysis": [
    {
      "ticker": "銘柄コード",
      "sentiment": "up または down または neutral",
      "summary": "一言での総括（30文字以内）",
      "bullish": [
        { "text": "上昇要因の内容", "impact": "強 または 中 または 弱", "date": "YYYY-MM-DD" }
      ],
      "bearish": [
        { "text": "下落要因の内容", "impact": "強 または 中 または 弱", "date": "YYYY-MM-DD" }
      ],
      "events": [
        { "date": "YYYY-MM-DD", "title": "イベント名", "impact": "強 または 中 または 弱" }
      ]
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
        max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    const textContent = data.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(200).json({ raw: textContent });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // 使用トークン数を取得して概算料金を計算（Haiku 4.5: 入力$1 / 出力$5 per 1M）
    const usage = data.usage || {};
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const costUsd = (inputTokens * 1 / 1000000) + (outputTokens * 5 / 1000000);

    parsed.usage = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd
    };

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
