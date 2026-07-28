import { parseDocumentFile, formatBytes } from './documentParser.js';
import { askAiAgent } from './aiService.js';
import { marked } from 'marked';

// Maximum storage limit in bytes (100 MB)
const MAX_STORAGE_BYTES = 100 * 1024 * 1024;

// Default initial documents - EMPTY CLEAN STATE
const DEFAULT_DOCUMENTS = [];

// Default initial chat messages - CLEAN BLANK WELCOME
const DEFAULT_MESSAGES = [
  {
    sender: 'bot',
    text: 'Xin chào! Kho Kiến Thức hiện đang trống.\nBạn vui lòng bấm nút **"+ Nạp tài liệu mới"** ở menu bên trái để tải lên file Word (.doc, .docx), PDF, PowerPoint (.ppt, .pptx), TXT hoặc Markdown nhé!',
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
];

let state = {
  documents: JSON.parse(localStorage.getItem('kk_documents')) || DEFAULT_DOCUMENTS,
  messages: JSON.parse(localStorage.getItem('kk_messages')) || DEFAULT_MESSAGES,
  theme: localStorage.getItem('kk_theme') || 'dark',
  settings: JSON.parse(localStorage.getItem('kk_settings')) || {
    provider: 'rag_sim',
    openaiKey: '',
    openaiModel: 'gpt-4o-mini',
    geminiKey: '',
    geminiModel: 'gemini-1.5-flash',
    systemPrompt: 'Bạn là Trợ lý AI chuyên nghiệp cho Kho Kiến Thức. Nhiệm vụ của bạn là đọc các tài liệu được cung cấp và trả lời câu hỏi một cách chính xác, trích dẫn đúng tên file tài liệu.'
  }
};

const docList = document.getElementById('docList');
const storagePercentText = document.getElementById('storagePercentText');
const storageProgressBar = document.getElementById('storageProgressBar');
const storageText = document.getElementById('storageText');
const chatHistory = document.getElementById('chatHistory');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const clearDocsBtn = document.getElementById('clearDocsBtn');
const clearChatBtn = document.getElementById('clearChatBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');

const uploadModal = document.getElementById('uploadModal');
const openUploadModalBtn = document.getElementById('openUploadModalBtn');
const closeUploadModalBtn = document.getElementById('closeUploadModalBtn');
const cancelUploadBtn = document.getElementById('cancelUploadBtn');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');

const settingsModal = document.getElementById('settingsModal');
const openSettingsModalBtn = document.getElementById('openSettingsModalBtn');
const closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const resetSettingsBtn = document.getElementById('resetSettingsBtn');
const aiProviderSelect = document.getElementById('aiProviderSelect');
const openaiFields = document.getElementById('openaiFields');
const geminiFields = document.getElementById('geminiFields');
const openaiKeyInput = document.getElementById('openaiKeyInput');
const openaiModelSelect = document.getElementById('openaiModelSelect');
const geminiKeyInput = document.getElementById('geminiKeyInput');
const geminiModelSelect = document.getElementById('geminiModelSelect');
const systemPromptInput = document.getElementById('systemPromptInput');

const previewModal = document.getElementById('previewModal');
const previewModalTitle = document.getElementById('previewModalTitle');
const previewMetaInfo = document.getElementById('previewMetaInfo');
const previewTextBox = document.getElementById('previewTextBox');
const closePreviewModalBtn = document.getElementById('closePreviewModalBtn');
const closePreviewBtn = document.getElementById('closePreviewBtn');

function init() {
  applyTheme(state.theme);
  saveState();
  renderDocuments();
  renderStorageMeter();
  renderChatMessages();
  setupEventListeners();
  setupCursorGlow();
}

/**
 * Interactive Cursor Position Tracking for Dynamic Color Spotlight
 */
function setupCursorGlow() {
  window.addEventListener('mousemove', (e) => {
    const x = (e.clientX / window.innerWidth) * 100;
    const y = (e.clientY / window.innerHeight) * 100;
    document.documentElement.style.setProperty('--mouse-x', `${x}%`);
    document.documentElement.style.setProperty('--mouse-y', `${y}%`);
  });
}

function saveState() {
  localStorage.setItem('kk_documents', JSON.stringify(state.documents));
  localStorage.setItem('kk_messages', JSON.stringify(state.messages));
  localStorage.setItem('kk_settings', JSON.stringify(state.settings));
  localStorage.setItem('kk_theme', state.theme);
}

function applyTheme(theme) {
  document.body.className = theme === 'light' ? 'light-theme' : 'dark-theme';
}

function renderDocuments() {
  docList.innerHTML = '';

  if (state.documents.length === 0) {
    docList.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 35px 10px; font-size: 13px; border: 1px dashed var(--border-card); border-radius: 12px; background: rgba(236, 72, 153, 0.02);">
        📁 Kho tài liệu trống.<br>Hãy bấm <strong>"+ Nạp tài liệu mới"</strong> bên dưới.
      </div>
    `;
    return;
  }

  state.documents.forEach((doc, idx) => {
    const card = document.createElement('div');
    const isActive = doc.active || idx === 0;
    card.className = `doc-card ${isActive ? 'active' : ''}`;
    card.dataset.id = doc.id;

    const ext = (doc.extension || 'file').toLowerCase();
    const iconClass = ['pdf', 'txt', 'md', 'docx', 'doc', 'pptx', 'ppt'].includes(ext) ? ext : 'txt';

    card.innerHTML = `
      <div class="doc-icon ${iconClass}">
        <span>${doc.formatLabel || ext.toUpperCase()}</span>
      </div>
      <div class="doc-info">
        <div class="doc-title" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</div>
        <div class="doc-sub">${doc.sizeFormatted} • ${doc.formatLabel}</div>
      </div>
      <div class="doc-actions">
        <button class="doc-action-btn preview-btn" title="Xem nội dung">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
        <button class="doc-action-btn delete-btn" title="Xóa tài liệu">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;

    card.querySelector('.preview-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openPreviewModal(doc);
    });

    card.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteDocument(doc.id);
    });

    card.addEventListener('click', () => {
      state.documents.forEach(d => d.active = false);
      doc.active = true;
      renderDocuments();
      openPreviewModal(doc);
    });

    docList.appendChild(card);
  });
}

