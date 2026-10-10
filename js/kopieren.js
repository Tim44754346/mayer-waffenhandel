(() => {
  try {
    function markValue(input) {
      input.focus();
      input.select();
      input.setSelectionRange(0, input.value.length);
    }

    async function copyValue(input, status, button) {
      status.removeAttribute('data-error');
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(input.value);
          status.textContent = 'In die Zwischenablage kopiert.';
          return;
        }
      } catch (clipboardError) {
        console.warn('Clipboard-API fehlgeschlagen; Ersatzweg wird versucht.', clipboardError);
        status.textContent = 'Direktes Kopieren nicht verfügbar; Ersatzweg wird versucht.';
      }

      try {
        markValue(input);
        if (document.execCommand('copy')) {
          status.textContent = 'In die Zwischenablage kopiert.';
          button.focus();
          return;
        }
      } catch (copyError) {
        console.warn('Ersatzweg zum Kopieren fehlgeschlagen.', copyError);
        status.dataset.error = 'true';
      }

      markValue(input);
      status.dataset.error = 'true';
      status.textContent = 'Kopieren nicht möglich. Der Wert ist markiert – bitte manuell kopieren.';
    }

    document.querySelectorAll('.copy-value[readonly]').forEach((input) => {
      try {
        const parent = input.parentNode;
        if (!parent) throw new Error('Kontaktfeld hat kein Elternelement.');

        const row = document.createElement('div');
        row.className = 'copy-row';
        parent.insertBefore(row, input);
        row.append(input);

        const button = document.createElement('button');
        button.className = 'copy-button';
        button.type = 'button';
        button.textContent = 'Kopieren';
        button.setAttribute('aria-label', `Wert kopieren: ${input.getAttribute('aria-label') || 'Kontaktangabe'}`);
        row.append(button);

        const context = input.closest('.contact-item, .license-panel, .partner-contact, .staff-details');
        let status = context ? context.querySelector('.copy-status') : null;
        if (!status) {
          const broaderContext = input.closest('.license-panel, .partner-contact, .staff-details');
          status = broaderContext ? broaderContext.querySelector('.copy-status') : null;
        }
        if (!status) {
          status = document.createElement('p');
          status.className = 'copy-status';
          status.setAttribute('role', 'status');
          status.setAttribute('aria-live', 'polite');
          row.insertAdjacentElement('afterend', status);
        }
        button.addEventListener('click', () => {
          copyValue(input, status, button).catch((error) => {
            console.error('Kopieren ist unerwartet fehlgeschlagen.', error);
            status.dataset.error = 'true';
            status.textContent = 'Kopieren fehlgeschlagen. Bitte markieren Sie den Wert und kopieren Sie ihn manuell.';
            try {
              markValue(input);
            } catch (selectionError) {
              console.error('Der Wert konnte nicht automatisch markiert werden.', selectionError);
            }
          });
        });
      } catch (error) {
        console.error('Kontaktfeld konnte nicht für das Kopieren vorbereitet werden.', error);
      }
    });
  } catch (error) {
    console.error('Kopierfunktion konnte nicht initialisiert werden.', error);
  }
})();
