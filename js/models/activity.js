/* Activity event catalog. Keys match the future `activity_logs.action` column. */

export const ACTIONS = Object.freeze({
  'vehicle.created': { label: 'Vehicle added', icon: 'plus', tone: 'neutral' },
  'vehicle.updated': { label: 'Vehicle edited', icon: 'edit', tone: 'neutral' },
  'vehicle.duplicated': { label: 'Vehicle duplicated', icon: 'copy', tone: 'neutral' },
  'vehicle.published': { label: 'Published', icon: 'globe', tone: 'success' },
  'vehicle.unpublished': { label: 'Unpublished', icon: 'eyeOff', tone: 'neutral' },
  'vehicle.available': { label: 'Marked available', icon: 'checkCircle', tone: 'success' },
  'vehicle.pending': { label: 'Marked pending', icon: 'pending', tone: 'warning' },
  'vehicle.sold': { label: 'Marked sold', icon: 'sold', tone: 'brand' },
  'vehicle.restored': { label: 'Restored', icon: 'restore', tone: 'neutral' },
  'vehicle.archived': { label: 'Archived', icon: 'archive', tone: 'neutral' },
  'vehicle.deleted': { label: 'Deleted permanently', icon: 'trash', tone: 'danger' },
  'vehicle.retention_deleted': { label: 'Deleted after Sold retention', icon: 'trash', tone: 'neutral' },
  'vehicle.deleted_forever': { label: 'Deleted forever by an Admin', icon: 'trash', tone: 'neutral' },
  'vehicle.schedule_created': { label: 'Publication scheduled', icon: 'calendar', tone: 'neutral' },
  'vehicle.schedule_changed': { label: 'Schedule changed', icon: 'calendar', tone: 'neutral' },
  'vehicle.schedule_canceled': { label: 'Schedule canceled', icon: 'calendar', tone: 'neutral' },
  'vehicle.schedule_published': { label: 'Published as scheduled', icon: 'globe', tone: 'success' },
  'vehicle.schedule_blocked': { label: 'Scheduled publication blocked', icon: 'alert', tone: 'warning' },
  'vehicle.schedule_retried': { label: 'Scheduled publication retried', icon: 'restore', tone: 'neutral' },
  'price.changed': { label: 'Price changed', icon: 'dollar', tone: 'neutral' },
  'mileage.changed': { label: 'Mileage changed', icon: 'car', tone: 'neutral' },
  'description.changed': { label: 'Description changed', icon: 'file', tone: 'neutral' },
  'features.changed': { label: 'Features changed', icon: 'check', tone: 'neutral' },
  'internal.updated': { label: 'Internal info updated', icon: 'lock', tone: 'neutral' },
  'photo.added': { label: 'Photos added', icon: 'image', tone: 'neutral' },
  'photo.removed': { label: 'Photos removed', icon: 'trash', tone: 'neutral' },
  'photo.replaced': { label: 'Photo replaced', icon: 'replace', tone: 'neutral' },
  'photo.reordered': { label: 'Photos reordered', icon: 'grip', tone: 'neutral' },
  'photo.rotated': { label: 'Photo rotated', icon: 'rotate', tone: 'neutral' },
  'photo.cover_changed': { label: 'Cover photo changed', icon: 'star', tone: 'neutral' }
});

export function actionMeta(action) {
  return ACTIONS[action] || { label: action, icon: 'activity', tone: 'neutral' };
}

/**
 * Activity entry shape (future activity_logs row):
 * { id, createdAt, action, vehicleId, stockNumber, vehicleLabel, summary,
 *   actorId, actorName, changes: [{ field, label, before, after }], isDemo }
 * Internal financial fields are logged by name only — never their values.
 */
