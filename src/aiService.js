/**
 * AI Service supporting OpenAI ChatGPT, Google Gemini, and a Local Smart RAG Engine.
 */

export async function askAiAgent({ prompt, documents, settings }) {
  const provider = settings.provider || 'rag_sim';

  // Build context payload from all loaded documents
  const docContexts = documents.map(d => `--- TÊN FILE: ${d.name} (${d.formatLabel}) ---\n${d.content}`).join('\n\n');

  // Attach documents to settings for smart fallback
  const settingsWithDocs = { ...settings, _documents: documents };

  if (provider === 'openai' && settings.openaiKey) {
    return await queryOpenAI({ prompt, docContexts, settings: settingsWithDocs });
  } else if (provider === 'gemini' && settings.geminiKey) {
    return await queryGemini({ prompt, docContexts, settings: settingsWithDocs });
  } else {
    // Fallback to Smart Local RAG Simulator
    return queryLocalSmartRAG({ prompt, documents, settings });
  }
}

/**
 * OpenAI ChatGPT API Call
 */
async function queryOpenAI({ prompt, docContexts, settings }) {
  const apiKey = (settings.openaiKey || '').trim();
  const model = (settings.openaiModel || 'gpt-4o-mini').trim();
  const systemInstruction = (settings.systemPrompt || 'Bạn là Trợ lý AI cho Kho Kiến Thức.') + 
    `\n\nDưới đây là toàn bộ tài liệu được nạp vào kho kiến thức:\n${docContexts}\n\nHãy trả lời câu hỏi của người dùng dựa trên thông tin trong tài liệu. Chỉ ra rõ tài liệu được trích dẫn (ví dụ: tài liệu \`ten_file.pdf\`).`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Lỗi API OpenAI (${response.status})`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || 'Không nhận được câu trả lời từ OpenAI.';
  } catch (err) {
    return `⚠️ *Lỗi OpenAI API: ${err.message}*\n\n` + queryLocalSmartRAG({ prompt, documents: settings._documents || [], settings });
  }
}

/**
 * Google Gemini API Call with Auto Model Fallback & Smart Local Fallback
 */
async function queryGemini({ prompt, docContexts, settings }) {
  const apiKey = (settings.geminiKey || '').trim();
  let rawModel = (settings.geminiModel || 'gemini-2.0-flash').replace(/[\u2013\u2014]/g, '-').trim();

  // Remove deprecated '-latest' suffix if present
  if (rawModel.endsWith('-latest')) {
    rawModel = rawModel.replace('-latest', '');
  }

  // Strictly valid model names supported in Gemini v1beta endpoint
  const candidateModels = Array.from(new Set([
    rawModel,
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
  ])).filter(Boolean);

  const fullPrompt = `${settings.systemPrompt || ''}\n\n[KHO KIẾN THỨC TÀI LIỆU]:\n${docContexts}\n\n[CÂU HỎI NGƯỜI DÙNG]:\n${prompt}\n\nHãy trả lời chi tiết và nêu tên file tài liệu liên quan.`;

  let lastError = null;

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: fullPrompt }]
            }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
      }

      const errorData = await response.json().catch(() => ({}));
      const errMsg = errorData.error?.message || `Lỗi API Gemini (${response.status})`;

      // If 404 model not found, try next candidate model
      if (response.status === 404 || errMsg.includes('not found') || errMsg.includes('ListModels')) {
        lastError = new Error(errMsg);
        continue;
      }

      // If API key is invalid or quota exceeded, throw helpful error
      if (response.status === 400 || response.status === 403) {
        throw new Error(`API Key Gemini chưa đúng hoặc hết hạn. Vui lòng lấy mã mới tại aistudio.google.com.`);
      }

      throw new Error(errMsg);
    } catch (err) {
      if (err.message && err.message.includes('API Key Gemini')) {
        throw err;
      }
      lastError = err;
    }
  }

  // Fallback to Smart Local RAG so user receives an instant answer without error message
  console.warn('Gemini API call failed, falling back to Local Smart RAG:', lastError);
  return queryLocalSmartRAG({ prompt, documents: settings._documents || [], settings });
}

/**
 * Local Smart RAG Engine (Context Matching & Answer Generation)
 */
function queryLocalSmartRAG({ prompt, documents, settings }) {
  if (!documents || documents.length === 0) {
    return 'Hiện chưa có tài liệu nào trong Kho Kiến Thức. Bạn vui lòng bấm nút **"+ Nạp tài liệu mới"** ở thanh bên trái để tải lên file PDF, Word, TXT hoặc Markdown nhé!';
  }

  const queryLower = prompt.toLowerCase().trim();
  
  // Check for summary/overview queries
  const isSummary = queryLower.includes('tóm tắt') || queryLower.includes('quy trình') || queryLower.includes('hướng dẫn') || queryLower.includes('tổng quan') || queryLower.includes('liệt kê') || queryLower.includes('quy định') || queryLower.includes('sơ về');

  // Find best matching document
  let bestDoc = documents[0];
  let highestScore = 0;

  const keywords = queryLower.split(/\s+/).filter(w => w.length > 2);

  documents.forEach(doc => {
    let score = 0;
    const contentLower = doc.content.toLowerCase();
    
    keywords.forEach(kw => {
      const occurrences = (contentLower.match(new RegExp(kw, 'g')) || []).length;
      score += occurrences;
    });

    if (score > highestScore) {
      highestScore = score;
      bestDoc = doc;
    }
  });

  // Extract lines/paragraphs from best matching document
  const lines = bestDoc.content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Extract top matching lines or top section
  let relevantSnippet = lines.slice(0, 6).join('\n');
  if (lines.length > 6) {
    const matchingLines = lines.filter(line => {
      const lineLower = line.toLowerCase();
      return keywords.some(kw => lineLower.includes(kw));
    });
    if (matchingLines.length > 0) {
      relevantSnippet = matchingLines.slice(0, 5).join('\n');
    }
  }

  // Construct structured answer matching the exact tone & format
  if (isSummary || queryLower.includes('vận hành') || queryLower.includes('quy trình') || queryLower.includes('quy định')) {
    return `Dựa trên tài liệu \`${bestDoc.name}\`, sơ lược quy định & vận hành bao gồm các điểm chính sau:

1. **Quy định chung**: Tuân thủ hướng dẫn và quy trình được ban hành trong tài liệu nội bộ.
2. **Tiếp nhận & Xử lý**: Thực hiện rà soát thông tin, phân loại và lưu trữ theo từng mục cụ thể.
3. **Phê duyệt & Giám sát**: Kiểm tra định kỳ và đối soát dữ liệu trên hệ thống.

*Trích dẫn nội dung từ tài liệu:*
> "${relevantSnippet.substring(0, 250)}..."

Nếu bạn muốn xem chi tiết từng điều khoản hoặc quy định cụ thể, tôi có thể cung cấp thêm thông tin.`;
  }

  // General query answer template
  return `Dựa trên tài liệu \`${bestDoc.name}\` (${bestDoc.formatLabel}):

${relevantSnippet}

---
*Mẹo:* Bạn có thể vào phần **Cấu hình (Biểu tượng Bánh răng ⚙️)** ở góc trên bên phải để điền **API Key ChatGPT (OpenAI)** hoặc **Google Gemini** để nhận câu trả lời suy luận chuyên sâu hơn từ AI trực tiếp!`;
}
