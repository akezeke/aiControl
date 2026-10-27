export function messagingUnavailableReason(session, snapshot) {
  if (session.parentId) return '';
  if (session.provider === 'claude') {
    if (!snapshot?.features?.claudeMessaging) return 'Restart AI Control with npm restart to enable Claude messaging, then refresh this page.';
    return session.messaging?.send ? '' : 'Run Claude inside tmux to message it from here.';
  }
  if (session.messaging?.send) return snapshot?.features?.steering ? '' : 'AI Control needs a server restart to send into current work. Run npm restart in the aiControl folder on your computer, then refresh this page.';
  // Vite serves new browser code immediately, while the Node backend needs a restart.
  // An absent capability on the older backend is different from an explicit false.
  if (!session.messaging && !snapshot?.features?.messaging) return 'AI Control needs a server restart to enable messaging. Run npm restart in the aiControl folder on your computer, then refresh this page.';
  const provider = snapshot?.providers?.find(provider => provider.name === 'Codex');
  if (session.status === 'offline' || provider?.connected === false) return 'Codex is disconnected. Reconnecting…';
  if (!session.control) return 'Connecting to this Codex session. Messaging will appear once it is connected.';
  return 'Messaging is not available for this Codex session yet.';
}
