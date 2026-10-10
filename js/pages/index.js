/* Entry point: send signed-in employees to the dashboard, everyone else to login. */
import { authService } from '../services/auth-service.js';

let session = null;
try {
  session = await authService.init();
} catch (err) { /* unreachable backend → login page explains */ }
window.location.replace(session ? 'dashboard.html' : 'login.html');
