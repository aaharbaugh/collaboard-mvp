import * as admin from 'firebase-admin';

const MAX_VERSIONS = 10;

export type VersionSource = 'user_edit' | 'prompt_run' | 'api_run' | 'wire_update';

export interface ObjectVersion {
  versionId: string;
  timestamp: number;
  text: string | null;
  promptOutput: string | null;
  source: VersionSource;
  userId: string;
}

/**
 * Push a version snapshot for an object. Trims to MAX_VERSIONS most recent.
 * Updates the denormalized `versionCount` on the object.
 */
export async function pushVersion(
  db: admin.database.Database,
  boardId: string,
  objectId: string,
  text: string | null,
  promptOutput: string | null,
  source: VersionSource,
  userId: string,
): Promise<void> {
  const versionsRef = db.ref(`boards/${boardId}/objects/${objectId}/versions`);
  const versionId = `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const entry: ObjectVersion = {
    versionId,
    timestamp: Date.now(),
    text,
    promptOutput,
    source,
    userId,
  };

  // Write the new version
  await versionsRef.child(versionId).set(entry);

  // Trim to MAX_VERSIONS (no orderByChild — avoids requiring a Firebase index)
  const snap = await versionsRef.get();
  if (snap.exists()) {
    const allVersions: { key: string; timestamp: number }[] = [];
    snap.forEach((child) => {
      allVersions.push({ key: child.key!, timestamp: child.val().timestamp ?? 0 });
    });

    if (allVersions.length > MAX_VERSIONS) {
      allVersions.sort((a, b) => a.timestamp - b.timestamp);
      const toRemove = allVersions.slice(0, allVersions.length - MAX_VERSIONS);
      for (const v of toRemove) {
        await versionsRef.child(v.key).remove();
      }
    }

    // Update denormalized count
    const remaining = Math.min(allVersions.length, MAX_VERSIONS);
    await db.ref(`boards/${boardId}/objects/${objectId}/versionCount`).set(remaining);
  }
}

/**
 * Get all versions for an object, sorted by timestamp descending (newest first).
 */
export async function getVersions(
  db: admin.database.Database,
  boardId: string,
  objectId: string,
): Promise<ObjectVersion[]> {
  const snap = await db.ref(`boards/${boardId}/objects/${objectId}/versions`).get();
  if (!snap.exists()) return [];

  const versions: ObjectVersion[] = [];
  snap.forEach((child) => {
    versions.push(child.val() as ObjectVersion);
  });
  return versions.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Restore a specific version: snapshot current state, then overwrite with the selected version.
 */
export async function restoreVersion(
  db: admin.database.Database,
  boardId: string,
  objectId: string,
  versionId: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const objRef = db.ref(`boards/${boardId}/objects/${objectId}`);
  const objSnap = await objRef.get();
  if (!objSnap.exists()) return { success: false, error: 'Object not found' };

  const current = objSnap.val();

  const versionSnap = await db.ref(`boards/${boardId}/objects/${objectId}/versions/${versionId}`).get();
  if (!versionSnap.exists()) return { success: false, error: 'Version not found' };

  const version = versionSnap.val() as ObjectVersion;

  // Snapshot current state before restoring
  await pushVersion(db, boardId, objectId, current.text ?? null, current.promptOutput ?? null, 'user_edit', userId);

  // Restore — always overwrite both fields (null clears the field in Firebase)
  await objRef.update({
    text: version.text ?? null,
    promptOutput: version.promptOutput ?? null,
  });

  return { success: true };
}
