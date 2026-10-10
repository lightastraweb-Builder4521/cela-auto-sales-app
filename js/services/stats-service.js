/* Dashboard statistics — computed locally from vehicle records. */
import { STATUS, askingPrice, publishReadiness, fullTitle } from '../models/vehicle.js';
import { publicVisibility } from '../models/public-dto.js';

function sameMonth(iso, now) {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export function computeDashboardStats(vehicles, now = new Date()) {
  const s = {
    totalInventory: 0, available: 0, pending: 0, drafts: 0, soldThisMonth: 0, soldTotal: 0,
    archived: 0, published: 0, unpublished: 0, addedThisMonth: 0, updatedThisWeek: 0,
    askingValue: 0, publicVisible: 0
  };
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  vehicles.forEach((v) => {
    const active = v.status === STATUS.DRAFT || v.status === STATUS.AVAILABLE || v.status === STATUS.PENDING;
    if (active) {
      s.totalInventory += 1;
      if (v.isPublished) s.published += 1; else s.unpublished += 1;
    }
    if (v.status === STATUS.AVAILABLE) s.available += 1;
    if (v.status === STATUS.PENDING) s.pending += 1;
    if (v.status === STATUS.DRAFT) s.drafts += 1;
    if (v.status === STATUS.ARCHIVED) s.archived += 1;
    if (v.status === STATUS.SOLD) {
      s.soldTotal += 1;
      if (sameMonth(v.soldAt, now)) s.soldThisMonth += 1;
    }
    if (sameMonth(v.createdAt, now)) s.addedThisMonth += 1;
    if (v.updatedAt && new Date(v.updatedAt).getTime() >= weekAgo) s.updatedThisWeek += 1;
    if ((v.status === STATUS.AVAILABLE || v.status === STATUS.PENDING) && askingPrice(v)) s.askingValue += askingPrice(v);
    if (publicVisibility(v, now.getTime()).visible) s.publicVisible += 1;
  });
  return s;
}

/**
 * Vehicles an employee should look at: available-but-unpublished, and
 * drafts/listings missing information needed to publish.
 * coverIndex: Map from photoService.getCoverIndex().
 */
export function findNeedsAttention(vehicles, coverIndex, limit = 6) {
  const items = [];
  vehicles.forEach((v) => {
    if (v.status === STATUS.SOLD || v.status === STATUS.ARCHIVED) return;
    const photoInfo = coverIndex.get(v.id);
    const photos = photoInfo ? Array.from({ length: photoInfo.count }, (_, i) => ({ isCover: i === 0 })) : [];
    const readiness = publishReadiness(v, photos);
    if (!readiness.ready) {
      items.push({ vehicle: v, title: fullTitle(v), reason: `Missing: ${readiness.missing.map((m) => m.label).join(', ')}` });
    } else if (!v.isPublished) {
      items.push({ vehicle: v, title: fullTitle(v), reason: 'Ready, but not published' });
    }
  });
  return items.slice(0, limit);
}
