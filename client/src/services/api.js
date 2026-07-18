import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

// ── Categories ───────────────────────────────────────────────────────────────
export const categoriesApi = {
  list: (params) => api.get('/categories', { params }),
  create: (data) => api.post('/categories', data),
  update: (id, data) => api.put(`/categories/${id}`, data),
  remove: (id) => api.delete(`/categories/${id}`),
  reorder: (order) => api.post('/categories/reorder', { order }),
};

// ── Products ─────────────────────────────────────────────────────────────────
export const productsApi = {
  list: (params) => api.get('/products', { params }),
  get: (id) => api.get(`/products/${id}`),
  create: (data) => api.post('/products', data),
  update: (id, data) => api.put(`/products/${id}`, data),
  remove: (id) => api.delete(`/products/${id}`),
  addVariant: (id, data) => api.post(`/products/${id}/variants`, data),
  updateVariant: (id, vid, data) => api.put(`/products/${id}/variants/${vid}`, data),
  removeVariant: (id, vid) => api.delete(`/products/${id}/variants/${vid}`),
  setImage: (id, data) => api.post(`/products/${id}/set-image`, data),
  bulkSave: (rows) => api.post('/products/bulk-save', { rows }),
  bulkAction: (data) => api.post('/products/bulk-action', data),
  reorder: (order) => api.post('/products/reorder', { order }),
  exportCsvUrl: () => '/api/products/export',
  templateUrl: () => '/api/products/template',
  syncCatalog: () => api.post('/products/sync-catalog'),
  importCsv: (file) => {
    return api.post('/products/import', file, {
      headers: { 'Content-Type': 'text/csv' }
    });
  }
};

// ── Combos ───────────────────────────────────────────────────────────────────
export const combosApi = {
  list:   (params) => api.get('/combos', { params }),
  get:    (id) => api.get(`/combos/${id}`),
  create: (data) => api.post('/combos', data),
  update: (id, data) => api.put(`/combos/${id}`, data),
  remove: (id) => api.delete(`/combos/${id}`),
};

// ── Food Menu lookups ──────────────────────────────────────────────────────────
export const getFoodMenuStations = () => api.get('/food-menu/stations').then(r => r.data);
export const getFoodMenuBadges = () => api.get('/food-menu/badges').then(r =>
  r.data.filter(row => row.is_active).map(row => ({ code: row.code, name: row.name, icon: row.value || '' }))
);

// ── Media ────────────────────────────────────────────────────────────────────
export const mediaApi = {
  list:       (params) => api.get('/media', { params }),
  pickerList: (params) => api.get('/media/list', { params }),
  upload: (formData) => api.post('/media/upload', formData),
  update:     (id, data) => api.put(`/media/${id}`, data),
  remove:     (id)       => api.delete(`/media/${id}`),
  bulkDelete: (ids)      => api.post('/media/bulk-delete', { ids }),
  sync:       ()         => api.post('/media/sync'),
};

// ── Blogs ────────────────────────────────────────────────────────────────────
export const blogsApi = {
  list: (params) => api.get('/blogs', { params }),
  get: (id) => api.get(`/blogs/${id}`),
  preview: (id) => api.get(`/blogs/${id}/preview`),
  create: (formData) => api.post('/blogs', formData, {
    // headers: { 'Content-Type': 'multipart/form-data' } // breaks boundary, let axios set it
  }),
  update: (id, formData) => api.put(`/blogs/${id}`, formData, {
    // headers: { 'Content-Type': 'multipart/form-data' } // breaks boundary, let axios set it
  }),
  remove: (id) => api.delete(`/blogs/${id}`),
  bulkAction: (data) => api.post('/blogs/bulk-action', data),
  reorder: (order) => api.post('/blogs/reorder', { order }),
};

// ── Generate Blog ─────────────────────────────────────────────────────────────
export const generateBlogApi = {
  stats: () => api.get('/generate-blog/stats'),
  generate: () => api.post('/generate-blog/generate')
};

