const productGrid = document.getElementById("product-grid");
const productTemplate = document.getElementById("product-card-template");
const cartDrawer = document.getElementById("cart-drawer");
const cartItemsContainer = document.getElementById("cart-items");
const cartCount = document.getElementById("cart-count");
const cartTotal = document.getElementById("cart-total");
const searchInput = document.getElementById("search-input");
const productSummary = document.getElementById("product-summary");

let products = [];
let filteredProducts = [];
let cart = readCart();
const placeholderImage = createPlaceholderImage();

document.getElementById("open-cart-button").addEventListener("click", () => {
  cartDrawer.classList.remove("hidden");
});

document.getElementById("close-cart-button").addEventListener("click", () => {
  cartDrawer.classList.add("hidden");
});

document.getElementById("checkout-button").addEventListener("click", (event) => {
  if (!cart.length) {
    event.preventDefault();
    alert("Keranjang masih kosong.");
  }
});

searchInput.addEventListener("input", (event) => {
  const keyword = event.target.value.trim().toLowerCase();
  filteredProducts = products.filter((product) => {
    return [product.name, product.category, product.description]
      .join(" ")
      .toLowerCase()
      .includes(keyword);
  });
  renderProducts();
});

loadProducts();
renderCart();

// Check for pending toast from checkout
const pendingToast = sessionStorage.getItem("pendingToast");
if (pendingToast) {
  showNotification(pendingToast);
  sessionStorage.removeItem("pendingToast");
}

async function loadProducts() {
  productGrid.innerHTML = "<p>Memuat produk...</p>";

  try {
    const response = await fetch("/api/products");
    const result = await response.json();
    products = result.map(normalizeProduct);
    cart = normalizeCart(cart, products);
    saveCart();
    filteredProducts = products;
    renderProducts();
    renderCart();
  } catch (_error) {
    productGrid.innerHTML = "<p>Gagal memuat produk.</p>";
  }
}

function renderProducts() {
  productGrid.innerHTML = "";
  productSummary.textContent = `${filteredProducts.length} produk tersedia`;

  if (!filteredProducts.length) {
    productGrid.innerHTML = "<p>Tidak ada produk yang cocok.</p>";
    return;
  }

  filteredProducts.forEach((product) => {
    const card = productTemplate.content.firstElementChild.cloneNode(true);
    const image = card.querySelector(".product-image");
    const variantSelect = document.createElement("select");
    variantSelect.className = "variant-select";

    image.src = product.imageUrl || placeholderImage;
    image.alt = product.name;
    card.querySelector(".category-text").textContent = product.category;
    card.querySelector(".product-title").textContent = product.name;
    card.querySelector(".description").textContent = product.description || "Tidak ada deskripsi.";

    product.variants.forEach((variant) => {
      const option = document.createElement("option");
      option.value = variant.id;
      option.textContent = `${formatVariantLabel(variant.label)} - ${formatCurrency(variant.price)} (${variant.stock} stok)`;
      option.disabled = variant.stock === 0;
      variantSelect.appendChild(option);
    });

    const selectedVariant = findSelectedVariant(product, variantSelect.value) || product.variants[0];
    card.querySelector(".price").textContent = formatCurrency(selectedVariant.price);

    variantSelect.addEventListener("change", () => {
      const nextVariant = findSelectedVariant(product, variantSelect.value);
      card.querySelector(".price").textContent = formatCurrency(nextVariant.price);
      updateAllProductButtons();
    });

    const controls = card.querySelector(".product-controls");
    controls.insertBefore(variantSelect, card.querySelector(".add-to-cart-button"));

    const button = card.querySelector(".add-to-cart-button");
    
    button.addEventListener("click", () => {
      const chosenVariant = findSelectedVariant(product, variantSelect.value);
      const inCart = cart.some((item) => item.id === product.id && item.variantId === chosenVariant.id);
      
      if (inCart) {
        cart = cart.filter((item) => !(item.id === product.id && item.variantId === chosenVariant.id));
        saveCart();
        renderCart();
        updateAllProductButtons();
        showNotification(`${product.name} dihapus dari keranjang.`);
      } else {
        flyToCart(button);
        addToCart(product, chosenVariant);
      }
    });
    productGrid.appendChild(card);
  });
  updateAllProductButtons();
}

function addToCart(product, variant) {
  const existingItem = cart.find((item) => item.id === product.id && item.variantId === variant.id);
  if (existingItem) {
    if (existingItem.quantity >= variant.stock) {
      alert("Jumlah melebihi stok varian.");
      return;
    }
    existingItem.quantity += 1;
  } else {
    cart.push({
      id: product.id,
      variantId: variant.id,
      variantLabel: variant.label,
      name: product.name,
      price: variant.price,
      quantity: 1,
      imageUrl: product.imageUrl || placeholderImage
    });
  }

  saveCart();
  renderCart();
  updateAllProductButtons();
  showNotification(`${product.name} (${variant.label}) ditambahkan ke keranjang.`);
}

