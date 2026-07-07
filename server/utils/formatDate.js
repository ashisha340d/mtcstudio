function formatDate(dt) {
    if (!dt) return '';
    const d = new Date(dt);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatRssDate(dt) {
    if (!dt) return new Date().toUTCString();
    return new Date(dt).toUTCString();
}

function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function excerpt(html, len) {
    const text = stripHtml(html);
    return text.length > len ? text.slice(0, len).trim() + '...' : text;
}

function youtubeId(url) {
    if (!url) return null;
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
}

module.exports = { formatDate, formatRssDate, stripHtml, excerpt, youtubeId };
