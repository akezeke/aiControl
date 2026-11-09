import { randomUUID } from 'node:crypto';
import { agentFolder } from './folders.mjs';
import { claudeModels } from './claude-models.mjs';
import { fail } from './requests.mjs';

// Presets carry preferences, never permissions or an automatically submitted prompt.
export async function launchPreset(body, { workspace, codex, claude, opencode, defaults, seats, launches, spawnAgent, modelsForClaude = claudeModels }) {
  const presets = workspace.snapshot().presets, id = body?.presetId;
  if (typeof id !== 'string' || id.length > 256 || !Object.hasOwn(presets, id)) throw fail('Unknown launch preset.', 404);
  const preset = presets[id], { provider } = preset;
  if (!['codex', 'claude', 'opencode'].includes(provider)) throw fail('Choose a provider for this preset.', 400);
  const cwd = agentFolder(preset.cwd), account = provider === 'claude' ? claude.accountFor(cwd, preset.account) : null;
  const saved = await defaults.read(provider, account?.label);
  const settings = { model: preset.model ?? saved.model ?? '', effort: preset.effort ?? saved.effort ?? '' };
  if (provider !== 'codex' && (settings.model || settings.effort)) {
    const models = provider === 'claude' ? await modelsForClaude(cwd, account?.dir) : await opencode.modelsFor(cwd);
    const selected = models.find(model => model.id === settings.model);
    if (!selected) throw fail('The preset model is unavailable. Choose a model.', 400);
    if (settings.effort && !selected.efforts?.includes(settings.effort)) throw fail('The preset effort is unavailable for this model.', 400);
  }
  const nativeId = provider === 'claude' ? randomUUID() : null;
  const created = provider === 'codex' ? await codex.spawn(cwd, settings) : provider === 'opencode' ? await opencode.spawn(cwd, settings) : { sessionId: `claude:${nativeId}` };
  const sessionId = created.sessionId;
  if (!sessionId?.startsWith(provider + ':') || !/^[\w-]{1,100}$/.test(sessionId.slice(provider.length + 1))) throw fail('The new session was not confirmed. Check the session list before retrying.', 502);
  if (preset.prompt) {
    try { await workspace.patch({ section: 'drafts', key: sessionId, value: { text: preset.prompt }, baseRevision: workspace.snapshot().drafts[sessionId]?.revision || 0 }); }
    catch (error) {
      if (provider === 'claude') throw error;
      return { ...created, warning: 'Session created, but its starting draft could not be saved. The prompt remains in the preset.' };
    }
  }
  seats.reserve(cwd, body.slot);
  try {
    const started = await spawnAgent(cwd, provider, provider === 'claude' ? { configDir: account?.label ? account.dir : '', ...settings, sessionId: nativeId }
      : provider === 'codex' ? { args: ['resume', sessionId.slice(6)] } : { sessionId: sessionId.slice(9) });
    if (provider === 'claude') launches.watch({ ...started, provider, cwd, account: account?.label || '', sessionId: nativeId });
    return { ...created, ...started, sessionId };
  } catch (error) {
    seats.release(cwd, body.slot);
    if (provider === 'claude') throw error;
    return { ...created, warning: 'Session created and draft saved, but its tmux terminal could not open.' };
  }
}
