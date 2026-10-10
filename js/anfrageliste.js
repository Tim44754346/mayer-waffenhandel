(() => {
  try {
    const storageKey = 'mayer-waffenhandel-anfrageliste';
    const inquiryBar = document.getElementById('inquiry-bar');
    const inquiryLayer = document.getElementById('inquiry-layer');
    const drawer = document.getElementById('inquiry-drawer');
    const itemList = drawer && drawer.querySelector('.inquiry-items');
    const emptyMessage = drawer && drawer.querySelector('.inquiry-empty');
    const totalLabel = drawer && drawer.querySelector('.inquiry-total');
    const permitsLabel = drawer && drawer.querySelector('.inquiry-permits');
    const messageField = drawer && drawer.querySelector('.inquiry-message');
    const copyButton = drawer && drawer.querySelector('.inquiry-copy');
    const clearButton = drawer && drawer.querySelector('.inquiry-clear');
    const status = drawer && drawer.querySelector('.inquiry-status');
    const closeButton = drawer && drawer.querySelector('.inquiry-close');
    const cards = Array.from(document.querySelectorAll('.product-card[data-id]'));
    const money = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
    const permitLabels = { klein: 'Kleiner Waffenschein', gross: 'Großer Waffenschein' };
    let products = new Map();
    let items = [];
    let persistenceWarning = '';
    let dataWarning = '';
    let previousFocus = null;

    function requireMarkup() {
      if (!inquiryBar || !inquiryLayer || !drawer || !itemList || !emptyMessage ||
        !totalLabel || !permitsLabel || !messageField || !copyButton ||
        !clearButton || !status || !closeButton || cards.length !== 7) {
        throw new Error('Anfragelisten-Markup oder Produktkarten fehlen.');
      }
    }

    function formatPrice(price) {
      return `${money.format(price)} €`;
    }

    function productFromCard(card) {
      const { id, name, permit } = card.dataset;
      const price = Number(card.dataset.price);
      if (!id || !name || !permit || !Number.isSafeInteger(price) || price < 0) {
        throw new Error(`Ungültige Produktdaten für ${id || 'unbekannt'}.`);
      }
      const permitKey = permit === permitLabels.klein ? 'klein' : permit === permitLabels.gross ? 'gross' : '';
      if (!permitKey) throw new Error(`Unbekannte Berechtigung für ${id}.`);
      return { id, name, price, permit: permitKey };
    }

    function validManifestProduct(raw) {
      return raw && typeof raw.id === 'string' && typeof raw.name === 'string' &&
        Number.isSafeInteger(raw.price) && raw.price >= 0 &&
        (raw.permit === 'klein' || raw.permit === 'gross') &&
        typeof raw.category === 'string';
    }

    async function readProducts() {
      const fallbackProducts = new Map(cards.map((card) => {
        const product = productFromCard(card);
        return [product.id, product];
      }));
      try {
        const response = await fetch('produkte.json');
        if (!response.ok) throw new Error(`produkte.json konnte nicht geladen werden (${response.status}).`);
        const manifest = await response.json();
        if (!Array.isArray(manifest)) throw new Error('produkte.json enthält keine Artikelliste.');
        const fromManifest = new Map();
        manifest.forEach((product) => {
          if (!validManifestProduct(product) || fromManifest.has(product.id)) {
            throw new Error('produkte.json enthält ungültige oder doppelte Artikel.');
          }
          fromManifest.set(product.id, {
            id: product.id,
            name: product.name,
            price: product.price,
            permit: product.permit
          });
        });
        if (fallbackProducts.size !== fromManifest.size ||
          Array.from(fallbackProducts.keys()).some((id) => !fromManifest.has(id))) {
          throw new Error('produkte.json stimmt nicht mit den Produktkarten überein.');
        }
        return fromManifest;
      } catch (error) {
        console.warn('Artikeldatei nicht verfügbar; Anfrageliste nutzt die HTML-Datenattribute.', error);
        dataWarning = 'Artikeldatei nicht verfügbar. Die eingeblendeten Produktdaten werden verwendet.';
        return fallbackProducts;
      }
    }

    function colorForCard(card) {
      const selected = card.querySelector('.ring-radio:checked');
      return selected ? selected.value : 'schwarz';
    }

    function makeItem(product, color) {
      if (product.id === 'schlagring') {
        const label = color.charAt(0).toUpperCase() + color.slice(1);
        return {
          id: `${product.id}:${color}`,
          name: `${product.name} (${label})`,
          price: product.price,
          permit: product.permit,
          quantity: 1
        };
      }
      return { id: product.id, name: product.name, price: product.price, permit: product.permit, quantity: 1 };
    }

    function parseStoredItem(raw) {
      if (!raw || typeof raw.id !== 'string') return null;
      let product;
      let color = '';
      if (/^schlagring:(schwarz|silber|gold)$/.test(raw.id)) {
        color = raw.id.split(':')[1];
        product = products.get('schlagring');
      } else {
        product = products.get(raw.id);
      }
      const quantity = Math.floor(Number(raw.quantity));
      if (!product || !Number.isFinite(quantity)) return null;
      const item = makeItem(product, color);
      item.quantity = Math.max(1, Math.min(99, quantity));
      return item;
    }

    function loadItems() {
      try {
        const saved = window.sessionStorage.getItem(storageKey);
        if (!saved) return;
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) throw new Error('Gespeicherte Anfrageliste hat ein ungültiges Format.');
        items = parsed.map(parseStoredItem).filter(Boolean);
      } catch (error) {
        persistenceWarning = 'Speicherung nicht verfügbar. Die Liste bleibt nur für diesen Seitenaufruf erhalten.';
        console.warn(persistenceWarning, error);
      }
    }

    function saveItems() {
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(items));
        persistenceWarning = '';
      } catch (error) {
        persistenceWarning = 'Speicherung nicht verfügbar. Die Liste bleibt nur für diesen Seitenaufruf erhalten.';
        console.warn(persistenceWarning, error);
      }
    }

    function totalCount() {
      return items.reduce((sum, item) => sum + item.quantity, 0);
    }

    function totalPrice() {
      return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    }

    function requiredPermits() {
      const keys = Array.from(new Set(items.map((item) => item.permit)));
      return keys.map((key) => permitLabels[key]);
    }

    function requestText() {
      const lines = items.map((item) =>
        `${item.quantity}× ${item.name} (${formatPrice(item.price * item.quantity)})`
      );
      const permits = requiredPermits();
      return `Guten Tag, ich interessiere mich für folgende Artikel von Mayer Waffenhandel: ${lines.join(', ')}. Gesamt: ${formatPrice(totalPrice())}. Benötigte Berechtigung: ${permits.join(' und ')}. Wann kann ich vorbeikommen?`;
    }

    function makeControl(text, className, action, id, label) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.dataset.action = action;
      button.dataset.itemId = id;
      button.textContent = text;
      if (label) button.setAttribute('aria-label', label);
      return button;
    }

    function render() {
      inquiryBar.hidden = items.length === 0;
      inquiryBar.textContent = `Anfrageliste (${totalCount()}) · Summe: ${formatPrice(totalPrice())}`;
      itemList.replaceChildren();
      emptyMessage.hidden = items.length > 0;
      totalLabel.textContent = `Gesamt: ${formatPrice(totalPrice())}`;
      const permits = requiredPermits();
      permitsLabel.textContent = `Benötigte Berechtigung: ${permits.length ? permits.join(' und ') : '–'}`;
      messageField.value = items.length ? requestText() : '';
      copyButton.disabled = items.length === 0;
      clearButton.disabled = items.length === 0;

      items.forEach((item) => {
        const row = document.createElement('li');
        row.className = 'inquiry-item';
        row.dataset.itemId = item.id;
        const details = document.createElement('div');
        const name = document.createElement('span');
        name.className = 'inquiry-item-name';
        name.textContent = item.name;
        const price = document.createElement('span');
        price.className = 'inquiry-item-price';
        price.textContent = `${formatPrice(item.price)} je Stück · ${formatPrice(item.price * item.quantity)} gesamt`;
        details.append(name, price);

        const quantity = document.createElement('div');
        quantity.className = 'inquiry-quantity';
        quantity.setAttribute('aria-label', `Menge für ${item.name}`);
        const decrement = makeControl('−', 'inquiry-quantity-button', 'decrement', item.id, `Menge von ${item.name} verringern`);
        decrement.disabled = item.quantity <= 1;
        const output = document.createElement('output');
        output.textContent = String(item.quantity);
        const increment = makeControl('+', 'inquiry-quantity-button', 'increment', item.id, `Menge von ${item.name} erhöhen`);
        increment.disabled = item.quantity >= 99;
        quantity.append(decrement, output, increment);
        const remove = makeControl('Entfernen', 'inquiry-remove', 'remove', item.id, `${item.name} entfernen`);
        row.append(details, quantity, remove);
        itemList.append(row);
      });

      const warning = persistenceWarning || dataWarning;
      status.textContent = warning;
      if (warning) status.dataset.error = 'true';
      else status.removeAttribute('data-error');
    }

    function addItem(product, color) {
      const item = makeItem(product, color);
      const existing = items.find((candidate) => candidate.id === item.id);
      if (existing) {
        if (existing.quantity >= 99) {
          status.dataset.error = 'true';
          status.textContent = 'Die Höchstmenge von 99 Stück pro Artikel ist erreicht.';
          return false;
        }
        existing.quantity += 1;
      } else {
        items.push(item);
      }
      saveItems();
      render();
      return true;
    }

    function updateAdditionFeedback(card, feedback, product) {
      const color = product.id === 'schlagring' ? colorForCard(card) : '';
      feedback.textContent = addItem(product, color) ? 'Hinzugefügt' : 'Höchstmenge erreicht';
    }

    function bindProductActions() {
      cards.forEach((card) => {
        const product = products.get(card.dataset.id);
        const cardButton = card.querySelector('.product-add');
        const cardStatus = card.querySelector('.product-add-status');
        const modalButton = card.querySelector('.modal-inquiry-add');
        const modalStatus = card.querySelector('.modal-add-status');
        if (!product || !cardButton || !cardStatus || !modalButton || !modalStatus) {
          throw new Error(`Hinzufügen-Steuerung fehlt für Produkt "${card.dataset.id}".`);
        }
        cardButton.addEventListener('click', () => {
          try {
            updateAdditionFeedback(card, cardStatus, product);
          } catch (error) {
            console.error('Artikel konnte nicht zur Anfrageliste hinzugefügt werden.', error);
          }
        });
        modalButton.addEventListener('click', () => {
          try {
            updateAdditionFeedback(card, modalStatus, product);
          } catch (error) {
            console.error('Artikel konnte nicht zur Anfrageliste hinzugefügt werden.', error);
          }
        });
        if (product.id === 'schlagring') {
          const updateLabel = () => {
            const color = colorForCard(card);
            const label = color.charAt(0).toUpperCase() + color.slice(1);
            cardButton.setAttribute('aria-label', `${product.name} (${label}) zur Anfrageliste hinzufügen`);
            modalButton.setAttribute('aria-label', `${product.name} (${label}) zur Anfrageliste hinzufügen`);
          };
          card.querySelectorAll('.ring-radio').forEach((radio) =>
            radio.addEventListener('change', updateLabel)
          );
          updateLabel();
        }
      });
    }

    function focusAfterUpdate(id, action) {
      const row = Array.from(itemList.querySelectorAll('.inquiry-item')).find((item) => item.dataset.itemId === id);
      const button = row && row.querySelector(`[data-action="${action}"]:not(:disabled)`);
      (button || closeButton).focus();
    }

    function bindQuantityActions() {
      itemList.addEventListener('click', (event) => {
        try {
          const target = event.target;
          const button = target instanceof Element ? target.closest('button[data-action]') : null;
          if (!button) return;
          const { action, itemId } = button.dataset;
          const index = items.findIndex((item) => item.id === itemId);
          if (index < 0) return;
          if (action === 'increment' && items[index].quantity < 99) {
            items[index].quantity += 1;
          } else if (action === 'decrement' && items[index].quantity > 1) {
            items[index].quantity -= 1;
          } else if (action === 'remove') {
            items.splice(index, 1);
          } else {
            return;
          }
          saveItems();
          render();
          focusAfterUpdate(itemId, action);
        } catch (error) {
          console.error('Menge konnte nicht geändert werden.', error);
        }
      });
    }

    function openDrawer() {
      previousFocus = document.activeElement;
      inquiryLayer.hidden = false;
      document.body.classList.add('inquiry-open');
      closeButton.focus();
    }

    function closeDrawer() {
      inquiryLayer.hidden = true;
      document.body.classList.remove('inquiry-open');
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected && previousFocus.getClientRects().length) {
        previousFocus.focus();
      } else if (!inquiryBar.hidden) {
        inquiryBar.focus();
      } else {
        const firstAdd = document.querySelector('.product-add');
        if (firstAdd) firstAdd.focus();
      }
    }

    function bindDrawer() {
      inquiryBar.addEventListener('click', openDrawer);
      closeButton.addEventListener('click', closeDrawer);
      inquiryLayer.addEventListener('click', (event) => {
        if (event.target === inquiryLayer) closeDrawer();
      });
      document.addEventListener('keydown', (event) => {
        if (inquiryLayer.hidden) {
          if (event.key === 'Escape') {
            const productModal = document.querySelector('.modal-toggle:checked');
            if (productModal) productModal.checked = false;
          }
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          closeDrawer();
          return;
        }
        if (event.key === 'Tab') {
          const focusable = Array.from(drawer.querySelectorAll('button:not(:disabled), textarea'));
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      });

      clearButton.addEventListener('click', () => {
        try {
          items = [];
          saveItems();
          render();
          status.textContent = persistenceWarning || 'Liste geleert.';
          closeButton.focus();
        } catch (error) {
          console.error('Anfrageliste konnte nicht geleert werden.', error);
        }
      });
    }

    function selectMessageText() {
      messageField.focus();
      messageField.select();
      messageField.setSelectionRange(0, messageField.value.length);
    }

    function bindCopy() {
      copyButton.addEventListener('click', async () => {
        status.removeAttribute('data-error');
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(messageField.value);
            status.textContent = 'Text kopiert.';
            return;
          }
        } catch (error) {
          console.warn('Clipboard-API fehlgeschlagen; Ersatzweg wird versucht.', error);
        }

        try {
          selectMessageText();
          if (document.execCommand('copy')) {
            status.textContent = 'Text kopiert.';
            return;
          }
        } catch (error) {
          console.warn('Ersatzweg zum Kopieren fehlgeschlagen.', error);
        }

        selectMessageText();
        status.dataset.error = 'true';
        status.textContent = 'Kopieren nicht möglich. Der Text ist markiert – bitte manuell kopieren.';
      });
    }

    async function initialize() {
      requireMarkup();
      products = await readProducts();
      loadItems();
      bindProductActions();
      bindQuantityActions();
      bindDrawer();
      bindCopy();
      render();
    }

    initialize().catch((error) => {
      console.error('Anfrageliste konnte nicht initialisiert werden.', error);
      if (status) {
        status.textContent = 'Die Anfrageliste konnte nicht geladen werden. Bitte laden Sie die Seite neu.';
        status.dataset.error = 'true';
      }
    });
  } catch (error) {
    console.error('Anfragelisten-Skript konnte nicht gestartet werden.', error);
  }
})();
