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

    const prompt = `あなたは株式アナリストです。以下の銘柄について、最新のニュースや市場動向をふまえて分析してください。

各銘柄について、まず会社名（"name"）を日本語で記載してください（例："トヨタ自動車"、"NVIDIA"）。

それぞれの「上昇要因」と「下落要因」を分析してください。

各要因には必ず「影響度」を付けてください。影響度は次の3段階で評価します：
- "強"：株価を大きく動かす可能性が高い要因
- "中"：ある程度の影響が見込まれる要因
- "弱"：限定的な影響にとどまる要因

各要因について、必ずWeb検索を行い、その根拠となった具体的なニュース記事を特定してください。そして、その記事の「発行日」を "date"（例："2026-06-28"）、媒体名を "source"（例："日経新聞"、"Reuters"）、記事のURLを "url" として必ず付けてください。Web検索をして実際の記事を見つけてから要因を書いてください。日付が本当に特定できない場合のみ "date" を空文字 "" にしてください。URLも特定できない場合のみ空文字 "" にしてください。

また、現在の株価水準からの今後の方向性を、短期（1か月以内）・中期（1〜3か月）・長期（3か月〜1年）の3つの期間別に予測してください。それぞれ "up"（上昇）/"flat"（横ばい）/"down"（下降）のいずれかと、その可能性の度合い（"高"/"中"/"低"）、および一言の理由を付けてください。これはあくまで参考予測であり確実なものではない前提で構いません。

さらに、現在のチャートのテクニカル分析を行ってください。Web検索で現在の株価、移動平均線（25日・75日など）、RSI、MACD、出来高、サポート/レジスタンスなどの情報を可能な範囲で調べ、テクニカル的に見た上昇/下落の可能性を判断してください。"direction"（up/flat/down）、"probability"（高/中/低）、主要な根拠を3つ程度の "signals"（配列）、および "summary"（総括・40文字以内）を付けてください。正確な数値が得られない場合は、入手できた範囲の情報で判断して構いません。

さらに、各銘柄について「今後4か月以内に予定されている、株価に影響を及ぼしそうなイベント」も調べてください。例：決算発表、新製品発表、株主総会、製品ローンチ、規制当局の判断期日、重要な業界カンファレンスなど。予定が見つからない場合は空配列にしてください。

対象銘柄：${tickerList}

以下のJSON形式のみで回答してください（前置きや説明は不要）：
{
  "analysis": [
    {
      "ticker": "銘柄コード",
      "name": "会社名",
      "sentiment": "up または down または neutral",
      "summary": "一言での総括（30文字以内）",
      "forecast": {
        "short": { "direction": "up/flat/down", "probability": "高/中/低", "reason": "理由（短め）" },
        "mid": { "direction": "up/flat/down", "probability": "高/中/低", "reason": "理由（短め）" },
        "long": { "direction": "up/flat/down", "probability": "高/中/低", "reason": "理由（短め）" }
      },
      "technical": {
        "direction": "up/flat/down",
        "probability": "高/中/低",
        "signals": ["根拠1", "根拠2", "根拠3"],
        "summary": "総括（40文字以内）"
      },
      "bullish": [
        { "text": "上昇要因の内容", "impact": "強 または 中 または 弱", "date": "YYYY-MM-DD", "source": "媒体名", "url": "記事URL" }
      ],
      "bearish": [
        { "text": "下落要因の内容", "impact": "強 または 中 または 弱", "date": "YYYY-MM-DD", "source": "媒体名", "url": "記事URL" }
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
        max_tokens: 4000,
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
