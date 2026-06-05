/* eslint-disable no-restricted-syntax */

function resolvePersistableImgSrc(img) {
  const daSrc = img.getAttribute('data-stream-original-src')
    || img.getAttribute('data-original-src')
    || img.dataset?.originalSrc
    || '';
  const currentSrc = img.getAttribute('src') || '';

  if (daSrc && !daSrc.startsWith('data:')) return daSrc;
  if (currentSrc && !currentSrc.startsWith('data:')) return currentSrc;
  if (daSrc) return daSrc;
  return '';
}

export function sanitizeMetadataHtmlRoot(root) {
  if (!(root instanceof HTMLElement)) return root;

  root.querySelectorAll('.stream-annotation-metadata-row-delete').forEach((b) => b.remove());

  root.querySelectorAll('p').forEach((p) => {
    [...p.attributes].forEach((attr) => p.removeAttribute(attr.name));
  });

  root.querySelectorAll('picture').forEach((picture) => {
    const img = picture.querySelector('img');
    if (img) picture.replaceWith(img);
    else picture.remove();
  });

  root.querySelectorAll('img').forEach((img) => {
    const persistSrc = resolvePersistableImgSrc(img);
    if (persistSrc) img.setAttribute('src', persistSrc);
    else img.removeAttribute('src');

    const srcset = img.getAttribute('srcset') || '';
    if (!srcset || srcset.startsWith('data:') || srcset.includes('base64')) {
      img.removeAttribute('srcset');
    }

    [...img.attributes]
      .filter((attr) => attr.name.startsWith('data-'))
      .forEach((attr) => img.removeAttribute(attr.name));
  });

  root.querySelectorAll('source').forEach((s) => s.remove());

  return root;
}

export function sanitizeMetadataBlockHtml(blockEl) {
  if (!(blockEl instanceof HTMLElement)) return '';
  const clone = blockEl.cloneNode(true);
  return sanitizeMetadataHtmlRoot(clone).innerHTML;
}

export function sanitizeMetadataInnerHtml(htmlString) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = htmlString || '';
  return sanitizeMetadataHtmlRoot(wrapper).innerHTML;
}
