const path = require('path');
const fs = require('fs');
const { generateBlog } = require('../generators/generateBlog');

const publicDir = path.join(__dirname, '../public');
const uploadsDir = path.join(__dirname, '../uploads');
const viewsDir = path.join(__dirname, '../templates');

async function stats(req, res, next) {
    try {
        const { dbGet } = require('../database/db');
        const [totalRow, pubRow] = await Promise.all([
            dbGet(`SELECT COUNT(*) as total FROM blogs`),
            dbGet(`SELECT COUNT(*) as published FROM blogs WHERE status='published'`)
        ]);
        const blogHtmlExists = fs.existsSync(path.join(publicDir, 'blog.html'));
        let lastGenerated = null;
        if (blogHtmlExists) {
            try {
                const stat = fs.statSync(path.join(publicDir, 'blog.html'));
                lastGenerated = stat.mtime.toISOString();
            } catch (e) {}
        }
        res.json({
            totalBlogs: totalRow ? totalRow.total : 0,
            publishedBlogs: pubRow ? pubRow.published : 0,
            blogHtmlExists,
            lastGenerated
        });
    } catch (e) { next(e); }
}

async function generate(req, res, next) {
    try {
        const result = await generateBlog({
            publicDir,
            uploadsDir,
            viewsDir,
            baseUrl: process.env.PUBLIC_SITE_URL
        });
        res.json({ success: true, result });
    } catch (e) { next(e); }
}

module.exports = { stats, generate };
