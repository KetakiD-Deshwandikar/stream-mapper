/* eslint-disable no-restricted-syntax */
import { registerManagedMetadataBlock } from './store.js';
import { sanitizeMetadataBlockHtml } from './metadata-sanitize.js';

/**
 *
 *
 * Renders a "Page Metadata"-style box under the main element, captures a
 * single baseline `fromHtml` per block at mount time, and records every user
 * change (add row, inline edit, delete row) as a NEW `editType: 'metadata-block'`
 * easyEdit whose `toHtml` is the current full block innerHTML (cumulative).
 *
 * Generic on `blockClass` / `blockSelector` so the same code path serves
 * `page-metadata` today and `card-metadata` with minimal changes tomorrow.
 *
 * Save semantics: collapse-to-last is applied in `saveAnnotationChanges`,
 * not here. We append every in-session change so the panel can render each
 * one as a card with its own discard button.
 *
 * Push semantics: live DOM is the source of truth on push — `applyEasyEditsToDom`
 * writes the last metadata-block edit's `toHtml` into `.{blockClass}` before
 * `buildHtmlWithEditsAndAssets` materializes DA-compatible HTML.
 */
export default function createMetadataPanelController({ store }) {
  // Per-mount runtime state (panel → block element + observers + recorder).
  const mounts = new Map();

  function buildBlockSelector(blockClass) {
    return `main .${blockClass}`;
  }

  function makeRowTrashButton(rowEl, onDelete) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stream-annotation-metadata-row-delete';
    btn.title = 'Remove row';
    btn.setAttribute('aria-label', 'Remove metadata row');
    btn.textContent = '×';
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (!rowEl.parentElement) return;
      rowEl.remove();
      onDelete();
    });
    return btn;
  }

  function attachRowTrashButtons(blockEl, onDelete) {
    // Top-level row = direct child div of the metadata block.
    const rows = Array.from(blockEl.children).filter(
      (child) => child instanceof HTMLElement && child.tagName === 'DIV',
    );
    rows.forEach((rowEl) => {
      if (rowEl.querySelector(':scope > .stream-annotation-metadata-row-delete')) return;
      const trash = makeRowTrashButton(rowEl, onDelete);
      rowEl.appendChild(trash);
    });
  }

  function setRowsContentEditable(blockEl, isEditable) {
    const ps = blockEl.querySelectorAll('p');
    ps.forEach((p) => {
      if (isEditable) p.setAttribute('contenteditable', 'true');
      else p.removeAttribute('contenteditable');
    });
  }

  function ensureInlineModeWiring(blockEl) {
    // Reflect annotation-inline-edit-mode body class on contenteditable of rows
    // so users can edit only when the rest of the page is in inline-edit mode.
    const sync = () => {
      const isInlineMode = document.body.classList.contains('annotation-inline-edit-mode');
      setRowsContentEditable(blockEl, isInlineMode);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return observer;
  }

  /**
   * Mount the metadata panel for a given metadata block.
   *
   * @param {HTMLElement} mainEl  — the <main> element on the page.
   * @param {object}      options
   * @param {string}      options.blockClass   — e.g. 'page-metadata' or 'card-metadata'.
   * @param {string}      [options.title]      — heading text (defaults to readable blockClass).
   * @param {HTMLElement} [options.blockEl]    — pre-existing block element to manage; if
   *                                             omitted, the helper queries `main .{blockClass}`.
   * @param {Array<{label:string, html:string}>} [options.addRowConfigs]
   *                                           — buttons + row HTML for "+ Add ... row".
   * @returns {{ blockSelector: string, blockEl: HTMLElement } | null}
   */
  function getSanitizedBlockHtml(blockEl) {
    return sanitizeMetadataBlockHtml(blockEl);
  }

  function tearDownPreviousMount(blockSelector) {
    const previous = mounts.get(blockSelector);
    if (!previous) return;
    previous.blockObserver?.disconnect();
    previous.bodyClassObserver?.disconnect();
    if (previous.sectionWrapper?.isConnected) {
      // The blockEl lives inside sectionWrapper; the caller has already
      // captured its reference (or will re-query) so detaching is safe.
      previous.sectionWrapper.remove();
    }
    mounts.delete(blockSelector);
  }

  function mountMetadataPanel(mainEl, options = {}) {
    if (!(mainEl instanceof HTMLElement)) return null;
    const blockClass = `${options.blockClass || ''}`.trim();
    if (!blockClass) return null;

    const blockSelector = buildBlockSelector(blockClass);

    // Capture blockEl reference BEFORE teardown — if a previous mount placed
    // blockEl inside its sectionWrapper, teardown will detach blockEl from DOM,
    // and we re-attach it inside the new wrapper below (preserves user content).
    const blockEl = options.blockEl instanceof HTMLElement
      ? options.blockEl
      : (document.body.querySelector(blockSelector) || document.body.querySelector(`.${blockClass}`));
    if (!(blockEl instanceof HTMLElement)) return null;

    tearDownPreviousMount(blockSelector);

    // Track as a managed metadata block so inline-text/image recorders skip
    // anything inside it (single source of truth: metadata-block recorder).
    registerManagedMetadataBlock(blockSelector);

    // Capture baseline ONCE per session. If a prior save exists for this block,
    // the helper prefers that edit's fromHtml as the canonical baseline. The
    // baseline is sanitized so it never carries annotation-only chrome.
    store.captureMetadataBlockBaselineOnce(blockSelector, getSanitizedBlockHtml(blockEl));

    // Per-mount state — referenced by the observers and discard re-apply
    // so all of them operate on the same recorder.
    const mountRecord = {
      blockEl,
      sectionWrapper: null,
      blockObserver: null,
      bodyClassObserver: null,
      recordNow: null,
    };

    const recordNow = () => {
      const currentToHtml = getSanitizedBlockHtml(blockEl);
      const baselineFromHtml = store.getMetadataBlockBaseline(blockSelector);
      store.appendMetadataBlockEdit({
        blockClass,
        blockSelector,
        fromHtml: baselineFromHtml,
        toHtml: currentToHtml,
      });
      store.saveAnnotationStore();
    };
    mountRecord.recordNow = recordNow;

    // Build section wrapper around the block: <section><h3/><block/><actions/></section>
    const title = `${options.title
      || blockClass.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`.trim();
    const sectionWrapper = document.createElement('div');
    sectionWrapper.classList.add('section', `stream-annotation-${blockClass}`);
    const heading = document.createElement('h3');
    heading.textContent = title;
    sectionWrapper.append(heading);
    sectionWrapper.append(blockEl);
    mountRecord.sectionWrapper = sectionWrapper;

    // Row delete trash buttons on existing rows.
    attachRowTrashButtons(blockEl, recordNow);

    // Inline edit wiring — rows become contenteditable only in inline-edit mode.
    mountRecord.bodyClassObserver = ensureInlineModeWiring(blockEl);

    // Mutation observer on the block — any structural change (row add/remove)
    // or text change inside contenteditable immediately records a new edit,
    // matching the senior's "every change → new edit" model.
    // Also re-syncs contenteditable on new rows so they are editable when
    // inline edit mode is already active at the time a row is added.
    mountRecord.blockObserver = new MutationObserver(() => {
      attachRowTrashButtons(blockEl, recordNow);
      setRowsContentEditable(blockEl, document.body.classList.contains('annotation-inline-edit-mode'));
      recordNow();
    });
    mountRecord.blockObserver.observe(blockEl, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: false,
    });

    // Add-row buttons (default: text/link + image), invoked by ticket On Edit flow.
    const addRowConfigs = Array.isArray(options.addRowConfigs) && options.addRowConfigs.length
      ? options.addRowConfigs
      : [
        {
          label: '+ Add text/link row',
          html: '<div><p>add metadata key</p></div><div><p>add text or link value</p></div>',
        },
        {
          label: '+ Add image row',
          html: '<div><p>key</p></div><div><picture><img src="https://main--stream-mapper--adobecom.aem.live/assets/media_1bf6f8fe5a340bb3f4e022b300d7013821fe5ff89.png"></picture></div>',
        },
      ];
    const actions = document.createElement('div');
    actions.className = 'stream-annotation-metadata-actions';
    addRowConfigs.forEach((cfg) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stream-annotation-add-metadata-row';
      btn.textContent = cfg.label;
      btn.addEventListener('click', () => {
        const row = document.createElement('div');
        row.innerHTML = cfg.html;
        blockEl.append(row);
        // Mutation observer above captures this and records a new edit.
      });
      actions.appendChild(btn);
    });
    sectionWrapper.append(actions);
    mainEl.append(sectionWrapper);

    mounts.set(blockSelector, mountRecord);

    return { blockSelector, blockEl };
  }

  /**
   * Re-apply the current saved state of a metadata block to the DOM (used after
   * a discard pops an edit). If no metadata-block edits remain for the block,
   * the baseline `fromHtml` is restored.
   */
  function reapplyMetadataBlockToDom(blockSelector) {
    const key = `${blockSelector || ''}`.trim();
    if (!key) return;
    let blockEl = null;
    try {
      blockEl = document.querySelector(key);
    } catch (error) {
      blockEl = null;
    }
    if (!(blockEl instanceof HTMLElement)) return;

    const lastEdit = store.getLastMetadataBlockEdit(key);
    const targetHtml = lastEdit
      ? `${lastEdit.toHtml || ''}`
      : store.getMetadataBlockBaseline(key);

    // Temporarily disconnect the observer so the re-apply doesn't trigger
    // another edit append for the restored state.
    const mount = mounts.get(key);
    if (mount?.blockObserver) mount.blockObserver.disconnect();
    blockEl.innerHTML = targetHtml;
    if (mount) {
      // Re-attach trash buttons (they were stripped when we set sanitized HTML)
      // and reconnect the observer on the same element.
      attachRowTrashButtons(blockEl, mount.recordNow);
      if (mount.blockObserver) {
        mount.blockObserver.observe(blockEl, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: false,
        });
      }
    }
  }

  /**
   * Discard a single metadata-block edit by id and re-apply the remaining
   * state (per the ticket "Give a discard option to remove the unsaved edits").
   */
  function discardMetadataEdit(editId) {
    const removed = store.removeEasyEditById(editId);
    if (!removed) return;
    const blockSelector = `${removed.blockSelector || ''}`.trim();
    if (!blockSelector) return;
    reapplyMetadataBlockToDom(blockSelector);
    store.saveAnnotationStore();
  }

  return {
    mountMetadataPanel,
    discardMetadataEdit,
    reapplyMetadataBlockToDom,
  };
}
