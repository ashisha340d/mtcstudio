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

export const updateOrder = (orderId, payload) =>
  http.patch(`/pos/orders/${orderId}`, payload).then(r => r.data);

export const cancelOrder = ({ orderId, reason }) =>
  http.post(`/pos/orders/${orderId}/cancel`, { reason }).then(r => r.data);

export const checkout = ({ orderId, payments, discount_amount, change_amount }) =>
  http.post(`/pos/orders/${orderId}/checkout`, { payments, discount_amount, change_amount }).then(r => r.data);

export const mergeOrders = ({ targetOrderId, sourceOrderId }) =>
  http.post(`/pos/orders/${targetOrderId}/merge`, { sourceOrderId }).then(r => r.data);

export const shiftOrder = ({ orderId, targetTableId }) =>
  http.patch(`/pos/orders/${orderId}/shift`, { targetTableId }).then(r => r.data);

export const transferItem = ({ targetOrderId, itemId, quantity }) =>
  http.post(`/pos/orders/${targetOrderId}/transfer-item`, { itemId, quantity }).then(r => r.data);

// ── KOTs ─────────────────────────────────────────────────────
export const getActiveKOTs = () => http.get('/pos/kots/active').then(r => r.data);

export const createKOT = (payload) =>
  http.post('/pos/kots', payload).then(r => r.data);

export const markItemServed = ({ kotId, itemId }) =>
  http.patch(`/pos/kots/${kotId}/items/${itemId}/serve`).then(r => r.data);

export const unserveItem = ({ kotId, itemId }) =>
  http.patch(`/pos/kots/${kotId}/items/${itemId}/unserve`).then(r => r.data);

export const getServedKOTs = () => http.get('/pos/kots/served').then(r => r.data);

export const serveAllKots = (orderId) =>
  http.patch(`/pos/orders/${orderId}/serve-all`).then(r => r.data);

// Centrally-configured KDS alert sounds — { new_order, warning, critical } URLs
export const getKdsSoundConfig = () => http.get('/settings/kds-sound').then(r => r.data);

export const getKDSReport = (stationId) =>
  http.get('/pos/kots/report/today', stationId ? { params: { station: stationId } } : {}).then(r => r.data);

export const kdsSessionLogin = async (pin) => {
  const data = await http.post('/auth/pin', { pin }).then(r => r.data);
  localStorage.setItem('kds_session', data.sessionId);
  sessionStorage.setItem('mtc_session', data.sessionId);
  return data;
};

export const getKDSMe = () => http.get('/auth/me').then(r => r.data);

// ── Till / Cash Drawer ────────────────────────────────────────

export const addCashMovement = (payload) =>
  http.post('/pos/till/movements', payload).then(r => r.data);

export const deleteCashMovement = (id) =>
  http.delete(`/pos/till/movements/${id}`).then(r => r.data);

export const updateCashMovement = (id, payload) =>
  http.put(`/pos/till/movements/${id}`, payload).then(r => r.data);

// ── Business Day / Daily Cash Closing ─────────────────────────
export const getBusinessDay = (date) =>
  http.get('/pos/till/day', { params: { date } }).then(r => r.data);

export const openBusinessDay = (opening_float) =>
  http.post('/pos/till/open', { opening_float }).then(r => r.data);

export const saveDayDraft = (payload) =>
  http.post('/pos/till/day/draft', payload).then(r => r.data);

export const closeBusinessDay = (payload) =>
  http.post('/pos/till/day/close', payload).then(r => r.data);

export const reopenBusinessDay = (date, reason) =>
  http.post('/pos/till/day/reopen', { date, reason }).then(r => r.data);

export const printDayClosing = (date) =>
  http.post('/pos/till/day/print', { date }).then(r => r.data);

export const updateDayOpening = (opening_float) =>
  http.put('/pos/till/day/opening', { opening_float }).then(r => r.data);

// ── Sales Reports ─────────────────────────────────────────────

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

// ── Reports (Order Type / Category / Product / Monthly) ───────
// category_ids / product_ids are comma-joined id lists ('' = no filter)
export const getOrderTypeSummaryReport = (from, to) =>
  http.get('/pos/reports/order-type-summary', { params: { from, to } }).then(r => r.data);

export const getCategorySummaryReport = (from, to, category_ids) =>
  http.get('/pos/reports/category-summary', { params: { from, to, category_ids } }).then(r => r.data);

export const getProductSummaryReport = (from, to, category_ids, product_ids) =>
  http.get('/pos/reports/product-summary', { params: { from, to, category_ids, product_ids } }).then(r => r.data);

