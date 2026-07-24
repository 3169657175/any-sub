const MODELS = [
  'agy-auto',
  'gemini-3.6-flash-high',
  'gemini-3.6-flash-medium',
  'gemini-3.6-flash-low',
  'gemini-3.1-pro-high',
  'gemini-3.1-pro-low',
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium'
];

const MODEL_DISPLAY_NAMES = {
  'agy-auto': 'AGY 自动路由（按额度）',
  'gemini-3.6-flash-high': 'Gemini 3.6 Flash (High)',
  'gemini-3.6-flash-medium': 'Gemini 3.6 Flash (Medium)',
  'gemini-3.6-flash-low': 'Gemini 3.6 Flash (Low)',
  'gemini-3.1-pro-high': 'Gemini 3.1 Pro (High)',
  'gemini-3.1-pro-low': 'Gemini 3.1 Pro (Low)',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6 (Thinking)',
  'claude-opus-4-6-thinking': 'Claude Opus 4.6 (Thinking)',
  'gpt-oss-120b-medium': 'GPT-OSS 120B (Medium)'
};

// Codex Desktop can restrict the picker to model ids from its remote allowlist.
// Keep real Antigravity ids at the gateway boundary and expose allowlisted
// aliases only in Codex's model catalog.
const CODEX_VISIBLE_MODEL_ALIASES = {
  'gpt-5.6-sol': 'gemini-3.6-flash-high',
  'gpt-5.6-terra': 'gemini-3.6-flash-medium',
  'gpt-5.6-luna': 'gemini-3.6-flash-low',
  'gpt-5.5': 'gemini-3.1-pro-high',
  'gpt-5.4': 'gemini-3.1-pro-low',
  'gpt-5.4-mini': 'claude-sonnet-4-6',
  'gpt-5.3-codex': 'claude-opus-4-6-thinking',
  'gpt-5.6': 'gpt-oss-120b-medium'
};

const REAL_MODEL_TO_CODEX_ALIAS = Object.fromEntries(
  Object.entries(CODEX_VISIBLE_MODEL_ALIASES).map(([alias, model]) => [model, alias])
);

const BASE_INSTRUCTIONS = [
  'You are Codex, a coding agent working with the user in the current workspace.',
  'Follow developer and user instructions, inspect relevant files before editing, preserve unrelated changes,',
  'use the available tools when needed, and continue through implementation and verification.',
  'Keep progress updates concise and make the final answer clear.'
].join(' ');

const AVAILABLE_PLANS = [
  'business', 'edu', 'edu_plus', 'edu_pro', 'education', 'enterprise',
  'enterprise_cbp_automation', 'enterprise_cbp_usage_based', 'finserv',
  'free', 'free_workspace', 'go', 'hc', 'k12', 'plus', 'pro', 'prolite',
  'quorum', 'sci', 'self_serve_business_usage_based', 'team'
];

function displayName(slug) {
  return MODEL_DISPLAY_NAMES[slug] || slug;
}

function modelInfo(slug, priority, options = {}) {
  const contextWindow = Number(options.contextWindow) || 1000000;
  const autoCompactPercent = Math.min(90, Math.max(50, Number(options.autoCompactPercent) || 90));
  return {
    slug,
    display_name: options.displayName || displayName(slug),
    description: options.description || (slug === 'agy-auto'
      ? 'AGY Hub selects an Antigravity model from the current account quota.'
      : 'Antigravity model exposed through the local AGY Hub Responses gateway.'),
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      { effort: 'low', description: 'Faster responses' },
      { effort: 'medium', description: 'Balanced reasoning' },
      { effort: 'high', description: 'Deeper reasoning' }
    ],
    shell_type: 'shell_command',
    visibility: 'list',
    supported_in_api: true,
    priority,
    prefer_websockets: false,
    additional_speed_tiers: [],
    auto_review_model_override: null,
    availability_nux: null,
    available_in_plans: AVAILABLE_PLANS,
    comp_hash: '3000',
    default_service_tier: null,
    minimal_client_version: '0.144.0',
    multi_agent_version: 'v2',
    upgrade: null,
    base_instructions: BASE_INSTRUCTIONS,
    model_messages: null,
    include_skills_usage_instructions: true,
    supports_reasoning_summary_parameter: true,
    supports_reasoning_summaries: true,
    reasoning_summary_format: 'experimental',
    default_reasoning_summary: 'auto',
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: 'freeform',
    web_search_tool_type: 'text',
    truncation_policy: { mode: 'tokens', limit: 10000 },
    supports_parallel_tool_calls: true,
    supports_image_detail_original: true,
    context_window: contextWindow,
    max_context_window: contextWindow,
    auto_compact_token_limit: Math.floor(contextWindow * autoCompactPercent / 100),
    effective_context_window_percent: autoCompactPercent,
    experimental_supported_tools: [],
    input_modalities: ['text', 'image'],
    supports_search_tool: false,
    service_tiers: [],
    tool_mode: 'code_mode_only',
    use_responses_lite: false
  };
}

function buildCodexModelsResponse(slugs = MODELS, options = {}) {
  return { models: slugs.map((slug, index) => modelInfo(slug, index + 1, options)) };
}

function buildAntigravityCodexModelsResponse(options = {}) {
  return {
    models: Object.entries(CODEX_VISIBLE_MODEL_ALIASES).map(([alias, model], index) => modelInfo(alias, index + 1, {
      ...options,
      displayName: MODEL_DISPLAY_NAMES[model] || model,
      description: `Antigravity model ${model} exposed through the local AGY Hub Responses gateway.`
    }))
  };
}

function resolveCodexModelAlias(model) {
  return CODEX_VISIBLE_MODEL_ALIASES[String(model || '')] || String(model || '');
}

function codexAliasForModel(model) {
  return REAL_MODEL_TO_CODEX_ALIAS[String(model || '')] || String(model || '');
}

module.exports = {
  MODELS,
  MODEL_DISPLAY_NAMES,
  CODEX_VISIBLE_MODEL_ALIASES,
  modelInfo,
  buildCodexModelsResponse,
  buildAntigravityCodexModelsResponse,
  resolveCodexModelAlias,
  codexAliasForModel
};
