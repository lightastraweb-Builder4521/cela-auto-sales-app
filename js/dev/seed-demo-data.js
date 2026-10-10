/* ==========================================================================
   DEVELOPMENT DEMO DATA — never production, never Public.
   --------------------------------------------------------------------------
   • Every record is flagged isDemo: true and uses DEMO-### stock numbers.
   • Photos are generated on the fly (labelled "DEVELOPMENT SAMPLE").
   • The public feed (publicListingService.getPublicInventory) excludes demo records.
   • clearDemoData() removes only demo records (and activity about them).
   Written straight through the repository so timestamps can be backdated.
   ========================================================================== */
import { getRepository } from '../data/repository.js';
import { createVehicle, STATUS, fullTitle } from '../models/vehicle.js';
import { createPhoto, storagePath } from '../models/photo.js';
import { vinCheckDigit } from '../models/vin.js';
import { authService } from '../services/auth-service.js';
import { createId } from '../utils/misc.js';
import { APP } from '../config.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/* Deterministic, well-formed but made-up VINs (valid check digit). */
function demoVin(seed) {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  let vin = '';
  let x = seed * 7919 + 17;
  for (let i = 0; i < 17; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    vin += chars[x % chars.length];
  }
  vin = vin.slice(0, 8) + '0' + vin.slice(9);
  return vin.slice(0, 8) + vinCheckDigit(vin) + vin.slice(9);
}

const DEMO = [
  { year: 2018, make: 'Honda', model: 'Accord', trim: 'EX', bodyStyle: 'Sedan', price: 16995, mileage: 78450, transmission: 'CVT', drivetrain: 'FWD', engine: '1.5L Turbo I4', fuelType: 'Gasoline', exteriorColor: 'Gray', interiorColor: 'Black', doors: 4, seats: 5, features: ['Bluetooth', 'Backup Camera', 'Apple CarPlay', 'Android Auto', 'Sunroof', 'Heated Seats'], status: 'AVAILABLE', published: true, photos: 12, age: 18, hue: 212, featured: true },
  { year: 2020, make: 'Toyota', model: 'Camry', trim: 'SE', bodyStyle: 'Sedan', price: 21495, salePrice: 20495, mileage: 41200, transmission: 'Automatic', drivetrain: 'FWD', engine: '2.5L I4', fuelType: 'Gasoline', exteriorColor: 'White', interiorColor: 'Black', doors: 4, seats: 5, features: ['Bluetooth', 'Backup Camera', 'Apple CarPlay', 'Lane Assist', 'Adaptive Cruise Control'], status: 'AVAILABLE', published: true, photos: 10, age: 9, hue: 0 },
  { year: 2016, make: 'Ford', model: 'F-150', trim: 'XLT', bodyStyle: 'Truck', price: 24900, mileage: 96300, transmission: 'Automatic', drivetrain: '4WD', engine: '3.5L V6 EcoBoost', fuelType: 'Gasoline', exteriorColor: 'Blue', interiorColor: 'Gray', doors: 4, seats: 6, features: ['Bluetooth', 'Backup Camera', 'Tow Package', 'Bed Liner', '4WD'], status: 'PENDING', published: true, photos: 8, age: 25, hue: 205 },
  { year: 2019, make: 'Jeep', model: 'Grand Cherokee', trim: 'Limited', bodyStyle: 'SUV', price: 26750, mileage: 58900, transmission: 'Automatic', drivetrain: '4WD', engine: '3.6L V6', fuelType: 'Gasoline', exteriorColor: 'Black', interiorColor: 'Tan', doors: 4, seats: 5, features: ['Leather Seats', 'Heated Seats', 'Navigation', 'Remote Start', 'Premium Audio'], status: 'AVAILABLE', published: false, photos: 3, age: 2, hue: 30 },
  { year: 2015, make: 'Chevrolet', model: 'Silverado 1500', trim: 'LT', bodyStyle: 'Truck', price: null, mileage: 121400, transmission: 'Automatic', drivetrain: '4WD', engine: '5.3L V8', fuelType: 'Flex Fuel', exteriorColor: 'Red', interiorColor: 'Gray', features: ['Tow Package', 'Bluetooth'], status: 'DRAFT', published: false, photos: 0, age: 1, hue: 355 },
  { year: 2017, make: 'Subaru', model: 'Outback', trim: '2.5i Premium', bodyStyle: 'Wagon', price: 17995, mileage: 88200, transmission: 'CVT', drivetrain: 'AWD', engine: '2.5L H4', fuelType: 'Gasoline', exteriorColor: 'Green', interiorColor: 'Beige', features: ['AWD', 'Backup Camera', 'Heated Seats', 'Bluetooth'], status: 'SOLD', published: true, photos: 6, age: 40, soldAgo: 1 * HOUR, soldPrice: 17200, hue: 140 },
  { year: 2014, make: 'Nissan', model: 'Altima', trim: '2.5 S', bodyStyle: 'Sedan', price: 8995, mileage: 132500, transmission: 'CVT', drivetrain: 'FWD', engine: '2.5L I4', fuelType: 'Gasoline', exteriorColor: 'Silver', interiorColor: 'Black', features: ['Bluetooth', 'Keyless Entry'], status: 'SOLD', published: true, photos: 5, age: 30, soldAgo: 5 * DAY, hue: 220 },
  { year: 2013, make: 'Toyota', model: 'Tacoma', trim: 'SR5', bodyStyle: 'Truck', price: 18500, mileage: 142000, transmission: 'Manual', drivetrain: '4WD', engine: '4.0L V6', fuelType: 'Gasoline', exteriorColor: 'Silver', interiorColor: 'Gray', features: ['4WD', 'Tow Package'], status: 'SOLD', published: true, photos: 4, age: 70, soldAgo: 40 * DAY, soldPrice: 17800, hue: 45 },
  { year: 2012, make: 'Honda', model: 'Civic', trim: 'LX', bodyStyle: 'Sedan', price: 6495, mileage: 158000, transmission: 'Automatic', drivetrain: 'FWD', engine: '1.8L I4', fuelType: 'Gasoline', exteriorColor: 'Blue', interiorColor: 'Gray', features: ['Bluetooth'], status: 'ARCHIVED', archivedFrom: 'AVAILABLE', published: false, photos: 2, age: 90, hue: 260 },
  { year: 2021, make: 'Hyundai', model: 'Elantra', trim: 'SEL', bodyStyle: 'Sedan', price: 18995, salePrice: 17995, mileage: 29800, transmission: 'Automatic', drivetrain: 'FWD', engine: '2.0L I4', fuelType: 'Gasoline', exteriorColor: 'White', interiorColor: 'Black', features: ['Apple CarPlay', 'Android Auto', 'Blind Spot Monitoring', 'Lane Assist', 'Backup Camera'], status: 'AVAILABLE', published: true, photos: 9, age: 5, hue: 190 },
  { year: 2017, make: 'Chevrolet', model: 'Equinox', trim: 'LT', bodyStyle: 'SUV', price: null, mileage: 74300, transmission: 'Automatic', drivetrain: 'AWD', engine: '2.4L I4', fuelType: 'Gasoline', exteriorColor: 'Brown', interiorColor: 'Black', features: ['AWD', 'Remote Start'], status: 'DRAFT', published: false, photos: 4, age: 3, hue: 20 },
  { year: 2019, make: 'Ford', model: 'Escape', trim: 'SE', bodyStyle: 'SUV', price: 15995, mileage: 66100, transmission: 'Automatic', drivetrain: 'AWD', engine: '1.5L EcoBoost I3', fuelType: 'Gasoline', exteriorColor: 'Red', interiorColor: 'Black', features: ['Bluetooth', 'Backup Camera', 'Keyless Entry'], status: 'PENDING', published: true, photos: 7, age: 12, hue: 350 }
];

