export function imageWindowUrl(session, image) {
  return `/image-window.html?${new URLSearchParams({ session, image })}`;
}

export function initImageWindow(document, browser) {
  const params = new URLSearchParams(browser.location.search);
  const session = params.get('session'), image = params.get('image');
  if (session && image) document.querySelector('#image').src = `/api/sessions/${encodeURIComponent(session)}/images/${encodeURIComponent(image)}`;
  document.querySelector('#back').onclick = () => {
    browser.close();
    // iOS may open the link in the installed app rather than a closable window.
    browser.location.replace('/');
  };
}

if (typeof document !== 'undefined' && document.querySelector('#image-window')) initImageWindow(document, window);
