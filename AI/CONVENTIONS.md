# Project Conventions

This note records the conventions that are actually used in the repository so future edits stay consistent with the existing structure.

## 1. Backend structure

The backend follows a route -> controller -> service -> database helper pattern.

- Route files live in server/routes/ and use express.Router.
  - Example: server/routes/categories.js
- Controller files live in server/controllers/ and end with Controller.
  - Example: server/controllers/categoriesController.js
- Service files live in server/services/ and end with Service.
  - Example: server/services/categoriesService.js
- Database access is centralized in server/database/db.js and used from services.

Typical controller shape:
- small async handlers
- try/catch around the service call
- res.json(...) for success
- next(err) for failures

Typical service shape:
- functions like getAll, getById, create, update, remove
- direct use of dbAll, dbGet, dbRun
- query parameters are validated or normalized before execution

## 2. Frontend structure

The client uses a page-based folder structure.

- Feature pages live in client/src/pages/<Module>/<Module>.jsx
- Page-specific styling lives beside the page in the same folder, usually as <Module>.css
- Shared providers live in client/src/context/
- Shared API wrappers live in client/src/services/api.js and client/src/services/posApi.js
- Global routing is defined in client/src/App.jsx

## 3. Naming conventions

- Backend route names are lowercase and usually singular or module-like: categories, products, hr, payroll.
- Controllers use the suffix Controller: categoriesController.js
- Services use the suffix Service: categoriesService.js
- Frontend component files use PascalCase matching the folder name: HR.jsx, Payroll.jsx, Dashboard.jsx
- API wrapper objects use camelCase and end with Api: categoriesApi, dashboardApi, campaignsApi

## 4. Routing conventions

- The server mounts feature routers in server/app.js with app.use('/api/<module>', router)
- The client uses BrowserRouter and Routes from react-router in client/src/App.jsx
- Admin routes are nested under the root layout route /
- POS, waiter, and KDS routes are mounted separately and are not wrapped in the admin chrome
- Lazy loading is used for admin pages so POS bundles stay lighter

## 5. Auth and permissions

- Auth state is provided through AuthProvider and consumed with useAuth.
- Role definitions are centralized in client/src/context/AuthContext.jsx
- Permission checks use a helper named can(user, permission)
- Server-side role guards are implemented with middleware such as requireHrRole

## 6. Data and API conventions

- List endpoints commonly accept search and sort query parameters
- Create/update flows usually return a success object or the created/updated row
- Write operations that affect menu state often bump a menu version or invalidate a cache
- API wrappers in the client keep endpoint logic grouped by feature rather than scattered across components

## 7. UI conventions

- Pages commonly load data with useEffect and keep local state with useState
- Page-level styles are imported directly from the page CSS file
- The admin UI uses Link for navigation and button classes such as btn and btn-primary
- Desktop-style app entry points are registered in the admin layout shell rather than hard-coded in each page

## 8. Documentation conventions

- Project documentation is stored under AI/ in markdown files named by module or topic
- New module work should be documented in the matching AI file when the feature is significant
- The docs in AI/ are intended to reflect the current codebase, not a generic architecture summary
