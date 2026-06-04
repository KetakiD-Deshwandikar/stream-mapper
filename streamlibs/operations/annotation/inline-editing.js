import createAnnotationServiceClient from './service.js';
import { isInsideManagedMetadataBlock } from './store.js';
import { ANNOTATION_MESSAGES } from '../../utils/constants.js';
import { showGlobalSnackbar } from '../../utils/snackbar.js';

const MEDIUM_EDITOR_CSS_URL = 'https://cdn.jsdelivr.net/npm/medium-editor@5.23.3/dist/css/medium-editor.min.css';
const MEDIUM_EDITOR_JS_URL = 'https://cdn.jsdelivr.net/npm/medium-editor@5.23.3/dist/js/medium-editor.min.js';

export default function createInlineEditingController({
  annotationState,
  annotationUI,
  store,
  renderThreadMarkers,
  renderCommentsPanel,
  removePopup,
}) {
  const annotationService = createAnnotationServiceClient();
  const isInlineEditingAllowed = () => window.streamConfig?.inlineEditingAllowed !== false || window.streamConfig?.collabRole === 'owner';
  const EXPLICIT_FORMATTING_TOOLBAR_ACTIONS = new Set([
    'bold',
    'italic',
    'underline',
    'anchor',
    'append-h2',
    'append-h3',
    'append-blockquote',
  ]);

  /** Milo / stream fragment roots — inline edits must not apply here (DA-sourced embeds). */
  function isInsideStreamFragment(element) {
    if (!(element instanceof Element)) return false;
    return Boolean(element.closest('[data-class="fragment"]'));
  }

  function normalizeInlineFormattingHtml(html = '') {
    const template = document.createElement('template');
    template.innerHTML = html;

    template.content.querySelectorAll('*').forEach((element) => {
      element.classList.remove(
        'annotation-inline-editable',
        'annotation-inline-editable-image',
      );
      [
        'contenteditable',
        'spellcheck',
        'data-medium-editor-element',
        'medium-editor-index',
        'data-medium-editor-editor-index',
        'role',
        'aria-multiline',
        'data-placeholder',
      ].forEach((attr) => element.removeAttribute(attr));
    });

    template.content.querySelectorAll('b, i').forEach((element) => {
      const replacementTagName = element.tagName.toLowerCase() === 'b' ? 'strong' : 'em';
      const replacement = document.createElement(replacementTagName);
      Array.from(element.attributes).forEach((attr) => {
        replacement.setAttribute(attr.name, attr.value);
      });
      replacement.innerHTML = element.innerHTML;
      element.replaceWith(replacement);
    });

    return template.innerHTML;
  }

  async function loadMediumEditor() {
    if (window.MediumEditor) return;
    if (annotationState.mediumEditorLoadPromise) {
      await annotationState.mediumEditorLoadPromise;
      return;
    }

    if (!document.querySelector('link[data-medium-editor="css"]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = MEDIUM_EDITOR_CSS_URL;
      css.dataset.mediumEditor = 'css';
      document.head.appendChild(css);
    }

    annotationState.mediumEditorLoadPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector('script[data-medium-editor="js"]');
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(), { once: true });
        existingScript.addEventListener('error', () => reject(new Error('Failed to load MediumEditor')), { once: true });
        if (window.MediumEditor) resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = MEDIUM_EDITOR_JS_URL;
      script.dataset.mediumEditor = 'js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load MediumEditor'));
      document.head.appendChild(script);
    });

    await annotationState.mediumEditorLoadPromise;
  }

  function getInlineEditableElements() {
    if (!annotationUI.mainEl) return [];
    const selectors = [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'li', 'blockquote', 'figcaption',
      '[class*="heading"]', '[class*="title"]', '[class*="description"]',
    ];
    const candidates = Array.from(annotationUI.mainEl.querySelectorAll(selectors.join(', ')))
      .filter((el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (!el.textContent || !el.textContent.trim()) return false;
        if (el.closest('.annotation-comments-panel') || el.closest('.annotation-floating-popup')) return false;
        if (isInsideStreamFragment(el)) return false;
        // Managed metadata blocks are owned by the metadata-block recorder —
        // skip text-edit registration to avoid double-recording the same change.
        if (isInsideManagedMetadataBlock(el)) return false;
        return true;
      });
    const candidateSet = new Set(candidates);
    const nonLeafCandidates = new Set();

    candidates.forEach((candidate) => {
      let parent = candidate.parentElement;
      while (parent && parent !== annotationUI.mainEl) {
        if (candidateSet.has(parent)) {
          nonLeafCandidates.add(parent);
        }
        parent = parent.parentElement;
      }
    });

    return candidates.filter((element) => !nonLeafCandidates.has(element));
  }

  function getInlineEditableImages() {
    if (!annotationUI.mainEl) return [];
    return Array.from(annotationUI.mainEl.querySelectorAll('img'))
      .filter((el) => {
        if (!(el instanceof HTMLImageElement)) return false;
        if (el.closest('.annotation-comments-panel') || el.closest('.annotation-floating-popup')) return false;
        if (isInsideStreamFragment(el)) return false;
        // Managed metadata blocks are owned by the metadata-block recorder —
        // skip image-edit registration to avoid double-recording.
        if (isInsideManagedMetadataBlock(el)) return false;
        return true;
      });
  }

  function clearExplicitFormattingIntent(elementRef = '') {
    if (!elementRef) return;
    annotationState.explicitFormattingElementRefs.delete(elementRef);
    if (annotationUI.inlineActiveElementRef === elementRef) {
      annotationUI.inlineActiveElementRef = '';
    }
  }

  function markInlineElementAsFormattingIntent(elementRef = '') {
    if (!elementRef) return;
    annotationState.explicitFormattingElementRefs.add(elementRef);
  }

  function setActiveInlineEditableElement(element) {
    if (!(element instanceof HTMLElement)) return;
    annotationUI.inlineActiveElementRef = store.ensureElementRef(element);
  }

  function getActiveInlineEditableElementRef() {
    const currentRef = annotationUI.inlineActiveElementRef;
    if (currentRef && annotationUI.mainEl?.querySelector(`[data-annotation-ref="${currentRef}"]`)) {
      return currentRef;
    }

    const selection = window.getSelection();
    const candidateNodes = [
      selection?.anchorNode,
      selection?.focusNode,
      selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null,
    ];

    for (let idx = 0; idx < candidateNodes.length; idx += 1) {
      const node = candidateNodes[idx];
      const element = node instanceof HTMLElement ? node : node?.parentElement;
      const editableElement = element?.closest('.annotation-inline-editable');
      if (editableElement instanceof HTMLElement) {
        const elementRef = store.ensureElementRef(editableElement);
        annotationUI.inlineActiveElementRef = elementRef;
        return elementRef;
      }
    }

    return '';
  }

  function handleInlineToolbarClick(event) {
    if (!annotationUI.inlineMode) return;
    const button = event.target instanceof HTMLElement
      ? event.target.closest('button[data-action]')
      : null;
    if (!(button instanceof HTMLButtonElement)) return;
    if (!button.closest('.medium-editor-toolbar')) return;

    const action = `${button.getAttribute('data-action') || ''}`.trim();
    if (!EXPLICIT_FORMATTING_TOOLBAR_ACTIONS.has(action)) return;

    const activeElementRef = getActiveInlineEditableElementRef();
    if (!activeElementRef) return;
    markInlineElementAsFormattingIntent(activeElementRef);
  }

  function attachInlineToolbarTracking() {
    if (annotationUI.inlineToolbarClickHandler) return;
    annotationUI.inlineToolbarClickHandler = handleInlineToolbarClick;
    document.addEventListener('click', annotationUI.inlineToolbarClickHandler, true);
  }

  function detachInlineToolbarTracking() {
    if (!annotationUI.inlineToolbarClickHandler) return;
    document.removeEventListener('click', annotationUI.inlineToolbarClickHandler, true);
    annotationUI.inlineToolbarClickHandler = null;
  }

  async function trackInlineEditChange(element) {
    if (!(element instanceof HTMLElement) || !annotationUI.mainEl) return;
    const elementRef = store.ensureElementRef(element);
    const snapshot = annotationUI.inlineElementSnapshot.get(elementRef);
    if (!snapshot) return;

    const currentHtml = normalizeInlineFormattingHtml(element.innerHTML);
    const currentText = element.textContent || '';
    const didTextChange = currentText.trim() !== snapshot.originalText.trim();
    const didHtmlChange = currentHtml !== snapshot.originalHtml;
    if (!didTextChange && !didHtmlChange) return;
    const hasExplicitFormattingIntent = annotationState.explicitFormattingElementRefs
      .has(elementRef);
    if (!didTextChange && didHtmlChange && !hasExplicitFormattingIntent) {
      return;
    }

    const editAnchor = store.buildEditElementAnchor(element, annotationUI.mainEl);
    const easyEditElementPath = editAnchor.elementPath;
    const existing = store.getEasyEditByElement(
      elementRef,
      easyEditElementPath,
      editAnchor.elementProps,
    );
    if (existing
      && currentText.trim() === `${existing.to || ''}`.trim()
      && currentHtml === `${existing.toHtml || ''}`) {
      return;
    }
    const stampedOriginal = store.getEasyEditOriginalForElement(element);
    const baselineText = existing?.from ?? stampedOriginal?.from ?? snapshot.originalText;
    const baselineHtml = existing?.fromHtml ?? stampedOriginal?.fromHtml ?? snapshot.originalHtml;
    const segments = store.getChangedSegments(baselineText, currentText);
    const editRecord = {
      id: existing?.id || store.generateId('easy-edit'),
      editType: 'text',
      attrName: '',
      elementPath: easyEditElementPath,
      elementProps: editAnchor.elementProps,
      elementRef,
      from: baselineText,
      to: currentText,
      fromHtml: baselineHtml,
      toHtml: currentHtml,
      changedFrom: segments.changedFrom,
      changedTo: segments.changedTo,
      updatedAt: new Date().toISOString(),
    };

    const persistedEdit = store.upsertEasyEdit(editRecord);
    const editThread = store.getEditThreadByElementPath(
      persistedEdit?.elementPath,
      persistedEdit?.elementProps,
    );
    if (editThread) {
      annotationState.activeThreadId = editThread.id;
      annotationState.activeMessageId = '';
      annotationState.activeEditId = '';
    }
    store.saveAnnotationStore();
    renderThreadMarkers({ resolveTargets: true });
    renderCommentsPanel();

    clearExplicitFormattingIntent(elementRef);
  }

  function getSelectedImageForMediumEditor() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const candidateNodes = [
      selection.anchorNode,
      selection.focusNode,
      range.commonAncestorContainer,
    ];

    for (let idx = 0; idx < candidateNodes.length; idx += 1) {
      const node = candidateNodes[idx];
      if (node instanceof HTMLImageElement) {
        if (!isInsideStreamFragment(node) && !isInsideManagedMetadataBlock(node)) return node;
      }
      if (node instanceof Element || node?.parentElement instanceof HTMLElement) {
        const element = node instanceof HTMLElement ? node : node?.parentElement;
        const img = element?.closest('img');
        if (img instanceof HTMLImageElement
          && !isInsideStreamFragment(img)
          && !isInsideManagedMetadataBlock(img)) return img;
      }
    }
    return null;
  }

  function closeInlineAltPopup() {
    if (annotationUI.inlineAltOutsideClickHandler) {
      document.removeEventListener('click', annotationUI.inlineAltOutsideClickHandler, true);
      annotationUI.inlineAltOutsideClickHandler = null;
    }
    if (annotationUI.inlineAltPopupEl) {
      annotationUI.inlineAltPopupEl.remove();
      annotationUI.inlineAltPopupEl = null;
    }
  }

  async function persistSingleImageAltChange(imageElement) {
    if (!(imageElement instanceof HTMLImageElement) || !annotationUI.mainEl) return;
    if (isInsideStreamFragment(imageElement)) return;
    if (isInsideManagedMetadataBlock(imageElement)) return;

    const elementRef = store.ensureElementRef(imageElement);
    const editAnchor = store.buildEditElementAnchor(imageElement, annotationUI.mainEl);
    const easyEditElementPath = editAnchor.elementPath;
    const snapshotAlt = annotationUI.inlineImageAltSnapshot.get(elementRef);
    const originalAlt = snapshotAlt !== undefined ? `${snapshotAlt}` : (imageElement.getAttribute('alt') || '');
    const currentAlt = `${imageElement.getAttribute('alt') || ''}`;
    if (originalAlt === currentAlt) return;

    const existing = store.getEasyEditByElement(
      elementRef,
      easyEditElementPath,
      editAnchor.elementProps,
    );
    const editRecord = {
      id: existing?.id || store.generateId('easy-edit'),
      editType: 'image-alt',
      attrName: 'alt',
      elementPath: easyEditElementPath,
      elementProps: editAnchor.elementProps,
      elementRef,
      from: originalAlt,
      to: currentAlt,
      fromHtml: '',
      toHtml: '',
      changedFrom: originalAlt,
      changedTo: currentAlt,
      updatedAt: new Date().toISOString(),
    };
    const persistedEdit = store.upsertEasyEdit(editRecord);
    annotationUI.inlineImageAltSnapshot.set(elementRef, currentAlt);
    const editThread = store.getEditThreadByElementPath(
      persistedEdit?.elementPath,
      persistedEdit?.elementProps,
    );
    if (editThread) {
      annotationState.activeThreadId = editThread.id;
      annotationState.activeMessageId = '';
      annotationState.activeEditId = '';
    }
    store.saveAnnotationStore();
    renderThreadMarkers({ resolveTargets: true });
    renderCommentsPanel();
  }

  function openInlineAltPopup(imageElement) {
    if (!(imageElement instanceof HTMLImageElement)) return;
    if (isInsideStreamFragment(imageElement)) return;
    if (isInsideManagedMetadataBlock(imageElement)) return;
    closeInlineAltPopup();

    const popup = document.createElement('div');
    popup.className = 'annotation-inline-alt-popup';
    popup.innerHTML = `
      <div class="annotation-inline-alt-popup__header">
        <h4>Edit image alt text</h4>
        <button type="button" class="annotation-inline-alt-popup__close" data-action="close" aria-label="Close">x</button>
      </div>
      <textarea class="annotation-inline-alt-popup__input" data-input="alt" placeholder="Describe the image for accessibility..."></textarea>
      <div class="annotation-inline-alt-popup__actions">
        <button type="button" class="annotation-inline-alt-popup__btn" data-action="cancel">Cancel</button>
        <button type="button" class="annotation-inline-alt-popup__btn annotation-inline-alt-popup__btn--primary" data-action="save">Save</button>
      </div>
    `;
    document.body.appendChild(popup);
    annotationUI.inlineAltPopupEl = popup;

    const rect = imageElement.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    let top = rect.bottom + 10;
    let { left } = rect;
    if (top + popupRect.height > window.innerHeight - 20) {
      top = Math.max(10, rect.top - popupRect.height - 10);
    }
    if (left + popupRect.width > window.innerWidth - 20) {
      left = window.innerWidth - popupRect.width - 20;
    }
    popup.style.top = `${top}px`;
    popup.style.left = `${Math.max(10, left)}px`;

    const input = popup.querySelector('[data-input="alt"]');
    if (input instanceof HTMLTextAreaElement) {
      input.value = imageElement.getAttribute('alt') || '';
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeInlineAltPopup();
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          imageElement.setAttribute('alt', input.value.trim());
          persistSingleImageAltChange(imageElement);
          closeInlineAltPopup();
        }
      });
    }

    popup.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.getAttribute('data-action');
      if (!action) return;
      if (action === 'close' || action === 'cancel') {
        closeInlineAltPopup();
        return;
      }
      if (action === 'save') {
        const textArea = popup.querySelector('[data-input="alt"]');
        if (textArea instanceof HTMLTextAreaElement) {
          imageElement.setAttribute('alt', textArea.value.trim());
          persistSingleImageAltChange(imageElement);
        }
        closeInlineAltPopup();
      }
    });

    annotationUI.inlineAltOutsideClickHandler = (event) => {
      const { target } = event;
      if (!(target instanceof HTMLElement)) return;
      if (popup.contains(target)) return;
      closeInlineAltPopup();
    };
    window.setTimeout(() => {
      if (annotationUI.inlineAltOutsideClickHandler) {
        document.addEventListener('click', annotationUI.inlineAltOutsideClickHandler, true);
      }
    }, 0);
  }

  function attachInlineImageSelectionHandler() {
    if (!annotationUI.mainEl || annotationUI.inlineImageSelectHandler) return;
    annotationUI.inlineImageSelectHandler = (event) => {
      if (!annotationUI.inlineMode) return;
      const { target } = event;
      if (!(target instanceof HTMLImageElement)) return;
      if (isInsideStreamFragment(target)) return;
      annotationUI.inlineSelectedImageEl = target;
      openInlineAltPopup(target);
    };
    annotationUI.mainEl.addEventListener('click', annotationUI.inlineImageSelectHandler, true);
  }

  function detachInlineImageSelectionHandler() {
    if (!annotationUI.mainEl || !annotationUI.inlineImageSelectHandler) return;
    annotationUI.mainEl.removeEventListener('click', annotationUI.inlineImageSelectHandler, true);
    annotationUI.inlineImageSelectHandler = null;
    annotationUI.inlineSelectedImageEl = null;
  }

  function createMediumEditorImageAltExtension() {
    if (!window.MediumEditor?.extensions?.button) return null;
    const ButtonExtension = window.MediumEditor.extensions.button.extend({
      name: 'imageAlt',
      action: 'imageAlt',
      aria: 'Edit image alt text',
      contentDefault: 'ALT',
      contentFA: '<i>ALT</i>',
      init() {
        this.button = this.createButton();
        this.on(this.button, 'click', this.handleClick.bind(this));
      },
      getButton() {
        return this.button;
      },
      handleClick(event) {
        event.preventDefault();
        event.stopPropagation();
        const imageElement = getSelectedImageForMediumEditor()
          || annotationUI.inlineSelectedImageEl;
        if (!(imageElement instanceof HTMLImageElement)) return;
        if (isInsideStreamFragment(imageElement)) return;
        openInlineAltPopup(imageElement);
      },
    });
    return new ButtonExtension();
  }

  function createMediumEditorInstance(elements) {
    if (!window.MediumEditor || !elements.length) return null;
    const imageAltExtension = createMediumEditorImageAltExtension();
    const toolbarButtons = ['bold', 'italic', 'underline', 'anchor', 'h2', 'h3', 'quote'];
    if (imageAltExtension) toolbarButtons.push('imageAlt');
    return new window.MediumEditor(elements, {
      toolbar: {
        buttons: toolbarButtons,
      },
      extensions: imageAltExtension ? { imageAlt: imageAltExtension } : {},
      placeholder: {
        text: 'Click to edit...',
        hideOnClick: true,
      },
      targetBlank: true,
      autoLink: true,
      paste: {
        cleanPastedHTML: true,
        cleanAttrs: ['style', 'dir'],
        cleanTags: ['label', 'meta', 'script', 'style'],
      },
    });
  }

  async function syncImageAltChanges() {
    if (!annotationUI.mainEl) return;
    const pendingUpdates = annotationUI.editableImages
      .filter((imageElement) => imageElement instanceof HTMLImageElement)
      .map(async (imageElement) => {
        const elementRef = store.ensureElementRef(imageElement);
        const editAnchor = store.buildEditElementAnchor(imageElement, annotationUI.mainEl);
        const easyEditElementPath = editAnchor.elementPath;
        const snapshotAlt = annotationUI.inlineImageAltSnapshot.get(elementRef);
        const originalAlt = snapshotAlt !== undefined
          ? `${snapshotAlt}`
          : (imageElement.getAttribute('alt') || '');
        const currentAlt = `${imageElement.getAttribute('alt') || ''}`;
        if (originalAlt === currentAlt) return;

        const existing = store.getEasyEditByElement(
          elementRef,
          easyEditElementPath,
          editAnchor.elementProps,
        );
        const editRecord = {
          id: existing?.id || store.generateId('easy-edit'),
          editType: 'image-alt',
          attrName: 'alt',
          elementPath: easyEditElementPath,
          elementProps: editAnchor.elementProps,
          elementRef,
          from: originalAlt,
          to: currentAlt,
          fromHtml: '',
          toHtml: '',
          changedFrom: originalAlt,
          changedTo: currentAlt,
          updatedAt: new Date().toISOString(),
        };
        store.upsertEasyEdit(editRecord);
        annotationUI.inlineImageAltSnapshot.set(elementRef, currentAlt);
      });

    await Promise.all(pendingUpdates);
  }

  function resetInlineEditModeState() {
    annotationUI.inlineMode = false;
    document.body.classList.remove('annotation-inline-edit-mode');
    detachInlineToolbarTracking();

    if (annotationUI.mediumEditorInstance) {
      annotationUI.mediumEditorInstance.destroy();
      annotationUI.mediumEditorInstance = null;
    }

    annotationUI.editableElements.forEach((element) => {
      const elementRef = element.dataset.annotationRef;
      const focusHandler = elementRef ? annotationUI.inlineFocusHandlers.get(elementRef) : null;
      const handler = elementRef ? annotationUI.inlineBlurHandlers.get(elementRef) : null;
      if (focusHandler) {
        element.removeEventListener('focus', focusHandler, true);
        element.removeEventListener('click', focusHandler, true);
        annotationUI.inlineFocusHandlers.delete(elementRef);
      }
      if (handler) {
        element.removeEventListener('blur', handler, true);
        annotationUI.inlineBlurHandlers.delete(elementRef);
      }
      element.classList.remove('annotation-inline-editable');
    });
    annotationUI.editableElements = [];

    annotationUI.editableImages.forEach((imageElement) => {
      imageElement.classList.remove('annotation-inline-editable-image');
    });
    annotationUI.editableImages = [];
    annotationUI.inlineElementSnapshot.clear();
    annotationUI.inlineImageAltSnapshot.clear();
    annotationUI.inlineActiveElementRef = '';
    annotationState.explicitFormattingElementRefs.clear();
    detachInlineImageSelectionHandler();
    closeInlineAltPopup();
  }

  async function enableInlineEditMode() {
    if (!annotationUI.mainEl || annotationUI.inlineMode) return false;
    if (!isInlineEditingAllowed()) {
      showGlobalSnackbar(ANNOTATION_MESSAGES.inlineEditRestrictedSnackbar);
      return false;
    }
    if (!annotationService.isAvailable()) {
      showGlobalSnackbar(ANNOTATION_MESSAGES.collabUnavailableSnackbar);
      return false;
    }
    await loadMediumEditor();
    annotationUI.inlineMode = true;
    document.body.classList.add('annotation-inline-edit-mode');
    removePopup();
    store.clearSelectedElement();
    store.removeEasyEditHighlights(annotationUI.mainEl);

    annotationUI.editableElements = getInlineEditableElements();
    annotationUI.editableImages = getInlineEditableImages();
    annotationUI.mediumEditorInstance = createMediumEditorInstance(annotationUI.editableElements);
    attachInlineToolbarTracking();
    attachInlineImageSelectionHandler();

    annotationUI.editableElements.forEach((element) => {
      const elementRef = store.ensureElementRef(element);
      annotationUI.inlineElementSnapshot.set(elementRef, {
        originalHtml: normalizeInlineFormattingHtml(element.innerHTML),
        originalText: element.textContent || '',
      });
      element.classList.add('annotation-inline-editable');
      const blurHandler = () => {
        trackInlineEditChange(element);
      };
      const focusHandler = () => {
        setActiveInlineEditableElement(element);
      };
      annotationUI.inlineBlurHandlers.set(elementRef, blurHandler);
      annotationUI.inlineFocusHandlers.set(elementRef, focusHandler);
      element.addEventListener('blur', blurHandler, true);
      element.addEventListener('focus', focusHandler, true);
      element.addEventListener('click', focusHandler, true);
    });

    annotationUI.editableImages.forEach((imageElement) => {
      const elementRef = store.ensureElementRef(imageElement);
      annotationUI.inlineImageAltSnapshot.set(elementRef, imageElement.getAttribute('alt') || '');
      imageElement.classList.add('annotation-inline-editable-image');
    });

    renderThreadMarkers();
    renderCommentsPanel();
    return true;
  }

  async function disableInlineEditMode() {
    if (!annotationUI.inlineMode) return;

    await Promise.all(
      annotationUI.editableElements.map((element) => trackInlineEditChange(element)),
    );
    await syncImageAltChanges();
    store.saveAnnotationStore();

    resetInlineEditModeState();
    store.applyEasyEditsToDom();
    renderThreadMarkers();
    renderCommentsPanel();
  }

  async function syncInlineEditsBeforePersist() {
    if (!annotationUI.inlineMode) return;
    await Promise.all(
      annotationUI.editableElements.map((element) => trackInlineEditChange(element)),
    );
    await syncImageAltChanges();
    store.saveAnnotationStore();
  }

  function registerNewEditableElement(element) {
    if (!annotationUI.inlineMode || !annotationUI.mediumEditorInstance) return;
    if (!(element instanceof HTMLElement) || isInsideStreamFragment(element)) return;
    // Managed metadata blocks have their own block-level recorder; never wire
    // metadata descendants into the inline text-edit pipeline.
    if (isInsideManagedMetadataBlock(element)) return;
    const elementRef = store.ensureElementRef(element);
    annotationUI.editableElements.push(element);
    annotationUI.inlineElementSnapshot.set(elementRef, {
      originalHtml: normalizeInlineFormattingHtml(element.innerHTML),
      originalText: element.textContent || '',
    });
    element.classList.add('annotation-inline-editable');
    const blurHandler = () => { trackInlineEditChange(element); };
    const focusHandler = () => { setActiveInlineEditableElement(element); };
    annotationUI.inlineBlurHandlers.set(elementRef, blurHandler);
    annotationUI.inlineFocusHandlers.set(elementRef, focusHandler);
    element.addEventListener('blur', blurHandler, true);
    element.addEventListener('focus', focusHandler, true);
    element.addEventListener('click', focusHandler, true);
    annotationUI.mediumEditorInstance.addElements([element]);
  }

  return {
    disableInlineEditMode,
    enableInlineEditMode,
    registerNewEditableElement,
    resetInlineEditModeState,
    syncInlineEditsBeforePersist,
  };
}
