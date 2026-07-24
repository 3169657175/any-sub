const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const {
  MODELS,
  CODEX_VISIBLE_MODEL_ALIASES,
  buildCodexModelsResponse,
  buildAntigravityCodexModelsResponse,
  resolveCodexModelAlias
} = require('./codexModels');

const DEFAULT_PORT = 8046;
const DEFAULT_MODEL = 'gemini-3.1-pro-high';
const MAX_ENCODED_REQUEST_BYTES = 256 * 1024 * 1024;
const MAX_DECODED_REQUEST_BYTES = 256 * 1024 * 1024;
const COMPACTION_TIMEOUT_MS = 4 * 60 * 1000;
const NORMAL_TIMEOUT_MS = 30 * 60 * 1000;
const COMPACTION_IDLE_TIMEOUT_MS = 90 * 1000;
const COMPACTION_TOOL_OUTPUT_CHARS = 12000;
const UPSTREAMS = [
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com'
];

function jsonError(res, status, message, code = 'api_error') {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: { message, type: code, code } }));
}

function decodeRequestBody(buffer, encoding) {
  const value = String(encoding || 'identity').trim().toLowerCase();
  if (!value || value === 'identity') return buffer;
  if (value === 'gzip' || value === 'x-gzip') return zlib.gunzipSync(buffer, { maxOutputLength: MAX_DECODED_REQUEST_BYTES });
  if (value === 'br') return zlib.brotliDecompressSync(buffer, { maxOutputLength: MAX_DECODED_REQUEST_BYTES });
  if (value === 'deflate') return zlib.inflateSync(buffer, { maxOutputLength: MAX_DECODED_REQUEST_BYTES });
  throw new Error(`不支持的请求压缩格式：${value}`);
}

