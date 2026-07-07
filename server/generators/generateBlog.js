const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { dbAll } = require('../database/db');
const { escHtml } = require('../utils/escHtml');
const { excerpt, youtubeId, formatDate, formatRssDate } = require('../utils/formatDate');

function copyImage(src, dest) {
    if (!fs.existsSync(src)) return false;
    try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        return true;
    } catch (e) {
        return false;
    }
}

function buildRss(blogs, baseUrl) {
    const items = blogs.map(b => {
        const link = `${baseUrl}/blog/${b.slug}.html`;
        const desc = escHtml(excerpt(b.content_html, 200));
        return `  <item>
    <title>${escHtml(b.title)}</title>
    <link>${link}</link>
    <guid isPermaLink="true">${link}</guid>
    <description>${desc}</description>
    <pubDate>${formatRssDate(b.published_at)}</pubDate>
  </item>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Munch Time Cafe Blog</title>
    <link>${baseUrl}/blog.html</link>
    <description>Recipes, food guides, and stories from Munch Time Cafe, Chitwan.</description>
    <language>en-us</language>
    <atom:link href="${baseUrl}/rss.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
}

async function generateBlog(opts) {
    const { publicDir, uploadsDir, viewsDir, baseUrl } = opts;
    const blogDir = path.join(publicDir, 'blog');
    const blogImgDir = path.join(publicDir, 'blog-img');

    fs.mkdirSync(blogDir, { recursive: true });
    fs.mkdirSync(blogImgDir, { recursive: true });

    const blogs = await dbAll(
        `SELECT b.*, ml.filename as feat_filename, ml.alt_text as feat_alt,
                am.filename as auth_filename, am.alt_text as auth_alt
         FROM blogs b
         LEFT JOIN media_library ml ON ml.id = b.featured_image
         LEFT JOIN media_library am ON am.id = b.author_image
         WHERE b.status = 'published'
         ORDER BY b.published_at DESC`
    );

    if (!blogs.length) {
        return { generated: 0, errors: [], rss: false, home: false };
    }

    const recentBlogs = blogs.slice(0, 10);
    const errors = [];
    let generated = 0;

    const blogTemplatePath = path.join(viewsDir, 'blog-template.ejs');
    const homeTemplatePath = path.join(viewsDir, 'blog-home-template.ejs');

    blogs.forEach(b => {
        b.featured_image_data = b.feat_filename ? { filename: b.feat_filename, alt_text: b.feat_alt } : null;
        b.author_image_data = b.auth_filename ? { filename: b.auth_filename, alt_text: b.auth_alt } : null;
        b.blog_img_filename = b.feat_filename ? b.slug + path.extname(b.feat_filename) : null;
    });

    await Promise.all(blogs.map(async b => {
        if (b.feat_filename && b.blog_img_filename) {
            const src = path.join(uploadsDir, b.feat_filename);
            const dest = path.join(blogImgDir, b.blog_img_filename);
            copyImage(src, dest);
        }

        const postData = {
            blog: b,
            recentBlogs,
            baseUrl,
            isPreview: false,
            excerpt: excerpt(b.content_html, 160),
            youtubeId: youtubeId(b.youtube_url),
            formatDate
        };

        try {
            const html = await new Promise((resolve, reject) =>
                ejs.renderFile(blogTemplatePath, postData, {}, (err, out) => err ? reject(err) : resolve(out))
            );
            const outPath = path.join(blogDir, b.slug + '.html');
            fs.writeFileSync(outPath, html, 'utf8');
            generated++;
        } catch (e) {
            errors.push(`${b.slug}.html: ${e.message}`);
        }
    }));

    let homeOk = false;
    try {
        const homeHtml = await new Promise((resolve, reject) =>
            ejs.renderFile(homeTemplatePath, { blogs, baseUrl }, {}, (err, out) => err ? reject(err) : resolve(out))
        );
        fs.writeFileSync(path.join(publicDir, 'blog.html'), homeHtml, 'utf8');
        homeOk = true;
    } catch (e) {
        errors.push('blog.html: ' + e.message);
    }

    let rssOk = false;
    try {
        fs.writeFileSync(path.join(publicDir, 'rss.xml'), buildRss(blogs, baseUrl), 'utf8');
        rssOk = true;
    } catch (e) {
        errors.push('rss.xml: ' + e.message);
    }

    return { generated, errors, rss: rssOk, home: homeOk };
}

module.exports = { generateBlog };
