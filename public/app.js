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
    card.querySelector(".category-badge").textContent = product.category;
    card.querySelector(".stock-badge").textContent = `Total stok ${sumVariantStock(product.variants)}`;
    card.querySelector("h4").textContent = product.name;
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
      button.disabled = nextVariant.stock === 0;
      button.textContent = nextVariant.stock === 0 ? "Habis" : "Tambah";
    });

    const content = card.querySelector(".product-content");
    content.insertBefore(variantSelect, card.querySelector(".price-row"));

    const button = card.querySelector(".add-to-cart-button");
    button.disabled = selectedVariant.stock === 0;
    button.textContent = selectedVariant.stock === 0 ? "Habis" : "Tambah";
    button.addEventListener("click", () => {
      const chosenVariant = findSelectedVariant(product, variantSelect.value);
      addToCart(product, chosenVariant);
    });
    productGrid.appendChild(card);
  });
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
      quantity: 1
    });
  }

  saveCart();
  renderCart();
}

function renderCart() {
  cartItemsContainer.innerHTML = "";
  cartCount.textContent = String(cart.reduce((sum, item) => sum + item.quantity, 0));

  if (!cart.length) {
    cartItemsContainer.innerHTML = "<p>Keranjang masih kosong.</p>";
    cartTotal.textContent = formatCurrency(0);
    return;
  }

  cart.forEach((item) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-row">
        <strong>${item.name}</strong>
        <button class="icon-button" type="button">Hapus</button>
      </div>
      <p class="muted">${item.variantLabel} • Qty ${item.quantity}</p>
      <strong>${formatCurrency(item.price * item.quantity)}</strong>
    `;
    row.querySelector("button").addEventListener("click", () => {
      cart = cart.filter((cartItem) => !(cartItem.id === item.id && cartItem.variantId === item.variantId));
      saveCart();
      renderCart();
    });
    cartItemsContainer.appendChild(row);
  });

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  cartTotal.textContent = formatCurrency(total);
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
