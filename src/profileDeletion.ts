/** Non-secret progress for multi-festival erasure. A 401 is never proof of deletion. */
export const DELETION_KEY = 'realm.profile-deletion.v1'
export const DELETION_PENDING_KEY = 'realm.profile-deletion-pending.v1'
export function hasUncertainDeletion(local: Storage): boolean {
  const pending = JSON.parse(local.getItem(DELETION_PENDING_KEY) ?? '[]') as string[]
  const completed = JSON.parse(local.getItem(DELETION_KEY) ?? '[]') as string[]
  return pending.some(id => !completed.includes(id))
}
export interface DeletionProfile { id: string; token?: string }
export async function deleteProfiles(local: Storage, profiles: DeletionProfile[], remove: (token: string) => Promise<void>) {
  const raw = JSON.parse(local.getItem(DELETION_KEY) ?? '[]')
  if (!Array.isArray(raw) || raw.some(id => typeof id !== 'string')) throw new Error('Invalid deletion progress')
  const completed = new Set<string>(raw)
  const pendingRaw = JSON.parse(local.getItem(DELETION_PENDING_KEY) ?? '[]')
  if (!Array.isArray(pendingRaw) || pendingRaw.some(id => typeof id !== 'string')) throw new Error('Invalid deletion intent')
  const pending = new Set<string>(pendingRaw.filter(id => !completed.has(id)))
  const unique = new Map<string, string | undefined>()
  for (const p of profiles) unique.set(p.id, p.token ?? unique.get(p.id))
  if ([...unique].some(([id, token]) => !completed.has(id) && !token)) throw new Error('Restore required before deletion')
  // Verify that progress can be saved before the first irreversible request.
  local.setItem(DELETION_KEY, JSON.stringify([...completed]))
  for (const [id, token] of unique) {
    if (completed.has(id)) continue
    // A lost response is ambiguous. Keep an intent before the request so the UI
    // can offer honest local-only cleanup even if the deleted account cannot restore.
    pending.add(id)
    local.setItem(DELETION_PENDING_KEY, JSON.stringify([...pending]))
    await remove(token!)
    completed.add(id)
    local.setItem(DELETION_KEY, JSON.stringify([...completed]))
    pending.delete(id)
    local.setItem(DELETION_PENDING_KEY, JSON.stringify([...pending]))
  }
  // Caller removes this journal only after native + local cleanup has succeeded.
  if (pending.size) throw new Error('Deletion uncertain')
}
