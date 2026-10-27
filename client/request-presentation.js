const record = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : '';
const labels = { cwd: 'Working folder', fileSystem: 'File access', file_system: 'File access', read: 'Read access', write: 'Write access', network: 'Network access', enabled: 'Enabled', grantRoot: 'Requested write root', file_path: 'File', old_string: 'Original text', new_string: 'Replacement text', move_path: 'Move to', networkApprovalContext: 'Network connection', additionalPermissions: 'Requested access', permissions: 'Requested access' };
export const fieldLabel = key => labels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());

// Presentation only: the original request and its allowed responses stay intact.
export function requestPresentation(request) {
  let data;
  try { data = typeof request.details === 'string' ? JSON.parse(request.details) : request.details; } catch { /* plain text is already readable */ }
  if (!record(data)) return { reason: text(request.details), command: '', fields: [], files: [], raw: '' };
  const item = record(data.item) ? data.item : {};
  const command = text(data.command) || text(item.command);
  const reason = text(data.reason) || text(data.description);
  const fields = [];
  const add = (label, value) => { if (value != null && value !== '') fields.push({ label, value }); };
  add('Working folder', data.cwd ?? item.cwd);
  add('Requested write root', data.grantRoot);
  add('Network connection', data.networkApprovalContext);
  add('Requested access', data.additionalPermissions ?? data.permissions);
  const changes = Array.isArray(item.changes) ? item.changes : Array.isArray(data.changes) ? data.changes : [];
  const files = changes.filter(record).map(change => ({ path: text(change.path), kind: text(change.kind?.type) || text(change.kind) || 'update', moveTo: text(change.kind?.move_path), diff: text(change.diff) }));
  const handled = new Set(['command', 'reason', 'description', 'cwd', 'grantRoot', 'networkApprovalContext', 'additionalPermissions', 'permissions', 'changes', 'item', 'threadId', 'turnId', 'itemId', 'approvalId', 'startedAtMs', 'availableDecisions', 'commandActions', 'questions']);
  for (const [key, value] of Object.entries(data)) if (!handled.has(key)) add(fieldLabel(key), value);
  return { reason, command, fields, files, raw: JSON.stringify(data, null, 2) };
}
