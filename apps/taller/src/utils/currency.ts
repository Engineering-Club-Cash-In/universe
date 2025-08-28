/**
 * Currency formatting utilities
 */

/**
 * Format a number as currency with thousand separators
 * @param value - String or number to format
 * @returns Formatted string with commas (e.g., "85,000")
 */
export const formatCurrency = (value: string | number): string => {
  // Convert to string and remove any non-numeric characters
  const cleanValue = value.toString().replace(/[^0-9]/g, '');
  
  if (!cleanValue) return '';
  
  // Parse as number
  const numValue = parseInt(cleanValue, 10);
  
  // Format with thousand separators
  return numValue.toLocaleString('en-US');
};

/**
 * Handle currency input - only allows numbers
 * @param value - Raw input value
 * @returns Object with clean value for form and formatted value for display
 */
export const handleCurrencyInput = (value: string): { raw: string; formatted: string } => {
  // Only keep numeric characters
  const cleanValue = value.replace(/[^0-9]/g, '');
  
  if (!cleanValue) {
    return { raw: '', formatted: '' };
  }
  
  // Return both raw (for form storage) and formatted (for display)
  return {
    raw: cleanValue,
    formatted: formatCurrency(cleanValue)
  };
};