import axios from 'axios';

// Empty-string VITE_API_URL means "use Vite proxy" — fall back to '/api'
const http = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true';

// Attach session token to every request
// KDS saves its token to localStorage so it survives page reloads
http.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('mtc_session')
    ?? localStorage.getItem('kds_session')
    ?? (DEV_MODE ? 'dev-session' : null);
  if (token) config.headers['X-Session-ID'] = token;
  return config;
});

// ── Auth ──────────────────────────────────────────────────────
export const pinLogin = (pin) =>
  http.post('/auth/pin', { pin }).then(r => {
    sessionStorage.setItem('mtc_session', r.data.sessionId);
    return r.data; // { user: { id, name, employee_id, role }, sessionId }
  });

export const logout = (sessionId) =>
  http.post('/auth/logout', { sessionId })
    .then(() => sessionStorage.removeItem('mtc_session'));

// ── Master data ───────────────────────────────────────────────
export const getTables     = () => http.get('/pos/tables').then(r => r.data);
export const getProducts   = () => http.get('/pos/products').then(r => r.data);
export const getCategories = () => http.get('/pos/categories').then(r => r.data);
export const getStations   = () => http.get('/pos/stations').then(r => r.data);

// ── Orders ────────────────────────────────────────────────────
export const getActiveOrders = () => http.get('/pos/orders/active').then(r => r.data);

export const createOrder = (payload) =>
  http.post('/pos/orders', payload).then(r => r.data);

export const updateOrderStatus = (orderId, status) =>
  http.patch(`/pos/orders/${orderId}/status`, { status }).then(r => r.data);

export const cancelOrder = ({ orderId, reason }) =>
  http.post(`/pos/orders/${orderId}/cancel`, { reason }).then(r => r.data);

export const checkout = ({ orderId, payments, discount_amount, change_amount }) =>
  http.post(`/pos/orders/${orderId}/checkout`, { payments, discount_amount, change_amount }).then(r => r.data);

export const mergeOrders = ({ targetOrderId, sourceOrderId }) =>
  http.post(`/pos/orders/${targetOrderId}/merge`, { sourceOrderId }).then(r => r.data);

export const shiftOrder = ({ orderId, targetTableId }) =>
  http.patch(`/pos/orders/${orderId}/shift`, { targetTableId }).then(r => r.data);

// ── KOTs ─────────────────────────────────────────────────────
export const getActiveKOTs = () => http.get('/pos/kots/active').then(r => r.data);

export const createKOT = (payload) =>
  http.post('/pos/kots', payload).then(r => r.data);

export const markItemServed = ({ kotId, itemId }) =>
  http.patch(`/pos/kots/${kotId}/items/${itemId}/serve`).then(r => r.data);

export const unserveItem = ({ kotId, itemId }) =>
  http.patch(`/pos/kots/${kotId}/items/${itemId}/unserve`).then(r => r.data);

export const updateItemStatus = ({ kotId, itemId, status }) =>
  http.patch(`/pos/kots/${kotId}/items/${itemId}/status`, { status }).then(r => r.data);

export const getTodayKOTs  = () => http.get('/pos/kots/today').then(r => r.data);
export const getServedKOTs = () => http.get('/pos/kots/served').then(r => r.data);

export const serveAllKots = (orderId) =>
  http.patch(`/pos/orders/${orderId}/serve-all`).then(r => r.data);

export const getKDSReport = (stationId) =>
  http.get('/pos/kots/report/today', stationId ? { params: { station: stationId } } : {}).then(r => r.data);


export const kdsSessionLogin = async (pin) => {
  const data = await http.post('/auth/pin', { pin }).then(r => r.data);
  localStorage.setItem('kds_session', data.sessionId);
  sessionStorage.setItem('mtc_session', data.sessionId);
  return data;
};

export const getKDSMe = () => http.get('/auth/me').then(r => r.data);

