// Referral Tracking
const urlParams = new URLSearchParams(window.location.search);
const refCode = urlParams.get("ref");
if (refCode) {
  localStorage.setItem("affiliateCode", refCode);
  // Bersihkan URL agar terlihat rapi
  const newUrl = window.location.pathname + (window.location.hash || "");
  window.history.replaceState({}, document.title, newUrl);
}

const productGrid = document.getElementById("product-grid");
const productTemplate = document.getElementById("product-card-template");
const cartDrawer = document.getElementById("cart-drawer");
const cartItemsContainer = document.getElementById("cart-items");
const cartCount = document.getElementById("cart-count");
const cartTotal = document.getElementById("cart-total");
const searchInput = document.getElementById("search-input");
const productSummary = document.getElementById("product-summary");
const categoryFilters = document.getElementById("category-filters");
const cartBackdrop = document.getElementById("cart-backdrop");


let products = [];
let filteredProducts = [];
let cart = readCart();
let currentKeyword = "";
let currentCategory = "Semua";
const placeholderImage = createPlaceholderImage();

document.getElementById("open-cart-button").addEventListener("click", () => {
  cartDrawer.classList.remove("hidden");
  cartBackdrop.classList.remove("hidden");
});

document.getElementById("close-cart-button").addEventListener("click", () => {
  cartDrawer.classList.add("hidden");
  cartBackdrop.classList.add("hidden");
});

cartBackdrop.addEventListener("click", () => {
  cartDrawer.classList.add("hidden");
  cartBackdrop.classList.add("hidden");
});

document.getElementById("checkout-button").addEventListener("click", (event) => {
  if (!cart.length) {
    event.preventDefault();
    showNotification("Keranjang masih kosong.", "info");
  }
});

searchInput.addEventListener("input", (event) => {
  currentKeyword = event.target.value.trim().toLowerCase();
  applyFilters();
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
    renderCategoryFilters();
    updateHeroStats();
    renderProducts();
    renderCart();
  } catch (_error) {
    productGrid.innerHTML = "<p>Gagal memuat produk.</p>";
  }
}

