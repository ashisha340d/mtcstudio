const API_URL = '/api/liveshelf';

const shelfContainer = document.getElementById('shelfContainer');
const lastUpdated = document.getElementById('lastUpdated');

function getStatus(quantity) {
  if (quantity <= 0) {
    return {
      text: 'Sold Out',
      className: 'sold-out'
    };
  }

  if (quantity <= 3) {
    return {
      text: `Only ${quantity} Left`,
      className: 'low-stock'
    };
  }

  return {
    text: `${quantity} Available`,
    className: 'available'
  };
}

function groupByCategory(items) {
  return items.reduce((groups, item) => {
    const category = item.category || 'Other';

    if (!groups[category]) {
      groups[category] = [];
    }

    groups[category].push(item);

    return groups;
  }, {});
}

function renderShelf(items) {

  if (!items.length) {
    shelfContainer.innerHTML = `
      <div style="text-align:center;padding:40px;">
        No items available today.
      </div>
    `;
    return;
  }

  const grouped = groupByCategory(items);

  let html = '';

  Object.keys(grouped).forEach(category => {

    html += `
      <h2 class="category-title">${category}</h2>
      <div class="items-grid">
    `;

    grouped[category].forEach(item => {

      const status = getStatus(item.quantity);

      html += `
        <div class="item-card">

          <img
            class="item-img"
            src="/uploads/${item.image || 'img/no-image.jpg'}"
            alt="${item.name}"
            loading="lazy"
          >

          <div class="item-body">

            <div class="item-name">
              ${item.name}
            </div>

            ${item.price > 0
              ? `<div class="item-price">Rs.${item.price}</div>`
              : ''
            }

            <div class="badge ${status.className}">
              ${status.text}
            </div>

          </div>

        </div>
      `;
    });

    html += `
      </div>
    `;
  });

  shelfContainer.innerHTML = html;
}

async function loadShelf() {

  try {

    shelfContainer.innerHTML = `
      <div style="text-align:center;padding:40px;">
        Loading Live Shelf...
      </div>
    `;

    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error('API Error');
    }

    const items = await response.json();

    renderShelf(items);

    const now = new Date();

    lastUpdated.textContent =
      now.toLocaleDateString() +
      ' ' +
      now.toLocaleTimeString();

  } catch (error) {

    console.error(error);

    shelfContainer.innerHTML = `
      <div style="
        background:#ffebee;
        color:#c62828;
        padding:20px;
        border-radius:8px;
        text-align:center;
      ">
        Unable to load Live Shelf.
      </div>
    `;
  }
}

loadShelf();

/*
Auto Refresh Every 60 Seconds
*/
setInterval(loadShelf, 60000);