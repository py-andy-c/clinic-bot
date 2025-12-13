/**
 * Currency formatting utilities for Taiwan Dollar (TWD)
 * 
 * Taiwan Dollar does not use decimal points, so all amounts are formatted as whole numbers.
 */

/**
 * Format a number as Taiwan Dollar currency (no decimals)
 * 
 * @param amount - The amount to format (number or string)
 * @returns Formatted currency string with $ prefix and no decimals (e.g., "$1,000")
 */
export function formatCurrency(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) {
    return '$0';
  }
  
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numAmount)) {
    return '$0';
  }
  
  // Round to nearest integer (no decimals for TWD)
  const roundedAmount = Math.round(numAmount);
  
  // Format with comma separators using en-US locale to ensure $2,500 format
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: true
  });
  
  return `$${formatter.format(roundedAmount)}`;
}

/**
 * Format a number as Taiwan Dollar currency without the $ prefix
 * 
 * @param amount - The amount to format (number or string)
 * @returns Formatted currency string without $ prefix and no decimals (e.g., "1,000")
 */
export function formatCurrencyWithoutSymbol(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) {
    return '0';
  }
  
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numAmount)) {
    return '0';
  }
  
  // Round to nearest integer (no decimals for TWD)
  const roundedAmount = Math.round(numAmount);
  
  // Format with comma separators using en-US locale to ensure 2,500 format
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: true
  });
  
  return formatter.format(roundedAmount);
}

