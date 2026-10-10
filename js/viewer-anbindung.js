(() => {
  try {
    function returnToImage(viewer) {
      if (!(viewer instanceof HTMLElement)) return;
      const visual = viewer.closest('.modal-visual');
      if (!visual) return;
      const imageRadio = visual.querySelector('.modal-view-radio[value="schraeg"], .display-mode-radio[value="image"]');
      if (imageRadio && !imageRadio.checked) {
        imageRadio.checked = true;
        imageRadio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    document.addEventListener('waffen3d:error', (event) => {
      try {
        returnToImage(event.target);
      } catch (error) {
        console.error('3D-Fehler konnte nicht auf die Bildansicht zurückschalten.', error);
      }
    }, true);

    const failureObserver = new MutationObserver((records) => {
      records.forEach(({ target }) => {
        try {
          if (target instanceof HTMLElement && target.dataset.state === 'failed') {
            returnToImage(target);
          }
        } catch (error) {
          console.error('3D-Fehlerstatus konnte nicht ausgewertet werden.', error);
        }
      });
    });

    document.querySelectorAll('.waffen3d[data-model]').forEach((viewer) => {
      failureObserver.observe(viewer, { attributes: true, attributeFilter: ['data-state'] });
      if (viewer.dataset.state === 'failed') returnToImage(viewer);
    });
  } catch (error) {
    console.error('3D-Rückfallverhalten konnte nicht initialisiert werden.', error);
  }
})();
