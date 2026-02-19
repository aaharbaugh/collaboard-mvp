import { onRequest } from 'firebase-functions/https';
import { runAgentCommand, AgentCommandRequest } from './agent.js';

const ALLOWED_ORIGIN = 'https://collabboard-111.web.app';

export const executeAgentCommand = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'X-User-Token, Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const result = await runAgentCommand(req.body as AgentCommandRequest);
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});