function renderStorageMeter() {
  const totalBytes = state.documents.reduce((sum, d) => sum + (d.size || 0), 0);
  const percentage = Math.min(100, (totalBytes / MAX_STORAGE_BYTES) * 100).toFixed(1);
  const usedFormatted = formatBytes(totalBytes);

  storagePercentText.textContent = `${percentage}%`;
  storageProgressBar.style.width = `${percentage}%`;
  storageText.textContent = `Đã dùng ${usedFormatted} / 100 MB`;
}

function deleteDocument(docId) {
  if (confirm('Bạn có chắc chắn muốn xóa tài liệu này?')) {
    state.documents = state.documents.filter(d => d.id !== docId);
    saveState();
    renderDocuments();
    renderStorageMeter();
  }
}

function clearAllDocuments() {
  if (confirm('⚠️ Bạn có chắc chắn muốn XÓA TẤT CẢ TÀI LIỆU không?')) {
    state.documents = [];
    saveState();
    renderDocuments();
    renderStorageMeter();
  }
}

function clearChatHistory() {
  if (confirm('⚠️ Bạn có chắc chắn muốn XÓA KHU VỰC CHAT không?')) {
    state.messages = [
      {
        sender: 'bot',
        text: '🧹 Lịch sử trò chuyện đã được làm sạch.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
    saveState();
    renderChatMessages();
  }
}

function renderChatMessages() {
  chatHistory.innerHTML = '';
  state.messages.forEach(msg => {
    appendChatMessageElement(msg);
  });
  scrollToBottom();
}

function appendChatMessageElement(msg) {
  const msgEl = document.createElement('div');
  msgEl.className = `chat-message ${msg.sender}`;

  const isBot = msg.sender === 'bot';
  const avatarSvg = isBot ? `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="11" width="18" height="10" rx="2"/>
      <circle cx="12" cy="5" r="2"/>
      <path d="M12 7v4"/>
    </svg>
  ` : `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  `;

  let formattedBody = msg.text;
  if (isBot && !msg.text.includes('<span')) {
    try {
      formattedBody = marked.parse(msg.text);
    } catch {
      formattedBody = `<p>${escapeHtml(msg.text).replace(/\n/g, '<br>')}</p>`;
    }
  }

  const checkmark = !isBot ? `<span style="color: #ec4899; margin-left: 4px;">✓✓</span>` : '';

  msgEl.innerHTML = `
    <div class="msg-avatar">
      ${avatarSvg}
    </div>
    <div class="msg-bubble-container">
      <div class="msg-bubble">
        ${formattedBody}
      </div>
      <div class="msg-timestamp">${msg.time}${checkmark}</div>
    </div>
  `;

  chatHistory.appendChild(msgEl);
}

function showTypingIndicator() {
  const typingEl = document.createElement('div');
  typingEl.className = 'chat-message bot';
  typingEl.id = 'typingIndicatorMsg';
  typingEl.innerHTML = `
    <div class="msg-avatar">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="10" rx="2"/>
        <circle cx="12" cy="5" r="2"/>
      </svg>
    </div>
    <div class="msg-bubble-container">
      <div class="msg-bubble" style="padding: 12px 18px;">
        <span style="color: var(--neon-pink);">⚡ AI Agent đang phân tích & suy luận...</span>
      </div>
    </div>
  `;
  chatHistory.appendChild(typingEl);
  scrollToBottom();
}

function removeTypingIndicator() {
  const typingEl = document.getElementById('typingIndicatorMsg');
  if (typingEl) typingEl.remove();
}

function scrollToBottom() {
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

async function handleSendMessage(e) {
  if (e) e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const userMsg = { sender: 'user', text: text, time: nowTime };
  state.messages.push(userMsg);
  appendChatMessageElement(userMsg);
  chatInput.value = '';
  scrollToBottom();
  saveState();

  showTypingIndicator();
  sendBtn.disabled = true;

  try {
    const aiAnswer = await askAiAgent({
      prompt: text,
      documents: state.documents,
      settings: state.settings
    });

    removeTypingIndicator();

    const botMsg = {
      sender: 'bot',
      text: aiAnswer,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    state.messages.push(botMsg);
    appendChatMessageElement(botMsg);
    saveState();
  } catch (err) {
    removeTypingIndicator();
    const errorMsg = {
      sender: 'bot',
      text: `❌ Có lỗi: ${err.message || 'Lỗi xử lý'}`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    state.messages.push(errorMsg);
    appendChatMessageElement(errorMsg);
    saveState();
  } finally {
    sendBtn.disabled = false;
    scrollToBottom();
  }
}

function setupUploadHandlers() {
  openUploadModalBtn.addEventListener('click', () => uploadModal.classList.add('active'));
  closeUploadModalBtn.addEventListener('click', () => uploadModal.classList.remove('active'));
  cancelUploadBtn.addEventListener('click', () => uploadModal.classList.remove('active'));

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  });
}

async function handleFiles(fileList) {
  const uploadProgressContainer = document.getElementById('uploadProgressContainer');
  const uploadProgressBar = document.getElementById('uploadProgressBar');
  const uploadStatusText = document.getElementById('uploadStatusText');

  uploadProgressContainer.style.display = 'block';

  let successCount = 0;
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    uploadStatusText.textContent = `Đang trích xuất nội dung file ${i + 1}/${fileList.length}: ${file.name}...`;
    uploadProgressBar.style.width = `${((i + 1) / fileList.length) * 100}%`;

    try {
      const parsedDoc = await parseDocumentFile(file);
      state.documents.push(parsedDoc);
      successCount++;
    } catch (err) {
      alert(`Không thể đọc file "${file.name}": ${err.message}`);
    }
  }

  saveState();
  renderDocuments();
  renderStorageMeter();

  setTimeout(() => {
    uploadProgressContainer.style.display = 'none';
    uploadModal.classList.remove('active');
    fileInput.value = '';

    if (successCount > 0) {
      const notifyMsg = {
        sender: 'bot',
        text: `✨ Đã nạp thành công **${successCount} tài liệu mới** vào Kho Kiến Thức! AI đã sẵn sàng trả lời.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      state.messages.push(notifyMsg);
      appendChatMessageElement(notifyMsg);
      scrollToBottom();
      saveState();
    }
  }, 500);
}

function setupSettingsHandlers() {
  openSettingsModalBtn.addEventListener('click', () => {
    aiProviderSelect.value = state.settings.provider || 'rag_sim';
    openaiKeyInput.value = state.settings.openaiKey || '';
    openaiModelSelect.value = state.settings.openaiModel || 'gpt-4o-mini';
    geminiKeyInput.value = state.settings.geminiKey || '';
    geminiModelSelect.value = state.settings.geminiModel || 'gemini-1.5-flash';
    systemPromptInput.value = state.settings.systemPrompt || '';

    updateProviderFieldsDisplay();
    settingsModal.classList.add('active');
  });

  closeSettingsModalBtn.addEventListener('click', () => settingsModal.classList.remove('active'));
  aiProviderSelect.addEventListener('change', updateProviderFieldsDisplay);

  saveSettingsBtn.addEventListener('click', () => {
    state.settings.provider = aiProviderSelect.value;
    state.settings.openaiKey = openaiKeyInput.value.trim();
    state.settings.openaiModel = openaiModelSelect.value;
    state.settings.geminiKey = geminiKeyInput.value.trim();
    state.settings.geminiModel = geminiModelSelect.value;
    state.settings.systemPrompt = systemPromptInput.value.trim();

    saveState();
    settingsModal.classList.remove('active');
    alert('💎 Đã lưu Gem & Cấu hình AI thành công!');
  });

  resetSettingsBtn.addEventListener('click', () => {
    state.settings = {
      provider: 'rag_sim',
      openaiKey: '',
      openaiModel: 'gpt-4o-mini',
      geminiKey: '',
      geminiModel: 'gemini-1.5-flash',
      systemPrompt: 'Bạn là Trợ lý AI chuyên nghiệp cho Kho Kiến Thức.'
    };
    saveState();
    settingsModal.classList.remove('active');
  });

  document.querySelectorAll('.gem-template-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      systemPromptInput.value = btn.dataset.template;
    });
  });
}

function updateProviderFieldsDisplay() {
  const val = aiProviderSelect.value;
  openaiFields.style.display = val === 'openai' ? 'block' : 'none';
  geminiFields.style.display = val === 'gemini' ? 'block' : 'none';
}

function openPreviewModal(doc) {
  previewModalTitle.textContent = `File: ${doc.name}`;
  previewMetaInfo.textContent = `Dung lượng: ${doc.sizeFormatted} | Định dạng: ${doc.formatLabel}`;
  previewTextBox.textContent = doc.content || '(Không có nội dung)';
  previewModal.classList.add('active');
}

closePreviewModalBtn.addEventListener('click', () => previewModal.classList.remove('active'));
closePreviewBtn.addEventListener('click', () => previewModal.classList.remove('active'));

function setupEventListeners() {
  chatForm.addEventListener('submit', handleSendMessage);
  clearDocsBtn.addEventListener('click', clearAllDocuments);
  clearChatBtn.addEventListener('click', clearChatHistory);
  setupUploadHandlers();
  setupSettingsHandlers();

  themeToggleBtn.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(state.theme);
    saveState();
  });

  document.querySelectorAll('.quick-prompt-pill:not(.gem-template-btn)').forEach(pill => {
    pill.addEventListener('click', () => {
      chatInput.value = pill.dataset.prompt;
      handleSendMessage();
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', init);
