import { onRequest } from 'firebase-functions/https';
import * as admin from 'firebase-admin';
import { runAgentCommand, AgentCommandRequest } from './agent.js';
import { runPromptNode, RunPromptRequest } from './promptRunner.js';
import { getVersions, restoreVersion } from './versionHelper.js';

// Initialize Admin SDK once per cold start
if (!admin.apps.length) {
  admin.initializeApp();
}

const ALLOWED_ORIGIN = 'https://collabboard-111.web.app';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setCors(res: any) {
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'X-User-Token, Content-Type');
}

export const executeAgentCommand = onRequest(async (req, res) => {
  setCors(res);

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

export const executePromptNode = onRequest(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const result = await runPromptNode(req.body as RunPromptRequest);
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export const getObjectVersions = onRequest(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { boardId, objectId } = req.body as { boardId: string; objectId: string };
    if (!boardId || !objectId) {
      res.status(400).json({ error: 'boardId and objectId are required' });
      return;
    }
    const db = admin.database();
    const versions = await getVersions(db, boardId, objectId);
    res.status(200).json({ versions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export const restoreObjectVersion = onRequest(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { boardId, objectId, versionId, userId } = req.body as {
      boardId: string; objectId: string; versionId: string; userId: string;
    };
    if (!boardId || !objectId || !versionId || !userId) {
      res.status(400).json({ error: 'boardId, objectId, versionId, and userId are required' });
      return;
    }
    const db = admin.database();
    const result = await restoreVersion(db, boardId, objectId, versionId, userId);
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});
