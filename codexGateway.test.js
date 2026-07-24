const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const {
  CodexGateway, mapModel, selectRequestedModel, convertResponsesRequest, parseUpstreamEvents, collectParts, createResponsesOutput,
  decodeRequestBody, isCompactionRequest, optimizeCompactionBody, buildEmergencyCompactionSummary
} = require('./codexGateway');
const { buildCodexConfig, connectCodex, restoreCodex } = require('./codexConfig');
const {
  MODELS,
  CODEX_VISIBLE_MODEL_ALIASES,
  buildCodexModelsResponse,
  buildAntigravityCodexModelsResponse,
  codexAliasForModel
} = require('./codexModels');
const { readProfiles, saveProfile, deleteProfile } = require('./codexProviderProfiles');

test('publishes the currently available Antigravity model catalog', () => {
  assert.equal(MODELS.length, 9);
  assert.deepEqual(MODELS, [
    'agy-auto',
    'gemini-3.6-flash-high', 'gemini-3.6-flash-medium', 'gemini-3.6-flash-low',
    'gemini-3.1-pro-high', 'gemini-3.1-pro-low', 'claude-sonnet-4-6',
    'claude-opus-4-6-thinking', 'gpt-oss-120b-medium'
  ]);
  const catalog = buildCodexModelsResponse();
  assert.equal(catalog.models.length, 9);
  assert.equal(catalog.models[0].display_name, 'AGY 自动路由（按额度）');
  assert.equal(catalog.models[8].display_name, 'GPT-OSS 120B (Medium)');
  assert.equal(catalog.models[0].minimal_client_version, '0.144.0');
  assert.equal(catalog.models[0].multi_agent_version, 'v2');
  assert.equal(catalog.models[0].supports_reasoning_summaries, true);
  assert.equal(catalog.models[0].tool_mode, 'code_mode_only');
  assert.ok(catalog.models[0].available_in_plans.includes('k12'));

  const visibleCatalog = buildAntigravityCodexModelsResponse();
  assert.equal(visibleCatalog.models.length, 8);
  assert.deepEqual(visibleCatalog.models.map(item => item.slug), Object.keys(CODEX_VISIBLE_MODEL_ALIASES));
  assert.equal(visibleCatalog.models[0].display_name, 'Gemini 3.6 Flash (High)');
  assert.equal(codexAliasForModel('gemini-3.1-pro-high'), 'gpt-5.5');
  assert.equal(codexAliasForModel('claude-sonnet-4-6'), 'gpt-5.4-mini');
  assert.equal(codexAliasForModel('claude-opus-4-6-thinking'), 'gpt-5.3-codex');
  assert.equal(visibleCatalog.models.some(item => /Gemini 3\.5/i.test(item.display_name)), false);
  assert.deepEqual(
    visibleCatalog.models.filter(item => /^Claude /.test(item.display_name)).map(item => item.display_name),
    ['Claude Sonnet 4.6 (Thinking)', 'Claude Opus 4.6 (Thinking)']
  );
});

test('supports explicit gateway and Codex model control modes', () => {
  assert.equal(selectRequestedModel('gemini-3.6-flash-high', {
    model: 'gemini-3.1-pro-high', modelControl: 'gateway'
  }), 'gemini-3.1-pro-high');
  assert.equal(selectRequestedModel('gemini-3.6-flash-high', {
    model: 'gemini-3.1-pro-high', modelControl: 'client'
  }), 'gemini-3.6-flash-high');
  assert.equal(selectRequestedModel('gpt-5.6-sol', {
    model: 'gemini-3.1-pro-high', modelControl: 'client'
  }), 'gemini-3.6-flash-high');
});

test('migrates removed Gemini 3.5 selections to the safe default', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-removed-model-'));
  fs.writeFileSync(path.join(root, 'codex-gateway.json'), JSON.stringify({
    mode: 'antigravity',
    model: 'gemini-3.5-flash-high',
    autoResolvedModel: 'gemini-3.5-flash-medium'
  }), 'utf8');
  const gateway = new CodexGateway({ accountRoot: root, stateDir: root });
  const status = gateway.status();
  assert.equal(status.model, 'gemini-3.1-pro-high');
  assert.equal(status.autoResolvedModel, 'gemini-3.1-pro-high');
  assert.equal(status.models.some(model => model.startsWith('gemini-3.5-flash')), false);
});

