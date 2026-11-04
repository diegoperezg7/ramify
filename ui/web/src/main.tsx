import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// Fonts ship with the app: it works offline and inside editor webviews.
import '@fontsource-variable/inter/wght.css'
import '@fontsource/sora/latin-600.css'
import '@fontsource/sora/latin-700.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
