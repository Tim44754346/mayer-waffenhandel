(() => {
  try {
    const MAX_MENGE = 999;
    const ANZAHLUNG_AB = 5000;
    const ANZAHLUNG_ANTEIL = 0.5;
    const storageKey = 'mayer-waffenhandel-anfrageliste';
    const legacyStorageKey = storageKey;
    const inquiryBar = document.getElementById('inquiry-bar');
    const backToTop = document.querySelector('.back-to-top');
    const inquiryLayer = document.getElementById('inquiry-layer');
    const drawer = document.getElementById('inquiry-drawer');
    const itemList = drawer && drawer.querySelector('.inquiry-items');
    const emptyMessage = drawer && drawer.querySelector('.inquiry-empty');
    const totalLabel = drawer && drawer.querySelector('.inquiry-total');
    const permitsLabel = drawer && drawer.querySelector('.inquiry-permits');
    const largePermitNotice = drawer && drawer.querySelector('.inquiry-large-permit');
    const messageField = drawer && drawer.querySelector('.inquiry-message');
    const copyButton = drawer && drawer.querySelector('.inquiry-copy');
    const clearButton = drawer && drawer.querySelector('.inquiry-clear');
    const status = drawer && drawer.querySelector('.inquiry-status');
    const closeButton = drawer && drawer.querySelector('.inquiry-close');
    const depositDetails = drawer && drawer.querySelector('.inquiry-deposit-details');
    const depositAmount = drawer && drawer.querySelector('.inquiry-deposit-amount');
    const remainingAmount = drawer && drawer.querySelector('.inquiry-remaining-amount');
    const barSummary = inquiryBar && inquiryBar.querySelector('.inquiry-bar-summary');
    const barDeposit = inquiryBar && inquiryBar.querySelector('.inquiry-deposit-summary');
    const cards = Array.from(document.querySelectorAll('.product-card[data-id]'));
    const money = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
    const permitLabels = { klein: 'Kleiner Waffenschein', gross: 'Großer Waffenschein' };
    const colorNames = { schwarz: 'Schwarz', silber: 'Silber', gold: 'Gold' };
    let products = new Map();
    let items = [];
    let persistenceWarning = '';
    let dataWarning = '';
    let previousFocus = null;
    let memoryOnly = false;
    let inquiryBarObserver = null;
    let ringColor = 'schwarz';
    let clearConfirmTimer = null;
    let scrollFramePending = false;

    function requireMarkup() {
      if (!inquiryBar || !backToTop || !inquiryLayer || !drawer || !itemList || !emptyMessage ||
        !totalLabel || !permitsLabel || !largePermitNotice || !messageField ||
        !copyButton || !clearButton || !status || !closeButton || !depositDetails ||
        !depositAmount || !remainingAmount || !barSummary || !barDeposit ||
        cards.length !== 7) {
        throw new Error('Anfragelisten-Markup oder Produktkarten fehlen.');
      }
      cards.forEach((card) => {
        if (!card.querySelector('.product-add') || !card.querySelector('.modal-inquiry-add') ||
          !card.querySelector('.card-quantity-control input') ||
          !card.querySelector('.modal-item-quantity-control input') ||
          !card.querySelector('.inquiry-open-modal')) {
          throw new Error(`Mengensteuerungen fehlen für Produkt "${card.dataset.id}".`);
        }
      });
    }

    function formatPrice(price) {
      return `${money.format(price)}\u00a0€`;
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

    function isRingItemId(id) {
      return /^schlagring:(schwarz|silber|gold)$/.test(id);
    }

    function itemColor(id) {
      return id.split(':')[1];
    }

    function itemIdFor(product, color) {
      return product.id === 'schlagring' ? `${product.id}:${color}` : product.id;
    }

    function itemName(product, color) {
      return product.id === 'schlagring'
        ? `${product.name} (${colorNames[color]})`
        : product.name;
    }

    function selectedRingColor(card) {
      const selected = card.querySelector('.ring-radio:checked');
      const value = selected ? selected.value : ringColor;
      return colorNames[value] ? value : 'schwarz';
    }

    function colorForCard(card) {
      return products.get(card.dataset.id).id === 'schlagring' ? selectedRingColor(card) : '';
    }

    function allowedStoredId(id) {
      return products.has(id) || (isRingItemId(id) && products.has('schlagring'));
    }

    function makeItem(product, color, quantity) {
      const id = itemIdFor(product, color);
      return {
        id,
        name: itemName(product, color),
        price: product.price,
        permit: product.permit,
        quantity
      };
    }

    function parseStoredState(raw) {
      const sourceItems = Array.isArray(raw) ? raw : raw && raw.items;
      if (!Array.isArray(sourceItems)) throw new Error('Gespeicherte Anfrageliste hat ein ungültiges Format.');

      const normalizedItems = [];
      sourceItems.forEach((entry) => {
        if (!entry || typeof entry.id !== 'string' || !allowedStoredId(entry.id) ||
          !Number.isSafeInteger(entry.quantity) || entry.quantity < 1) return;
        const productId = isRingItemId(entry.id) ? 'schlagring' : entry.id;
        const product = products.get(productId);
        const remaining = MAX_MENGE - normalizedItems.reduce((sum, item) => sum + item.quantity, 0);
        if (remaining <= 0) return;
        const desired = Math.min(entry.quantity, remaining);
        const existing = normalizedItems.find((item) => item.id === entry.id);
        if (existing) {
          existing.quantity = Math.min(MAX_MENGE, existing.quantity + desired);
        } else {
          normalizedItems.push(makeItem(product, isRingItemId(entry.id) ? itemColor(entry.id) : '', desired));
        }
      });

      const savedRingColor = raw && colorNames[raw.ringColor]
        ? raw.ringColor
        : 'schwarz';
      return { items: normalizedItems, ringColor: savedRingColor };
    }

    function serializedState() {
      return JSON.stringify({ items, ringColor });
    }

    function removeLegacyValue() {
      try {
        window.sessionStorage.removeItem(legacyStorageKey);
      } catch (error) {
        // A removed or inaccessible legacy store must not block the current list.
      }
    }

    function loadState() {
      let localStore;
      let localValue;
      try {
        localStore = window.localStorage;
        localValue = localStore.getItem(storageKey);
      } catch (error) {
        memoryOnly = true;
        persistenceWarning = 'Speicherung nicht verfügbar. Die Liste bleibt nur für diesen Seitenaufruf erhalten.';
        return;
      }

      if (localValue !== null) {
        try {
          const stored = JSON.parse(localValue);
          const loaded = parseStoredState(stored);
          items = loaded.items;
          ringColor = loaded.ringColor;
          if (stored && !Array.isArray(stored) && Object.prototype.hasOwnProperty.call(stored, 'owned')) {
            try {
              localStore.setItem(storageKey, serializedState());
            } catch (error) {
              console.warn('Gespeicherte Bestandsangaben konnten nicht entfernt werden.', error);
            }
          }
        } catch (error) {
          items = [];
          ringColor = 'schwarz';
        }
        removeLegacyValue();
        return;
      }

      let legacyValue = null;
      try {
        legacyValue = window.sessionStorage.getItem(legacyStorageKey);
      } catch (error) {
        return;
      }
      if (legacyValue === null) return;

      let loaded;
      try {
        loaded = parseStoredState(JSON.parse(legacyValue));
      } catch (error) {
        return;
      }
      try {
        const serialized = JSON.stringify({ items: loaded.items, ringColor: loaded.ringColor });
        localStore.setItem(storageKey, serialized);
        items = loaded.items;
        ringColor = loaded.ringColor;
        removeLegacyValue();
      } catch (error) {
        items = [];
        ringColor = 'schwarz';
      }
    }

    function saveState() {
      if (memoryOnly) return;
      try {
        window.localStorage.setItem(storageKey, serializedState());
        persistenceWarning = '';
      } catch (error) {
        memoryOnly = true;
        persistenceWarning = 'Speicherung nicht verfügbar. Die Liste bleibt nur für diesen Seitenaufruf erhalten.';
      }
    }

    function totalCount() {
      return items.reduce((sum, item) => sum + item.quantity, 0);
    }

    function remainingCapacity() {
      return Math.max(0, MAX_MENGE - totalCount());
    }

    function totalPrice() {
      return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    }

    function requiredPermits() {
      const keys = Array.from(new Set(items.map((item) => item.permit)));
      return keys.map((key) => permitLabels[key]);
    }

    function containsLargePermit() {
      return items.some((item) => item.permit === 'gross');
    }

    function depositValues() {
      const total = totalPrice();
      if (total < ANZAHLUNG_AB) return null;
      const deposit = Math.ceil(total * ANZAHLUNG_ANTEIL);
      return { deposit, remaining: total - deposit };
    }

    function requestText() {
      const lines = items.map((item) =>
        `${item.quantity}× ${item.name} (${formatPrice(item.price * item.quantity)})`
      );
      const permits = requiredPermits();
      let result = `Guten Tag, ich interessiere mich für folgende Artikel von Mayer Waffenhandel: ${lines.join(', ')}. Gesamt: ${formatPrice(totalPrice())}. Benötigte Berechtigung: ${permits.join(' und ')}.`;
      const deposit = depositValues();
      if (deposit) {
        result += ` Anzahlung (50 %): ${formatPrice(deposit.deposit)}. Rest bei Übergabe: ${formatPrice(deposit.remaining)}. Die Ware wird nach Zahlungseingang der Anzahlung übergeben.`;
      }
      return `${result} Wann kann ich vorbeikommen?`;
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

    function quantityFor(id) {
      const entry = items.find((item) => item.id === id);
      return entry ? entry.quantity : 0;
    }

    function updateProductControls() {
      const remaining = remainingCapacity();
      const full = remaining === 0;
      const limitMessage = `Höchstmenge der Liste: ${MAX_MENGE} Stück.`;
      cards.forEach((card) => {
        const product = products.get(card.dataset.id);
        const color = product.id === 'schlagring' ? ringColor : '';
        const itemId = itemIdFor(product, color);
        const quantity = quantityFor(itemId);
        const maximum = Math.min(MAX_MENGE, quantity + remaining);

        card.querySelectorAll('.item-quantity-control').forEach((control) => {
          const input = control.querySelector('.direct-quantity-input');
          control.hidden = quantity === 0;
          if (document.activeElement !== input) input.value = String(quantity);
          input.max = String(maximum);
          input.disabled = full && quantity === 0;
          control.querySelectorAll('.item-quantity-step').forEach((button) => {
            const step = Number(button.dataset.itemStep);
            button.disabled = input.disabled || (step > 0 && (full || quantity >= maximum));
          });
        });
        card.querySelectorAll('.product-add, .modal-inquiry-add').forEach((button) => {
          button.hidden = quantity > 0;
          button.disabled = full;
        });
        const openButton = card.querySelector('.inquiry-open-modal');
        openButton.disabled = items.length === 0;
        openButton.textContent = `Anfrageliste öffnen (${totalCount()})`;
        [card.querySelector('.product-add-status'), card.querySelector('.modal-add-status')]
          .filter(Boolean)
          .forEach((feedback) => {
            if (full) {
              setMessage(feedback, limitMessage, true);
            } else if (feedback.textContent === limitMessage) {
              setMessage(feedback, '', false);
            } else if (feedback.textContent.endsWith(`. ${limitMessage}`)) {
              setMessage(feedback, feedback.textContent.replace(`. ${limitMessage}`, ''), false);
            }
          });
        if (product.id === 'schlagring') {
          card.querySelectorAll('.ring-radio').forEach((radio) => {
            radio.checked = radio.value === ringColor;
          });
          const colorBadge = card.querySelector('.ring-color-badge');
          if (colorBadge) colorBadge.textContent = `Farbe: ${colorNames[ringColor]}`;
        }
      });
    }

    function updateDepositDisplay() {
      const deposit = depositValues();
      depositDetails.hidden = !deposit;
      barDeposit.hidden = !deposit;
      if (deposit) {
        depositAmount.textContent = `Anzahlung (50 %): ${formatPrice(deposit.deposit)}`;
        remainingAmount.textContent = `Rest bei Übergabe: ${formatPrice(deposit.remaining)}`;
        barDeposit.textContent = `Anzahlung ${formatPrice(deposit.deposit)}`;
      } else {
        depositAmount.textContent = '';
        remainingAmount.textContent = '';
        barDeposit.textContent = '';
      }
    }

    function updateBackToTop() {
      const visible = window.scrollY > window.innerHeight;
      backToTop.hidden = !visible;
      backToTop.tabIndex = visible ? 0 : -1;
    }

    function bindBackToTop() {
      const scheduleUpdate = () => {
        if (scrollFramePending) return;
        scrollFramePending = true;
        window.requestAnimationFrame(() => {
          scrollFramePending = false;
          updateBackToTop();
        });
      };
      window.addEventListener('scroll', scheduleUpdate, { passive: true });
      window.addEventListener('resize', scheduleUpdate);
      updateBackToTop();
    }

    function updateInquiryBarSpacing() {
      if (inquiryBar.hidden) {
        document.body.classList.remove('inquiry-bar-visible');
        document.documentElement.style.removeProperty('--inquiry-bar-height');
        return;
      }
      const height = Math.ceil(inquiryBar.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--inquiry-bar-height', `${height}px`);
      document.body.classList.add('inquiry-bar-visible');
    }

    function observeInquiryBarSize() {
      if (typeof ResizeObserver === 'function') {
        try {
          inquiryBarObserver = new ResizeObserver(updateInquiryBarSpacing);
          inquiryBarObserver.observe(inquiryBar);
          return;
        } catch (error) {
          console.warn('ResizeObserver für die Anfrageliste nicht verfügbar; resize-Ersatz wird verwendet.', error);
          inquiryBarObserver = null;
        }
      }
      window.addEventListener('resize', updateInquiryBarSpacing);
    }

    function render() {
      const count = totalCount();
      inquiryBar.hidden = count === 0;
      barSummary.textContent = `Anfrageliste (${count}) · Summe: ${formatPrice(totalPrice())}`;
      itemList.replaceChildren();
      emptyMessage.hidden = items.length > 0;
      totalLabel.textContent = `Gesamt: ${formatPrice(totalPrice())}`;
      const permits = requiredPermits();
      permitsLabel.textContent = `Benötigte Berechtigung: ${permits.length ? permits.join(' und ') : '–'}`;
      largePermitNotice.hidden = !containsLargePermit();
      messageField.value = items.length ? requestText() : '';
      copyButton.disabled = items.length === 0;
      clearButton.disabled = items.length === 0;
      cards.forEach((card) => {
        card.querySelectorAll('.product-add-status, .modal-add-status').forEach((feedback) => {
          setMessage(feedback, '', false);
        });
      });

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
        const output = document.createElement('output');
        output.textContent = String(item.quantity);
        const increment = makeControl('+', 'inquiry-quantity-button', 'increment', item.id, `Menge von ${item.name} erhöhen`);
        increment.disabled = count >= MAX_MENGE;
        quantity.append(decrement, output, increment);
        const remove = makeControl('Entfernen', 'inquiry-remove', 'remove', item.id, `${item.name} entfernen`);
        row.append(details, quantity, remove);
        itemList.append(row);
      });

      updateDepositDisplay();
      updateInquiryBarSpacing();
      updateProductControls();
      updateBackToTop();
      const warning = persistenceWarning || dataWarning;
      status.textContent = warning;
      if (warning) status.dataset.error = 'true';
      else status.removeAttribute('data-error');
    }

    function currentProductColor(card, product) {
      return product.id === 'schlagring' ? colorForCard(card) : '';
    }

    function setMessage(element, message, isError) {
      element.textContent = message;
      if (isError) element.dataset.error = 'true';
      else element.removeAttribute('data-error');
    }

    function statusName(product, color) {
      return itemName(product, color);
    }

    function announceItemQuantity(product, color, quantity, feedback, limited) {
      const name = statusName(product, color);
      const message = quantity > 0
        ? `${name}: ${quantity} in der Liste${limited ? `. Höchstmenge der Liste: ${MAX_MENGE} Stück.` : ''}`
        : `${name}: aus der Liste entfernt`;
      setMessage(feedback, message, limited);
    }

    function setItemQuantity(card, product, color, requestedQuantity, feedback) {
      const id = itemIdFor(product, color);
      const current = quantityFor(id);
      const maximum = Math.min(MAX_MENGE, current + remainingCapacity());
      const quantity = Math.max(0, Math.min(maximum, requestedQuantity));
      const index = items.findIndex((item) => item.id === id);
      if (quantity === 0) {
        if (index >= 0) items.splice(index, 1);
      } else if (index >= 0) {
        items[index].quantity = quantity;
      } else {
        items.push(makeItem(product, color, quantity));
      }
      saveState();
      render();
      announceItemQuantity(product, color, quantity, feedback, requestedQuantity > maximum || totalCount() === MAX_MENGE);
    }

    function addOne(card, product, feedback) {
      const color = currentProductColor(card, product);
      const id = itemIdFor(product, color);
      if (remainingCapacity() === 0) {
        setMessage(feedback, `Höchstmenge der Liste: ${MAX_MENGE} Stück.`, true);
        return;
      }
      setItemQuantity(card, product, color, quantityFor(id) + 1, feedback);
    }

    function commitQuantityInput(input) {
      const card = input.closest('.product-card');
      const product = products.get(card.dataset.id);
      const color = currentProductColor(card, product);
      const id = itemIdFor(product, color);
      const current = quantityFor(id);
      const feedback = input.closest('.modal-info')
        ? card.querySelector('.modal-add-status')
        : card.querySelector('.product-add-status');
      const raw = input.value.trim();
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
        input.value = String(current);
        delete input.dataset.dirty;
        setMessage(feedback, `${statusName(product, color)}: ungültige Eingabe; Menge bleibt ${current}.`, true);
        return;
      }
      const requested = Number(raw);
      const maximum = Math.min(MAX_MENGE, current + remainingCapacity());
      delete input.dataset.dirty;
      setItemQuantity(card, product, color, requested, feedback);
      if (requested > maximum) {
        setMessage(
          feedback,
          `${statusName(product, color)}: ${quantityFor(id)} in der Liste. Höchstmenge der Liste: ${MAX_MENGE} Stück.`,
          true
        );
      }
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
        [[cardButton, cardStatus], [modalButton, modalStatus]].forEach(([button, feedback]) => {
          button.addEventListener('click', () => {
            try {
              addOne(card, product, feedback);
            } catch (error) {
              console.error('Artikel konnte nicht zur Anfrageliste hinzugefügt werden.', error);
            }
          });
        });

        card.querySelectorAll('.inquiry-open-modal').forEach((button) => {
          button.addEventListener('click', openDrawer);
        });

        card.querySelectorAll('.direct-quantity-input').forEach((input) => {
          input.addEventListener('blur', () => {
            try {
              if (input.dataset.dirty === 'true') commitQuantityInput(input);
            } catch (error) {
              console.error('Mengenfeld konnte nicht korrigiert werden.', error);
            }
          });
          input.addEventListener('change', () => {
            if (input.dataset.field === 'quantity' && input.dataset.dirty === 'true') {
              try {
                commitQuantityInput(input);
              } catch (error) {
                console.error('Direkte Menge konnte nicht übernommen werden.', error);
              }
            }
          });
          input.addEventListener('input', () => {
            input.dataset.dirty = 'true';
          });
        });

        card.querySelectorAll('.ring-radio').forEach((radio) => {
          radio.addEventListener('change', () => {
            try {
              ringColor = radio.value;
              saveState();
              render();
            } catch (error) {
              console.error('Schlagringfarbe konnte nicht aktualisiert werden.', error);
            }
          });
        });
        card.querySelectorAll('.item-quantity-step').forEach((button) => {
          button.addEventListener('click', () => {
            try {
              const color = currentProductColor(card, product);
              const id = itemIdFor(product, color);
              const current = quantityFor(id);
              const step = Number(button.dataset.itemStep);
              if (step > 0 && remainingCapacity() === 0) {
                setMessage(
                  button.closest('.modal-info') ? modalStatus : cardStatus,
                  `Höchstmenge der Liste: ${MAX_MENGE} Stück.`,
                  true
                );
                return;
              }
              const feedback = button.closest('.modal-info') ? modalStatus : cardStatus;
              setItemQuantity(card, product, color, current + step, feedback);
            } catch (error) {
              console.error('Direkte Mengensteuerung konnte nicht angewendet werden.', error);
            }
          });
        });
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
          if (action === 'increment' && remainingCapacity() > 0) {
            items[index].quantity += 1;
          } else if (action === 'decrement') {
            if (items[index].quantity > 1) items[index].quantity -= 1;
            else items.splice(index, 1);
          } else if (action === 'remove') {
            items.splice(index, 1);
          } else {
            return;
          }
          saveState();
          render();
          focusAfterUpdate(itemId, action);
        } catch (error) {
          console.error('Menge konnte nicht geändert werden.', error);
        }
      });
    }

    function openDrawer() {
      if (inquiryLayer.hidden === false) return;
      previousFocus = document.activeElement;
      inquiryLayer.hidden = false;
      document.body.classList.add('inquiry-open');
      closeButton.focus();
    }

    function closeDrawer() {
      inquiryLayer.hidden = true;
      document.body.classList.remove('inquiry-open');
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected &&
        previousFocus.getClientRects().length && !previousFocus.disabled) {
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
          if (!clearConfirmTimer) {
            clearButton.textContent = 'Wirklich leeren?';
            status.textContent = 'Zum Leeren bitte innerhalb von 3 Sekunden erneut tippen.';
            clearConfirmTimer = window.setTimeout(() => {
              clearConfirmTimer = null;
              clearButton.textContent = 'Liste leeren';
            }, 3000);
            return;
          }
          window.clearTimeout(clearConfirmTimer);
          clearConfirmTimer = null;
          clearButton.textContent = 'Liste leeren';
          items = [];
          saveState();
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
      loadState();
      bindProductActions();
      bindQuantityActions();
      bindDrawer();
      bindCopy();
      observeInquiryBarSize();
      bindBackToTop();
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