test('resolves the virtual auto model to the configured physical model', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-auto-model-'));
  let requestBody = null;
  const gateway = new CodexGateway({
    fetch: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, status: 200, text: async () => 'data: {"response":{"candidates":[]}}\n\n' };
    },
    accountRoot: root, stateDir: root, decryptToken: value => value, clientId: 'test', clientSecret: 'test'
  });
  gateway.loadAccount = () => ({ id: 'account', token: {} });
  gateway.getAccessToken = async () => 'access-token';
  gateway.getProjectId = async () => 'project-id';
  gateway.configure({ model: 'agy-auto', autoResolvedModel: 'claude-sonnet-4-6' });
  await gateway.callUpstream({ model: 'agy-auto', input: 'hi' });
  assert.equal(requestBody.model, 'claude-sonnet-4-6');
});

test('maps Codex model and converts messages/tools', () => {
  assert.equal(mapModel('gemini-3.1-pro-high'), 'gemini-pro-agent');
  const result = convertResponsesRequest({
    instructions: 'You are Codex.',
    input: [{
      type: 'message', role: 'user',
      content: [
        { type: 'input_text', text: 'hi' },
        { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' }
      ]
    }],
    tools: [{ type: 'function', name: 'shell', parameters: { type: 'object', additionalProperties: false, properties: { cmd: { type: 'string' } } } }]
  });
  assert.equal(result.systemInstruction.parts[0].text, 'You are Codex.');
  assert.equal(result.contents[0].parts[0].text, 'hi');
  assert.deepEqual(result.contents[0].parts[1].inlineData, { mimeType: 'image/png', data: 'aGVsbG8=' });
  assert.equal(result.tools[0].functionDeclarations[0].name, 'shell');
  assert.equal(result.tools[0].functionDeclarations[0].parameters.additionalProperties, undefined);
});

test('decodes compressed Codex request bodies', () => {
  const source = Buffer.from(JSON.stringify({ model: 'gpt-5.6-sol', input: 'hello' }));
  assert.deepEqual(JSON.parse(decodeRequestBody(zlib.gzipSync(source), 'gzip').toString('utf8')), {
    model: 'gpt-5.6-sol', input: 'hello'
  });
  assert.deepEqual(JSON.parse(decodeRequestBody(zlib.brotliCompressSync(source), 'br').toString('utf8')), {
    model: 'gpt-5.6-sol', input: 'hello'
  });
});

test('recognizes and reduces Codex compaction requests without changing normal turns', () => {
  const metadata = JSON.stringify({ request_kind: 'compaction' });
  const body = {
    client_metadata: { 'x-codex-turn-metadata': metadata },
    tools: [{ type: 'function', name: 'shell' }],
    input: [{
      type: 'message', role: 'user', content: [
        { type: 'input_text', text: 'keep this task' },
        { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' }
      ]
    }, { type: 'function_call_output', call_id: 'call_1', output: 'x'.repeat(30000) }]
  };
  assert.equal(isCompactionRequest({ headers: {} }, body), true);
  const optimized = optimizeCompactionBody(body);
  assert.deepEqual(optimized.tools, []);
  assert.equal(optimized.input[0].content.some(item => item.type === 'input_image'), false);
  assert.match(optimized.input[0].content[1].text, /Image omitted/);
  assert.ok(optimized.input[1].output.length < 13000);
  assert.match(buildEmergencyCompactionSummary(optimized), /keep this task/);
});

test('parses Cloud Code SSE and creates Responses output', () => {
  const events = parseUpstreamEvents('data: {"response":{"candidates":[{"content":{"parts":[{"text":"hello"},{"functionCall":{"name":"shell","args":{"cmd":"dir"}}}]}}]}}\n\ndata: [DONE]\n');
  const parts = collectParts(events);
  const response = createResponsesOutput(parts, 'gemini-3.1-pro-high', 'resp_test');
  assert.equal(response.output[0].content[0].text, 'hello');
  assert.equal(response.output[1].name, 'shell');
});

test('retries a 403 without x-goog-user-project', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-gateway-'));
  const calls = [];
  const gateway = new CodexGateway({
    fetch: async (url, options) => {
      calls.push({ url, headers: options.headers });
      if (calls.length === 1) return { ok: false, status: 403, text: async () => 'SERVICE_DISABLED' };
      return { ok: true, status: 200, text: async () => 'data: {"response":{"candidates":[]}}\n\n' };
    },
    accountRoot: root,
    stateDir: root,
    decryptToken: value => value,
    clientId: 'test',
    clientSecret: 'test'
  });
  gateway.loadAccount = () => ({ id: 'account', token: {} });
  gateway.getAccessToken = async () => 'access-token';
  gateway.getProjectId = async () => 'project-id';
  await gateway.callUpstream({ model: 'gemini-3.1-pro-high', input: 'hi' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers['x-goog-user-project'], 'project-id');
  assert.equal(calls[1].headers['x-goog-user-project'], undefined);
});

test('uses the manually selected account for subsequent gateway calls', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-selected-account-'));
  const accountsDir = path.join(root, 'accounts');
  fs.mkdirSync(accountsDir);
  fs.writeFileSync(path.join(root, 'accounts.json'), JSON.stringify({
    current_account_id: 'first',
    accounts: [{ id: 'first' }, { id: 'second' }]
  }), 'utf8');
  fs.writeFileSync(path.join(accountsDir, 'first.json'), JSON.stringify({ token: { refresh_token: 'first-token' } }), 'utf8');
  fs.writeFileSync(path.join(accountsDir, 'second.json'), JSON.stringify({ token: { refresh_token: 'second-token' } }), 'utf8');

  const gateway = new CodexGateway({
    fetch: async () => ({ ok: true, status: 200, text: async () => 'data: {"response":{"candidates":[]}}\n\n' }),
    accountRoot: root, stateDir: root, decryptToken: value => value.token, clientId: 'test', clientSecret: 'test'
  });
  gateway.getAccessToken = async account => account.id;
  gateway.getProjectId = async () => 'project-id';
  let selected = gateway.loadAccount();
  assert.equal(selected.id, 'first');
  gateway.configure({ accountId: 'second' });
  selected = gateway.loadAccount();
  assert.equal(selected.id, 'second');
});

test('preserves custom tool type and thought signature across turns', () => {
  const cache = new Map();
  const toolKinds = new Map([['apply_patch', 'custom']]);
  let callItem;
  const response = createResponsesOutput([
    { functionCall: { name: 'apply_patch', args: { input: '*** Begin Patch' } }, thoughtSignature: 'signed-thought' }
  ], 'gemini-3.1-pro-high', 'resp_tools', {
    toolKinds,
    onToolCall(item, metadata) {
      callItem = item;
      cache.set(item.call_id, { ...metadata, thoughtSignature: metadata.thoughtSignature });
    }
  });
  assert.equal(response.output[0].type, 'custom_tool_call');
  assert.equal(response.output[0].input, '*** Begin Patch');

  const next = convertResponsesRequest({
    input: [
      callItem,
      { type: 'custom_tool_call_output', call_id: callItem.call_id, output: { content: 'Done', success: true } }
    ],
    tools: [{ type: 'custom', name: 'apply_patch', description: 'Apply a patch' }]
  }, { toolCallCache: cache });
  assert.equal(next.contents[0].parts[0].functionCall.name, 'apply_patch');
  assert.equal(next.contents[0].parts[0].thoughtSignature, 'signed-thought');
  assert.equal(next.contents[1].parts[0].functionResponse.response.result, 'Done');
  assert.equal(next.tools[0].functionDeclarations[0].parameters.properties.input.type, 'string');
});

test('persists tool signatures across gateway restarts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-tool-cache-'));
  const options = {
    fetch: async () => {}, accountRoot: root, stateDir: root,
    decryptToken: value => value, clientId: 'test', clientSecret: 'test'
  };
  const first = new CodexGateway(options);
  first.rememberToolCall({ call_id: 'call_saved' }, {
    name: 'apply_patch', kind: 'custom', thoughtSignature: 'signature_saved'
  });
  const second = new CodexGateway(options);
  assert.deepEqual(second.toolCallCache.get('call_saved'), {
    name: 'apply_patch', kind: 'custom', thoughtSignature: 'signature_saved'
  });
});

