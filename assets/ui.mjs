export function downloadText(filename, content, type = 'text/plain;charset=utf-8') {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([content], { type }));
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(content) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return true;
    } catch {
      // Some in-app browsers expose the API without granting access.
    }
  }

  const previousFocus = document.activeElement;
  const field = document.createElement('textarea');
  field.setAttribute('readonly', '');
  field.className = 'copy-buffer';
  field.value = content;
  document.body.append(field);

  let copied = false;
  try {
    field.select();
    field.setSelectionRange(0, content.length);
    copied = document.execCommand('copy');
  } catch {
    // Callers offer a manual copy field when automatic copy is unavailable.
  } finally {
    field.remove();
    previousFocus?.focus({ preventScroll: true });
  }
  return copied;
}
