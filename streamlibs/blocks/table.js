import {
  handleSpacer,
  handleBackgroundWithSectionMetadata,
} from '../components/components.js';

const DEFAULT_URL = 'https://www.adobe.com/';

function handleVariants(blockContent, properties) {
  if (properties?.colorTheme) blockContent.classList.add(properties.colorTheme);
  if (properties?.topSpacer) handleSpacer(blockContent, properties.topSpacer.name, 'top');
  if (properties?.bottomSpacer) handleSpacer(blockContent, properties.bottomSpacer.name, 'bottom');
}

function createHeaderColumn(columnHeading, offerCell, productTileCell, columnTemplate) {
  const colEl = columnTemplate.cloneNode(true);
  colEl.innerHTML = '';

  // Only render an icon when it resolved to a real URL. A bare Figma imageRef
  // hash (unresolved, or vector icons that have no raster imageRef at all)
  // must never become an <img src> — that produces a broken image.
  const tileImage = productTileCell?.productTileImage;
  if (typeof tileImage === 'string' && /^https?:\/\//.test(tileImage)) {
    const iconP = document.createElement('p');
    const img = document.createElement('img');
    img.src = tileImage;
    img.alt = columnHeading?.heading || '';
    iconP.appendChild(img);
    colEl.appendChild(iconP);
  }

  if (columnHeading?.heading) {
    const headingP = document.createElement('p');
    headingP.textContent = columnHeading.heading;
    colEl.appendChild(headingP);
  }

  if (columnHeading?.hasBody && columnHeading?.body) {
    const bodyP = document.createElement('p');
    bodyP.textContent = columnHeading.body;
    colEl.appendChild(bodyP);
  }

  if (offerCell?.price) {
    const pricingP = document.createElement('p');
    pricingP.textContent = offerCell.price;
    colEl.appendChild(pricingP);
  }

  if (offerCell?.detail) {
    const detailP = document.createElement('p');
    detailP.textContent = offerCell.detail;
    colEl.appendChild(detailP);
  }

  if (offerCell?.hasPriorPrice && offerCell?.priorPrice) {
    const priorPriceP = document.createElement('p');
    priorPriceP.innerHTML = `<s>${offerCell.priorPrice}</s>`;
    colEl.appendChild(priorPriceP);
  }

  if (offerCell?.hasAction || offerCell?.hasAction2) {
    const ctaP = document.createElement('p');
    if (offerCell?.hasAction) {
      ctaP.innerHTML += `<em><a href="${DEFAULT_URL}">Free trial</a></em>`;
    }
    if (offerCell?.hasAction2) {
      ctaP.innerHTML += `<strong><a href="${DEFAULT_URL}">Buy now</a></strong>`;
    }
    colEl.appendChild(ctaP);
  }

  return colEl;
}

function createDataCell(cell, cellTemplate) {
  const cellEl = cellTemplate.cloneNode(true);
  cellEl.innerHTML = '';

  switch (cell?.cellType) {
    case 'checkmark':
      if (cell.hasCheckmark) {
        cellEl.innerHTML = '✓';
        if (cell.hasText && cell.text) {
          cellEl.innerHTML += ` ${cell.text}`;
        }
      }
      break;
    case 'workflow':
      if (cell.hasWorkflowIcon) {
        cellEl.innerHTML = `⚡ ${cell.text || ''}`;
      } else {
        cellEl.textContent = cell.text || '';
      }
      break;
    case 'app':
      cellEl.textContent = cell.text || '';
      break;
    case 'longtext':
      cellEl.textContent = cell.text || '';
      break;
    case 'text':
    default:
      cellEl.textContent = cell.text || '';
      if (cell.description) {
        const descP = document.createElement('p');
        descP.textContent = cell.description;
        cellEl.appendChild(descP);
      }
      break;
  }

  if (cell?.align) {
    cellEl.style.textAlign = cell.align;
  }

  return cellEl;
}

function createDataRow(row, rowTemplate, cellTemplate) {
  const rowEl = rowTemplate.cloneNode(true);
  rowEl.innerHTML = '';

  // Check if it's a section title row — prefer explicit flag, fall back to heuristics
  const isSectionTitle = row.isTitleRow
    || (row.treeView && row.treeView !== '')
    || (row.name && row.name.includes('Title'))
    || (row.cells && row.cells.length === 0);

  if (isSectionTitle) {
    // For section title rows, create only ONE cell with the heading
    const titleCell = document.createElement('div');
    titleCell.setAttribute('data-valign', 'middle');
    titleCell.innerHTML = `<strong>${row.heading || ''}</strong>`;
    rowEl.appendChild(titleCell);
  } else {
    // Regular data row - first cell is row heading
    const headingCell = document.createElement('div');
    headingCell.setAttribute('data-valign', 'middle');
    headingCell.innerHTML = `<strong>${row.heading || ''}</strong>`;
    rowEl.appendChild(headingCell);

    // Data cells
    if (row.cells && row.cells.length > 0) {
      row.cells.forEach((cell) => {
        const cellEl = createDataCell(cell, cellTemplate);
        rowEl.appendChild(cellEl);
      });
    }
  }

  return rowEl;
}

function buildHeaderRow(header, headerRowTemplate) {
  const headerRow = headerRowTemplate.cloneNode(true);
  const columnTemplate = headerRow.querySelector(':scope > div:last-child');
  const emptyFirstCell = headerRow.querySelector(':scope > div:first-child');

  headerRow.innerHTML = '';
  headerRow.appendChild(emptyFirstCell.cloneNode(true));

  const { columnHeadingCells = [], offerCells = [], productTileCells = [] } = header;

  columnHeadingCells.forEach((columnHeading, index) => {
    const offerCell = offerCells[index] || {};
    const productTileCell = productTileCells[index] || {};
    const colEl = createHeaderColumn(columnHeading, offerCell, productTileCell, columnTemplate);
    headerRow.appendChild(colEl);
  });

  return headerRow;
}

function buildDataRows(rows, dataRowTemplate) {
  const dataRows = [];
  const cellTemplate = dataRowTemplate.querySelector(':scope > div:last-child');

  rows.forEach((row) => {
    const rowEl = createDataRow(row, dataRowTemplate, cellTemplate);
    dataRows.push(rowEl);
  });

  return dataRows;
}

export default async function mapBlockContent(sectionWrapper, blockContent, figContent) {
  const properties = figContent?.details?.properties;
  if (!properties) return;

  if (!blockContent) {
    return;
  }

  try {
    const headerRowTemplate = blockContent.querySelector(':scope > div:first-child');
    const dataRowTemplate = blockContent.querySelector(':scope > div:last-child');

    if (!headerRowTemplate || !dataRowTemplate) {
      // eslint-disable-next-line no-console
      console.log('Table templates not found in blockContent');
      return;
    }

    blockContent.innerHTML = '';

    if (properties.hasHeader && properties.header) {
      const headerRow = buildHeaderRow(properties.header, headerRowTemplate);
      blockContent.appendChild(headerRow);
    }

    // Build data rows
    if (properties.rows && properties.rows.length > 0) {
      const dataRows = buildDataRows(properties.rows, dataRowTemplate);
      dataRows.forEach((rowEl) => {
        blockContent.appendChild(rowEl);
      });
    }
    handleVariants(blockContent, properties);
    if (properties.background) {
      handleBackgroundWithSectionMetadata(sectionWrapper, blockContent, properties.background);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(error);
  }
}