test('keeps complete long conversation history', () => {
  const input = Array.from({ length: 300 }, (_, index) => ({
    type: 'message',
    role: index % 2 ? 'assistant' : 'user',
    content: [{ type: index % 2 ? 'output_text' : 'input_text', text: `turn-${index}` }]
  }));
  const converted = convertResponsesRequest({ input });
  assert.equal(converted.contents.length, 300);
  assert.equal(converted.contents[0].parts[0].text, 'turn-0');
  assert.equal(converted.contents[299].parts[0].text, 'turn-299');
  assert.equal(converted.contents[299].role, 'model');
});

test('streams Cloud Code chunks through the local Responses endpoint', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-stream-'));
  const port = 20000 + Math.floor(Math.random() * 10000);
  const encoder = new TextEncoder();
  const upstreamBody = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"response":{"candidates":[{"content":{"parts":[{"text":"first "}]}}]}}\n\n'));
      setTimeout(() => {
        controller.enqueue(encoder.encode('data: {"response":{"candidates":[{"content":{"parts":[{"text":"second"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2,"totalTokenCount":6}}}\n\n'));
        controller.close();
      }, 30);
    }
  });
  const gateway = new CodexGateway({
    fetch: async () => new Response(upstreamBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    accountRoot: root,
    stateDir: root,
    decryptToken: value => value,
    clientId: 'test',
    clientSecret: 'test'
  });
  gateway.loadAccount = () => ({ id: 'account', token: {} });
  gateway.getAccessToken = async () => 'access-token';
  gateway.getProjectId = async () => 'project-id';
  const status = await gateway.start({ port });
  try {
    const result = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${status.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3.1-pro-high', input: 'hello', stream: true })
    });
    const text = await result.text();
    assert.equal(result.status, 200);
    assert.match(text, /response\.output_text\.delta/);
    assert.match(text, /first /);
    assert.match(text, /second/);
    assert.match(text, /response\.completed/);
    assert.match(text, /"total_tokens":6/);
  } finally {
    await gateway.stop();
  }
});

