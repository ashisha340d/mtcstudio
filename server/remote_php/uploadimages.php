<?php
// uploadimages.php — place at public_html/api/uploadimages.php on remote host
// Receives one cake production photo (multipart/form-data) from the Cake
// Production PWA over the internet channel, stores the file under
// public_html/uploads/cake/, and upserts a row (order id, slot, filename,
// lastupdate) into MySQL. Never receives or stores production/customer data —
// only image files and the identifiers needed to store them.
//
// Request (multipart/form-data):
//   photo         — the image file (required)
//   order_id      — numeric cake_orders.id (required)
//   order_number  — human order number, e.g. CAKE-2026-0005 (optional)
//   slot          — 1, 2, or 3 (required)
//   api_key       — shared secret (required)
//
// Response: { success: true, url, filename } or { success: false, error }

$SECRET_KEY = 'MTC_LIVE_SHELF_2026_X7K9P2Q8';

// Same DB as the other remote sync scripts (syncmenu.php / syncproducts.php) —
// image metadata lives in its own table there, never in the POS SQLite DB.
$DB_HOST = 'localhost';
$DB_USER = 'munchtim_admin';
$DB_PASS = 'Nepal@Narayan113';
$DB_NAME = 'munchtim_mtcstudio';

// Uploads served publicly from public_html/uploads/cake/ (this script lives
// in public_html/api/, so the upload dir is one level up + uploads/cake).
$UPLOAD_DIR = __DIR__ . '/../uploads/cake/';
$UPLOAD_URL_BASE = 'https://munchtimecafe.com.np/uploads/cake/';

$MAX_BYTES = 10 * 1024 * 1024; // 10MB, matches the local multer limit in cakeOrders.js
$ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];

header('Content-Type: application/json');
// The PWA is served from the bakery's LAN origin (a different origin than
// this host), so the browser needs an explicit CORS allow on the response.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit; // CORS preflight — nothing else to do
}

function fail($code, $error) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $error]);
    exit;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
$api_key = $_POST['api_key'] ?? '';
if ($api_key !== $SECRET_KEY) fail(401, 'Unauthorized');

// ── Input ─────────────────────────────────────────────────────────────────────
$order_id = (int)($_POST['order_id'] ?? 0);
$order_number = (string)($_POST['order_number'] ?? '');
$slot = (int)($_POST['slot'] ?? 0);

if ($order_id <= 0) fail(400, 'order_id required');
if ($slot < 1 || $slot > 3) fail(400, 'slot must be 1, 2, or 3');

if (!isset($_FILES['photo']) || $_FILES['photo']['error'] !== UPLOAD_ERR_OK) {
    fail(400, 'photo file required');
}
$file = $_FILES['photo'];

if ($file['size'] > $MAX_BYTES) fail(400, 'file too large (max 10MB)');

$ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
if (!in_array($ext, $ALLOWED_EXT, true)) fail(400, 'unsupported file type');

// Re-verify it's actually an image (don't trust the extension/mimetype alone)
$imageInfo = @getimagesize($file['tmp_name']);
if ($imageInfo === false) fail(400, 'file is not a valid image');

// ── Store the file ───────────────────────────────────────────────────────────
if (!is_dir($UPLOAD_DIR)) {
    if (!mkdir($UPLOAD_DIR, 0755, true)) fail(500, 'could not create upload directory');
}

$filename = 'cake_' . $order_id . '_slot' . $slot . '_' . time() . '.' . $ext;
$destPath = $UPLOAD_DIR . $filename;

if (!move_uploaded_file($file['tmp_name'], $destPath)) {
    fail(500, 'failed to save uploaded file');
}

// ── DB: upsert (order_id, slot) -> filename, replacing any previous file for that slot ──
$conn = new mysqli($DB_HOST, $DB_USER, $DB_PASS, $DB_NAME);
if ($conn->connect_error) {
    @unlink($destPath);
    fail(500, 'DB connection failed: ' . $conn->connect_error);
}
$conn->set_charset('utf8mb4');

$conn->query("
    CREATE TABLE IF NOT EXISTS cake_production_photos (
        id           INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
        order_id     INT          NOT NULL,
        order_number VARCHAR(50)  DEFAULT '',
        slot_number  TINYINT      NOT NULL,
        filename     VARCHAR(255) NOT NULL,
        uploaded_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_order_slot (order_id, slot_number)
    )
");

// Look up the old filename (if replacing this slot) so the orphaned file can be removed.
$old = null;
if ($stmt = $conn->prepare("SELECT filename FROM cake_production_photos WHERE order_id = ? AND slot_number = ?")) {
    $stmt->bind_param('ii', $order_id, $slot);
    $stmt->execute();
    $stmt->bind_result($oldFilename);
    if ($stmt->fetch()) $old = $oldFilename;
    $stmt->close();
}

$stmt = $conn->prepare("
    INSERT INTO cake_production_photos (order_id, order_number, slot_number, filename)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
        order_number = VALUES(order_number),
        filename     = VALUES(filename),
        updated_at   = CURRENT_TIMESTAMP
");
if (!$stmt) {
    @unlink($destPath);
    fail(500, 'prepare failed: ' . $conn->error);
}
$stmt->bind_param('isis', $order_id, $order_number, $slot, $filename);
if (!$stmt->execute()) {
    @unlink($destPath);
    fail(500, 'insert failed: ' . $stmt->error);
}
$stmt->close();
$conn->close();

if ($old && $old !== $filename) {
    @unlink($UPLOAD_DIR . $old);
}

echo json_encode([
    'success'  => true,
    'url'      => $UPLOAD_URL_BASE . $filename,
    'filename' => $filename,
]);