function demoPhoto(label, index, total, hue) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 1200, 900);
  grad.addColorStop(0, `hsl(${hue} 35% ${22 + (index % 4) * 6}%)`);
  grad.addColorStop(1, `hsl(${(hue + 30) % 360} 25% 10%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 900);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(30, 30, 1140, 840);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 64px -apple-system, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, 600, 420);
  ctx.font = 'bold 40px -apple-system, Helvetica, Arial, sans-serif';
  ctx.fillText(`Photo ${index + 1} of ${total}`, 600, 500);
  ctx.font = '600 30px -apple-system, Helvetica, Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('DEVELOPMENT SAMPLE — NOT A REAL VEHICLE', 600, 800);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8));
}

async function scaled(blob, maxEdge) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function hasDemoData() {
  const vehicles = await getRepository().vehicles.list();
  return vehicles.some((v) => v && v.isDemo);
}

/** onProgress(done, total) */
export async function loadDemoData({ onProgress } = {}) {
  // Demo records must never reach the shared database or the public site.
  if (APP.backend !== 'local') throw new Error('Demo data is only available in local development mode.');
  const repo = getRepository();
  if (await hasDemoData()) return { created: 0, skipped: true };
  const actor = authService.actor();
  const now = Date.now();
  const total = DEMO.length;
  let done = 0;

  for (let i = 0; i < DEMO.length; i++) {
    const d = DEMO[i];
    const id = createId();
    const createdAt = new Date(now - d.age * DAY).toISOString();
    const soldAt = d.soldAgo ? new Date(now - d.soldAgo).toISOString() : null;
    const status = d.status;
    const vehicle = createVehicle({
      id,
      stockNumber: `DEMO-${String(101 + i)}`,
      vin: demoVin(i + 1),
      year: d.year, make: d.make, model: d.model, trim: d.trim, bodyStyle: d.bodyStyle,
      price: d.price, salePrice: d.salePrice || null, mileage: d.mileage,
      transmission: d.transmission, drivetrain: d.drivetrain, engine: d.engine, fuelType: d.fuelType,
      exteriorColor: d.exteriorColor, interiorColor: d.interiorColor, doors: d.doors || null, seats: d.seats || null,
      description: `DEMO LISTING — sample text for development. ${d.year} ${d.make} ${d.model} ${d.trim} with ${d.mileage.toLocaleString()} miles. Replace with a real description before any real listing.`,
      features: d.features,
      status,
      statusBeforeArchive: status === STATUS.ARCHIVED ? d.archivedFrom : null,
      isPublished: d.published,
      featured: Boolean(d.featured),
      createdAt,
      updatedAt: soldAt || new Date(now - Math.min(d.age, 2) * DAY + i * 60000).toISOString(),
      publishedAt: d.published ? createdAt : null,
      soldAt,
      soldBy: soldAt ? actor.actorId : null,
      soldPrice: d.soldPrice || null,
      archivedAt: status === STATUS.ARCHIVED ? new Date(now - 10 * DAY).toISOString() : null,
      createdBy: actor.actorId,
      updatedBy: actor.actorId,
      purchasePrice: d.price ? Math.round(d.price * 0.72) : null,
      acquisitionDate: new Date(now - (d.age + 3) * DAY).toISOString().slice(0, 10),
      acquisitionSource: 'Demo source (development only)',
      reconditioningCost: 650,
      internalNotes: 'DEMO internal note — must never appear on the public site.',
      isDemo: true
    });

    const photos = [];
    for (let p = 0; p < d.photos; p++) {
      const photoId = createId();
      const original = await demoPhoto(`${d.year} ${d.make} ${d.model}`, p, d.photos, d.hue);
      const thumb = await scaled(original, 480);
      await repo.files.put(storagePath(id, photoId, 'original'), original);
      await repo.files.put(storagePath(id, photoId, 'display'), original);
      await repo.files.put(storagePath(id, photoId, 'thumb'), thumb);
      photos.push(createPhoto({
        id: photoId, vehicleId: id, fileName: `demo-${p + 1}.jpg`, mimeType: 'image/jpeg',
        width: 1200, height: 900, size: original.size, sortOrder: p, isCover: p === 0,
        createdAt, futureStoragePath: storagePath(id, photoId, 'display'), isDemo: true
      }));
    }
    vehicle.coverPhotoId = photos.length ? photos[0].id : null;
    vehicle.photoCount = photos.length;
    await repo.photos.saveMany(photos);
    await repo.vehicles.save(vehicle);

    const label = fullTitle(vehicle);
    const entry = (action, summary, at) => ({
      id: createId(), createdAt: at, action, vehicleId: id, stockNumber: vehicle.stockNumber,
      vehicleLabel: label, summary, changes: [], isDemo: true, ...actor
    });
    const log = [entry('vehicle.created', 'Added as a draft (demo)', createdAt)];
    if (photos.length) log.push(entry('photo.added', `Added ${photos.length} photo${photos.length === 1 ? '' : 's'}`, new Date(Date.parse(createdAt) + 60000).toISOString()));
    if (d.published) log.push(entry('vehicle.published', 'Published and marked available', new Date(Date.parse(createdAt) + 120000).toISOString()));
    if (status === STATUS.PENDING) log.push(entry('vehicle.pending', 'Status changed from Available to Pending', new Date(now - 2 * DAY).toISOString()));
    if (soldAt) log.push(entry('vehicle.sold', 'Marked sold', soldAt));
    if (status === STATUS.ARCHIVED) log.push(entry('vehicle.archived', 'Archived (was Available)', vehicle.archivedAt));
    if (d.salePrice) log.push({ ...entry('price.changed', `Sale price changed from none to $${d.salePrice.toLocaleString()}`, new Date(now - 1 * DAY).toISOString()), changes: [{ field: 'salePrice', label: 'Sale price', before: null, after: d.salePrice }] });
    await repo.activity.addMany(log);

    done += 1;
    if (onProgress) onProgress(done, total);
  }
  return { created: DEMO.length, skipped: false };
}

/** Removes demo vehicles, their photos/files, and activity about them. Real records are untouched. */
export async function clearDemoData() {
  const repo = getRepository();
  const vehicles = (await repo.vehicles.list()).filter((v) => v && v.isDemo);
  const demoIds = new Set(vehicles.map((v) => v.id));
  for (const v of vehicles) {
    const photos = await repo.photos.listByVehicle(v.id);
    const paths = [];
    photos.forEach((p) => ['original', 'display', 'thumb'].forEach((variant) => paths.push(storagePath(v.id, p.id, variant))));
    await repo.files.removeMany(paths);
    await repo.photos.removeMany(photos.map((p) => p.id));
    await repo.vehicles.remove(v.id);
  }
  const activity = (await repo.activity.list()).filter((e) => e && (e.isDemo || demoIds.has(e.vehicleId)));
  await repo.activity.removeMany(activity.map((e) => e.id));
  return { removed: vehicles.length };
}
