const RELAY_API = 'https://qgf8lnave0.execute-api.ca-central-1.amazonaws.com/relay/agent-reply';

/**
 * Send an agent chat message to your backend.
 * @param {Object} params
 * @param {string} params.contactId
 * @param {string} params.content
 * @param {string} [params.displayName]
 */
export async function relayAgentMessage({ contactId, content, displayName }) {
  const payload = {
    contactId,
    content,
    displayName: displayName || 'Agent',
  };

  console.log('[agentRelayApi] Sending to relay API:', payload);

  try {
    const res = await fetch(RELAY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // add Authorization header here later if you use JWT:
        // 'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[agentRelayApi] Relay error', res.status, text);
    } else {
      console.log('[agentRelayApi] Relay success', res.status);
    }
  } catch (e) {
    console.error('[agentRelayApi] Relay fetch failed', e);
  }
}
