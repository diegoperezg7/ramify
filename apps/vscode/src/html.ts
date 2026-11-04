// Turn the built web UI's index.html into webview HTML: webview asset URLs and a strict CSP.
export function webviewHtml(index: string, assetsBase: string, cspSource: string): string {
  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource} data:`,
    `script-src ${cspSource}`,
    `style-src ${cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src ${cspSource} https://fonts.gstatic.com`,
  ].join('; ')
  return index
    .replace(/ crossorigin/g, '')
    .replace(/(src|href)="\.\/assets\//g, `$1="${assetsBase}/assets/`)
    .replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`)
}
