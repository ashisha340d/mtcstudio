<?php
// synccakes.php — place at public_html/api/synccakes.php on the remote host.
// Receives the v3 cake catalogue (cake_designs family, cake_creams,
// cake_collections) from MTC Studio and replaces the remote tables wholesale
// inside a transaction, so the website — which reads these tables directly —
// always sees a consistent snapshot. IDs are preserved from the studio DB so
// design/collection relationships stay intact.

$SECRET_KEY = 'MTC_LIVE_SHELF_2026_X7K9P2Q8';

header('Content-Type: application/json');

// ── Auth ──────────────────────────────────────────────────────────────────────
$api_key = $_POST['api_key'] ?? '';
if ($api_key !== $SECRET_KEY) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

// ── Table schemas (mirror MTC Studio's local MariaDB) ─────────────────────────
// cols: column => mysqli bind type (i = int, d = double, s = string)
$SCHEMAS = [
    'cake_designs' => [
        'create' => "CREATE TABLE IF NOT EXISTS cake_designs (
            id          INT NOT NULL PRIMARY KEY,
            name        VARCHAR(255) NOT NULL,
            slug        VARCHAR(255) UNIQUE,
            tagline     VARCHAR(255),
            description TEXT,
            shape_tags  VARCHAR(255) DEFAULT '',
            badge_tags  VARCHAR(255) DEFAULT '',
            cream_choice TINYINT DEFAULT 1,
            eggless_available TINYINT DEFAULT 1,
            prep_time_hours INT DEFAULT 24,
            sort_order  INT DEFAULT 0,
            is_active   TINYINT DEFAULT 1,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        'cols' => [
            'id' => 'i', 'name' => 's', 'slug' => 's', 'tagline' => 's', 'description' => 's',
            'shape_tags' => 's', 'badge_tags' => 's', 'cream_choice' => 'i',
            'eggless_available' => 'i', 'prep_time_hours' => 'i', 'sort_order' => 'i', 'is_active' => 'i',
            'created_at' => 's', 'updated_at' => 's',
        ],
    ],
    'cake_design_media' => [
        'create' => "CREATE TABLE IF NOT EXISTS cake_design_media (
            id         INT NOT NULL PRIMARY KEY,
            design_id  INT NOT NULL,
            url        VARCHAR(500) NOT NULL,
            alt        VARCHAR(255),
            sort_order INT DEFAULT 0,
            INDEX idx_ckm_design (design_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        'cols' => ['id' => 'i', 'design_id' => 'i', 'url' => 's', 'alt' => 's', 'sort_order' => 'i'],
    ],
    'cake_design_sizes' => [
        'create' => "CREATE TABLE IF NOT EXISTS cake_design_sizes (
            id         INT NOT NULL PRIMARY KEY,
            design_id  INT NOT NULL,
            label      VARCHAR(100) NOT NULL,
            weight_kg  DOUBLE NOT NULL,
            serves     VARCHAR(50),
            price      DOUBLE NOT NULL,
            sort_order INT DEFAULT 0,
            INDEX idx_cks_design (design_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        'cols' => ['id' => 'i', 'design_id' => 'i', 'label' => 's', 'weight_kg' => 'd', 'serves' => 's', 'price' => 'd', 'sort_order' => 'i'],
    ],
    'cake_design_flavours' => [
        'create' => "CREATE TABLE IF NOT EXISTS cake_design_flavours (
            id         INT NOT NULL PRIMARY KEY,
            design_id  INT NOT NULL,
            name       VARCHAR(100) NOT NULL,
            surcharge  DOUBLE DEFAULT 0,
            sort_order INT DEFAULT 0,
            INDEX idx_ckf_design (design_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        'cols' => ['id' => 'i', 'design_id' => 'i', 'name' => 's', 'surcharge' => 'd', 'sort_order' => 'i'],
    ],
    'cake_creams' => [
        'create' => "CREATE TABLE IF NOT EXISTS cake_creams (
            id         INT NOT NULL PRIMARY KEY,
            name       VARCHAR(100) NOT NULL,
            surcharge  DOUBLE DEFAULT 0,
            sort_order INT DEFAULT 0,
            is_active  TINYINT DEFAULT 1
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        'cols' => ['id' => 'i', 'name' => 's', 'surcharge' => 'd', 'sort_order' => 'i', 'is_active' => 'i'],
    ],
    'cake_design_creams' => [
        'create' => "CREATE TABLE IF NOT EXISTS cake_design_creams (
            id         INT NOT NULL PRIMARY KEY,
            design_id  INT NOT NULL,
            cream_id   INT NOT NULL,
            surcharge  DOUBLE DEFAULT 0,
            sort_order INT DEFAULT 0,
            INDEX idx_ckdc_design (design_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        'cols' => ['id' => 'i', 'design_id' => 'i', 'cream_id' => 'i', 'surcharge' => 'd', 'sort_order' => 'i'],
    ],
    'cake_collections' => [
        'create' => "CREATE TABLE IF NOT EXISTS cake_collections (
            id         INT NOT NULL PRIMARY KEY,
            slug       VARCHAR(255) UNIQUE,
            title      VARCHAR(255) NOT NULL,
            kicker     VARCHAR(255),
            intro      TEXT,
            quote      TEXT,
            hero_url   VARCHAR(500),
            sort_order INT DEFAULT 0,
            is_active  TINYINT DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        'cols' => [
            'id' => 'i', 'slug' => 's', 'title' => 's', 'kicker' => 's', 'intro' => 's',
            'quote' => 's', 'hero_url' => 's', 'sort_order' => 'i', 'is_active' => 'i',
            'created_at' => 's', 'updated_at' => 's',
        ],
    ],
    'cake_collection_items' => [
        'create' => "CREATE TABLE IF NOT EXISTS cake_collection_items (
            id            INT NOT NULL PRIMARY KEY,
            collection_id INT NOT NULL,
            design_id     INT NOT NULL,
            note          VARCHAR(500),
            sort_order    INT DEFAULT 0,
            INDEX idx_cci_coll (collection_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        'cols' => ['id' => 'i', 'collection_id' => 'i', 'design_id' => 'i', 'note' => 's', 'sort_order' => 'i'],
    ],
    'cake_catalogue' => [
        'create' => "CREATE TABLE IF NOT EXISTS cake_catalogue (
            id                INT NOT NULL PRIMARY KEY,
            product_id        INT,
            variant_id        INT,
            name              TEXT NOT NULL,
            slug              VARCHAR(191),
            flavour           TEXT,
            theme             TEXT,
            shape             TEXT,
            weight_lbs        DOUBLE DEFAULT 1,
            serves            TEXT,
            price             DOUBLE NOT NULL DEFAULT 0,
            price_note        TEXT,
            image_id          INT,
            image             TEXT,
            description       TEXT,
            badge             TEXT,
            eggless_available INT DEFAULT 1,
            sort_order        INT DEFAULT 0,
            is_active         INT DEFAULT 1,
            sync_status       INT DEFAULT 0,
            created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        'cols' => [
            'id' => 'i', 'product_id' => 'i', 'variant_id' => 'i', 'name' => 's', 'slug' => 's',
            'flavour' => 's', 'theme' => 's', 'shape' => 's', 'weight_lbs' => 'd', 'serves' => 's',
            'price' => 'd', 'price_note' => 's', 'image_id' => 'i', 'image' => 's', 'description' => 's',
            'badge' => 's', 'eggless_available' => 'i', 'sort_order' => 'i', 'is_active' => 'i',
            'sync_status' => 'i', 'created_at' => 's', 'updated_at' => 's',
        ],
    ],
    'cake_shapes' => [
        'create' => "CREATE TABLE IF NOT EXISTS cake_shapes (
            id         BIGINT NOT NULL PRIMARY KEY,
            name       TEXT,
            sort_order BIGINT,
            is_active  BIGINT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        'cols' => ['id' => 'i', 'name' => 's', 'sort_order' => 'i', 'is_active' => 'i'],
    ],
    'cake_themes' => [
        'create' => "CREATE TABLE IF NOT EXISTS cake_themes (
            id         BIGINT NOT NULL PRIMARY KEY,
            name       TEXT,
            sort_order BIGINT,
            is_active  BIGINT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        'cols' => ['id' => 'i', 'name' => 's', 'sort_order' => 'i', 'is_active' => 'i'],
    ],
    'lookup_master' => [
        'create' => "CREATE TABLE IF NOT EXISTS lookup_master (
            id           INT NOT NULL PRIMARY KEY,
            lookup_type  VARCHAR(50) NOT NULL,
            code         VARCHAR(50),
            name         VARCHAR(255) NOT NULL,
            extra_charge DOUBLE NOT NULL DEFAULT 0,
            description  TEXT,
            sort_order   INT NOT NULL DEFAULT 0,
            is_active    TINYINT NOT NULL DEFAULT 1,
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            value        VARCHAR(255)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        'cols' => [
            'id' => 'i', 'lookup_type' => 's', 'code' => 's', 'name' => 's', 'extra_charge' => 'd',
            'description' => 's', 'sort_order' => 'i', 'is_active' => 'i', 'created_at' => 's',
            'updated_at' => 's', 'value' => 's',
        ],
    ],
];

// ── Input: decode every table that was posted ─────────────────────────────────
$incoming = [];
foreach ($SCHEMAS as $table => $def) {
    if (!isset($_POST[$table])) continue; // absent table param → leave remote rows untouched
    $decoded = json_decode($_POST[$table], true);
    if (!is_array($decoded)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => "Invalid payload for $table"]);
        exit;
    }
    $incoming[$table] = $decoded;
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

foreach ($SCHEMAS as $table => $def) {
    $conn->query($def['create']);
    if (strpos($def['create'], 'created_at') !== false) {
        $conn->query("ALTER TABLE `$table` ADD COLUMN IF NOT EXISTS created_at DATETIME DEFAULT CURRENT_TIMESTAMP");
        $conn->query("ALTER TABLE `$table` ADD COLUMN IF NOT EXISTS updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
    }
}
$conn->query("ALTER TABLE cake_designs ADD COLUMN IF NOT EXISTS prep_time_hours INT DEFAULT 24");

// ── Replace each posted table wholesale, atomically ──────────────────────────
$counts = [];
$conn->begin_transaction();

try {
    foreach ($incoming as $table => $rows) {
        $def   = $SCHEMAS[$table];
        $cols  = array_keys($def['cols']);
        $types = implode('', array_values($def['cols']));
        $ph    = implode(',', array_fill(0, count($cols), '?'));

        $conn->query("DELETE FROM `$table`");

        $stmt = $conn->prepare("INSERT INTO `$table` (" . implode(',', $cols) . ") VALUES ($ph)");
        if (!$stmt) throw new Exception("Prepare failed for $table: " . $conn->error);

        foreach ($rows as $r) {
            $vals = [];
            foreach ($cols as $c) {
                $vals[] = array_key_exists($c, $r) ? $r[$c] : null;
            }
            $stmt->bind_param($types, ...$vals);
            if (!$stmt->execute()) throw new Exception("Insert failed for $table: " . $stmt->error);
        }
        $stmt->close();
        $counts[$table] = count($rows);
    }
    $conn->commit();
} catch (Exception $e) {
    $conn->rollback();
    $conn->close();
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    exit;
}

$conn->close();

echo json_encode(array_merge(['success' => true], $counts));
