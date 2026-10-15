import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './styles/unified-shell.css'
import './styles/liquid-glass.css'
import './styles/unified-glass.css'
import './styles/material-roles.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('未找到 #root 挂载点')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
import './styles/product-geometry.css'
