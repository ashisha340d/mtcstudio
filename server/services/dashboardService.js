const { dbGet } = require('../database/db');

async function getStats() {
    const [categories, products, media, blogs, liveshelf] = await Promise.all([
        dbGet(`SELECT COUNT(*) as count FROM categories`),
        dbGet(`SELECT COUNT(*) as count FROM products`),
        dbGet(`SELECT COUNT(*) as count FROM media_library`),
        dbGet(`SELECT COUNT(*) as count FROM blogs`),
        dbGet(`SELECT COUNT(*) as count FROM live_shelf`)
    ]);
    return {
        categories: categories.count,
        products: products.count,
        media: media.count,
        blogs: blogs.count,
        liveshelf: liveshelf.count
    };
}

module.exports = { getStats };
