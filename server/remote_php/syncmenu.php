<?php
// syncmenu.php — place at public_html/api/syncmenu.php on remote host
// Receives the Food Menu catalogue (categories, media_library, products, product_variants,
// product_images, product_modifier_assignments) from MTC Studio. Each sync is a full
// replace: every table is cleared and reloaded from the payload (inside one transaction),
// so rows dropped from the source (inactive/unfeatured) don't linger as stale data.

// Don't let mysqli throw exceptions on error — catch them ourselves below so
// the real SQL error reaches the JSON response instead of a bare 500.
mysqli_report(MYSQLI_REPORT_OFF);

$SECRET_KEY = 'MTC_LIVE_SHELF_2026_X7K9P2Q8';

header('Content-Type: application/json');

// ── Auth ──────────────────────────────────────────────────────────────────────
$api_key = $_POST['api_key'] ?? '';
if ($api_key !== $SECRET_KEY) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

function must($conn, $ok, $stage) {
    if ($ok === false) {
        throw new Exception("$stage: " . $conn->error);
    }
}

function decode_rows($key) {
    $raw = $_POST[$key] ?? '[]';
    $rows = json_decode($raw, true);
    return is_array($rows) ? $rows : [];
}

try {
    // ── DB connection ─────────────────────────────────────────────────────────
    $conn = new mysqli(
        'localhost',
        'munchtim_admin',
        'Nepal@Narayan113',
        'munchtim_mtcstudio'
    );
    if ($conn->connect_error) {
        throw new Exception('DB connection failed: ' . $conn->connect_error);
    }
    $conn->set_charset('utf8mb4');

    // ── Ensure tables exist ───────────────────────────────────────────────────
    must($conn, $conn->query("
        CREATE TABLE IF NOT EXISTS categories (
            id          INT          NOT NULL PRIMARY KEY,
            name        VARCHAR(255) DEFAULT '',
            slug        VARCHAR(255) DEFAULT '',
            description TEXT,
            sort_order  INT          DEFAULT 0,
            status      VARCHAR(20)  DEFAULT 'active',
            icon        VARCHAR(20)  DEFAULT ''
        )
    "), 'create categories');
    $colCheck = $conn->query("SHOW COLUMNS FROM categories LIKE 'icon'");
    if ($colCheck && $colCheck->num_rows === 0) {
        must($conn, $conn->query("ALTER TABLE categories ADD COLUMN icon VARCHAR(20) DEFAULT ''"), 'alter categories icon');
    }

    must($conn, $conn->query("
        CREATE TABLE IF NOT EXISTS media_library (
            id            INT          NOT NULL PRIMARY KEY,
            filename      VARCHAR(255) DEFAULT '',
            original_name VARCHAR(255) DEFAULT '',
            title         VARCHAR(255) DEFAULT '',
            alt_text      VARCHAR(255) DEFAULT '',
            caption       TEXT,
            file_type     VARCHAR(50)  DEFAULT '',
            file_size     INT          DEFAULT 0,
            width         INT          DEFAULT 0,
            height        INT          DEFAULT 0,
            created_at    DATETIME     NULL
        )
    "), 'create media_library');

    must($conn, $conn->query("
        CREATE TABLE IF NOT EXISTS products (
            id                  INT          NOT NULL PRIMARY KEY,
            category_id         INT          NULL,
            menu_section_id     INT          NULL,
            name                VARCHAR(255) DEFAULT '',
            slug                VARCHAR(255) DEFAULT '',
            short_description   TEXT,
            description         TEXT,
            featured            TINYINT(1)   DEFAULT 0,
            status              VARCHAR(20)  DEFAULT 'active',
            sort_order          INT          DEFAULT 0,
            storefront_category VARCHAR(255) DEFAULT '',
            badge               VARCHAR(255) DEFAULT '',
            created_at          DATETIME     NULL
        )
    "), 'create products');
    // Migrate: add badge column to any pre-existing products table
    $colCheck = $conn->query("SHOW COLUMNS FROM products LIKE 'badge'");
    if ($colCheck && $colCheck->num_rows === 0) {
        must($conn, $conn->query("ALTER TABLE products ADD COLUMN badge VARCHAR(255) DEFAULT '' AFTER storefront_category"), 'alter products badge');
    }

    must($conn, $conn->query("
        CREATE TABLE IF NOT EXISTS product_variants (
            id             INT           NOT NULL PRIMARY KEY,
            product_id     INT           NOT NULL,
            name           VARCHAR(255)  DEFAULT 'Regular',
            sku            VARCHAR(255)  DEFAULT '',
            selling_price  DECIMAL(10,2) DEFAULT 0,
            cost_price     DECIMAL(10,2) DEFAULT 0,
            stock          DECIMAL(10,2) DEFAULT 0,
            reorder_level  DECIMAL(10,2) DEFAULT 0,
            unit           VARCHAR(50)   DEFAULT '',
            barcode        VARCHAR(100)  DEFAULT '',
            status         VARCHAR(20)   DEFAULT 'active',
            sort_order     INT           DEFAULT 0,
            show_online    TINYINT(1)    DEFAULT 0,
            image_id       INT           NULL,
            created_at     DATETIME      NULL,
            INDEX idx_pv_product (product_id)
        )
    "), 'create product_variants');

    must($conn, $conn->query("
        CREATE TABLE IF NOT EXISTS product_images (
            id         INT        NOT NULL PRIMARY KEY,
            product_id INT        NOT NULL,
            media_id   INT        NOT NULL,
            is_primary TINYINT(1) DEFAULT 0,
            sort_order INT        DEFAULT 0,
            INDEX idx_pi_product (product_id)
        )
    "), 'create product_images');

    must($conn, $conn->query("
        CREATE TABLE IF NOT EXISTS product_modifier_assignments (
            id          INT      NOT NULL PRIMARY KEY,
            product_id  INT      NOT NULL,
            modifier_id INT      NOT NULL,
            created_at  DATETIME NULL,
            INDEX idx_pma_product (product_id)
        )
    "), 'create product_modifier_assignments');

    must($conn, $conn->query("
        CREATE TABLE IF NOT EXISTS modifier_groups (
            id         INT          NOT NULL PRIMARY KEY,
            name       VARCHAR(255) DEFAULT '',
            sort_order INT          DEFAULT 0
        )
    "), 'create modifier_groups');

    must($conn, $conn->query("
        CREATE TABLE IF NOT EXISTS shared_modifiers (
            id         INT           NOT NULL PRIMARY KEY,
            group_id   INT           NULL,
            name       VARCHAR(255)  DEFAULT '',
            price      DECIMAL(10,2) DEFAULT 0,
            sort_order INT           DEFAULT 0,
            is_active  TINYINT(1)    DEFAULT 1,
            INDEX idx_sm_group (group_id)
        )
    "), 'create shared_modifiers');

    // product_badges: the badge catalogue (sourced from lookup_master PRODUCT_BADGE rows)
    must($conn, $conn->query("
        CREATE TABLE IF NOT EXISTS product_badges (
            id         INT          NOT NULL PRIMARY KEY,
            code       VARCHAR(64)  DEFAULT '',
            name       VARCHAR(255) DEFAULT '',
            icon       VARCHAR(32)  DEFAULT '',
            sort_order INT          DEFAULT 0,
            INDEX idx_pb_code (code)
        )
    "), 'create product_badges');

    // Migrate: tables created before utf8mb4 was the connection charset may still be
    // stored as latin1/utf8(3-byte), which rejects 4-byte/extended-Unicode characters
    // (emoji, special dashes, etc.) in TEXT columns like products.description — hence
    // "Incorrect string value: '\xE2\x80\x91...'" on insert. Convert them in place.
    foreach (['categories', 'products', 'media_library'] as $t) {
        $res = $conn->query("
            SELECT CCSA.character_set_name AS charset
            FROM information_schema.TABLES T
            JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY CCSA
              ON CCSA.collation_name = T.table_collation
            WHERE T.table_schema = DATABASE() AND T.table_name = '$t'
        ");
        $row = $res ? $res->fetch_assoc() : null;
        if ($row && $row['charset'] !== 'utf8mb4') {
            must($conn, $conn->query("ALTER TABLE `$t` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"), "convert $t charset");
        }
    }

    $conn->begin_transaction();

    // ── Full replace: wipe stale rows before loading the fresh payload ────────
    must($conn, $conn->query("DELETE FROM product_modifier_assignments"), 'delete product_modifier_assignments');
    must($conn, $conn->query("DELETE FROM product_images"), 'delete product_images');
    must($conn, $conn->query("DELETE FROM product_variants"), 'delete product_variants');
    must($conn, $conn->query("DELETE FROM products"), 'delete products');
    must($conn, $conn->query("DELETE FROM media_library"), 'delete media_library');
    must($conn, $conn->query("DELETE FROM categories"), 'delete categories');
    must($conn, $conn->query("DELETE FROM shared_modifiers"), 'delete shared_modifiers');
    must($conn, $conn->query("DELETE FROM modifier_groups"), 'delete modifier_groups');
    must($conn, $conn->query("DELETE FROM product_badges"), 'delete product_badges');

    $result = [];

    // ── categories ────────────────────────────────────────────────────────────
    $rows = decode_rows('categories');
    $stmt = $conn->prepare("
        INSERT INTO categories (id, name, slug, description, sort_order, status, icon)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            name = VALUES(name), slug = VALUES(slug), description = VALUES(description),
            sort_order = VALUES(sort_order), status = VALUES(status), icon = VALUES(icon)
    ");
    must($conn, $stmt !== false, 'prepare categories');
    $count = 0;
    foreach ($rows as $r) {
        $id = (int)($r['id'] ?? 0);
        if (!$id) continue;
        $name = (string)($r['name'] ?? '');
        $slug = (string)($r['slug'] ?? '');
        $description = (string)($r['description'] ?? '');
        $sort_order = (int)($r['sort_order'] ?? 0);
        $status = (string)($r['status'] ?? 'active');
        $icon = (string)($r['icon'] ?? '');
        $stmt->bind_param('isssiss', $id, $name, $slug, $description, $sort_order, $status, $icon);
        must($conn, $stmt->execute(), 'insert categories');
        $count++;
    }
    $stmt->close();
    $result['categories'] = $count;

    // ── media_library ─────────────────────────────────────────────────────────
    $rows = decode_rows('media_library');
    $stmt = $conn->prepare("
        INSERT INTO media_library (id, filename, original_name, title, alt_text, caption, file_type, file_size, width, height, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            filename = VALUES(filename), original_name = VALUES(original_name), title = VALUES(title),
            alt_text = VALUES(alt_text), caption = VALUES(caption), file_type = VALUES(file_type),
            file_size = VALUES(file_size), width = VALUES(width), height = VALUES(height)
    ");
    must($conn, $stmt !== false, 'prepare media_library');
    $count = 0;
    foreach ($rows as $r) {
        $id = (int)($r['id'] ?? 0);
        if (!$id) continue;
        $filename = (string)($r['filename'] ?? '');
        $original_name = (string)($r['original_name'] ?? '');
        $title = (string)($r['title'] ?? '');
        $alt_text = (string)($r['alt_text'] ?? '');
        $caption = (string)($r['caption'] ?? '');
        $file_type = (string)($r['file_type'] ?? '');
        $file_size = (int)($r['file_size'] ?? 0);
        $width = (int)($r['width'] ?? 0);
        $height = (int)($r['height'] ?? 0);
        $created_at = $r['created_at'] ?? null;
        $stmt->bind_param('issssssiiis', $id, $filename, $original_name, $title, $alt_text, $caption, $file_type, $file_size, $width, $height, $created_at);
        must($conn, $stmt->execute(), 'insert media_library');
        $count++;
    }
    $stmt->close();
    $result['media_library'] = $count;

    // ── products ──────────────────────────────────────────────────────────────
    $rows = decode_rows('products');
    $stmt = $conn->prepare("
        INSERT INTO products (id, category_id, menu_section_id, name, slug, short_description, description, featured, status, sort_order, storefront_category, badge, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            category_id = VALUES(category_id), menu_section_id = VALUES(menu_section_id), name = VALUES(name),
            slug = VALUES(slug), short_description = VALUES(short_description), description = VALUES(description),
            featured = VALUES(featured), status = VALUES(status), sort_order = VALUES(sort_order),
            storefront_category = VALUES(storefront_category), badge = VALUES(badge)
    ");
    must($conn, $stmt !== false, 'prepare products');
    $count = 0;
    foreach ($rows as $r) {
        $id = (int)($r['id'] ?? 0);
        if (!$id) continue;
        $category_id = isset($r['category_id']) && $r['category_id'] !== null ? (int)$r['category_id'] : null;
        $menu_section_id = isset($r['menu_section_id']) && $r['menu_section_id'] !== null ? (int)$r['menu_section_id'] : null;
        $name = (string)($r['name'] ?? '');
        $slug = (string)($r['slug'] ?? '');
        $short_description = (string)($r['short_description'] ?? '');
        $description = (string)($r['description'] ?? '');
        $featured = (int)($r['featured'] ?? 0);
        $status = (string)($r['status'] ?? 'active');
        $sort_order = (int)($r['sort_order'] ?? 0);
        $storefront_category = (string)($r['storefront_category'] ?? '');
        $badge = (string)($r['badge'] ?? '');
        $created_at = $r['created_at'] ?? null;
        $stmt->bind_param('iiissssisisss', $id, $category_id, $menu_section_id, $name, $slug, $short_description, $description, $featured, $status, $sort_order, $storefront_category, $badge, $created_at);
        must($conn, $stmt->execute(), 'insert products');
        $count++;
    }
    $stmt->close();
    $result['products'] = $count;

    // ── product_variants ──────────────────────────────────────────────────────
    $rows = decode_rows('product_variants');
    $stmt = $conn->prepare("
        INSERT INTO product_variants (id, product_id, name, sku, selling_price, cost_price, stock, reorder_level, unit, barcode, status, sort_order, show_online, image_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            product_id = VALUES(product_id), name = VALUES(name), sku = VALUES(sku),
            selling_price = VALUES(selling_price), cost_price = VALUES(cost_price), stock = VALUES(stock),
            reorder_level = VALUES(reorder_level), unit = VALUES(unit), barcode = VALUES(barcode),
            status = VALUES(status), sort_order = VALUES(sort_order), show_online = VALUES(show_online),
            image_id = VALUES(image_id)
    ");
    must($conn, $stmt !== false, 'prepare product_variants');
    $count = 0;
    foreach ($rows as $r) {
        $id = (int)($r['id'] ?? 0);
        if (!$id) continue;
        $product_id = (int)($r['product_id'] ?? 0);
        $name = (string)($r['name'] ?? 'Regular');
        $sku = (string)($r['sku'] ?? '');
        $selling_price = (float)($r['selling_price'] ?? 0);
        $cost_price = (float)($r['cost_price'] ?? 0);
        $stock = (float)($r['stock'] ?? 0);
        $reorder_level = (float)($r['reorder_level'] ?? 0);
        $unit = (string)($r['unit'] ?? '');
        $barcode = (string)($r['barcode'] ?? '');
        $status = (string)($r['status'] ?? 'active');
        $sort_order = (int)($r['sort_order'] ?? 0);
        $show_online = (int)($r['show_online'] ?? 0);
        $image_id = isset($r['image_id']) && $r['image_id'] !== null ? (int)$r['image_id'] : null;
        $created_at = $r['created_at'] ?? null;
        $stmt->bind_param('iissddddsssiiis', $id, $product_id, $name, $sku, $selling_price, $cost_price, $stock, $reorder_level, $unit, $barcode, $status, $sort_order, $show_online, $image_id, $created_at);
        must($conn, $stmt->execute(), 'insert product_variants');
        $count++;
    }
    $stmt->close();
    $result['product_variants'] = $count;

    // ── product_images ────────────────────────────────────────────────────────
    $rows = decode_rows('product_images');
    $stmt = $conn->prepare("
        INSERT INTO product_images (id, product_id, media_id, is_primary, sort_order)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            product_id = VALUES(product_id), media_id = VALUES(media_id),
            is_primary = VALUES(is_primary), sort_order = VALUES(sort_order)
    ");
    must($conn, $stmt !== false, 'prepare product_images');
    $count = 0;
    foreach ($rows as $r) {
        $id = (int)($r['id'] ?? 0);
        if (!$id) continue;
        $product_id = (int)($r['product_id'] ?? 0);
        $media_id = (int)($r['media_id'] ?? 0);
        $is_primary = (int)($r['is_primary'] ?? 0);
        $sort_order = (int)($r['sort_order'] ?? 0);
        $stmt->bind_param('iiiii', $id, $product_id, $media_id, $is_primary, $sort_order);
        must($conn, $stmt->execute(), 'insert product_images');
        $count++;
    }
    $stmt->close();
    $result['product_images'] = $count;

    // ── product_modifier_assignments ──────────────────────────────────────────
    $rows = decode_rows('product_modifier_assignments');
    $stmt = $conn->prepare("
        INSERT INTO product_modifier_assignments (id, product_id, modifier_id, created_at)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            product_id = VALUES(product_id), modifier_id = VALUES(modifier_id)
    ");
    must($conn, $stmt !== false, 'prepare product_modifier_assignments');
    $count = 0;
    foreach ($rows as $r) {
        $id = (int)($r['id'] ?? 0);
        if (!$id) continue;
        $product_id = (int)($r['product_id'] ?? 0);
        $modifier_id = (int)($r['modifier_id'] ?? 0);
        $created_at = $r['created_at'] ?? null;
        $stmt->bind_param('iiis', $id, $product_id, $modifier_id, $created_at);
        must($conn, $stmt->execute(), 'insert product_modifier_assignments');
        $count++;
    }
    $stmt->close();
    $result['product_modifier_assignments'] = $count;

    // ── modifier_groups ───────────────────────────────────────────────────────
    $rows = decode_rows('modifier_groups');
    $stmt = $conn->prepare("
        INSERT INTO modifier_groups (id, name, sort_order)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), sort_order = VALUES(sort_order)
    ");
    must($conn, $stmt !== false, 'prepare modifier_groups');
    $count = 0;
    foreach ($rows as $r) {
        $id = (int)($r['id'] ?? 0);
        if (!$id) continue;
        $name = (string)($r['name'] ?? '');
        $sort_order = (int)($r['sort_order'] ?? 0);
        $stmt->bind_param('isi', $id, $name, $sort_order);
        must($conn, $stmt->execute(), 'insert modifier_groups');
        $count++;
    }
    $stmt->close();
    $result['modifier_groups'] = $count;

    // ── shared_modifiers ──────────────────────────────────────────────────────
    $rows = decode_rows('shared_modifiers');
    $stmt = $conn->prepare("
        INSERT INTO shared_modifiers (id, group_id, name, price, sort_order, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            group_id = VALUES(group_id), name = VALUES(name), price = VALUES(price),
            sort_order = VALUES(sort_order), is_active = VALUES(is_active)
    ");
    must($conn, $stmt !== false, 'prepare shared_modifiers');
    $count = 0;
    foreach ($rows as $r) {
        $id = (int)($r['id'] ?? 0);
        if (!$id) continue;
        $group_id = isset($r['group_id']) && $r['group_id'] !== null ? (int)$r['group_id'] : null;
        $name = (string)($r['name'] ?? '');
        $price = (float)($r['price'] ?? 0);
        $sort_order = (int)($r['sort_order'] ?? 0);
        $is_active = (int)($r['is_active'] ?? 1);
        $stmt->bind_param('iisdii', $id, $group_id, $name, $price, $sort_order, $is_active);
        must($conn, $stmt->execute(), 'insert shared_modifiers');
        $count++;
    }
    $stmt->close();
    $result['shared_modifiers'] = $count;

    // ── product_badges (badge catalogue from lookup_master) ───────────────────
    $rows = decode_rows('product_badges');
    $stmt = $conn->prepare("
        INSERT INTO product_badges (id, code, name, icon, sort_order)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            code = VALUES(code), name = VALUES(name), icon = VALUES(icon), sort_order = VALUES(sort_order)
    ");
    must($conn, $stmt !== false, 'prepare product_badges');
    $count = 0;
    foreach ($rows as $r) {
        $id = (int)($r['id'] ?? 0);
        if (!$id) continue;
        $code = (string)($r['code'] ?? '');
        $name = (string)($r['name'] ?? '');
        $icon = (string)($r['icon'] ?? '');
        $sort_order = (int)($r['sort_order'] ?? 0);
        $stmt->bind_param('isssi', $id, $code, $name, $icon, $sort_order);
        must($conn, $stmt->execute(), 'insert product_badges');
        $count++;
    }
    $stmt->close();
    $result['product_badges'] = $count;

    $conn->commit();
    $conn->close();

    echo json_encode(['success' => true] + $result);

} catch (Throwable $e) {
    if (isset($conn) && $conn instanceof mysqli) {
        @$conn->rollback();
    }
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
