const { escHtml } = require('../utils/escHtml');

function buildMenuContent(sections, bySection) {
    let html = '';
    sections.forEach(section => {
        const products = bySection[section.id] || [];
        if (!products.length) return;

        html += `\n<section id="sec-${escHtml(section.slug)}" class="menu-section">`;
        html += `\n  <div class="section-header">`;
        if (section.icon) html += `<span class="section-icon">${escHtml(section.icon)}</span> `;
        html += `<h1>${escHtml(section.name)}</h1>`;
        html += `\n  </div>`;
        html += `\n  <div class="items-grid">`;

        products.forEach(p => {
            const activeVariants = (p.variants || []).filter(v => v.status === 'active');
            const isSingle = activeVariants.length === 1 && activeVariants[0].name === 'Regular';
            const imgSrc = p.primary_image ? `/uploads/${p.primary_image.filename}` : '/uploads/no-image.jpg';
            const imgAlt = p.primary_image ? (p.primary_image.alt_text || escHtml(p.name)) : escHtml(p.name);
            const cardId = p.slug || `product-${p.id}`;

            html += `\n    <div class="item-card" id="${escHtml(cardId)}">`;
            html += `\n      <div class="item-img-box">`;
            html += `\n        <img class="item-img" src="${imgSrc}" alt="${imgAlt}" loading="lazy">`;
            html += `\n      </div>`;

            if (activeVariants.length === 0 || isSingle) {
                const price = activeVariants.length ? activeVariants[0].selling_price : 0;
                html += `\n      <div class="item-top">`;
                html += `\n        <span class="item-name">${escHtml(p.name)}</span>`;
                if (price > 0) html += `\n        <span class="item-price">Rs.${price}</span>`;
                html += `\n      </div>`;
                if (p.description) {
                    html += `\n      <p class="item-desc">${escHtml(p.description)}</p>`;
                }
                html += `\n      <button class="add-btn" data-slug="${escHtml(cardId)}" data-name="${escHtml(p.name)}" data-price="${price}">Add to My Feast</button>`;
            } else {
                html += `\n      <div class="item-top">`;
                html += `\n        <span class="item-name">${escHtml(p.name)}</span>`;
                html += `\n      </div>`;
                if (p.description) {
                    html += `\n      <p class="item-desc">${escHtml(p.description)}</p>`;
                }
                html += `\n      <ul class="size-list">`;
                activeVariants.forEach(v => {
                    const variantId = `${cardId}_${v.name.toLowerCase().replace(/\s+/g, '-')}`;
                    html += `\n        <li id="${escHtml(variantId)}">`;
                    html += `\n          <span>${escHtml(v.name)} Rs.${v.selling_price}</span>`;
                    html += `\n          <button class="add-btn-sm" data-slug="${escHtml(variantId)}" data-name="${escHtml(p.name)}" data-variant="${escHtml(v.name)}" data-price="${v.selling_price}">Add</button>`;
                    html += `\n        </li>`;
                });
                html += `\n      </ul>`;
            }

            html += `\n    </div>`;
        });

        html += `\n  </div>`;
        html += `\n</section>`;
    });
    return html;
}

module.exports = { buildMenuContent };
