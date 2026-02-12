import { test, expect } from '@playwright/test';

test.describe('Medical Record Template Preview', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to settings page and authenticate
    await page.goto('/settings');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test('should switch between edit and preview tabs', async ({ page }) => {
    // Navigate to medical record templates section
    await page.click('text=病例與表單');
    
    // Click create new template button
    await page.click('button:has-text("新增模板")');
    
    // Wait for modal to open
    await expect(page.locator('text=新增模板')).toBeVisible();
    
    // Verify we're on edit tab by default
    await expect(page.locator('button:has-text("編輯模板")[class*="primary"]')).toBeVisible();
    
    // Switch to preview tab
    await page.click('button:has-text("預覽表單")');
    
    // Verify preview tab is active
    await expect(page.locator('button:has-text("預覽表單")[class*="primary"]')).toBeVisible();
    
    // Verify empty state is shown
    await expect(page.locator('text=尚未新增欄位')).toBeVisible();
    
    // Switch back to edit tab
    await page.click('button:has-text("編輯模板")');
    
    // Verify edit tab is active again
    await expect(page.locator('button:has-text("編輯模板")[class*="primary"]')).toBeVisible();
  });

  test('should preview all field types correctly', async ({ page }) => {
    // Navigate to medical record templates section
    await page.click('text=病例與表單');
    
    // Click create new template button
    await page.click('button:has-text("新增模板")');
    
    // Fill in template name
    await page.fill('input[name="name"]', '測試模板');
    
    // Add text field
    await page.click('button:has-text("新增欄位")');
    await page.fill('input[name="fields.0.label"]', '姓名');
    await page.selectOption('select[name="fields.0.type"]', 'text');
    
    // Add dropdown field
    await page.click('button:has-text("新增欄位")');
    await page.fill('input[name="fields.1.label"]', '血型');
    await page.selectOption('select[name="fields.1.type"]', 'dropdown');
    await page.fill('textarea[name="fields.1.options"]', 'A型\nB型\nO型\nAB型');
    
    // Add checkbox field
    await page.click('button:has-text("新增欄位")');
    await page.fill('input[name="fields.2.label"]', '症狀');
    await page.selectOption('select[name="fields.2.type"]', 'checkbox');
    await page.fill('textarea[name="fields.2.options"]', '發燒\n咳嗽\n頭痛');
    
    // Switch to preview tab
    await page.click('button:has-text("預覽表單")');
    
    // Verify template name is shown
    await expect(page.locator('h2:has-text("測試模板")')).toBeVisible();
    
    // Verify text field is rendered
    await expect(page.locator('label:has-text("姓名")')).toBeVisible();
    await expect(page.locator('input[type="text"]').first()).toBeVisible();
    
    // Verify dropdown field is rendered with options
    await expect(page.locator('label:has-text("血型")')).toBeVisible();
    const dropdown = page.locator('select').first();
    await expect(dropdown).toBeVisible();
    
    // Check dropdown options
    const options = await dropdown.locator('option').allTextContents();
    expect(options).toContain('A型');
    expect(options).toContain('B型');
    expect(options).toContain('O型');
    expect(options).toContain('AB型');
    
    // Verify checkbox field is rendered with options
    await expect(page.locator('label:has-text("症狀")')).toBeVisible();
    await expect(page.locator('text=發燒')).toBeVisible();
    await expect(page.locator('text=咳嗽')).toBeVisible();
    await expect(page.locator('text=頭痛')).toBeVisible();
  });

  test('should allow interaction with preview fields', async ({ page }) => {
    // Navigate to medical record templates section
    await page.click('text=病例與表單');
    
    // Click create new template button
    await page.click('button:has-text("新增模板")');
    
    // Fill in template name
    await page.fill('input[name="name"]', '互動測試');
    
    // Add text field
    await page.click('button:has-text("新增欄位")');
    await page.fill('input[name="fields.0.label"]', '備註');
    await page.selectOption('select[name="fields.0.type"]', 'text');
    
    // Add dropdown field
    await page.click('button:has-text("新增欄位")');
    await page.fill('input[name="fields.1.label"]', '選項');
    await page.selectOption('select[name="fields.1.type"]', 'dropdown');
    await page.fill('textarea[name="fields.1.options"]', '選項1\n選項2\n選項3');
    
    // Switch to preview tab
    await page.click('button:has-text("預覽表單")');
    
    // Interact with text field
    const textInput = page.locator('input[type="text"]').first();
    await textInput.fill('測試輸入');
    await expect(textInput).toHaveValue('測試輸入');
    
    // Interact with dropdown
    const dropdown = page.locator('select').first();
    await dropdown.selectOption('選項2');
    await expect(dropdown).toHaveValue('選項2');
  });

  test('should preserve unsaved changes when switching tabs', async ({ page }) => {
    // Navigate to medical record templates section
    await page.click('text=病例與表單');
    
    // Click create new template button
    await page.click('button:has-text("新增模板")');
    
    // Fill in template name
    await page.fill('input[name="name"]', '保留測試');
    
    // Add a field
    await page.click('button:has-text("新增欄位")');
    await page.fill('input[name="fields.0.label"]', '測試欄位');
    
    // Switch to preview tab
    await page.click('button:has-text("預覽表單")');
    
    // Verify field is shown in preview
    await expect(page.locator('label:has-text("測試欄位")')).toBeVisible();
    
    // Switch back to edit tab
    await page.click('button:has-text("編輯模板")');
    
    // Verify template name and field are still there
    await expect(page.locator('input[name="name"]')).toHaveValue('保留測試');
    await expect(page.locator('input[name="fields.0.label"]')).toHaveValue('測試欄位');
  });

  test('should show photo upload section in preview', async ({ page }) => {
    // Navigate to medical record templates section
    await page.click('text=病例與表單');
    
    // Click create new template button
    await page.click('button:has-text("新增模板")');
    
    // Fill in template name
    await page.fill('input[name="name"]', '照片測試');
    
    // Add a field
    await page.click('button:has-text("新增欄位")');
    await page.fill('input[name="fields.0.label"]', '欄位');
    
    // Switch to preview tab
    await page.click('button:has-text("預覽表單")');
    
    // Verify photo upload section is shown
    await expect(page.locator('text=附錄 (選填)')).toBeVisible();
    await expect(page.locator('button:has-text("上傳照片")')).toBeVisible();
    await expect(page.locator('text=尚無附錄照片')).toBeVisible();
  });

  test('should update preview when fields are modified', async ({ page }) => {
    // Navigate to medical record templates section
    await page.click('text=病例與表單');
    
    // Click create new template button
    await page.click('button:has-text("新增模板")');
    
    // Fill in template name
    await page.fill('input[name="name"]', '動態更新測試');
    
    // Add a dropdown field
    await page.click('button:has-text("新增欄位")');
    await page.fill('input[name="fields.0.label"]', '選擇');
    await page.selectOption('select[name="fields.0.type"]', 'dropdown');
    await page.fill('textarea[name="fields.0.options"]', '選項A\n選項B');
    
    // Switch to preview tab
    await page.click('button:has-text("預覽表單")');
    
    // Verify initial options
    const dropdown = page.locator('select').first();
    let options = await dropdown.locator('option').allTextContents();
    expect(options).toContain('選項A');
    expect(options).toContain('選項B');
    expect(options).not.toContain('選項C');
    
    // Switch back to edit tab
    await page.click('button:has-text("編輯模板")');
    
    // Add another option
    await page.fill('textarea[name="fields.0.options"]', '選項A\n選項B\n選項C');
    
    // Switch to preview tab again
    await page.click('button:has-text("預覽表單")');
    
    // Verify updated options
    options = await dropdown.locator('option').allTextContents();
    expect(options).toContain('選項A');
    expect(options).toContain('選項B');
    expect(options).toContain('選項C');
  });
});