function readJson(req, limit = MAX_ENCODED_REQUEST_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        fail(new Error(`压缩后的请求正文超过 ${Math.round(limit / 1024 / 1024)}MB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        const decoded = decodeRequestBody(Buffer.concat(chunks), req.headers['content-encoding']);
        if (decoded.length > MAX_DECODED_REQUEST_BYTES) throw new Error('解压后的请求正文超过 256MB');
        const parsed = JSON.parse(decoded.toString('utf8') || '{}');
        settled = true;
        resolve(parsed);
      } catch (error) {
        fail(new Error(`无法读取请求正文：${error.message}`));
      }
    });
    req.on('error', fail);
  });
}

function parseMetadataValue(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return JSON.parse(value); } catch (_) { return null; }
}

function codexRequestMetadata(req, body) {
  const clientMetadata = body && body.client_metadata && typeof body.client_metadata === 'object'
    ? body.client_metadata : {};
  return parseMetadataValue(clientMetadata['x-codex-turn-metadata'])
    || parseMetadataValue(req && req.headers && req.headers['x-codex-turn-metadata'])
    || clientMetadata;
}

function isCompactionRequest(req, body) {
  const metadata = codexRequestMetadata(req, body);
  return metadata && (metadata.request_kind === 'compaction' || metadata.subagent_kind === 'compact');
}

function truncateForCompaction(value, limit = COMPACTION_TOOL_OUTPUT_CHARS) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  const half = Math.max(1, Math.floor((limit - 90) / 2));
  return `${text.slice(0, half)}\n...[压缩时省略 ${text.length - half * 2} 个字符]...\n${text.slice(-half)}`;
}

function optimizeCompactionBody(body) {
  const input = Array.isArray(body && body.input) ? body.input.map(item => {
    if (!item || typeof item !== 'object') return item;
    if (item.type === 'message' || item.role) {
      const content = Array.isArray(item.content) ? item.content.reduce((result, part) => {
        if (!part || typeof part !== 'object') return result;
        if (part.type === 'input_image') {
          if (!result.some(value => value && value.type === 'input_text' && value.text === '[Image omitted during context compaction]')) {
            result.push({ type: 'input_text', text: '[Image omitted during context compaction]' });
          }
          return result;
        }
        result.push(part);
        return result;
      }, []) : item.content;
      return { ...item, content };
    }
    if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) {
      return { ...item, output: truncateForCompaction(outputToText(item.output)) };
    }
    if (item.type === 'custom_tool_call' && typeof item.input === 'string') {
      return { ...item, input: truncateForCompaction(item.input) };
    }
    if (item.type === 'function_call' && typeof item.arguments === 'string') {
      return { ...item, arguments: truncateForCompaction(item.arguments) };
    }
    return item;
  }) : body.input;
  return {
    ...body,
    input,
    tools: [],
    parallel_tool_calls: false,
    max_output_tokens: Math.min(Math.max(Number(body.max_output_tokens) || 8192, 2048), 8192)
  };
}

function mapModel(model) {
  const value = String(model || DEFAULT_MODEL);
  if (value === 'gemini-3.1-pro-high' || value === 'gemini-3.1-pro') return 'gemini-pro-agent';
  return value;
}

function selectRequestedModel(clientModel, config = {}) {
  const configuredModel = MODELS.includes(config.model) ? config.model : DEFAULT_MODEL;
  const requested = resolveCodexModelAlias(String(clientModel || '').trim());
  if (config.modelControl === 'client' && MODELS.includes(requested)) return requested;
  return configuredModel;
}

function cleanSchema(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return value;
  if (Array.isArray(value)) return value.map(item => cleanSchema(item, depth + 1));
  const blocked = new Set(['$schema', '$id', '$ref', 'strict', 'additionalProperties', 'external_web_access']);
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (!blocked.has(key)) result[key] = cleanSchema(child, depth + 1);
  }
  return result;
}

function contentToParts(content, options = {}) {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) return [];
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if (['input_text', 'output_text', 'text'].includes(item.type || 'text') && item.text !== undefined) {
      parts.push({ text: String(item.text) });
      continue;
    }
    if (item.type === 'input_image' && typeof item.image_url === 'string') {
      if (options.stripImages) {
        if (!parts.some(part => part.text === '[Image omitted during context compaction]')) {
          parts.push({ text: '[Image omitted during context compaction]' });
        }
        continue;
      }
      const match = /^data:([^;,]+);base64,(.+)$/s.exec(item.image_url);
      if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      else parts.push({ text: `[Image: ${item.image_url}]` });
    }
  }
  return parts;
}

function outputToText(output) {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    const text = output.map(item => item && item.text).filter(Boolean).join('\n');
    return text || JSON.stringify(output);
  }
  if (output && typeof output === 'object' && typeof output.content === 'string') return output.content;
  return output === undefined ? '' : JSON.stringify(output);
}

function callInfo(item, cache) {
  const cached = item.call_id && cache && cache.get(item.call_id);
  if (item.type === 'custom_tool_call') {
    return { name: item.name || (cached && cached.name) || 'tool', args: { input: String(item.input || '') } };
  }
  if (item.type === 'local_shell_call') {
    return { name: 'shell', args: item.action || {} };
  }
  let args = {};
  try { args = JSON.parse(item.arguments || '{}'); } catch (_) {}
  return { name: item.name || (cached && cached.name) || 'tool', args };
}

function toolDeclarations(tools) {
  const declarations = [];
  const kinds = new Map();
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (!tool || !tool.name || !['function', 'custom'].includes(tool.type)) continue;
    kinds.set(tool.name, tool.type);
    declarations.push({
      name: tool.name,
      description: tool.description || '',
      parameters: tool.type === 'custom'
        ? { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] }
        : cleanSchema(tool.parameters || { type: 'object', properties: {} })
    });
  }
  return { declarations, kinds };
}

function convertResponsesRequest(body, options = {}) {
  const contents = [];
  const callNames = new Map();
  const callCache = options.toolCallCache || new Map();
  const input = typeof body.input === 'string'
    ? [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: body.input }] }]
    : Array.isArray(body.input) ? body.input : [];

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    if (['function_call', 'custom_tool_call', 'local_shell_call'].includes(item.type) && item.call_id) {
      callNames.set(item.call_id, callInfo(item, callCache).name);
    }
  }

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'message' || item.role) {
      const role = item.role === 'assistant' ? 'model' : 'user';
      const parts = contentToParts(item.content, options);
      if (parts.length) contents.push({ role, parts });
    } else if (['function_call', 'custom_tool_call', 'local_shell_call'].includes(item.type)) {
      const info = callInfo(item, callCache);
      const part = { functionCall: { name: info.name, args: info.args } };
      const cached = item.call_id && callCache.get(item.call_id);
      if (cached && cached.thoughtSignature) part.thoughtSignature = cached.thoughtSignature;
      contents.push({ role: 'model', parts: [part] });
    } else if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) {
      const cached = item.call_id && callCache.get(item.call_id);
      const name = callNames.get(item.call_id) || (cached && cached.name) || item.name || 'tool';
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name, response: { result: options.compaction
          ? truncateForCompaction(outputToText(item.output))
          : outputToText(item.output) } } }]
      });
    }
  }

  if (!contents.length) contents.push({ role: 'user', parts: [{ text: '' }] });
  const request = { contents };
  const instructions = String(body.instructions || '').trim();
  if (instructions) request.systemInstruction = { role: 'user', parts: [{ text: instructions }] };

  const { declarations } = toolDeclarations(options.compaction ? [] : body.tools);
  if (declarations.length) {
    request.tools = [{ functionDeclarations: declarations }];
    request.toolConfig = { functionCallingConfig: { mode: 'VALIDATED' } };
  }

  request.generationConfig = {
    maxOutputTokens: options.compaction
      ? Math.min(Math.max(Number(body.max_output_tokens) || 8192, 2048), 8192)
      : Math.max(1, Math.min(Number(body.max_output_tokens) || 16384, 65536))
  };
  if (Number.isFinite(body.temperature)) request.generationConfig.temperature = body.temperature;
  if (String(body.model || '').includes('pro') || String(body.model || '').includes('thinking')) {
    request.generationConfig.thinkingConfig = { includeThoughts: true };
  }
  return request;
}

function parseUpstreamEvents(text) {
  const payloads = [];
  const trimmed = String(text || '').trim();
  if (!trimmed) return payloads;
  try { payloads.push(JSON.parse(trimmed)); return payloads; } catch (_) {}
  for (const raw of trimmed.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line === 'data: [DONE]') continue;
    if (line.startsWith('data:')) line = line.slice(5).trim();
    try { payloads.push(JSON.parse(line)); } catch (_) {}
  }
  return payloads;
}

function collectParts(payloads) {
  const result = [];
  for (const payload of payloads) {
    const root = payload && payload.response ? payload.response : payload;
    const candidates = root && Array.isArray(root.candidates) ? root.candidates : [];
    for (const candidate of candidates) {
      const parts = candidate && candidate.content && Array.isArray(candidate.content.parts)
        ? candidate.content.parts : [];
      for (const part of parts) result.push(part);
    }
  }
  return result;
}

function writeSse(res, event, data, sequence) {
  const payload = { ...data, type: event, sequence_number: sequence };
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function usageFromMetadata(metadata) {
  const input = Number(metadata && metadata.promptTokenCount) || 0;
  const output = Number(metadata && metadata.candidatesTokenCount) || 0;
  const reasoning = Number(metadata && metadata.thoughtsTokenCount) || 0;
  const cached = Number(metadata && metadata.cachedContentTokenCount) || 0;
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: cached },
    output_tokens: output + reasoning,
    output_tokens_details: { reasoning_tokens: reasoning },
    total_tokens: Number(metadata && metadata.totalTokenCount) || input + output + reasoning
  };
}

function createToolOutput(part, options = {}) {
  const name = part.functionCall.name || 'tool';
  const kind = options.toolKinds && options.toolKinds.get(name) || 'function';
  const callId = `call_${crypto.randomBytes(8).toString('hex')}`;
  const base = {
    id: `fc_${crypto.randomBytes(8).toString('hex')}`,
    call_id: callId,
    name,
    status: 'completed'
  };
  const item = kind === 'custom'
    ? { ...base, type: 'custom_tool_call', input: String(part.functionCall.args && part.functionCall.args.input || '') }
    : { ...base, type: 'function_call', arguments: JSON.stringify(part.functionCall.args || {}) };
  if (options.onToolCall) {
    options.onToolCall(item, {
      name,
      kind,
      thoughtSignature: part.thoughtSignature || ''
    });
  }
  return item;
}

function createResponsesOutput(parts, model, responseId, options = {}) {
  const output = [];
  let text = '';
  let lastTool = null;
  for (const part of parts) {
    if (part && typeof part.text === 'string' && !part.thought) text += part.text;
    if (part && part.functionCall) {
      lastTool = createToolOutput(part, options);
      output.push(lastTool);
    } else if (part && part.thoughtSignature && lastTool && options.onToolCall) {
      options.onToolCall(lastTool, {
        name: lastTool.name,
        kind: lastTool.type === 'custom_tool_call' ? 'custom' : 'function',
        thoughtSignature: part.thoughtSignature
      });
    }
  }
  if (text) {
    output.unshift({
      id: `msg_${crypto.randomBytes(8).toString('hex')}`,
      type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }]
    });
  }
  return {
    id: responseId, object: 'response', created_at: Math.floor(Date.now() / 1000),
    status: 'completed', model, output, error: null,
    usage: usageFromMetadata(options.usageMetadata)
  };
}

function parseSseBlock(block) {
  const data = String(block || '').split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n');
  if (!data || data === '[DONE]') return null;
  try { return JSON.parse(data); } catch (_) { return null; }
}

async function* readUpstreamEvents(body, idleTimeoutMs = 5 * 60 * 1000) {
  if (!body || typeof body.getReader !== 'function') throw new Error('Cloud Code 没有返回可读数据流');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('等待 Cloud Code 流式数据超时')), idleTimeoutMs);
      });
      let result;
      try {
        result = await Promise.race([reader.read(), timeout]);
      } catch (error) {
        try { await reader.cancel(error); } catch (_) {}
        throw error;
      }
      clearTimeout(timer);
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        const payload = parseSseBlock(block);
        if (payload) yield payload;
      }
    }
    buffer += decoder.decode();
    const payload = parseSseBlock(buffer);
    if (payload) yield payload;
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }
}

function failedResponse(responseId, model, message) {
  return {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'failed',
    model,
    output: [],
    error: { code: 'upstream_error', message: String(message || 'Cloud Code 流式请求失败') },
    usage: usageFromMetadata(null)
  };
}

function buildEmergencyCompactionSummary(body, maxChars = 60000) {
  const entries = [];
  for (const item of Array.isArray(body && body.input) ? body.input : []) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'message' || item.role) {
      const role = item.role === 'assistant' ? 'Assistant' : 'User';
      const text = (Array.isArray(item.content) ? item.content : [{ text: item.content }])
        .map(part => part && typeof part === 'object' ? part.text : '')
        .filter(Boolean).join('\n');
      if (text) entries.push(`${role}: ${text}`);
    } else if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) {
      const text = truncateForCompaction(outputToText(item.output), 4000);
      if (text) entries.push(`Tool result: ${text}`);
    }
  }
  let remaining = maxChars;
  const selected = [];
  for (let index = entries.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const entry = entries[index];
    const value = entry.length <= remaining ? entry : entry.slice(-remaining);
    selected.unshift(value);
    remaining -= value.length;
  }
  return [
    'Context recovery summary generated locally because the upstream compaction stream did not complete.',
    'Preserve the following recent conversation facts and continue the current task without repeating completed work:',
    '',
    selected.join('\n\n') || '(No recent text was available.)'
  ].join('\n');
}

function writeSyntheticCompleted(res, model, text, responseId = `resp_${crypto.randomBytes(12).toString('hex')}`, options = {}) {
  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
  }
  let sequence = Number(options.sequence) || 0;
  const createdAt = Math.floor(Date.now() / 1000);
  const messageId = `msg_${crypto.randomBytes(8).toString('hex')}`;
  const pending = {
    id: responseId, object: 'response', created_at: createdAt,
    status: 'in_progress', model, output: [], error: null, usage: usageFromMetadata(null)
  };
  if (options.emitStart !== false) {
    writeSse(res, 'response.created', { response: pending }, sequence++);
    writeSse(res, 'response.in_progress', { response: pending }, sequence++);
  }
  writeSse(res, 'response.output_item.added', {
    output_index: 0,
    item: { id: messageId, type: 'message', role: 'assistant', status: 'in_progress', content: [] }
  }, sequence++);
  writeSse(res, 'response.content_part.added', {
    item_id: messageId, output_index: 0, content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] }
  }, sequence++);
  writeSse(res, 'response.output_text.delta', {
    item_id: messageId, output_index: 0, content_index: 0, delta: text
  }, sequence++);
  const content = { type: 'output_text', text, annotations: [] };
  const item = { id: messageId, type: 'message', role: 'assistant', status: 'completed', content: [content] };
  writeSse(res, 'response.output_text.done', {
    item_id: messageId, output_index: 0, content_index: 0, text
  }, sequence++);
  writeSse(res, 'response.content_part.done', {
    item_id: messageId, output_index: 0, content_index: 0, part: content
  }, sequence++);
  writeSse(res, 'response.output_item.done', { output_index: 0, item }, sequence++);
  writeSse(res, 'response.completed', {
    response: { ...pending, status: 'completed', output: [item] }
  }, sequence++);
  res.end('data: [DONE]\n\n');
}

async function streamUpstreamResponse(res, upstreamResponse, model, responseId, options = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  let sequence = 0;
  let usageMetadata = null;
  let finishReason = '';
  let message = null;
  let lastTool = null;
  const output = [];
  const base = {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'in_progress',
    model,
    output: [],
    error: null,
    usage: usageFromMetadata(null)
  };
  writeSse(res, 'response.created', { response: base }, sequence++);
  writeSse(res, 'response.in_progress', { response: base }, sequence++);

  try {
    for await (const payload of readUpstreamEvents(upstreamResponse.body, options.idleTimeoutMs)) {
      const root = payload && payload.response ? payload.response : payload;
      if (root && root.usageMetadata) usageMetadata = root.usageMetadata;
      for (const candidate of root && Array.isArray(root.candidates) ? root.candidates : []) {
        if (candidate.finishReason) finishReason = candidate.finishReason;
        const parts = candidate && candidate.content && Array.isArray(candidate.content.parts)
          ? candidate.content.parts : [];
        for (const part of parts) {
          if (part && typeof part.text === 'string' && !part.thought && part.text) {
            if (!message) {
              const outputIndex = output.length;
              message = {
                id: `msg_${crypto.randomBytes(8).toString('hex')}`,
                type: 'message', role: 'assistant', status: 'in_progress', content: [],
                outputIndex, text: ''
              };
              output.push(message);
              writeSse(res, 'response.output_item.added', {
                output_index: outputIndex,
                item: { id: message.id, type: 'message', role: 'assistant', status: 'in_progress', content: [] }
              }, sequence++);
              writeSse(res, 'response.content_part.added', {
                item_id: message.id, output_index: outputIndex, content_index: 0,
                part: { type: 'output_text', text: '', annotations: [] }
              }, sequence++);
            }
            message.text += part.text;
            writeSse(res, 'response.output_text.delta', {
              item_id: message.id, output_index: message.outputIndex, content_index: 0, delta: part.text
            }, sequence++);
          }
          if (part && part.functionCall) {
            const item = createToolOutput(part, options);
            item.outputIndex = output.length;
            output.push(item);
            lastTool = item;
            const pending = { ...item, status: 'in_progress' };
            delete pending.outputIndex;
            if (pending.type === 'function_call') pending.arguments = '';
            else pending.input = '';
            writeSse(res, 'response.output_item.added', { output_index: item.outputIndex, item: pending }, sequence++);
            const deltaEvent = item.type === 'custom_tool_call'
              ? 'response.custom_tool_call_input.delta' : 'response.function_call_arguments.delta';
            const delta = item.type === 'custom_tool_call' ? item.input : item.arguments;
            writeSse(res, deltaEvent, {
              item_id: item.id, call_id: item.call_id, output_index: item.outputIndex, delta
            }, sequence++);
          } else if (part && part.thoughtSignature && lastTool && options.onToolCall) {
            options.onToolCall(lastTool, {
              name: lastTool.name,
              kind: lastTool.type === 'custom_tool_call' ? 'custom' : 'function',
              thoughtSignature: part.thoughtSignature
            });
          }
        }
      }
    }

    if (message) {
      const content = { type: 'output_text', text: message.text, annotations: [] };
      const done = { id: message.id, type: 'message', role: 'assistant', status: 'completed', content: [content] };
      writeSse(res, 'response.output_text.done', {
        item_id: message.id, output_index: message.outputIndex, content_index: 0, text: message.text
      }, sequence++);
      writeSse(res, 'response.content_part.done', {
        item_id: message.id, output_index: message.outputIndex, content_index: 0, part: content
      }, sequence++);
      writeSse(res, 'response.output_item.done', { output_index: message.outputIndex, item: done }, sequence++);
    }
    for (const tool of output.filter(item => item.type !== 'message')) {
      const done = { ...tool };
      delete done.outputIndex;
      const doneEvent = tool.type === 'custom_tool_call'
        ? 'response.custom_tool_call_input.done' : 'response.function_call_arguments.done';
      writeSse(res, doneEvent, {
        item_id: tool.id, call_id: tool.call_id, output_index: tool.outputIndex,
        [tool.type === 'custom_tool_call' ? 'input' : 'arguments']:
          tool.type === 'custom_tool_call' ? tool.input : tool.arguments
      }, sequence++);
      writeSse(res, 'response.output_item.done', { output_index: tool.outputIndex, item: done }, sequence++);
    }
    const finalOutput = output.map(item => {
      if (item.type === 'message') {
        return { id: item.id, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: item.text, annotations: [] }] };
      }
      const done = { ...item };
      delete done.outputIndex;
      return done;
    });
    if (!finalOutput.length) throw new Error(finishReason === 'MAX_TOKENS'
      ? '模型输出额度被思考内容耗尽，请提高 max_output_tokens' : 'Cloud Code 返回了空响应');
    const response = { ...base, status: 'completed', output: finalOutput, usage: usageFromMetadata(usageMetadata) };
    writeSse(res, 'response.completed', { response }, sequence++);
    if (usageMetadata && options.onUsage) options.onUsage(usageMetadata, model);
    res.end('data: [DONE]\n\n');
  } catch (error) {
    if (!res.destroyed && !res.writableEnded) {
      if (options.compactionFallback && !message) {
        if (options.onFallback) options.onFallback(error);
        writeSyntheticCompleted(res, model, options.compactionFallback, responseId, {
          emitStart: false,
          sequence
        });
      } else {
        writeSse(res, 'response.failed', { response: failedResponse(responseId, model, error.message) }, sequence++);
        res.end('data: [DONE]\n\n');
      }
    }
  }
}

async function relayResponsesUpstream(res, upstreamResponse, options = {}) {
  if (options.bufferCompaction) {
    const chunks = [];
    let size = 0;
    let completed = false;
    try {
      if (!upstreamResponse.ok) throw new Error(`自定义 Provider 返回 HTTP ${upstreamResponse.status}: ${(await upstreamResponse.text()).slice(0, 400)}`);
      if (!upstreamResponse.body || typeof upstreamResponse.body.getReader !== 'function') {
        throw new Error('自定义 Provider 没有返回可读响应流');
      }
      const reader = upstreamResponse.body.getReader();
      try {
        while (true) {
          let timer;
          const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('自定义 Provider 的压缩流 90 秒没有新数据')), options.idleTimeoutMs || COMPACTION_IDLE_TIMEOUT_MS);
          });
          let result;
          try {
            result = await Promise.race([reader.read(), timeout]);
          } catch (error) {
            try { await reader.cancel(error); } catch (_) {}
            throw error;
          }
          clearTimeout(timer);
          if (result.done) break;
          const chunk = Buffer.from(result.value);
          size += chunk.length;
          if (size > 16 * 1024 * 1024) throw new Error('自定义 Provider 的压缩响应超过 16MB');
          chunks.push(chunk);
        }
      } finally {
        try { reader.releaseLock(); } catch (_) {}
      }
      const buffered = Buffer.concat(chunks);
      const text = buffered.toString('utf8');
      completed = /event:\s*response\.completed|"type"\s*:\s*"response\.completed"/.test(text);
      if (!completed) throw new Error('自定义 Provider 的压缩流结束但缺少 response.completed');
      res.writeHead(upstreamResponse.status, {
        'Content-Type': upstreamResponse.headers.get('content-type') || 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform'
      });
      res.end(buffered);
      return;
    } catch (error) {
      if (options.onFallback) options.onFallback(error);
      writeSyntheticCompleted(res, options.model, options.compactionFallback);
      return;
    }
  }
  const headers = {
    'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8',
    'Cache-Control': upstreamResponse.headers.get('cache-control') || 'no-cache'
  };
  res.writeHead(upstreamResponse.status, headers);
  if (!upstreamResponse.body || typeof upstreamResponse.body.getReader !== 'function') {
    res.end(await upstreamResponse.text());
    return;
  }
  const reader = upstreamResponse.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!res.write(Buffer.from(result.value))) {
        await new Promise(resolve => res.once('drain', resolve));
      }
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}

class CodexGateway {
  constructor(options) {
    this.fetch = options.fetch;
    this.accountRoot = options.accountRoot;
    this.stateDir = options.stateDir;
    this.decryptToken = options.decryptToken;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.onUsage = typeof options.onUsage === 'function' ? options.onUsage : null;
    this.server = null;
    this.tokenCache = new Map();
    this.projectCache = new Map();
    fs.mkdirSync(this.stateDir, { recursive: true });
    this.configPath = path.join(this.stateDir, 'codex-gateway.json');
    this.toolCachePath = path.join(this.stateDir, 'codex-tool-calls.json');
    this.logPath = path.join(this.stateDir, 'codex-gateway.log');
    this.toolCallCache = new Map();
    this.activeRequest = null;
    this.lastRequest = null;
    try {
      const storedCalls = JSON.parse(fs.readFileSync(this.toolCachePath, 'utf8'));
      this.toolCallCache = new Map(Array.isArray(storedCalls) ? storedCalls : []);
    } catch (_) {}
    this.config = this.readConfig();
  }

  readConfig() {
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(this.configPath, 'utf8')); } catch (_) {}
    const mode = stored.mode === 'custom' ? 'custom' : 'antigravity';
    const storedModel = String(stored.model || DEFAULT_MODEL);
    const storedAutoModel = String(stored.autoResolvedModel || DEFAULT_MODEL);
    return {
      port: Number(stored.port) || DEFAULT_PORT,
      apiKey: stored.apiKey || `sk-agy-${crypto.randomBytes(24).toString('hex')}`,
      accountId: String(stored.accountId || ''),
      model: mode === 'custom' || MODELS.includes(storedModel) ? storedModel : DEFAULT_MODEL,
      autoResolvedModel: MODELS.includes(storedAutoModel) && storedAutoModel !== 'agy-auto'
        ? storedAutoModel : DEFAULT_MODEL,
      modelControl: stored.modelControl === 'client' ? 'client' : 'gateway',
      mode,
      customBaseUrl: String(stored.customBaseUrl || ''),
      customApiKey: String(stored.customApiKey || ''),
      customProviderName: String(stored.customProviderName || ''),
      customModels: Array.isArray(stored.customModels) ? stored.customModels.map(String).filter(Boolean) : []
    };
  }

  saveConfig() {
    fs.writeFileSync(this.configPath, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8');
  }

  status() {
    const models = this.config.mode === 'custom' && this.config.customModels.length
      ? this.config.customModels : MODELS;
    return {
      running: Boolean(this.server && this.server.listening),
      host: '127.0.0.1', port: this.config.port, apiKey: this.config.apiKey,
      accountId: this.config.accountId, model: this.config.model,
      autoResolvedModel: this.config.autoResolvedModel, modelControl: this.config.modelControl,
      mode: this.config.mode,
      upstreamName: this.config.mode === 'custom' ? this.config.customProviderName : 'Antigravity',
      baseUrl: `http://127.0.0.1:${this.config.port}/v1`, models,
      antigravityModels: MODELS,
      activeRequest: this.activeRequest,
      lastRequest: this.lastRequest
    };
  }

  writeDiagnostic(event, details = {}) {
    const record = { time: new Date().toISOString(), event, ...details };
    try { fs.appendFileSync(this.logPath, `${JSON.stringify(record)}\n`, 'utf8'); } catch (_) {}
  }

  configure(settings = {}) {
    if (settings.port !== undefined) {
      const port = Number(settings.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口必须在 1024-65535 之间');
      if (this.server && this.server.listening && port !== this.config.port) throw new Error('修改端口前请先停止服务');
      this.config.port = port;
    }
    if (settings.mode !== undefined) this.config.mode = settings.mode === 'custom' ? 'custom' : 'antigravity';
    if (settings.accountId !== undefined) this.config.accountId = String(settings.accountId || '');
    if (settings.model !== undefined) {
      const candidate = String(settings.model || DEFAULT_MODEL);
      this.config.model = this.config.mode === 'custom' || MODELS.includes(candidate) ? candidate : DEFAULT_MODEL;
    }
    if (settings.customBaseUrl !== undefined) this.config.customBaseUrl = String(settings.customBaseUrl || '').replace(/\/+$/, '');
    if (settings.customApiKey !== undefined) this.config.customApiKey = String(settings.customApiKey || '');
    if (settings.customProviderName !== undefined) this.config.customProviderName = String(settings.customProviderName || '').slice(0, 80);
    if (settings.customModels !== undefined) {
      this.config.customModels = [...new Set((Array.isArray(settings.customModels) ? settings.customModels : [])
        .map(value => String(value).trim()).filter(Boolean))];
    }
    if (settings.modelControl !== undefined) {
      this.config.modelControl = settings.modelControl === 'client' ? 'client' : 'gateway';
    }
    if (settings.autoResolvedModel !== undefined) {
      const candidate = String(settings.autoResolvedModel || DEFAULT_MODEL);
      if (candidate !== 'agy-auto' && MODELS.includes(candidate)) this.config.autoResolvedModel = candidate;
    }
    this.saveConfig();
    return this.status();
  }

  async start(settings = {}) {
    this.configure(settings);
    if (this.server && this.server.listening) return this.status();
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.config.port, '127.0.0.1', resolve);
    });
    return this.status();
  }

  async stop() {
    if (!this.server) return this.status();
    await new Promise(resolve => this.server.close(resolve));
    this.server = null;
    return this.status();
  }

  loadAccount() {
    const registryPath = path.join(this.accountRoot, 'accounts.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const accountId = this.config.accountId || registry.current_account_id || (registry.accounts && registry.accounts[0] && registry.accounts[0].id);
    if (!accountId || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) throw new Error('没有可用于反代的本地账号');
    const detailPath = path.join(this.accountRoot, 'accounts', `${accountId}.json`);
    const detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
    const token = this.decryptToken(detail);
    if (!token || !token.refresh_token) throw new Error('所选账号缺少 refresh_token');
    return { id: accountId, detail, token };
  }

  async getAccessToken(account) {
    const cached = this.tokenCache.get(account.id);
    if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) return cached.accessToken;
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: account.token.refresh_token,
      grant_type: 'refresh_token'
    });
    const response = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString()
    });
    if (!response.ok) throw new Error(`OAuth 刷新失败 (${response.status}): ${await response.text()}`);
    const data = await response.json();
    this.tokenCache.set(account.id, { accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
    return data.access_token;
  }

  async getProjectId(account, accessToken) {
    if (account.token.project_id) return account.token.project_id;
    if (account.detail.project_id) return account.detail.project_id;
    const cached = this.projectCache.get(account.id);
    if (cached) return cached;
    const response = await this.fetch(`${UPSTREAMS[0]}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'antigravity' },
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } })
    });
    if (!response.ok) throw new Error(`项目识别失败 (${response.status}): ${await response.text()}`);
    const data = await response.json();
    const project = data.cloudaicompanionProject;
    if (!project) throw new Error('账号没有可用的 Cloud Code 项目');
    this.projectCache.set(account.id, project);
    return project;
  }

  rememberToolCall(item, metadata) {
    this.toolCallCache.set(item.call_id, {
      name: metadata.name,
      kind: metadata.kind,
      thoughtSignature: metadata.thoughtSignature || ''
    });
    while (this.toolCallCache.size > 2048) {
      this.toolCallCache.delete(this.toolCallCache.keys().next().value);
    }
    const temporary = `${this.toolCachePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify([...this.toolCallCache])}\n`, 'utf8');
    fs.renameSync(temporary, this.toolCachePath);
  }

  async openUpstream(body, signal, options = {}) {
    const account = this.loadAccount();
    const accessToken = await this.getAccessToken(account);
    const project = await this.getProjectId(account, accessToken);
    const requestedModel = selectRequestedModel(body.model, this.config);
    const resolvedModel = requestedModel === 'agy-auto' ? this.config.autoResolvedModel : requestedModel;
    const model = mapModel(resolvedModel);
    const request = convertResponsesRequest({ ...body, model }, {
      toolCallCache: this.toolCallCache,
      compaction: options.compaction === true,
      stripImages: options.compaction === true
    });
    const wrapped = {
      project, request, model, userAgent: 'antigravity', requestType: 'agent',
      requestId: `agent/${Date.now()}/${crypto.randomBytes(4).toString('hex')}`,
      enabledCreditTypes: ['GOOGLE_ONE_AI']
    };
    let lastError = '';
    for (const includeProjectHeader of [true, false]) {
      for (const base of UPSTREAMS) {
        const headers = {
          Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json',
          'User-Agent': 'antigravity', 'x-client-name': 'antigravity'
        };
        if (includeProjectHeader) headers['x-goog-user-project'] = project;
        let response;
        try {
          response = await this.fetch(`${base}/v1internal:streamGenerateContent?alt=sse`, {
            method: 'POST', headers, body: JSON.stringify(wrapped), signal
          });
        } catch (error) {
          if (signal && signal.aborted) throw error;
          lastError = `Cloud Code network error: ${error.message}`;
          continue;
        }
        if (response.ok) return { response, model: requestedModel, resolvedModel };
        const text = await response.text();
        lastError = `Cloud Code ${response.status}: ${text}`;
        if (response.status === 403 && includeProjectHeader) break;
        if (![404, 408, 500, 502, 503, 504].includes(response.status)) throw new Error(lastError);
      }
    }
    throw new Error(lastError || 'Cloud Code 请求失败');
  }

  async openCustomUpstream(body, signal) {
    if (!this.config.customBaseUrl || !this.config.customApiKey) throw new Error('自定义 Provider 配置不完整');
    const upstreamUrl = new URL(this.config.customBaseUrl);
    const upstreamPort = Number(upstreamUrl.port || (upstreamUrl.protocol === 'https:' ? 443 : 80));
    if (['127.0.0.1', 'localhost', '::1'].includes(upstreamUrl.hostname) && upstreamPort === this.config.port) {
      throw new Error('自定义 Provider 不能指向小助手自身端口，否则会形成代理循环');
    }
    const allowedModels = this.config.customModels;
    const requested = String(body.model || '').trim();
    const model = requested && (!allowedModels.length || allowedModels.includes(requested))
      ? requested : (this.config.model || allowedModels[0]);
    const response = await this.fetch(`${this.config.customBaseUrl}/responses`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: body.stream === false ? 'application/json' : 'text/event-stream',
        Authorization: `Bearer ${this.config.customApiKey}`
      },
      body: JSON.stringify({ ...body, model })
    });
    return { response, model, resolvedModel: model };
  }

  async callUpstream(body, signal) {
    const upstream = await this.openUpstream(body, signal);
    return { text: await upstream.response.text(), model: upstream.model, resolvedModel: upstream.resolvedModel };
  }

  async handle(req, res) {
    let requestState = null;
    let requestFallback = '';
    let usedFallback = false;
    try {
      const url = new URL(req.url, `http://127.0.0.1:${this.config.port}`);
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'ok', service: 'agy-hub-codex-gateway' }));
        return;
      }
      const authorization = String(req.headers.authorization || '');
      if (authorization !== `Bearer ${this.config.apiKey}`) {
        jsonError(res, 401, 'Invalid API key', 'authentication_error');
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/models') {
        const custom = this.config.mode === 'custom';
        const modelIds = custom && this.config.customModels.length ? this.config.customModels : MODELS;
        const codexModels = custom
          ? buildCodexModelsResponse(modelIds, { contextWindow: 400000, autoCompactPercent: 80 })
          : buildAntigravityCodexModelsResponse({ contextWindow: 360000, autoCompactPercent: 75 });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          ...codexModels,
          object: 'list',
          data: (custom ? modelIds : Object.keys(CODEX_VISIBLE_MODEL_ALIASES))
            .map(id => ({ id, object: 'model', owned_by: custom ? 'custom' : 'antigravity' }))
        }));
        return;
      }
      if (req.method === 'POST' && ['/v1/responses/compact', '/responses/compact'].includes(url.pathname)) {
        jsonError(res, 501, '当前本地 Provider 使用普通 /responses 完成上下文压缩，请勿启用远程压缩端点', 'unsupported_compaction_endpoint');
        return;
      }
      if (req.method !== 'POST' || !['/v1/responses', '/responses'].includes(url.pathname)) {
        jsonError(res, 404, 'Endpoint not found', 'not_found_error');
        return;
      }
      const receivedBody = await readJson(req);
      const compaction = Boolean(isCompactionRequest(req, receivedBody));
      const body = compaction ? optimizeCompactionBody(receivedBody) : receivedBody;
      const fallbackSummary = compaction ? buildEmergencyCompactionSummary(body) : '';
      requestFallback = fallbackSummary;
      const responseId = `resp_${crypto.randomBytes(12).toString('hex')}`;
      const controller = new AbortController();
      const timeoutMs = compaction ? COMPACTION_TIMEOUT_MS : NORMAL_TIMEOUT_MS;
      const startedAt = Date.now();
      requestState = {
        id: responseId,
        kind: compaction ? 'compaction' : 'turn',
        mode: this.config.mode,
        model: String(body.model || this.config.model || ''),
        inputItems: Array.isArray(body.input) ? body.input.length : 1,
        startedAt: new Date(startedAt).toISOString()
      };
      this.activeRequest = requestState;
      this.writeDiagnostic('request.started', requestState);
      const timeout = setTimeout(() => controller.abort(new Error(compaction
        ? '上下文压缩超过 4 分钟，已切换到本地恢复摘要'
        : '上游请求超过 30 分钟')), timeoutMs);
      const abortOnClose = () => {
        if (!res.writableEnded) controller.abort(new Error('客户端已断开'));
      };
      req.once('aborted', abortOnClose);
      res.once('close', abortOnClose);
      res.once('finish', () => clearTimeout(timeout));
      const { kinds } = toolDeclarations(body.tools);
      const outputOptions = {
        toolKinds: kinds,
        idleTimeoutMs: compaction ? COMPACTION_IDLE_TIMEOUT_MS : undefined,
        compactionFallback: fallbackSummary,
        onToolCall: (item, metadata) => this.rememberToolCall(item, metadata),
        onFallback: error => {
          usedFallback = true;
          this.writeDiagnostic('compaction.fallback', {
            id: responseId,
            mode: this.config.mode,
            reason: error.message
          });
        },
        onUsage: (metadata, model) => {
          if (this.onUsage) this.onUsage(metadata, outputOptions.resolvedModel || model, this.config.accountId);
        }
      };
      const finishRequest = (status, error = '') => {
        const completed = {
          ...requestState,
          status,
          durationMs: Date.now() - startedAt,
          completedAt: new Date().toISOString(),
          ...(error ? { error } : {})
        };
        this.lastRequest = completed;
        if (this.activeRequest && this.activeRequest.id === responseId) this.activeRequest = null;
        this.writeDiagnostic('request.completed', completed);
      };
      if (body.stream !== false) {
        const upstream = this.config.mode === 'custom'
          ? await this.openCustomUpstream(body, controller.signal)
          : await this.openUpstream(body, controller.signal, { compaction });
        outputOptions.resolvedModel = upstream.resolvedModel;
        if (this.config.mode === 'custom') {
          await relayResponsesUpstream(res, upstream.response, {
            bufferCompaction: compaction,
            idleTimeoutMs: COMPACTION_IDLE_TIMEOUT_MS,
            compactionFallback: fallbackSummary,
            model: upstream.model,
            onFallback: outputOptions.onFallback
          });
        } else {
          await streamUpstreamResponse(res, upstream.response, upstream.model, responseId, outputOptions);
        }
        finishRequest(usedFallback ? 'fallback' : 'completed');
      } else {
        if (this.config.mode === 'custom') {
          const upstream = await this.openCustomUpstream(body, controller.signal);
          await relayResponsesUpstream(res, upstream.response);
          finishRequest('completed');
          return;
        }
        const upstream = await this.openUpstream(body, controller.signal, { compaction });
        const upstreamText = await upstream.response.text();
        const payloads = parseUpstreamEvents(upstreamText);
        const parts = collectParts(payloads);
        if (!parts.length) throw new Error('Cloud Code 返回了空响应');
        const usageMetadata = payloads.reduce((latest, payload) => {
          const root = payload && payload.response ? payload.response : payload;
          return root && root.usageMetadata || latest;
        }, null);
        if (usageMetadata && this.onUsage) this.onUsage(usageMetadata, upstream.resolvedModel || upstream.model, this.config.accountId);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(createResponsesOutput(parts, upstream.model, responseId, { ...outputOptions, usageMetadata })));
        finishRequest('completed');
      }
    } catch (error) {
      const clientDisconnected = req.aborted || res.destroyed;
      if (!clientDisconnected && requestState && requestState.kind === 'compaction') {
        this.writeDiagnostic('compaction.fallback', { id: requestState.id, mode: requestState.mode, reason: error.message });
        if (!res.writableEnded) writeSyntheticCompleted(res, requestState.model,
          requestFallback || buildEmergencyCompactionSummary({ input: [] }), requestState.id);
      } else if (!res.headersSent) {
        jsonError(res, 502, error.message, 'upstream_error');
      } else if (!res.writableEnded) {
        res.end();
      }
      if (requestState) {
        const completed = {
          ...requestState,
          status: clientDisconnected ? 'aborted' : (requestState.kind === 'compaction' ? 'fallback' : 'failed'),
          error: error.message,
          completedAt: new Date().toISOString()
        };
        this.lastRequest = completed;
        if (this.activeRequest && this.activeRequest.id === requestState.id) this.activeRequest = null;
        this.writeDiagnostic('request.completed', completed);
      }
    }
  }
}

module.exports = {
  CodexGateway, DEFAULT_PORT, DEFAULT_MODEL, MODELS,
  mapModel, selectRequestedModel, convertResponsesRequest, parseUpstreamEvents, collectParts, createResponsesOutput,
  decodeRequestBody, isCompactionRequest, optimizeCompactionBody, buildEmergencyCompactionSummary
};
