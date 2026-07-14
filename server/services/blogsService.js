const { dbAll, dbGet, dbRun } = require('../database/db');
const { slugify } = require('../utils/slugify');
const { saveFileEntry } = require('./mediaService');

const TOPICS = [
    'Food Recipe', 'Product Spotlight', 'Food Guide', 'Local Food Guide',
    'Festival & Seasonal', 'Birthday & Celebration', 'Behind The Kitchen',
    'Ingredient Story', 'Customer FAQ', 'Top Picks'
];

async function attachImages(blogs) {
    if (!blogs.length) return blogs;
    const ids = blogs.map(b => b.featured_image).filter(Boolean);
    const aIds = blogs.map(b => b.author_image).filter(Boolean);
    const allIds = [...new Set([...ids, ...aIds])];
    if (!allIds.length) return blogs;
    const ph = allIds.map(() => '?').join(',');
    const rows = await dbAll(`SELECT id, filename, alt_text FROM media_library WHERE id IN (${ph})`, allIds);
    const map = {};
    rows.forEach(r => { map[r.id] = r; });
    blogs.forEach(b => {
        b.featured_image_data = b.featured_image ? (map[b.featured_image] || null) : null;
        b.author_image_data = b.author_image ? (map[b.author_image] || null) : null;
    });
    return blogs;
}

async function getAll({ search }) {
    let rows;
    if (search) {
        rows = await dbAll(
            `SELECT * FROM blogs WHERE title LIKE ? OR topic LIKE ? OR slug LIKE ? ORDER BY sort_order ASC, created_at DESC`,
            [`%${search}%`, `%${search}%`, `%${search}%`]
        );
    } else {
        rows = await dbAll(`SELECT * FROM blogs ORDER BY sort_order ASC, created_at DESC`);
    }
    return attachImages(rows);
}

async function getById(id) {
    const blog = await dbGet(`SELECT * FROM blogs WHERE id=?`, [id]);
    if (!blog) return null;
    const blogs = await attachImages([blog]);
    return blogs[0];
}

async function getPreview(id) {
    const blog = await dbGet(`SELECT * FROM blogs WHERE id=?`, [id]);
    if (!blog) return null;
    const [blogs, recent] = await Promise.all([
        attachImages([blog]),
        dbAll(`SELECT * FROM blogs WHERE status='published' ORDER BY published_at DESC LIMIT 10`)
    ]);
    const recentBlogs = await attachImages(recent);
    return { blog: blogs[0], recentBlogs };
}

async function resolveImageIds(files, body, oldFeatId, oldAuthId) {
    let featId, authId;

    const featFile = files && files['featured_image_file'] && files['featured_image_file'][0];
    const authFile = files && files['author_image_file'] && files['author_image_file'][0];

    if (featFile) {
        const entry = await saveFileEntry(featFile);
        featId = entry.id;
    } else {
        featId = body.featured_image_id ? parseInt(body.featured_image_id, 10) : (oldFeatId !== undefined ? oldFeatId : null);
    }

    if (authFile) {
        const entry = await saveFileEntry(authFile);
        authId = entry.id;
    } else {
        authId = body.author_image_id ? parseInt(body.author_image_id, 10) : (oldAuthId !== undefined ? oldAuthId : null);
    }

    return { featId: featId || null, authId: authId || null };
}

async function create({ topic, title, slug, youtube_url, author_name, comment_text, content_html, status, featured_image_id, author_image_id }, files) {
    const finalSlug = slug ? slugify(slug) : slugify(title);
    if (!title || !finalSlug) throw Object.assign(new Error('Title and slug are required'), { status: 400 });

    const { featId, authId } = await resolveImageIds(files, { featured_image_id, author_image_id }, null, null);
    const pub = status === 'published' ? new Date().toISOString() : null;

    const result = await dbRun(
        `INSERT INTO blogs (topic,title,slug,featured_image,content_html,youtube_url,author_name,author_image,comment_text,status,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [topic || null, title, finalSlug, featId, content_html || null, youtube_url || null,
         author_name || null, authId, comment_text || null, status || 'draft', pub]
    );
    return result.insertId;
}

async function update(id, body, files) {
    const { topic, title, slug, youtube_url, author_name, comment_text, content_html, status, featured_image_id, author_image_id } = body;
    const finalSlug = slug ? slugify(slug) : slugify(title);
    if (!title || !finalSlug) throw Object.assign(new Error('Title and slug are required'), { status: 400 });

    const old = await dbGet(`SELECT featured_image, author_image, published_at, status as oldStatus FROM blogs WHERE id=?`, [id]);
    if (!old) throw Object.assign(new Error('Blog not found'), { status: 404 });

    const { featId, authId } = await resolveImageIds(files, body, old.featured_image, old.author_image);

    let pub = old.published_at;
    if (status === 'published' && old.oldStatus !== 'published') pub = new Date().toISOString();
    if (status !== 'published') pub = null;

    await dbRun(
        `UPDATE blogs SET topic=?,title=?,slug=?,featured_image=?,content_html=?,youtube_url=?,author_name=?,author_image=?,comment_text=?,status=?,published_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [topic || null, title, finalSlug, featId, content_html || null, youtube_url || null,
         author_name || null, authId, comment_text || null, status || 'draft', pub, id]
    );
}

async function remove(id) {
    await dbRun(`DELETE FROM blogs WHERE id=?`, [id]);
}

async function bulkAction(action, ids) {
    if (!ids || !ids.length) return;
    const ph = ids.map(() => '?').join(',');
    if (action === 'delete') {
        await dbRun(`DELETE FROM blogs WHERE id IN (${ph})`, ids);
    } else if (action === 'publish') {
        const now = new Date().toISOString();
        await dbRun(`UPDATE blogs SET status='published', published_at=CASE WHEN status!='published' THEN ? ELSE published_at END, updated_at=CURRENT_TIMESTAMP WHERE id IN (${ph})`, [now, ...ids]);
    } else if (action === 'unpublish') {
        await dbRun(`UPDATE blogs SET status='draft', published_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id IN (${ph})`, ids);
    }
}

async function reorder(ids) {
    for (let i = 0; i < ids.length; i++) {
        await dbRun(`UPDATE blogs SET sort_order=? WHERE id=?`, [i, ids[i]]);
    }
}

module.exports = { TOPICS, getAll, getById, getPreview, create, update, remove, bulkAction, reorder };
