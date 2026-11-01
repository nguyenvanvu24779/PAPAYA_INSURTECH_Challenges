#!/usr/bin/env node
// Converts a Claude Code transcript (transcript.jsonl from the app's session
// export) into Markdown that people, other AIs and tools can read.
//
// The output depends only on the input file, so anyone can regenerate it and
// diff it against the committed copy. Nothing is paraphrased: every message,
// tool input and tool result is copied verbatim inside fenced blocks.
//
// Usage:
//   node scripts/transcript-to-md.mjs <transcript.jsonl> <out.md> [compact|full] [source-label]

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [, , input, output, mode = 'compact', sourceLabel] = process.argv;
if (!input || !output || !['compact', 'full'].includes(mode)) {
  console.error('Usage: node scripts/transcript-to-md.mjs <transcript.jsonl> <out.md> [compact|full] [source-label]');
  process.exit(2);
}
const FULL = mode === 'full';

const bytes = readFileSync(input);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const entries = bytes
  .toString('utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line, i) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Line ${i + 1} of ${input} is not valid JSON`);
    }
  });

// ---- helpers ---------------------------------------------------------------

/** Fence that cannot be closed early by backticks inside the content. */
function fence(text, info = '') {
  const runs = [...String(text).matchAll(/`+/g)].map((m) => m[0].length);
  const ticks = '`'.repeat(Math.max(3, ...runs.map((n) => n + 1)));
  return `${ticks}${info}\n${text}\n${ticks}`;
}

const time = (ts) => (ts ? ts.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : 'không rõ thời gian');
const isHumanString = (r) => r.type === 'user' && typeof r.message?.content === 'string';
const blocks = (r) => (Array.isArray(r.message?.content) ? r.message.content : []);
const isRefusal = (r) =>
  (r.type === 'assistant' && (r.message?.stop_reason === 'refusal' || r.isApiErrorMessage)) ||
  (r.type === 'system' && r.subtype === 'model_refusal_no_fallback');

function humanKind(text) {
  if (/^\s*<(local-command|command-name|command-message)/.test(text)) return 'local-command';
  if (text.startsWith('Your response above was stopped by a safety classifier')) return 'app-notice';
  return 'user';
}

const LABEL = {
  user: 'Người dùng (user)',
  'user-queued': 'Người dùng, gửi giữa lượt làm việc (user, queued)',
  'local-command': 'Lệnh cục bộ trong ứng dụng (local command)',
  'app-notice': 'Thông báo của ứng dụng (app notice)',
  assistant: 'AI (assistant)',
};

function toolSummary(name, inp = {}) {
  const pick = inp.description ?? inp.file_path ?? inp.path ?? inp.pattern ?? inp.url ?? inp.query ?? inp.name ?? inp.action ?? inp.session_id ?? '';
  const text = String(pick).replace(/\s+/g, ' ').trim();
  return text ? `\`${name}\` — ${text.length > 160 ? text.slice(0, 160) + '…' : text}` : `\`${name}\``;
}

function resultText(block) {
  const c = block.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return JSON.stringify(c, null, 2);
  return c.map((p) => (p.type === 'text' ? p.text : `[${p.type}${p.source?.media_type ? `: ${p.source.media_type}` : ''}]`)).join('\n');
}

// ---- counts (for the header and for verification) ---------------------------

const count = { user: 0, queued: 0, localCommand: 0, appNotice: 0, assistantText: 0, toolCalls: 0, toolResults: 0, thinking: 0, thinkingNonEmpty: 0, refusals: 0 };
const models = [];
const toolNames = new Map();
for (const r of entries) {
  if (isHumanString(r)) {
    const k = humanKind(r.message.content);
    if (k === 'user') count.user++;
    else if (k === 'local-command') count.localCommand++;
    else count.appNotice++;
  }
  if (r.type === 'attachment' && r.attachment?.type === 'queued_command') count.queued++;
  if (isRefusal(r)) count.refusals++;
  if (r.type === 'assistant' && !isRefusal(r)) {
    if (r.message?.model && models.at(-1) !== r.message.model) models.push(r.message.model);
    for (const b of blocks(r)) {
      if (b.type === 'text') count.assistantText++;
      if (b.type === 'tool_use') {
        count.toolCalls++;
        toolNames.set(b.id, b.name);
      }
      if (b.type === 'thinking') {
        count.thinking++;
        if (b.thinking?.trim()) count.thinkingNonEmpty++;
      }
    }
  }
  if (r.type === 'user') for (const b of blocks(r)) if (b.type === 'tool_result') count.toolResults++;
}
const stamps = entries.map((r) => r.timestamp).filter(Boolean).sort();
const skipped = {};
const RENDERED = new Set(['user', 'assistant', 'attachment', 'system']);
for (const r of entries) if (!RENDERED.has(r.type)) skipped[r.type] = (skipped[r.type] ?? 0) + 1;

// ---- header -----------------------------------------------------------------

const out = [];
out.push(
  '---',
  `title: "Nhật ký làm việc với AI: Claim Workflow Orchestrator (${FULL ? 'bản đầy đủ' : 'bản gọn'})"`,
  'format: claude-code-transcript-markdown/1',
  `mode: ${mode}`,
  `source_file: "${sourceLabel ?? basename(input)}"`,
  `source_sha256: ${sha256}`,
  `source_lines: ${entries.length}`,
  `first_timestamp: ${stamps[0]}`,
  `last_timestamp: ${stamps.at(-1)}`,
  `models: [${models.map((m) => `"${m}"`).join(', ')}]`,
  'counts:',
  `  user_messages: ${count.user}`,
  `  user_messages_queued_mid_turn: ${count.queued}`,
  `  local_commands: ${count.localCommand}`,
  `  app_notices: ${count.appNotice}`,
  `  assistant_text_blocks: ${count.assistantText}`,
  `  tool_calls: ${count.toolCalls}`,
  `  tool_results: ${count.toolResults}`,
  `  thinking_blocks: ${count.thinking}`,
  `  thinking_blocks_with_content: ${count.thinkingNonEmpty}`,
  `  refusal_records: ${count.refusals}`,
  'generator: scripts/transcript-to-md.mjs',
  '---',
  '',
  `# Nhật ký làm việc với AI (${FULL ? 'bản đầy đủ' : 'bản gọn'})`,
  '',
  'Nhật ký này được **sinh tự động** từ file `transcript.jsonl` trong bản xuất phiên làm việc của ứng dụng Claude, bằng `scripts/transcript-to-md.mjs`. Không có nội dung nào được viết tay, tóm tắt hay chỉnh sửa: mọi tin nhắn, tham số công cụ và kết quả đều được sao chép nguyên văn trong khối mã. **Nguồn chuẩn là file zip gốc** cùng thư mục; chạy lại script trên file đó sẽ cho ra đúng file này (đối chiếu bằng `source_sha256`).',
  '',
  '## Cách đọc',
  '',
  '- Mỗi mục `## Lượt N` bắt đầu bằng một tin nhắn của con người (hoặc thông báo, lệnh cục bộ của ứng dụng), tiếp theo là mọi thứ AI làm cho tới tin nhắn kế tiếp.',
  '- Mỗi tin nhắn có tiêu đề `### <vai trò> · <thời gian UTC>`. Ngay trước tiêu đề là một chú thích máy đọc được: `<!-- entry kind=… ts=… uuid=… -->`.',
  '- Nội dung luôn nằm trong khối mã: `text` cho tin nhắn của người dùng và ứng dụng, `markdown` cho câu trả lời của AI, `json` cho tham số công cụ. Hàng rào khối mã được kéo dài khi nội dung có dấu backtick, nên không thể bị đóng sớm.',
  FULL
    ? '- Bản đầy đủ có thêm tham số và kết quả của mọi lần gọi công cụ, phần suy luận nội bộ nào được ghi lại, và ngữ cảnh hệ thống mà ứng dụng chèn vào. Các phần dài nằm trong `<details>`.'
    : '- Bản gọn liệt kê các lần gọi công cụ thành một dòng mỗi lần (tên công cụ và mô tả, cắt ở 160 ký tự). Tham số và kết quả đầy đủ nằm trong `CONVERSATION-FULL.md`.',
  '',
  '## Không có trong file này',
  '',
  '- Phần suy luận nội bộ của AI: bản xuất chỉ ghi nội dung cho ' + `${count.thinkingNonEmpty}/${count.thinking}` + ' khối, còn lại rỗng. ' + (FULL ? 'Các khối có nội dung được đưa vào.' : 'Các khối có nội dung nằm trong bản đầy đủ.'),
  `- Lượt trả lời bị bộ lọc an toàn của ứng dụng dừng: không có nội dung nào của chúng được ghi trong bản xuất; ${count.refusals} bản ghi lỗi liên quan được thay bằng một dòng ghi chú.`,
  `- Các bản ghi nội bộ của ứng dụng (request API, chỉ dẫn hệ thống, trạng thái phiên): ${Object.entries(skipped).map(([k, v]) => `${k} (${v})`).join(', ') || 'không có'}. Chúng có trong file zip gốc.`,
  '- Phần kết của lượt làm việc cuối: bản xuất được tạo trong lúc lượt đó đang chạy, nên không chứa câu trả lời cuối và những gì xảy ra sau thời điểm xuất.',
  '',
);

// ---- body -------------------------------------------------------------------

let turn = 0;
let pendingTools = [];
const flushTools = () => {
  if (pendingTools.length === 0) return;
  out.push('Công cụ đã gọi:', '', ...pendingTools.map((t) => `- ${t}`), '');
  pendingTools = [];
};
const heading = (kind, r, extra = '') => {
  out.push(`<!-- entry kind=${kind} ts=${r.timestamp ?? ''} uuid=${r.uuid ?? ''} -->`, `### ${LABEL[kind] ?? kind}${extra} · ${time(r.timestamp)}`, '');
};

for (const r of entries) {
  if (isRefusal(r)) {
    flushTools();
    out.push(`<!-- entry kind=refusal ts=${r.timestamp ?? ''} uuid=${r.uuid ?? ''} -->`, `> **Ghi chú của bộ chuyển đổi:** ứng dụng ghi nhận một lượt trả lời bị dừng (\`${r.subtype ?? r.message?.stop_reason ?? 'refusal'}\`) lúc ${time(r.timestamp)}. Nội dung bản ghi này không được đưa vào; xem file zip gốc.`, '');
    continue;
  }

  if (isHumanString(r)) {
    flushTools();
    const kind = humanKind(r.message.content);
    turn++;
    out.push(`## Lượt ${turn}`, '');
    heading(kind, r);
    out.push(fence(r.message.content, 'text'), '');
    continue;
  }

  if (r.type === 'attachment') {
    const a = r.attachment ?? {};
    if (a.type === 'queued_command') {
      flushTools();
      heading('user-queued', r);
      out.push(fence(typeof a.prompt === 'string' ? a.prompt : JSON.stringify(a.prompt, null, 2), 'text'), '');
    } else if (FULL) {
      flushTools();
      out.push(`<details><summary>Ngữ cảnh hệ thống do ứng dụng chèn: <code>${a.type}</code> · ${time(r.timestamp)}</summary>`, '', fence(JSON.stringify(a, null, 2), 'json'), '', '</details>', '');
    }
    continue;
  }

  if (r.type === 'system') {
    if (FULL) {
      flushTools();
      out.push(`<!-- entry kind=system subtype=${r.subtype ?? ''} ts=${r.timestamp ?? ''} -->`, `> Sự kiện hệ thống \`${r.subtype ?? 'system'}\` · ${time(r.timestamp)}${r.content ? `: ${String(r.content).replace(/\s+/g, ' ').slice(0, 300)}` : ''}`, '');
    }
    continue;
  }

  if (r.type === 'user') {
    for (const b of blocks(r)) {
      if (b.type === 'tool_result' && FULL) {
        const name = toolNames.get(b.tool_use_id) ?? 'công cụ';
        out.push(`<details><summary>Kết quả <code>${name}</code>${b.is_error ? ' (lỗi)' : ''} · ${time(r.timestamp)}</summary>`, '', fence(resultText(b), 'text'), '', '</details>', '');
      } else if (b.type === 'text') {
        flushTools();
        const firstLine = b.text.split('\n')[0];
        if (FULL) out.push(`<details><summary>Nội dung do ứng dụng nạp vào hội thoại · ${time(r.timestamp)}</summary>`, '', fence(b.text, 'text'), '', '</details>', '');
        else out.push(`> Ứng dụng nạp nội dung vào hội thoại (${firstLine.slice(0, 120)}). Xem bản đầy đủ.`, '');
      }
    }
    continue;
  }

  if (r.type === 'assistant') {
    for (const b of blocks(r)) {
      if (b.type === 'text') {
        flushTools();
        heading('assistant', r, r.message?.model ? ` [${r.message.model}]` : '');
        out.push(fence(b.text, 'markdown'), '');
      } else if (b.type === 'tool_use') {
        if (FULL) {
          out.push(`<!-- entry kind=tool_use name=${b.name} id=${b.id} ts=${r.timestamp ?? ''} -->`, `#### Gọi công cụ ${toolSummary(b.name, b.input)}`, '', fence(JSON.stringify(b.input ?? {}, null, 2), 'json'), '');
        } else {
          pendingTools.push(toolSummary(b.name, b.input));
        }
      } else if (b.type === 'thinking' && FULL && b.thinking?.trim()) {
        out.push(`<details><summary>Suy luận nội bộ được ghi lại · ${time(r.timestamp)}</summary>`, '', fence(b.thinking, 'text'), '', '</details>', '');
      }
    }
  }
}
flushTools();
out.push('---', '', `Hết nhật ký: ${turn} lượt.`, '');

writeFileSync(output, out.join('\n'));
console.error(`Wrote ${output}: ${turn} turns, mode=${mode}, source sha256=${sha256}`);
