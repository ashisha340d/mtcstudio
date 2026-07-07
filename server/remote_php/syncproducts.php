<?php
// syncproducts.php — place at public_html/api/syncproducts.php on remote host
// Receives the full live-shelf product list from MTC Studio and upserts into MySQL.
// mode=full_replace → deletes any DB row whose variant id is NOT in the incoming list.

$SECRET_KEY = 'MTC_LIVE_SHELF_2026_X7K9P2Q8';

header('Content-Type: application/json');

// ── Auth ──────────────────────────────────────────────────────────────────────
$api_key = $_POST['api_key'] ?? '';
if ($api_key !== $SECRET_KEY) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

// ── Input ─────────────────────────────────────────────────────────────────────
$mode = $_POST['mode'] ?? 'partial';
$data = json_decode($_POST['data'] ?? '[]', true);

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid data payload']);
    exit;
}

// ── DB connection ─────────────────────────────────────────────────────────────
$conn = new mysqli(
    'localhost',
    'munchtim_admin',
    'Nepal@Narayan113',
    'munchtim_mtcstudio'
);

if ($conn->connect_error) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'DB connection failed: ' . $conn->connect_error]);
    exit;
}

$conn->set_charset('utf8mb4');

// ── Ensure table exists ───────────────────────────────────────────────────────
$conn->query("
    CREATE TABLE IF NOT EXISTS live_shelf (
        id          INT          NOT NULL PRIMARY KEY,
        category    VARCHAR(255) DEFAULT '',
        name        VARCHAR(255) DEFAULT '',
        price       DECIMAL(10,2) DEFAULT 0,
        quantity    INT          DEFAULT 0,
        image       VARCHAR(500) DEFAULT '',
        notes       TEXT         DEFAULT '',
        sort_order  INT          DEFAULT 0,
        show_online TINYINT(1)   DEFAULT 1,
        updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
");

$deleted  = 0;
$upserted = 0;

// ── Full-replace: delete rows not in the incoming list ────────────────────────
if ($mode === 'full_replace') {
    if (empty($data)) {
        // Nothing coming in — wipe the whole table
        $conn->query("DELETE FROM live_shelf");
        $deleted = $conn->affected_rows;
    } else {
        $incoming_ids = array_map('intval', array_column($data, 'id'));
        $placeholders = implode(',', $incoming_ids);
        $result = $conn->query("DELETE FROM live_shelf WHERE id NOT IN ($placeholders)");
        $deleted = $conn->affected_rows;
    }
}

// ── Upsert every item in the payload ─────────────────────────────────────────
$stmt = $conn->prepare("
    INSERT INTO live_shelf (id, category, name, price, quantity, image, notes, sort_order, show_online)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE
        category   = VALUES(category),
        name       = VALUES(name),
        price      = VALUES(price),
        quantity   = VALUES(quantity),
        image      = VALUES(image),
        notes      = VALUES(notes),
        sort_order = VALUES(sort_order),
        show_online = 1,
        updated_at = CURRENT_TIMESTAMP
");

if (!$stmt) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Prepare failed: ' . $conn->error]);
    exit;
}

foreach ($data as $item) {
    $id         = (int)($item['id']         ?? 0);
    $category   = (string)($item['category']   ?? '');
    $name       = (string)($item['name']       ?? '');
    $price      = (float)($item['price']      ?? 0);
    $quantity   = (int)($item['quantity']   ?? 0);
    $image      = (string)($item['image']      ?? '');
    $notes      = (string)($item['notes']      ?? '');
    $sort_order = (int)($item['sort_order'] ?? 0);

    $stmt->bind_param('issdissi', $id, $category, $name, $price, $quantity, $image, $notes, $sort_order);
    $stmt->execute();
    $upserted++;
}

$stmt->close();
$conn->close();

echo json_encode([
    'success'  => true,
    'upserted' => $upserted,
    'deleted'  => $deleted,
]);