function renderCart() {
  cartItemsContainer.innerHTML = "";
  cartCount.textContent = String(cart.length);

  if (!cart.length) {
    cartItemsContainer.innerHTML = "<p>Keranjang masih kosong.</p>";
    cartTotal.textContent = formatCurrency(0);
    return;
  }

  cart.forEach((item) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-item-new">
        <img src="${item.imageUrl || placeholderImage}" alt="${item.name}" class="cart-item-image" />
        <div class="cart-item-details">
          <div class="cart-item-header">
            <span class="cart-item-title">${item.name}</span>
            <span class="cart-item-price">${formatCurrency(item.price * item.quantity)}</span>
          </div>
          <span class="cart-item-subtitle muted">${item.variantLabel}</span>
          <div class="cart-item-bottom">
            <div class="cart-item-qty">
              <span>Qty:</span>
              <button class="qty-btn btn-minus" type="button">-</button>
              <span>${item.quantity}</span>
              <button class="qty-btn btn-plus" type="button">+</button>
            </div>
            <button class="cart-item-delete-link" type="button">DELETE</button>
          </div>
        </div>
      </div>
    `;
    row.querySelector(".cart-item-delete-link").addEventListener("click", () => {
      cart = cart.filter((cartItem) => !(cartItem.id === item.id && cartItem.variantId === item.variantId));
      saveCart();
      renderCart();
      updateAllProductButtons();
      showNotification(`${item.name} dihapus dari keranjang.`);
    });
    row.querySelector(".btn-minus").addEventListener("click", () => {
      updateCartItemQuantity(item.id, item.variantId, -1);
    });
    row.querySelector(".btn-plus").addEventListener("click", () => {
      updateCartItemQuantity(item.id, item.variantId, 1);
    });
    cartItemsContainer.appendChild(row);
  });

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  cartTotal.textContent = formatCurrency(total);
}

function updateCartItemQuantity(productId, variantId, change) {
  const item = cart.find((item) => item.id === productId && item.variantId === variantId);
  if (!item) return;

  const product = products.find((p) => p.id === productId);
  const variant = product ? product.variants.find((v) => v.id === variantId) : null;

  if (change > 0) {
    if (variant && item.quantity >= variant.stock) {
      showNotification("Stok tidak mencukupi.");
      return;
    }
    item.quantity += 1;
  } else if (change < 0) {
    item.quantity -= 1;
    if (item.quantity <= 0) {
      cart = cart.filter((cartItem) => !(cartItem.id === productId && cartItem.variantId === variantId));
      showNotification(`${item.name} dihapus dari keranjang.`);
    }
  }

  saveCart();
  renderCart();
  updateAllProductButtons();
}

function updateAllProductButtons() {
  const cards = productGrid.querySelectorAll(".product-card");
  cards.forEach((card) => {
    const title = card.querySelector("h4").textContent;
    const product = products.find((p) => p.name === title);
    if (!product) return;

    const variantSelect = card.querySelector(".variant-select");
    const selectedVariant = findSelectedVariant(product, variantSelect.value);
    const button = card.querySelector(".add-to-cart-button");

    const inCart = cart.some((item) => item.id === product.id && item.variantId === selectedVariant.id);

    if (selectedVariant.stock === 0) {
      button.textContent = "Habis";
      button.disabled = true;
      button.classList.remove("danger-button");
    } else if (inCart) {
      button.textContent = "Hapus";
      button.disabled = false;
      button.classList.add("danger-button");
    } else {
      button.textContent = "Tambah";
      button.disabled = false;
      button.classList.remove("danger-button");
    }
  });
}

function normalizeProduct(product) {
  const variants = Array.isArray(product.variants) && product.variants.length
    ? product.variants
    : [
        {
          id: "default",
          label: "Reguler",
          price: Number(product.price || 0),
          stock: Number(product.stock || 0)
        }
      ];

  return {
    ...product,
    variants
  };
}

function findSelectedVariant(product, variantId) {
  return product.variants.find((variant) => variant.id === variantId) || product.variants[0];
}

function sumVariantStock(variants) {
  return variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
}

function normalizeCart(currentCart, availableProducts) {
  return currentCart
    .map((item) => {
      if (item.variantId) {
        return item;
      }

      const product = availableProducts.find((entry) => entry.id === item.id);
      const fallbackVariant = product?.variants?.[0];
      if (!fallbackVariant) {
        return null;
      }

      return {
        ...item,
        variantId: fallbackVariant.id,
        variantLabel: formatVariantLabel(fallbackVariant.label),
        price: fallbackVariant.price
      };
    })
    .filter(Boolean);
}

function readCart() {
  try {
    return JSON.parse(localStorage.getItem("cart") || "[]");
  } catch (_error) {
    return [];
  }
}

function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(value);
}

function createPlaceholderImage() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
      <rect width="640" height="480" fill="#ebe4d8" />
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#6b655d" font-family="Arial, sans-serif" font-size="32">
        Produk
      </text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function formatVariantLabel(label) {
  const value = String(label || "").trim();
  if (!value) {
    return "Reguler";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function showNotification(message, duration = 2000) {
  const notification = document.createElement("div");
  notification.className = "toast-notification";
  notification.innerHTML = `
    <div class="toast-content">${message}</div>
    <div class="toast-progress" style="animation-duration: ${duration}ms"></div>
  `;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add("fade-out");
    setTimeout(() => {
      notification.remove();
    }, 500);
  }, duration);
}

function flyToCart(buttonElement) {
  const cartButton = document.getElementById("open-cart-button");
  if (!cartButton) return;

  const btnRect = buttonElement.getBoundingClientRect();
  const cartRect = cartButton.getBoundingClientRect();

  const flyer = document.createElement("div");
  flyer.className = "cart-flyer";
  flyer.style.left = `${btnRect.left + btnRect.width / 2}px`;
  flyer.style.top = `${btnRect.top + btnRect.height / 2}px`;
  document.body.appendChild(flyer);

  // Trigger reflow
  flyer.offsetWidth;

  flyer.style.transform = `translate(${cartRect.left - btnRect.left}px, ${cartRect.top - btnRect.top}px) scale(0.5)`;
  flyer.style.opacity = "0";

  setTimeout(() => {
    flyer.remove();
    cartButton.classList.add("bounce");
    setTimeout(() => cartButton.classList.remove("bounce"), 300);
  }, 600);
}