// group: 'item' | 'category' | 'order-type' — narrowed by whichever of
// category_ids / product_ids / order_types applies to that shape.
export const getMonthlySummaryReport = ({ year, group, category_ids, product_ids, order_types }) =>
  http.get('/pos/reports/monthly-summary', { params: { year, group, category_ids, product_ids, order_types } }).then(r => r.data);

export const getZeroSalesReport = (from, to, category_ids) =>
  http.get('/pos/reports/zero-sales', { params: { from, to, category_ids } }).then(r => r.data);

export const getWeeklyPatternReport = (from, to) =>
  http.get('/pos/reports/weekly-pattern', { params: { from, to } }).then(r => r.data);

export const getPaymentRegisterReport = (from, to) =>
  http.get('/pos/reports/payment-register', { params: { from, to } }).then(r => r.data);

// ── Sales Calendar ───────────────────────────────────────────
// params: { from, to, bucket:'hour'|'day', include, category_ids, product_ids }
export const getCalendarReport = (params) =>
  http.get('/pos/reports/calendar', { params }).then(r => r.data);

export const getCalendarDetail = (from, to) =>
  http.get('/pos/reports/calendar-detail', { params: { from, to } }).then(r => r.data);

export const getCalendarMeta = () =>
  http.get('/pos/reports/calendar-meta').then(r => r.data);

// ── Transaction Revert ───────────────────────────────────────

export const revertOrderTransaction = ({ orderId, reason }) =>
  http.post(`/pos/transactions/order/${orderId}/revert`, { reason }).then(r => r.data);

export const revertCakeTransaction = ({ cakeOrderId, reason }) =>
  http.post(`/pos/transactions/cake/${cakeOrderId}/revert`, { reason }).then(r => r.data);

// ── Web Orders (approval queue) ───────────────────────────────
export const getWebOrders = (status = 'PENDING_APPROVAL') =>
  http.get('/pos/web-orders', { params: { status } }).then(r => r.data);

export const getWebOrderCounts = () =>
  http.get('/pos/web-orders/counts').then(r => r.data);

export const approveWebOrder = (id) =>
  http.post(`/pos/web-orders/${id}/approve`).then(r => r.data);

export const rejectWebOrder = (id, reason) =>
  http.post(`/pos/web-orders/${id}/reject`, { reason }).then(r => r.data);

// ── Scheduled & Draft Orders ─────────────────────────────────
export const getScheduledOrders = () =>
  http.get('/pos/scheduled').then(r => r.data);

export const getStoreHours = (date) =>
  http.get('/pos/scheduled/hours', { params: { date } }).then(r => r.data);

export const convertScheduledOrder = (id) =>
  http.post(`/pos/scheduled/${id}/convert`).then(r => r.data);

export const cancelScheduledOrder = (id) =>
  http.post(`/pos/scheduled/${id}/cancel`).then(r => r.data);

export const deleteScheduledOrder = (id) =>
  http.delete(`/pos/scheduled/${id}`).then(r => r.data);

const posApi = {
  // Auth
  pinLogin, logout, kdsSessionLogin, getKDSMe,
  // Master
  getTables, getProducts, getCategories, getStations,
  // Orders
  getActiveOrders, createOrder, updateOrder, updateOrderStatus, cancelOrder, checkout, mergeOrders, shiftOrder, transferItem, serveAllKots,
  getServedKOTs,
  // KOTs
  getActiveKOTs, createKOT, markItemServed, unserveItem,
  getKDSReport, getKdsSoundConfig,
  // Till / Cash Drawer
  addCashMovement, deleteCashMovement, updateCashMovement,
  // Business Day / Daily Cash Closing
  getBusinessDay, openBusinessDay, saveDayDraft, closeBusinessDay,
  reopenBusinessDay, printDayClosing, updateDayOpening,
  // Sales Reports
  getSalesReport, getCakePaymentsReport,
  getDayEndReport, closeDayEnd, reopenDayEnd,
  // Analytics Reports
  getOrderTypeSummaryReport, getCategorySummaryReport, getProductSummaryReport, getMonthlySummaryReport,
  getZeroSalesReport, getPaymentRegisterReport, getWeeklyPatternReport,
  // Sales Calendar
  getCalendarReport, getCalendarDetail, getCalendarMeta,
  // Transaction Revert
  revertOrderTransaction, revertCakeTransaction,
  // Web Orders
  getWebOrders, getWebOrderCounts, approveWebOrder, rejectWebOrder,
  // Scheduled & Draft Orders
  getScheduledOrders, getStoreHours,
  convertScheduledOrder, cancelScheduledOrder, deleteScheduledOrder,
};

export default posApi;