// ── Ledger ────────────────────────────────────────────────────
export const getLedger = (customerPhone) =>
  http.get('/pos/ledger', { params: { phone: customerPhone } }).then(r => r.data);

// ── Till / Cash Drawer ────────────────────────────────────────
export const getCurrentTill = () =>
  http.get('/pos/till/current').then(r => r.data);

export const openTill = (opening_float) =>
  http.post('/pos/till/open', { opening_float }).then(r => r.data);

export const closeTill = (closing_counted, variance_note) =>
  http.post('/pos/till/close', { closing_counted, variance_note }).then(r => r.data);

export const approveTillClose = ({ till_id, manager_pin }) =>
  http.post('/pos/till/approve-close', { till_id, manager_pin }).then(r => r.data);

export const getCashMovements = (date) =>
  http.get('/pos/till/movements', { params: { date } }).then(r => r.data);

export const addCashMovement = (payload) =>
  http.post('/pos/till/movements', payload).then(r => r.data);

export const deleteCashMovement = (id) =>
  http.delete(`/pos/till/movements/${id}`).then(r => r.data);

// ── Sales Reports ─────────────────────────────────────────────
export const getSalesReportToday = () =>
  http.get('/pos/reports/sales').then(r => r.data);

export const getSalesReport = (date) =>
  http.get('/pos/reports/sales', { params: { date } }).then(r => r.data);

export const getCakePaymentsReport = (date) =>
  http.get('/pos/reports/cake-payments', { params: { date } }).then(r => r.data);

// ── Day End (Z Report) ────────────────────────────────────────
export const getDayEndReport = (date) =>
  http.get('/pos/reports/day-end', { params: { date } }).then(r => r.data);

export const closeDayEnd = (date, notes) =>
  http.post('/pos/reports/day-end/close', { date, notes }).then(r => r.data);

export const reopenDayEnd = (date) =>
  http.post('/pos/reports/day-end/reopen', { date }).then(r => r.data);

// ── Transaction Revert ───────────────────────────────────────
export const getTodayTransactions = () =>
  http.get('/pos/transactions/today').then(r => r.data);

export const revertOrderTransaction = ({ orderId, reason }) =>
  http.post(`/pos/transactions/order/${orderId}/revert`, { reason }).then(r => r.data);

export const revertCakeTransaction = ({ cakeOrderId, reason }) =>
  http.post(`/pos/transactions/cake/${cakeOrderId}/revert`, { reason }).then(r => r.data);

// ── Lookup Master ─────────────────────────────────────────────
// Generic lookup_master reader (cream/shape/sponge/theme/dietary/table-tag/
// product-badge types all live in the same table). Pass a lookup_type to
// filter, or omit to get every row.
export const getLookupMaster = (lookupType) =>
  http.get('/maintenance/cake-lookup').then(r =>
    lookupType ? r.data.filter(row => row.lookup_type === lookupType) : r.data
  );

const posApi = {
  // Auth
  pinLogin, logout, kdsSessionLogin, getKDSMe,
  // Master
  getTables, getProducts, getCategories, getStations,
  // Orders
  getActiveOrders, createOrder, updateOrderStatus, cancelOrder, checkout, mergeOrders, shiftOrder, serveAllKots,
  getTodayKOTs, getServedKOTs,
  // KOTs
  getActiveKOTs, getTodayKOTs, createKOT, markItemServed, unserveItem, updateItemStatus,
  getKDSReport,
  // Ledger
  getLedger,
  // Till / Cash Drawer
  getCurrentTill, openTill, closeTill, approveTillClose,
  getCashMovements, addCashMovement, deleteCashMovement,
  // Sales Reports
  getSalesReportToday, getSalesReport, getCakePaymentsReport,
  getDayEndReport, closeDayEnd, reopenDayEnd,
  // Transaction Revert
  getTodayTransactions, revertOrderTransaction, revertCakeTransaction,
  // Lookup Master
  getLookupMaster,
};

export default posApi;
