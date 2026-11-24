/** Format integer paise into Indian Rupee display (e.g. 1050000 -> ₹10,500.00). */
export function formatPaise(amountPaise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(amountPaise / 100)
}
