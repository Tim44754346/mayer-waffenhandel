(() => {
  try {
    const MAX_MENGE = 999;
    const ANZAHLUNG_AB = 5000;
    const ANZAHLUNG_ANTEIL = 0.5;
    const storageKey = 'mayer-waffenhandel-anfrageliste';
    const legacyStorageKey = storageKey;
    const inquiryBar = document.getElementById('inquiry-bar');
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
    const barDelivery = inquiryBar && inquiryBar.querySelector('.inquiry-delivery-summary');
    const cards = Array.from(document.querySelectorAll('.product-card[data-id]'));
    const money = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
    const permitLabels = { klein: 'Kleiner Waffenschein', gross: 'Großer Waffenschein' };
    const colorNames = { schwarz: 'Schwarz', silber: 'Silber', gold: 'Gold' };
    let products = new Map();
    let items = [];
    let ownedQuantities = Object.create(null);
    let persistenceWarning = '';
    let dataWarning = '';
    let previousFocus = null;
    let memoryOnly = false;

    function requireMarkup() {
      if (!inquiryBar || !inquiryLayer || !drawer || !itemList || !emptyMessage ||
        !totalLabel || !permitsLabel || !largePermitNotice || !messageField ||
        !copyButton || !clearButton || !status || !closeButton || !depositDetails ||
        !depositAmount || !remainingAmount || !barSummary || !barDeposit ||
        !barDelivery || cards.length !== 7) {
        throw new Error('Anfragelisten-Markup oder Produktkarten fehlen.');
      }
      cards.forEach((card) => {
        if (!card.querySelector('.product-add') || !card.querySelector('.modal-inquiry-add') ||
          !card.querySelector('.card-quantity-control input') ||
          !card.querySelector('.modal-quantity-control input') ||
          !card.querySelector('.owned-quantity-input') ||
          !card.querySelector('.inquiry-open-modal')) {
          throw new Error(`Mengensteuerungen fehlen für Produkt "${card.dataset.id}".`);
        }
      });
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

    function colorForCard(card) {
      const selected = card.querySelector('.ring-radio:checked');
      return selected && colorNames[selected.value] ? selected.value : 'schwarz';
    }

    function currentOwnedKey(card) {
      const product = products.get(card.dataset.id);
      return itemIdFor(product, product.id === 'schlagring' ? colorForCard(card) : '');
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

    function parseStoredState(raw, legacyFormat) {
      const sourceItems = Array.isArray(raw) ? raw : raw && raw.items;
      if (!Array.isArray(sourceItems)) throw new Error('Gespeicherte Anfrageliste hat ein ungültiges Format.');

      const normalizedItems = [];
      let available = MAX_MENGE;
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
        available = Math.max(0, MAX_MENGE - normalizedItems.reduce((sum, item) => sum + item.quantity, 0));
      });

      const normalizedOwned = Object.create(null);
      const savedOwned = !legacyFormat && raw && raw.owned && typeof raw.owned === 'object'
        ? raw.owned
        : {};
      Object.keys(savedOwned).forEach((id) => {
        const validId = allowedStoredId(id);
        const quantity = savedOwned[id];
        if (validId && Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= MAX_MENGE) {
          normalizedOwned[id] = quantity;
        }
      });
      return { items: normalizedItems, owned: normalizedOwned };
    }

    function serializedState() {
      return JSON.stringify({ items, owned: ownedQuantities });
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
          const loaded = parseStoredState(JSON.parse(localValue), false);
          items = loaded.items;
          ownedQuantities = loaded.owned;
        } catch (error) {
          items = [];
          ownedQuantities = Object.create(null);
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
        loaded = parseStoredState(JSON.parse(legacyValue), true);
      } catch (error) {
        return;
      }
      try {
        const serialized = JSON.stringify({ items: loaded.items, owned: loaded.owned });
        localStore.setItem(storageKey, serialized);
        items = loaded.items;
        ownedQuantities = loaded.owned;
        removeLegacyValue();
      } catch (error) {
        items = [];
        ownedQuantities = Object.create(null);
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
      const lines = items.map((item) => {
        const owned = ownedQuantities[item.id] || 0;
        const ownedText = owned > 0 ? ` (habe bereits ${owned})` : '';
        return `${item.quantity}× ${item.name} (${formatPrice(item.price * item.quantity)})${ownedText}`;
      });
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

    function badgeLabel(owned, requested) {
      if (owned > 0) return `Habe ${owned} · Anfrage ${requested}`;
      return `In Anfrage: ${requested}`;
    }

    function updateBadges() {
      cards.forEach((card) => {
        const productId = card.dataset.id;
        const selectedId = itemIdFor(products.get(productId), productId === 'schlagring' ? colorForCard(card) : '');
        const requested = quantityFor(selectedId);
        const owned = ownedQuantities[selectedId] || 0;
        card.querySelectorAll('.inquiry-badge').forEach((badge) => {
          badge.hidden = owned === 0 && requested === 0;
          badge.textContent = badgeLabel(owned, requested);
          badge.dataset.badgeItem = selectedId;
        });
        const ownedInput = card.querySelector('.owned-quantity-input');
        if (ownedInput && document.activeElement !== ownedInput) {
          ownedInput.value = String(owned);
        }
        const openButton = card.querySelector('.inquiry-open-modal');
        openButton.disabled = items.length === 0;
        openButton.textContent = `Anfrageliste öffnen (${totalCount()})`;
        if (productId === 'schlagring') {
          const color = colorForCard(card);
          const colorBadge = card.querySelector('.ring-color-badge');
          if (colorBadge) colorBadge.textContent = `Farbe: ${colorNames[color]}`;
        }
      });
    }

    function updateStepButtons(input) {
      const control = input.closest('.quantity-control');
      if (!control) return;
      const isOwned = input.dataset.field === 'owned';
      const min = isOwned ? 0 : 1;
      const max = isOwned ? MAX_MENGE : Number(input.max);
      const raw = input.value.trim();
      const valid = /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw));
      const value = valid ? Number(raw) : NaN;
      control.querySelectorAll('.quantity-step').forEach((button) => {
        const direction = Number(button.dataset.step);
        button.disabled = input.disabled || !valid ||
          (direction < 0 && value <= min) ||
          (direction > 0 && (!Number.isFinite(max) || value >= max));
      });
    }

    function updateQuantityInputs() {
      const remaining = remainingCapacity();
      const full = remaining === 0;
      const limitMessage = `Höchstmenge der Liste: ${MAX_MENGE} Stück.`;
      cards.forEach((card) => {
        card.querySelectorAll('.inquiry-quantity-input[data-field="quantity"]').forEach((input) => {
          input.disabled = full;
          if (full) {
            input.removeAttribute('max');
          } else {
            input.max = String(remaining);
            const value = Number(input.value);
            if (!Number.isSafeInteger(value) || value < 1 || value > remaining) {
              input.value = String(Math.max(1, Math.min(remaining, Number.isSafeInteger(value) ? value : 1)));
            }
          }
          updateStepButtons(input);
        });
        card.querySelectorAll('.owned-quantity-input').forEach((input) => {
          input.max = String(MAX_MENGE);
          input.disabled = false;
          updateStepButtons(input);
        });
        card.querySelectorAll('.product-add, .modal-inquiry-add').forEach((button) => {
          button.disabled = full;
        });
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
      });
    }

    function updateDepositDisplay() {
      const deposit = depositValues();
      depositDetails.hidden = !deposit;
      barDeposit.hidden = !deposit;
      barDelivery.hidden = !deposit;
      if (deposit) {
        depositAmount.textContent = `Anzahlung (50 %): ${formatPrice(deposit.deposit)}`;
        remainingAmount.textContent = `Rest bei Übergabe: ${formatPrice(deposit.remaining)}`;
        barDeposit.textContent = `Anzahlung (50 %): ${formatPrice(deposit.deposit)} · Rest bei Übergabe: ${formatPrice(deposit.remaining)}`;
        barDelivery.textContent = 'Die Ware wird nach Zahlungseingang der Anzahlung übergeben.';
      } else {
        depositAmount.textContent = '';
        remainingAmount.textContent = '';
        barDeposit.textContent = '';
        barDelivery.textContent = '';
      }
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

      items.forEach((item) => {
        const row = document.createElement('li');
        row.className = 'inquiry-item';
        row.dataset.itemId = item.id;
        const details = document.createElement('div');
        const name = document.createElement('span');
        name.className = 'inquiry-item-name';
        name.textContent = item.name;
        const owned = ownedQuantities[item.id] || 0;
        const price = document.createElement('span');
        price.className = 'inquiry-item-price';
        price.textContent = `${formatPrice(item.price)} je Stück · ${formatPrice(item.price * item.quantity)} gesamt${owned > 0 ? ` · Habe ${owned}` : ''}`;
        details.append(name, price);

        const quantity = document.createElement('div');
        quantity.className = 'inquiry-quantity';
        quantity.setAttribute('aria-label', `Menge für ${item.name}`);
        const decrement = makeControl('−', 'inquiry-quantity-button', 'decrement', item.id, `Menge von ${item.name} verringern`);
        decrement.disabled = item.quantity <= 1;
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
      updateBadges();
      updateQuantityInputs();
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

    function addItem(card, product, requestedQuantity, feedback, reachedLimit) {
      const remaining = remainingCapacity();
      if (remaining === 0) {
        setMessage(feedback, `Höchstmenge der Liste: ${MAX_MENGE} Stück.`, true);
        render();
        return;
      }
      const quantity = Math.min(requestedQuantity, remaining);
      const color = currentProductColor(card, product);
      const item = makeItem(product, color, quantity);
      const existing = items.find((candidate) => candidate.id === item.id);
      if (existing) existing.quantity += quantity;
      else items.push(item);
      saveState();
      const atLimit = requestedQuantity >= remaining;
      render();
      setMessage(
        feedback,
        reachedLimit || atLimit
          ? `Hinzugefügt: ${quantity}×. Höchstmenge der Liste: ${MAX_MENGE} Stück.`
          : `Hinzugefügt: ${quantity}×`,
        reachedLimit || atLimit
      );
    }

    function clampInput(input, announceCorrection) {
      const fieldType = input.dataset.field;
      const min = fieldType === 'owned' ? 0 : 1;
      const max = fieldType === 'owned' ? MAX_MENGE : remainingCapacity();
      const raw = input.value.trim();
      const valid = /^\d+$/.test(raw);
      let value = valid ? Number(raw) : min;
      if (!Number.isSafeInteger(value)) value = min;
      if (fieldType === 'quantity' && valid && Number(raw) > max && max > 0) {
        input.dataset.requestLimited = 'true';
      } else if (fieldType === 'quantity') {
        delete input.dataset.requestLimited;
      }
      value = Math.max(min, Math.min(max, value));
      if (fieldType !== 'owned' && max === 0) return null;
      const corrected = !valid || String(value) !== raw;
      input.value = String(value);
      if (announceCorrection && corrected) {
        const card = input.closest('.product-card');
        const feedback = input.closest('.modal-info')
          ? card.querySelector('.modal-add-status')
          : card.querySelector('.product-add-status');
        setMessage(feedback, `Menge angepasst: ${value}`, false);
      }
      return value;
    }

    function saveOwnedInput(input) {
      const card = input.closest('.product-card');
      const key = currentOwnedKey(card);
      const value = clampInput(input, true);
      if (value === null) return;
      ownedQuantities[key] = value;
      saveState();
      render();
    }

    function fieldForAction(button) {
      const container = button.closest('.product-info, .modal-info');
      return container && container.querySelector('.inquiry-quantity-input[data-field="quantity"]');
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
              const input = fieldForAction(button);
              const reachedLimit = Boolean(input && input.dataset.requestLimited === 'true');
              if (input) delete input.dataset.requestLimited;
              const quantity = input ? clampInput(input, true) : null;
              if (quantity === null) {
                setMessage(feedback, `Höchstmenge der Liste: ${MAX_MENGE} Stück.`, true);
                return;
              }
              addItem(card, product, quantity, feedback, reachedLimit);
              if (input) input.value = '1';
              updateQuantityInputs();
            } catch (error) {
              console.error('Artikel konnte nicht zur Anfrageliste hinzugefügt werden.', error);
            }
          });
        });

        card.querySelectorAll('.inquiry-open-modal').forEach((button) => {
          button.addEventListener('click', openDrawer);
        });

        card.querySelectorAll('.inquiry-quantity-input').forEach((input) => {
          input.addEventListener('blur', () => {
            try {
              if (input.dataset.field === 'owned') saveOwnedInput(input);
              else {
                clampInput(input, true);
                updateQuantityInputs();
              }
            } catch (error) {
              console.error('Mengenfeld konnte nicht korrigiert werden.', error);
            }
          });
          input.addEventListener('input', () => {
            delete input.dataset.requestLimited;
            updateStepButtons(input);
          });
        });

        card.querySelectorAll('.ring-radio').forEach((radio) => {
          radio.addEventListener('change', () => {
            try {
              updateBadges();
            } catch (error) {
              console.error('Schlagringfarbe konnte nicht aktualisiert werden.', error);
            }
          });
        });
      });
    }

    function bindQuantitySteps() {
      document.addEventListener('click', (event) => {
        try {
          const target = event.target;
          const button = target instanceof Element ? target.closest('.quantity-step') : null;
          if (!button || button.disabled) return;
          const input = document.getElementById(button.dataset.stepTarget);
          if (!input || input.disabled) return;
          const type = input.dataset.field;
          const min = type === 'owned' ? 0 : 1;
          const max = type === 'owned' ? MAX_MENGE : remainingCapacity();
          if (type !== 'owned' && max === 0) return;
          const current = clampInput(input, false);
          const next = Math.max(min, Math.min(max, current + Number(button.dataset.step)));
          input.value = String(next);
          if (type === 'owned') saveOwnedInput(input);
          else updateQuantityInputs();
        } catch (error) {
          console.error('Mengensteuerung konnte nicht angewendet werden.', error);
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
          if (action === 'increment' && remainingCapacity() > 0) {
            items[index].quantity += 1;
          } else if (action === 'decrement' && items[index].quantity > 1) {
            items[index].quantity -= 1;
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
      bindQuantitySteps();
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