// ── Live Shelf ────────────────────────────────────────────────────────────────
export const liveshelfApi = {
  list:         (params) => api.get('/liveshelf', { params }),
  get:          (id)     => api.get(`/liveshelf/${id}`),
  create:       (data)   => api.post('/liveshelf', data),
  update:       (id, data) => api.put(`/liveshelf/${id}`, data),
  remove:       (id)     => api.delete(`/liveshelf/${id}`),
  reorder:      (order)  => api.post('/liveshelf/reorder', { order }),
  sync:         ()       => api.post('/liveshelf/sync'),
  getSchedule:  ()       => api.get('/liveshelf/schedule'),
  saveSchedule: (days)   => api.put('/liveshelf/schedule', { days }),
  syncSchedule: ()       => api.post('/liveshelf/schedule/sync'),
};

// ── Cake Catalogue ────────────────────────────────────────────────────────────
export const cakeCatalogueApi = {
  list:       (params) => api.get('/cake-catalogue', { params }),
  get:        (id)     => api.get(`/cake-catalogue/${id}`),
  create:     (data)   => api.post('/cake-catalogue', data),
  update:     (id, data) => api.put(`/cake-catalogue/${id}`, data),
  remove:     (id)     => api.delete(`/cake-catalogue/${id}`),
  bulkAction: (data)   => api.post('/cake-catalogue/bulk-action', data),
  reorder:    (order)  => api.post('/cake-catalogue/reorder', { order }),
  listCollections:  ()         => api.get('/cake-catalogue/collections'),
  createCollection: (data)     => api.post('/cake-catalogue/collections', data),
  updateCollection: (id, data) => api.put(`/cake-catalogue/collections/${id}`, data),
  removeCollection: (id)       => api.delete(`/cake-catalogue/collections/${id}`),
  reorderCollections: (order)  => api.post('/cake-catalogue/collections/reorder', { order }),
  sync:             ()         => api.post('/cake-catalogue/sync'),
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const dashboardApi = {
  stats: () => api.get('/dashboard/stats')
};

// ── Automation (Rule Engine) ────────────────────────────────────────────────
export const automationApi = {
  conditionTypes:   () => api.get('/automation/condition-types'),
  actionTypes:      () => api.get('/automation/action-types'),
  categoryActions:  () => api.get('/automation/category-actions'),
  settings:         () => api.get('/automation/settings'),
  updateSettings:   (scope, data) => api.put(`/automation/settings/${scope}`, data),
  list:             (params) => api.get('/automation/rules', { params }),
  get:              (id) => api.get(`/automation/rules/${id}`),
  create:           (data) => api.post('/automation/rules', data),
  update:           (id, data) => api.put(`/automation/rules/${id}`, data),
  remove:           (id) => api.delete(`/automation/rules/${id}`),
  purge:            (id) => api.delete(`/automation/rules/${id}/purge`),
  publish:          (id, published_by) => api.post(`/automation/rules/${id}/publish`, { published_by }),
  versions:         (id) => api.get(`/automation/rules/${id}/versions`),
  rollback:         (id, versionRowId) => api.post(`/automation/rules/${id}/rollback/${versionRowId}`),
  test:             (id, sample_payload) => api.post(`/automation/rules/${id}/test`, { sample_payload }),
  testRuns:         (id) => api.get(`/automation/rules/${id}/test-runs`),
  syncNow:          (scope, ruleIds) => api.post('/automation/sync-now', { scope, ruleIds }),

  // Recommended Products — customer menu "you might also like"
  recommendedList:    () => api.get('/automation/recommended-products'),
  recommendedAdd:     (product_id) => api.post('/automation/recommended-products', { product_id }),
  recommendedReorder: (ids) => api.post('/automation/recommended-products/reorder', { ids }),
  recommendedRemove:  (id) => api.delete(`/automation/recommended-products/${id}`),
};

export default api;
