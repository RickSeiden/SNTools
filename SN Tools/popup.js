const extensionActiveCheckbox = document.getElementById('extensionActive');
const manageBtn = document.getElementById('manageBtn');

document.addEventListener('DOMContentLoaded', async () => {
  const { extensionActive = true } = await chrome.storage.local.get('extensionActive');
  extensionActiveCheckbox.checked = extensionActive;
});

extensionActiveCheckbox.addEventListener('change', async () => {
  await chrome.storage.local.set({ extensionActive: extensionActiveCheckbox.checked });
});

manageBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});