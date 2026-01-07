/**
 * E2E Test DOM Inspection Helpers
 *
 * These utilities enable programmatic debugging and selector discovery,
 * reducing reliance on visual inspection for test development and debugging.
 */

import { Page } from '@playwright/test';

/**
 * Finds the most likely intended element containing the expected text,
 * filtering out navigation and UI elements.
 */
export async function findActualSelector(page: Page, expectedText: string) {
  const elements = await page.locator(`text=/${expectedText}/i`).all();

  console.log(`🔍 Found ${elements.length} elements containing "${expectedText}"`);

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const rect = await el.boundingBox();
    const tag = await el.evaluate(el => el.tagName);
    const text = await el.textContent();
    const classes = await el.getAttribute('class') || '';

    // Filter out obvious navigation/UI elements
    const isNavigation = text?.includes('📅') || text?.includes('👥') ||
                        text?.includes('🏥') || text?.includes('👤') ||
                        text?.includes('登出') || text?.includes('開啟主選單');

    const isHeader = rect && rect.y < 100; // Above main content area
    const isUIControl = classes.includes('absolute') || classes.includes('fixed') ||
                       tag === 'BUTTON' && text?.length < 3; // Short button text

    if (!isNavigation && !isHeader && !isUIControl) {
      console.log(`✅ Selected element ${i}: ${tag} "${text?.substring(0, 50)}..."`);
      return el;
    } else {
      console.log(`❌ Filtered out element ${i}: ${tag} "${text?.substring(0, 30)}..." (${isNavigation ? 'nav' : isHeader ? 'header' : 'ui'})`);
    }
  }

  console.log(`❌ No suitable element found for "${expectedText}"`);
  return null;
}

/**
 * Analyzes the structure of a select dropdown for debugging purposes.
 */
export async function analyzeDropdownStructure(page: Page, testId: string) {
  const result = await page.evaluate((testId) => {
    const select = document.querySelector(`[data-testid="${testId}"]`) as HTMLSelectElement;
    if (!select) {
      return { error: 'Select element not found', testId };
    }

    const rect = select.getBoundingClientRect();
    const options = Array.from(select.options).map((opt, index) => ({
      index,
      text: opt.textContent?.trim(),
      value: opt.value,
      disabled: opt.disabled,
      selected: opt.selected
    }));

    return {
      testId,
      tagName: select.tagName,
      type: select.type,
      disabled: select.disabled,
      required: select.required,
      value: select.value,
      position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      options: options,
      optionsCount: options.length,
      visibleOptionsCount: options.filter(opt => !opt.disabled).length,
      hasPlaceholder: options.length > 0 && options[0].value === '',
      timestamp: new Date().toISOString()
    };
  }, testId);

  console.log(`🔍 Dropdown analysis for "${testId}":`, {
    found: !result.error,
    optionsCount: result.optionsCount || 0,
    visibleOptions: result.visibleOptionsCount || 0,
    hasPlaceholder: result.hasPlaceholder,
    disabled: result.disabled,
    currentValue: result.value
  });

  if (result.options) {
    console.log('📋 Available options:');
    result.options.forEach((opt: any, index: number) => {
      const marker = opt.selected ? '✅' : opt.disabled ? '🚫' : '⚪';
      console.log(`  ${marker} ${index}: "${opt.text}" (${opt.value})`);
    });
  }

  return result;
}

/**
 * Waits for a dropdown to have loaded options and validates the structure.
 */
export async function waitForDropdownReady(page: Page, testId: string, minOptions = 1) {
  console.log(`⏳ Waiting for dropdown "${testId}" to be ready...`);

  await page.waitForFunction((args) => {
    const { testId, minOptions } = args;
    const select = document.querySelector(`[data-testid="${testId}"]`) as HTMLSelectElement;
    return select && !select.disabled && select.options.length >= minOptions;
  }, { testId, minOptions }, { timeout: 10000 });

  console.log(`✅ Dropdown "${testId}" is ready`);
  return await analyzeDropdownStructure(page, testId);
}

/**
 * Enhanced test failure messages for selector issues.
 */
export async function createSelectorError(page: Page, selector: string, expectedText?: string) {
  const errorInfo = {
    selector,
    expectedText,
    pageUrl: page.url(),
    timestamp: new Date().toISOString()
  };

  // Try to find similar elements
  if (expectedText) {
    const similarElements = await page.locator(`text=/${expectedText}/i`).all();
    errorInfo.similarElements = await Promise.all(
      similarElements.slice(0, 5).map(async (el, index) => ({
        index,
        tag: await el.evaluate(el => el.tagName),
        text: await el.textContent(),
        visible: await el.isVisible()
      }))
    );
  }

  return errorInfo;
}