test('reports official Cloud Code usage after a streamed response', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-usage-callback-'));
  const port = 30000 + Math.floor(Math.random() * 5000);
  const reported = [];
  const upstream = 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":20,"cachedContentTokenCount":80,"totalTokenCount":120}}}\n\n';
  const gateway = new CodexGateway({
    fetch: async () => new Response(upstream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    accountRoot: root, stateDir: root, decryptToken: value => value,
    clientId: 'test', clientSecret: 'test',
    onUsage: (metadata, model) => reported.push({ metadata, model })
  });
  gateway.loadAccount = () => ({ id: 'account', token: {} });
  gateway.getAccessToken = async () => 'access-token';
  gateway.getProjectId = async () => 'project-id';
  const status = await gateway.start({ port });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${status.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3.1-pro-high', input: 'hello', stream: true })
    });
    await response.text();
    assert.equal(reported.length, 1);
    assert.equal(reported[0].metadata.cachedContentTokenCount, 80);
    assert.equal(reported[0].metadata.promptTokenCount, 100);
  } finally {
    await gateway.stop();
  }
});

test('emits response.failed when upstream finishes without visible output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-empty-stream-'));
  const port = 30000 + Math.floor(Math.random() * 10000);
  const upstream = 'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"thinking"}]},"finishReason":"MAX_TOKENS"}]}}\n\n';
  const gateway = new CodexGateway({
    fetch: async () => new Response(upstream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    accountRoot: root,
    stateDir: root,
    decryptToken: value => value,
    clientId: 'test',
    clientSecret: 'test'
  });
  gateway.loadAccount = () => ({ id: 'account', token: {} });
  gateway.getAccessToken = async () => 'access-token';
  gateway.getProjectId = async () => 'project-id';
  const status = await gateway.start({ port });
  try {
    const result = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${status.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3.1-pro-high', input: 'hello', stream: true })
    });
    const text = await result.text();
    assert.match(text, /response\.failed/);
    assert.match(text, /MAX_TOKENS|max_output_tokens/);
    assert.doesNotMatch(text, /response\.completed/);
  } finally {
    await gateway.stop();
  }
});

