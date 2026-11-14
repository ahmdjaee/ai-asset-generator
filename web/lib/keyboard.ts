/**
 * Elemen tempat huruf diketik atau navigasi panah sedang dipakai: pintasan satu huruf (viewer, "/" di Gudang)
 * diabaikan supaya mengetik di kolom teks, atau memilih item menu, tidak memicu aksi lain.
 */
const TYPING_OR_WIDGET =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="menu"], [role="menuitem"], [role="menuitemradio"], [role="listbox"], [role="dialog"], [role="alertdialog"]';

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING_OR_WIDGET) !== null;
}
