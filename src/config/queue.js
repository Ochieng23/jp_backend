// Background queues removed from MVP.
// All exports are null / no-ops so existing imports don't break at load time.

export const jurisdictionSyncQueue = null;
export const notificationQueue = null;
export const queueConnection = null;

/**
 * No-op enqueue — retained so callers don't need changes.
 */
export async function safeEnqueue(_queue, _name, _data) {
  return null;
}