test('completes a stalled Antigravity compaction with a local recovery summary', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-compact-fallback-'));
  const port = 30000 + Math.floor(Math.random() * 10000);
  let forwarded = null;
  const upstream = 'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"reasoning only"}]}}]}}\n\n';
  const gateway = new CodexGateway({
    fetch: async (_url, options) => {
      forwarded = JSON.parse(options.body);
      return new Response(upstream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    },
    accountRoot: root, stateDir: root, decryptToken: value => value,
    clientId: 'test', clientSecret: 'test'
  });
  gateway.loadAccount = () => ({ id: 'account', token: {} });
  gateway.getAccessToken = async () => 'access-token';
  gateway.getProjectId = async () => 'project-id';
  const status = await gateway.start({ port, mode: 'antigravity' });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${status.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.6-sol', stream: true,
        client_metadata: { 'x-codex-turn-metadata': JSON.stringify({ request_kind: 'compaction' }) },
        input: [{ type: 'message', role: 'user', content: [
          { type: 'input_text', text: 'important current task' },
          { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' }
        ] }]
      })
    });
    const text = await response.text();
    assert.match(text, /response\.completed/);
    assert.match(text, /Context recovery summary generated locally/);
    assert.doesNotMatch(text, /response\.failed/);
    assert.equal(JSON.stringify(forwarded).includes('inlineData'), false);
    assert.equal(gateway.status().lastRequest.status, 'fallback');
  } finally {
    await gateway.stop();
  }
});

test('protects custom Responses providers through the local gateway', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-custom-compact-'));
  const port = 30000 + Math.floor(Math.random() * 10000);
  let requestedUrl = '';
  let forwarded = null;
  const gateway = new CodexGateway({
    fetch: async (url, options) => {
      requestedUrl = String(url);
      forwarded = JSON.parse(options.body);
      return new Response('event: response.created\ndata: {"type":"response.created"}\n\n', {
        status: 200, headers: { 'Content-Type': 'text/event-stream' }
      });
    },
    accountRoot: root, stateDir: root, decryptToken: value => value,
    clientId: 'test', clientSecret: 'test'
  });
  const status = await gateway.start({
    port, mode: 'custom', customBaseUrl: 'https://provider.example/v1',
    customApiKey: 'secret', customProviderName: 'Sub2API',
    customModels: ['gpt-5.6-sol'], model: 'gpt-5.6-sol', modelControl: 'client'
  });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${status.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.6-sol', stream: true,
        client_metadata: { 'x-codex-turn-metadata': JSON.stringify({ request_kind: 'compaction' }) },
        input: [{ type: 'message', role: 'user', content: [
          { type: 'input_text', text: 'custom provider task' },
          { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' }
        ] }]
      })
    });
    const text = await response.text();
    assert.equal(requestedUrl, 'https://provider.example/v1/responses');
    assert.equal(forwarded.model, 'gpt-5.6-sol');
    assert.equal(JSON.stringify(forwarded).includes('input_image'), false);
    assert.match(text, /response\.completed/);
    assert.match(text, /custom provider task/);
    assert.equal(gateway.status().lastRequest.status, 'fallback');
  } finally {
    await gateway.stop();
  }
});

test('preserves unrelated TOML while replacing managed provider', () => {
  const existing = 'approval_policy = "on-request"\n[features]\nweb_search = true\n\n[model_providers.agy_hub]\nbase_url = "old"\n';
  const result = buildCodexConfig(existing, { baseUrl: 'http://127.0.0.1:8046/v1', apiKey: 'sk-test', model: 'gemini-3.1-pro-high' });
  assert.match(result, /approval_policy = "on-request"/);
  assert.match(result, /\[features\]\nweb_search = true/);
  assert.doesNotMatch(result, /\[model_providers\.agy_hub\]/);
  assert.equal((result.match(/\[model_providers\.codex_local_access\]/g) || []).length, 1);
  assert.match(result, /wire_api = "responses"/);
  assert.match(result, /requires_openai_auth = false/);
  assert.match(result, /model_catalog_json = "agy-hub-model-catalog\.json"/);
});