function renderProducts() {
  productGrid.innerHTML = "";
  productSummary.textContent = buildProductSummary();

  if (!filteredProducts.length) {
    productGrid.innerHTML = "<p>Tidak ada produk yang cocok.</p>";
    return;
  }

  filteredProducts.forEach((product) => {
    const card = productTemplate.content.firstElementChild.cloneNode(true);
    const image = card.querySelector(".product-image");
    const variantSelect = document.createElement("select");
    variantSelect.className = "variant-select";
    const totalStock = sumVariantStock(product.variants);
    const cheapestVariant = findLowestVariant(product.variants);

    image.src = product.imageUrl || placeholderImage;
    image.alt = product.name;
    card.querySelector(".category-text").textContent = product.category;
    card.querySelector(".category-badge").textContent = product.category;
    card.querySelector(".product-title").textContent = product.name;
    card.querySelector(".product-title").title = product.name;

    const description = product.description || "Tidak ada deskripsi.";
    const descriptionElement = card.querySelector(".description");
    descriptionElement.textContent = description;
    descriptionElement.title = description;

    product.variants.forEach((variant) => {
      const option = document.createElement("option");
      option.value = variant.id;
      option.textContent = `${formatVariantLabel(variant.label)}`;
      option.disabled = variant.stock === 0;
      variantSelect.appendChild(option);
    });

    const selectedVariant = findSelectedVariant(product, variantSelect.value) || cheapestVariant;
    card.querySelector(".price").textContent = formatCurrency(cheapestVariant.price);

    variantSelect.addEventListener("change", () => {
      const nextVariant = findSelectedVariant(product, variantSelect.value);
      card.querySelector(".price").textContent = formatCurrency(nextVariant.price);
      const weightChip = card.querySelector(".product-weight-chip");
      if (weightChip) {
        weightChip.textContent = formatWeight(nextVariant.weightGrams);
      }
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
      showNotification("Jumlah melebihi stok varian.", "error");
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
      weightGrams: variant.weightGrams,
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
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
  cartCount.textContent = String(totalQty);

  if (!cart.length) {
    cartItemsContainer.innerHTML = "<p>Keranjang masih kosong.</p>";
    cartTotal.textContent = formatCurrency(0);
    return;
  }

  cart.forEach((item) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-item-inner">
        <div class="cart-item-img-container">
          <img src="${item.imageUrl || placeholderImage}" alt="${item.name}" class="cart-item-image" />
        </div>
        <div class="cart-item-info">
          <div class="cart-item-top">
            <div class="cart-item-main">
              <span class="cart-item-name">${item.name}</span>
              <span class="cart-item-variant">${item.variantLabel}</span>
            </div>
            <button class="cart-item-remove-btn" type="button" aria-label="Hapus">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <div class="cart-item-bottom">
            <span class="cart-item-price-each">${formatCurrency(item.price)}</span>
            <div class="cart-item-control">
              <button class="qty-btn btn-minus" type="button">−</button>
              <span class="qty-val">${item.quantity}</span>
              <button class="qty-btn btn-plus" type="button">+</button>
            </div>
          </div>
        </div>
      </div>
    `;
    row.querySelector(".cart-item-remove-btn").addEventListener("click", () => {
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

function applyFilters() {
  filteredProducts = products.filter((product) => {
    const matchesKeyword = [product.name, product.category, product.description, ...product.variants.map((variant) => variant.label)]
      .join(" ")
      .toLowerCase()
      .includes(currentKeyword);
    const matchesCategory = currentCategory === "Semua" || product.category === currentCategory;
    return matchesKeyword && matchesCategory;
  });
  updateCategoryFilterState();
  renderProducts();
}

function renderCategoryFilters() {
  const categories = ["Semua", ...new Set(products.map((product) => product.category).filter(Boolean))];
  categoryFilters.innerHTML = categories
    .map((category) => `
      <button class="filter-chip${category === currentCategory ? " active" : ""}" type="button" data-category="${category}">
        ${category}
      </button>
    `)
    .join("");

  categoryFilters.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      currentCategory = button.dataset.category || "Semua";
      applyFilters();
    });
  });
}

function updateCategoryFilterState() {
  categoryFilters.querySelectorAll("[data-category]").forEach((button) => {
    button.classList.toggle("active", button.dataset.category === currentCategory);
  });
}

function updateHeroStats() {
  // Hero section dihapus - fungsi ini dipertahankan untuk kompatibilitas
}

function buildProductSummary() {
  const totalVariants = filteredProducts.reduce((sum, product) => sum + product.variants.length, 0);
  const categoryLabel = currentCategory === "Semua" ? "Semua kategori" : currentCategory;
  return `${filteredProducts.length} produk • ${totalVariants} varian • ${categoryLabel}`;
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
        stock: Number(product.stock || 0),
        weightGrams: Number(product.weightGrams || 250)
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

function findLowestVariant(variants) {
  return [...variants].sort((left, right) => Number(left.price || 0) - Number(right.price || 0))[0];
}

function normalizeCart(currentCart, availableProducts) {
  return currentCart
    .map((item) => {
      if (item.variantId) {
        if (item.weightGrams) {
          return item;
        }

        const product = availableProducts.find((entry) => entry.id === item.id);
        const variant = product?.variants?.find((entry) => entry.id === item.variantId);
        return {
          ...item,
          variantLabel: item.variantLabel || formatVariantLabel(variant?.label),
          price: Number(item.price || variant?.price || 0),
          weightGrams: Number(variant?.weightGrams || 250)
        };
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
        price: fallbackVariant.price,
        weightGrams: fallbackVariant.weightGrams
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

function formatWeight(value) {
  const grams = Number(value || 0);
  if (!grams) {
    return "-";
  }

  if (grams >= 1000 && grams % 1000 === 0) {
    return `${grams / 1000} kg`;
  }

  return `${grams} g`;
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