test('backs up and restores Codex config', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-codex-config-'));
  const codexHome = path.join(root, '.codex');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "official"\n', 'utf8');
  fs.writeFileSync(path.join(codexHome, 'auth.json'), '{"tokens":{"access_token":"keep"}}\n', 'utf8');
  connectCodex({ codexHome, stateDir, baseUrl: 'http://127.0.0.1:8046/v1', apiKey: 'sk-test', model: 'gemini-3.1-pro-high' });
  connectCodex({ codexHome, stateDir, baseUrl: 'http://127.0.0.1:9000/v1', apiKey: 'sk-new', model: 'gemini-3.6-flash' });
  assert.match(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'), /model_provider = "codex_local_access"/);
  assert.match(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'), /127\.0\.0\.1:9000/);
  assert.match(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'), /model_catalog_json = "agy-hub-model-catalog-[a-f0-9]{12}\.json"/);
  assert.match(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'), /requires_openai_auth = false/);
  const catalogPath = JSON.parse(fs.readFileSync(path.join(stateDir, 'codex-connection.json'), 'utf8')).catalogs[1].catalogPath;
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  assert.ok(catalog.models.length >= 1);
  assert.deepEqual(catalog.models[0].input_modalities, ['text', 'image']);
  assert.equal(catalog.models[0].context_window, 1000000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(codexHome, 'auth.json'), 'utf8')).tokens.access_token, 'keep');
  restoreCodex({ stateDir });
  assert.equal(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'), 'model = "official"\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(codexHome, 'auth.json'), 'utf8')), { tokens: { access_token: 'keep' } });
  assert.equal(fs.existsSync(catalogPath), false);
});

test('writes a Responses-compatible custom Codex provider and model catalog', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-custom-provider-'));
  const codexHome = path.join(root, '.codex');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(codexHome, { recursive: true });
  connectCodex({
    codexHome,
    stateDir,
    baseUrl: 'http://localhost:8080/v1',
    apiKey: 'sub2api-key',
    model: 'gpt-5.6',
    models: ['gpt-5.6', 'gpt-5.3-codex'],
    protocol: 'responses',
    providerName: 'Sub2API',
    requiresOpenAIAuth: false,
    contextWindow: 400000
  });
  const config = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
  assert.match(config, /name = "AGY Local Gateway · Sub2API"/);
  assert.match(config, /base_url = "http:\/\/localhost:8080\/v1"/);
  assert.match(config, /wire_api = "responses"/);
  assert.match(config, /requires_openai_auth = false/);
  assert.match(config, /request_max_retries = 1/);
  assert.match(config, /stream_max_retries = 1/);
  assert.match(config, /stream_idle_timeout_ms = 120000/);
  const configCatalogPath = path.join(codexHome, /model_catalog_json = "([^"]+)"/.exec(config)[1]);
  const catalog = JSON.parse(fs.readFileSync(configCatalogPath, 'utf8'));
  assert.deepEqual(catalog.models.map(item => item.slug), ['gpt-5.6', 'gpt-5.3-codex']);
  assert.equal(catalog.models[0].context_window, 400000);
  assert.equal(catalog.models[0].auto_compact_token_limit, 320000);
});

test('persists reusable custom provider profiles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-provider-profiles-'));
  const saved = saveProfile(root, {
    providerName: 'Local Sub2API', protocol: 'responses', baseUrl: 'http://127.0.0.1:8080/v1',
    apiKey: 'local-key', modelMode: 'custom', models: ['model-a', 'model-b'], model: 'model-a'
  });
  assert.ok(saved.id);
  assert.equal(readProfiles(root).length, 1);
  const updated = saveProfile(root, { ...saved, providerName: 'Updated Provider' });
  assert.equal(readProfiles(root)[0].providerName, 'Updated Provider');
  deleteProfile(root, updated.id);
  assert.deepEqual(readProfiles(root), []);
});
